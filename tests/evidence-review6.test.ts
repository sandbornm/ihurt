import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceExtraction } from "../src/platform/on-device-ai.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import { buildProposal } from "../src/voice/extraction.ts";

const today = "2026-10-22";

function propose(
  note: string,
  evidence: Partial<EvidenceExtraction>,
  lang: "en" | "es" = "en",
) {
  return buildProposal(
    {
      spokenLocation: "",
      region: "",
      side: "unspecified",
      qualities: [],
      intensity: null,
      onsetPhrase: "",
      activity: "",
      surface: "",
      evidence: {
        locations: [],
        intensity: null,
        qualities: [],
        onset: null,
        activity: "",
        ...evidence,
      },
    },
    note,
    today,
    lang,
  );
}

function where(
  note: string,
  locations: [string, string][],
  lang: "en" | "es" = "en",
) {
  const found = propose(
    note,
    {
      locations: locations.map(([evidence, sideEvidence]) => ({
        evidence,
        sideEvidence,
        negated: false,
      })),
    },
    lang,
  ).location;
  return found.status === "mapped" ? found.region : found.status;
}

function rating(note: string, value: number, location: [string, string][]) {
  return propose(
    note,
    {
      locations: location.map(([evidence, sideEvidence]) => ({
        evidence,
        sideEvidence,
        negated: false,
      })),
      intensity: {
        evidence: String(value),
        value,
        kind: "rating",
        negated: false,
      },
    },
    /[ñ]|estoy|cuando/.test(note) ? "es" : "en",
  ).fields.intensity;
}

const knee: [string, string][] = [["left knee", "left"]];
const rodilla: [string, string][] = [["rodilla izquierda", "izquierda"]];

test("a later 'but it hurts' keeps a part that only did not hurt in some situation", () => {
  for (const note of [
    "My left knee doesn't hurt when I walk but it hurts when I run",
    "My left knee doesn't hurt at rest but it hurts when I walk",
    "My left knee doesn't hurt when I walk today but it hurts when I run",
    "My left knee doesn't hurt on the inside but it hurts on the outside",
    "My left knee doesn't hurt when I walk unless I run",
  ])
    assert.equal(where(note, knee), "left_knee", note);
  assert.equal(
    where(
      "No me duele la rodilla izquierda cuando camino pero me duele cuando corro",
      rodilla,
      "es",
    ),
    "left_knee",
  );
  for (const note of [
    "My left knee doesn't hurt when I walk",
    "My left knee doesn't hurt when I walk but my right shoulder hurts when I run",
  ])
    assert.equal(where(note, knee), "missing", note);
  assert.equal(
    where(
      "No me duele la rodilla izquierda cuando camino y me duele el hombro derecho cuando corro",
      rodilla,
      "es",
    ),
    "missing",
  );
});

test("a second hurting part after a condition is still asked about", () => {
  for (const [note, lang, list] of [
    ["My left knee hurts when I walk and my right shoulder hurts", "en", knee],
    ["My left knee hurts when I walk as well as my lower back", "en", knee],
    ["My left knee hurts for a while and my right shoulder hurts", "en", knee],
    [
      "My left knee hurts unless I rest and my right shoulder hurts",
      "en",
      knee,
    ],
    [
      "Me duele la rodilla izquierda cuando camino al igual que el hombro derecho",
      "es",
      rodilla,
    ],
    [
      "Me duele la rodilla izquierda cuando camino y me duele el hombro derecho",
      "es",
      rodilla,
    ],
  ] as const)
    assert.equal(where(note, [...list], lang), "ambiguous", note);
  assert.equal(
    where("My left knee hurts when I lift my right shoulder", knee),
    "left_knee",
  );
  assert.equal(
    where("My left knee hurts when I walk and it hurts when I run", knee),
    "left_knee",
  );
});

test("'pain is gone' wording only clears when the pain is gone", () => {
  for (const [note, lang, list] of [
    ["My left knee hasn't stopped hurting", "en", knee],
    ["The pain has gone down into my left knee", "en", knee],
    ["The pain is over here in my left knee", "en", knee],
    ["I have pain left knee", "en", knee],
    ["No se me quitó el dolor de la rodilla izquierda", "es", rodilla],
    ["No dejó de dolerme la rodilla izquierda", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...list], lang), "left_knee", note);
  for (const [note, lang, list] of [
    ["My left knee stopped hurting", "en", knee],
    ["The pain in my left knee is gone", "en", knee],
    ["The pain left my left knee", "en", knee],
    ["Se me quitó el dolor de la rodilla izquierda", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...list], lang), "missing", note);
});

test("'right into' and 'right where' are not the right side", () => {
  for (const note of [
    "The pain goes right into my knee",
    "The pain shoots right through my knee",
    "It hurts right where my knee bends",
  ])
    assert.equal(where(note, [["knee", "right"]]), "need-side", note);
});

test("ratings stay when the sentence goes on to wake, work, home or get", () => {
  for (const note of [
    "My left knee hurts, I'm at 7 when I wake",
    "My left knee hurts, I'm at 7 when I wake up",
    "My left knee hurts, I'm at 7 when I get home",
    "My left knee hurts, I'm at 7 when I go to work",
  ])
    assert.equal(rating(note, 7, knee), 7, note);
  assert.equal(
    rating(
      "Me duele la rodilla izquierda, estoy en 7 cuando me despierto",
      7,
      rodilla,
    ),
    7,
  );
});

test("sleeping on my back is a posture, not a second sore spot", () => {
  for (const note of [
    "I sleep on my back and my left knee hurts",
    "My left knee hurts when I sleep on my back",
    "I lie on my back, my left knee hurts",
  ])
    assert.equal(where(note, knee), "left_knee", note);
  assert.equal(
    where("My back hurts and my left knee hurts", knee),
    "ambiguous",
  );
});

test("Spanish 'molestias' suggests the place in the quick draft", () => {
  for (const note of ["Tengo molestias en la rodilla izquierda"])
    assert.deepEqual(suggestVoiceDraft(note).locations, ["left_knee"], note);
});
