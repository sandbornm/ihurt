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

function onset(note: string, evidence: string, date: string | null) {
  return propose(note, {
    locations: [
      { evidence: "left knee", sideEvidence: "left", negated: false },
    ],
    onset: { evidence, date, kind: "date" },
  }).fields.duration;
}

test("a later 'it hurts' of any kind keeps a part that did not hurt in some situation", () => {
  for (const note of [
    "My left knee doesn't hurt when I walk but it hurts when I sit",
    "My left knee doesn't hurt when I walk but it aches when I sit",
    "My left knee doesn't hurt when I walk but it throbs when I sit down",
    "My left knee doesn't hurt when I walk. It hurts when I sit",
  ])
    assert.equal(where(note, knee), "left_knee", note);
  assert.equal(
    where(
      "No me duele la rodilla izquierda cuando camino pero me duele cuando me siento",
      rodilla,
      "es",
    ),
    "left_knee",
  );
  assert.equal(where("My left knee doesn't hurt when I walk", knee), "missing");
});

test("a recovery phrase does not clear a part that still hurts or that it does not name", () => {
  for (const note of [
    "My left knee stopped hurting but it still hurts",
    "My left knee stopped hurting but it hurts again",
    "My left knee pain stopped so I went away",
    "The pain in my left knee, so I went away",
    "My left knee pain so I went away",
  ])
    assert.equal(where(note, knee), "left_knee", note);
  assert.equal(
    where(
      "La rodilla izquierda me duele y se me quitó el abrigo",
      rodilla,
      "es",
    ),
    "left_knee",
  );
  assert.equal(
    where("Me duele la rodilla izquierda, se quitó", rodilla, "es"),
    "left_knee",
  );
  // These still clear.
  for (const note of [
    "My left knee stopped hurting",
    "The pain in my left knee is gone",
    "The pain in my left knee went away",
  ])
    assert.equal(where(note, knee), "missing", note);
  assert.equal(
    where("Se me quitó el dolor de la rodilla izquierda", rodilla, "es"),
    "missing",
  );
});

test("'bien' before an adjective means very, not recovered", () => {
  for (const note of [
    "Mi rodilla izquierda está bien fuerte",
    "Mi rodilla izquierda está bien mal",
    "Mi rodilla izquierda dolió ayer pero ahora está bien fuerte",
  ])
    assert.equal(where(note, rodilla, "es"), "left_knee", note);
  for (const note of [
    "Mi rodilla izquierda está bien",
    "Mi rodilla izquierda ya está bien",
    "Mi rodilla izquierda dolió ayer pero ahora está bien",
  ])
    assert.equal(where(note, rodilla, "es"), "missing", note);
});

test("a second part that hurts after 'because' is not dropped", () => {
  assert.equal(
    where("My left knee hurts because my right shoulder hurts", [
      ["left knee", "left"],
    ]),
    "ambiguous",
  );
  assert.equal(
    where(
      "Me duele la rodilla izquierda porque me duele el hombro derecho",
      rodilla,
      "es",
    ),
    "ambiguous",
  );
  // A cause that is not hurting is still just a cause.
  assert.equal(
    where("My left knee hurts because I walk a lot", knee),
    "left_knee",
  );
});

test("a bare 'may' or 'march' is not a month, and 'may be a 7' is a guess", () => {
  assert.equal(
    onset("My left knee hurts and it may get worse", "may", null),
    undefined,
  );
  assert.equal(
    onset("My left knee hurts, I march a lot", "march", null),
    undefined,
  );
  assert.equal(
    onset("My left knee hurts since May", "May", "2026-05-01"),
    "Since May",
  );
  assert.equal(
    onset("My left knee hurts, started in March", "March", "2026-03-01"),
    "Since March",
  );
  assert.equal(rating("My left knee hurts, it may be a 7", 7, knee), undefined);
  assert.equal(
    rating("My left knee hurts, it might be a 7", 7, knee),
    undefined,
  );
  assert.equal(rating("My left knee hurts, it is a 7", 7, knee), 7);
});
