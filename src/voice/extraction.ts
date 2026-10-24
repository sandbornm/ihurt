import { regionName, regions, type RegionId } from "../types.ts";
import type { RawPainExtraction } from "../platform/on-device-ai.ts";
import type { DraftFields, VoiceDraftValue } from "./draft.ts";

// The on-device model only quotes the note. Everything here is deterministic:
// a field survives only when its words appear in what the person said, and a
// location maps only to an id in the fixed anatomy list.

export const anatomyList: RegionId[] = regions.map(({ id }) => id);

type Part =
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

// Order matters: "upper back" and "shoulder blade" are checked before
// "shoulder". A bare "back" is ambiguous and is asked about instead.
const partWords: [Part, RegExp][] = [
  ["upper_back", /\b(?:upper|mid|middle) back\b|\bshoulder ?blades?\b/],
  ["lower_back", /\blower back\b|\blumbar\b/],
  ["foot", /\b(?:toes?|heels?|arch(?:es)?|foot|feet|soles?|instep|bunion)\b/],
  ["ankle", /\bankles?\b/],
  ["calf", /\bcalf\b|\bcalves\b/],
  ["knee", /\bknees?\b|\bkneecaps?\b/],
  ["thigh", /\bthighs?\b|\bhamstrings?\b|\bquads?\b|\bquadriceps\b/],
  ["hip", /\bhips?\b/],
  ["wrist", /\bwrists?\b|\bhands?\b|\bfingers?\b|\bthumbs?\b|\bpalms?\b/],
  ["elbow", /\belbows?\b/],
  ["shoulder", /\bshoulders?\b/],
  ["neck", /\bneck\b/],
  ["chest", /\bchest\b/],
  ["abdomen", /\babdomen\b|\bstomach\b|\bbelly\b/],
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
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

function sideIn(value: string): "left" | "right" | "both" | null {
  const text = normalize(value);
  const left = /\bleft\b/.test(text),
    right =
      /\bright\b/.test(text) && !/\bright (?:now|away|after)\b/.test(text);
  if (/\bboth\b/.test(text) || (left && right)) return "both";
  return left ? "left" : right ? "right" : null;
}

const sideSubjects = new Set([
  "i",
  "we",
  "he",
  "she",
  "they",
  "it",
  "that",
  "who",
]);
const sideObjects = new Set([
  "my",
  "the",
  "a",
  "an",
  "his",
  "her",
  "their",
  "our",
  "your",
  "this",
  "that",
  "it",
  "them",
  "work",
  "home",
  "early",
  "again",
]);

// The answer to "left or right?" must say one side, plainly. "not left" is a
// denial, and "I left work" uses the verb, so neither supplies a side.
function sideAnswer(reply: string): "left" | "right" | null {
  const words = normalize(reply).split(" ").filter(Boolean);
  // "no, the right one" answers the question; a leading "no" is not a denial.
  if (words[0] === "no") words.shift();
  if (words.length > 8) return null;
  const found = new Set<"left" | "right">();
  const denied = new Set<"left" | "right">();
  const notNow = ["now", "away", "after", "right"];
  words.forEach((word, i) => {
    const prev = words[i - 1] ?? "";
    const next = words[i + 1] ?? "";
    let side: "left" | "right" | null = null;
    if (
      word === "right" &&
      !notNow.includes(next) &&
      !["all", "right"].includes(prev)
    )
      side = "right";
    if (
      word === "left" &&
      (next === "one" ||
        next === "side" ||
        (!sideSubjects.has(prev) &&
          !sideObjects.has(next) &&
          !notNow.includes(next)))
    )
      side = "left";
    if (!side) return;
    // "not the left" within two words denies that side.
    const negated = words.slice(Math.max(0, i - 3), i).some(isNegator);
    (negated ? denied : found).add(side);
  });
  for (const side of denied) found.delete(side);
  return found.size === 1 ? [...found][0] : null;
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
]);

// Every meaningful word must appear in the transcript, in a clause that is
// not denying it. This keeps model paraphrases, guesses and invented details
// out of the proposal.
const irregular: Record<string, string> = {
  feet: "foot",
  calves: "calf",
  halves: "half",
  teeth: "tooth",
};

// "n't" covers isn't, don't, can't, and the rest. The bare forms are the same
// words when speech drops the apostrophe. "cannot" has no apostrophe to drop.
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
  ...contraction,
  ...contraction.map((word) => word.replaceAll("'", "")),
]);

const isNegator = (word: string) => word.includes("n't") || negators.has(word);

// For a body part, "I can't bend my left knee" says the knee is affected, not
// that it is fine. Other fields keep every negator ("I couldn't run").
const ability = new Set(["can't", "cant", "cannot", "couldn't", "couldnt"]);
const denies = (word: string, part = false) =>
  isNegator(word) && !(part && ability.has(word));

// After the value, "is not the problem" or "doesn't hurt" denies it, while
// "isn't burning, it's aching" only describes it.
const deniedAfter = new Set([
  "problem",
  "issue",
  "one",
  "where",
  "what",
  "it",
  "bothering",
  "affected",
  "involved",
]);
// "doesn't hurt" or "isn't sore" denies the part, unless hedged ("doesn't
// hurt much") or corrected by the next clause ("isn't sore, it's aching").
const hurtWords = new Set(["hurt", "hurts", "hurting", "sore", "painful"]);
const hedges = new Set([
  "much",
  "that",
  "as",
  "so",
  "too",
  "really",
  "badly",
  "a",
]);
function deniesAfter(words: string[], end: number, corrected: boolean) {
  const next = words.slice(end + 1, end + 6);
  const at = next.findIndex(isNegator);
  if (at < 0 || at >= 3) return false;
  const rest = next.slice(at + 1);
  if (rest.some((word) => deniedAfter.has(word))) return true;
  const hurt = rest.findIndex((word) => hurtWords.has(word));
  return hurt >= 0 && !corrected && !hedges.has(rest[hurt + 1] ?? "");
}

// Reduces a word to a rough singular so "knee" matches "both knees" and
// "foot" matches "feet". English only; anything else fails closed.
const singular = (word: string) =>
  irregular[word] ??
  (word.length > 3 && word.endsWith("es") && /(?:ch|sh|x|s)es$/.test(word)
    ? word.slice(0, -2)
    : word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word);

const sameWord = (said: string, want: string) =>
  said === want || singular(said) === singular(want);

// True when every wanted word occurs, no negator stands before it, and the
// words after it do not deny it. "my left knee isn't burning" keeps the knee
// and drops "burning"; "my left knee is not the problem" drops the knee.
function covers(
  words: string[],
  needed: string[],
  part = false,
  corrected = false,
) {
  let last = -1;
  const found = needed.every((want) => {
    const at = words.findIndex((said) => sameWord(said, want));
    last = Math.max(last, at);
    return at >= 0 && !words.slice(0, at).some((word) => denies(word, part));
  });
  if (!found || deniesAfter(words, last, corrected)) return false;
  // "I can't tell if my left knee is the problem" still denies it.
  const exempt = words.slice(0, last).some((word) => ability.has(word));
  return !(exempt && words.slice(last + 1).some((w) => deniedAfter.has(w)));
}

function tokens(clause: string) {
  return normalize(clause).split(" ").filter(Boolean);
}

// Punctuation separates clauses. "and", "but", "or", and "though" do too, so
// a denial on one side does not cancel the other. Words joined only by those
// conjunctions still count as together ("left knee and ankle").
// With `together`, the words must share one conjunction-free clause, so "my
// left knee and right foot" does not ground "left foot". `together` is the
// `part` marks the body-part check, where ability negators ("can't bend") do
// not deny it.
function clauseGrounds(
  clause: string,
  needed: string[],
  together: boolean,
  part: boolean,
  corrected: boolean,
) {
  const soft = clause
    .split(/\b(?:and|but|or|though)\b/i)
    .map(tokens)
    .filter((words) => words.length);
  if (soft.some((words) => covers(words, needed, part, corrected))) return true;
  if (together) return false;
  const affirmative = soft.filter((words) => !words.some(isNegator));
  return covers(affirmative.flat(), needed, false, corrected);
}

// "isn't sore, it's aching": a next clause that starts "it's ..." describes the
// pain instead. "it's fine", "it's gone" and "it's not" clear it further.
const clearing =
  /^(?:fine|ok|okay|alright|gone|over|resolved|stopped|finished|done|healed|nothing|not|no)\b|^(?:good|better|great)$/;
// "it's not gone" and "it's not better" say the pain is still there.
const stillThere =
  /^not (?:gone|over|better|fine|ok|okay|resolved|healed|finished|done)\b/;
function corrects(next: string) {
  const match = /^\s*(?:it['\u2019]s|its|it is)\s+(.*)$/i.exec(next);
  if (match === null) return false;
  const rest = normalize(match[1]);
  // "it's my ankle": the pain moved to a different part.
  if (partsIn(rest).length > 0) return false;
  return stillThere.test(rest) || !clearing.test(rest);
}

export function grounded(
  value: string,
  transcript: string,
  together = false,
  part = false,
): boolean {
  // "knee and ankle" names two parts; each must be said together on its own.
  if (together && /\b(?:and|but|or|though)\b/i.test(value))
    return value
      .split(/\b(?:and|but|or|though)\b/i)
      .every(
        (piece) => !piece.trim() || grounded(piece, transcript, true, part),
      );
  const needed = normalize(value)
    .split(" ")
    .filter((word) => word && !stop.has(word));
  if (!needed.length) return false;
  const clauses = transcript.split(/[.!?;:,\n]+/);
  return clauses.some(
    (clause, i) =>
      clause.trim() &&
      clauseGrounds(
        clause,
        needed,
        together,
        part,
        corrects(clauses[i + 1] ?? ""),
      ),
  );
}

// "left knee" or "left big toe", not the verb in "I left work because my knee
// hurts" or "I left my knee brace", nor "it hurts right at my knee".
const notModifiers = new Set([
  "my",
  "the",
  "a",
  "an",
  "his",
  "her",
  "their",
  "our",
  "your",
  "this",
  "that",
  "it",
  "at",
  "in",
  "on",
]);
function sideNextTo(side: string, transcript: string) {
  const words = normalize(transcript).split(" ");
  return words.some((word, i) => {
    if (word !== side) return false;
    const next = words[i + 1] ?? "";
    return (
      partsIn(next).length > 0 ||
      (!notModifiers.has(next) &&
        partsIn(`${next} ${words[i + 2] ?? ""}`).length > 0)
    );
  });
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
  // A side and a body part count only when said together.
  if (!grounded(words, transcript, true, true))
    return { status: "unmapped", spoken: words };
  const said = sideIn(words);
  if ((said === "left" || said === "right") && !sideNextTo(said, transcript))
    return { status: "unmapped", spoken: words };
  const parts = partsIn(words);
  if (parts.length === 0) return { status: "unmapped", spoken: words };
  if (parts.length > 1) return { status: "ambiguous", spoken: words };
  const part = parts[0];
  let region: string = part;
  if (sided.has(part)) {
    // A side counts only when the person said it.
    // The model's side is used only when the note names this one part and
    // says that side without denying it ("my knee, but not the left" asks).
    const stated =
      sideIn(words) ??
      ((side === "left" || side === "right") &&
      sideIn(transcript) === side &&
      grounded(side, transcript) &&
      // "my right knee" or "the left one", not the verb in "I left work".
      (sideNextTo(side, transcript) ||
        new RegExp(`\\bthe ${side} one\\b`).test(normalize(transcript))) &&
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

const ratingUnits =
  "day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes|mile|miles|km|time|times|am|pm|o'clock";

// Intensity counts only when the person stated that number as a rating.
// "3 days ago", "5 miles", and "at 7 am" are not ratings. When unsure, drop it
// so the follow-up question can ask.
function statesRating(transcript: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  const text = transcript
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'/ .,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const number = `\\b(?:${value}|${numberWords[value]})\\b`;
  const unit = ratingUnits;
  const notAUnit = `(?!\\s+(?:${unit})\\b)`;
  const pattern = new RegExp(
    [
      `${number}\\s+out\\s+of\\s+(?:10|ten)\\b${notAUnit}`,
      // "7/10" but not a date like "on 7/10" or "7/10/26".
      `(?<!\\b(?:on|since)\\s)${number}\\s*/\\s*10\\b(?!\\s*/)${notAUnit}`,
      `\\b(?:a|an)\\s+${number}${notAUnit}`,
      `\\bpain\\s+is\\s+${number}${notAUnit}`,
      `\\brated\\s+it\\s+${number}${notAUnit}`,
      `\\blevel\\s+${number}${notAUnit}`,
      `\\bintensity\\s+${number}${notAUnit}`,
    ].join("|"),
    "g",
  );
  // A negated rating ("not a 7", "I wouldn't call it a 7") is not a rating.
  return [...text.matchAll(pattern)].some((match) => {
    const before =
      text
        .slice(0, match.index)
        .split(/[.!?;:,\n]/)
        .pop() ?? "";
    return !before.split(" ").some(isNegator);
  });
}

export function parseIntensityAnswer(answer: string): number | null {
  const text = normalize(answer);
  // "not seven" is not a rating; the field stays blank.
  if (text.split(" ").some(isNegator)) return null;
  const digits =
    "10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten";
  const value = (word: string) =>
    /^\d+$/.test(word) ? Number(word) : numberWords.indexOf(word);
  // "7 out of 10" or "7/10": the first number is the rating, the scale is
  // the 10. A date ("on 7/10", "since 7/10", "7/10/26") or a count of days
  // ("7/10 days ago") is not one.
  const lower = answer.toLowerCase();
  const scale = lower.match(
    new RegExp(
      `\\b(${digits})\\s*(?:out of|of|/)\\s*(?:10|ten)\\b(?!\\s*/\\s*\\d)`,
    ),
  );
  if (scale) {
    const before = lower.slice(0, scale.index).trim();
    const after = lower.slice((scale.index ?? 0) + scale[0].length).trim();
    if (
      /\b(?:on|since|from|until|till|by|before|after|around)$/.test(before) ||
      new RegExp(`^(?:${ratingUnits})\\b`).test(after)
    )
      return null;
    // A second number that is not the scale ("6/10 and 4/10") is unclear.
    const rest = lower.replace(scale[0], " ");
    return new RegExp(`\\b(?:${digits})\\b`).test(rest)
      ? null
      : value(scale[1]);
  }
  if (/\d\s*\/\s*\d+\s*\/\s*\d/.test(lower)) return null;
  // "out of 10" or "/10" alone names the top of the scale, not a rating.
  const bare = lower
    .replace(/(?:out of|of|\/)\s*(?:10|ten)\b/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ");
  // "seven days ago", "7 miles" and "7 years old" are not ratings.
  const unit = new RegExp(`^(?:${ratingUnits})\\b`);
  const text2 = normalize(bare);
  const found = [...text2.matchAll(new RegExp(`\\b(${digits})\\b`, "g"))]
    .filter(
      (match) =>
        !unit.test(text2.slice(match.index + match[0].length).trim()) &&
        !/\b(?:age|aged)$/.test(text2.slice(0, match.index).trim()),
    )
    .map((match) => value(match[1]));
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

function shift(today: string, days: number) {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

export function localToday(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Resolves common relative phrases against the device's local date. Anything
// else keeps the person's words without a date. "Earlier" is today only on
// its own or with this day ("earlier today", "earlier this morning").
export function resolveOnset(
  phrase: string,
  today: string,
): { phrase: string; date?: string } {
  const text = normalize(phrase);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { phrase };
  const [y, m, d] = today.split("-").map(Number);
  if (Number.isNaN(Date.UTC(y, m - 1, d))) return { phrase };
  const count = (word: string) =>
    /^\d+$/.test(word) ? Number(word) : numberWords.indexOf(word);
  const ago = text.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a) (day|days|week|weeks) ago\b/,
  );
  if (ago) {
    const n = ago[1] === "a" ? 1 : count(ago[1]);
    if (n >= 0) {
      // "a week ago yesterday" is a day before the week-ago date.
      const tail = text.slice((ago.index ?? 0) + ago[0].length).trim();
      const nudge = /^yesterday\b/.test(tail)
        ? 1
        : /^tomorrow\b/.test(tail)
          ? -1
          : 0;
      return {
        phrase,
        date: shift(today, (ago[2].startsWith("week") ? n * 7 : n) + nudge),
      };
    }
  }
  // Counted offsets come first: "a week ago today" is a week ago.
  if (/\bday before yesterday\b/.test(text))
    return { phrase, date: shift(today, 2) };
  if (/\b(?:yesterday|last night)\b/.test(text))
    return { phrase, date: shift(today, 1) };
  if (
    text === "earlier" ||
    /\b(?:today|this morning|this afternoon|this evening|tonight)\b/.test(text)
  )
    return { phrase, date: today };
  const weekday = text.match(
    /\b(?:last |on |this past )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (weekday) {
    const current = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let back = (current - weekdays.indexOf(weekday[1]) + 7) % 7;
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
}

function followUpFor(
  location: LocationResult,
  fields: DraftFields,
): FollowUp | null {
  if (location.status === "missing" || location.status === "unmapped")
    return { key: "location", question: "Where on your body do you feel it?" };
  if (location.status === "ambiguous")
    return {
      key: "location",
      question: "Which one spot should this entry mark?",
    };
  if (location.status === "need-side")
    return {
      key: "side",
      question: `Is it your left or right ${location.part.replace("_", " ")}?`,
    };
  if (fields.intensity === undefined)
    return { key: "intensity", question: "How strong is it, from 0 to 10?" };
  return null;
}

function saidAsPhrase(value: string, transcript: string) {
  return ` ${normalize(transcript)} `.includes(` ${normalize(value)} `);
}

export function buildProposal(
  raw: RawPainExtraction,
  transcript: string,
  today: string,
): PainProposal {
  const fields: DraftFields = {};
  const qualities = [
    ...new Set(
      raw.qualities
        .map((q) => normalize(q))
        .filter((q) => q && grounded(q, transcript)),
    ),
  ];
  if (qualities.length) fields.quality = qualities.join(", ");
  if (raw.intensity !== null && statesRating(transcript, raw.intensity))
    fields.intensity = raw.intensity;
  // The activity must be said as one phrase: "running tennis" is not "went
  // running and played tennis".
  const activity =
    grounded(raw.activity, transcript) && saidAsPhrase(raw.activity, transcript)
      ? raw.activity
      : "";
  // A surface is kept only when said with this activity, so "ran on pavement
  // and played tennis on clay" never becomes "ran on clay".
  const surface =
    activity && grounded(`${raw.activity} ${raw.surface}`, transcript, true)
      ? raw.surface
      : "";
  if (activity)
    fields.activity = surface ? `${activity} on ${surface}` : activity;
  let onset: PainProposal["onset"];
  // The onset must be said as one phrase: "three miles ... weeks ago" is not
  // "three weeks ago".
  if (
    grounded(raw.onsetPhrase, transcript) &&
    saidAsPhrase(raw.onsetPhrase, transcript)
  ) {
    onset = resolveOnset(raw.onsetPhrase, today);
    fields.duration = onset.date
      ? `Since ${onset.phrase} (${onset.date})`
      : `Since ${onset.phrase}`;
  }
  const location = mapLocation(raw.spokenLocation, raw.side, transcript);
  return {
    transcript,
    location,
    fields,
    onset,
    followUp: followUpFor(location, fields),
    asked: false,
  };
}

// Applies the single follow-up answer without another model call. The proposal
// never asks a second question; anything still missing stays blank.
export function answerFollowUp(
  proposal: PainProposal,
  answer: string,
): PainProposal {
  // A reply that would be cut from the saved transcript is not used, so every
  // field keeps its source text.
  const trimmed = answer.trim().slice(0, 300);
  const reply =
    proposal.transcript.length + 1 + trimmed.length <= 3000 ? trimmed : "";
  const transcript = reply
    ? `${proposal.transcript}\n${reply}`
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
    const side = sideAnswer(reply);
    if (side)
      next.location = mapLocation(
        `${side} ${proposal.location.spoken}`,
        side,
        `${transcript} ${side} ${proposal.location.spoken}`,
      );
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

export function describeLocation(location: LocationResult) {
  switch (location.status) {
    case "mapped":
      return `${regionName(location.region)} · you said “${location.spoken}”`;
    case "missing":
      return "No body area named";
    case "need-side":
      return `You said “${location.spoken}” · left or right?`;
    case "ambiguous":
      return `You said “${location.spoken}” · more than one area`;
    default:
      return `“${location.spoken}” is not on the body map yet`;
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
    throw new Error("Confirm the proposed entry before adding it.");
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
