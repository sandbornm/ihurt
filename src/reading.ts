import catalog from "../config/reading-library.json" with { type: "json" };
import { activityRegions, activitySearchText } from "./activities.ts";
export interface ReadingSource {
  id: string;
  name: string;
  kind: string;
  hosts: string[];
  recommended: boolean;
}
export interface Reading {
  id: string;
  title: string;
  source: string;
  type: string;
  url: string;
  regions: string[];
  activities?: string[];
  checked: string;
}
export const sources: ReadingSource[] = catalog.sources;
export const recommendedSources = sources
  .filter((s) => s.recommended)
  .map((s) => s.id);
export const readings: Reading[] = catalog.resources.filter((r) => {
  try {
    const url = new URL(r.url);
    return (
      url.protocol === "https:" &&
      sources.find((s) => s.id === r.source)?.hosts.includes(url.hostname)
    );
  } catch {
    return false;
  }
});
export function findReadings(
  regions: string[],
  activity: string,
  selectedSources: string[],
  query = "",
) {
  const terms = (regions.length ? regions : activityRegions(activity)).map(
    (r) => r.replace(/^(left|right)_/, ""),
  );
  const text = activitySearchText(activity).toLowerCase();
  return readings
    .filter(
      (r) =>
        selectedSources.includes(r.source) &&
        (query
          ? `${r.title} ${r.type} ${sources.find((s) => s.id === r.source)?.name}`
              .toLowerCase()
              .includes(query.toLowerCase())
          : r.regions.some((k) => terms.some((term) => term.includes(k)))),
    )
    .sort(
      (a, b) =>
        Number(b.activities?.some((word) => text.includes(word)) ?? false) -
        Number(a.activities?.some((word) => text.includes(word)) ?? false),
    );
}
