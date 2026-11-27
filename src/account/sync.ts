import { entriesForBackup, mergeBackupWindow, type BackupEntry } from "./backup.ts";

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

interface SyncedAccount {
  window: string[];
  backed: string[];
}

function accountOf(value: unknown): SyncedAccount {
  if (Array.isArray(value)) {
    const ids = idsOf(value);
    return { window: [...ids], backed: [...ids] };
  }
  if (!value || typeof value !== "object") return { window: [], backed: [] };
  const row = value as { window?: unknown; backed?: unknown };
  const window = idsOf(row.window);
  return {
    window,
    backed: [...new Set([...idsOf(row.backed), ...window])],
  };
}

// One record per account. `window` is the last 90-day upload. `backed` is every
// id this device has uploaded, including rows that later aged out of the window.
// An older build stored a single list, or a list plus a uid.
function readBook(store: KeyValueStore): Record<string, SyncedAccount> {
  try {
    const parsed = JSON.parse(store.getItem(SYNCED_IDS_KEY) || "{}") as unknown;
    if (Array.isArray(parsed)) {
      const uid = store.getItem(SYNCED_UID_KEY);
      return uid ? { [uid]: accountOf(parsed) } : {};
    }
    if (!parsed || typeof parsed !== "object") return {};
    const book: Record<string, SyncedAccount> = {};
    for (const [uid, ids] of Object.entries(parsed)) book[uid] = accountOf(ids);
    return book;
  } catch {
    return {};
  }
}

function writeBook(store: KeyValueStore, book: Record<string, SyncedAccount>) {
  store.setItem(SYNCED_IDS_KEY, JSON.stringify(book));
  store.removeItem(SYNCED_UID_KEY);
}

export function readSyncedIds(store: KeyValueStore): string[] {
  return [...new Set(Object.values(readBook(store)).flatMap((row) => row.window))];
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
  return readBook(store)[uid]?.window ?? [];
}

export function backedIdsFor(store: KeyValueStore, uid: string): string[] {
  return readBook(store)[uid]?.backed ?? [];
}

export function rememberSynced(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  const book = readBook(store);
  const current = book[uid] ?? { window: [], backed: [] };
  const window = [...new Set([...current.window, ...ids])];
  book[uid] = {
    window,
    backed: [...new Set([...current.backed, ...window])],
  };
  writeBook(store, book);
}

function retainSynced(store: KeyValueStore, ids: readonly string[], uid: string) {
  const book = readBook(store);
  const current = book[uid] ?? { window: [], backed: [] };
  const window = [...new Set(ids)];
  book[uid] = {
    window,
    backed: [...new Set([...current.backed, ...window])],
  };
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
  pull?: (token: string) => Promise<readonly T[]>;
  deletedIds?: readonly string[];
}): Promise<T[]> {
  if (!optedIn(input.store, input.uid)) return [];
  const deleted = new Set(input.deletedIds ?? []);
  const remote = input.pull ? await input.pull(input.token) : [];
  const windowed = input.pull
    ? mergeBackupWindow(input.entries, remote, deleted, input.now)
    : entriesForBackup(input.entries, input.now);
  const localIds = new Set(input.entries.map((entry) => entry.id));
  const remoteIds = new Set(remote.map((entry) => entry.id));
  const omitted = syncedIdsFor(input.store, input.uid).filter((id) => {
    if (deleted.has(id) || localIds.has(id) || remoteIds.has(id)) return false;
    // A completed pull is the cloud window. An id on neither side is already gone.
    return !input.pull;
  });
  // A list from before the pull is missing account rows and is not a delete.
  // An entry still on this device but older than the backup window is not missing.
  if (omitted.length > 0) return [];
  await input.put(input.token, windowed);
  retainSynced(
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

// Confirm a recent sign-in, then cloud delete, then local wipe of every id
// this device backed up, then the auth user. Without a backup API the sign-in
// stays, because cloud copies could not be removed.
export async function deleteSignedInAccount(input: {
  uid: string;
  token: string;
  api: { deleteAccount(token: string): Promise<void> } | null;
  removeLocal: (ids: string[]) => Promise<void>;
  deleteAuth: () => Promise<void>;
  confirmRecentLogin?: () => Promise<void>;
  store: KeyValueStore;
}): Promise<void> {
  if (!input.api) {
    const missing = new Error("no-api");
    Object.defineProperty(missing, "code", { value: "no-api" });
    throw tagDeleteError(missing, "api");
  }
  try {
    await input.confirmRecentLogin?.();
  } catch (error) {
    throw tagDeleteError(error, "auth");
  }
  const ids = backedIdsFor(input.store, input.uid);
  try {
    await input.api.deleteAccount(input.token);
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    const code = (error as { code?: unknown } | null)?.code;
    if (!(status === 404 && code === "not_found")) throw tagDeleteError(error, "api");
  }
  try {
    await input.removeLocal(ids);
  } catch (error) {
    throw tagDeleteError(error, "local");
  }
  try {
    await input.deleteAuth();
  } catch (error) {
    const partial = tagDeleteError(error, "auth");
    if (partial && typeof partial === "object") {
      try {
        Object.defineProperty(partial, "code", { value: "delete-partial" });
      } catch {
        // The stage is still auth. The caller keeps the sign-in.
      }
    }
    throw partial;
  }
  clearOptIn(input.store);
  clearSynced(input.store, input.uid);
}
