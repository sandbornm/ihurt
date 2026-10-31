import type { SavedMap, RegionId } from "./types";
import { t } from "./i18n/index.ts";
export interface Draft {
  entry: SavedMap;
  selected: RegionId | null;
  view: "front" | "back";
  layer: "muscle" | "bone";
  showSkeleton?: boolean;
  sources: string[];
}
let database: Promise<IDBDatabase> | undefined;
function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ihurt-notebook", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("entries", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      database = undefined;
      reject(new Error(t("storage.blocked")));
    };
  });
  return database;
}
export async function loadNotebook(): Promise<{
  entries: SavedMap[];
  draft?: Draft;
}> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["entries", "settings"], "readonly");
    const entries = tx.objectStore("entries").getAll(),
      draft = tx.objectStore("settings").get("draft");
    tx.oncomplete = () => {
      const list = (entries.result ?? []) as SavedMap[];
      const raw = draft.result as Draft | undefined;
      const stored = raw && list.find((item) => item.id === raw.entry.id);
      resolve({
        entries: list,
        draft:
          raw && stored
            ? { ...raw, entry: keepLandedResearch(stored, raw.entry) }
            : raw,
      });
    };
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
async function mutate(stores: string[], work: (tx: IDBTransaction) => void) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    try {
      work(tx);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
const DELETED_IDS = "deleted-ids";

function deletedIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

// Missing on rows saved before versions existed. Older than any stamped search.
function researchVersion(entry: SavedMap | undefined): string {
  const version = entry?.research?.version;
  return typeof version === "string" ? version : "";
}

// Missing or invalid is older than any valid stamp.
function stampMs(value?: string): number {
  if (typeof value !== "string" || value === "") return -Infinity;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : -Infinity;
}

function laterStamp(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return stampMs(left) > stampMs(right) ? left : right;
}

// The note's own time. A missing stamp is older than any present stamp.
// Do not use updated. A title or pin edit bumps that field without a note change.
function noteStamp(entry: SavedMap | undefined): string {
  if (!entry) return "";
  return typeof entry.noteUpdated === "string" ? entry.noteUpdated : "";
}

function pointsStamp(entry: SavedMap | undefined): string {
  if (!entry) return "";
  return typeof entry.pointsUpdated === "string" ? entry.pointsUpdated : "";
}

function ensureNoteStamp(entry: SavedMap, fallback: string): SavedMap {
  if (typeof entry.noteUpdated === "string") return entry;
  return { ...entry, noteUpdated: fallback };
}

function unionByUrl<T extends { url: string }>(
  first: readonly T[] | undefined,
  second: readonly T[] | undefined,
): T[] {
  return [...(first ?? []), ...(second ?? [])].filter(
    (item, index, all) =>
      all.findIndex((other) => other.url === item.url) === index,
  );
}

// The open entry's link list. Research links stay first, then links already
// on the row, then readings found for the current regions. The next save and
// the backup both start from this list.
export function entryReferences(
  entry: SavedMap,
  readings: NonNullable<SavedMap["references"]> = [],
): NonNullable<SavedMap["references"]> {
  return unionByUrl(
    unionByUrl(entry.research?.references, entry.references),
    readings,
  );
}

// A save can still hold an older search after a newer one has committed.
// Keep the newer research. Readings union by URL, stored links first,
// on the row and on that research list. The row time is the later stamp.
// Equal note stamps keep the stored note, including two missing stamps.
// saveResearch and editorAfterSave settle a tie the same way.
function keepLandedResearch(existing: SavedMap | undefined, entry: SavedMap) {
  const incomingNote = noteStamp(entry);
  const existingNote = noteStamp(existing);
  const kept =
    existing !== undefined && stampMs(existingNote) >= stampMs(incomingNote)
      ? existing
      : undefined;
  const noteUpdated = kept ? existingNote : incomingNote;
  const chosenNote = kept ? kept.note : entry.note;
  const incomingPts = pointsStamp(entry);
  const existingPts = pointsStamp(existing);
  // Rows from before pointsUpdated have no stamp on either side. Keep the old
  // rule for them: the incoming pins win.
  const keepPoints =
    existing !== undefined &&
    (existingPts !== "" || incomingPts !== "") &&
    stampMs(existingPts) >= stampMs(incomingPts);
  const points = keepPoints && existing ? existing.points : entry.points;
  const regions =
    keepPoints && existing ? existing.map.regions : entry.map.regions;
  const pointsUpdated = keepPoints ? existingPts : incomingPts;
  const noted: SavedMap = {
    ...entry,
    note: chosenNote,
    points,
    map: { ...entry.map, summary: chosenNote, regions },
    ...(noteUpdated ? { noteUpdated } : {}),
    ...(pointsUpdated ? { pointsUpdated } : {}),
  };
  const updated = laterStamp(existing?.updated, entry.updated);
  const withTime =
    updated !== undefined && updated !== noted.updated
      ? { ...noted, updated }
      : noted;
  const existingNewer =
    existing?.research !== undefined &&
    (entry.research === undefined ||
      stampMs(researchVersion(existing)) > stampMs(researchVersion(entry)));
  // A note with no stamp gets the updated time of the row it came from.
  // The later row time can be a title edit, which would rank the note too new.
  const stamped = ensureNoteStamp(
    withTime,
    (kept ?? entry).updated ?? updated ?? new Date().toISOString(),
  );
  if (!existingNewer) return stamped;
  const references = unionByUrl(
    existing.references ?? existing.research?.references,
    entry.references,
  );
  return {
    ...stamped,
    // description is the text sent to the source search. History, not the note.
    research: existing.research
      ? { ...existing.research, references }
      : existing.research,
    references,
  };
}

// The search panel hands back research without a version. The stored row has
// the stamp. The editor must keep that object or the next save looks older.
// A stored note with a newer stamp replaces the editor note, or the draft
// effect writes the editor's older note back over the row saveResearch fixed.
// A missing editor noteUpdated is older than a present stored noteUpdated.
// If both are present, compare them. Never use updated for this.
function storedNoteNewerThanEditor(stored: SavedMap, editor: SavedMap) {
  return stampMs(stored.noteUpdated) > stampMs(editor.noteUpdated);
}

export function withStampedResearch<E extends SavedMap>(
  editor: E,
  entryId: string,
  stored: SavedMap,
): E {
  if (editor.id !== entryId || stored.research === undefined) return editor;
  if (!storedNoteNewerThanEditor(stored, editor))
    return { ...editor, research: stored.research };
  return {
    ...editor,
    research: stored.research,
    note: stored.note,
    ...(typeof stored.noteUpdated === "string"
      ? { noteUpdated: stored.noteUpdated }
      : {}),
  };
}

// commit() snapshots the open entry, then waits on storeEntries.
// Keep the editor note only when its text or noteUpdated changed during
// that wait. Compare those fields as-is, including a missing stamp.
// A title, pin, or context edit bumps updated and keeps those fields, but
// the merged note and noteUpdated still land. Otherwise take the merged row.
export function editorAfterSave<E extends SavedMap>(
  editor: E,
  snapshot: SavedMap,
  saved: SavedMap,
): E {
  if (editor.id !== saved.id) return editor;
  const noteEdited =
    editor.note !== snapshot.note ||
    editor.noteUpdated !== snapshot.noteUpdated;
  const researchAndRefs = {
    ...(saved.research !== undefined ? { research: saved.research } : {}),
    ...(saved.references !== undefined ? { references: saved.references } : {}),
  };
  if (noteEdited) return { ...editor, ...researchAndRefs };
  const fieldsEdited = (editor.updated ?? "") !== (snapshot.updated ?? "");
  if (!fieldsEdited) return { ...editor, ...saved, id: editor.id };
  return {
    ...editor,
    note: saved.note,
    ...(typeof saved.noteUpdated === "string"
      ? { noteUpdated: saved.noteUpdated }
      : {}),
    ...researchAndRefs,
  };
}

function newerEntry(draft: SavedMap | undefined, stored: SavedMap | undefined) {
  if (draft && stored && stampMs(draft.updated) > stampMs(stored.updated))
    return draft;
  return stored ?? draft;
}

// Equal note stamps keep the stored note, same as keepLandedResearch.
function newerNote(
  draft: SavedMap | undefined,
  stored: SavedMap | undefined,
): SavedMap | undefined {
  if (
    draft &&
    (!stored || stampMs(noteStamp(draft)) > stampMs(noteStamp(stored)))
  )
    return draft;
  return stored;
}

function newerPoints(
  draft: SavedMap | undefined,
  stored: SavedMap | undefined,
): SavedMap | undefined {
  // Neither side has a pin stamp (rows from before pointsUpdated). Let the
  // caller fall back to the newer row, as before.
  if (draft && stored && !pointsStamp(draft) && !pointsStamp(stored))
    return undefined;
  if (
    draft &&
    (!stored || stampMs(pointsStamp(draft)) > stampMs(pointsStamp(stored)))
  )
    return draft;
  return stored;
}

export const saveDraft = (draft: Draft) =>
  mutate(["settings"], (tx) => {
    tx.objectStore("settings").put(draft, "draft");
  });
export function storeEntries(entries: SavedMap[]): Promise<SavedMap[]> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["entries", "settings"], "readwrite");
        const merged: SavedMap[] = [];
        tx.oncomplete = () => resolve(merged);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        try {
          const store = tx.objectStore("entries");
          const settings = tx.objectStore("settings");
          const tomb = settings.get(DELETED_IDS);
          tomb.onsuccess = () => {
            const ids = new Set(deletedIds(tomb.result));
            let changed = false;
            for (const entry of entries) {
              if (ids.delete(entry.id)) changed = true;
              const current = store.get(entry.id);
              current.onsuccess = () => {
                const existing = current.result as SavedMap | undefined;
                const row = keepLandedResearch(existing, entry);
                merged.push(row);
                store.put(row);
              };
            }
            if (changed) settings.put([...ids], DELETED_IDS);
          };
        } catch (error) {
          try {
            tx.abort();
          } catch {
            // Already aborting.
          }
          reject(error);
        }
      }),
  );
}
export const removeEntry = (id: string) =>
  mutate(["entries", "settings"], (tx) => {
    tx.objectStore("entries").delete(id);
    const current = tx.objectStore("settings").get(DELETED_IDS);
    current.onsuccess = () => {
      const ids = deletedIds(current.result);
      if (!ids.includes(id)) ids.push(id);
      tx.objectStore("settings").put(ids, DELETED_IDS);
    };
  });

export async function saveResearch(
  entryId: string,
  research: NonNullable<SavedMap["research"]>,
): Promise<SavedMap | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["entries", "settings"], "readwrite");
    const entries = tx.objectStore("entries");
    const settings = tx.objectStore("settings");
    const saved = entries.get(entryId);
    const draft = settings.get("draft");
    const tomb = settings.get(DELETED_IDS);
    let complete = 0,
      updated: SavedMap | undefined;
    const merge = () => {
      if (++complete !== 3) return;
      // A deleted id stays deleted even when the draft still names it.
      if (deletedIds(tomb.result).includes(entryId)) return;
      const currentDraft = draft.result as Draft | undefined;
      const stored = saved.result as SavedMap | undefined;
      const draftEntry =
        currentDraft?.entry.id === entryId ? currentDraft.entry : undefined;
      const entry = newerEntry(draftEntry, stored);
      if (!entry) return;
      const noteEntry = newerNote(draftEntry, stored) ?? entry;
      const pointsEntry = newerPoints(draftEntry, stored) ?? entry;
      const now = new Date().toISOString();
      // A note with no stamp gets its row's updated time, never now. A search
      // stamped with now would outrank a note the user typed seconds earlier,
      // and withStampedResearch would put the older note back in the editor.
      const noteAt =
        typeof noteEntry.noteUpdated === "string"
          ? noteEntry.noteUpdated
          : noteEntry.updated;
      const pointsAt =
        typeof pointsEntry.pointsUpdated === "string"
          ? pointsEntry.pointsUpdated
          : undefined;
      const stamped = { ...research, version: now };
      const references = unionByUrl(stamped.references, entry.references);
      updated = {
        ...entry,
        note: noteEntry.note,
        points: pointsEntry.points,
        map: {
          ...entry.map,
          summary: noteEntry.note,
          regions: pointsEntry.map.regions,
        },
        ...(noteAt !== undefined ? { noteUpdated: noteAt } : {}),
        ...(pointsAt !== undefined ? { pointsUpdated: pointsAt } : {}),
        research: stamped,
        references,
        updated: laterStamp(entry.updated, now) ?? now,
      };
      entries.put(updated);
      if (draftEntry)
        settings.put({ ...currentDraft, entry: updated }, "draft");
    };
    saved.onsuccess = merge;
    draft.onsuccess = merge;
    tomb.onsuccess = merge;
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
