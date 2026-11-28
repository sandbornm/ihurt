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

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const EMAIL_KEY = "ihurt-email-for-sign-in";
const RECENT_LOGIN_MS = 5 * 60 * 1000;

interface FirebaseUser {
  uid: string;
  email: string | null;
  providerData: { providerId: string }[];
  getIdToken(forceRefresh?: boolean): Promise<string>;
  delete(): Promise<void>;
}

function providerOf(user: FirebaseUser): SignInProvider {
  const id = user.providerData[0]?.providerId ?? "";
  if (id === "apple.com") return "apple";
  if (id === "google.com") return "google";
  if (id === "password" || id === "emailLink") return "email";
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
    getIdToken: (forceRefresh?: boolean) => user.getIdToken(forceRefresh),
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

function emailLinkRetryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const text = `${typeof code === "string" ? code : ""} ${
    error instanceof Error ? error.message : ""
  }`;
  return text.includes("network-request-failed");
}

// A bad code or a mismatched address is cleared so a reload does not retry it.
// A network error leaves the address and the link, because that code can still
// be valid.
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
  } catch (error) {
    if (!emailLinkRetryable(error)) {
      input.clearEmail();
      input.clearQuery();
    }
    return false;
  }
  input.clearEmail();
  input.clearQuery();
  return true;
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

  const listeners = new Set<(session: AccountSession | null) => void>();

  function emit(session: AccountSession | null) {
    for (const listener of listeners) listener(session);
  }

  function active(): AccountSession | null {
    const user = auth.currentUser as FirebaseUser | null;
    return user ? toSession(user) : null;
  }

  authMod.onAuthStateChanged(auth, () => {
    emit(active());
  });

  await auth.authStateReady();
  try {
    const redirect = await authMod.getRedirectResult(auth);
    if (redirect?.user) emit(toSession(redirect.user as FirebaseUser));
  } catch {
    // A stale redirect must not block Apple, Google, or email.
  }
  await completeEmailLink({
    isLink: authMod.isSignInWithEmailLink(auth, location.href),
    email: storage()?.getItem(EMAIL_KEY) ?? null,
    href: location.href,
    signIn: (address, href) =>
      authMod.signInWithEmailLink(auth, address, href).then(() => undefined),
    clearEmail: () => storage()?.removeItem(EMAIL_KEY),
    clearQuery: () =>
      history.replaceState(null, "", `${location.origin}${location.pathname}`),
  });
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
      throw new AccountAuthError("unconfigured");
    },
    async signOut() {
      await authMod.signOut(auth);
      emit(null);
    },
    async reauthenticate() {
      const current = auth.currentUser;
      if (!current) throw new AccountAuthError("unconfigured");
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
      if (!user) return;
      await user.delete();
    },
  };
  return client;
}
