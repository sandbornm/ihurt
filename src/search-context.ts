import { regionName, type SavedMap } from "./types.ts";

export function searchDescription(entry: SavedMap): string {
  const context = [
    entry.note &&
      `Note: ${entry.note.slice(0, 1000)}${entry.note.length > 1000 ? "…" : ""}`,
    entry.map.quality && `Feeling: ${entry.map.quality.slice(0, 100)}`,
    entry.map.duration && `Duration: ${entry.map.duration.slice(0, 100)}`,
    entry.map.intensity !== null &&
      `Reported intensity: ${entry.map.intensity}/10`,
    ...(entry.points ?? []).map((point, index) => {
      const side =
        point.position[0] > 0.06
          ? "model left"
          : point.position[0] < -0.06
            ? "model right"
            : "model midline";
      return `Spot ${index + 1}: ${regionName(point.region)} (${side}); selected surface: ${point.structure.slice(0, 70)}${point.area ? "; highlighted area" : ""}. ${point.comment ? point.comment.slice(0, 120) + (point.comment.length > 120 ? "…" : "") : "No comment."}`;
    }),
  ]
    .filter(Boolean)
    .join("\n");
  // Keep room for the challenge token and topic fields in the 8 KiB request.
  let result = context.slice(0, 4000);
  while (new TextEncoder().encode(result).length > 5000)
    result = result.slice(0, -1);
  return result;
}
