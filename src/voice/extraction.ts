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

// True when every wanted word occurs, and no negator stands before it.
// "my left knee isn't burning" keeps the knee and drops "burning".
function covers(words: string[], needed: string[]) {
  return needed.every((want) => {
    const at = words.findIndex((said) => sameWord(said, want));
    return at >= 0 && !words.slice(0, at).some(isNegator);
  });
}

function tokens(clause: string) {
  return normalize(clause).split(" ").filter(Boolean);
}

// Punctuation separates clauses. "and", "but", "or", and "though" do too, so
// a denial on one side does not cancel the other. Words joined only by those
// conjunctions still count as together ("left knee and ankle").
// With `together`, the words must share one conjunction-free clause, so "my
// left knee and right foot" does not ground "left foot".
function clauseGrounds(clause: string, needed: string[], together: boolean) {
  const soft = clause
    .split(/\b(?:and|but|or|though)\b/i)
    .map(tokens)
    .filter((words) => words.length);
  if (soft.some((words) => covers(words, needed))) return true;
  if (together) return false;
  const affirmative = soft.filter((words) => !words.some(isNegator));
  return covers(affirmative.flat(), needed);
}

export function grounded(
  value: string,
  transcript: string,
  together = false,
): boolean {
  // "knee and ankle" names two parts; each must be said together on its own.
  if (together && /\b(?:and|but|or|though)\b/i.test(value))
    return value
      .split(/\b(?:and|but|or|though)\b/i)
      .every((part) => !part.trim() || grounded(part, transcript, true));
  const needed = normalize(value)
    .split(" ")
    .filter((word) => word && !stop.has(word));
  if (!needed.length) return false;
  return transcript
    .split(/[.!?;:,\n]+/)
    .some((clause) => clause.trim() && clauseGrounds(clause, needed, together));
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
  if (!grounded(words, transcript, true))
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

// Intensity counts only when the person stated that number as a rating.
// "3 days ago", "5 miles", and "at 7 am" are not ratings. When unsure, drop it
// so the follow-up question can ask.
function statesRating(transcript: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  const text = transcript
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const number = `\\b(?:${value}|${numberWords[value]})\\b`;
  const unit =
    "day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes|mile|miles|km|time|times|am|pm|o'clock";
  const notAUnit = `(?!\\s+(?:${unit})\\b)`;
  return new RegExp(
    [
      `${number}\\s+out\\s+of\\s+(?:10|ten)\\b`,
      `${number}\\s*/\\s*10\\b`,
      `\\b(?:a|an)\\s+${number}${notAUnit}`,
      `\\bpain\\s+is\\s+${number}${notAUnit}`,
      `\\brated\\s+it\\s+${number}${notAUnit}`,
      `\\blevel\\s+${number}${notAUnit}`,
      `\\bintensity\\s+${number}${notAUnit}`,
    ].join("|"),
  ).test(text);
}

export function parseIntensityAnswer(answer: string): number | null {
  const text = normalize(answer);
  const found = [
    ...text.matchAll(
      /\b(10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
    ),
  ].map((match) =>
    /^\d+$/.test(match[1]) ? Number(match[1]) : numberWords.indexOf(match[1]),
  );
  // "7 out of 10" names two numbers; the first is the rating.
  if (found.length === 2 && found[1] === 10 && /\bout of\b/.test(text))
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
  if (/\bday before yesterday\b/.test(text))
    return { phrase, date: shift(today, 2) };
  if (/\b(?:yesterday|last night)\b/.test(text))
    return { phrase, date: shift(today, 1) };
  if (
    text === "earlier" ||
    /\b(?:today|this morning|this afternoon|this evening|tonight)\b/.test(text)
  )
    return { phrase, date: today };
  const ago = text.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a) (day|days|week|weeks) ago\b/,
  );
  if (ago) {
    const n = ago[1] === "a" ? 1 : count(ago[1]);
    if (n >= 0)
      return {
        phrase,
        date: shift(today, ago[2].startsWith("week") ? n * 7 : n),
      };
  }
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
  const activity = grounded(raw.activity, transcript) ? raw.activity : "";
  const surface = grounded(raw.surface, transcript) ? raw.surface : "";
  if (activity)
    fields.activity = surface ? `${activity} on ${surface}` : activity;
  let onset: PainProposal["onset"];
  if (grounded(raw.onsetPhrase, transcript)) {
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
    if (side === "left" || side === "right")
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
