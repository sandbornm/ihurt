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
import { backupUploadSet, type BackupEntry } from "./backup.ts";
import { readAccountConfig, testRuntimeAllowed, type AccountConfig } from "./config.ts";
import {
  clearOptIn,
  deleteSignedInAccount,
  grantOptIn,
  optedIn,
  pushBackup,
  readSyncedIds,
  rememberSynced,
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
  if (testRuntimeAllowed(location.hostname)) {
    Object.assign(globalThis, { __IHURT_GUARD_SEARCH__: guardSourceSearch });
  }
  const runtime = readTestRuntime();
  if (runtime) {
    wire(runtime.auth, runtime.apiBase ?? "", runtime.analyticsEndpoint ?? "");
    return;
  }
  const config = readAccountConfig(import.meta.env);
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
  const status = await api.getAccount(await session.getIdToken());
  if (state.session?.uid !== session.uid) return;
  setState({ ...state, remaining: status.searchesRemaining });
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
    setState({ ...state, busy: false, error: code === "cancelled" ? "" : code });
    if (code !== "cancelled") throw error;
  }
}

export async function signOut() {
  if (!client) return;
  clearOptIn(browserStore());
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
  entries: readonly BackupEntry[],
  onMerge: (entries: SavedMap[]) => Promise<readonly BackupEntry[] | void>,
) {
  const session = state.session;
  if (!session || !client) throw new AccountAuthError("unconfigured");
  if (!api) throw new AccountAuthError("no-api");
  setState({ ...state, busy: true, error: "" });
  try {
    const token = await session.getIdToken();
    await api.enableSync(token);
    const remote = await api.getEntries(token);
    if (state.session?.uid !== session.uid) {
      setState({ ...state, busy: false });
      return;
    }
    const kept = await onMerge(remote);
    const windowed = backupUploadSet(
      entries,
      Array.isArray(kept) ? kept : remote,
      Date.now(),
    );
    await api.putEntries(token, windowed);
    if (state.session?.uid !== session.uid) {
      setState({ ...state, busy: false });
      return;
    }
    rememberSynced(
      browserStore(),
      windowed.map((entry) => entry.id),
      session.uid,
    );
    grantOptIn(browserStore(), session.uid);
    analytics.record("sync_on");
    setState({ ...state, busy: false, optedIn: true });
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
    const code = error instanceof AccountAuthError ? error.code : "passkey-unavailable";
    setState({
      ...state,
      busy: false,
      error: code === "cancelled" ? "" : code,
    });
    if (code !== "cancelled") throw error;
  }
}

export async function disableBackup() {
  const session = state.session;
  if (!session) return;
  clearOptIn(browserStore());
  analytics.record("sync_off");
  setState({ ...state, optedIn: false });
}

export function pushBackupEntries(
  entries: readonly BackupEntry[],
  deletedIds: readonly string[] = [],
) {
  const session = state.session;
  if (!session || !api || !optedIn(browserStore(), session.uid)) return;
  const uid = session.uid;
  const current = api;
  pushChain = pushChain
    .then(async () => {
      if (state.session?.uid !== uid || !optedIn(browserStore(), uid)) return;
      const token = await session.getIdToken();
      if (state.session?.uid !== uid || !optedIn(browserStore(), uid)) return;
      await pushBackup({
        uid,
        token,
        entries,
        now: Date.now(),
        store: browserStore(),
        deletedIds,
        put: (next, rows) => current.putEntries(next, rows),
      });
    })
    .catch(() => {
      setState({ ...state, error: "error" });
    });
}

export async function deleteAccount(onRemove: (ids: string[]) => Promise<void>) {
  const session = state.session;
  if (!session || !client) return;
  setState({ ...state, busy: true, error: "" });
  const auth = client;
  try {
    await deleteSignedInAccount({
      uid: session.uid,
      token: await session.getIdToken(),
      api,
      removeLocal: onRemove,
      deleteAuth: () => auth.deleteUser(),
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
    setState({
      ...state,
      busy: false,
      error: code === "no-api" ? "no-api" : "error",
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
  return readSyncedIds(browserStore());
}
