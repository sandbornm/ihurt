import { testRuntimeAllowed } from "./config.ts";

export type SignInProvider =
  "apple" | "google" | "email" | "passkey" | "unknown";

export interface AccountSession {
  uid: string;
  email: string | null;
  provider: SignInProvider;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export interface AuthClient {
  current(): Promise<AccountSession | null>;
  onChange(listener: (session: AccountSession | null) => void): () => void;
  signIn(
    method: Exclude<SignInProvider, "unknown">,
    email?: string,
  ): Promise<AccountSession | "email-sent" | "redirect">;
  signOut(): Promise<void>;
  reauthenticate(): Promise<void>;
  deleteUser(): Promise<void>;
  enrollPasskey(): Promise<void>;
}

export class AccountAuthError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AccountAuthError";
    this.code = code;
  }
}

export interface NativeAppleResult {
  idToken: string;
  nonce: string;
}

let nativeApple: (() => Promise<NativeAppleResult>) | null = null;
let redirectSignIn = false;

export function configureNativeAppleSignIn(
  signIn: () => Promise<NativeAppleResult>,
  redirect = false,
) {
  nativeApple = signIn;
  redirectSignIn = redirect;
}

export function nativeAppleSignIn() {
  return nativeApple;
}

export function prefersRedirectSignIn() {
  return redirectSignIn;
}

export interface AccountTestRuntime {
  auth: AuthClient;
  apiBase?: string;
  analyticsEndpoint?: string;
}

export function readTestRuntime(
  hostname = typeof location === "undefined" ? "" : location.hostname,
  holder: object = globalThis,
  protocol = typeof location === "undefined" ? "" : location.protocol,
): AccountTestRuntime | null {
  if (!testRuntimeAllowed(hostname, protocol)) return null;
  const runtime = (holder as { __IHURT_ACCOUNT_RUNTIME__?: AccountTestRuntime })
    .__IHURT_ACCOUNT_RUNTIME__;
  if (!runtime?.auth || typeof runtime.auth.signIn !== "function") return null;
  return runtime;
}
