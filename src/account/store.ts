import { createAccountApi, AccountApiError, type AccountApi } from "./api.ts";
import { createAnalytics, type AccountAnalytics } from "./analytics.ts";
import {
  AccountAuthError,
  readTestRuntime,
  type AccountSession,
  type AuthClient,
  type SignInProvider,
} from "./auth.ts";
import type { SavedMap } from "../types.ts";
import {
  clearDeletedIds,
  readBackupSnapshot,
  readDeletedIds,
} from "../notebook-storage.ts";
import {
  BACKUP_DAYS,
  backupClock,
  entriesForBackup,
  idsDeletedOnServer,
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
  claimUpload,
  clearOptIn,
  deleteSignedInAccount,
  grantOptIn,
  nextBackupEpoch,
  optedIn,
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

function applySession(session: AccountSession | null) {
  setState({
    ...state,
    status: "ready",
    session,
    optedIn: session ? optedIn(browserStore(), session.uid) : false,
    remaining: session ? state.remaining : null,
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
  onMerge: (entries: SavedMap[]) => Promise<readonly BackupEntry[] | void>,
  onRemove?: (ids: string[]) => Promise<void>,
) {
  const session = state.session;
  if (!session || !client) throw new AccountAuthError("unconfigured");
  if (!api) throw new AccountAuthError("no-api");
  const epoch = backupEpoch(browserStore());
  setState({ ...state, busy: true, error: "" });
  try {
    const token = await session.getIdToken();
    await api.enableSync(token);
    const remote = await api.getEntries(token);
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
    if (revived.length > 0) {
      releaseRemoteDeletes(browserStore(), revived, session.uid);
      await clearDeletedIds(revived);
    }
    const merged = await onMerge(remote);
    if (Array.isArray(merged)) {
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
    }
    if (
      state.session?.uid !== session.uid ||
      backupEpoch(browserStore()) !== epoch ||
      accountDeleting(browserStore(), session.uid)
    ) {
      setState({ ...state, busy: false });
      return;
    }
    if (!Array.isArray(merged)) {
      setState({ ...state, busy: false, error: "error" });
      return;
    }
    const snapshot = await readBackupSnapshot();
    const deletedNow = new Set(snapshot.deletedIds);
    const kept = snapshot.entries.filter((entry) => !deletedNow.has(entry.id));
    const priorRemoved = new Set(removedIdsFor(browserStore(), session.uid));
    releaseRemoteDeletes(
      browserStore(),
      [...priorRemoved].filter((id) => kept.some((entry) => entry.id === id)),
      session.uid,
    );
    const clock = backupClock(Date.now(), remote);
    const gone =
      remote.length > 0
        ? idsDeletedOnServer(
            syncedIdsFor(browserStore(), session.uid),
            kept,
            remote,
            deletedNow,
            clock,
          ).filter((id) => !priorRemoved.has(id))
        : [];
    rememberRemoteDeletes(browserStore(), gone, session.uid);
    const goneIds = new Set(gone);
    const windowed = entriesForBackup(
      withoutOtherAccountEntries(
        kept.filter((entry) => !goneIds.has(entry.id)),
        browserStore(),
        session.uid,
      ),
      clock,
      BACKUP_DAYS,
      new Set(remote.map((entry) => entry.id)),
    );
    await withUploadLock(async () => {
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
        await api.putEntries(token, windowed);
        rememberSeenEntries(
          browserStore(),
          session.uid,
          windowed.map((entry) => entry.id),
        );
        rememberSynced(
          browserStore(),
          windowed.map((entry) => entry.id),
          session.uid,
        );
        if (gone.length > 0) await onRemove?.(gone);
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
    const code = error instanceof AccountAuthError ? error.code : "error";
    setState({ ...state, busy: false, error: code });
    throw error;
  }
}

export async function enrollPasskey() {
  if (!client) throw new AccountAuthError("unconfigured");
  setState({ ...state, busy: true, error: "" });
  try {
    await client.enrollPasskey();
    setState({ ...state, busy: false });
  } catch (error) {
    const code =
      error instanceof AccountAuthError ? error.code : "passkey-unavailable";
    setState({
      ...state,
      busy: false,
      error: code === "cancelled" ? "" : code,
    });
    if (code !== "cancelled") throw error;
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
          const remote = await current.getEntries(next);
          if (backupEpoch(browserStore()) !== epoch) return remote;
          if (
            state.session?.uid !== uid ||
            !optedIn(browserStore(), uid) ||
            accountDeleting(browserStore(), uid)
          )
            return remote;
          const revived = removedIdsFor(browserStore(), uid).filter((id) =>
            remote.some((entry) => entry.id === id),
          );
          if (revived.length > 0) {
            releaseRemoteDeletes(browserStore(), revived, uid);
            await clearDeletedIds(revived);
          }
          await onMerge?.(remote);
          return remote;
        },
        put: (next, rows) => current.putEntries(next, rows),
        forget: onRemove,
      });
    })
    .catch(() => {
      setState({ ...state, error: "error" });
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
      store: browserStore(),
    });
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

export async function guardSourceSearch(): Promise<boolean> {
  const session = state.session;
  if (!session || !api) return true;
  try {
    const result = await api.useSearch(await session.getIdToken());
    if (state.session?.uid === session.uid)
      setState({ ...state, remaining: result.remaining });
    return true;
  } catch (error) {
    if (
      error instanceof AccountApiError &&
      (error.code === "upgrade_coming_soon" || error.code === "limit_reached")
    ) {
      if (state.session?.uid === session.uid)
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
