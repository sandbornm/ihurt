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
export interface PainSuggestion {
  regions: PainRegionHit[] | null;
  side: PainSide | null;
  pain_type: PainLabel | null;
  severity: PainLabel | null;
  pain_level: PainLevel | null;
  radiation: PainRadiation | null;
  triggers: PainLabel[] | null;
  red_flags: PainLabel[] | null;
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
const TRIGGER_MIN = 0.7;

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

function readLabel(
  value: unknown,
  table: readonly { id: string; label: string }[],
  minimum = 0.5,
): PainLabel | null {
  const row = record(value);
  const score = row ? scoreOf(row.confidence, minimum) : null;
  if (!row || score === null || typeof row.id !== "string") return null;
  const known = table.find((item) => item.id === row.id);
  return known ? { id: known.id, confidence: score } : null;
}

function readList(
  value: unknown,
  table: readonly { id: string; label: string }[],
  minimum = 0.5,
) {
  if (!Array.isArray(value)) return null;
  const items = value.flatMap((item) => {
    const label = readLabel(item, table, minimum);
    return label ? [label] : [];
  });
  return items.length ? items : null;
}

function readSubLocation(anatomyId: string, value: unknown): PainSubLocation | null {
  const group = subByAnatomy.get(anatomyId);
  const row = record(value);
  const score = row ? scoreOf(row.confidence) : null;
  if (!group || !row || score === null || typeof row.id !== "string") return null;
  const known = group.options.find((option) => option.id === row.id);
  return known ? { id: known.id, confidence: score } : null;
}

function readRegions(value: unknown): PainRegionHit[] | null {
  if (!Array.isArray(value)) return null;
  const hits: PainRegionHit[] = [];
  for (const item of value) {
    const hit = record(item);
    const known =
      hit && typeof hit.id === "string" ? byId.get(hit.id) : undefined;
    const score = hit ? scoreOf(hit.confidence) : null;
    if (!hit || !known || score === null || hit.anatomy_id !== known.anatomy_id)
      continue;
    if (hits.some((existing) => existing.anatomy_id === known.anatomy_id))
      continue;
    hits.push({
      id: known.id,
      anatomy_id: known.anatomy_id,
      confidence: score,
      sub_location: readSubLocation(known.anatomy_id, hit.sub_location),
    });
  }
  return hits.length ? hits : null;
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

function readRadiation(value: unknown): PainRadiation | null {
  const row = record(value);
  const score = row ? scoreOf(row.confidence) : null;
  if (!row || row.present !== true || score === null) return null;
  return {
    present: true,
    confidence: score,
    regions: readRegions(row.regions),
  };
}

/** Keep ids that exist in the fixed catalog. Ignore model strings. */
export function readSuggestion(value: unknown): PainSuggestion | null {
  const row = record(value);
  if (!row) return null;
  return {
    regions: readRegions(row.regions),
    side: readSide(row.side),
    pain_type: readLabel(row.pain_type, data.pain_types),
    severity: readLabel(row.severity, data.severity),
    pain_level: readLevel(row.pain_level),
    radiation: readRadiation(row.radiation),
    triggers: readList(row.triggers, data.triggers, TRIGGER_MIN),
    red_flags: readList(row.red_flags, data.red_flags),
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
  return `${known.label} · ${known.value} / 10`;
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
