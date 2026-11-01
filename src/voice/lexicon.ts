import type { RegionId } from "../types.ts";

// Everyday words for places that already have a region. The fallback uses
// these when the on-device model is not there. Each word names the nearest
// region, and the person still reviews the pin.
//
// Sided words ("glute") only count with a side, as in "left glute"
// or "glúteo izquierdo". They are never guessed from one side.
const plain: Partial<Record<RegionId, { en: string[]; es: string[] }>> = {
  lower_back: { en: [], es: ["cintura", "espalda de abajo"] },
  abdomen: { en: ["belly"], es: ["barriga", "vientre"] },
};
const sided: Record<string, { en: string[]; es: string[] }> = {
  hip: {
    en: ["buttocks?", "glutes?", "gluteus"],
    es: ["gluteos?", "nalgas?"],
  },
};

// Patterns for text that has already been lowercased and had accents removed.
export function aliasPatterns(id: RegionId): { en: RegExp[]; es: RegExp[] } {
  const side = /^(left|right)_(.+)$/.exec(id);
  if (!side) {
    const words = plain[id];
    const make = (list: string[]) =>
      list.map((word) => new RegExp(`\\b${word}\\b`));
    return { en: make(words?.en ?? []), es: make(words?.es ?? []) };
  }
  const words = sided[side[2]];
  if (!words) return { en: [], es: [] };
  const spanishSide = side[1] === "left" ? "izquierd[oa]s?" : "derech[oa]s?";
  return {
    en: [new RegExp(`\\b${side[1]} (?:${words.en.join("|")})\\b`)],
    es: [new RegExp(`\\b(?:${words.es.join("|")}) ${spanishSide}\\b`)],
  };
}
