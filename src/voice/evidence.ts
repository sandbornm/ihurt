import type { EvidenceExtraction } from "../platform/on-device-ai.ts";
import {
  anatomyList,
  displayPhrase,
  findSpan,
  grounded,
  isFutureOnset,
  mapLocation,
  normalize,
  parseIntensityAnswer,
  partsIn,
  phraseTokens,
  ratedIn,
  resolveOnset,
  sideIn,
  type LocationResult,
} from "./extraction.ts";
import type { RegionId } from "../types.ts";

// Checks evidence spans from the on-device model. A field is kept only when
// the words are a real span of the note and the lexicon agrees. Nothing here
// guesses a value the note did not state.

export interface VerifiedExtraction {
  location: LocationResult;
  intensity: number | null;
  qualities: string[];
  onset: { phrase: string; date?: string } | null;
  activity: string | null;
}

interface Candidate {
  evidence: string;
  negated: boolean;
  sideEvidence: string;
  at: { start: number; end: number };
}

const correctionWords = new Set([
  "no",
  "nop",
  "nope",
  "wait",
  "i",
  "mean",
  "actually",
  "perdon",
  "digo",
  "mejor",
  "dicho",
  "sorry",
  "oops",
  "oh",
  "the",
  "a",
  "an",
]);

function gapText(transcript: string, left: Candidate, right: Candidate) {
  const said = phraseTokens(transcript);
  if (left.at.end <= right.at.start)
    return said.slice(left.at.end, right.at.start).join(" ");
  if (right.at.end <= left.at.start)
    return said.slice(right.at.end, left.at.start).join(" ");
  return "";
}

// "no wait", "I mean", "perdón" between two mentions. The later one wins.
// A gap that also states something else ("actually hurts") is not a correction.
function isCorrection(gap: string) {
  const text = normalize(gap);
  if (!text) return false;
  if (/^(?:no|nop|nope)$/.test(text)) return true;
  if (
    !/\b(?:no wait|wait|i mean|actually|perdon|digo|mejor dicho)\b/.test(text)
  )
    return false;
  return phraseTokens(text).every((word) => correctionWords.has(word));
}

function withoutSide(evidence: string) {
  return evidence
    .replace(/\b(?:left|right|izquierd[oa]s?|derech[oa]s?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A later side with no new body part corrects the earlier part:
// "muñeca izquierda, perdón, la derecha".
function applyCorrection(items: Candidate[], transcript: string) {
  let cut = 0;
  for (let i = 1; i < items.length; i++)
    if (isCorrection(gapText(transcript, items[i - 1], items[i]))) cut = i;
  if (!cut) return items;
  const later = items.slice(cut);
  const earlier = items.slice(0, cut);
  const sideFix = later.find(
    (item) =>
      partsIn(item.evidence).length === 0 &&
      (sideIn(item.evidence) || sideIn(item.sideEvidence)),
  );
  const part = [...earlier]
    .reverse()
    .find((item) => partsIn(item.evidence).length === 1);
  if (
    sideFix &&
    part &&
    later.every((item) => partsIn(item.evidence).length === 0)
  ) {
    const evidence = withoutSide(part.evidence) || part.evidence;
    return [
      {
        ...part,
        evidence,
        sideEvidence: sideFix.evidence,
        negated: false,
      },
    ];
  }
  return later;
}

function candidates(
  evidence: EvidenceExtraction,
  transcript: string,
): Candidate[] {
  const found: Candidate[] = [];
  for (const item of evidence.locations) {
    const at = findSpan(item.evidence, transcript);
    if (!at) continue;
    found.push({
      evidence: item.evidence.trim(),
      negated: item.negated,
      sideEvidence: item.sideEvidence.trim(),
      at,
    });
  }
  found.sort((a, b) => a.at.start - b.at.start || a.at.end - b.at.end);
  return applyCorrection(found, transcript);
}

// A side word counts when it is inside the location span, or a real span near
// it with no other body part between them. "right now" is not a side.
function attachedSide(item: Candidate, transcript: string) {
  const inside = sideIn(item.evidence);
  if (inside) return inside;
  if (!item.sideEvidence) return null;
  const side = sideIn(item.sideEvidence);
  const at = findSpan(item.sideEvidence, transcript);
  // "not the left" says the word, but the denial means it is not the side.
  if (!side || !at || !grounded(item.sideEvidence, transcript)) return null;
  const said = phraseTokens(transcript);
  const gap =
    at.end <= item.at.start
      ? said.slice(at.end, item.at.start)
      : item.at.end <= at.start
        ? said.slice(item.at.end, at.start)
        : [];
  if (gap.length > 8 || partsIn(gap.join(" ")).length > 0) return null;
  return side;
}

function locateOne(item: Candidate, transcript: string): LocationResult {
  const side = attachedSide(item, transcript);
  const modelSide =
    side === "left" || side === "right" || side === "both"
      ? side
      : "unspecified";
  const located = mapLocation(item.evidence, modelSide, transcript);
  // The side span was checked above. The rest of the note may still contain
  // the side they corrected away, so the transcript-wide fallback cannot see it.
  if (located.status === "need-side" && (side === "left" || side === "right")) {
    const region = `${side}_${located.part}`;
    if ((anatomyList as readonly string[]).includes(region))
      return {
        status: "mapped",
        region: region as RegionId,
        spoken: item.evidence,
      };
  }
  return located;
}

function chooseLocation(kept: Candidate[], transcript: string): LocationResult {
  if (!kept.length) return { status: "missing" };
  const located = kept.map((item) => ({
    item,
    location: locateOne(item, transcript),
  }));
  if (located.length === 1) return located[0].location;
  const keys = located.map((row) => {
    const parts = partsIn(row.item.evidence);
    return parts.length === 1 ? parts[0] : parts.length > 1 ? "*" : "?";
  });
  const distinct = new Set(keys);
  if (distinct.size === 1 && !distinct.has("*") && !distinct.has("?")) {
    const sides = new Set(
      located.map((row) => attachedSide(row.item, transcript)),
    );
    if (sides.has("left") && sides.has("right"))
      return {
        status: "both",
        spoken: located.map((row) => row.item.evidence).join(", "),
        side: "both",
      };
    return (
      located.find((row) => row.location.status === "mapped") ??
      located[located.length - 1]
    ).location;
  }
  const spoken = located.map((row) => row.item.evidence).join(", ");
  if (located.every((row) => row.location.status === "unmapped"))
    return { status: "unmapped", spoken };
  return { status: "ambiguous", spoken };
}

function clauseAround(transcript: string, at: { start: number; end: number }) {
  let cursor = 0;
  for (const clause of transcript.split(/[.!?;:,\n¿¡]+/)) {
    const count = phraseTokens(clause).length;
    const start = cursor;
    cursor += count;
    if (count && at.start >= start && at.end <= cursor) return clause;
  }
  return null;
}

// The evidence phrase must parse to this value. A bare number still has to
// sit in a rating-shaped clause ("the pain is 7"), never "my son is 7".
function ratingStands(evidence: string, transcript: string, value: number) {
  if (parseIntensityAnswer(evidence) !== value) return false;
  if (ratedIn(evidence, value)) return true;
  if (phraseTokens(evidence).length !== 1) return false;
  const at = findSpan(evidence, transcript);
  if (!at) return false;
  const clause = clauseAround(transcript, at);
  return clause !== null && ratedIn(clause, value);
}

function verifyIntensity(evidence: EvidenceExtraction, transcript: string) {
  const item = evidence.intensity;
  if (!item || item.negated || item.kind !== "rating") return null;
  if (!Number.isInteger(item.value) || item.value < 0 || item.value > 10)
    return null;
  if (!item.evidence || !findSpan(item.evidence, transcript)) return null;
  return ratingStands(item.evidence, transcript, item.value)
    ? item.value
    : null;
}

// "Hurts" and "dolor" name the complaint. They are not how it feels.
const painWords = new Set([
  "hurt",
  "hurts",
  "hurting",
  "pain",
  "pains",
  "duele",
  "duelen",
  "dolor",
  "dolores",
]);

function verifyQualities(evidence: EvidenceExtraction, transcript: string) {
  const seen = new Set<string>();
  const qualities: string[] = [];
  for (const item of evidence.qualities) {
    if (item.negated || !findSpan(item.evidence, transcript)) continue;
    if (!grounded(item.evidence, transcript) || painOnly(item.evidence))
      continue;
    const word = displayPhrase(item.evidence);
    const key = normalize(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    qualities.push(word);
  }
  return qualities;
}

function verifyOnset(
  evidence: EvidenceExtraction,
  transcript: string,
  today: string,
) {
  const item = evidence.onset;
  if (!item || item.negated || !item.evidence) return null;
  if (!findSpan(item.evidence, transcript)) return null;
  if (!grounded(item.evidence, transcript)) return null;
  if (isFutureOnset(item.evidence)) return null;
  const resolved = resolveOnset(item.evidence, today);
  // A date is enough. A span with no date stays only when it is a time
  // phrase ("earlier this week", "desde el verano"), not "5 miles".
  if (!resolved.date && !timePhrase(item.evidence)) return null;
  return resolved;
}

// "started this morning" is when it began, not something the person was doing.
const timeWords = new Set([
  "started",
  "start",
  "since",
  "ago",
  "yesterday",
  "today",
  "tonight",
  "morning",
  "afternoon",
  "evening",
  "night",
  "last",
  "this",
  "earlier",
  "day",
  "days",
  "week",
  "weeks",
  "hour",
  "hours",
  "month",
  "year",
  "began",
  "begin",
  "from",
  "ayer",
  "anoche",
  "hoy",
  "manana",
  "tarde",
  "noche",
  "hace",
  "desde",
  "dia",
  "dias",
  "semana",
  "semanas",
  "temprano",
  "rato",
  "empezo",
  "pasado",
  "proximo",
  "siguiente",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "esta",
  "while",
  "summer",
  "winter",
  "spring",
  "verano",
  "invierno",
  "primavera",
  "otono",
]);

const numberWords = new Set([
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
  "un",
  "una",
  "unos",
  "unas",
]);

const skipWords = new Set([
  "a",
  "an",
  "the",
  "el",
  "la",
  "los",
  "las",
  "lo",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "it",
  "my",
  "me",
]);

const hedges = new Set([
  "around",
  "about",
  "maybe",
  "like",
  "just",
  "really",
  "very",
  "so",
  "kind",
  "of",
]);

const sideWord =
  /^(?:left|right|izquierd[oa]s?|derech[oa]s?|both|ambos|ambas|dos)$/;

function contentWords(phrase: string) {
  return phraseTokens(phrase).filter(
    (word) =>
      !/^\d+$/.test(word) && !numberWords.has(word) && !skipWords.has(word),
  );
}

function timePhrase(phrase: string) {
  const words = contentWords(phrase);
  return words.length > 0 && words.every((word) => timeWords.has(word));
}

function painOnly(phrase: string) {
  const words = contentWords(phrase);
  return words.length > 0 && words.every((word) => painWords.has(word));
}

function sidePhrase(phrase: string) {
  const words = contentWords(phrase);
  return (
    words.length > 0 &&
    sideIn(phrase) !== null &&
    words.every((word) => sideWord.test(word))
  );
}

function hedgePhrase(phrase: string) {
  const words = contentWords(phrase);
  return words.length > 0 && words.every((word) => hedges.has(word));
}

function momentPhrase(phrase: string) {
  return /^(?:right now|right away|ahora mismo)$/.test(normalize(phrase));
}

function verifyActivity(evidence: EvidenceExtraction, transcript: string) {
  const activity = evidence.activity.trim();
  if (!activity || !findSpan(activity, transcript)) return null;
  if (!grounded(activity, transcript)) return null;
  if (contentWords(activity).length === 0) return null;
  if (
    timePhrase(activity) ||
    momentPhrase(activity) ||
    sidePhrase(activity) ||
    hedgePhrase(activity)
  )
    return null;
  // A body part is where it hurts, not what the person was doing.
  if (partsIn(activity).length > 0) return null;
  return activity;
}

export function verifyEvidence(
  evidence: EvidenceExtraction,
  transcript: string,
  today: string,
): VerifiedExtraction {
  // grounded() is the denial check (including "nada más", "can't", and
  // "está bien"). A model negated flag does not drop a span the lexicon
  // affirms, and it cannot keep a span the lexicon denies.
  const kept = candidates(evidence, transcript).filter((item) =>
    grounded(item.evidence, transcript, true),
  );
  return {
    location: chooseLocation(kept, transcript),
    intensity: verifyIntensity(evidence, transcript),
    qualities: verifyQualities(evidence, transcript),
    onset: verifyOnset(evidence, transcript, today),
    activity: verifyActivity(evidence, transcript),
  };
}
