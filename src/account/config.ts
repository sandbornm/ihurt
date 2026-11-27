// Build-time public settings. Secrets stay out of Git. The website key is
// restricted to https://ihurt.app. The iOS shell calls Firebase from
// capacitor://localhost, so it uses a separate key. That key has no HTTP
// referrer restriction and no iOS bundle restriction. The WebView cannot
// present the bundle id, and capacitor://localhost is not a supported website
// referrer. Restrict it to the Identity Toolkit API and the Token Service API.

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface AccountConfig {
  firebase: FirebasePublicConfig | null;
  apiBase: string;
  analyticsEndpoint: string;
}

export interface AccountEnv {
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_IOS_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_IHURT_API_BASE?: string;
  VITE_ANALYTICS_ENDPOINT?: string;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

export function readAccountConfig(
  env: AccountEnv,
  protocol = "https:",
): AccountConfig {
  const websiteKey = clean(env.VITE_FIREBASE_API_KEY);
  const nativeKey = clean(env.VITE_FIREBASE_IOS_API_KEY);
  // A website-restricted key is rejected for capacitor://localhost. The shell
  // stays signed out until the iOS build provides its own key, and that key
  // cannot use a website or bundle restriction either.
  const apiKey = protocol === "capacitor:" ? nativeKey : websiteKey;
  const authDomain = clean(env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = clean(env.VITE_FIREBASE_PROJECT_ID);
  const appId = clean(env.VITE_FIREBASE_APP_ID);
  const firebase =
    apiKey && authDomain && projectId && appId
      ? { apiKey, authDomain, projectId, appId }
      : null;
  return {
    firebase,
    apiBase: clean(env.VITE_IHURT_API_BASE),
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
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) {
      return `${url.origin}/?emailLink=1`;
    }
  } catch {
    // A page without a usable origin uses the public auth domain below.
  }
  const domain = authDomain.trim() || "ihurt.app";
  return `https://${domain}/?emailLink=1`;
}

// The packaged iOS shell is capacitor://localhost. An email link cannot
// return there. Apple stays available.
export function emailSignInAllowed(protocol: string): boolean {
  return protocol !== "capacitor:";
}

// The iOS shell has no Google credential handoff. The web popup cannot
// finish in that web view, including the sign-in asked for before deletion.
export function googleSignInAllowed(protocol: string): boolean {
  return protocol !== "capacitor:";
}
