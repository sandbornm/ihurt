import {
  formatLocale,
  formatMessage,
  resolveLanguage,
  type Language,
  type Vars,
} from "./core.ts";
import { en, type MessageKey } from "./en.ts";
import { es } from "./es.ts";

export type { Language, MessageKey, Vars };
export { formatLocale, resolveLanguage };
export type LanguagePreference = "auto" | Language;

export const dictionaries = { en, es } as const;

const storageKey = "ihurt-language";
let preference: LanguagePreference = readPreference();
// In the iOS app this is replaced with Locale.preferredLanguages, because the
// web view reports the app's own localization rather than the phone's list.
let deviceLanguages: readonly string[] =
  typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
let current: Language = compute();
const listeners = new Set<() => void>();

function readPreference(): LanguagePreference {
  try {
    const saved = globalThis.localStorage?.getItem(storageKey);
    if (saved === "en" || saved === "es" || saved === "auto") return saved;
  } catch {}
  return "auto";
}

function compute(): Language {
  return preference === "auto" ? resolveLanguage(deviceLanguages) : preference;
}

function update() {
  const next = compute();
  if (typeof document !== "undefined") {
    document.documentElement.lang = formatLocale[next].split("-")[0];
    document.title = translate(next, "app.title");
  }
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export const language = () => current;
export const languagePreference = () => preference;
export const locale = (lang: Language = current) => formatLocale[lang];
export const preferredDeviceLanguages = () => deviceLanguages;

export function setLanguagePreference(next: LanguagePreference) {
  preference = next;
  try {
    globalThis.localStorage?.setItem(storageKey, next);
  } catch {}
  update();
  for (const listener of listeners) listener();
}

export function setDeviceLanguages(list: readonly string[]) {
  if (!list.length) return;
  deviceLanguages = list;
  update();
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function translate(lang: Language, key: MessageKey, vars?: Vars) {
  return formatMessage(lang, dictionaries[lang][key] ?? en[key], vars);
}

// Translates with the current language. React components call useI18n() so
// they re-render when the language changes.
export const t = (key: MessageKey, vars?: Vars) =>
  translate(current, key, vars);

// A BCP 47 tag for speech recognition and synthesis in the chosen language.
// It keeps the region from the device list when it matches, such as es-MX.
export function speechLocale(lang: Language = current) {
  // Compare the tag's own base language: "fr-FR" resolves to English for the
  // UI, but it is not an English speech locale.
  const match = deviceLanguages.find(
    (tag) => tag.split(/[-_]/)[0].toLowerCase() === lang && /[-_]/.test(tag),
  );
  return (match ?? (lang === "es" ? "es-MX" : "en-US")).replace("_", "-");
}

export function formatDate(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
  lang: Language = current,
) {
  return new Date(value).toLocaleDateString(formatLocale[lang], options);
}

export function formatDateTime(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
  lang: Language = current,
) {
  return new Date(value).toLocaleString(formatLocale[lang], options);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  lang: Language = current,
) {
  return new Intl.NumberFormat(formatLocale[lang], options).format(value);
}

export function formatList(items: string[], lang: Language = current) {
  return new Intl.ListFormat(formatLocale[lang], {
    style: "long",
    type: "conjunction",
  }).format(items);
}

update();
