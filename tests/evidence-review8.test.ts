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
const left: [string, string][] = [["left knee", "left"]];
const right: [string, string][] = [["right knee", "right"]];
const rodillaIzq: [string, string][] = [["rodilla izquierda", "izquierda"]];
const lowerBack: [string, string][] = [["lower back", ""]];
const blade: [string, string][] = [["shoulder blade", ""]];
const shoulderLeft: [string, string][] = [["left shoulder", "left"]];
const espaldaBaja: [string, string][] = [["espalda baja", ""]];

test("a Spanish recovery that names 'por completo' before 'el dolor' still clears the part", () => {
  for (const note of [
    "Se me quitó por completo el dolor de la rodilla izquierda",
    "Se me pasó por completo el dolor de la rodilla izquierda",
    "Se me quitó del todo el dolor de la rodilla izquierda",
    "Se me quitó por fin el dolor de la rodilla izquierda",
    "Se me quitó por completo la molestia de la rodilla izquierda",
  ])
    assert.equal(where(note, rodillaIzq, "es"), "missing", note);
  // Still hurting after the recovery phrase keeps it.
  assert.equal(
    where(
      "Se me quitó por completo el dolor pero la rodilla izquierda me duele",
      rodillaIzq,
      "es",
    ),
    "left_knee",
  );
});

test("a cause that says a two-word part still hurts keeps that part", () => {
  assert.equal(
    where("My lower back pain is gone because my lower back hurts", lowerBack),
    "lower_back",
  );
  assert.equal(
    where(
      "My shoulder blade pain is gone because my shoulder blade hurts",
      blade,
    ),
    "upper_back",
  );
  assert.equal(
    where(
      "Se me quitó el dolor de la espalda baja porque la espalda baja me duele",
      espaldaBaja,
      "es",
    ),
    "lower_back",
  );
  // A different part, or a blade that is not the shoulder, keeps nothing.
  assert.equal(
    where(
      "My left shoulder pain is gone because my shoulder blade hurts",
      shoulderLeft,
    ),
    "missing",
  );
  assert.equal(
    where("My lower back pain is gone because my upper back hurts", lowerBack),
    "missing",
  );
});

test("a cause keeps the part for any complaint form, and not for a negated one", () => {
  for (const cause of [
    "my left knee bothers me",
    "my left knee pain is worse",
    "my left knee is burning",
    "my left knee is still tender",
  ])
    assert.equal(
      where(`My left knee pain is gone because ${cause}`, left),
      "left_knee",
      cause,
    );
  assert.equal(
    where(
      "Se me quitó el dolor de la rodilla izquierda porque la rodilla izquierda sigue mal",
      rodillaIzq,
      "es",
    ),
    "left_knee",
  );
  for (const cause of [
    "I have no swelling",
    "my left knee has no pain",
    "my left knee is no longer sore",
    "my left knee healed",
  ])
    assert.equal(
      where(`My left knee pain is gone because ${cause}`, left),
      "missing",
      cause,
    );
});

test("a side beyond the adjacent word is read, and the denied side stays denied", () => {
  const keepsLeft = [
    "My left knee pain is gone because the knee on the left hurts",
  ];
  for (const note of keepsLeft)
    assert.equal(where(note, left), "left_knee", note);
  for (const note of [
    "My left knee pain is gone because the knee on the right hurts",
  ])
    assert.equal(where(note, left), "missing", note);
  assert.equal(
    where(
      "My right knee didn't hurt yesterday. My left swollen knee hurts today",
      right,
    ),
    "missing",
  );
  assert.equal(
    where(
      "La rodilla izquierda no me dolía ayer. La rodilla de la derecha me duele hoy",
      rodillaIzq,
      "es",
    ),
    "missing",
  );
  // The same side still lifts the denial.
  assert.equal(
    where(
      "My left knee didn't hurt yesterday. My swollen knee on the left hurts today",
      left,
    ),
    "left_knee",
  );
  // "right now" is not a side.
  assert.equal(
    where(
      "My left knee pain is gone because my left knee hurts right now",
      left,
    ),
    "left_knee",
  );
});

test("'some' before a time word is partial, and 'some time' is not", () => {
  for (const note of [
    "My left knee pain subsided some this morning",
    "My left knee pain subsided some yesterday",
    "My left knee pain went away some overnight",
  ])
    assert.equal(where(note, left), "left_knee", note);
  for (const note of [
    "My left knee pain went away some time ago",
    "My left knee pain subsided some days ago",
  ])
    assert.equal(where(note, left), "missing", note);
});

test("a time word is not a partial recovery", () => {
  for (const note of [
    "My left knee pain went away almost immediately",
    "My left knee pain disappeared almost immediately",
    "My left knee pain went away mainly after I rested",
    "My left knee pain went away a little while ago",
    "My left knee pain went away nearly instantly",
  ])
    assert.equal(where(note, left), "missing", note);
  for (const note of [
    "Se me quitó el dolor de la rodilla izquierda casi de inmediato",
    "Se me quitó el dolor de la rodilla izquierda hace poco",
  ])
    assert.equal(where(note, rodillaIzq, "es"), "missing", note);
  // Real partials stay.
  for (const note of [
    "My left knee pain went away almost completely",
    "My left knee pain is mostly gone",
    "My left knee pain went away a little",
  ])
    assert.equal(where(note, left), "left_knee", note);
  assert.equal(
    where(
      "Se me quitó casi por completo el dolor de la rodilla izquierda",
      rodillaIzq,
      "es",
    ),
    "left_knee",
  );
});

test("a partial word after a contrast belongs to the next clause", () => {
  assert.equal(
    where("My left knee pain went away but my right ankle is a bit sore", left),
    "missing",
  );
  assert.equal(
    where(
      "Se me quitó el dolor de la rodilla izquierda pero el tobillo me duele un poco",
      rodillaIzq,
      "es",
    ),
    "missing",
  );
  // A hedge past the old six-word window still counts.
  assert.equal(
    where(
      "Se me quitó el dolor de la rodilla izquierda de la pierna de ayer un poco",
      rodillaIzq,
      "es",
    ),
    "left_knee",
  );
});

test("a leading cause clause keeps what hurts inside it, whichever the order", () => {
  assert.equal(
    where("Because my left knee hurts my right ankle pain is gone", left),
    "left_knee",
  );
  assert.equal(
    where("Since my right knee hurts my left knee pain is gone", right),
    "right_knee",
  );
  assert.equal(
    where("Since my right knee hurts my left knee pain is gone", left),
    "missing",
  );
  assert.equal(
    where(
      "Porque me duele la rodilla izquierda se me quitó el dolor del tobillo",
      rodillaIzq,
      "es",
    ),
    "left_knee",
  );
});

test("a later guess about the rating is still a guess after a guessed cause", () => {
  assert.equal(
    rating("It might be from running but it could be a 7", 7, knee),
    undefined,
  );
  assert.equal(
    rating(
      "Puede ser por correr pero podría ser un 7, me duele la rodilla izquierda",
      7,
      rodilla,
    ),
    undefined,
  );
  assert.equal(
    rating(
      "It might be from running and it may be a 7, my left knee hurts",
      7,
      knee,
    ),
    undefined,
  );
  // A guessed cause alone, or a stated rating after it, still stands.
  assert.equal(
    rating(
      "It might be from running but the pain in my left knee is 7 out of 10",
      7,
      knee,
    ),
    7,
  );
  assert.equal(
    rating(
      "My left knee hurts, it might be from running but it is a 7",
      7,
      knee,
    ),
    7,
  );
});
