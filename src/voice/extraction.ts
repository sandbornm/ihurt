import { regionNameIn, regions, type RegionId } from "../types.ts";
import { translate, type Language, type MessageKey } from "../i18n/index.ts";
import type { RawPainExtraction } from "../platform/on-device-ai.ts";
import type { DraftFields, VoiceDraftValue } from "./draft.ts";

// The on-device model only quotes the note. Everything here is deterministic:
// a field survives only when its words appear in what the person said, and a
// location maps only to an id in the fixed anatomy list. The checks work the
// same in English and Spanish: the lexicon below holds both languages, and
// the model's own region guess is never used.

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

// Patterns run on normalized text: lowercase, accents removed. Order matters:
// "upper back" and "shoulder blade" are checked before "shoulder", and
// "dedo gordo del pie" before "pie". A bare "back", "espalda" or "dedo" is
// ambiguous and is asked about instead. "de pie" means standing, so only
// "pie" without a preceding "de" counts.
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

// Lowercase, accents removed (NFD, then combining marks dropped), punctuation
// to spaces. "Articulación" and "articulacion" compare equal; letters such as
// ñ keep their base letter instead of being dropped.
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
      // Remove the matched words so "shoulder blade" does not also count as
      // "shoulder".
      rest = rest.replace(new RegExp(pattern.source, "g"), " ");
    }
  }
  return found;
}

const leftWords = /\b(?:left|izquierd[oa]s?)\b/;
const rightWords = /\b(?:right|derech[oa]s?)\b/;
const bothWords = /\b(?:both|ambos|ambas|los dos|las dos)\b/;

// A side counts only when the person said it. "right now" and "todo derecho"
// are not sides.
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

// The side word exactly as said, such as "left" or "izquierda", so a follow-up
// answer can be added to the spoken location in the person's own words.
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
  // Spanish articles, prepositions and pronouns.
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

// Rough singular forms so "knee" matches "both knees", "foot" matches "feet",
// "rodilla" matches "rodillas" and "talon" matches "talones". Any form that
// is not in the transcript fails closed.
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

// Every meaningful word must appear in the transcript. This keeps model
// paraphrases, guesses and invented details out of the proposal.
export function grounded(value: string, transcript: string) {
  const words = normalize(value)
    .split(" ")
    .filter((word) => word && !stop.has(word));
  if (!words.length) return false;
  const said = normalize(transcript).split(" ");
  return words.every((word) => said.some((other) => matches(word, other)));
}

// The span must occur in the transcript as consecutive words, ignoring case,
// accents and plural endings. A location stitched together from words said in
// different places does not count.
export function spanIn(value: string, transcript: string) {
  const span = normalize(value).split(" ").filter(Boolean);
  const said = normalize(transcript).split(" ").filter(Boolean);
  if (!span.length) return false;
  for (let start = 0; start + span.length <= said.length; start++)
    if (span.every((word, i) => matches(word, said[start + i]))) return true;
  return false;
}

// Clauses split on punctuation and on "but", "pero", "aunque" and "sino", so
// "no es ardor, es punzante" keeps "punzante" and drops "ardor".
const clauseBreak =
  /[.,;:!?¿¡\n]+|\b(?:but|pero|aunque|sino|though|although)\b/;
// Negation cues in English and Spanish, after normalization (accents gone):
// "no es", "no me duele", "sin", "nunca", "tampoco", "ni", "ningun".
const negation =
  /\b(?:no|not|never|without|none|neither|nor|denies|deny|isn't|wasn't|don't|doesn't|didn't|aren't|weren't|haven't|hasn't|can't|nunca|jamas|sin|tampoco|ni|ningun|ninguna|ninguno|niego|niega|nada)\b|n't\b/;

const clausesOf = (transcript: string) =>
  transcript
    .split(clauseBreak)
    .map((part) => normalize(part ?? ""))
    .filter(Boolean);

// The span occurs in a clause with no negation. A phrase the person only said
// in a negated clause, such as "no me duele la rodilla", "sin hormigueo" or
// "my knee doesn't hurt", is never proposed. A clause with any negation is
// skipped whole, like the dictation suggestions do, so an unclear clause
// leads to a question rather than a guess.
export function affirmedIn(value: string, transcript: string) {
  const span = normalize(value).split(" ").filter(Boolean);
  if (!span.length) return false;
  return clausesOf(transcript).some(
    (clause) => !negation.test(clause) && spanIn(value, clause),
  );
}

// Every word is in the transcript, and the whole phrase is said at least
// once outside a negated clause.
const stated = (value: string, transcript: string) =>
  grounded(value, transcript) &&
  (spanIn(value, transcript)
    ? affirmedIn(value, transcript)
    : !clausesOf(transcript).some(
        (clause) => grounded(value, clause) && negation.test(clause),
      ));

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
  if (
    !grounded(words, transcript) ||
    !spanIn(words, transcript) ||
    !affirmedIn(words, transcript)
  )
    return { status: "unmapped", spoken: words };
  const parts = partsIn(words);
  if (parts.length === 0) return { status: "unmapped", spoken: words };
  if (parts.length > 1) return { status: "ambiguous", spoken: words };
  const part = parts[0];
  let region: string = part;
  if (sided.has(part)) {
    // A side counts only when the person said it.
    const stated =
      sideIn(words) ??
      (side === "left" || side === "right"
        ? sideIn(transcript) === side
          ? side
          : null
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
// "un" and "una" are left out: they are usually articles ("un dolor").
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

// A number counts as a rating only when it is said as one: "7 out of 10",
// "7/10", "about a six", "pain is 4", "7 de 10", "un siete", "dolor de 6",
// "intensidad 5". "3 days ago" or "hace 3 dias" is not a rating, and neither
// is a number in a negated clause.
const ratingBefore =
  /\b(?:about|around|maybe|like|roughly|a|an|is|was|at|rate|rated|rating|level|pain|intensity|un|una|como|es|era|esta|estaba|en|nivel|intensidad|calificacion|dolor|doy|daria|unos|unas)$/;
const ratingAfter =
  /^(?:out of (?:10|ten)|of (?:10|ten)|(?:de|sobre) (?:10|diez))\b/;
const notRatingAfter =
  /^(?:minutes?|hours?|days?|weeks?|months?|years?|times?|miles?|km|sets?|reps?|laps?|games?|minutos?|horas?|dias?|semanas?|meses|mes|anos?|veces|vez|kilometros?|partidos?|series|vueltas?)\b/;

export function ratedIn(transcript: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  const number = `(?:${value}|${numberWords[value]}|${spanishNumbers[value]})`;
  const slash = new RegExp(`\\b${value}\\s*/\\s*10\\b`);
  for (const part of transcript.split(clauseBreak)) {
    const clause = normalize(part ?? "");
    if (!clause) continue;
    const found = new RegExp(`\\b${number}\\b`, "g");
    for (const match of clause.matchAll(found)) {
      const before = clause.slice(0, match.index).trim();
      const after = clause.slice(match.index + match[0].length).trim();
      if (negation.test(clause) || notRatingAfter.test(after)) continue;
      if (
        slash.test(part) ||
        ratingAfter.test(after) ||
        ratingBefore.test(before)
      )
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
  // "7 out of 10" and "7 de 10" name two numbers; the first is the rating.
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

// Resolves common relative phrases in English and Spanish against the
// device's local date. Anything else keeps the person's words without a date.
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
    // A bare "earlier" or "mas temprano" could be any day, so only same-day
    // phrases resolve to today: "earlier today", "hoy", "hace un rato".
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

// Keeps the person's word, accents included, for display.
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
    if (!key || seen.has(key) || !stated(word, transcript)) continue;
    seen.add(key);
    qualities.push(word);
  }
  if (qualities.length) fields.quality = qualities.join(", ");
  if (raw.intensity !== null && ratedIn(transcript, raw.intensity))
    fields.intensity = raw.intensity;
  const activity = stated(raw.activity, transcript) ? raw.activity : "";
  const surface = stated(raw.surface, transcript) ? raw.surface : "";
  if (activity)
    fields.activity = surface
      ? translate(lang, "extraction.activityOn", { activity, surface })
      : activity;
  let onset: PainProposal["onset"];
  if (stated(raw.onsetPhrase, transcript)) {
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

// Applies the single follow-up answer without another model call. The proposal
// never asks a second question; anything still missing stays blank.
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
      // The side is added in the person's own word: "left ankle" in English,
      // "tobillo izquierdo" in Spanish, where the side follows the noun.
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

// Ticks fields the proposal newly suggests so they are not dropped on "Add to
// entry". A field that would replace a value already in the entry keeps the
// person's current choice. Fields they already saw keep their choice too.
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

// The confirm gate. Without an explicit confirmation the caller gets nothing
// to save; the proposal itself lives only in the voice panel's state.
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

// A proposed pin is drawn apart from saved pins and becomes a real pin only on
// an explicit confirm. Selecting another region or dismissing drops it.
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
