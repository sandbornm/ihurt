import {
  regionNameIn,
  regions,
  type RegionId,
  type SavedMap,
} from "../types.ts";
import { t } from "../i18n/index.ts";

export type DraftFields = Partial<
  Pick<SavedMap["map"], "intensity" | "quality" | "activity" | "duration">
>;
export type VoiceDraftValue = {
  text: string;
  fields: DraftFields;
  region?: RegionId;
  // Set only by the on-device proposal: show a proposed pin that still needs
  // its own confirmation in the region callout.
  proposePin?: boolean;
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
const spanish = [
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
];
const rating = (word: string) =>
  /^\d+$/.test(word)
    ? Number(word)
    : numbers.includes(word)
      ? numbers.indexOf(word)
      : spanish.indexOf(word);
// Letters on both sides, so accented words such as "quemazón" match whole.
const word = (body: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "gu");
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Suggestions quote explicit phrases in English or Spanish. They never choose
// surface coordinates.
export function suggestVoiceDraft(text: string) {
  const fields: DraftFields = {};
  // Commas end a clause too, so "me duele el pie izquierdo, no mucho" keeps
  // the foot. "nada mas", "no mas" (only) and "sin duda" (certainly) are not
  // denials.
  const clauses = text
    .toLowerCase()
    .replace(/\b(?<!ya )(?:nada|no) m[aá]s\b/g, "solo")
    .replace(/\bsin (?:duda|embargo)\b/g, "seguro")
    .split(/[.!?;,\n]+/)
    .filter(
      (part) =>
        !/\b(no|not|without|never|denies|doesn't|don't|isn't|wasn't)\b/.test(
          part,
        ) && !word("nunca|sin|tampoco|niega|niego|ningún|ninguna").test(part),
    );
  const clean = clauses.join(". ");
  const ratings = [
    ...clean.matchAll(
      /\b(10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\/\s*10|out of (?:10|ten))\b/g,
    ),
    ...fold(clean).matchAll(
      /\b(10|[0-9]|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:\/\s*10|(?:de|sobre) (?:10|diez))\b/g,
    ),
  ].map((match) => rating(match[1]));
  if (ratings.length === 1) fields.intensity = ratings[0];
  const qualities = [
    ...new Set(
      clean.match(
        word(
          "aching|sharp|burning|tingling|numb|stiff|tight|dull|throbbing|sore|cramping|ardor|ardiente|quemazón|punzante|pinchazos?|sordo|hormigueo|entumecid[oa]|adormecid[oa]|rigidez|rígid[oa]|tens[oa]|tirante|palpitante|pulsátil|calambres?|adolorid[oa]|molestia|agud[oa]",
        ),
      ) ?? [],
    ),
  ];
  if (qualities.length) fields.quality = qualities.join(", ");
  // Labeled phrases avoid guessing an activity from unrelated mentions.
  const activity = text.match(
    /(?:\bactivity|\bactividad)\s*:\s*([^.!?;\n]{1,120})/i,
  );
  const duration = text.match(
    /(?:\b(?:duration|timing)|\bduraci[oó]n|\bdesde cu[aá]ndo)\s*:\s*([^.!?;\n]{1,120})/i,
  );
  if (activity) fields.activity = activity[1].trim();
  if (duration) fields.duration = duration[1].trim();
  const locations = regions
    .filter(({ id }) => {
      const label = id.replaceAll("_", " ");
      // The Spanish name as people say it: "muñeca izquierda", not "muñeca y
      // mano izquierda".
      const nombre = fold(regionNameIn("es", id)).replace(" y mano", "");
      return clauses.some(
        (part) =>
          (/\b(?:hurts?|pain|aches?|aching|discomfort|sore|tight|stiff|burning|tingling|numb|throbbing|cramping)\b/.test(
            part,
          ) &&
            new RegExp(`\\b${label}\\b`).test(part)) ||
          (/\b(?:duele|duelen|dolor|dolores|molesta|molestia|arde|ardor|punzante|hormigueo|calambre|tension|rigidez|adolorid[oa])\b/.test(
            fold(part),
          ) &&
            new RegExp(`\\b${nombre}\\b`).test(fold(part))),
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
    throw new Error(t("native.transcript-too-long"));
  const note = [entry.note.trim(), text].filter(Boolean).join("\n\n");
  if (note.length > 3000) throw new Error(t("voice.error.noteTooLong"));
  return { ...entry, note, map: { ...entry.map, ...draft.fields } };
}

// What the panel tells the person about where their voice goes. It must match
// what will actually happen: on iOS speech stays on the device; on the web the
// server only accepts audio when a transcription provider is turned on.
export function voiceNotice(state: {
  native: boolean;
  checking: boolean;
  provider: string | null | undefined;
  available: boolean;
  maxSeconds: number;
}) {
  if (state.native) return t("voice.notice.native");
  if (state.checking) return t("voice.notice.checking");
  if (state.available && state.provider)
    return t("voice.notice.provider", {
      seconds: state.maxSeconds,
      provider: state.provider,
    });
  return t("voice.notice.off");
}
