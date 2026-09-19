import { regions, type RegionId, type SavedMap } from "../types.ts";

export type DraftFields = Partial<
  Pick<SavedMap["map"], "intensity" | "quality" | "activity" | "duration">
>;
export type VoiceDraftValue = {
  text: string;
  fields: DraftFields;
  region?: RegionId;
};

const numbers = [
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
];

// Suggestions quote explicit phrases. They never choose surface coordinates.
export function suggestVoiceDraft(text: string) {
  const fields: DraftFields = {};
  const clauses = text
    .toLowerCase()
    .split(/[.!?;\n]+/)
    .filter(
      (part) =>
        !/\b(no|not|without|never|denies|doesn't|don't|isn't|wasn't)\b/.test(
          part,
        ),
    );
  const clean = clauses.join(". ");
  const ratings = [
    ...clean.matchAll(
      /\b(10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\/\s*10|out of (?:10|ten))\b/g,
    ),
  ].map((match) =>
    /^\d+$/.test(match[1]) ? Number(match[1]) : numbers.indexOf(match[1]),
  );
  if (ratings.length === 1) fields.intensity = ratings[0];
  const qualities = [
    ...new Set(
      clean.match(
        /\b(?:aching|sharp|burning|tingling|numb|stiff|tight|dull|throbbing|sore|cramping)\b/g,
      ) ?? [],
    ),
  ];
  if (qualities.length) fields.quality = qualities.join(", ");
  // Labeled phrases avoid guessing an activity from unrelated mentions.
  const activity = text.match(/\bactivity\s*:\s*([^.!?;\n]{1,120})/i);
  const duration = text.match(
    /\b(?:duration|timing)\s*:\s*([^.!?;\n]{1,120})/i,
  );
  if (activity) fields.activity = activity[1].trim();
  if (duration) fields.duration = duration[1].trim();
  const locations = regions
    .filter(({ id }) => {
      const label = id.replaceAll("_", " ");
      return clauses.some(
        (part) =>
          /\b(?:hurts?|pain|aches?|aching|discomfort|sore|tight|stiff|burning|tingling|numb|throbbing|cramping)\b/.test(
            part,
          ) && new RegExp(`\\b${label}\\b`).test(part),
      );
    })
    .map(({ id }) => id);
  return { fields, locations };
}

export function applyVoiceDraft(
  entry: SavedMap,
  draft: VoiceDraftValue,
): SavedMap {
  const text = draft.text.trim();
  if (!text || text.length > 3000)
    throw new Error("Use a transcript of 3,000 characters or fewer.");
  const note = [entry.note.trim(), text].filter(Boolean).join("\n\n");
  if (note.length > 3000)
    throw new Error(
      "The combined note is too long. Shorten the transcript before adding it.",
    );
  return { ...entry, note, map: { ...entry.map, ...draft.fields } };
}
