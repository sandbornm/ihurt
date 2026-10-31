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

// The editor never clears research. A save that started before the search
// finished still carries the note and the map from that moment.
function keepLandedResearch(existing: SavedMap | undefined, entry: SavedMap) {
  if (existing?.research === undefined || entry.research !== undefined)
    return entry;
  const references = [
    ...(existing.references ?? []),
    ...(entry.references ?? []),
  ].filter(
    (item, index, all) =>
      all.findIndex((other) => other.url === item.url) === index,
  );
  return { ...entry, research: existing.research, references };
}

function newerEntry(draft: SavedMap | undefined, stored: SavedMap | undefined) {
  if (draft && stored && (draft.updated ?? "") > (stored.updated ?? ""))
    return draft;
  return stored ?? draft;
}

export const saveDraft = (draft: Draft) =>
  mutate(["settings"], (tx) => {
    tx.objectStore("settings").put(draft, "draft");
  });
export const storeEntries = (entries: SavedMap[]) =>
  mutate(["entries", "settings"], (tx) => {
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
          store.put(keepLandedResearch(existing, entry));
        };
      }
      if (changed) settings.put([...ids], DELETED_IDS);
    };
  });
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
      const references = [
        ...research.references,
        ...(entry.references ?? []),
      ].filter(
        (r, i, all) => all.findIndex((other) => other.url === r.url) === i,
      );
      updated = {
        ...entry,
        research,
        references,
        updated: new Date().toISOString(),
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
