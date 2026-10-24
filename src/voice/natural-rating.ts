import type { DraftFields } from "./draft.ts";

// Plain speech like "a seven" or "un ocho" is not a rating the way "7 out of
// 10" is: "a five mile loop" and "a two hour drive" sound the same. So this
// only offers a number to confirm. It never fills a field by itself.
export type HeardRating = { value: number; heard: string };

const en = "zero|one|two|three|four|five|six|seven|eight|nine|ten";
const es = "cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez";
const words = `${en}|${es}`.split("|");
const value = (token: string) =>
  /^\d+$/.test(token) ? Number(token) : words.indexOf(token) % 11;
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const any = `10|[0-9]|${en}|${es}`;
// After "a" or "un", 0 and 1 read as ordinary words: "a one-off", "un uno".
const afterArticle = `10|[2-9]|${en.replace("zero|one|", "")}|${es.replace("cero|uno|", "")}`;
const article = "(?:a|an|un|una)";
const leadIn =
  "i'?d say|i would say|i guess|i think|call it|rate it|rating of|pain level(?: is| of)?|it'?s|it is|it was|feels? like|pain is|pain'?s|about|around|roughly|maybe|probably|like|" +
  "diria que|yo diria|calculo que|le pongo|pondria|seria|es|esta en|nivel(?: de dolor)?(?: de)?|dolor(?: de)?|como|mas o menos|casi";
// What may follow the number. Anything else ("miles", "hours", "-year-old")
// means it is a count or a duration.
const tail =
  "(?=\\s*$|\\s*\\.|\\s+(?:on|en|today|hoy|now|right now|ahora|ahorita|at the moment|por ahora|or so|ish|i guess|i think|maybe|creo|mas o menos|aproximadamente)\\b)";

const units =
  "hours?|hrs?|minutes?|mins?|seconds?|days?|nights?|weeks?|months?|years?|times?|horas?|minutos?|segundos?|dias?|noches?|semanas?|meses|anos?|veces|vez|miles?|millas?|km|kilometros?|metros?|steps?|pasos|pounds?|lbs?|kg|libras?|reps?|sets?|sessions?|sesiones|pills?|pastillas?|mg|ml|percent|por ciento|dollars?|pesos|blocks?|cuadras|laps?|vueltas|games?|partidos?|flights?|pisos";

export function heardRating(text: string): HeardRating | null {
  const clean = text
    .toLowerCase()
    .split(/[.!?;,\n]+/)
    .filter(
      (part) =>
        !/\b(no|not|without|never|don't|doesn't|isn't|wasn't)\b/.test(part) &&
        !/(?<![\p{L}\p{N}])(?:nunca|sin|tampoco|ningun|ninguna|ningún)(?![\p{L}\p{N}])/u.test(
          part,
        ),
    )
    .join(". ");
  const folded = fold(clean);
  const source = folded.length === clean.length ? clean : folded;
  const find = (pattern: string) =>
    [...folded.matchAll(new RegExp(pattern, "g"))].map((match) => ({
      token: match[1],
      at: match.index + match[0].lastIndexOf(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    }));
  const hits = [
    ...find(`\\b${article}\\s+(${afterArticle})\\b${tail}`),
    ...find(`\\b(?:${leadIn})\\s+(?:${article}\\s+)?(${any})\\b${tail}`),
  ];
  const places = new Map(hits.map((hit) => [hit.at, hit]));
  if (places.size !== 1) return null;
  const [hit] = places.values();
  // Any other number in the text, unless it measures something, means the
  // speaker is saying more than a rating.
  const others = [
    ...folded.matchAll(
      new RegExp(
        `(?<![\\p{L}\\p{N}])(\\d+|${any.replace("|one|", "|").replace("|uno|", "|")})(?![\\p{L}\\p{N}])(?!(?:\\s|-)+(?:${units})(?![\\p{L}\\p{N}]))`,
        "gu",
      ),
    ),
  ].filter((match) => match.index !== hit.at);
  if (others.length) return null;
  return {
    value: value(hit.token),
    heard: source
      .slice(hit.start, hit.end)
      .replace(/^\W+|\W+$/g, "")
      .trim(),
  };
}

// The fields to use once the person has tapped the chip for `accepted`.
export function fieldsWithHeardRating(
  suggestions: { fields: DraftFields; heard?: HeardRating },
  accepted: number | null,
): DraftFields {
  const { heard } = suggestions;
  return heard && accepted === heard.value
    ? { ...suggestions.fields, intensity: heard.value }
    : suggestions.fields;
}
