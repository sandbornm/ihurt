/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  readonly VITE_FEEDBACK_ENDPOINT?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_IHURT_API_BASE?: string;
  readonly VITE_PASSKEY_RP_ID?: string;
  readonly VITE_ANALYTICS_ENDPOINT?: string;
}
