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

// The injected test runtime is only honored on a loopback page. Production
// ihurt.app cannot install a fake session through this hook.
export function testRuntimeAllowed(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
