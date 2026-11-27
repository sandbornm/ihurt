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

function idsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

// One list per account. An older build stored a single list plus a uid.
function readBook(store: KeyValueStore): Record<string, string[]> {
  try {
    const parsed = JSON.parse(store.getItem(SYNCED_IDS_KEY) || "{}") as unknown;
    if (Array.isArray(parsed)) {
      const uid = store.getItem(SYNCED_UID_KEY);
      return uid ? { [uid]: idsOf(parsed) } : {};
    }
    if (!parsed || typeof parsed !== "object") return {};
    const book: Record<string, string[]> = {};
    for (const [uid, ids] of Object.entries(parsed)) book[uid] = idsOf(ids);
    return book;
  } catch {
    return {};
  }
}

function writeBook(store: KeyValueStore, book: Record<string, string[]>) {
  store.setItem(SYNCED_IDS_KEY, JSON.stringify(book));
  store.removeItem(SYNCED_UID_KEY);
}

export function readSyncedIds(store: KeyValueStore): string[] {
  return [...new Set(Object.values(readBook(store)).flat())];
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
  return readBook(store)[uid] ?? [];
}

export function rememberSynced(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  const book = readBook(store);
  book[uid] = [...new Set([...(book[uid] ?? []), ...ids])];
  writeBook(store, book);
}

export function clearSynced(store: KeyValueStore, uid?: string) {
  if (!uid) {
    store.removeItem(SYNCED_IDS_KEY);
    store.removeItem(SYNCED_UID_KEY);
    return;
  }
  const book = readBook(store);
  if (!(uid in book)) return;
  delete book[uid];
  writeBook(store, book);
}

export async function pushBackup<T extends BackupEntry>(input: {
  uid: string;
  token: string;
  entries: readonly T[];
  now: number;
  store: KeyValueStore;
  put: (token: string, entries: T[]) => Promise<void>;
  deletedIds?: readonly string[];
}): Promise<T[]> {
  if (!optedIn(input.store, input.uid)) return [];
  const windowed = entriesForBackup(input.entries, input.now);
  const deleted = new Set(input.deletedIds ?? []);
  const present = new Set(windowed.map((entry) => entry.id));
  const omitted = syncedIdsFor(input.store, input.uid).filter(
    (id) => !present.has(id) && !deleted.has(id),
  );
  // A list from before the pull is missing account rows and is not a delete.
  if (omitted.length > 0) return [];
  await input.put(input.token, windowed);
  rememberSynced(
    input.store,
    windowed.map((entry) => entry.id),
    input.uid,
  );
  return windowed;
}

export type AccountDeleteStage = "api" | "local" | "auth";

export function accountDeleteStage(error: unknown): AccountDeleteStage | null {
  const stage = (error as { stage?: unknown } | null)?.stage;
  return stage === "api" || stage === "local" || stage === "auth" ? stage : null;
}

// A failed delete keeps the sign-in. The cloud account, the local wipe, or the
// Firebase user may still need another attempt, including after a 404.
export function accountDeleteKeepsDevice(_error: unknown): boolean {
  return true;
}

function tagDeleteError(error: unknown, stage: AccountDeleteStage): unknown {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, "stage", { value: stage });
      return error;
    } catch {
      // A frozen error still needs a stage the caller can read.
    }
  }
  const wrapped = new Error(error instanceof Error ? error.message : "delete");
  Object.defineProperty(wrapped, "stage", { value: stage });
  return wrapped;
}

// Cloud delete, then local wipe of ids that were synced, then the auth user.
// Without a backup API the sign-in stays, because cloud copies could not be removed.
export async function deleteSignedInAccount(input: {
  uid: string;
  token: string;
  api: { deleteAccount(token: string): Promise<void> } | null;
  removeLocal: (ids: string[]) => Promise<void>;
  deleteAuth: () => Promise<void>;
  store: KeyValueStore;
}): Promise<void> {
  if (!input.api) {
    const missing = new Error("no-api");
    Object.defineProperty(missing, "code", { value: "no-api" });
    throw tagDeleteError(missing, "api");
  }
  const ids = syncedIdsFor(input.store, input.uid);
  try {
    await input.api.deleteAccount(input.token);
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status !== 404) throw tagDeleteError(error, "api");
  }
  try {
    await input.removeLocal(ids);
  } catch (error) {
    throw tagDeleteError(error, "local");
  }
  try {
    await input.deleteAuth();
  } catch (error) {
    throw tagDeleteError(error, "auth");
  }
  clearOptIn(input.store);
  clearSynced(input.store, input.uid);
}
