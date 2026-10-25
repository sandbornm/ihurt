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
// Same length as the input, so a position in the folded text is a position in
// the original. That keeps accents and casing when the phrase is quoted back.
const fold = (text: string) =>
  [...text]
    .map((char) => {
      const base = char.normalize("NFD").slice(0, char.length).toLowerCase();
      return base.length === char.length ? base : char;
    })
    .join("");

const any = `10|[0-9]|${en}|${es}`;
// After "a" or "un", 0 and 1 read as ordinary words: "a one-off", "un uno".
const afterArticle = `10|[2-9]|${en.replace("zero|one|", "")}|${es.replace("cero|uno|", "")}`;
const article = "(?:a|an|un|una)";
// Only words that point at the rating itself. Bare "about", "like", "es" or
// "como" also lead into ages, times and distances ("mi hijo es 8").
const leadIn =
  "i'?d say|i would say|call it|rate it|rating of|pain level(?: is| of)?|pain intensity(?: is)?|intensity(?: is| of)?|pain is|pain'?s|feels? like|" +
  "diria que|yo diria|calculo que|le pongo|pondria|nivel(?: de dolor)?(?: de| es)?|dolor(?: de| es)?|intensidad(?: de| es)?";
// What may follow the number. Anything else ("miles", "hours", "-year-old")
// means it is a count or a duration.
const tail =
  "(?=\\s*$|\\s*\\.|\\s+(?:today|hoy|now|right now|ahora|ahorita|at the moment|por ahora|or so|ish|i guess|i think|maybe|creo|sin duda|mas o menos|aproximadamente)\\b)";

const units =
  "hours?|hrs?|minutes?|mins?|seconds?|days?|nights?|weeks?|months?|years?|times?|horas?|minutos?|segundos?|dias?|noches?|semanas?|meses|anos?|veces|vez|miles?|millas?|km|kilometros?|metros?|steps?|pasos|pounds?|lbs?|kg|libras?|reps?|sets?|sessions?|sesiones|pills?|pastillas?|mg|ml|percent|por ciento|dollars?|pesos|blocks?|cuadras|laps?|vueltas|games?|partidos?|flights?|pisos";

export function heardRating(text: string): HeardRating | null {
  const source = text
    .normalize("NFC")
    .split(/[.!?;,\n]+/)
    .filter((part) => {
      // "sin duda" is "no doubt", not a denial.
      const said = fold(part).replace(/\bsin duda\b/g, "");
      return (
        !/\b(no|not|without|never|don't|doesn't|isn't|wasn't)\b/.test(said) &&
        !/(?<![\p{L}\p{N}])(?:nunca|sin|tampoco|ningun|ninguna)(?![\p{L}\p{N}])/u.test(
          said,
        )
      );
    })
    .join(". ");
  const folded = fold(source);
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

// The chip for a heard number: shown while the model has not given its own
// intensity and the person has not tapped yet. This holds with or without a
// model draft, so a number tapped early is not lost when the draft arrives.
export function offeredRating(
  fields: DraftFields,
  heard: HeardRating | undefined,
  accepted: number | null,
): HeardRating | null {
  if (!heard || fields.intensity !== undefined || accepted === heard.value)
    return null;
  return heard;
}

// `fields` plus the heard number, once the person has tapped it. The model's
// own intensity is never replaced.
export function applyHeardRating(
  fields: DraftFields,
  heard: HeardRating | undefined,
  accepted: number | null,
): DraftFields {
  return heard && accepted === heard.value && fields.intensity === undefined
    ? { ...fields, intensity: heard.value }
    : fields;
}

// The fields to use once the person has tapped the chip for `accepted`.
export function fieldsWithHeardRating(
  suggestions: { fields: DraftFields; heard?: HeardRating },
  accepted: number | null,
): DraftFields {
  return applyHeardRating(suggestions.fields, suggestions.heard, accepted);
}
