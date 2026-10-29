import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceExtraction } from "../src/platform/on-device-ai.ts";
import {
  answerFollowUp,
  buildProposal,
  parseIntensityAnswer,
  resolveOnset,
} from "../src/voice/extraction.ts";

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

const knee: [string, string][] = [["left knee", "left"]];
const rodilla: [string, string][] = [["rodilla izquierda", "izquierda"]];

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

test("'from left to the right knee' is a direction, not a side", () => {
  for (const [note, part] of [
    ["The pain goes from left to the right knee", "right knee"],
    ["It moves from left to the right knee", "knee"],
    ["It spreads from the left to the right knee", "right knee"],
  ] as const)
    for (const side of ["right", "left"])
      assert.notEqual(where(note, [[part, side]]), "right_knee", note);
  assert.equal(
    where("The pain goes from left to the right knee", [
      ["right knee", "right"],
    ]),
    "need-side",
  );
  assert.equal(
    where("It hurts in my right knee", [["right knee", "right"]]),
    "right_knee",
  );
});

test("'right at my left knee' is the left knee, never both", () => {
  const note = "It hurts right at my left knee";
  for (const locations of [
    [["left knee", "left"]],
    [
      ["knee", "right"],
      ["left knee", "left"],
    ],
    [["knee", "right at my left"]],
    [["right at my left knee", "left"]],
  ] as [string, string][][])
    assert.equal(
      where(note, locations),
      "left_knee",
      JSON.stringify(locations),
    );
  assert.equal(
    where("It hurts right above my left knee", [["left knee", "left"]]),
    "left_knee",
  );
  assert.equal(
    where("It hurts on the right in my knee", [["knee", "right"]]),
    "right_knee",
  );
  assert.equal(
    where("It hurts my right knee, right at the joint", [
      ["right knee", "right"],
    ]),
    "right_knee",
  );
});

test("'I'm at 7 when I walk' keeps the rating", () => {
  assert.equal(rating("I'm at 7 when I walk. My left knee hurts", 7, knee), 7);
  assert.equal(
    rating("My left knee hurts, I'm at 7 while walking", 7, knee),
    7,
  );
  assert.equal(
    rating(
      "Estoy en 7 cuando camino. Me duele la rodilla izquierda",
      7,
      rodilla,
    ),
    7,
  );
});

test("a spanish 'cannot sit because the knee hurts' keeps the knee", () => {
  assert.equal(
    where(
      "No puede estar sentado porque le duele la rodilla izquierda",
      rodilla,
      "es",
    ),
    "left_knee",
  );
  assert.equal(
    where("He can't be sitting because his left knee hurts", knee),
    "left_knee",
  );
});

test("a bare 'back' that hurts is a second sore spot", () => {
  for (const [note, lang, part] of [
    ["My back hurts and my left knee hurts", "en", knee],
    ["My left knee hurts and my back hurts too", "en", knee],
    ["Me duele la espalda y la rodilla izquierda", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...part], lang), "ambiguous", note);
  for (const [note, lang, part] of [
    ["My left knee hurts. Back at work I sat down", "en", knee],
    ["My left knee hurts when I lie on my back", "en", knee],
    ["My left knee hurts, the back of my knee too", "en", knee],
    ["My left knee hurts and I stood with my back to the wall", "en", knee],
    ["Me duele la rodilla izquierda cuando duermo de espalda", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...part], lang), "left_knee", note);
});

test("a pain that is already over is not a sore spot", () => {
  for (const [note, lang, part] of [
    ["My left knee stopped hurting", "en", knee],
    ["The pain in my left knee is gone", "en", knee],
    ["The pain in my left knee went away", "en", knee],
    ["My left knee has stopped hurting but it still feels stiff", "en", knee],
    ["My left knee hurt yesterday but it's fine now", "en", knee],
    ["My left knee hurt yesterday but not today", "en", knee],
    ["Se me quitó el dolor de la rodilla izquierda", "es", rodilla],
    ["Ya pasó el dolor de la rodilla izquierda", "es", rodilla],
    ["Mi rodilla izquierda dejó de doler", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...part], lang), "missing", note);
  for (const [note, lang, part] of [
    ["My left knee hurts less now", "en", knee],
    ["My left knee hurt yesterday and it hurts today", "en", knee],
    ["My left knee hurts, the pain in my right ankle is gone", "en", knee],
    ["Mi rodilla izquierda duele menos", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...part], lang), "left_knee", note);
});

test("month, year and calendar-date onset phrases are kept", () => {
  const onset = (note: string, phrase: string, lang: "en" | "es" = "en") =>
    propose(
      note,
      {
        locations: [
          {
            evidence: lang === "en" ? "knee" : "rodilla",
            sideEvidence: "",
            negated: false,
          },
        ],
        onset: { evidence: phrase, negated: false },
      },
      lang,
    ).fields.duration;
  for (const [note, phrase, lang] of [
    ["My knee has hurt for two months ago", "two months ago", "en"],
    ["My knee started hurting two months ago", "two months ago", "en"],
    ["My knee started hurting October 20", "October 20", "en"],
    ["My knee has hurt since last year", "since last year", "en"],
    ["Me duele la rodilla desde hace dos meses", "hace dos meses", "es"],
    ["Me duele la rodilla desde el 20 de octubre", "20 de octubre", "es"],
    ["Me duele la rodilla desde el año pasado", "año pasado", "es"],
  ] as const)
    assert.ok(onset(note, phrase, lang), `${note} / ${phrase}`);
  assert.equal(
    onset("My knee hurts when I run 5 miles in October", "5 miles"),
    undefined,
  );
});
