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
export interface PainRegionHit {
  id: string;
  anatomy_id: RegionId;
  confidence: number;
}
export interface PainLevel {
  value: number;
  confidence: number;
}
export interface PainSuggestion {
  regions: PainRegionHit[] | null;
  pain_type: PainLabel | null;
  severity: PainLabel | null;
  pain_level: PainLevel | null;
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

function scoreOf(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.5 &&
    value <= 1
    ? value
    : null;
}

function readLabel(
  value: unknown,
  table: readonly { id: string; label: string }[],
): PainLabel | null {
  const row = record(value);
  const score = row ? scoreOf(row.confidence) : null;
  if (!row || score === null || typeof row.id !== "string") return null;
  const known = table.find((item) => item.id === row.id);
  return known ? { id: known.id, confidence: score } : null;
}

function readList(
  value: unknown,
  table: readonly { id: string; label: string }[],
) {
  if (!Array.isArray(value)) return null;
  const items = value.flatMap((item) => {
    const label = readLabel(item, table);
    return label ? [label] : [];
  });
  return items.length ? items : null;
}

/** Keep ids that exist in the fixed catalog. Ignore model strings. */
export function readSuggestion(value: unknown): PainSuggestion | null {
  const row = record(value);
  if (!row) return null;
  const hits: PainRegionHit[] = [];
  if (Array.isArray(row.regions)) {
    for (const item of row.regions) {
      const hit = record(item);
      const known =
        hit && typeof hit.id === "string" ? byId.get(hit.id) : undefined;
      const score = hit ? scoreOf(hit.confidence) : null;
      if (!known || score === null || hit?.anatomy_id !== known.anatomy_id)
        continue;
      if (hits.some((existing) => existing.anatomy_id === known.anatomy_id))
        continue;
      hits.push({
        id: known.id,
        anatomy_id: known.anatomy_id,
        confidence: score,
      });
    }
  }
  const level = record(row.pain_level);
  const levelScore = level ? scoreOf(level.confidence) : null;
  const levelValue =
    level &&
    typeof level.value === "number" &&
    Number.isInteger(level.value) &&
    level.value >= 0 &&
    level.value <= 10
      ? level.value
      : null;
  return {
    regions: hits.length ? hits : null,
    pain_type: readLabel(row.pain_type, data.pain_types),
    severity: readLabel(row.severity, data.severity),
    pain_level:
      levelValue !== null && levelScore !== null
        ? { value: levelValue, confidence: levelScore }
        : null,
    triggers: readList(row.triggers, data.triggers),
    red_flags: readList(row.red_flags, data.red_flags),
  };
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
