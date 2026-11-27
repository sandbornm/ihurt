import { entriesForBackup, type BackupEntry } from "./backup.ts";

export const OPT_IN_KEY = "ihurt-sync-opt-in";
export const OPT_IN_UID_KEY = "ihurt-sync-uid";
export const SYNCED_IDS_KEY = "ihurt-synced-ids";
export const SYNCED_UID_KEY = "ihurt-synced-uid";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readSyncedIds(store: KeyValueStore): string[] {
  try {
    const parsed = JSON.parse(store.getItem(SYNCED_IDS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function optedIn(store: KeyValueStore, uid: string): boolean {
  return (
    store.getItem(OPT_IN_KEY) === "1" && store.getItem(OPT_IN_UID_KEY) === uid
  );
}

export function grantOptIn(store: KeyValueStore, uid: string) {
  store.setItem(OPT_IN_KEY, "1");
  store.setItem(OPT_IN_UID_KEY, uid);
}

export function clearOptIn(store: KeyValueStore) {
  store.removeItem(OPT_IN_KEY);
  store.removeItem(OPT_IN_UID_KEY);
}

export function syncedIdsFor(store: KeyValueStore, uid: string): string[] {
  if (store.getItem(SYNCED_UID_KEY) !== uid) return [];
  return readSyncedIds(store);
}

export function rememberSynced(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  const owned =
    store.getItem(SYNCED_UID_KEY) === uid ? readSyncedIds(store) : [];
  store.setItem(SYNCED_UID_KEY, uid);
  store.setItem(SYNCED_IDS_KEY, JSON.stringify([...new Set([...owned, ...ids])]));
}

export function clearSynced(store: KeyValueStore, uid?: string) {
  if (uid && store.getItem(SYNCED_UID_KEY) !== uid) return;
  store.removeItem(SYNCED_IDS_KEY);
  store.removeItem(SYNCED_UID_KEY);
}

export async function pushBackup<T extends BackupEntry>(input: {
  uid: string;
  token: string;
  entries: readonly T[];
  now: number;
  store: KeyValueStore;
  put: (token: string, entries: T[]) => Promise<void>;
}): Promise<T[]> {
  if (!optedIn(input.store, input.uid)) return [];
  const windowed = entriesForBackup(input.entries, input.now);
  await input.put(input.token, windowed);
  rememberSynced(
    input.store,
    windowed.map((entry) => entry.id),
    input.uid,
  );
  return windowed;
}

// API delete, then local wipe of ids that were synced, then the auth user.
// A failed API delete leaves the device and the sign-in alone.
export async function deleteSignedInAccount(input: {
  uid: string;
  token: string;
  api: { deleteAccount(token: string): Promise<void> } | null;
  removeLocal: (ids: string[]) => Promise<void>;
  deleteAuth: () => Promise<void>;
  store: KeyValueStore;
}): Promise<void> {
  const ids = syncedIdsFor(input.store, input.uid);
  if (input.api) {
    await input.api.deleteAccount(input.token);
    await input.removeLocal(ids);
  }
  clearOptIn(input.store);
  clearSynced(input.store, input.uid);
  await input.deleteAuth();
}
