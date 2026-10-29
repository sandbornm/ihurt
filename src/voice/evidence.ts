import type { EvidenceExtraction } from "../platform/on-device-ai.ts";
import {
  anatomyList,
  displayPhrase,
  findSpan,
  findSpans,
  grounded,
  isFutureOnset,
  mapLocation,
  normalize,
  parseIntensityAnswer,
  partMentions,
  partsIn,
  phraseTokens,
  ratedIn,
  resolveOnset,
  sideAt,
  saysHurt,
  sideIn,
  type LocationResult,
} from "./extraction.ts";
import type { RegionId } from "../types.ts";

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

function spanWithSide(
  evidence: string,
  sideEvidence: string,
  transcript: string,
) {
  const spans = findSpans(evidence, transcript);
  if (spans.length < 2) return spans[0] ?? null;
  const hurting = spans.filter((at) => {
    const clause = clauseAt(transcript, at);
    return clause !== null && saysHurt(clause.text);
  });
  const want = sideIn(sideEvidence);
  if (want === null) return hurting[0] ?? spans[0];
  const said = phraseTokens(transcript);
  const fits = (hurting.length ? hurting : spans).find((at) => {
    const clause = clauseAt(transcript, at);
    if (!clause) return false;
    for (let index = clause.start; index < clause.end; index++)
      if (
        sideAt(said, index) === want &&
        !(want === "right" && directionRight(transcript, index))
      )
        return true;
    return false;
  });
  return fits ?? spans[0];
}

function candidates(
  evidence: EvidenceExtraction,
  transcript: string,
): Candidate[] {
  const found: Candidate[] = [];
  for (const item of evidence.locations) {
    const at = spanWithSide(item.evidence, item.sideEvidence, transcript);
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
  /\b(?:slept|sleeping|sleep|lay|lie (?:down|on|in|flat)|lies (?:down|on|in|flat)|lying|laying|laid|reclin\w*|dorm(?:i|ia|ir|ido|ida|imos|iste|io|iamos|ian)|durm(?:i|io|iendo|ieron)|duerm\w*|acost(?:ad[oa]s?|ar\w*|e|o|aba\w*|ando\w*)|tumb\w*|echad[oa]s?|recost\w*)\b/;

function sideOnlyClause(text: string) {
  if (sleptWord.test(normalize(text)) || partsIn(text).length > 0) return false;
  const words = phraseTokens(text).filter((word) => !correctionWords.has(word));
  return (
    words.length > 0 &&
    sideIn(words.join(" ")) !== null &&
    words.every((word) => sideOnlyWord.test(word))
  );
}

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
    const gap = said.slice(a.index + 1, b.index);
    const repeated = gap.filter((word) => partsIn(word).length > 0).length;
    if (repeated > 1) continue;
    const between = gap.filter((word) => partsIn(word).length === 0);
    if (!between.some((word) => joiners.has(word))) continue;
    if (!between.every((word) => joinFiller.has(word))) continue;
    const filler = (words: string[]) =>
      words.every((word) => sideOnlyWord.test(word) || word === "of");
    const parts: number[] = [];
    for (let index = clause.start; index < clause.end; index++)
      if (partsIn(said[index]).length > 0) parts.push(index);
    if (!parts.length) continue;
    if (
      parts.some(
        (part) => part > b.index && filler(said.slice(b.index + 1, part)),
      )
    )
      return true;
    if (
      parts.some(
        (part) => part < a.index && filler(said.slice(part + 1, a.index)),
      )
    )
      return true;
  }
  return false;
}

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

const modalGuess =
  /\b(?:(?:may|might|could) be|puede ser|podria ser|podria estar)\b(.*)$/;
const numberToken =
  /\b(?:\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/;
const contrast = /\b(?:but|pero|though|although|however|aunque|sino|yet)\b/;
function guessedRating(evidence: string, transcript: string) {
  const at = intensitySpan(evidence, transcript);
  const clause = at ? clauseAround(transcript, at) : null;
  const guess = clause ? modalGuess.exec(normalize(clause)) : null;
  if (guess === null) return false;
  const governed = guess[1].split(contrast)[0];
  return numberToken.test(governed);
}
function bareMonth(phrase: string, transcript: string) {
  const word = normalize(phrase);
  if (word !== "may" && word !== "march") return false;
  const cue = new RegExp(
    `\\b(?:in|since|last|this|from|until|till|during|early|late|mid|by|before|after|started|began)\\s+${word}\\b|\\b${word}\\s+\\d`,
  );
  return !cue.test(normalize(transcript));
}

function verifyIntensity(evidence: EvidenceExtraction, transcript: string) {
  const item = evidence.intensity;
  if (!item?.evidence) return null;
  const parsed = parseIntensityAnswer(item.evidence);
  if (parsed === null) return null;
  const correction = /\b(?:but|sino)\b/.test(normalize(item.evidence));
  if (item.kind !== "rating" && !correction) return null;
  if (!correction && item.value !== parsed) return null;
  if (!intensitySpan(item.evidence, transcript)) return null;
  if (guessedRating(item.evidence, transcript)) return null;
  return ratingStands(item.evidence, transcript, parsed) ? parsed : null;
}

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
  if (bareMonth(item.evidence, transcript)) return null;
  if (isFutureOnset(item.evidence)) return null;
  const resolved = resolveOnset(item.evidence, today);
  if (!resolved.date && !timePhrase(item.evidence)) return null;
  return resolved;
}

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
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
  "months",
  "years",
  "weekend",
  "meses",
  "mes",
  "anos",
  "ano",
  "finde",
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
  const clause = clauseAt(transcript, at);
  const from = Math.max(clause?.start ?? 0, at.start - 4);
  const before = said.slice(from, at.start).join(" ");
  if (blockedActivity.test(before)) return true;
  return unanswered(said.slice(at.end, at.end + 6));
}

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

function locationOnly(phrase: string) {
  const mentions = partMentions(phrase);
  if (!mentions.length) return false;
  const words = contentWords(phrase);
  if (words.some((word) => painWords.has(word) || feelingWord.test(word)))
    return true;
  let rest = ` ${normalize(phrase)} `;
  for (const mention of mentions) rest = rest.replace(mention.text, " ");
  return !contentWords(rest).some(
    (word) => !sideWord.test(word) && !timeWords.has(word),
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
  if (locationOnly(activity)) return null;
  return activity;
}

function dropExtras(kept: Candidate[]) {
  if (!kept.some((item) => partsIn(item.evidence).length > 0)) return kept;
  return kept.filter((item) => {
    if (partsIn(item.evidence).length > 0) return true;
    return !gearOnly(item.evidence) && !sideOnlyPhrase(item.evidence);
  });
}

const condition =
  /(?<!\ba )\b(?:when|whenever|while|if|unless|(?<!well )as(?! well as)|because|since|after|before|until|during|every time|each time|cuando|mientras|si|porque|cada vez|despues|despu[eé]s|antes|durante|a menos que|salvo que|al(?! igual que))\b/i;
const additive =
  /\b(?:as well as|along with|together with|in addition to|plus|also|al igual que|ademas de|junto con|asi como|tambien)\b/i;
const plainJoin = /\b(?:and|but|y|e|pero)\b/i;
const beforeCondition = (clause: string): string => {
  const at = clause.search(new RegExp(condition.source, "i"));
  if (at < 0) return clause;
  const head = clause.slice(0, at);
  const tail = clause.slice(at);
  const kept: string[] = [];
  const cause =
    /^(?:because|since|porque)\b(.*?)(?=,|\b(?:and|but|y|pero)\b|$)/i.exec(
      tail,
    );
  if (cause && saysHurt(cause[1])) kept.push(cause[1]);
  const pieces = tail.split(
    new RegExp(`(,|${additive.source}|${plainJoin.source})`, "i"),
  );
  for (let i = 1; i + 1 < pieces.length; i += 2) {
    const joiner = pieces[i];
    const text = pieces[i + 1];
    if (joiner === "," || additive.test(joiner)) kept.push(text);
    else if (saysHurt(text)) kept.push(text);
  }
  return [head, ...kept.map(beforeCondition)].join(" ");
};

function withDroppedParts(
  location: LocationResult,
  kept: Candidate[],
  transcript: string,
): LocationResult {
  if (
    location.status !== "mapped" &&
    location.status !== "need-side" &&
    location.status !== "both"
  )
    return location;
  const have = new Set(kept.flatMap((item) => partsIn(item.evidence)));
  const extra = transcript
    .split(/[.!?;:\n¿¡]+/)
    .map(beforeCondition)
    .filter(saysHurt)
    .flatMap((clause) => partMentions(clause))
    .filter(
      (mention) =>
        !have.has(mention.part) &&
        grounded(mention.text, transcript, true, true),
    );
  if (!extra.length) return location;
  return {
    status: "ambiguous",
    spoken: [
      ...kept.map((item) => item.evidence),
      ...new Set(extra.map((mention) => mention.text)),
    ].join(", "),
  };
}

export function verifyEvidence(
  evidence: EvidenceExtraction,
  transcript: string,
  today: string,
): VerifiedExtraction {
  const kept = dropExtras(
    candidates(evidence, transcript).filter((item) =>
      grounded(item.evidence, transcript, true, true),
    ),
  );
  return {
    location: withDroppedParts(
      chooseLocation(kept, transcript),
      kept,
      transcript,
    ),
    intensity: verifyIntensity(evidence, transcript),
    qualities: verifyQualities(evidence, transcript),
    onset: verifyOnset(evidence, transcript, today),
    activity: verifyActivity(evidence, transcript),
  };
}
