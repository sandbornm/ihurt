export type Language = "en" | "es";
export const languages: readonly Language[] = ["en", "es"];

export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}
export type Message = string | PluralMessage;
export type Vars = Record<string, string | number>;

export const formatLocale: Record<Language, string> = {
  en: "en-US",
  es: "es-419",
};

export function resolveLanguage(
  preferred: readonly (string | undefined | null)[],
): Language {
  for (const tag of preferred) {
    const base = String(tag ?? "")
      .trim()
      .toLowerCase()
      .split(/[-_]/)[0];
    if ((languages as readonly string[]).includes(base))
      return base as Language;
  }
  return "en";
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralForm(language: Language, count: number) {
  const tag = formatLocale[language];
  let rules = pluralRules.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRules.set(tag, rules);
  }
  return rules.select(count) as keyof PluralMessage;
}

export function formatMessage(
  language: Language,
  message: Message,
  vars: Vars = {},
): string {
  let text: string;
  if (typeof message === "string") text = message;
  else {
    const count = Number(vars.count);
    const form = Number.isFinite(count) ? pluralForm(language, count) : "other";
    text = message[form] ?? message.other;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number"
      ? new Intl.NumberFormat(formatLocale[language]).format(value)
      : value;
  });
}

export function placeholders(message: Message): string[] {
  const texts =
    typeof message === "string" ? [message] : Object.values(message);
  return [
    ...new Set(
      texts.flatMap((text) =>
        [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      ),
    ),
  ].sort();
}
