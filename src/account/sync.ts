import {
  backupClock,
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
const UPLOADS_KEY = "ihurt-backup-uploads";
const UPLOAD_LOCK = UPLOADS_KEY;
const DELETING_KEY = "ihurt-account-deleting";
const UPLOAD_LEASE_MS = 2 * 60 * 1000;

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

// Another tab writes these keys. A storage event for anything else is not a
// backup change. A cleared store has no signed-in backup.
export function backupOptInFromStorage(
  uid: string | null,
  store: KeyValueStore,
  key: string | null,
): boolean | null {
  if (key !== null && key !== OPT_IN_KEY && key !== OPT_IN_UID_KEY) return null;
  return uid !== null && optedIn(store, uid);
}

export function grantOptIn(store: KeyValueStore, uid: string) {
  store.setItem(OPT_IN_KEY, "1");
  store.setItem(OPT_IN_UID_KEY, uid);
}

export function clearOptIn(store: KeyValueStore) {
  store.removeItem(OPT_IN_KEY);
  store.removeItem(OPT_IN_UID_KEY);
}

type DeletingBook = Record<string, Record<string, number>>;

function readDeleting(store: KeyValueStore): DeletingBook {
  try {
    const parsed = JSON.parse(store.getItem(DELETING_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const book: DeletingBook = {};
    for (const [uid, row] of Object.entries(parsed)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const claims: Record<string, number> = {};
      for (const [id, stamp] of Object.entries(row)) {
        if (typeof stamp === "number" && Number.isFinite(stamp))
          claims[id] = stamp;
      }
      if (Object.keys(claims).length > 0) book[uid] = claims;
    }
    return book;
  } catch {
    return {};
  }
}

function writeDeleting(store: KeyValueStore, book: DeletingBook) {
  if (Object.keys(book).length === 0) {
    store.removeItem(DELETING_KEY);
    return;
  }
  store.setItem(DELETING_KEY, JSON.stringify(book));
}

export function accountDeleting(store: KeyValueStore, uid: string): boolean {
  return Object.keys(readDeleting(store)[uid] ?? {}).length > 0;
}

// Each deletion owns one token. Two tabs can delete the same account, and the
// one that fails removes only its token. The other token stays, so a save
// cannot upload while that delete is still running. A tab that closes during
// delete leaves its token, and backup stays off.
const DELETE_LOCK = "ihurt-account-deleting-lock";

async function markAccountDeleting(
  store: KeyValueStore,
  uid: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await withCrossTabLock(DELETE_LOCK, async () => {
    const book = readDeleting(store);
    const claims = book[uid] ?? {};
    claims[id] = Date.now();
    book[uid] = claims;
    writeDeleting(store, book);
  });
  return id;
}

async function clearAccountDeleting(
  store: KeyValueStore,
  uid: string,
  id: string,
) {
  await withCrossTabLock(DELETE_LOCK, async () => {
    const book = readDeleting(store);
    const claims = book[uid];
    if (!claims?.[id]) return;
    delete claims[id];
    if (Object.keys(claims).length === 0) delete book[uid];
    writeDeleting(store, book);
  });
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

type UploadBook = Record<string, Record<string, number>>;

function readUploads(store: KeyValueStore): UploadBook {
  try {
    const parsed = JSON.parse(store.getItem(UPLOADS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const book: UploadBook = {};
    for (const [uid, row] of Object.entries(parsed)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const claims: Record<string, number> = {};
      for (const [id, stamp] of Object.entries(row)) {
        if (typeof stamp === "number" && Number.isFinite(stamp))
          claims[id] = stamp;
      }
      if (Object.keys(claims).length > 0) book[uid] = claims;
    }
    return book;
  } catch {
    return {};
  }
}

function writeUploads(store: KeyValueStore, book: UploadBook) {
  if (Object.keys(book).length === 0) {
    store.removeItem(UPLOADS_KEY);
    return;
  }
  store.setItem(UPLOADS_KEY, JSON.stringify(book));
}

function liveClaims(claims: Record<string, number> | undefined, now: number) {
  const live: Record<string, number> = {};
  for (const [id, stamp] of Object.entries(claims ?? {})) {
    if (now - stamp < UPLOAD_LEASE_MS) live[id] = stamp;
  }
  return live;
}

// One cross-tab lock for the upload book and the PUT it belongs to. Two tabs
// can otherwise read the same book and each overwrite the other's claim.
// Holding the lock until the request finishes also keeps deletion from treating
// a slow PUT as done when its timestamp passes the lease: a closed document
// drops the lock, and a request that is still running does not.
let holdingUpload = 0;
const lockQueues = new Map<string, Promise<unknown>>();

function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  // The lock is held until the callback's promise settles. The DOM type omits that.
  if (locks) return locks.request(name, () => fn()) as Promise<T>;
  const previous = lockQueues.get(name) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  lockQueues.set(
    name,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export function withUploadLock<T>(fn: () => Promise<T>): Promise<T> {
  return withCrossTabLock(UPLOAD_LOCK, async () => {
    holdingUpload += 1;
    try {
      return await fn();
    } finally {
      holdingUpload -= 1;
    }
  });
}

function writeClaim(store: KeyValueStore, uid: string): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const book = readUploads(store);
    const row = liveClaims(book[uid], now);
    row[id] = now;
    book[uid] = row;
    writeUploads(store, book);
    if (readUploads(store)[uid]?.[id] === now) return id;
  }
  return id;
}

function clearClaim(store: KeyValueStore, uid: string, id: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const book = readUploads(store);
    const row = book[uid];
    if (!row?.[id]) return;
    delete row[id];
    if (Object.keys(row).length === 0) delete book[uid];
    writeUploads(store, book);
    if (!readUploads(store)[uid]?.[id]) return;
  }
}

export async function claimUpload(
  store: KeyValueStore,
  uid: string,
): Promise<string> {
  if (holdingUpload > 0) return writeClaim(store, uid);
  let id = "";
  await withUploadLock(async () => {
    id = writeClaim(store, uid);
  });
  return id;
}

export async function releaseUpload(
  store: KeyValueStore,
  uid: string,
  id: string,
): Promise<void> {
  if (holdingUpload > 0) {
    clearClaim(store, uid, id);
    return;
  }
  await withUploadLock(async () => {
    clearClaim(store, uid, id);
  });
}

// Another tab can already be waiting on its PUT. Deletion takes the same lock
// that request holds, so it runs only after the request and its bookkeeping
// finish. A claim left behind belongs to a document that is already gone.
export function waitForAccountUploads(
  store: KeyValueStore,
  uid: string,
): Promise<void> {
  return withUploadLock(async () => {
    const book = readUploads(store);
    if (!book[uid]) return;
    delete book[uid];
    writeUploads(store, book);
  });
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
  const current = () =>
    optedIn(input.store, input.uid) &&
    sameEpoch() &&
    !accountDeleting(input.store, input.uid);
  if (!current()) return [];
  // Another tab can save while this one is still reading. The pull, the
  // delete check, and the PUT stay in one lock, so the later PUT includes
  // the entry the earlier tab already uploaded.
  return withUploadLock(async () => {
    if (!current()) return [];
    const remote = input.pull ? await input.pull(input.token) : [];
    // The pull can store these rows before this check. Sign-out during that
    // write still leaves them on the device, so they stay with this account.
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
    if (!current()) return [];
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
    // An empty 200 is not a generation. It must not delete every synced note
    // and then upload the list without them. A pull that names other notes
    // can still show a delete. The clock follows the newest stamp in that
    // pull, so a slow device does not treat a note the server aged out as one.
    const clock = backupClock(input.now, remote);
    const remoteGone =
      input.pull && remote.length > 0
        ? idsDeletedOnServer(
            syncedIdsFor(input.store, input.uid),
            entries,
            remote,
            deleted,
            clock,
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
      ? mergeBackupWindow(entries, remote, deleted, clock)
      : entriesForBackup(entries, input.now);
    const localIds = new Set(entries.map((entry) => entry.id));
    const remoteIds = new Set(remote.map((entry) => entry.id));
    const omitted = syncedIdsFor(input.store, input.uid).filter((id) => {
      if (deleted.has(id) || localIds.has(id) || remoteIds.has(id))
        return false;
      // A completed pull is the cloud window. An id on neither side is already gone.
      return !input.pull;
    });
    // A list from before the pull is missing account rows and is not a delete.
    // An entry still on this device but older than the backup window is not missing.
    if (omitted.length > 0) return [];
    if (!current()) return [];
    const upload = await claimUpload(input.store, input.uid);
    try {
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
    } finally {
      await releaseUpload(input.store, input.uid, upload);
    }
  });
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
  const deletionId = await markAccountDeleting(input.store, input.uid);
  try {
    try {
      await input.settleUploads?.();
      await waitForAccountUploads(input.store, input.uid);
      if (input.sameAccount?.() === false) throw cancelledDelete();
      const token =
        typeof input.token === "function" ? await input.token() : input.token;
      if (input.sameAccount?.() === false) throw cancelledDelete();
      await input.api.deleteAccount(token);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "cancelled")
        throw error;
      const status = (error as { status?: unknown } | null)?.status;
      const code = (error as { code?: unknown } | null)?.code;
      if (!(status === 404 && code === "not_found"))
        throw tagDeleteError(error, "api");
    }
    // The cloud account is gone. Stop this account's backup before the session
    // check, so a tab that already switched cannot leave the flag on. Keep the
    // synced ids so a retry can still remove the sign-in.
    if (optedIn(input.store, input.uid)) clearOptIn(input.store);
    nextBackupEpoch(input.store);
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
  } finally {
    await clearAccountDeleting(input.store, input.uid, deletionId);
  }
}
