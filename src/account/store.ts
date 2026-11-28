import {
  createAccountApi,
  AccountApiError,
  assertSyncEntryLimit,
  isBackupConflict,
  SYNC_UPLOAD_ATTEMPTS,
  type AccountApi,
} from "./api.ts";
import { createAnalytics, type AccountAnalytics } from "./analytics.ts";
import {
  AccountAuthError,
  readTestRuntime,
  type AccountSession,
  type AuthClient,
  type SignInProvider,
} from "./auth.ts";
import type { SavedMap } from "../types.ts";
import { readBackupSnapshot, readDeletedIds } from "../notebook-storage.ts";
import {
  BACKUP_DAYS,
  backupClock,
  backupEnableDecision,
  entriesForBackup,
  idsDeletedOnServer,
  mergeBackupWindow,
  remoteDeletesStillPending,
  type BackupEntry,
} from "./backup.ts";
import {
  readAccountConfig,
  testRuntimeAllowed,
  type AccountConfig,
} from "./config.ts";
import {
  accountDeleting,
  backupEpoch,
  backupOptInFromStorage,
  claimUpload,
  clearOptIn,
  deleteSignedInAccount,
  grantOptIn,
  nextBackupEpoch,
  optedIn,
  partitionAccountEntries,
  pushBackup,
  releaseRemoteDeletes,
  releaseUpload,
  rememberRemoteDeletes,
  removedIdsFor,
  rememberDownloaded,
  rememberSeenEntries,
  rememberSynced,
  syncedIdsFor,
  withUploadLock,
  withoutOtherAccountEntries,
  type KeyValueStore,
} from "./sync.ts";

export interface AccountSnapshot {
  status: "loading" | "ready" | "unconfigured";
  session: AccountSession | null;
  optedIn: boolean;
  remaining: number | null;
  canBackup: boolean;
  upgrade: boolean;
  notice: string;
  error: string;
  busy: boolean;
  config: AccountConfig | null;
}

const EMPTY: AccountSnapshot = {
  status: "loading",
  session: null,
  optedIn: false,
  remaining: null,
  canBackup: false,
  upgrade: false,
  notice: "",
  error: "",
  busy: false,
  config: null,
};

let state: AccountSnapshot = EMPTY;
let client: AuthClient | null = null;
let api: AccountApi | null = null;
let analytics: AccountAnalytics = createAnalytics("");
const listeners = new Set<() => void>();
let started = false;
let pushChain: Promise<void> = Promise.resolve();
let latestEntries: readonly BackupEntry[] = [];
let latestDeleted: readonly string[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function setState(next: AccountSnapshot) {
  state = next;
  emit();
}

export function subscribeAccount(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccountSnapshot() {
  return state;
}

function browserStore(): KeyValueStore {
  return localStorage;
}

// A token refresh for the same account keeps the search count. A different
// account starts blank, including when that account's status request fails.
export function remainingForSession(
  previousUid: string | null,
  previousRemaining: number | null,
  nextUid: string | null,
): number | null {
  if (nextUid === null || nextUid !== previousUid) return null;
  return previousRemaining;
}

function applySession(session: AccountSession | null) {
  setState({
    ...state,
    status: "ready",
    session,
    optedIn: session ? optedIn(browserStore(), session.uid) : false,
    remaining: remainingForSession(
      state.session?.uid ?? null,
      state.remaining,
      session?.uid ?? null,
    ),
    busy: false,
  });
  if (session && api) void refreshAccount();
}

function wire(auth: AuthClient, apiBase: string, analyticsEndpoint: string) {
  client = auth;
  api = createAccountApi(apiBase);
  analytics = createAnalytics(analyticsEndpoint);
  auth.onChange(applySession);
  setState({ ...state, status: "ready", canBackup: api !== null });
}

export function startAccount() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("storage", (event) => {
    const next = backupOptInFromStorage(
      state.session?.uid ?? null,
      browserStore(),
      event.key,
    );
    if (next === null || next === state.optedIn) return;
    setState({ ...state, optedIn: next });
  });
  if (testRuntimeAllowed(location.hostname, location.protocol)) {
    Object.assign(globalThis, { __IHURT_GUARD_SEARCH__: guardSourceSearch });
  }
  const runtime = readTestRuntime();
  if (runtime) {
    wire(runtime.auth, runtime.apiBase ?? "", runtime.analyticsEndpoint ?? "");
    return;
  }
  const config = readAccountConfig(import.meta.env, location.protocol);
  if (!config.firebase) {
    setState({ ...state, status: "unconfigured", config });
    return;
  }
  setState({ ...state, status: "loading", config });
  void import("./firebase-auth.ts")
    .then(({ createFirebaseAuth }) => createFirebaseAuth(config.firebase!))
    .then((auth) => {
      wire(auth, config.apiBase, config.analyticsEndpoint);
    })
    .catch(() => {
      setState({
        ...state,
        status: "unconfigured",
        config,
        error: "unconfigured",
      });
    });
}

export async function refreshAccount() {
  const session = state.session;
  if (!session || !api) return;
  try {
    const status = await api.getAccount(await session.getIdToken());
    if (state.session?.uid !== session.uid) return;
    setState({ ...state, remaining: status.searchesRemaining });
  } catch {
    // The account service can be down. Sign-in and the journal stay usable.
  }
}

export async function signIn(
  method: Exclude<SignInProvider, "unknown">,
  email?: string,
) {
  if (!client) throw new AccountAuthError("unconfigured");
  setState({ ...state, busy: true, error: "", notice: "" });
  try {
    const result = await client.signIn(method, email);
    if (result === "email-sent") {
      setState({ ...state, busy: false, notice: "email-sent" });
      return;
    }
    if (result === "redirect") {
      setState({ ...state, busy: false });
      return;
    }
    analytics.record("sign_in");
    setState({ ...state, busy: false, error: "" });
  } catch (error) {
    const code = error instanceof AccountAuthError ? error.code : "error";
    setState({
      ...state,
      busy: false,
      error: code === "cancelled" ? "" : code,
    });
    if (code !== "cancelled") throw error;
  }
}

export async function signOut() {
  nextBackupEpoch(browserStore());
  clearOptIn(browserStore());
  if (!client) return;
  await client.signOut();
  analytics.record("sign_out");
  setState({
    ...state,
    session: null,
    optedIn: false,
    remaining: null,
    notice: "",
    error: "",
  });
}

export async function enableBackup(
  confirmedIds: readonly string[],
  onMerge: (entries: SavedMap[]) => Promise<readonly BackupEntry[] | void>,
  onRemove?: (ids: string[]) => Promise<void>,
): Promise<
  { status: "refresh"; ids: readonly string[] } | { status: "limited" } | void
> {
  const session = state.session;
  if (!session || !client) throw new AccountAuthError("unconfigured");
  if (!api) throw new AccountAuthError("no-api");
  const epoch = backupEpoch(browserStore());
  setState({ ...state, busy: true, error: "" });
  try {
    const token = await session.getIdToken();
    await api.enableSync(token);
    for (let attempt = 0; attempt < SYNC_UPLOAD_ATTEMPTS; attempt++) {
      const sync = await api.getEntries(token);
      const remote = sync.entries;
      if (
        state.session?.uid !== session.uid ||
        backupEpoch(browserStore()) !== epoch ||
        accountDeleting(browserStore(), session.uid)
      ) {
        setState({ ...state, busy: false });
        return;
      }
      const revived = removedIdsFor(browserStore(), session.uid).filter((id) =>
        remote.some((entry) => entry.id === id),
      );
      // The account marker can go. A user delete made while this pull was
      // running stays in the notebook tombstone list.
      if (revived.length > 0)
        releaseRemoteDeletes(browserStore(), revived, session.uid);
      if (
        state.session?.uid !== session.uid ||
        backupEpoch(browserStore()) !== epoch ||
        accountDeleting(browserStore(), session.uid)
      ) {
        setState({ ...state, busy: false });
        return;
      }
      try {
        return await withUploadLock(async () => {
          if (!api) {
            setState({ ...state, busy: false, error: "no-api" });
            return;
          }
          if (
            state.session?.uid !== session.uid ||
            backupEpoch(browserStore()) !== epoch ||
            accountDeleting(browserStore(), session.uid)
          ) {
            setState({ ...state, busy: false });
            return;
          }
          // Another tab can claim these rows while this enable waited on the lock.
          // Read the journal and the ownership again before the upload.
          const snapshot = await readBackupSnapshot();
          const deletedNow = new Set(snapshot.deletedIds);
          const kept = snapshot.entries.filter(
            (entry) => !deletedNow.has(entry.id),
          );
          const priorRemoved = new Set(
            removedIdsFor(browserStore(), session.uid),
          );
          const clock = backupClock(Date.now(), remote);
          const gone = remoteDeletesStillPending(
            idsDeletedOnServer(
              syncedIdsFor(browserStore(), session.uid),
              kept,
              sync.deleted,
              deletedNow,
              clock,
            ),
            priorRemoved,
          );
          const goneIds = new Set(gone);
          // The server still names these rows. The marker stays until the
          // upload and the local removal both finish. Any other still-local
          // marker is a restore, so that row can be uploaded.
          releaseRemoteDeletes(
            browserStore(),
            [...priorRemoved].filter(
              (id) => kept.some((entry) => entry.id === id) && !goneIds.has(id),
            ),
            session.uid,
          );
          const owned = withoutOtherAccountEntries(
            kept.filter((entry) => !goneIds.has(entry.id)),
            browserStore(),
            session.uid,
          );
          const localIds = entriesForBackup(owned, clock, BACKUP_DAYS).map(
            (entry) => entry.id,
          );
          // The download can finish after another tab saved a row. That row was
          // not in the count the user confirmed, so the upload waits.
          if (backupEnableDecision(confirmedIds, localIds) === "refresh") {
            setState({ ...state, busy: false });
            return { status: "refresh", ids: localIds };
          }
          // The cloud note is not written yet. The upload carries the merge,
          // and the journal changes only after that upload is accepted.
          // A row another account already claimed stays in the replacement
          // unchanged. It is not written into this journal.
          const blocked = new Set([...deletedNow, ...gone]);
          const { mine, held } = partitionAccountEntries(
            remote,
            browserStore(),
            session.uid,
          );
          const windowed = entriesForBackup(
            [...mergeBackupWindow(owned, mine, blocked, clock), ...held],
            clock,
            BACKUP_DAYS,
            new Set([...mine, ...held].map((entry) => entry.id)),
          );
          try {
            assertSyncEntryLimit(windowed.length);
          } catch (error) {
            if (error instanceof AccountApiError && error.code === "too-many") {
              setState({ ...state, busy: false, error: "too-many" });
              return { status: "limited" };
            }
            throw error;
          }
          const upload = await claimUpload(browserStore(), session.uid);
          try {
            if (
              state.session?.uid !== session.uid ||
              backupEpoch(browserStore()) !== epoch ||
              accountDeleting(browserStore(), session.uid)
            ) {
              setState({ ...state, busy: false });
              return;
            }
            await api.putEntries(token, windowed, sync.revision);
            if (
              state.session?.uid !== session.uid ||
              backupEpoch(browserStore()) !== epoch ||
              accountDeleting(browserStore(), session.uid)
            ) {
              setState({ ...state, busy: false });
              return;
            }
            const merged = await onMerge(mine);
            if (!Array.isArray(merged)) {
              setState({ ...state, busy: false, error: "error" });
              return;
            }
            rememberSeenEntries(
              browserStore(),
              session.uid,
              merged.map((entry) => entry.id),
            );
            rememberDownloaded(
              browserStore(),
              merged.map((entry) => entry.id),
              session.uid,
            );
            const claimed = windowed
              .filter((entry) => !held.some((row) => row.id === entry.id))
              .map((entry) => entry.id);
            rememberSeenEntries(browserStore(), session.uid, claimed);
            rememberSynced(browserStore(), claimed, session.uid);
            if (gone.length > 0) {
              await onRemove?.(gone);
              if (onRemove)
                rememberRemoteDeletes(browserStore(), gone, session.uid);
            }
            if (
              state.session?.uid !== session.uid ||
              backupEpoch(browserStore()) !== epoch ||
              accountDeleting(browserStore(), session.uid)
            ) {
              setState({ ...state, busy: false });
              return;
            }
            grantOptIn(browserStore(), session.uid);
            analytics.record("sync_on");
            setState({ ...state, busy: false, optedIn: true });
          } finally {
            await releaseUpload(browserStore(), session.uid, upload);
          }
        });
      } catch (error) {
        // The snapshot changed after this device read it. Pull and merge again
        // before opting in, so this list does not replace the newer one.
        if (isBackupConflict(error) && attempt + 1 < SYNC_UPLOAD_ATTEMPTS)
          continue;
        throw error;
      }
    }
    throw new AccountApiError(409, "conflict");
  } catch (error) {
    const code =
      error instanceof AccountAuthError || error instanceof AccountApiError
        ? error.code || "error"
        : "error";
    setState({ ...state, busy: false, error: code });
    if (
      error instanceof AccountApiError &&
      (error.code === "too-many" || error.code === "too-large")
    )
      return { status: "limited" };
    throw error;
  }
}

export async function disableBackup() {
  nextBackupEpoch(browserStore());
  const session = state.session;
  if (!session) return;
  clearOptIn(browserStore());
  analytics.record("sync_off");
  setState({ ...state, optedIn: false });
}

export function pushBackupEntries(
  entries: readonly BackupEntry[],
  deletedIds: readonly string[] = [],
  onMerge?: (entries: SavedMap[]) => Promise<readonly BackupEntry[] | void>,
  onRemove?: (ids: string[]) => Promise<void>,
) {
  const session = state.session;
  if (
    !session ||
    !api ||
    !optedIn(browserStore(), session.uid) ||
    accountDeleting(browserStore(), session.uid)
  )
    return;
  latestEntries = entries;
  latestDeleted = deletedIds;
  const uid = session.uid;
  const current = api;
  const epoch = backupEpoch(browserStore());
  pushChain = pushChain
    .then(async () => {
      if (
        state.session?.uid !== uid ||
        !optedIn(browserStore(), uid) ||
        accountDeleting(browserStore(), uid)
      )
        return;
      if (backupEpoch(browserStore()) !== epoch) return;
      const token = await session.getIdToken();
      if (
        state.session?.uid !== uid ||
        !optedIn(browserStore(), uid) ||
        accountDeleting(browserStore(), uid)
      )
        return;
      if (backupEpoch(browserStore()) !== epoch) return;
      await pushBackup({
        uid,
        token,
        entries: () => latestEntries,
        now: Date.now(),
        store: browserStore(),
        deletedIds: async () => {
          const stored = await readDeletedIds();
          return [...new Set([...latestDeleted, ...stored])];
        },
        epoch,
        pull: async (next) => {
          const sync = await current.getEntries(next);
          const remote = sync.entries;
          if (backupEpoch(browserStore()) !== epoch) return sync;
          if (
            state.session?.uid !== uid ||
            !optedIn(browserStore(), uid) ||
            accountDeleting(browserStore(), uid)
          )
            return sync;
          const revived = removedIdsFor(browserStore(), uid).filter((id) =>
            remote.some((entry) => entry.id === id),
          );
          // A user delete during this pull stays tombstoned. Only the
          // account's remote-delete marker is released.
          if (revived.length > 0)
            releaseRemoteDeletes(browserStore(), revived, uid);
          const { mine } = partitionAccountEntries(remote, browserStore(), uid);
          await onMerge?.(mine);
          return sync;
        },
        put: (next, rows, revision) =>
          current.putEntries(next, rows, revision ?? ""),
        forget: onRemove,
      });
    })
    .catch((error: unknown) => {
      const code =
        error instanceof AccountApiError && error.code ? error.code : "error";
      setState({ ...state, error: code });
    });
}

function cancelledAccountChange(): Error {
  const error = new Error("cancelled");
  Object.defineProperty(error, "code", { value: "cancelled" });
  return error;
}

export async function deleteAccount(
  onRemove: (ids: string[]) => Promise<void>,
) {
  nextBackupEpoch(browserStore());
  const session = state.session;
  if (!session || !client) return;
  setState({ ...state, busy: true, error: "" });
  const auth = client;
  try {
    await deleteSignedInAccount({
      uid: session.uid,
      token: () => {
        if (state.session?.uid !== session.uid) throw cancelledAccountChange();
        return (state.session ?? session).getIdToken(true);
      },
      api,
      removeLocal: onRemove,
      confirmRecentLogin: () => auth.reauthenticate(),
      deleteAuth: () => auth.deleteUser(),
      settleUploads: () => pushChain,
      sameAccount: () => state.session?.uid === session.uid,
      sessionUid: () => state.session?.uid ?? null,
      store: browserStore(),
    });
    if (state.session && state.session?.uid !== session.uid) {
      setState({ ...state, busy: false, error: "" });
      return;
    }
    analytics.record("account_delete");
    setState({
      ...state,
      busy: false,
      session: null,
      optedIn: false,
      remaining: null,
      notice: "deleted",
    });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "cancelled") {
      setState({ ...state, busy: false, error: "" });
      throw error;
    }
    if (code === "email-sent") {
      setState({ ...state, busy: false, error: "", notice: "email-sent" });
      throw error;
    }
    if (code === "delete-partial") {
      setState({
        ...state,
        busy: false,
        optedIn: false,
        error: "delete-partial",
      });
      throw error;
    }
    setState({
      ...state,
      busy: false,
      error: code === "no-api" || code === "recent-login" ? code : "error",
    });
    throw error;
  }
}

export function openUpgrade() {
  if (state.upgrade) return;
  analytics.record("upgrade_sheet");
  setState({ ...state, upgrade: true });
}

export function closeUpgrade() {
  if (!state.upgrade) return;
  setState({ ...state, upgrade: false });
}

// The allowance request belongs to the account that started it. A sign-in that
// lands before the response must not spend that result on the new account.
export function sourceSearchDecision(
  requestedUid: string,
  currentUid: string | null,
  limited: boolean,
): "allow" | "stop" | "upgrade" {
  if (currentUid !== requestedUid) return "stop";
  return limited ? "upgrade" : "allow";
}

export async function guardSourceSearch(): Promise<boolean> {
  const session = state.session;
  if (!session || !api) return true;
  try {
    const result = await api.useSearch(await session.getIdToken());
    const decision = sourceSearchDecision(
      session.uid,
      state.session?.uid ?? null,
      false,
    );
    if (decision !== "allow") return false;
    setState({ ...state, remaining: result.remaining });
    return true;
  } catch (error) {
    if (
      error instanceof AccountApiError &&
      (error.code === "upgrade_coming_soon" || error.code === "limit_reached")
    ) {
      const decision = sourceSearchDecision(
        session.uid,
        state.session?.uid ?? null,
        true,
      );
      if (decision !== "upgrade") return false;
      setState({ ...state, remaining: error.remaining ?? 0 });
      openUpgrade();
      return false;
    }
    throw error;
  }
}

export function syncedIds(): string[] {
  const uid = state.session?.uid;
  if (!uid) return [];
  return syncedIdsFor(browserStore(), uid);
}
