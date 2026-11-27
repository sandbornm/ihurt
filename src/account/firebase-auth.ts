import { language } from "../i18n/index.ts";
import {
  AccountAuthError,
  nativeAppleSignIn,
  prefersRedirectSignIn,
  type AccountSession,
  type AuthClient,
  type SignInProvider,
} from "./auth.ts";
import type { FirebasePublicConfig } from "./config.ts";
import {
  passkeyEnroll,
  passkeyRpId,
  passkeySignIn,
  refreshIdToken,
  tokenExpiryMs,
} from "./passkey.ts";

const REFRESH_KEY = "ihurt-auth-refresh";
const EMAIL_KEY = "ihurt-email-for-sign-in";

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

function toSession(user: FirebaseUser, provider?: SignInProvider): AccountSession {
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

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
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
    storage()?.setItem(REFRESH_KEY, currentRefresh);
    const session: AccountSession = {
      uid: localId,
      email: null,
      provider: "passkey",
      async getIdToken() {
        if (tokenExpiryMs(currentId) - Date.now() > 60_000) return currentId;
        const next = await refreshIdToken(config.apiKey, currentRefresh, fetchImpl);
        currentId = next.idToken;
        currentRefresh = next.refreshToken;
        storage()?.setItem(REFRESH_KEY, currentRefresh);
        return currentId;
      },
    };
    passkeySession = session;
    emit(session);
    return session;
  }

  await auth.authStateReady();
  const redirect = await authMod.getRedirectResult(auth);
  if (redirect?.user) emit(toSession(redirect.user as FirebaseUser));
  if (
    authMod.isSignInWithEmailLink(auth, location.href) &&
    storage()?.getItem(EMAIL_KEY)
  ) {
    const email = storage()?.getItem(EMAIL_KEY) ?? "";
    await authMod.signInWithEmailLink(auth, email, location.href);
    storage()?.removeItem(EMAIL_KEY);
    history.replaceState(null, "", `${location.origin}${location.pathname}`);
  } else if (!auth.currentUser) {
    const refresh = storage()?.getItem(REFRESH_KEY);
    if (refresh) {
      try {
        const next = await refreshIdToken(config.apiKey, refresh, fetchImpl);
        adoptPasskey(next.idToken, next.refreshToken, next.localId);
      } catch {
        storage()?.removeItem(REFRESH_KEY);
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
          history.replaceState(null, "", `${location.origin}${location.pathname}`);
          return toSession(result.user as FirebaseUser, "email");
        }
        await authMod.sendSignInLinkToEmail(auth, address, {
          url: `${location.origin}/?emailLink=1`,
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
      if (typeof exported.signInWithPasskey === "function" && rpId === location.hostname) {
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
        return adoptPasskey(tokens.idToken, tokens.refreshToken, tokens.localId);
      } catch (error) {
        if (error instanceof AccountAuthError) throw error;
        throw new AccountAuthError("passkey-unavailable");
      }
    },
    async signOut() {
      passkeySession = null;
      storage()?.removeItem(REFRESH_KEY);
      await authMod.signOut(auth);
      emit(null);
    },
    async deleteUser() {
      const user = auth.currentUser as FirebaseUser | null;
      if (user) {
        await user.delete();
        passkeySession = null;
        storage()?.removeItem(REFRESH_KEY);
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
        storage()?.removeItem(REFRESH_KEY);
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
