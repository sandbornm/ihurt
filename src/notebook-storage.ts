import type {
  SavedMap,
  RegionId,
  PainPoint,
  HurtMap,
  MapDetail,
} from "./types";
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
    // Read-write: a draft reconciled with its stored row is written back, with
    // its stamps, in this transaction. The autosave runs later, and a search in
    // between must not read the unstamped draft and keep the stored row.
    const tx = db.transaction(["entries", "settings"], "readwrite");
    const settings = tx.objectStore("settings");
    const entries = tx.objectStore("entries").getAll(),
      draft = settings.get("draft");
    let list: SavedMap[] = [],
      result: Draft | undefined,
      done = 0;
    const reconcile = () => {
      if (++done !== 2) return;
      list = (entries.result ?? []) as SavedMap[];
      const raw = draft.result as Draft | undefined;
      const stored = raw && list.find((item) => item.id === raw.entry.id);
      result =
        raw && stored
          ? { ...raw, entry: keepLandedResearch(stored, raw.entry, "draft") }
          : raw;
      if (raw && result && JSON.stringify(result) !== JSON.stringify(raw))
        settings.put(result, "draft");
    };
    entries.onsuccess = reconcile;
    draft.onsuccess = reconcile;
    tx.oncomplete = () => resolve({ entries: list, draft: result });
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

// Who wins when neither side has a stamp (rows and drafts from before the
// stamps). A save or search keeps stored, so a search never overwrites what
// was typed (#46). Loading a draft takes the draft: it exists only because of
// unsaved work, and the editor is the latest intent.
type UnstampedTie = "stored" | "draft";

// Should the incoming side's field replace the stored one?
// A stamp on either side decides it: a missing stamp is older, and a tie keeps
// stored. Row updated is not used: a title edit can make an old note look new.
function incomingWins(
  stored: SavedMap,
  incoming: SavedMap,
  stamp: (entry: SavedMap) => string,
  tie: UnstampedTie,
) {
  const storedAt = stamp(stored);
  const incomingAt = stamp(incoming);
  if (storedAt !== "" || incomingAt !== "")
    return stampMs(incomingAt) > stampMs(storedAt);
  return tie === "draft";
}

function incomingNoteWins(
  stored: SavedMap,
  incoming: SavedMap,
  tie: UnstampedTie = "stored",
) {
  return incomingWins(stored, incoming, noteStamp, tie);
}

function incomingPointsWin(
  stored: SavedMap,
  incoming: SavedMap,
  tie: UnstampedTie = "stored",
) {
  return incomingWins(stored, incoming, pointsStamp, tie);
}

function samePins(left: SavedMap, right: SavedMap) {
  return (
    JSON.stringify(left.points ?? []) === JSON.stringify(right.points ?? []) &&
    JSON.stringify(left.map.regions) === JSON.stringify(right.map.regions)
  );
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
// Notes and pins each follow incomingWins: equal stamps keep stored.
// saveResearch and editorAfterSave settle a tie the same way.
function keepLandedResearch(
  existing: SavedMap | undefined,
  entry: SavedMap,
  tie: UnstampedTie = "stored",
) {
  const incomingNote = noteStamp(entry);
  const existingNote = noteStamp(existing);
  const kept =
    existing !== undefined && !incomingNoteWins(existing, entry, tie)
      ? existing
      : undefined;
  const noteUpdated = kept ? existingNote : incomingNote;
  const chosenNote = kept ? kept.note : entry.note;
  const incomingPts = pointsStamp(entry);
  const existingPts = pointsStamp(existing);
  const keepPoints =
    existing !== undefined && !incomingPointsWin(existing, entry, tie);
  const points = keepPoints && existing ? existing.points : entry.points;
  const regions =
    keepPoints && existing ? existing.map.regions : entry.map.regions;
  // A loaded draft whose pins won an unstamped tie gets a stamp, so the next
  // search or save (stored wins a tie there) does not put the old pins back.
  const loadedPins =
    tie === "draft" &&
    existing !== undefined &&
    !keepPoints &&
    incomingPts === "" &&
    existingPts === "" &&
    !samePins(existing, entry);
  const pointsUpdated = keepPoints
    ? existingPts
    : loadedPins
      ? (entry.updated ?? new Date().toISOString())
      : incomingPts;
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

// The row's pins, for an editor that has not changed its own since.
function storedPins(editor: SavedMap, stored: SavedMap) {
  return {
    points: stored.points ?? [],
    map: { ...editor.map, regions: stored.map.regions },
    ...(typeof stored.pointsUpdated === "string"
      ? { pointsUpdated: stored.pointsUpdated }
      : {}),
  };
}

// saveResearch merged the stored row, the saved draft and the editor. The
// editor takes that whole merge, not only the note and research, or the next
// autosave writes its older readings, answers and map details over the row.
// Fields the user changed during the search keep by the same stamp rules:
// note and pins by their stamps, map details by their field stamps, readings
// union by URL, and answers merge by question with the row first.
export function withStampedResearch<E extends SavedMap>(
  editor: E,
  entryId: string,
  stored: SavedMap,
): E {
  if (editor.id !== entryId || stored.research === undefined) return editor;
  // saveResearch picked these pins. Keep the editor's only if they are newer,
  // or the next pin edit writes an older, shorter list over the row.
  const pins =
    stampMs(editor.pointsUpdated) > stampMs(stored.pointsUpdated)
      ? undefined
      : storedPins(editor, stored);
  const noteFrom = storedNoteNewerThanEditor(stored, editor) ? stored : editor;
  const ranked = byUpdated([stored, editor]);
  const details = mergeMap([stored, editor], ranked);
  const ai = ranked.find((record) => record.ai !== undefined)?.ai;
  return {
    ...editor,
    ...(ai !== undefined ? { ai } : {}),
    answers: fillAnswers(ranked),
    references: unionByUrl(stored.references, editor.references),
    research: stored.research,
    note: noteFrom.note,
    ...(typeof noteFrom.noteUpdated === "string"
      ? { noteUpdated: noteFrom.noteUpdated }
      : {}),
    ...(pins
      ? {
          points: pins.points,
          ...("pointsUpdated" in pins
            ? { pointsUpdated: pins.pointsUpdated }
            : {}),
        }
      : {}),
    map: {
      ...details.map,
      summary: noteFrom.map.summary,
      regions: (pins ?? editor).map.regions,
    },
    ...(Object.keys(details.mapUpdated).length > 0
      ? { mapUpdated: details.mapUpdated }
      : {}),
  };
}

// The user's pin edits made while a save was in flight, applied to the pins
// the save landed: removals drop, moves and comment changes replace, new pins
// append. Pins the merge kept from the stored row stay.
function mergePinEdits(
  snapshot: readonly PainPoint[],
  editor: readonly PainPoint[],
  saved: readonly PainPoint[],
): PainPoint[] {
  const before = new Map(snapshot.map((p) => [p.id, JSON.stringify(p)]));
  const mine = new Map(editor.map((p) => [p.id, p]));
  const removed = new Set(
    snapshot.filter((p) => !mine.has(p.id)).map((p) => p.id),
  );
  const changed = new Map(
    editor
      .filter((p) => before.get(p.id) !== JSON.stringify(p))
      .map((p) => [p.id, p]),
  );
  const landed = new Set(saved.map((p) => p.id));
  return [
    ...saved
      .filter((p) => !removed.has(p.id))
      .map((p) => changed.get(p.id) ?? p),
    ...[...changed.values()].filter((p) => !landed.has(p.id)),
  ];
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
  // The merge can keep stored pins. Take them, plus any pin edit made during
  // the wait, or the next save writes the editor's shorter list over the row.
  const pinsEdited =
    editor.pointsUpdated !== snapshot.pointsUpdated ||
    JSON.stringify(editor.points ?? []) !==
      JSON.stringify(snapshot.points ?? []);
  const merged = mergePinEdits(
    snapshot.points ?? [],
    editor.points ?? [],
    saved.points ?? [],
  );
  const pins = pinsEdited
    ? {
        points: merged,
        map: {
          ...editor.map,
          regions: [...new Set(merged.map((p) => p.region))],
        },
      }
    : storedPins(editor, saved);
  if (noteEdited) return { ...editor, ...pins, ...researchAndRefs };
  const fieldsEdited = (editor.updated ?? "") !== (snapshot.updated ?? "");
  if (!fieldsEdited) return { ...editor, ...saved, id: editor.id };
  return {
    ...editor,
    ...pins,
    note: saved.note,
    ...(typeof saved.noteUpdated === "string"
      ? { noteUpdated: saved.noteUpdated }
      : {}),
    ...researchAndRefs,
  };
}

// Equal note stamps keep the stored note, same as keepLandedResearch.
function newerNote(
  draft: SavedMap | undefined,
  stored: SavedMap | undefined,
): SavedMap | undefined {
  if (!draft || !stored) return draft ?? stored;
  return incomingNoteWins(stored, draft) ? draft : stored;
}

function newerPoints(
  draft: SavedMap | undefined,
  stored: SavedMap | undefined,
): SavedMap | undefined {
  if (!draft || !stored) return draft ?? stored;
  return incomingPointsWin(stored, draft) ? draft : stored;
}

// Records ranked by updated, newest first. Equal stamps keep the earlier
// argument first, so pass stored, then the saved draft, then the editor: a tie
// keeps the persisted side (the #46 rule).
function byUpdated(records: (SavedMap | undefined)[]): SavedMap[] {
  return records
    .filter((r): r is SavedMap => r !== undefined)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => stampMs(b.r.updated) - stampMs(a.r.updated) || a.i - b.i)
    .map(({ r }) => r);
}

const blank = (value: unknown) =>
  value === undefined || value === null || value === "";

const MAP_DETAILS: readonly MapDetail[] = [
  "title",
  "quality",
  "intensity",
  "activity",
  "duration",
  "question",
  "urgent",
  "safety_message",
];

// The entry with map patched, stamping each detail whose value changed. A
// cleared detail gets a stamp too, so a merge keeps it cleared.
export function withMapDetails(
  entry: SavedMap,
  patch: Partial<HurtMap>,
  now: string,
): SavedMap {
  const map = { ...entry.map, ...patch };
  const changed = MAP_DETAILS.filter(
    (key) =>
      key in patch &&
      JSON.stringify(map[key]) !== JSON.stringify(entry.map[key]),
  );
  if (changed.length === 0) return { ...entry, map };
  const stamps = { ...entry.mapUpdated };
  for (const key of changed) stamps[key] = now;
  return { ...entry, map, mapUpdated: stamps };
}

const detailStamp = (record: SavedMap, key: MapDetail) =>
  typeof record.mapUpdated?.[key] === "string"
    ? record.mapUpdated[key]
    : undefined;

// Each map detail goes to the record with the newest stamp for that field,
// blank or not: a stamped blank is a deliberate clear. Equal stamps keep the
// earlier record in order (stored, then the saved draft, then the editor).
// Only when no record stamps a field does the newest record by updated lead,
// with a blank there filled from the next newest, so a legacy detail only one
// record holds is kept. summary and regions follow the note and pins instead.
function mergeMap(
  ordered: SavedMap[],
  ranked: SavedMap[],
): { map: HurtMap; mapUpdated: NonNullable<SavedMap["mapUpdated"]> } {
  const map: Record<string, unknown> = { ...ranked[0].map };
  for (const record of ranked.slice(1))
    for (const [key, value] of Object.entries(record.map))
      if (blank(map[key]) && !blank(value)) map[key] = value;
  const mapUpdated: NonNullable<SavedMap["mapUpdated"]> = {};
  for (const key of MAP_DETAILS) {
    let winner: SavedMap | undefined;
    for (const record of ordered) {
      const at = detailStamp(record, key);
      if (
        at !== undefined &&
        (winner === undefined ||
          stampMs(at) > stampMs(detailStamp(winner, key)))
      )
        winner = record;
    }
    if (winner === undefined) continue;
    map[key] = winner.map[key];
    mapUpdated[key] = detailStamp(winner, key);
  }
  return { map: map as unknown as HurtMap, mapUpdated };
}

// Answers merge by question. The newest record's answer to a question wins;
// a question only an older record answered is kept.
function fillAnswers(ranked: SavedMap[]): SavedMap["answers"] {
  const seen = new Set<string>();
  const answers: SavedMap["answers"] = [];
  for (const record of ranked)
    for (const answer of record.answers ?? [])
      if (!seen.has(answer.key) && !blank(answer.text)) {
        seen.add(answer.key);
        answers.push(answer);
      }
  return answers;
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

// editor is the open entry, when it is this one. Another tab may have saved a
// newer draft since, so the editor is one of three records merged field by
// field: the stored row, the saved draft, and the editor.
export async function saveResearch(
  entryId: string,
  research: NonNullable<SavedMap["research"]>,
  editor?: SavedMap,
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
      const savedDraft =
        currentDraft?.entry.id === entryId ? currentDraft.entry : undefined;
      const openEditor = editor?.id === entryId ? editor : undefined;
      // Three records: the stored row, the saved draft (which another tab may
      // have written after this editor), and this tab's open editor. Note and
      // pins each go to the newest by their own stamp, folding the draft onto
      // the row and then the editor onto that; a tie keeps the earlier side.
      // Map details go by their own field stamps (mergeMap). Other fields
      // have no stamp, so the newest record by updated leads and nothing only
      // one record holds is dropped: readings union by URL, answers merge by
      // question, and legacy unstamped map details are filled.
      const ranked = byUpdated([stored, savedDraft, openEditor]);
      const entry = ranked[0];
      if (!entry) return;
      const noteEntry =
        newerNote(openEditor, newerNote(savedDraft, stored)) ?? entry;
      const pointsEntry =
        newerPoints(openEditor, newerPoints(savedDraft, stored)) ?? entry;
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
      const references = ranked.reduce<NonNullable<SavedMap["references"]>>(
        (all, record) => unionByUrl(all, record.references),
        stamped.references,
      );
      const ai = ranked.find((record) => record.ai !== undefined)?.ai;
      const details = mergeMap(
        [stored, savedDraft, openEditor].filter(
          (r): r is SavedMap => r !== undefined,
        ),
        ranked,
      );
      updated = {
        ...entry,
        ...(ai !== undefined ? { ai } : {}),
        answers: fillAnswers(ranked),
        note: noteEntry.note,
        points: pointsEntry.points,
        map: {
          ...details.map,
          summary: noteEntry.note,
          regions: pointsEntry.map.regions,
        },
        ...(noteAt !== undefined ? { noteUpdated: noteAt } : {}),
        ...(pointsAt !== undefined ? { pointsUpdated: pointsAt } : {}),
        ...(Object.keys(details.mapUpdated).length > 0
          ? { mapUpdated: details.mapUpdated }
          : {}),
        research: stamped,
        references,
        updated: laterStamp(entry.updated, now) ?? now,
      };
      entries.put(updated);
      if (savedDraft && currentDraft)
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
