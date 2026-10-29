import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { regions } from "../src/types.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import { buildProposal as buildLegacyProposal } from "../src/voice/legacy-extraction.ts";
import {
  buildProposal,
  findSpan,
  normalize,
  partsIn,
  resolveOnset,
} from "../src/voice/extraction.ts";
import { parseRawExtraction } from "../src/platform/on-device-ai.ts";

const TODAY = "2026-10-22";
const FIELDS = [
  "location",
  "intensity",
  "quality",
  "onset",
  "activity",
] as const;
type FieldName = (typeof FIELDS)[number];
type Lang = "en" | "es";
type FollowUp = "none" | "location" | "side" | "intensity";
type LocationStatus =
  "mapped" | "missing" | "unmapped" | "ambiguous" | "need-side" | "both";

export interface EvalExpect {
  location: string | null;
  locationStatus: LocationStatus;
  side: "left" | "right" | "both" | null;
  intensity: number | null;
  quality: string[];
  onset: { date: string } | { phrase: string } | null;
  activity: string | null;
  followUp: "none" | "location" | "side";
}

export interface EvalCase {
  id: string;
  lang: Lang;
  note: string;
  tags: string[];
  expect: EvalExpect;
}

interface Actual {
  location: string | null;
  locationStatus: string;
  side: "left" | "right" | "both" | null;
  intensity: number | null;
  quality: string[];
  onset: { phrase?: string; date?: string } | null;
  activity: string | null;
  followUp: FollowUp;
  error?: string;
}

interface FieldScore {
  correct: number;
  fills: number;
  expected: number;
  falseFill: number;
  wrongValue: number;
  precision: number | null;
  recall: number | null;
}

export interface MetricBlock {
  cases: number;
  oneShot: { hit: number; total: number; rate: number | null };
  falseFillCases: number;
  falseFillRate: number;
  wrongValueFills: number;
  followUpAsked: number;
  followUpRate: number;
  followUpCorrect: number;
  followUpAccuracy: number;
  fields: Record<FieldName, FieldScore>;
}

export interface EvalReport {
  name: string;
  pipeline: "proposal" | "legacy" | "rules" | "trust";
  recorded: string | null;
  metadata: unknown;
  cases: number;
  overall: MetricBlock;
  byLang: Record<Lang, MetricBlock>;
  failures: { id: string; reasons: string[] }[];
}

interface ThresholdField {
  precision?: number;
  recall?: number;
}

export interface ThresholdBlock {
  oneShot?: number;
  falseFillRate?: number;
  followUpRate?: number;
  followUpAccuracy?: number;
  wrongValueFills?: number;
  fields?: Partial<Record<FieldName, ThresholdField>>;
}

export interface Thresholds {
  recorded: string;
  pipeline: "proposal" | "legacy" | "rules" | "trust";
  overall?: ThresholdBlock;
  byLang?: Partial<Record<Lang, ThresholdBlock>>;
}

const regionIds = new Set(regions.map((region) => region.id));

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (value: string) => fold(value).split(" ").filter(Boolean);

const stop = new Set([
  "a",
  "an",
  "the",
  "on",
  "in",
  "of",
  "my",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "de",
  "del",
  "al",
  "y",
  "and",
  "to",
  "me",
]);

function containsPhrase(hay: string, needle: string) {
  const host = words(hay);
  const need = words(needle);
  if (!need.length) return false;
  for (let i = 0; i + need.length <= host.length; i += 1)
    if (need.every((word, j) => host[i + j] === word)) return true;
  return false;
}

function phraseOk(actual: string, expected: string, note: string) {
  if (fold(actual) === fold(expected)) return true;
  if (!containsPhrase(actual, expected)) return false;
  const said = new Set(words(note));
  return words(actual).every((word) => said.has(word) || stop.has(word));
}

function qualitySet(value: string[] | string | null | undefined) {
  const raw = Array.isArray(value) ? value : value ? value.split(",") : [];
  return [...new Set(raw.flatMap((item) => words(String(item))))].sort();
}

function sideOf(location: string | null, status: string) {
  if (status === "both") return "both" as const;
  if (location?.startsWith("left_")) return "left" as const;
  if (location?.startsWith("right_")) return "right" as const;
  return null;
}

function emptyActual(error?: string): Actual {
  return {
    location: null,
    locationStatus: "missing",
    side: null,
    intensity: null,
    quality: [],
    onset: null,
    activity: null,
    followUp: "none",
    error,
  };
}

function fromProposal(proposal: {
  location: { status: string; region?: string };
  fields: {
    intensity?: number | null;
    quality?: string;
    activity?: string;
  };
  onset?: { phrase: string; date?: string };
  followUp: { key: string } | null;
}): Actual {
  const location =
    proposal.location.status === "mapped"
      ? (proposal.location.region ?? null)
      : null;
  const status = proposal.location.status;
  const follow = proposal.followUp?.key ?? "none";
  return {
    location,
    locationStatus: status,
    side: sideOf(location, status),
    intensity:
      typeof proposal.fields.intensity === "number"
        ? proposal.fields.intensity
        : null,
    quality: qualitySet(proposal.fields.quality),
    onset: proposal.onset ?? null,
    activity: proposal.fields.activity?.trim() || null,
    followUp: (follow === "location" ||
    follow === "side" ||
    follow === "intensity"
      ? follow
      : "none") as FollowUp,
  };
}

export function loadCases(path = "tests/fixtures/extraction-eval/cases.json") {
  const cases = JSON.parse(readFileSync(path, "utf8")) as EvalCase[];
  const problems = validateCases(cases);
  if (problems.length) {
    throw new Error(`Invalid eval cases:\n${problems.join("\n")}`);
  }
  return cases;
}

function validateCases(cases: EvalCase[]) {
  const problems: string[] = [];
  const ids = new Set<string>();
  const heldOut = cases.length > 0 && cases.every((item) => item.id.startsWith("ho-"));
  const checkSequence = (lang: "en" | "es", minimum: number) => {
    const prefix = heldOut ? `ho-${lang}` : lang;
    const numbers = cases
      .filter((item) => item.lang === lang)
      .map((item) => {
        const match = new RegExp(`^${prefix}-(\\d{3})$`).exec(item.id);
        return match ? Number(match[1]) : NaN;
      });
    if (numbers.some((n) => Number.isNaN(n)))
      problems.push(`${prefix} ids must look like ${prefix}-001`);
    const max = numbers.length ? Math.max(...numbers) : 0;
    if (max < minimum)
      problems.push(
        `expected ${prefix} cases through ${prefix}-${String(minimum).padStart(3, "0")}`,
      );
    const seen = new Set(numbers);
    for (let n = 1; n <= max; n += 1)
      if (!seen.has(n))
        problems.push(`missing ${prefix}-${String(n).padStart(3, "0")}`);
  };
  checkSequence("en", heldOut ? 1 : 60);
  checkSequence("es", heldOut ? 1 : 40);
  let both = 0;
  for (const item of cases) {
    if (ids.has(item.id)) problems.push(`${item.id} is duplicated`);
    ids.add(item.id);
    if (!item.id.replace(/^ho-/, "").startsWith(item.lang))
      problems.push(`${item.id} lang is ${item.lang}`);
    if (!item.note?.trim()) problems.push(`${item.id} has an empty note`);
    if (!item.tags?.length) problems.push(`${item.id} has no tags`);
    const expect = item.expect;
    if (!expect) {
      problems.push(`${item.id} has no expect`);
      continue;
    }
    if (expect.locationStatus === "both") both += 1;
    const mapped = expect.locationStatus === "mapped";
    if (mapped !== Boolean(expect.location))
      problems.push(`${item.id} location and locationStatus disagree`);
    if (expect.location && !regionIds.has(expect.location))
      problems.push(
        `${item.id} location ${expect.location} is not a region id`,
      );
    if (expect.location?.startsWith("left_") && expect.side !== "left")
      problems.push(`${item.id} side should be left`);
    if (expect.location?.startsWith("right_") && expect.side !== "right")
      problems.push(`${item.id} side should be right`);
    if (
      expect.location &&
      !expect.location.startsWith("left_") &&
      !expect.location.startsWith("right_") &&
      expect.side !== null
    )
      problems.push(`${item.id} midline region should have a null side`);
    if (
      expect.locationStatus === "both" &&
      (expect.side !== "both" || expect.followUp !== "none" || expect.location)
    )
      problems.push(`${item.id} both-sides case is inconsistent`);
    if (
      expect.locationStatus === "need-side" &&
      (expect.followUp !== "side" || expect.side !== null)
    )
      problems.push(`${item.id} need-side case is inconsistent`);
    if (
      (expect.locationStatus === "missing" ||
        expect.locationStatus === "ambiguous") &&
      expect.followUp !== "location"
    )
      problems.push(`${item.id} should ask for a location`);
    if (
      expect.locationStatus === "unmapped" &&
      (expect.followUp !== "none" || expect.side !== null)
    )
      problems.push(`${item.id} unmapped case should not ask a follow-up`);
    if (expect.locationStatus === "mapped" && expect.followUp !== "none")
      problems.push(`${item.id} mapped case should not ask a follow-up`);
    if (
      expect.intensity !== null &&
      (!Number.isInteger(expect.intensity) ||
        expect.intensity < 0 ||
        expect.intensity > 10)
    )
      problems.push(`${item.id} intensity is out of range`);
    if (!Array.isArray(expect.quality))
      problems.push(`${item.id} quality must be an array`);
    if (expect.onset && "date" in expect.onset && "phrase" in expect.onset)
      problems.push(`${item.id} onset has both a date and a phrase`);
    if (
      expect.onset &&
      "date" in expect.onset &&
      !/^\d{4}-\d{2}-\d{2}$/.test(expect.onset.date)
    )
      problems.push(`${item.id} onset date is invalid`);
    if (expect.onset && "phrase" in expect.onset && !expect.onset.phrase.trim())
      problems.push(`${item.id} onset phrase is empty`);
  }
  if (both < 2 || both > 3)
    problems.push(`expected 2 or 3 both-sides cases, found ${both}`);
  return problems;
}

function onsetOk(
  actual: Actual["onset"],
  expected: EvalExpect["onset"],
  note: string,
) {
  if (!expected) return !actual;
  if (!actual) return false;
  if ("date" in expected) return actual.date === expected.date;
  if (actual.date) return false;
  return phraseOk(actual.phrase ?? "", expected.phrase, note);
}

function fieldMatch(
  name: FieldName,
  actual: Actual,
  expect: EvalExpect,
  note: string,
) {
  if (name === "location") return actual.location === expect.location;
  if (name === "intensity") return actual.intensity === expect.intensity;
  if (name === "quality")
    return (
      qualitySet(actual.quality).join(" ") ===
      qualitySet(expect.quality).join(" ")
    );
  if (name === "onset") return onsetOk(actual.onset, expect.onset, note);
  return expect.activity
    ? Boolean(
        actual.activity && phraseOk(actual.activity, expect.activity, note),
      )
    : !actual.activity;
}

function filled(name: FieldName, actual: Actual) {
  if (name === "location") return actual.location !== null;
  if (name === "intensity") return actual.intensity !== null;
  if (name === "quality") return actual.quality.length > 0;
  if (name === "onset") return actual.onset !== null;
  return Boolean(actual.activity);
}

function expectedFilled(name: FieldName, expect: EvalExpect) {
  if (name === "location") return expect.location !== null;
  if (name === "intensity") return expect.intensity !== null;
  if (name === "quality") return expect.quality.length > 0;
  if (name === "onset") return expect.onset !== null;
  return Boolean(expect.activity);
}

function reasonsFor(item: EvalCase, actual: Actual) {
  const reasons: string[] = [];
  if (actual.error) reasons.push(`model error ${actual.error}`);
  if (
    actual.locationStatus !== item.expect.locationStatus ||
    actual.location !== item.expect.location ||
    actual.side !== item.expect.side
  ) {
    reasons.push(
      `location got ${actual.location ?? "null"}/${actual.locationStatus}/${actual.side ?? "null"}, expected ${item.expect.location ?? "null"}/${item.expect.locationStatus}/${item.expect.side ?? "null"}`,
    );
  }
  if (!fieldMatch("intensity", actual, item.expect, item.note))
    reasons.push(
      `intensity got ${actual.intensity ?? "null"}, expected ${item.expect.intensity ?? "null"}`,
    );
  if (!fieldMatch("quality", actual, item.expect, item.note))
    reasons.push(
      `quality got [${actual.quality.join(", ")}], expected [${item.expect.quality.join(", ")}]`,
    );
  if (!fieldMatch("onset", actual, item.expect, item.note)) {
    const got = actual.onset
      ? actual.onset.date
        ? actual.onset.date
        : `phrase ${actual.onset.phrase ?? ""}`
      : "null";
    const want = item.expect.onset
      ? "date" in item.expect.onset
        ? item.expect.onset.date
        : `phrase ${item.expect.onset.phrase}`
      : "null";
    reasons.push(`onset got ${got}, expected ${want}`);
  }
  if (!fieldMatch("activity", actual, item.expect, item.note))
    reasons.push(
      `activity got ${actual.activity ?? "null"}, expected ${item.expect.activity ?? "null"}`,
    );
  if (actual.followUp !== item.expect.followUp)
    reasons.push(
      `follow-up got ${actual.followUp}, expected ${item.expect.followUp}`,
    );
  for (const name of FIELDS) {
    if (filled(name, actual) && !expectedFilled(name, item.expect))
      reasons.push(`false fill ${name}`);
  }
  return reasons;
}

function blankField(): FieldScore {
  return {
    correct: 0,
    fills: 0,
    expected: 0,
    falseFill: 0,
    wrongValue: 0,
    precision: null,
    recall: null,
  };
}

function finish(score: FieldScore) {
  score.precision = score.fills ? score.correct / score.fills : null;
  score.recall = score.expected ? score.correct / score.expected : null;
  return score;
}

function summarize(
  rows: { item: EvalCase; actual: Actual; reasons: string[] }[],
): MetricBlock {
  const fields = Object.fromEntries(
    FIELDS.map((name) => [name, blankField()]),
  ) as Record<FieldName, FieldScore>;
  let falseFillCases = 0;
  let wrongValueFills = 0;
  let followUpAsked = 0;
  let followUpCorrect = 0;
  let oneHit = 0;
  let oneTotal = 0;
  for (const row of rows) {
    let falseCase = false;
    for (const name of FIELDS) {
      const score = fields[name];
      const didFill = filled(name, row.actual);
      const wanted = expectedFilled(name, row.item.expect);
      const match = fieldMatch(
        name,
        row.actual,
        row.item.expect,
        row.item.note,
      );
      if (didFill) score.fills += 1;
      if (wanted) score.expected += 1;
      if (didFill && match && wanted) score.correct += 1;
      if (didFill && !wanted) {
        score.falseFill += 1;
        falseCase = true;
      } else if (didFill && wanted && !match) {
        score.wrongValue += 1;
        wrongValueFills += 1;
      }
    }
    if (falseCase) falseFillCases += 1;
    if (row.actual.followUp !== "none") followUpAsked += 1;
    if (row.actual.followUp === row.item.expect.followUp) followUpCorrect += 1;
    if (row.item.expect.followUp === "none") {
      oneTotal += 1;
      const supported = FIELDS.every(
        (name) =>
          !filled(name, row.actual) || expectedFilled(name, row.item.expect),
      );
      const filledOk = FIELDS.every(
        (name) =>
          !expectedFilled(name, row.item.expect) ||
          fieldMatch(name, row.actual, row.item.expect, row.item.note),
      );
      const statusOk =
        row.actual.locationStatus === row.item.expect.locationStatus &&
        row.actual.location === row.item.expect.location &&
        row.actual.side === row.item.expect.side;
      if (row.actual.followUp === "none" && supported && filledOk && statusOk)
        oneHit += 1;
    }
  }
  const cases = rows.length;
  return {
    cases,
    oneShot: {
      hit: oneHit,
      total: oneTotal,
      rate: oneTotal ? oneHit / oneTotal : null,
    },
    falseFillCases,
    falseFillRate: cases ? falseFillCases / cases : 0,
    wrongValueFills,
    followUpAsked,
    followUpRate: cases ? followUpAsked / cases : 0,
    followUpCorrect,
    followUpAccuracy: cases ? followUpCorrect / cases : 0,
    fields: Object.fromEntries(
      FIELDS.map((name) => [name, finish(fields[name])]),
    ) as Record<FieldName, FieldScore>,
  };
}

function proposalActual(
  raw: unknown,
  note: string,
  lang: Lang,
  pipeline: "proposal" | "legacy",
): Actual {
  try {
    const parsed = parseRawExtraction(raw);
    const proposal =
      pipeline === "legacy"
        ? buildLegacyProposal(parsed, note, TODAY, lang)
        : buildProposal(parsed, note, TODAY, lang);
    return fromProposal(proposal);
  } catch (error) {
    return emptyActual(error instanceof Error ? error.message : String(error));
  }
}

const sidedParts = new Set([
  "foot", "ankle", "calf", "knee", "thigh", "hip", "wrist", "elbow", "shoulder",
]);

function trustSide(said: string) {
  const text = normalize(said);
  if (/\b(?:both|ambos|ambas|las dos|los dos)\b/.test(text)) return "both";
  if (/\b(?:left|izquierd[oa]s?)\b/.test(text)) return "left";
  if (/\b(?:right|derech[oa]s?)\b/.test(text)) return "right";
  return null;
}

function trustActual(raw: unknown, note: string): Actual {
  const evidence = parseRawExtraction(raw).evidence;
  if (!evidence) return emptyActual("no evidence");
  const real = (value: string | undefined | null) =>
    !!value?.trim() && !!findSpan(value, note);
  const spots = evidence.locations
    .filter((item) => !item.negated && real(item.evidence))
    .map((item) => {
      const part = partsIn(item.evidence)[0];
      const side = real(item.sideEvidence) ? trustSide(item.sideEvidence) : null;
      return { part, side };
    });
  let location: string | null = null;
  let status: LocationStatus = "missing";
  const keys = new Set(spots.map((spot) => spot.part ?? "?"));
  if (spots.length && keys.size === 1) {
    const { part } = spots[0];
    const sides = new Set(spots.map((spot) => spot.side).filter(Boolean));
    if (!part) status = "unmapped";
    else if (!sidedParts.has(part)) [location, status] = [part, "mapped"];
    else if (sides.has("both") || (sides.has("left") && sides.has("right")))
      status = "both";
    else if (sides.size === 1)
      [location, status] = [`${[...sides][0]}_${part}`, "mapped"];
    else status = "need-side";
  } else if (spots.length) status = "ambiguous";
  const intensity = evidence.intensity;
  const onset =
    evidence.onset && !evidence.onset.negated && real(evidence.onset.evidence)
      ? resolveOnset(evidence.onset.evidence, TODAY)
      : null;
  return {
    location,
    locationStatus: status,
    side: sideOf(location, status),
    intensity:
      intensity &&
      intensity.kind === "rating" &&
      !intensity.negated &&
      intensity.value >= 0 &&
      intensity.value <= 10 &&
      real(intensity.evidence)
        ? intensity.value
        : null,
    quality: qualitySet(
      evidence.qualities
        .filter((item) => !item.negated && real(item.evidence))
        .map((item) => item.evidence),
    ),
    onset,
    activity: real(evidence.activity) ? evidence.activity.trim() : null,
    followUp:
      status === "missing" || status === "ambiguous"
        ? "location"
        : status === "need-side"
          ? "side"
          : "none",
  };
}

function rulesActual(note: string): Actual {
  const draft = suggestVoiceDraft(note);
  const location = draft.locations.length === 1 ? draft.locations[0] : null;
  const status =
    draft.locations.length === 1
      ? "mapped"
      : draft.locations.length > 1
        ? "ambiguous"
        : "missing";
  return {
    location,
    locationStatus: status,
    side: sideOf(location, status),
    intensity:
      typeof draft.fields.intensity === "number"
        ? draft.fields.intensity
        : null,
    quality: qualitySet(draft.fields.quality),
    onset: draft.fields.duration ? { phrase: draft.fields.duration } : null,
    activity: draft.fields.activity ?? null,
    followUp: "none",
  };
}

export function scoreCases(
  cases: EvalCase[],
  pipeline: "proposal" | "legacy" | "rules" | "trust",
  recorded?: {
    metadata?: unknown;
    outputs?: Record<string, unknown>;
    errors?: Record<string, string>;
  },
): {
  rows: { item: EvalCase; actual: Actual; reasons: string[] }[];
  metadata: unknown;
} {
  const outputs = recorded?.outputs ?? {};
  const errors = recorded?.errors ?? {};
  const rows = cases.map((item) => {
    let actual: Actual;
    if (pipeline === "rules") actual = rulesActual(item.note);
    else if (pipeline === "trust" && outputs[item.id])
      actual = trustActual(outputs[item.id], item.note);
    else if (outputs[item.id])
      actual = proposalActual(
        outputs[item.id],
        item.note,
        item.lang,
        pipeline as "proposal" | "legacy",
      );
    else actual = emptyActual(errors[item.id] ?? "no model output");
    return { item, actual, reasons: reasonsFor(item, actual) };
  });
  return { rows, metadata: recorded?.metadata ?? null };
}

export function buildReport(
  name: string,
  pipeline: "proposal" | "legacy" | "rules" | "trust",
  recordedName: string | null,
  cases: EvalCase[],
  recorded?: {
    metadata?: unknown;
    outputs?: Record<string, unknown>;
    errors?: Record<string, string>;
  },
): EvalReport {
  const { rows, metadata } = scoreCases(cases, pipeline, recorded);
  const split = (lang: Lang) => rows.filter((row) => row.item.lang === lang);
  return {
    name,
    pipeline,
    recorded: recordedName,
    metadata,
    cases: cases.length,
    overall: summarize(rows),
    byLang: { en: summarize(split("en")), es: summarize(split("es")) },
    failures: rows
      .filter((row) => row.reasons.length)
      .map((row) => ({ id: row.item.id, reasons: row.reasons })),
  };
}

const pct = (value: number | null) =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
const num = (value: number | null) =>
  value === null ? "n/a" : value.toFixed(2);

export function formatReport(report: EvalReport) {
  const lines = [
    `${report.name}  ${report.pipeline}  n=${report.cases}  failures=${report.failures.length}`,
    "",
    `${"".padEnd(18)} ${"all".padStart(12)} ${"en".padStart(12)} ${"es".padStart(12)}`,
  ];
  const blocks = [report.overall, report.byLang.en, report.byLang.es];
  const cell = (values: string[]) =>
    `${values[0].padEnd(18)} ${values[1].padStart(12)} ${values[2].padStart(12)} ${values[3].padStart(12)}`;
  lines.push(
    cell([
      "one-shot",
      pct(blocks[0].oneShot.rate),
      pct(blocks[1].oneShot.rate),
      pct(blocks[2].oneShot.rate),
    ]),
  );
  lines.push(
    cell([
      "one-shot n",
      `${blocks[0].oneShot.hit}/${blocks[0].oneShot.total}`,
      `${blocks[1].oneShot.hit}/${blocks[1].oneShot.total}`,
      `${blocks[2].oneShot.hit}/${blocks[2].oneShot.total}`,
    ]),
  );
  lines.push(
    cell([
      "false-fill",
      pct(blocks[0].falseFillRate),
      pct(blocks[1].falseFillRate),
      pct(blocks[2].falseFillRate),
    ]),
  );
  lines.push(
    cell([
      "follow-up rate",
      pct(blocks[0].followUpRate),
      pct(blocks[1].followUpRate),
      pct(blocks[2].followUpRate),
    ]),
  );
  lines.push(
    cell([
      "follow-up accuracy",
      pct(blocks[0].followUpAccuracy),
      pct(blocks[1].followUpAccuracy),
      pct(blocks[2].followUpAccuracy),
    ]),
  );
  lines.push(
    cell([
      "wrong-value fills",
      String(blocks[0].wrongValueFills),
      String(blocks[1].wrongValueFills),
      String(blocks[2].wrongValueFills),
    ]),
  );
  for (const name of FIELDS) {
    lines.push(
      cell([
        `${name} P/R`,
        `${num(blocks[0].fields[name].precision)}/${num(blocks[0].fields[name].recall)}`,
        `${num(blocks[1].fields[name].precision)}/${num(blocks[1].fields[name].recall)}`,
        `${num(blocks[2].fields[name].precision)}/${num(blocks[2].fields[name].recall)}`,
      ]),
    );
  }
  if (report.failures.length) {
    lines.push("", "Failures");
    for (const failure of report.failures)
      lines.push(`${failure.id}: ${failure.reasons.join("; ")}`);
  }
  return lines.join("\n");
}

export function thresholdGaps(report: EvalReport, thresholds: Thresholds) {
  const gaps: string[] = [];
  const check = (label: string, block: MetricBlock, limit?: ThresholdBlock) => {
    if (!limit) return;
    const min = (name: string, got: number | null, want?: number) => {
      if (want === undefined || got === null) return;
      if (got + 1e-9 < want)
        gaps.push(`${label} ${name} ${got.toFixed(3)} < ${want}`);
    };
    const max = (name: string, got: number, want?: number) => {
      if (want === undefined) return;
      if (got - 1e-9 > want)
        gaps.push(`${label} ${name} ${got.toFixed(3)} > ${want}`);
    };
    min("oneShot", block.oneShot.rate, limit.oneShot);
    max("falseFillRate", block.falseFillRate, limit.falseFillRate);
    max("followUpRate", block.followUpRate, limit.followUpRate);
    min("followUpAccuracy", block.followUpAccuracy, limit.followUpAccuracy);
    if (
      limit.wrongValueFills !== undefined &&
      block.wrongValueFills > limit.wrongValueFills
    )
      gaps.push(
        `${label} wrongValueFills ${block.wrongValueFills} > ${limit.wrongValueFills}`,
      );
    for (const name of FIELDS) {
      min(
        `${name} precision`,
        block.fields[name].precision,
        limit.fields?.[name]?.precision,
      );
      min(
        `${name} recall`,
        block.fields[name].recall,
        limit.fields?.[name]?.recall,
      );
    }
  };
  check("overall", report.overall, thresholds.overall);
  check("en", report.byLang.en, thresholds.byLang?.en);
  check("es", report.byLang.es, thresholds.byLang?.es);
  return gaps;
}

function writeReport(report: EvalReport) {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const committed = resolve(
    "tests/fixtures/extraction-eval/reports",
    `${report.name}.json`,
  );
  const scratch = resolve("output/extraction-eval", `${report.name}.json`);
  mkdirSync(dirname(committed), { recursive: true });
  mkdirSync(dirname(scratch), { recursive: true });
  writeFileSync(committed, body);
  writeFileSync(scratch, body);
  return committed;
}

function readRecorded(path: string) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    metadata?: unknown;
    outputs?: Record<string, unknown>;
    errors?: Record<string, string>;
  };
  if (!parsed.outputs || typeof parsed.outputs !== "object")
    throw new Error(`${path} has no outputs object`);
  return parsed;
}

function main() {
  const { values } = parseArgs({
    options: {
      pipeline: { type: "string" },
      recorded: { type: "string" },
      name: { type: "string" },
      cases: {
        type: "string",
        default: "tests/fixtures/extraction-eval/cases.json",
      },
      check: { type: "boolean", default: false },
      thresholds: {
        type: "string",
        default: "tests/fixtures/extraction-eval/thresholds.json",
      },
    },
  });
  const cases = loadCases(values.cases);
  if (values.check) {
    let thresholds: Thresholds;
    try {
      thresholds = JSON.parse(
        readFileSync(values.thresholds, "utf8"),
      ) as Thresholds;
    } catch {
      console.error(
        `No thresholds at ${values.thresholds}. Score a run, then set thresholds slightly below the measured numbers.`,
      );
      process.exit(1);
    }
    const recordedPath =
      values.recorded ??
      resolve(
        "tests/fixtures/extraction-eval/recorded",
        `${thresholds.recorded}.json`,
      );
    const recorded =
      thresholds.pipeline === "rules" ? undefined : readRecorded(recordedPath);
    const report = buildReport(
      values.name ?? thresholds.recorded,
      thresholds.pipeline,
      thresholds.pipeline === "rules" ? null : thresholds.recorded,
      cases,
      recorded,
    );
    console.log(formatReport(report));
    writeReport(report);
    const gaps = thresholdGaps(report, thresholds);
    if (gaps.length) {
      console.error(`\nRegressions:\n${gaps.join("\n")}`);
      process.exit(1);
    }
    console.log("\nThresholds held.");
    return;
  }
  if (
    values.pipeline !== "proposal" &&
    values.pipeline !== "legacy" &&
    values.pipeline !== "rules" &&
    values.pipeline !== "trust"
  ) {
    console.error(
      "Usage: npm run eval:extraction -- --pipeline proposal|legacy|rules|trust --name <name> [--recorded path] [--check]",
    );
    process.exit(1);
  }
  if (!values.name) {
    console.error("Pass --name for the report file.");
    process.exit(1);
  }
  const recordedPath =
    values.pipeline === "rules"
      ? null
      : (values.recorded ??
        resolve(
          "tests/fixtures/extraction-eval/recorded",
          `${values.name}.json`,
        ));
  const recorded = recordedPath ? readRecorded(recordedPath) : undefined;
  const recordedName = recordedPath
    ? (recordedPath.split("/").pop() ?? "").replace(/\.json$/, "")
    : null;
  const report = buildReport(
    values.name,
    values.pipeline,
    recordedName,
    cases,
    recorded,
  );
  console.log(formatReport(report));
  const path = writeReport(report);
  console.log(`\nWrote ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
