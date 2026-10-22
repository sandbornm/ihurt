import { dictionaries, language, t, type MessageKey } from "../i18n/index.ts";

// Native plugins send a stable code with each message. The web layer shows it
// in the app's language. An unknown code keeps the native text. Locale
// messages always refer to the chosen language, so {language} names it.
export function nativeMessage(code: unknown, fallback?: string) {
  const key = `native.${String(code)}`;
  if (typeof code !== "string" || !(key in dictionaries.en)) return fallback;
  return t(key as MessageKey, {
    language: t(`language.name.${language()}` as MessageKey),
  });
}

export function nativeError(error: unknown, fallback: string) {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  const message = error instanceof Error ? error.message : undefined;
  return new Error(nativeMessage(code, message) ?? fallback);
}
