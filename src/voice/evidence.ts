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
  sideAt,
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
  "el",
  "la",
  "mi",
  "my",
  "um",
  "eh",
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

interface TokenSpan {
  start: number;
  end: number;
}

function clauseBounds(transcript: string) {
  const bounds: { start: number; end: number; text: string }[] = [];
  let cursor = 0;
  for (const clause of transcript.split(/[.!?;:,\n¿¡]+/)) {
    const count = phraseTokens(clause).length;
    const start = cursor;
    cursor += count;
    if (count) bounds.push({ start, end: cursor, text: clause });
  }
  return bounds;
}

function clauseAt(transcript: string, at: TokenSpan) {
  return (
    clauseBounds(transcript).find(
      (bound) => at.start >= bound.start && at.end <= bound.end,
    ) ?? null
  );
}

// "izquierda" was said as "izquierdo". Only the side adjective flips gender.
function sideToken(want: string, said: string) {
  if (want === said) return true;
  const stem = (word: string) => word.replace(/[oa]s?$/, "");
  return (
    /^(?:izquierd|derech)/.test(want) &&
    /^(?:izquierd|derech)/.test(said) &&
    stem(want) === stem(said)
  );
}

function sideSpans(value: string, transcript: string): TokenSpan[] {
  const span = phraseTokens(value);
  const said = phraseTokens(transcript);
  const found: TokenSpan[] = [];
  if (!span.length) return found;
  for (let start = 0; start + span.length <= said.length; start++)
    if (
      span.every(
        (word, index) =>
          word === said[start + index] || sideToken(word, said[start + index]),
      )
    )
      found.push({ start, end: start + span.length });
  return found;
}

// The matched word has to be a side in this spot. "right now", "all right",
// and the verb "left" do not count.
const sideIntro = new Set([
  "the",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "a",
  "an",
  "on",
  "to",
  "el",
  "la",
  "los",
  "las",
  "al",
  "lado",
  "del",
  "this",
  "that",
  "either",
  "side",
  "un",
  "una",
  "mi",
]);

// "turn right" at the end of a clause is a direction. "on the right" is a side.
function directionRight(transcript: string, index: number) {
  const said = phraseTokens(transcript);
  if (said[index] !== "right") return false;
  const clause = clauseAt(transcript, { start: index, end: index + 1 });
  if (!clause || index !== clause.end - 1) return false;
  const prev = said[index - 1] ?? "";
  if (!prev || index - 1 < clause.start) return false;
  return !sideIntro.has(prev);
}

function realSideAt(
  transcript: string,
  at: TokenSpan,
  side: "left" | "right" | "both",
) {
  if (side === "both") return true;
  const said = phraseTokens(transcript);
  for (let index = at.start; index < at.end; index++) {
    if (side === "right" && directionRight(transcript, index)) continue;
    if (sideAt(said, index) === side) return true;
  }
  return false;
}

const sideOnlyWord =
  /^(?:left|right|side|one|on|of|the|my|a|an|el|la|los|las|lado|del|de|al|izquierd[oa]s?|derech[oa]s?|both|ambos|ambas|dos)$/;
const sleptWord =
  /\b(?:slept|sleeping|sleep|lay|lie|lies|lying|laying|laid|reclin\w*|dorm\w*|durm\w*|acost\w*|tumb\w*|echad\w*|recost\w*)\b/;

// "the left one" and "I mean the left one" can give a side to the part.
// "I slept on the left side" cannot.
function sideOnlyClause(text: string) {
  if (sleptWord.test(normalize(text)) || partsIn(text).length > 0) return false;
  const words = phraseTokens(text).filter((word) => !correctionWords.has(word));
  return (
    words.length > 0 &&
    sideIn(words.join(" ")) !== null &&
    words.every((word) => sideOnlyWord.test(word))
  );
}

// Same joiners as extraction.ts. A side does not cross one to reach a part.
const spanConjunction = new Set([
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

const sideBridge = new Set(["of", "de", "del"]);
const sideDeterminer = new Set([
  "the",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "a",
  "an",
  "el",
  "la",
  "los",
  "las",
  "mi",
  "mis",
  "tu",
  "su",
  "un",
  "una",
]);

function sideNoun(said: string[], index: number) {
  const word = said[index] ?? "";
  const next = said[index + 1] ?? "";
  const prev = said[index - 1] ?? "";
  if ((word === "left" || word === "right") && next === "side") return true;
  if (word === "side" && (prev === "left" || prev === "right")) return true;
  if (prev === "lado" && (/^izquierd/.test(word) || /^derech/.test(word)))
    return true;
  if (word === "lado" && (/^izquierd/.test(next) || /^derech/.test(next)))
    return true;
  return false;
}

// Where the "of" after "left side" / "lado izquierdo" would be, or -1.
function sideNounBridge(said: string[], index: number) {
  const word = said[index] ?? "";
  const next = said[index + 1] ?? "";
  const prev = said[index - 1] ?? "";
  if ((word === "left" || word === "right") && next === "side")
    return index + 2;
  if (word === "side" && (prev === "left" || prev === "right"))
    return index + 1;
  if (prev === "lado") return index + 1;
  if (word === "lado") return index + 2;
  return -1;
}

// "left side of my knee" holds the part. "left side" and "left side and my
// knee" do not.
function partInSideNoun(said: string[], index: number, part: TokenSpan) {
  const bridgeAt = sideNounBridge(said, index);
  if (bridgeAt < 0 || !sideBridge.has(said[bridgeAt] ?? "")) return false;
  let cursor = bridgeAt + 1;
  while (sideDeterminer.has(said[cursor] ?? "")) cursor += 1;
  if (part.start < cursor || part.start - cursor > 3) return false;
  return !said
    .slice(cursor, part.start)
    .some((token) => spanConjunction.has(token));
}

// "the left side of the bed" belongs to the bed, and in a sleep or lying
// clause "left side" is not the part's side unless the part sits in that noun
// phrase. A bare "on the left" while lying down must touch the part.
function sleepSideMissesPart(
  said: string[],
  side: TokenSpan,
  part: TokenSpan,
  clauseText: string,
) {
  const sleeping = sleptWord.test(normalize(clauseText));
  for (let index = side.start; index < side.end; index++) {
    if (!sideNoun(said, index)) continue;
    const bridge = sideNounBridge(said, index);
    const owned = bridge >= 0 && sideBridge.has(said[bridge] ?? "");
    if (sleeping || owned) return !partInSideNoun(said, index, part);
    return false;
  }
  if (!sleeping) return false;
  const gap =
    side.end <= part.start
      ? part.start - side.end
      : part.end <= side.start
        ? side.start - part.end
        : 0;
  return gap > 0;
}

function sideReachable(part: TokenSpan, at: TokenSpan, transcript: string) {
  const partClause = clauseAt(transcript, part);
  const sideClause = clauseAt(transcript, at);
  if (!partClause || !sideClause) return false;
  const same =
    partClause.start === sideClause.start && partClause.end === sideClause.end;
  if (!same && !sideOnlyClause(sideClause.text)) return false;
  const said = phraseTokens(transcript);
  const gap =
    at.end <= part.start
      ? said.slice(at.end, part.start)
      : part.end <= at.start
        ? said.slice(part.end, at.start)
        : [];
  if (gap.some((word) => spanConjunction.has(word))) return false;
  const clauseText = same ? partClause.text : sideClause.text;
  if (sleepSideMissesPart(said, at, part, clauseText)) return false;
  return gap.length <= 8 && partsIn(gap.join(" ")).length === 0;
}

function sideInside(item: Candidate, transcript: string) {
  const side = sideIn(item.evidence);
  if (!side) return null;
  if (side === "both") return side;
  const said = phraseTokens(transcript);
  for (let index = item.at.start; index < item.at.end; index++) {
    const word = said[index];
    const at = { start: index, end: index + 1 };
    if (
      side === "left" &&
      (word === "left" || /^izquierd/.test(word)) &&
      realSideAt(transcript, at, "left")
    )
      return "left" as const;
    if (
      side === "right" &&
      (word === "right" || /^derech/.test(word)) &&
      realSideAt(transcript, at, "right")
    )
      return "right" as const;
  }
  return null;
}

// A side in the same clause, or in a clause that only names a side.
// "not the left" stays denied. Gender on the adjective still matches.
function sideFromPhrase(phrase: string, item: Candidate, transcript: string) {
  const side = sideIn(phrase);
  if (side !== "left" && side !== "right" && side !== "both") return null;
  const said = phraseTokens(transcript);
  for (const at of sideSpans(phrase, transcript)) {
    if (!realSideAt(transcript, at, side)) continue;
    if (!sideReachable(item.at, at, transcript)) continue;
    const actual = said.slice(at.start, at.end).join(" ");
    if (!grounded(actual, transcript, true, true)) continue;
    if (side === "both" && clockDos(said, at)) continue;
    return side;
  }
  return null;
}

function sidesInRange(
  transcript: string,
  from: number,
  to: number,
  part: TokenSpan,
) {
  const said = phraseTokens(transcript);
  const sides = new Set<"left" | "right">();
  for (let index = from; index < to; index++) {
    const word = said[index];
    const side =
      word === "left" || /^izquierd/.test(word)
        ? "left"
        : word === "right" || /^derech/.test(word)
          ? "right"
          : null;
    if (!side) continue;
    const at = { start: index, end: index + 1 };
    if (
      !realSideAt(transcript, at, side) ||
      !sideReachable(part, at, transcript)
    )
      continue;
    if (!grounded(word, transcript, true, true)) continue;
    sides.add(side);
  }
  return sides;
}

const clockTail =
  /^(?:y (?:media|cuarto|diez|veinte|veinticinco|cinco|quince|treinta|\d+)|en punto|menos (?:cuarto|diez|veinte|veinticinco|cinco|quince|\d+)|de la (?:tarde|manana|noche|madrugada))\b/;
const clockLead = new Set([
  "a",
  "desde",
  "hasta",
  "sobre",
  "eran",
  "son",
  "pasadas",
  "antes",
  "como",
  "tipo",
]);
const partLinks = new Set([
  "de",
  "mis",
  "mi",
  "tus",
  "sus",
  "los",
  "las",
  "del",
]);

// "a las dos" and "las dos de la tarde" are clock time, not both sides. "a las
// dos rodillas" and "a las dos de mis rodillas" are both knees.
function clockDos(said: string[], at: TokenSpan) {
  if (at.end - at.start !== 2) return false;
  const first = said[at.start] ?? "";
  if (!((first === "los" || first === "las") && said[at.start + 1] === "dos"))
    return false;
  if (clockTail.test(said.slice(at.end, at.end + 4).join(" "))) return true;
  let cursor = at.end;
  while (partLinks.has(said[cursor] ?? "") && cursor < at.end + 3) cursor += 1;
  if (partsIn(said[cursor] ?? "").length > 0) return false;
  return clockLead.has(said[at.start - 1] ?? "");
}

function bothSpans(transcript: string): TokenSpan[] {
  const said = phraseTokens(transcript);
  const found: TokenSpan[] = [];
  for (let index = 0; index < said.length; index++) {
    const word = said[index];
    if (word === "both" || word === "ambos" || word === "ambas")
      found.push({ start: index, end: index + 1 });
    if ((word === "los" || word === "las") && said[index + 1] === "dos") {
      const at = { start: index, end: index + 2 };
      if (!clockDos(said, at)) found.push(at);
    }
  }
  return found;
}

// "both knees", "las dos rodillas", "ambas rodillas", "ambos tobillos".
// The both-word has to modify this part. "both braces and my knee" does not,
// and neither does "a las dos".
function bothAttached(item: Candidate, transcript: string) {
  const clause = clauseAt(transcript, item.at);
  if (!clause || partsIn(clause.text).length !== 1) return false;
  const said = phraseTokens(transcript);
  return bothSpans(transcript).some((at) => {
    if (!sideReachable(item.at, at, transcript)) return false;
    const gap =
      at.end <= item.at.start
        ? said.slice(at.end, item.at.start)
        : item.at.end <= at.start
          ? said.slice(item.at.end, at.start)
          : [];
    return gap.every((word) => sideOnlyWord.test(word));
  });
}

// The model omitted sideEvidence, but this clause has one part and one real
// side: "pain on the left side of my knee", "my knee hurts on the left".
// "the left one" in the next clause counts. "I slept on the left side" does not.
function clauseSide(item: Candidate, transcript: string) {
  const clause = clauseAt(transcript, item.at);
  if (!clause || partsIn(clause.text).length !== 1) return null;
  const here = sidesInRange(transcript, clause.start, clause.end, item.at);
  const sides = new Set(here);
  if (!sides.size) {
    for (const other of clauseBounds(transcript)) {
      if (other.start === clause.start || !sideOnlyClause(other.text)) continue;
      for (const side of sidesInRange(
        transcript,
        other.start,
        other.end,
        item.at,
      ))
        sides.add(side);
    }
  }
  if (sides.size !== 1) return null;
  return [...sides][0];
}

const joinAnd = new Set(["and", "y", "e", "plus", "also"]);
const joinOr = new Set(["or", "o", "u"]);
const joinFiller = new Set([
  ...joinAnd,
  ...joinOr,
  "the",
  "my",
  "your",
  "el",
  "la",
  "mi",
  "su",
  "tu",
  "del",
  "lado",
  "side",
]);

// "left and right knee", "rodilla izquierda y derecha": two sides joined by
// "and" around the one part mean both, even when the model kept only one.
function coordinatedSides(
  item: Candidate,
  transcript: string,
  joiners: Set<string>,
) {
  const clause = clauseAt(transcript, item.at);
  if (!clause || partsIn(clause.text).length !== 1) return false;
  const said = phraseTokens(transcript);
  const sides: { index: number; side: "left" | "right" }[] = [];
  for (let index = clause.start; index < clause.end; index++) {
    const word = said[index];
    const side =
      word === "left" || /^izquierd/.test(word)
        ? "left"
        : word === "right" || /^derech/.test(word)
          ? "right"
          : null;
    if (!side) continue;
    if (!realSideAt(transcript, { start: index, end: index + 1 }, side))
      continue;
    sides.push({ index, side });
  }
  for (let i = 0; i + 1 < sides.length; i++) {
    const a = sides[i];
    const b = sides[i + 1];
    if (a.side === b.side) continue;
    const between = said.slice(a.index + 1, b.index);
    if (!between.some((word) => joiners.has(word))) continue;
    if (!between.every((word) => joinFiller.has(word))) continue;
    // The part touches the pair: "left and right knee" or "rodilla izquierda
    // y derecha", with only filler words in between.
    const filler = (words: string[]) =>
      words.every((word) => sideOnlyWord.test(word) || word === "of");
    const part = said.findIndex(
      (word, index) =>
        index >= clause.start && index < clause.end && partsIn(word).length > 0,
    );
    if (part < 0) continue;
    if (part > b.index && filler(said.slice(b.index + 1, part))) return true;
    if (part < a.index && filler(said.slice(part + 1, a.index))) return true;
  }
  return false;
}

// A side word counts when it is inside the location span, or a real span in
// the same clause. "right now" is not a side.
function attachedSide(item: Candidate, transcript: string) {
  if (coordinatedSides(item, transcript, joinAnd)) return "both";
  return (
    sideInside(item, transcript) ??
    (item.sideEvidence
      ? sideFromPhrase(item.sideEvidence, item, transcript)
      : null) ??
    (bothAttached(item, transcript) ? ("both" as const) : null) ??
    clauseSide(item, transcript)
  );
}

function locateOne(item: Candidate, transcript: string): LocationResult {
  // "left or right knee" is one side, not known which: ask.
  const alternatives = partsIn(item.evidence);
  if (alternatives.length === 1 && coordinatedSides(item, transcript, joinOr))
    return {
      status: "need-side",
      spoken: item.evidence,
      part: alternatives[0],
    };
  const side = attachedSide(item, transcript);
  const modelSide =
    side === "left" || side === "right" || side === "both"
      ? side
      : "unspecified";
  const located = mapLocation(item.evidence, modelSide, transcript);
  // The side span was checked above. The rest of the note may still contain
  // the side they corrected away, so the transcript-wide fallback cannot see it.
  if (located.status === "need-side" && side === "both")
    return { status: "both", spoken: item.evidence, side: "both" };
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

// "siete" and "7" are the same rating token. The rest of the span must match.
const digitFor: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  cero: "0",
  uno: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
};

function countDos(said: string[], index: number) {
  const word = said[index] ?? "";
  return (
    (word === "dos" || word === "2") &&
    (said[index - 1] === "los" || said[index - 1] === "las")
  );
}

function intensitySpans(evidence: string, transcript: string) {
  const span = phraseTokens(evidence);
  const said = phraseTokens(transcript);
  const found: { start: number; end: number }[] = [];
  if (!span.length) return found;
  const options = span.map((word) => {
    if (digitFor[word]) return [word, digitFor[word]];
    const names = Object.entries(digitFor)
      .filter(([, digit]) => digit === word)
      .map(([name]) => name);
    return names.length ? [word, ...names] : [word];
  });
  const alias = options.some((list) => list.length > 1);
  if (!alias) {
    const exact = findSpan(evidence, transcript);
    if (exact && !(span.length === 1 && countDos(said, exact.start)))
      found.push(exact);
    return found;
  }
  for (let start = 0; start + span.length <= said.length; start++) {
    if (!span.every((_, index) => options[index].includes(said[start + index])))
      continue;
    if (span.length === 1 && countDos(said, start)) continue;
    found.push({ start, end: start + span.length });
  }
  return found;
}

// The "dos" in "las dos" is not a rating. Keep looking for a rating-shaped span.
function intensitySpan(evidence: string, transcript: string) {
  const found = intensitySpans(evidence, transcript);
  if (!found.length) return null;
  const value = parseIntensityAnswer(evidence);
  if (value === null) return found[0];
  return (
    found.find((at) => {
      const clause = clauseAround(transcript, at);
      return clause !== null && ratedIn(clause, value);
    }) ?? found[0]
  );
}

// The evidence phrase must parse to this value, and the note must state that
// rating. A bare number still has to sit in a rating-shaped clause ("the pain
// is 7"), never "my son is 7" or "siete días".
function ratingStands(evidence: string, transcript: string, value: number) {
  if (parseIntensityAnswer(evidence) !== value) return false;
  if (!ratedIn(transcript, value)) return false;
  if (ratedIn(evidence, value)) return true;
  if (phraseTokens(evidence).length !== 1) return false;
  const at = intensitySpan(evidence, transcript);
  if (!at) return false;
  const clause = clauseAround(transcript, at);
  return clause !== null && ratedIn(clause, value);
}

function verifyIntensity(evidence: EvidenceExtraction, transcript: string) {
  const item = evidence.intensity;
  if (!item?.evidence) return null;
  const parsed = parseIntensityAnswer(item.evidence);
  if (parsed === null) return null;
  // "not a 7 but an 8" keeps 8 even when the model flags the span negated
  // or still echoes the rejected number.
  const correction = /\b(?:but|sino)\b/.test(normalize(item.evidence));
  if (item.kind !== "rating" && !correction) return null;
  if (!correction && item.value !== parsed) return null;
  if (!intensitySpan(item.evidence, transcript)) return null;
  return ratingStands(item.evidence, transcript, parsed) ? parsed : null;
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
  "aches",
]);

function verifyQualities(evidence: EvidenceExtraction, transcript: string) {
  const seen = new Set<string>();
  const qualities: string[] = [];
  for (const item of evidence.qualities) {
    if (item.negated || !findSpan(item.evidence, transcript)) continue;
    if (
      !grounded(item.evidence, transcript) ||
      painOnly(item.evidence) ||
      hedgePhrase(item.evidence)
    )
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
  if (onsetBlocked(item.evidence, transcript)) return null;
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
  "como",
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

// "can't walk" and "no pude ayer" did not happen. "I ran but I couldn't play
// tennis" still keeps "ran", because a verb follows the inability.
const blockedActivity =
  /\b(?:can't|cannot|couldn't|won't|wouldn't|cant|couldnt|wont|wouldnt|no puedo|no pude|no podia|no podria)\b/;

function unanswered(after: string[]) {
  const match = after
    .join(" ")
    .match(
      /^(?:but |pero )?(?:i )?(?:can't|cannot|couldn't|won't|wouldn't|cant|couldnt|wont|wouldnt|no puedo|no pude|no podia|no podria)\b(.*)$/,
    );
  if (!match) return false;
  return phraseTokens(match[1]).every(
    (word) => timeWords.has(word) || skipWords.has(word),
  );
}

function activityBlocked(activity: string, transcript: string) {
  if (blockedActivity.test(normalize(activity))) return true;
  const at = findSpan(activity, transcript);
  if (!at) return false;
  const said = phraseTokens(transcript);
  const before = said.slice(Math.max(0, at.start - 4), at.start).join(" ");
  if (blockedActivity.test(before)) return true;
  return unanswered(said.slice(at.end, at.end + 6));
}

// "ayer" after "no pude" is when they failed to go, not when the pain started.
// A start in the same clause ("it began this morning") still counts.
const failedPlan =
  /\b(?:can't|cannot|couldn't|cant|couldnt|didn't|didnt|no puedo|no pude|no podia|no podria|no fui|no fue)\b/;
const startCue =
  /\b(?:desde|since|empezo|comenzo|started|start|began|hace|ago|from)\b/;

function onsetBlocked(evidence: string, transcript: string) {
  const at = findSpan(evidence, transcript);
  if (!at || startCue.test(normalize(evidence))) return false;
  let cursor = 0;
  for (const clause of transcript.split(/[.!?;:,\n¿¡]+/)) {
    const words = phraseTokens(clause);
    const start = cursor;
    cursor += words.length;
    if (!words.length || at.start < start || at.end > cursor) continue;
    const localStart = at.start - start;
    const localEnd = at.end - start;
    let partStart = 0;
    let current: string[] = [];
    const parts: { from: number; to: number; text: string }[] = [];
    const push = (to: number) => {
      if (current.length)
        parts.push({ from: partStart, to, text: current.join(" ") });
    };
    words.forEach((word, index) => {
      if (spanConjunction.has(word)) {
        push(index);
        current = [];
        partStart = index + 1;
      } else {
        if (!current.length) partStart = index;
        current.push(word);
      }
    });
    push(words.length);
    const part = parts.find(
      (item) => localStart >= item.from && localEnd <= item.to,
    );
    if (!part) return false;
    return failedPlan.test(part.text) && !startCue.test(part.text);
  }
  return false;
}

const gearWord = new Set([
  "raqueta",
  "raquetas",
  "racket",
  "rackets",
  "racquet",
  "racquets",
  "brace",
  "braces",
  "pelota",
  "pelotas",
  "ball",
  "balls",
  "balon",
  "balones",
  "vendaje",
  "vendajes",
]);

function gearOnly(phrase: string) {
  const words = contentWords(phrase);
  return words.length > 0 && words.every((word) => gearWord.has(word));
}

function sideOnlyPhrase(phrase: string) {
  const words = contentWords(phrase);
  return (
    words.length > 0 &&
    sideIn(phrase) !== null &&
    words.every((word) => sideOnlyWord.test(word))
  );
}

// How it feels, or the complaint starting, is not something the person was doing.
const feelingWord =
  /^(?:aching|sharp|burning|tingling|numb|stiff|tight|dull|throbbing|sore|cramping|cramp|ardor|ardiente|quemazon|punzante|pinchazo|pinchazos|sordo|sorda|hormigueo|entumecido|entumecida|adormecido|adormecida|rigidez|rigido|rigida|tenso|tensa|tirante|palpitante|pulsatil|calambre|calambres|adolorido|adolorida|molestia|agudo|aguda)$/;

function complaintPhrase(phrase: string) {
  const words = contentWords(phrase);
  return (
    words.length > 0 &&
    words.every(
      (word) =>
        timeWords.has(word) || painWords.has(word) || feelingWord.test(word),
    )
  );
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
    sideOnlyPhrase(activity) ||
    hedgePhrase(activity) ||
    complaintPhrase(activity) ||
    activityBlocked(activity, transcript) ||
    gearOnly(activity)
  )
    return null;
  // A body part is where it hurts, not what the person was doing.
  if (partsIn(activity).length > 0) return null;
  return activity;
}

// A side phrase or a racket next to a real body part is not a second place.
// A lone unmapped name ("shin") stays, so the person can place it.
function dropExtras(kept: Candidate[]) {
  if (!kept.some((item) => partsIn(item.evidence).length > 0)) return kept;
  return kept.filter((item) => {
    if (partsIn(item.evidence).length > 0) return true;
    return !gearOnly(item.evidence) && !sideOnlyPhrase(item.evidence);
  });
}

export function verifyEvidence(
  evidence: EvidenceExtraction,
  transcript: string,
  today: string,
): VerifiedExtraction {
  // grounded() is the denial check (including "nada más", "can't", and
  // "está bien"). A model negated flag does not drop a span the lexicon
  // affirms, and it cannot keep a span the lexicon denies.
  const kept = dropExtras(
    candidates(evidence, transcript).filter((item) =>
      grounded(item.evidence, transcript, true, true),
    ),
  );
  return {
    location: chooseLocation(kept, transcript),
    intensity: verifyIntensity(evidence, transcript),
    qualities: verifyQualities(evidence, transcript),
    onset: verifyOnset(evidence, transcript, today),
    activity: verifyActivity(evidence, transcript),
  };
}
