import data from "../../config/pain-regions.json" with { type: "json" };
import { regions, type RegionId } from "../types.ts";

const anatomyIds = new Set<string>(regions.map((region) => region.id));

export interface CatalogRegion {
  id: string;
  name: string;
  side: "left" | "right" | null;
  anatomy_id: RegionId;
}

export interface PainLabel {
  id: string;
  confidence: number;
}
export interface PainSubLocation {
  id: string;
  confidence: number;
}
export interface PainRegionHit {
  id: string;
  anatomy_id: RegionId;
  confidence: number;
  sub_location: PainSubLocation | null;
}
export interface PainLevel {
  band: string;
  value: number;
  confidence: number;
}
export interface PainSide {
  id: "left" | "right" | "both" | "midline" | "unspecified";
  confidence: number;
}
export interface PainRadiation {
  present: true;
  confidence: number;
  regions: PainRegionHit[] | null;
}
/** Side and pain level only. Regions come from the main map provider. */
export interface PainSuggestion {
  side: PainSide | null;
  pain_level: PainLevel | null;
}

const CARE = "Consider seeking care. This is not a diagnosis.";

const regionList: CatalogRegion[] = data.regions.flatMap((region) => {
  if (!anatomyIds.has(region.anatomy_id)) return [];
  const side =
    region.side === "left" || region.side === "right" ? region.side : null;
  return [
    {
      id: region.id,
      name: region.name,
      side,
      anatomy_id: region.anatomy_id as RegionId,
    },
  ];
});
const byId = new Map(regionList.map((region) => [region.id, region]));

// Keep the stored numbers aligned with PAIN_LEVEL_BANDS in backend/models.py.
const PAIN_LEVELS: Record<string, { label: string; value: number }> = {
  none: { label: "None", value: 0 },
  mild: { label: "Mild (2-3)", value: 2 },
  moderate: { label: "Moderate (4-5)", value: 4 },
  severe: { label: "Severe (6-7)", value: 6 },
  very_severe: { label: "Very severe (8-10)", value: 9 },
};
const SIDE_IDS = ["left", "right", "both", "midline", "unspecified"] as const;
const SIDE_COPY: Record<(typeof SIDE_IDS)[number], string> = {
  left: "Left side",
  right: "Right side",
  both: "Both sides",
  midline: "Midline",
  unspecified: "Side not stated",
};
const subByAnatomy = new Map<string, (typeof data.sub_locations)[number]>();
for (const group of data.sub_locations) {
  for (const anatomyId of group.anatomy_ids) {
    if (anatomyIds.has(anatomyId)) subByAnatomy.set(anatomyId, group);
  }
}

export const painCatalog = {
  regions: regionList,
  painTypes: data.pain_types,
  severity: data.severity,
  triggers: data.triggers,
  redFlags: data.red_flags,
};

export function advisoryCopy(flags: { id: string }[] | null | undefined) {
  return flags?.length ? CARE : null;
}

export function plainText(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, 3000);
}

function record(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scoreOf(value: unknown, minimum = 0.5) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= 1
    ? value
    : null;
}



function readSide(value: unknown): PainSide | null {
  const row = record(value);
  const score = row ? scoreOf(row.confidence) : null;
  if (!row || score === null || typeof row.id !== "string") return null;
  const id = SIDE_IDS.find((item) => item === row.id);
  return id ? { id, confidence: score } : null;
}

function readLevel(value: unknown): PainLevel | null {
  const row = record(value);
  const score = row ? scoreOf(row.confidence) : null;
  if (!row || score === null || typeof row.band !== "string") return null;
  const known = PAIN_LEVELS[row.band];
  if (!known || row.value !== known.value) return null;
  return { band: row.band, value: known.value, confidence: score };
}



/** Keep ids that exist in the fixed catalog. Ignore model strings. */
export function readSuggestion(value: unknown): PainSuggestion | null {
  const row = record(value);
  if (!row) return null;
  return {
    side: readSide(row.side),
    pain_level: readLevel(row.pain_level),
  };
}

export function sideCopy(id: string) {
  if (id === "unspecified") return null;
  return SIDE_IDS.some((item) => item === id)
    ? SIDE_COPY[id as (typeof SIDE_IDS)[number]]
    : null;
}

export function painLevelCopy(level: PainLevel) {
  const known = PAIN_LEVELS[level.band];
  if (!known || known.value !== level.value) return null;
  // Band label only. The representative midpoint is not a reported intensity.
  return `AI band: ${known.label}`;
}

/** Exact 0-10 from the person's words, or null when absent, negated, or ambiguous. */
export function statedIntensity(text: string): number | null {
  const source = plainText(text);
  if (!source) return null;
  const withoutNegation = source.replace(
    /\b(?:not|no|isn't|isn'?t|wasn't|wasn'?t|weren't|weren'?t)\s+(?:a\s+)?(?:10|[0-9])(?:\s*\/\s*10|\s+out of\s+10)\b/gi,
    " ",
  );
  const matches = [
    ...withoutNegation.matchAll(/\b(10|[0-9])(?:\s*\/\s*10|\s+out of\s+10)\b/gi),
  ];
  if (matches.length !== 1) return null;
  return Number(matches[0][1]);
}

/** Catalog name, plus a configured part and a side the anatomy id does not already carry. */
export function regionTitle(hit: PainRegionHit, side: PainSide | null) {
  const known = byId.get(hit.id);
  if (!known) return null;
  let title = known.name;
  const group = subByAnatomy.get(known.anatomy_id);
  const part = group?.options.find(
    (option) => option.id === hit.sub_location?.id,
  );
  if (part && !known.name.toLowerCase().includes(part.label.toLowerCase())) {
    title = `${title}, ${part.label.toLowerCase()}`;
  }
  if (!known.side && side && side.id !== "midline" && side.id !== "unspecified") {
    const word = side.id === "both" ? "both sides" : `${side.id} side`;
    title = `${title}, ${word}`;
  }
  return title;
}

export function highlightIds(hits: PainRegionHit[] | null) {
  return [...new Set((hits ?? []).map((hit) => hit.anatomy_id))];
}

export function regionLabel(id: string) {
  return byId.get(id)?.name ?? null;
}

export function optionLabel(
  table: "pain_types" | "severity" | "triggers" | "red_flags",
  id: string,
) {
  return data[table].find((item) => item.id === id)?.label ?? null;
}
