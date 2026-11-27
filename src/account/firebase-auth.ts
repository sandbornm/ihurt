import { language } from "../i18n/index.ts";
import {
  AccountAuthError,
  nativeAppleSignIn,
  prefersRedirectSignIn,
  type AccountSession,
  type AuthClient,
  type SignInProvider,
} from "./auth.ts";
import { emailContinueUrl, type FirebasePublicConfig } from "./config.ts";
import {
  decodeBase64,
  passkeyEnroll,
  passkeyRpId,
  passkeySignIn,
  refreshIdToken,
  tokenExpiryMs,
} from "./passkey.ts";

const REFRESH_KEY = "ihurt-auth-refresh";
const EMAIL_KEY = "ihurt-email-for-sign-in";
const RECENT_LOGIN_MS = 5 * 60 * 1000;

interface FirebaseUser {
  uid: string;
  email: string | null;
  providerData: { providerId: string }[];
  getIdToken(): Promise<string>;
  delete(): Promise<void>;
}

function providerOf(user: FirebaseUser): SignInProvider {
  const id = user.providerData[0]?.providerId ?? "";
  if (id === "apple.com") return "apple";
  if (id === "google.com") return "google";
  if (id === "password" || id === "emailLink") return "email";
  if (id.includes("passkey")) return "passkey";
  return "unknown";
}

function toSession(
  user: FirebaseUser,
  provider?: SignInProvider,
): AccountSession {
  return {
    uid: user.uid,
    email: user.email,
    provider: provider ?? providerOf(user),
    getIdToken: () => user.getIdToken(),
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code ?? "";
    return `${error.message} ${code}`;
  }
  return String(error);
}

function isCancel(error: unknown): boolean {
  return errorText(error).toLowerCase().includes("cancel");
}

function isMissingPlugin(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("unimplemented") || text.includes("not implemented");
}

function authTimeMs(idToken: string): number {
  try {
    const segment = idToken.split(".")[1] ?? "";
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64(segment)),
    ) as {
      auth_time?: unknown;
    };
    return typeof payload.auth_time === "number" ? payload.auth_time * 1000 : 0;
  } catch {
    return 0;
  }
}

function recentEnough(idToken: string): boolean {
  const stamp = authTimeMs(idToken);
  return stamp > 0 && Date.now() - stamp < RECENT_LOGIN_MS;
}

// A bad code or a mismatched address must not block the other sign-in methods.
// The query is cleared either way so a reload does not retry the same link.
export async function completeEmailLink(input: {
  isLink: boolean;
  email: string | null;
  href: string;
  signIn: (email: string, href: string) => Promise<void>;
  clearEmail: () => void;
  clearQuery: () => void;
}): Promise<boolean> {
  if (!input.isLink || !input.email) return false;
  try {
    await input.signIn(input.email, input.href);
    return true;
  } catch {
    return false;
  } finally {
    input.clearEmail();
    input.clearQuery();
  }
}

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

function readPasskeyRefresh(): string | null {
  storage()?.removeItem(REFRESH_KEY);
  return sessionStorageOrNull()?.getItem(REFRESH_KEY) ?? null;
}

function writePasskeyRefresh(token: string) {
  storage()?.removeItem(REFRESH_KEY);
  sessionStorageOrNull()?.setItem(REFRESH_KEY, token);
}

function clearPasskeyRefresh() {
  storage()?.removeItem(REFRESH_KEY);
  sessionStorageOrNull()?.removeItem(REFRESH_KEY);
}

export async function createFirebaseAuth(
  config: FirebasePublicConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthClient> {
  const [{ getApps, initializeApp }, authMod] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const existing = getApps().find((app) => app.name === "ihurt");
  const app =
    existing ??
    initializeApp(
      {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
      },
      "ihurt",
    );
  const auth = authMod.getAuth(app);
  auth.languageCode = language() === "es" ? "es" : "en";

  let passkeySession: AccountSession | null = null;
  const listeners = new Set<(session: AccountSession | null) => void>();

  function emit(session: AccountSession | null) {
    for (const listener of listeners) listener(session);
  }

  function active(): AccountSession | null {
    const user = auth.currentUser as FirebaseUser | null;
    if (user) return toSession(user);
    return passkeySession;
  }

  authMod.onAuthStateChanged(auth, () => {
    if (auth.currentUser) passkeySession = null;
    emit(active());
  });

  function adoptPasskey(
    idToken: string,
    refreshToken: string,
    localId: string,
  ): AccountSession {
    let currentId = idToken;
    let currentRefresh = refreshToken;
    writePasskeyRefresh(currentRefresh);
    const session: AccountSession = {
      uid: localId,
      email: null,
      provider: "passkey",
      async getIdToken() {
        if (tokenExpiryMs(currentId) - Date.now() > 60_000) return currentId;
        const next = await refreshIdToken(
          config.apiKey,
          currentRefresh,
          fetchImpl,
        );
        currentId = next.idToken;
        currentRefresh = next.refreshToken;
        writePasskeyRefresh(currentRefresh);
        return currentId;
      },
    };
    passkeySession = session;
    emit(session);
    return session;
  }

  await auth.authStateReady();
  try {
    const redirect = await authMod.getRedirectResult(auth);
    if (redirect?.user) emit(toSession(redirect.user as FirebaseUser));
  } catch {
    // A stale redirect must not block Apple, Google, email, or passkeys.
  }
  const continued = await completeEmailLink({
    isLink: authMod.isSignInWithEmailLink(auth, location.href),
    email: storage()?.getItem(EMAIL_KEY) ?? null,
    href: location.href,
    signIn: (address, href) =>
      authMod.signInWithEmailLink(auth, address, href).then(() => undefined),
    clearEmail: () => storage()?.removeItem(EMAIL_KEY),
    clearQuery: () =>
      history.replaceState(null, "", `${location.origin}${location.pathname}`),
  });
  if (!continued && !auth.currentUser) {
    const refresh = readPasskeyRefresh();
    if (refresh) {
      try {
        const next = await refreshIdToken(config.apiKey, refresh, fetchImpl);
        adoptPasskey(next.idToken, next.refreshToken, next.localId);
      } catch {
        clearPasskeyRefresh();
      }
    }
  }

  async function signInWithProvider(method: "apple" | "google") {
    const provider =
      method === "google"
        ? new authMod.GoogleAuthProvider()
        : new authMod.OAuthProvider("apple.com");
    if (prefersRedirectSignIn()) {
      await authMod.signInWithRedirect(auth, provider);
      return "redirect" as const;
    }
    const result = await authMod.signInWithPopup(auth, provider);
    return toSession(result.user as FirebaseUser, method);
  }

  const client: AuthClient = {
    async current() {
      return active();
    },
    onChange(listener) {
      listeners.add(listener);
      listener(active());
      return () => listeners.delete(listener);
    },
    async signIn(method, email) {
      if (method === "apple") {
        const native = nativeAppleSignIn();
        if (native) {
          try {
            const { idToken, nonce } = await native();
            const provider = new authMod.OAuthProvider("apple.com");
            const credential = provider.credential({
              idToken,
              rawNonce: nonce,
            });
            const result = await authMod.signInWithCredential(auth, credential);
            return toSession(result.user as FirebaseUser, "apple");
          } catch (error) {
            if (isCancel(error)) throw new AccountAuthError("cancelled");
            if (!isMissingPlugin(error)) throw error;
          }
        }
        return signInWithProvider("apple");
      }
      if (method === "google") {
        return signInWithProvider("google");
      }
      if (method === "email") {
        const address = (email ?? "").trim();
        if (!address) throw new AccountAuthError("email-required");
        if (authMod.isSignInWithEmailLink(auth, location.href)) {
          const result = await authMod.signInWithEmailLink(
            auth,
            address,
            location.href,
          );
          storage()?.removeItem(EMAIL_KEY);
          history.replaceState(
            null,
            "",
            `${location.origin}${location.pathname}`,
          );
          return toSession(result.user as FirebaseUser, "email");
        }
        await authMod.sendSignInLinkToEmail(auth, address, {
          url: emailContinueUrl(location.href, config.authDomain),
          handleCodeInApp: true,
        });
        storage()?.setItem(EMAIL_KEY, address);
        return "email-sent";
      }
      const rpId = passkeyRpId(location.hostname, config.passkeyRpId);
      const exported = authMod as typeof authMod & {
        signInWithPasskey?: (
          auth: unknown,
          name: string,
        ) => Promise<{ user: FirebaseUser }>;
      };
      if (
        typeof exported.signInWithPasskey === "function" &&
        rpId === location.hostname
      ) {
        try {
          const result = await exported.signInWithPasskey(auth, "iHurt");
          return toSession(result.user, "passkey");
        } catch (error) {
          if (isCancel(error)) throw new AccountAuthError("cancelled");
        }
      }
      try {
        const tokens = await passkeySignIn({
          apiKey: config.apiKey,
          rpId,
          fetchImpl,
        });
        return adoptPasskey(
          tokens.idToken,
          tokens.refreshToken,
          tokens.localId,
        );
      } catch (error) {
        if (error instanceof AccountAuthError) throw error;
        throw new AccountAuthError("passkey-unavailable");
      }
    },
    async signOut() {
      passkeySession = null;
      clearPasskeyRefresh();
      await authMod.signOut(auth);
      emit(null);
    },
    async reauthenticate() {
      const current = auth.currentUser;
      if (!current) {
        if (!passkeySession) throw new AccountAuthError("unconfigured");
        if (recentEnough(await passkeySession.getIdToken())) return;
        const rpId = passkeyRpId(location.hostname, config.passkeyRpId);
        try {
          const tokens = await passkeySignIn({
            apiKey: config.apiKey,
            rpId,
            fetchImpl,
          });
          if (tokens.localId !== passkeySession.uid) {
            throw new AccountAuthError("recent-login");
          }
          adoptPasskey(tokens.idToken, tokens.refreshToken, tokens.localId);
        } catch (error) {
          if (error instanceof AccountAuthError) throw error;
          if (isCancel(error)) throw new AccountAuthError("cancelled");
          throw new AccountAuthError("recent-login");
        }
        return;
      }
      const user = current as FirebaseUser;
      if (recentEnough(await user.getIdToken())) return;
      const provider = providerOf(user);
      try {
        if (provider === "google") {
          await authMod.reauthenticateWithPopup(
            current,
            new authMod.GoogleAuthProvider(),
          );
          return;
        }
        if (provider === "apple") {
          const native = nativeAppleSignIn();
          if (native) {
            try {
              const { idToken, nonce } = await native();
              const apple = new authMod.OAuthProvider("apple.com");
              const credential = apple.credential({ idToken, rawNonce: nonce });
              await authMod.reauthenticateWithCredential(current, credential);
              return;
            } catch (error) {
              if (isCancel(error)) throw new AccountAuthError("cancelled");
              if (!isMissingPlugin(error)) throw error;
            }
          }
          await authMod.reauthenticateWithPopup(
            current,
            new authMod.OAuthProvider("apple.com"),
          );
          return;
        }
        if (provider === "email") {
          const address = user.email ?? storage()?.getItem(EMAIL_KEY) ?? "";
          if (!address) throw new AccountAuthError("recent-login");
          await authMod.sendSignInLinkToEmail(auth, address, {
            url: emailContinueUrl(location.href, config.authDomain),
            handleCodeInApp: true,
          });
          storage()?.setItem(EMAIL_KEY, address);
          throw new AccountAuthError("email-sent");
        }
        throw new AccountAuthError("recent-login");
      } catch (error) {
        if (error instanceof AccountAuthError) throw error;
        if (isCancel(error)) throw new AccountAuthError("cancelled");
        if (errorText(error).includes("requires-recent-login")) {
          throw new AccountAuthError("recent-login");
        }
        throw error;
      }
    },
    async deleteUser() {
      const user = auth.currentUser as FirebaseUser | null;
      if (user) {
        await user.delete();
        passkeySession = null;
        clearPasskeyRefresh();
        return;
      }
      if (passkeySession) {
        const idToken = await passkeySession.getIdToken();
        const response = await fetchImpl(
          `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(config.apiKey)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idToken }),
          },
        );
        if (!response.ok) throw new AccountAuthError("delete-failed");
        passkeySession = null;
        clearPasskeyRefresh();
        emit(null);
      }
    },
    async enrollPasskey() {
      const session = active();
      if (!session) throw new AccountAuthError("unconfigured");
      const rpId = passkeyRpId(location.hostname, config.passkeyRpId);
      await passkeyEnroll({
        apiKey: config.apiKey,
        rpId,
        idToken: await session.getIdToken(),
        fetchImpl,
      });
    },
  };
  return client;
}
