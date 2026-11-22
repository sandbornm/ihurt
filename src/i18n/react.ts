import { useSyncExternalStore } from "react";
import {
  language,
  languagePreference,
  subscribeLanguage,
  t,
  locale,
} from "./index.ts";

// Re-renders the calling component when the language or preference changes.
export function useI18n() {
  const lang = useSyncExternalStore(subscribeLanguage, language, language);
  const preference = useSyncExternalStore(
    subscribeLanguage,
    languagePreference,
    languagePreference,
  );
  return { t, lang, preference, locale: locale(lang) };
}
