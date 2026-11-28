import {
  AccountApiError,
  assertSyncEntryLimit,
  isBackupConflict,
  SYNC_UPLOAD_ATTEMPTS,
} from "./api.ts";
import {
  backupClock,
  entriesForBackup,
  idsDeletedOnServer,
  localEditAfterSync,
  mergeBackupWindow,
  syncStampOf,
  type BackupEntry,
  type SyncStamp,
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

type RetiredEntry = {
  backed?: true;
  downloaded?: true;
  window?: true;
  seen?: true;
  note?: string;
  points?: string;
};

interface SyncedAccount {
  window: string[];
  backed: string[];
  removed: string[];
  downloaded: string[];
  edited: Record<string, SyncStamp>;
  retired: Record<string, RetiredEntry>;
}

function emptyAccount(): SyncedAccount {
  return {
    window: [],
    backed: [],
    removed: [],
    downloaded: [],
    edited: {},
    retired: {},
  };
}

function retiredOf(value: unknown): Record<string, RetiredEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const retired: Record<string, RetiredEntry> = {};
  for (const [id, row] of Object.entries(value)) {
    if (!row || typeof row !== "object") continue;
    const source = row as {
      backed?: unknown;
      downloaded?: unknown;
      window?: unknown;
      seen?: unknown;
      note?: unknown;
      points?: unknown;
    };
    const prior: RetiredEntry = {};
    if (source.backed === true) prior.backed = true;
    if (source.downloaded === true) prior.downloaded = true;
    if (source.window === true) prior.window = true;
    if (source.seen === true) prior.seen = true;
    if (typeof source.note === "string" && source.note)
      prior.note = source.note;
    if (typeof source.points === "string" && source.points)
      prior.points = source.points;
    if (prior.backed || prior.downloaded || prior.window || prior.seen)
      retired[id] = prior;
  }
  return retired;
}

function editsOf(value: unknown): Record<string, SyncStamp> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const edited: Record<string, SyncStamp> = {};
  for (const [id, row] of Object.entries(value)) {
    if (!row || typeof row !== "object") continue;
    const note = (row as { note?: unknown }).note;
    const points = (row as { points?: unknown }).points;
    const stamp: SyncStamp = {};
    if (typeof note === "string" && note) stamp.note = note;
    if (typeof points === "string" && points) stamp.points = points;
    if (stamp.note || stamp.points) edited[id] = stamp;
  }
  return edited;
}

function accountOf(value: unknown): SyncedAccount {
  if (Array.isArray(value)) {
    const ids = idsOf(value);
    return {
      window: [...ids],
      backed: [...ids],
      removed: [],
      downloaded: [],
      edited: {},
      retired: {},
    };
  }
  if (!value || typeof value !== "object") return emptyAccount();
  const row = value as {
    window?: unknown;
    backed?: unknown;
    removed?: unknown;
    downloaded?: unknown;
    edited?: unknown;
    retired?: unknown;
  };
  const window = idsOf(row.window);
  return {
    window,
    backed: [...new Set([...idsOf(row.backed), ...window])],
    removed: idsOf(row.removed),
    downloaded: idsOf(row.downloaded),
    edited: editsOf(row.edited),
    retired: retiredOf(row.retired),
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

// Backup turns off before Firebase sign-out so an in-flight upload stops.
// If that sign-out fails, the account is still here, so backup comes back.
export async function signOutAccount(input: {
  store: KeyValueStore;
  uid: string | null;
  signOut: () => Promise<void>;
}): Promise<void> {
  const wasOn = input.uid !== null && optedIn(input.store, input.uid);
  nextBackupEpoch(input.store);
  clearOptIn(input.store);
  try {
    await input.signOut();
  } catch (error) {
    if (input.uid && wasOn) grantOptIn(input.store, input.uid);
    throw error;
  }
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

function releaseSeenEntry(
  store: KeyValueStore,
  uid: string,
  id: string,
): boolean {
  const book = seenBook(store);
  const list = book[uid];
  if (!list?.includes(id)) return false;
  const next = list.filter((item) => item !== id);
  if (next.length === 0) delete book[uid];
  else book[uid] = next;
  store.setItem(SEEN_ENTRIES_KEY, JSON.stringify(book));
  return true;
}

function restoreSeenEntry(store: KeyValueStore, uid: string, id: string) {
  const book = seenBook(store);
  for (const owner of Object.keys(book)) {
    if (owner === uid) continue;
    const list = book[owner]?.filter((item) => item !== id) ?? [];
    if (list.length === 0) delete book[owner];
    else book[owner] = list;
  }
  const list = book[uid] ?? [];
  if (!list.includes(id)) book[uid] = [...list, id];
  store.setItem(SEEN_ENTRIES_KEY, JSON.stringify(book));
}

export function clearSeenEntries(store: KeyValueStore, uid: string) {
  const book = seenBook(store);
  if (!(uid in book)) return;
  delete book[uid];
  store.setItem(SEEN_ENTRIES_KEY, JSON.stringify(book));
}

function otherAccountIds(store: KeyValueStore, uid: string): Set<string> {
  const owned = new Set<string>();
  for (const [account, list] of Object.entries(seenBook(store))) {
    if (account === uid) continue;
    for (const id of list) owned.add(id);
  }
  return owned;
}

export function partitionAccountEntries<T extends { id: string }>(
  entries: readonly T[],
  store: KeyValueStore,
  uid: string,
): { mine: T[]; held: T[] } {
  const other = otherAccountIds(store, uid);
  const mine: T[] = [];
  const held: T[] = [];
  for (const entry of entries) {
    if (other.has(entry.id)) held.push(entry);
    else mine.push(entry);
  }
  return { mine, held };
}

export function withoutOtherAccountEntries<T extends { id: string }>(
  entries: readonly T[],
  store: KeyValueStore,
  uid: string,
): T[] {
  const owned = otherAccountIds(store, uid);
  if (owned.size === 0) return [...entries];
  return entries.filter((entry) => !owned.has(entry.id));
}

export function syncedIdsFor(store: KeyValueStore, uid: string): string[] {
  return readBook(store)[uid]?.window ?? [];
}

// Remote deletes apply to these ids. A local note that is not here was never
// uploaded or downloaded by this account, so a cloud tombstone does not remove it.
export function claimedIdsFor(store: KeyValueStore, uid: string): string[] {
  const account = readBook(store)[uid];
  if (!account) return [];
  return [
    ...new Set([...account.window, ...account.backed, ...account.downloaded]),
  ];
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
    edited: current.edited,
    retired: current.retired,
  };
  writeBook(store, book);
}

export function syncedEditsFor(
  store: KeyValueStore,
  uid: string,
): Record<string, SyncStamp> {
  return readBook(store)[uid]?.edited ?? {};
}

export function rememberSyncedEdits(
  store: KeyValueStore,
  entries: readonly BackupEntry[],
  uid: string,
) {
  if (entries.length === 0) return;
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const edited = { ...current.edited };
  for (const entry of entries) {
    const stamp = syncStampOf(entry);
    if (stamp.note || stamp.points) edited[entry.id] = stamp;
  }
  book[uid] = { ...current, edited };
  writeBook(store, book);
}

function retainSynced(
  store: KeyValueStore,
  entries: readonly BackupEntry[],
  uid: string,
) {
  const book = readBook(store);
  const current = book[uid] ?? emptyAccount();
  const window = [...new Set(entries.map((entry) => entry.id))];
  const edited = { ...current.edited };
  for (const entry of entries) {
    const stamp = syncStampOf(entry);
    if (stamp.note || stamp.points) edited[entry.id] = stamp;
  }
  book[uid] = {
    window,
    backed: [...new Set([...current.backed, ...window])],
    removed: current.removed,
    downloaded: current.downloaded,
    edited,
    retired: current.retired,
  };
  writeBook(store, book);
}

// The user deleted this row. The id may come back from an import, and that
// copy was not backed up. Undo restores the claim for the same row.
export function retireEntry(store: KeyValueStore, uid: string, id: string) {
  const wasSeen = releaseSeenEntry(store, uid, id);
  const book = readBook(store);
  const current = book[uid];
  if (!current) return;
  const inWindow = current.window.includes(id);
  const inBacked = current.backed.includes(id);
  const inDownloaded = current.downloaded.includes(id);
  if (!inWindow && !inBacked && !inDownloaded) {
    // This copy was never claimed. A retirement left by an older copy of the
    // same id must not come back when this delete is undone.
    if (!current.retired[id]) return;
    const retired = { ...current.retired };
    delete retired[id];
    book[uid] = { ...current, retired };
    writeBook(store, book);
    return;
  }
  const stamp = current.edited[id];
  const retired = { ...current.retired };
  retired[id] = {
    ...(inBacked ? { backed: true as const } : {}),
    ...(inDownloaded ? { downloaded: true as const } : {}),
    ...(inWindow ? { window: true as const } : {}),
    ...(wasSeen ? { seen: true as const } : {}),
    ...(stamp?.note ? { note: stamp.note } : {}),
    ...(stamp?.points ? { points: stamp.points } : {}),
  };
  const edited = { ...current.edited };
  delete edited[id];
  book[uid] = {
    ...current,
    window: current.window.filter((item) => item !== id),
    backed: current.backed.filter((item) => item !== id),
    downloaded: current.downloaded.filter((item) => item !== id),
    edited,
    retired,
  };
  writeBook(store, book);
}

export function restoreRetiredEntry(
  store: KeyValueStore,
  uid: string,
  id: string,
) {
  const book = readBook(store);
  const current = book[uid];
  const prior = current?.retired[id];
  if (!current || !prior) return;
  const retired = { ...current.retired };
  delete retired[id];
  const edited = { ...current.edited };
  if (prior.note || prior.points) {
    edited[id] = {
      ...(prior.note ? { note: prior.note } : {}),
      ...(prior.points ? { points: prior.points } : {}),
    };
  }
  if (prior.seen) restoreSeenEntry(store, uid, id);
  book[uid] = {
    ...current,
    window: prior.window
      ? [...new Set([...current.window, id])]
      : current.window,
    backed: prior.backed
      ? [...new Set([...current.backed, id])]
      : current.backed,
    downloaded: prior.downloaded
      ? [...new Set([...current.downloaded, id])]
      : current.downloaded,
    edited,
    retired,
  };
  writeBook(store, book);
}

// A delete can happen after sign-out. The journal stays, and so does every
// account that once backed this id. Drop the claim from each of them, or a
// later account deletion treats the re-import as a backed copy.
export function retireEntryOwners(store: KeyValueStore, id: string) {
  for (const uid of Object.keys(readBook(store))) retireEntry(store, uid, id);
}

export function restoreEntryOwners(store: KeyValueStore, id: string) {
  for (const uid of Object.keys(readBook(store)))
    restoreRetiredEntry(store, uid, id);
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
// Safari Lockdown Mode has no Web Locks. IndexedDB takes that fallback in one
// readwrite transaction, so the record is claimed before another tab can
// replace it. localStorage is the fallback when this realm has no IndexedDB.
// The in-memory queue remains when this realm has no storage at all.
let holdingUpload = 0;
const lockQueues = new Map<string, Promise<unknown>>();
const TAB_LOCK_KEY = "ihurt-tab-locks";
const TAB_LOCK_DB = "ihurt-tab-locks";
const TAB_LOCK_STORE = "locks";
const TAB_LOCK_PAUSE_MS = 20;
const TAB_LOCK_RENEW_MS = 1000;
let lockDbPromise: Promise<IDBDatabase> | null = null;
let lockDbFactory: IDBFactory | null = null;

type TabLock = { id: string; expires: number };

function tabLockStore(): KeyValueStore | null {
  const storage = globalThis.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  )
    return null;
  return storage;
}

function tabLockKey(name: string): string {
  return `${TAB_LOCK_KEY}:${name}`;
}

function readNamedLock(store: KeyValueStore, name: string): TabLock | null {
  try {
    const parsed = JSON.parse(
      store.getItem(tabLockKey(name)) ?? "null",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const id = (parsed as { id?: unknown }).id;
    const expires = (parsed as { expires?: unknown }).expires;
    if (typeof id === "string" && typeof expires === "number")
      return { id, expires };
    return null;
  } catch {
    return null;
  }
}

function writeNamedLock(
  store: KeyValueStore,
  name: string,
  lock: TabLock | null,
) {
  const key = tabLockKey(name);
  if (!lock) {
    store.removeItem(key);
    return;
  }
  store.setItem(key, JSON.stringify(lock));
}

function withLocalLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
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

async function withStorageLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const store = tabLockStore();
  if (!store) return withLocalLock(name, fn);
  const id = crypto.randomUUID();
  // A live request renews this lease, and the request itself can run for
  // longer than a fixed wait. Stay queued until that lease is released or
  // expires. A tab that is gone stops renewing, so the lease runs out.
  for (;;) {
    const current = readNamedLock(store, name);
    if (!current || current.expires <= Date.now()) {
      writeNamedLock(store, name, {
        id,
        expires: Date.now() + UPLOAD_LEASE_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, TAB_LOCK_PAUSE_MS));
      if (readNamedLock(store, name)?.id === id) {
        const renew = () => {
          try {
            if (readNamedLock(store, name)?.id !== id) return;
            writeNamedLock(store, name, {
              id,
              expires: Date.now() + UPLOAD_LEASE_MS,
            });
          } catch {
            // A missed refresh leaves the previous lease. Releasing still
            // happens when the request finishes.
          }
        };
        const renewal = setInterval(renew, TAB_LOCK_RENEW_MS);
        try {
          return await fn();
        } finally {
          clearInterval(renewal);
          if (readNamedLock(store, name)?.id === id)
            writeNamedLock(store, name, null);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_LOCK_PAUSE_MS));
  }
}

function indexedLockAvailable(): boolean {
  const factory = globalThis.indexedDB;
  return Boolean(factory && typeof factory.open === "function");
}

function lockDatabase(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory || typeof factory.open !== "function")
    return Promise.reject(new Error("IndexedDB is unavailable."));
  if (lockDbPromise && lockDbFactory === factory) return lockDbPromise;
  lockDbFactory = factory;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(TAB_LOCK_DB, 1);
    const fail = (error: unknown) => {
      if (lockDbPromise === pending) lockDbPromise = null;
      reject(
        error instanceof Error ? error : new Error("The tab lock failed."),
      );
    };
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(TAB_LOCK_STORE))
        db.createObjectStore(TAB_LOCK_STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => fail(open.error);
    open.onblocked = () => fail(new Error("The tab lock database is blocked."));
  });
  lockDbPromise = pending;
  return pending;
}

function readLockValue(value: unknown): TabLock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  const expires = (value as { expires?: unknown }).expires;
  if (typeof id === "string" && typeof expires === "number")
    return { id, expires };
  return null;
}

// `undefined` leaves the record. `null` deletes it. A lock replaces it.
// The get and the write stay in this transaction, so another tab's
// transaction sees the result only after this one commits.
function updateIndexedLock(
  name: string,
  edit: (current: TabLock | null) => TabLock | null | undefined,
): Promise<TabLock | null> {
  return lockDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        let tx: IDBTransaction;
        try {
          tx = db.transaction(TAB_LOCK_STORE, "readwrite");
        } catch (error) {
          finish(
            error instanceof Error ? error : new Error("The tab lock failed."),
          );
          return;
        }
        const store = tx.objectStore(TAB_LOCK_STORE);
        const get = store.get(name);
        let result: TabLock | null = null;
        get.onerror = () => finish(new Error("Could not read the tab lock."));
        get.onsuccess = () => {
          try {
            const current = readLockValue(get.result);
            const next = edit(current);
            if (next === undefined) {
              result = current;
              return;
            }
            result = next;
            if (next) store.put(next, name);
            else store.delete(name);
          } catch (error) {
            try {
              tx.abort();
            } catch {
              // The transaction is already finishing.
            }
            finish(
              error instanceof Error
                ? error
                : new Error("The tab lock failed."),
            );
          }
        };
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        tx.onabort = () =>
          finish(
            tx.error ?? new Error("The tab lock transaction was aborted."),
          );
        tx.onerror = () =>
          finish(tx.error ?? new Error("The tab lock transaction failed."));
      }),
  );
}

async function claimIndexedLock(name: string, id: string): Promise<boolean> {
  const row = await updateIndexedLock(name, (current) => {
    if (current && current.id !== id && current.expires > Date.now())
      return undefined;
    return { id, expires: Date.now() + UPLOAD_LEASE_MS };
  });
  return row?.id === id;
}

async function withIndexedLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  for (;;) {
    // A failed transaction stays failed. Falling through to localStorage
    // would let this tab enter beside a tab that already holds the lock.
    if (await claimIndexedLock(name, id)) {
      const renewal = setInterval(() => {
        void updateIndexedLock(name, (current) => {
          if (current?.id !== id) return undefined;
          return { id, expires: Date.now() + UPLOAD_LEASE_MS };
        }).catch(() => undefined);
      }, TAB_LOCK_RENEW_MS);
      try {
        return await fn();
      } finally {
        clearInterval(renewal);
        await updateIndexedLock(name, (current) =>
          current?.id === id ? null : undefined,
        ).catch(() => undefined);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_LOCK_PAUSE_MS));
  }
}

function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  // The lock is held until the callback's promise settles. The DOM type omits that.
  if (locks?.request) return locks.request(name, () => fn()) as Promise<T>;
  if (indexedLockAvailable()) return withIndexedLock(name, fn);
  if (tabLockStore()) return withStorageLock(name, fn);
  return withLocalLock(name, fn);
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

function pulledWindow<T extends { id: string }>(
  value:
    | readonly T[]
    | {
        entries: readonly T[];
        deleted?: readonly string[];
        revision?: string;
        stored?: readonly string[];
      },
): {
  entries: readonly T[];
  deleted: readonly string[];
  revision?: string;
  stored?: readonly string[];
  applied: boolean;
} {
  // An array is the caller's snapshot. It has no separate stored list.
  if (Array.isArray(value))
    return { entries: value, deleted: [], revision: undefined, applied: true };
  const window = value as {
    entries: readonly T[];
    deleted?: readonly string[];
    revision?: unknown;
    stored?: unknown;
  };
  const reported = Array.isArray(window.stored)
    ? window.stored.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : undefined;
  return {
    entries: window.entries,
    deleted: (window.deleted ?? []).filter(
      (id) => typeof id === "string" && id,
    ),
    revision:
      typeof window.revision === "string" && window.revision
        ? window.revision
        : undefined,
    applied: reported !== undefined,
    ...(reported !== undefined ? { stored: reported } : {}),
  };
}

export async function pushBackup<T extends BackupEntry>(input: {
  uid: string;
  token: string;
  entries: Snapshot<T>;
  now: number;
  store: KeyValueStore;
  put: (token: string, entries: T[], revision?: string) => Promise<void>;
  pull?: (token: string) => Promise<
    | readonly T[]
    | {
        entries: readonly T[];
        deleted?: readonly string[];
        revision?: string;
        stored?: readonly string[];
      }
  >;
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
    for (let attempt = 0; attempt < SYNC_UPLOAD_ATTEMPTS; attempt++) {
      if (!current()) return [];
      const pulled = input.pull
        ? pulledWindow(await input.pull(input.token))
        : {
            entries: [] as T[],
            deleted: [] as string[],
            revision: undefined,
            applied: false,
          };
      const remote = pulled.entries;
      // A row already claimed by another account stays in the replacement so
      // this upload does not delete that account's cloud copy. It is not
      // merged into this journal and it is not claimed for this account.
      const { mine, held } = partitionAccountEntries(
        remote,
        input.store,
        input.uid,
      );
      const heldIds = new Set(held.map((entry) => entry.id));
      // The pull can store these rows before this check. Sign-out during that
      // write still leaves them on the device, so a reported list stays with
      // this account. A body with no list was not applied. Claiming it would
      // let a later remote delete, or Delete account, remove the local note.
      if (input.pull && (pulled.applied || current())) {
        const accepted = pulled.stored;
        const downloaded =
          accepted === undefined
            ? mine.map((entry) => entry.id)
            : mine
                .map((entry) => entry.id)
                .filter((id) => accepted.includes(id));
        // A row the notebook rejected is not this account's. Recording it
        // would hide a later re-import from the next account.
        rememberSeenEntries(input.store, input.uid, downloaded);
        rememberDownloaded(input.store, downloaded, input.uid);
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
      const serverDeleted = new Set(pulled.deleted);
      const edits = syncedEditsFor(input.store, input.uid);
      // A pull that returns the id, or a local row whose tombstone is gone, is a
      // restore. An id the server still names in `deleted` stays deleted unless
      // this device saved a newer note or pin list after the last upload.
      const revived = priorRemoved.filter((id) => {
        const entry = entries.find((row) => row.id === id);
        if (entry && localEditAfterSync(entry, edits[id], input.now))
          return true;
        if (serverDeleted.has(id)) return false;
        return pulledIds.has(id) || (entry !== undefined && !deleted.has(id));
      });
      releaseRemoteDeletes(input.store, revived, input.uid);
      const alreadyRemoved = new Set(priorRemoved);
      // An empty 200 is not a generation. A note missing from that list is not
      // a delete either: the other device may have uploaded an older snapshot.
      // Only an id named in `deleted` is removed. The clock follows the newest
      // stamp in the pull, so a slow device does not treat an aged-out note as
      // one the server deleted.
      const clock = backupClock(input.now, remote);
      const remoteGone = input.pull
        ? idsDeletedOnServer(
            claimedIdsFor(input.store, input.uid),
            entries,
            pulled.deleted,
            deleted,
            clock,
            undefined,
            edits,
          ).filter((id) => !alreadyRemoved.has(id))
        : [];
      // Leave these ids out of the replacement. The local row stays until
      // that upload is accepted, so a conflict can still copy pin comments
      // and the other device-only fields from it.
      const drop = [
        ...new Set([...removedIdsFor(input.store, input.uid), ...remoteGone]),
      ].filter((id) => entries.some((entry) => entry.id === id));
      for (const id of drop) deleted.add(id);
      if (!current()) return [];
      const windowed = input.pull
        ? [...mergeBackupWindow(entries, mine, deleted, clock), ...held]
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
      assertSyncEntryLimit(windowed.length);
      const upload = await claimUpload(input.store, input.uid);
      try {
        if (!current()) return [];
        try {
          await input.put(input.token, windowed, pulled.revision);
        } catch (error) {
          // Backup was turned off, or sign-out started, after this request
          // was sent. The caller aborts it. Do not keep the rows as synced.
          if (!current()) return [];
          // The other device wrote this snapshot first. Pull that list and
          // merge again. The rejected body is not the cloud copy.
          if (isBackupConflict(error) && attempt + 1 < SYNC_UPLOAD_ATTEMPTS)
            continue;
          throw error;
        }
        if (drop.length > 0 && input.forget) {
          await input.forget(drop);
          // The local row is gone. Drop this account's claim too, or a later
          // re-import is removed when the account is deleted. The server
          // tombstone in `removed` stays.
          rememberRemoteDeletes(input.store, remoteGone, input.uid);
          for (const id of drop) retireEntry(input.store, input.uid, id);
        } else rememberRemoteDeletes(input.store, remoteGone, input.uid);
        // The user can delete this entry while the PUT is still sending.
        // That retirement already ran. This success must not put the id
        // back on the backup list or the seen list.
        const deletedNow = new Set(await snapshotOf(input.deletedIds));
        const retiredNow = new Set(
          Object.keys(readBook(input.store)[input.uid]?.retired ?? {}),
        );
        const claimed = windowed.filter(
          (entry) =>
            !heldIds.has(entry.id) &&
            !deletedNow.has(entry.id) &&
            !retiredNow.has(entry.id),
        );
        rememberSeenEntries(
          input.store,
          input.uid,
          claimed.map((entry) => entry.id),
        );
        retainSynced(input.store, claimed, input.uid);
        return windowed;
      } finally {
        await releaseUpload(input.store, input.uid, upload);
      }
    }
    throw new AccountApiError(409, "conflict");
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
  sessionUid?: () => string | null;
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
    clearSynced(input.store, input.uid);
    clearSeenEntries(input.store, input.uid);
    // The Firebase user is gone. A null session is this sign-out. Another
    // account already signed in keeps its backup flag, which is global.
    const nextUid = input.sessionUid?.() ?? null;
    if (nextUid && nextUid !== input.uid) return;
    clearOptIn(input.store);
  } finally {
    await clearAccountDeleting(input.store, input.uid, deletionId);
  }
}
