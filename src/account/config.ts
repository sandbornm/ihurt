// Build-time public settings. Secrets stay out of Git. The Firebase web key
// is still restricted to ihurt.app in Google Cloud; this file only reads env.

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  passkeyRpId: string;
}

export interface AccountConfig {
  firebase: FirebasePublicConfig | null;
  apiBase: string;
  passkeyRpId: string;
  analyticsEndpoint: string;
}

export interface AccountEnv {
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_IHURT_API_BASE?: string;
  VITE_PASSKEY_RP_ID?: string;
  VITE_ANALYTICS_ENDPOINT?: string;
}

const PASSKEY_RP_ID = "ihurt.app";

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

export function readAccountConfig(env: AccountEnv): AccountConfig {
  const apiKey = clean(env.VITE_FIREBASE_API_KEY);
  const authDomain = clean(env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = clean(env.VITE_FIREBASE_PROJECT_ID);
  const appId = clean(env.VITE_FIREBASE_APP_ID);
  const passkeyRpId = clean(env.VITE_PASSKEY_RP_ID) || PASSKEY_RP_ID;
  const firebase =
    apiKey && authDomain && projectId && appId
      ? { apiKey, authDomain, projectId, appId, passkeyRpId }
      : null;
  return {
    firebase,
    apiBase: clean(env.VITE_IHURT_API_BASE),
    passkeyRpId,
    analyticsEndpoint: clean(env.VITE_ANALYTICS_ENDPOINT),
  };
}

// The injected test runtime is only honored on a loopback web page. Production
// ihurt.app cannot install a fake session through this hook. The iOS shell is
// capacitor://localhost, and that page must not honor the hook either.
export function testRuntimeAllowed(hostname: string, protocol = ""): boolean {
  if (protocol === "capacitor:") return false;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

// Email links have to land on an https host Firebase allows, or on loopback
// http during local development. The iOS shell's capacitor://localhost origin
// is not an authorized domain.
export function emailContinueUrl(pageUrl: string, authDomain: string): string {
  try {
    const url = new URL(pageUrl);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) {
      return `${url.origin}/?emailLink=1`;
    }
  } catch {
    // A page without a usable origin uses the public auth domain below.
  }
  const domain = authDomain.trim() || "ihurt.app";
  return `https://${domain}/?emailLink=1`;
}

// The packaged iOS shell cannot receive the email link. Apple, Google, and
// passkeys stay available there.
export function emailSignInAllowed(protocol: string): boolean {
  return protocol !== "capacitor:";
}
