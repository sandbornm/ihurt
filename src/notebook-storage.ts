import type { SavedMap, RegionId } from "./types";
export interface Draft {
  entry: SavedMap;
  selected: RegionId | null;
  view: "front" | "back";
  layer: "muscle" | "bone";
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
      reject(new Error("Close other iHurt tabs and try again."));
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
export const saveDraft = (draft: Draft) =>
  mutate(["settings"], (tx) => {
    tx.objectStore("settings").put(draft, "draft");
  });
export const storeEntries = (entries: SavedMap[]) =>
  mutate(["entries"], (tx) => {
    for (const entry of entries) tx.objectStore("entries").put(entry);
  });
export const removeEntry = (id: string) =>
  mutate(["entries"], (tx) => {
    tx.objectStore("entries").delete(id);
  });

export async function saveResearch(
  entryId: string,
  research: NonNullable<SavedMap["research"]>,
): Promise<SavedMap | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["entries", "settings"], "readwrite");
    const saved = tx.objectStore("entries").get(entryId);
    const draft = tx.objectStore("settings").get("draft");
    let complete = 0,
      updated: SavedMap | undefined;
    const merge = () => {
      if (++complete !== 2) return;
      const currentDraft = draft.result as Draft | undefined;
      const matches = currentDraft?.entry.id === entryId;
      const entry = matches
        ? currentDraft.entry
        : (saved.result as SavedMap | undefined);
      // A deleted entry must stay deleted when an earlier search finishes.
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
      tx.objectStore("entries").put(updated);
      if (matches)
        tx.objectStore("settings").put(
          { ...currentDraft, entry: updated },
          "draft",
        );
    };
    saved.onsuccess = merge;
    draft.onsuccess = merge;
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
