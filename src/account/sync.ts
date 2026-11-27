import {
  entriesForBackup,
  idsDeletedOnServer,
  mergeBackupWindow,
  type BackupEntry,
} from "./backup.ts";

export const OPT_IN_KEY = "ihurt-sync-opt-in";
export const OPT_IN_UID_KEY = "ihurt-sync-uid";
export const SYNCED_IDS_KEY = "ihurt-synced-ids";
export const SYNCED_UID_KEY = "ihurt-synced-uid";
const BACKUP_EPOCH_KEY = "ihurt-backup-epoch";
const SEEN_ENTRIES_KEY = "ihurt-seen-entries";

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
  removed: string[];
  downloaded: string[];
}

function emptyAccount(): SyncedAccount {
  return { window: [], backed: [], removed: [], downloaded: [] };
}

function accountOf(value: unknown): SyncedAccount {
  if (Array.isArray(value)) {
    const ids = idsOf(value);
    return { window: [...ids], backed: [...ids], removed: [], downloaded: [] };
  }
  if (!value || typeof value !== "object") return emptyAccount();
  const row = value as {
    window?: unknown;
    backed?: unknown;
    removed?: unknown;
    downloaded?: unknown;
  };
  const window = idsOf(row.window);
  return {
    window,
    backed: [...new Set([...idsOf(row.backed), ...window])],
    removed: idsOf(row.removed),
    downloaded: idsOf(row.downloaded),
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
  return [
    ...new Set(Object.values(readBook(store)).flatMap((row) => row.window)),
  ];
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

export function backupEpoch(store: KeyValueStore): number {
  const value = Number(store.getItem(BACKUP_EPOCH_KEY));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function nextBackupEpoch(store: KeyValueStore): number {
  const next = backupEpoch(store) + 1;
  store.setItem(BACKUP_EPOCH_KEY, String(next));
  return next;
}

function seenBook(store: KeyValueStore): Record<string, string[]> {
  try {
    const parsed = JSON.parse(
      store.getItem(SEEN_ENTRIES_KEY) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const book: Record<string, string[]> = {};
    for (const [uid, ids] of Object.entries(parsed)) {
      if (!Array.isArray(ids)) continue;
      book[uid] = ids.filter((id): id is string => typeof id === "string");
    }
    return book;
  } catch {
    return {};
  }
}

// A downloaded row is claimed when the pull succeeds. A local row is claimed
// only after its upload succeeds. A later account can still see either one,
// and does not upload it.
export function rememberSeenEntries(
  store: KeyValueStore,
  uid: string,
  ids: readonly string[],
) {
  const book = seenBook(store);
  const owned = new Set<string>();
  for (const [account, list] of Object.entries(book)) {
    if (account !== uid) for (const id of list) owned.add(id);
  }
  const mine = new Set(book[uid] ?? []);
  let changed = false;
  for (const id of ids) {
    if (owned.has(id) || mine.has(id)) continue;
    mine.add(id);
    changed = true;
  }
  if (!changed) return;
  book[uid] = [...mine];
  store.setItem(SEEN_ENTRIES_KEY, JSON.stringify(book));
}

export function clearSeenEntries(store: KeyValueStore, uid: string) {
  const book = seenBook(store);
  if (!(uid in book)) return;
  delete book[uid];
  store.setItem(SEEN_ENTRIES_KEY, JSON.stringify(book));
}

export function withoutOtherAccountEntries<T extends { id: string }>(
  entries: readonly T[],
  store: KeyValueStore,
  uid: string,
): T[] {
  const owned = new Set<string>();
  for (const [account, list] of Object.entries(seenBook(store))) {
    if (account === uid) continue;
    for (const id of list) owned.add(id);
  }
  if (owned.size === 0) return [...entries];
  return entries.filter((entry) => !owned.has(entry.id));
}

export function syncedIdsFor(store: KeyValueStore, uid: string): string[] {
  return readBook(store)[uid]?.window ?? [];
}

export function backedIdsFor(store: KeyValueStore, uid: string): string[] {
  return readBook(store)[uid]?.backed ?? [];
}

export function downloadedIdsFor(store: KeyValueStore, uid: string): string[] {
  return readBook(store)[uid]?.downloaded ?? [];
}

// A pull can store a cloud row before the replacement upload finishes.
// Account deletion has to remove that row even though it was never uploaded.
export function rememberDownloaded(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  if (ids.length === 0) return;
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const downloaded = [...new Set([...current.downloaded, ...ids])];
  if (downloaded.length === current.downloaded.length) return;
  book[uid] = { ...current, downloaded };
  writeBook(store, book);
}

export function removedIdsFor(store: KeyValueStore, uid: string): string[] {
  return readBook(store)[uid]?.removed ?? [];
}

export function rememberRemoteDeletes(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  if (ids.length === 0) return;
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const removed = [...new Set([...current.removed, ...ids])];
  if (removed.length === current.removed.length) return;
  book[uid] = { ...current, removed };
  writeBook(store, book);
}

// The id was deleted on another device, then a later pull or a local undo
// brought it back. The marker must not delete that restore.
export function releaseRemoteDeletes(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  if (ids.length === 0) return;
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const drop = new Set(ids);
  const removed = current.removed.filter((id) => !drop.has(id));
  if (removed.length === current.removed.length) return;
  book[uid] = { ...current, removed };
  writeBook(store, book);
}

export function rememberSynced(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const window = [...new Set([...current.window, ...ids])];
  book[uid] = {
    window,
    backed: [...new Set([...current.backed, ...window])],
    removed: current.removed,
    downloaded: current.downloaded,
  };
  writeBook(store, book);
}

function retainSynced(
  store: KeyValueStore,
  ids: readonly string[],
  uid: string,
) {
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const window = [...new Set(ids)];
  book[uid] = {
    window,
    backed: [...new Set([...current.backed, ...window])],
    removed: current.removed,
    downloaded: current.downloaded,
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

type Snapshot<T> = readonly T[] | (() => readonly T[] | Promise<readonly T[]>);

async function snapshotOf<T>(
  value: Snapshot<T> | undefined,
): Promise<readonly T[]> {
  if (typeof value === "function") return await value();
  return value ?? [];
}

export async function pushBackup<T extends BackupEntry>(input: {
  uid: string;
  token: string;
  entries: Snapshot<T>;
  now: number;
  store: KeyValueStore;
  put: (token: string, entries: T[]) => Promise<void>;
  pull?: (token: string) => Promise<readonly T[]>;
  deletedIds?: Snapshot<string>;
  epoch?: number;
  forget?: (ids: string[]) => Promise<void>;
}): Promise<T[]> {
  const sameEpoch = () =>
    input.epoch === undefined || backupEpoch(input.store) === input.epoch;
  const current = () => optedIn(input.store, input.uid) && sameEpoch();
  if (!current()) return [];
  const remote = input.pull ? await input.pull(input.token) : [];
  if (!current()) return [];
  if (input.pull) {
    rememberSeenEntries(
      input.store,
      input.uid,
      remote.map((entry) => entry.id),
    );
    rememberDownloaded(
      input.store,
      remote.map((entry) => entry.id),
      input.uid,
    );
  }
  // The list and the tombstones passed in may be from before this pull.
  // Read them again so a delete during the fetch is not uploaded.
  const entries = withoutOtherAccountEntries(
    await snapshotOf(input.entries),
    input.store,
    input.uid,
  );
  const deleted = new Set(await snapshotOf(input.deletedIds));
  if (!current()) return [];
  const priorRemoved = removedIdsFor(input.store, input.uid);
  const pulledIds = new Set(remote.map((entry) => entry.id));
  // A pull that returns the id, or a local row whose tombstone is gone, is a
  // restore. An id still tombstoned stays deleted.
  const revived = priorRemoved.filter(
    (id) =>
      pulledIds.has(id) ||
      (entries.some((entry) => entry.id === id) && !deleted.has(id)),
  );
  releaseRemoteDeletes(input.store, revived, input.uid);
  const alreadyRemoved = new Set(priorRemoved);
  const remoteGone = input.pull
    ? idsDeletedOnServer(
        syncedIdsFor(input.store, input.uid),
        entries,
        remote,
        deleted,
        input.now,
      ).filter((id) => !alreadyRemoved.has(id))
    : [];
  rememberRemoteDeletes(input.store, remoteGone, input.uid);
  const drop = [
    ...new Set([...removedIdsFor(input.store, input.uid), ...remoteGone]),
  ].filter((id) => entries.some((entry) => entry.id === id));
  for (const id of drop) deleted.add(id);
  if (drop.length > 0) await input.forget?.(drop);
  if (!current()) return [];
  const windowed = input.pull
    ? mergeBackupWindow(entries, remote, deleted, input.now)
    : entriesForBackup(entries, input.now);
  const localIds = new Set(entries.map((entry) => entry.id));
  const remoteIds = new Set(remote.map((entry) => entry.id));
  const omitted = syncedIdsFor(input.store, input.uid).filter((id) => {
    if (deleted.has(id) || localIds.has(id) || remoteIds.has(id)) return false;
    // A completed pull is the cloud window. An id on neither side is already gone.
    return !input.pull;
  });
  // A list from before the pull is missing account rows and is not a delete.
  // An entry still on this device but older than the backup window is not missing.
  if (omitted.length > 0) return [];
  if (!current()) return [];
  await input.put(input.token, windowed);
  rememberSeenEntries(
    input.store,
    input.uid,
    windowed.map((entry) => entry.id),
  );
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
  return stage === "api" || stage === "local" || stage === "auth"
    ? stage
    : null;
}

// A failed delete keeps the sign-in. The cloud account, the local wipe, or the
// Firebase user may still need another attempt, including after a 404.
export function accountDeleteKeepsDevice(_error: unknown): boolean {
  return true;
}

function cancelledDelete(): Error {
  const error = new Error("cancelled");
  Object.defineProperty(error, "code", { value: "cancelled" });
  return error;
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
  token: string | (() => Promise<string>);
  api: { deleteAccount(token: string): Promise<void> } | null;
  removeLocal: (ids: string[]) => Promise<void>;
  deleteAuth: () => Promise<void>;
  confirmRecentLogin?: () => Promise<void>;
  settleUploads?: () => Promise<void>;
  sameAccount?: () => boolean;
  store: KeyValueStore;
}): Promise<void> {
  if (!input.api) {
    const missing = new Error("no-api");
    Object.defineProperty(missing, "code", { value: "no-api" });
    throw tagDeleteError(missing, "api");
  }
  try {
    await input.confirmRecentLogin?.();
    if (input.sameAccount?.() === false) throw cancelledDelete();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "cancelled") throw error;
    throw tagDeleteError(error, "auth");
  }
  try {
    await input.settleUploads?.();
    if (input.sameAccount?.() === false) throw cancelledDelete();
    const token =
      typeof input.token === "function" ? await input.token() : input.token;
    if (input.sameAccount?.() === false) throw cancelledDelete();
    await input.api.deleteAccount(token);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "cancelled") throw error;
    const status = (error as { status?: unknown } | null)?.status;
    const code = (error as { code?: unknown } | null)?.code;
    if (!(status === 404 && code === "not_found"))
      throw tagDeleteError(error, "api");
  }
  if (input.sameAccount?.() === false) throw cancelledDelete();
  const ids = [
    ...new Set([
      ...backedIdsFor(input.store, input.uid),
      ...downloadedIdsFor(input.store, input.uid),
    ]),
  ];
  try {
    await input.removeLocal(ids);
  } catch (error) {
    throw tagDeleteError(error, "local");
  }
  if (input.sameAccount?.() === false) throw cancelledDelete();
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
  clearSeenEntries(input.store, input.uid);
}
