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
    tx.oncomplete = () =>
      resolve({ entries: entries.result, draft: draft.result });
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

function laterStamp(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

// The note's own time. A missing stamp falls back to updated, which on rows
// saved before this field is the only clock they have.
function noteStamp(entry: SavedMap | undefined): string {
  if (!entry) return "";
  return typeof entry.noteUpdated === "string"
    ? entry.noteUpdated
    : (entry.updated ?? "");
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

// A save can still hold an older search after a newer one has committed.
// Keep the newer research. Readings union by URL, stored links first.
// The row time is the later stamp.
function keepLandedResearch(existing: SavedMap | undefined, entry: SavedMap) {
  const incomingNote = noteStamp(entry);
  const existingNote = noteStamp(existing);
  const kept =
    existing !== undefined && existingNote > incomingNote
      ? existing
      : undefined;
  const noteUpdated = kept ? existingNote : incomingNote;
  const noted: SavedMap = {
    ...entry,
    ...(kept ? { note: kept.note } : {}),
    ...(noteUpdated ? { noteUpdated } : {}),
  };
  const updated = laterStamp(existing?.updated, entry.updated);
  const withTime =
    updated !== undefined && updated !== noted.updated
      ? { ...noted, updated }
      : noted;
  const existingNewer =
    existing?.research !== undefined &&
    (entry.research === undefined ||
      researchVersion(existing) > researchVersion(entry));
  if (!existingNewer) return withTime;
  return {
    ...withTime,
    research: existing.research,
    references: unionByUrl(
      existing.references ?? existing.research?.references,
      entry.references,
    ),
  };
}

// The search panel hands back research without a version. The stored row has
// the stamp. The editor must keep that object or the next save looks older.
// A stored note with a newer stamp replaces the editor note, or the draft
// effect writes the editor's older note back over the row saveResearch fixed.
export function withStampedResearch<E extends SavedMap>(
  editor: E,
  entryId: string,
  stored: SavedMap,
): E {
  if (editor.id !== entryId || stored.research === undefined) return editor;
  const storedNoteNewer = noteStamp(stored) > noteStamp(editor);
  if (!storedNoteNewer) return { ...editor, research: stored.research };
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
// Keep the editor note only when its note stamp changed during that wait.
// A title, pin, or context edit bumps updated and keeps those fields, but
// the merged note and noteUpdated still land. Otherwise take the merged row.
export function editorAfterSave<E extends SavedMap>(
  editor: E,
  snapshot: SavedMap,
  saved: SavedMap,
): E {
  if (editor.id !== saved.id) return editor;
  const noteEdited = noteStamp(editor) !== noteStamp(snapshot);
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
  if (draft && stored && (draft.updated ?? "") > (stored.updated ?? ""))
    return draft;
  return stored ?? draft;
}

function newerNote(
  draft: SavedMap | undefined,
  stored: SavedMap | undefined,
  base: SavedMap,
): SavedMap {
  if (draft && (!stored || noteStamp(draft) > noteStamp(stored))) return draft;
  if (stored && (!draft || noteStamp(stored) > noteStamp(draft))) return stored;
  return base;
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
      const noteEntry = newerNote(draftEntry, stored, entry);
      const noteAt = noteStamp(noteEntry);
      const now = new Date().toISOString();
      const stamped = { ...research, version: now };
      const references = unionByUrl(stamped.references, entry.references);
      updated = {
        ...entry,
        note: noteEntry.note,
        ...(noteAt ? { noteUpdated: noteAt } : {}),
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
