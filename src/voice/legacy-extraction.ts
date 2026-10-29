import { regionNameIn, regions, type RegionId } from "../types.ts";
import { translate, type Language, type MessageKey } from "../i18n/index.ts";
import type { RawPainExtraction } from "../platform/on-device-ai.ts";
import type { DraftFields, VoiceDraftValue } from "./draft.ts";

export const anatomyList: RegionId[] = regions.map(({ id }) => id);

export type Part =
  | "foot"
  | "ankle"
  | "calf"
  | "knee"
  | "thigh"
  | "hip"
  | "wrist"
  | "elbow"
  | "shoulder"
  | "neck"
  | "chest"
  | "upper_back"
  | "lower_back"
  | "abdomen";

const sided = new Set<Part>([
  "foot",
  "ankle",
  "calf",
  "knee",
  "thigh",
  "hip",
  "wrist",
  "elbow",
  "shoulder",
]);

const partWords: [Part, RegExp][] = [
  [
    "upper_back",
    /\b(?:upper|mid|middle) back\b|\bshoulder ?blades?\b|\bparte (?:alta|superior|media) de la espalda\b|\bespalda (?:alta|superior|media)\b|\b(?:omoplatos?|escapulas?)\b/,
  ],
  [
    "lower_back",
    /\blower back\b|\blumbar\b|\bparte baja de la espalda\b|\bespalda baja\b|\bzona lumbar\b|\blumbares\b/,
  ],
  [
    "foot",
    /\b(?:toes?|heels?|arch(?:es)?|foot|feet|soles?|instep|bunion)\b|\bdedos? (?:gordos? |pequenos? |chiquitos? )?del pie\b|\bdedo gordo\b|\b(?:juanetes?|talon(?:es)?|empeines?)\b|\bplantas? del pie\b|\barco del pie\b|(?<!\bde )\bpies?\b/,
  ],
  ["ankle", /\bankles?\b|\btobillos?\b/],
  ["calf", /\bcalf\b|\bcalves\b|\b(?:pantorrillas?|gemelos?|chamorros?)\b/],
  ["knee", /\bknees?\b|\bkneecaps?\b|\b(?:rodillas?|rotulas?)\b/],
  [
    "thigh",
    /\bthighs?\b|\bhamstrings?\b|\bquads?\b|\bquadriceps\b|\b(?:muslos?|isquiotibiales|cuadriceps)\b/,
  ],
  ["hip", /\bhips?\b|\bcaderas?\b/],
  [
    "wrist",
    /\bwrists?\b|\bhands?\b|\bfingers?\b|\bthumbs?\b|\bpalms?\b|\b(?:munecas?|manos?|pulgar(?:es)?)\b|\bdedos? de la mano\b|\bpalmas? de la mano\b/,
  ],
  ["elbow", /\belbows?\b|\bcodos?\b/],
  ["shoulder", /\bshoulders?\b|\bhombros?\b/],
  ["neck", /\bneck\b|\bcuello\b|\bnuca\b/],
  ["chest", /\bchest\b|\bpecho\b|\btorax\b/],
  [
    "abdomen",
    /\babdomen\b|\bstomach\b|\bbelly\b|\b(?:estomago|panza|barriga|vientre)\b/,
  ],
];

export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function partsIn(value: string): Part[] {
  let rest = ` ${normalize(value)} `;
  const found: Part[] = [];
  for (const [part, pattern] of partWords) {
    if (pattern.test(rest)) {
      found.push(part);
      rest = rest.replace(new RegExp(pattern.source, "g"), " ");
    }
  }
  return found;
}

const leftWords = /\b(?:left|izquierd[oa]s?)\b/;
const rightWords = /\b(?:right|derech[oa]s?)\b/;
const bothWords = /\b(?:both|ambos|ambas|los dos|las dos)\b/;

function sideIn(value: string): "left" | "right" | "both" | null {
  const text = normalize(value);
  const left = leftWords.test(text),
    right =
      rightWords.test(text) &&
      !/\bright (?:now|away|after)\b/.test(text) &&
      !/\b(?:todo|siga|sigue) derecho\b/.test(text);
  if (bothWords.test(text) || (left && right)) return "both";
  return left ? "left" : right ? "right" : null;
}

function sideWordIn(value: string, side: "left" | "right") {
  const pattern = side === "left" ? leftWords : rightWords;
  const words = value.trim().split(/\s+/);
  return words.find((word) => pattern.test(normalize(word))) ?? side;
}

const stop = new Set([
  "the",
  "and",
  "my",
  "on",
  "in",
  "at",
  "of",
  "a",
  "an",
  "to",
  "was",
  "it",
  "i",
  "el",
  "la",
  "los",
  "las",
  "lo",
  "de",
  "del",
  "en",
  "mi",
  "mis",
  "y",
  "un",
  "una",
  "al",
  "me",
  "se",
  "que",
  "con",
  "por",
]);

const irregular: Record<string, string> = {
  feet: "foot",
  calves: "calf",
  halves: "half",
  teeth: "tooth",
};

function forms(word: string) {
  const out = new Set([word]);
  if (irregular[word]) out.add(irregular[word]);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    out.add(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) out.add(word.slice(0, -2));
  return out;
}

const matches = (a: string, b: string) => {
  if (a === b) return true;
  const fb = forms(b);
  for (const form of forms(a)) if (fb.has(form)) return true;
  return false;
};

const contraction = [
  "isn't",
  "wasn't",
  "don't",
  "doesn't",
  "didn't",
  "can't",
  "won't",
  "wouldn't",
  "couldn't",
  "shouldn't",
  "aren't",
  "weren't",
  "haven't",
  "hasn't",
  "hadn't",
  "mustn't",
  "ain't",
];
const negators = new Set([
  "not",
  "no",
  "never",
  "without",
  "nothing",
  "none",
  "cannot",
  "neither",
  "nor",
  "deny",
  "denies",
  ...contraction,
  ...contraction.map((word) => word.replaceAll("'", "")),
  "sin",
  "nunca",
  "jamas",
  "tampoco",
  "ni",
  "ningun",
  "ninguna",
  "ninguno",
  "nada",
  "nadie",
  "niego",
  "niega",
]);

const isNegator = (word: string) => word.includes("n't") || negators.has(word);

const ability = new Set([
  "can't",
  "cant",
  "cannot",
  "couldn't",
  "couldnt",
  "won't",
  "wont",
  "wouldn't",
  "wouldnt",
]);
const abilityVerbs = new Set([
  "puedo",
  "puede",
  "pueden",
  "podemos",
  "pude",
  "pudo",
  "pudieron",
  "podia",
  "podias",
  "podiamos",
  "podian",
  "podria",
  "podrias",
  "podriamos",
  "podrian",
  "logro",
  "logre",
  "logra",
  "lograba",
  "consigo",
  "consigue",
  "conseguia",
]);

function deniesAt(words: string[], index: number) {
  const word = words[index];
  if (!isNegator(word) || ability.has(word)) return false;
  if (word === "no" && abilityVerbs.has(words[index + 1] ?? "")) return false;
  return true;
}

const deniedAfter = new Set([
  "problem",
  "issue",
  "one",
  "where",
  "what",
  "it",
  "hurt",
  "hurts",
  "hurting",
  "sore",
  "painful",
  "bothering",
  "affected",
  "involved",
  "problema",
  "duele",
  "duelen",
  "dolia",
  "dolio",
  "molesta",
  "molestan",
  "afectada",
  "afectado",
]);
function deniesAfter(words: string[], end: number) {
  const next = words.slice(end + 1, end + 6);
  const at = next.findIndex((_, index) => deniesAt(next, index));
  return (
    at >= 0 &&
    at < 3 &&
    next.slice(at + 1).some((word) => deniedAfter.has(word))
  );
}

const conjunctions = new Set([
  "and",
  "but",
  "or",
  "though",
  "although",
  "y",
  "e",
  "pero",
  "o",
  "u",
  "aunque",
  "sino",
]);

const tokens = (text: string) => normalize(text).split(" ").filter(Boolean);

function softParts(clause: string) {
  const parts: string[][] = [[]];
  for (const word of tokens(clause))
    if (conjunctions.has(word)) parts.push([]);
    else parts[parts.length - 1].push(word);
  return parts.filter((words) => words.length);
}

const clauses = (transcript: string) =>
  transcript.split(/[.!?;:,\n¿¡]+/).filter((clause) => clause.trim());

function covers(words: string[], needed: string[]) {
  let last = -1;
  const found = needed.every((want) => {
    const at = words.findIndex((said) => matches(said, want));
    const before = at >= 0 ? words.slice(0, at) : [];
    last = Math.max(last, at);
    return at >= 0 && !before.some((_, index) => deniesAt(before, index));
  });
  return found && !deniesAfter(words, last);
}

function clauseGrounds(clause: string, needed: string[], together: boolean) {
  const soft = softParts(clause);
  if (soft.some((words) => covers(words, needed))) return true;
  if (together) return false;
  const affirmative = soft.filter(
    (words) => !words.some((_, index) => deniesAt(words, index)),
  );
  return covers(affirmative.flat(), needed);
}

export function grounded(
  value: string,
  transcript: string,
  together = false,
): boolean {
  const parts = softParts(value);
  if (together && parts.length > 1)
    return parts.every((part) => grounded(part.join(" "), transcript, true));
  const needed = tokens(value).filter((word) => !stop.has(word));
  if (!needed.length) return false;
  return clauses(transcript).some((clause) =>
    clauseGrounds(clause, needed, together),
  );
}

export function spanIn(value: string, transcript: string) {
  const span = tokens(value);
  const said = tokens(transcript);
  if (!span.length) return false;
  for (let start = 0; start + span.length <= said.length; start++)
    if (span.every((word, i) => matches(word, said[start + i]))) return true;
  return false;
}

export type LocationResult =
  | { status: "mapped"; region: RegionId; spoken: string }
  | { status: "missing" }
  | { status: "unmapped"; spoken: string }
  | { status: "ambiguous"; spoken: string }
  | { status: "need-side"; spoken: string; part: Part };

export function mapLocation(
  spoken: string,
  side: RawPainExtraction["side"],
  transcript: string,
  allowed: readonly string[] = anatomyList,
): LocationResult {
  const words = spoken.trim();
  if (!words) return { status: "missing" };
  if (!grounded(words, transcript, true) || !spanIn(words, transcript))
    return { status: "unmapped", spoken: words };
  const parts = partsIn(words);
  if (parts.length === 0) return { status: "unmapped", spoken: words };
  if (parts.length > 1) return { status: "ambiguous", spoken: words };
  const part = parts[0];
  let region: string = part;
  if (sided.has(part)) {
    const stated =
      sideIn(words) ??
      ((side === "left" || side === "right") &&
      sideIn(transcript) === side &&
      grounded(side, transcript) &&
      partsIn(transcript).length === 1
        ? side
        : null);
    if (stated !== "left" && stated !== "right")
      return { status: "need-side", spoken: words, part };
    region = `${stated}_${part}`;
  }
  if (!allowed.includes(region)) return { status: "unmapped", spoken: words };
  return { status: "mapped", region: region as RegionId, spoken: words };
}

const numberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const spanishNumbers = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
];
const numberPattern = ["10", "[0-9]", ...numberWords, ...spanishNumbers].join(
  "|",
);
const numberValue = (word: string) =>
  /^\d+$/.test(word)
    ? Number(word)
    : numberWords.includes(word)
      ? numberWords.indexOf(word)
      : spanishNumbers.indexOf(word);

const ratingBefore =
  /\b(?:about|around|maybe|like|roughly|a|an|is|was|rate|rated|rated it|rating|level|pain|intensity|un|una|como|es|era|esta|estaba|en|nivel|intensidad|calificacion|dolor|doy|daria|unos|unas)$/;
const ratingAfter =
  /^(?:out of (?:10|ten)|of (?:10|ten)|(?:de|sobre) (?:10|diez))\b/;
const notRatingAfter =
  /^(?:minutes?|hours?|days?|weeks?|months?|years?|times?|miles?|km|sets?|reps?|laps?|games?|am|pm|a m|p m|o'clock|oclock|minutos?|horas?|dias?|semanas?|meses|mes|anos?|veces|vez|kilometros?|partidos?|series|vueltas?|de la (?:manana|tarde|noche))\b/;
const scaleThenUnit =
  /^(?:out of (?:10|ten)|of (?:10|ten)|(?:de|sobre) (?:10|diez))\s+(?:minutes?|hours?|days?|weeks?|months?|years?|times?|miles?|km|sets?|reps?|laps?|games?|minutos?|horas?|dias?|semanas?|meses|anos?|veces|vez|kilometros?|partidos?|series|vueltas?)\b/;

function slashRating(clause: string, value: number) {
  const pattern = new RegExp(
    `(^|[^0-9])((?:on|since|el|desde(?:\\s+el)?)\\s+)?${value}\\s*/\\s*10\\b(\\s*/|\\s+(?:days?|times?|dias?|veces|partidos?))?`,
    "gi",
  );
  for (const match of clause.matchAll(pattern)) {
    if (match[2] || match[3]) continue;
    const before = tokens(
      clause.slice(0, (match.index ?? 0) + match[1].length),
    );
    if (before.some(isNegator)) continue;
    return true;
  }
  return false;
}

export function ratedIn(transcript: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  const number = new RegExp(
    `^(?:${value}|${numberWords[value]}|${spanishNumbers[value]})$`,
  );
  for (const clause of clauses(transcript)) {
    if (slashRating(clause, value)) return true;
    for (const words of softParts(clause))
      for (const [at, word] of words.entries()) {
        if (!number.test(word)) continue;
        const before = words.slice(0, at);
        const after = words.slice(at + 1).join(" ");
        if (
          before.some(isNegator) ||
          notRatingAfter.test(after) ||
          scaleThenUnit.test(after)
        )
          continue;
        if (ratingAfter.test(after) || ratingBefore.test(before.join(" ")))
          return true;
      }
  }
  return false;
}

export function parseIntensityAnswer(answer: string): number | null {
  const text = normalize(answer);
  const found = [...text.matchAll(new RegExp(`\\b(${numberPattern})\\b`, "g"))]
    .map((match) => numberValue(match[1]))
    .filter((value) => value >= 0);
  if (
    found.length === 2 &&
    found[1] === 10 &&
    /\b(?:out of|de|sobre)\b/.test(text)
  )
    return found[0];
  return found.length === 1 ? found[0] : null;
}

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const spanishWeekdays = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

function shift(today: string, days: number) {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

export function localToday(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function resolveOnset(
  phrase: string,
  today: string,
): { phrase: string; date?: string } {
  const text = normalize(phrase);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { phrase };
  const [y, m, d] = today.split("-").map(Number);
  if (Number.isNaN(Date.UTC(y, m - 1, d))) return { phrase };
  if (/\b(?:day before yesterday|anteayer|antier|antes de ayer)\b/.test(text))
    return { phrase, date: shift(today, 2) };
  if (/\b(?:yesterday|last night|ayer|anoche)\b/.test(text))
    return { phrase, date: shift(today, 1) };
  if (
    text === "earlier" ||
    text === "mas temprano" ||
    /\b(?:today|this morning|this afternoon|this evening|tonight|earlier this (?:morning|afternoon|evening)|a little while ago|hoy|esta manana|esta tarde|esta noche|hace un rato|hace rato|hace unas horas|hace unos minutos|mas temprano hoy)\b/.test(
      text,
    )
  )
    return { phrase, date: today };
  const ago =
    text.match(
      new RegExp(
        `\\b(\\d{1,2}|${numberWords.slice(1).join("|")}|a) (day|days|week|weeks) ago\\b`,
      ),
    ) ??
    text.match(
      new RegExp(
        `\\bhace (\\d{1,2}|un|una|${spanishNumbers.slice(1).join("|")}) (dia|dias|semana|semanas)\\b`,
      ),
    );
  if (ago) {
    const n = ["a", "un", "una"].includes(ago[1]) ? 1 : numberValue(ago[1]);
    if (n >= 0)
      return {
        phrase,
        date: shift(today, /^(?:week|semana)/.test(ago[2]) ? n * 7 : n),
      };
  }
  const weekday =
    text.match(
      /\b(?:last |on |this past )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    ) ??
    text.match(
      /\b(?:el )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/,
    );
  if (weekday) {
    const current = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const index = weekdays.includes(weekday[1])
      ? weekdays.indexOf(weekday[1])
      : spanishWeekdays.indexOf(weekday[1]);
    let back = (current - index + 7) % 7;
    if (back === 0) back = 7;
    return { phrase, date: shift(today, back) };
  }
  return { phrase };
}

export type FollowUp =
  | { key: "location"; question: string }
  | { key: "side"; question: string }
  | { key: "intensity"; question: string };

export interface PainProposal {
  transcript: string;
  location: LocationResult;
  fields: DraftFields;
  onset?: { phrase: string; date?: string };
  followUp: FollowUp | null;
  asked: boolean;
  language: Language;
}

function followUpFor(
  location: LocationResult,
  fields: DraftFields,
  lang: Language,
): FollowUp | null {
  if (location.status === "missing" || location.status === "unmapped")
    return {
      key: "location",
      question: translate(lang, "extraction.ask.location"),
    };
  if (location.status === "ambiguous")
    return {
      key: "location",
      question: translate(lang, "extraction.ask.oneSpot"),
    };
  if (location.status === "need-side")
    return {
      key: "side",
      question: translate(
        lang,
        `extraction.ask.side.${location.part}` as MessageKey,
      ),
    };
  if (fields.intensity === undefined)
    return {
      key: "intensity",
      question: translate(lang, "extraction.ask.intensity"),
    };
  return null;
}

const display = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function buildProposal(
  raw: RawPainExtraction,
  transcript: string,
  today: string,
  lang: Language = "en",
): PainProposal {
  const fields: DraftFields = {};
  const seen = new Set<string>();
  const qualities: string[] = [];
  for (const quality of raw.qualities) {
    const word = display(quality);
    const key = normalize(word);
    if (!key || seen.has(key) || !grounded(word, transcript)) continue;
    seen.add(key);
    qualities.push(word);
  }
  if (qualities.length) fields.quality = qualities.join(", ");
  if (raw.intensity !== null && ratedIn(transcript, raw.intensity))
    fields.intensity = raw.intensity;
  const activity = grounded(raw.activity, transcript) ? raw.activity : "";
  const surface =
    activity && grounded(`${raw.activity} ${raw.surface}`, transcript, true)
      ? raw.surface
      : "";
  if (activity)
    fields.activity = surface
      ? translate(lang, "extraction.activityOn", { activity, surface })
      : activity;
  let onset: PainProposal["onset"];
  if (
    grounded(raw.onsetPhrase, transcript) &&
    spanIn(raw.onsetPhrase, transcript)
  ) {
    onset = resolveOnset(raw.onsetPhrase, today);
    fields.duration = onset.date
      ? translate(lang, "extraction.sinceDate", {
          phrase: onset.phrase,
          date: onset.date,
        })
      : translate(lang, "extraction.since", { phrase: onset.phrase });
  }
  const location = mapLocation(raw.spokenLocation, raw.side, transcript);
  return {
    transcript,
    location,
    fields,
    onset,
    followUp: followUpFor(location, fields, lang),
    asked: false,
    language: lang,
  };
}

export function answerFollowUp(
  proposal: PainProposal,
  answer: string,
): PainProposal {
  const reply = answer.trim().slice(0, 300);
  const transcript = reply
    ? `${proposal.transcript}\n${reply}`.slice(0, 3000)
    : proposal.transcript;
  const next: PainProposal = {
    ...proposal,
    transcript,
    fields: { ...proposal.fields },
    followUp: null,
    asked: true,
  };
  if (!reply || !proposal.followUp) return next;
  const key = proposal.followUp.key;
  if (key === "intensity") {
    const value = parseIntensityAnswer(reply);
    if (value !== null) next.fields.intensity = value;
  } else if (key === "side" && proposal.location.status === "need-side") {
    const side = sideIn(reply);
    if (side === "left" || side === "right") {
      const word = sideWordIn(reply, side);
      const spoken =
        proposal.language === "es"
          ? `${proposal.location.spoken} ${word}`
          : `${word} ${proposal.location.spoken}`;
      next.location = mapLocation(spoken, side, `${transcript} ${spoken}`);
    }
  } else if (key === "location") {
    const location = mapLocation(reply, "unspecified", reply);
    if (location.status === "mapped") next.location = location;
  }
  return next;
}

export function proposedRegion(proposal: PainProposal): RegionId | null {
  return proposal.location.status === "mapped"
    ? proposal.location.region
    : null;
}

export function describeLocation(
  location: LocationResult,
  lang: Language = "en",
) {
  switch (location.status) {
    case "mapped":
      return translate(lang, "extraction.location.mapped", {
        region: regionNameIn(lang, location.region),
        spoken: location.spoken,
      });
    case "missing":
      return translate(lang, "extraction.location.missing");
    case "need-side":
      return translate(lang, "extraction.location.needSide", {
        spoken: location.spoken,
      });
    case "ambiguous":
      return translate(lang, "extraction.location.ambiguous", {
        spoken: location.spoken,
      });
    default:
      return translate(lang, "extraction.location.unmapped", {
        spoken: location.spoken,
      });
  }
}

export function seedSuggestedFields(
  choice: Record<string, boolean>,
  previous: DraftFields,
  next: DraftFields,
  existing: DraftFields,
): Record<string, boolean> {
  const seeded = { ...choice };
  for (const key of Object.keys(next) as (keyof DraftFields)[]) {
    if (key in previous) continue;
    const current = existing[key];
    if (current === undefined || current === null || current === "")
      seeded[key] = true;
  }
  return seeded;
}

export function confirmProposal(
  proposal: PainProposal,
  choice: {
    confirmed: boolean;
    fields: Partial<Record<keyof DraftFields, boolean>>;
    pin: boolean;
  },
): VoiceDraftValue {
  if (choice.confirmed !== true)
    throw new Error(translate(proposal.language, "extraction.confirmFirst"));
  const fields: DraftFields = {};
  for (const key of Object.keys(proposal.fields) as (keyof DraftFields)[])
    if (choice.fields[key])
      Object.assign(fields, { [key]: proposal.fields[key] });
  const region = proposedRegion(proposal);
  return {
    text: proposal.transcript,
    fields,
    ...(region ? { region, proposePin: choice.pin } : {}),
  };
}

export type ProposedPinAction =
  | { type: "propose"; region: RegionId }
  | { type: "confirm" }
  | { type: "dismiss" }
  | { type: "select"; region: RegionId | null };

export function proposedPinStep(
  state: RegionId | null,
  action: ProposedPinAction,
): { state: RegionId | null; command: "pin-center" | null } {
  switch (action.type) {
    case "propose":
      return { state: action.region, command: null };
    case "confirm":
      return { state: null, command: state ? "pin-center" : null };
    case "dismiss":
      return { state: null, command: null };
    case "select":
      return { state: action.region === state ? state : null, command: null };
  }
}
