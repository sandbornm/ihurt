import { useSyncExternalStore } from "react";
import {
  language,
  languagePreference,
  subscribeLanguage,
  t,
  locale,
} from "./index.ts";

export function useI18n() {
  const lang = useSyncExternalStore(subscribeLanguage, language, language);
  const preference = useSyncExternalStore(
    subscribeLanguage,
    languagePreference,
    languagePreference,
  );
  return { t, lang, preference, locale: locale(lang) };
}
