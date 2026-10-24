import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceExtraction } from "../src/platform/on-device-ai.ts";
import { answerFollowUp, buildProposal } from "../src/voice/extraction.ts";

const today = "2026-10-22";

const blank = (): EvidenceExtraction => ({
  locations: [],
  intensity: null,
  qualities: [],
  onset: null,
  activity: "",
});

function propose(
  note: string,
  patch: Partial<EvidenceExtraction>,
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
      evidence: { ...blank(), ...patch },
    },
    note,
    today,
    lang,
  );
}

const where = (
  note: string,
  evidence: string,
  sideEvidence: string,
  lang: "en" | "es" = "en",
) =>
  propose(
    note,
    { locations: [{ evidence, negated: false, sideEvidence }] },
    lang,
  ).location;

const rating = (note: string, evidence: string) =>
  propose(note, {
    locations: [
      { evidence: "left knee", negated: false, sideEvidence: "left" },
    ],
    intensity: { evidence, value: 7, kind: "rating", negated: false },
  }).fields.intensity;

test("a turn direction is not the side of the knee (EN and ES)", () => {
  for (const [note, ev, side, lang] of [
    ["When I turn left and right my knee hurts", "knee", "right", "en"],
    ["I turned left, my knee hurts", "knee", "left", "en"],
    ["Walking left hurts my knee", "knee", "left", "en"],
    ["When I go left or right my knee hurts", "knee", "right", "en"],
    ["I just left because my knee hurts", "knee", "left", "en"],
    ["My boss left because my knee hurts", "knee", "left", "en"],
    [
      "Cuando giro a la izquierda y a la derecha me duele la rodilla",
      "rodilla",
      "derecha",
      "es",
    ],
    [
      "Me duele la rodilla al girar a la derecha y a la izquierda",
      "rodilla",
      "izquierda",
      "es",
    ],
    ["Me fui y me duele la rodilla", "rodilla", "izquierda", "es"],
  ] as const) {
    assert.notEqual(where(note, ev, side, lang).status, "mapped", note);
  }
});

test("a real side still maps beside an unrelated 'left'", () => {
  for (const [note, ev, side] of [
    ["The doctor left and my right knee hurts", "right knee", "right"],
    ["He left early, my knee hurts on the left", "knee", "left"],
    ["I just walked, my left knee hurts", "left knee", "left"],
  ] as const) {
    assert.equal(where(note, ev, side).status, "mapped", note);
  }
});

test("a denied earlier day with a denied today is not a pain entry", () => {
  for (const [note, lang] of [
    ["My left knee didn't hurt yesterday and it doesn't hurt today", "en"],
    ["My left knee didn't hurt yesterday but doesn't hurt today either", "en"],
    ["My left knee did not hurt earlier and it does not hurt now", "en"],
    ["My left knee hasn't hurt all week", "en"],
    ["Mi rodilla izquierda no dolía ayer y hoy tampoco", "es"],
  ] as const) {
    assert.equal(
      where(
        note,
        lang === "en" ? "left knee" : "rodilla izquierda",
        lang === "en" ? "left" : "izquierda",
        lang,
      ).status,
      "missing",
      note,
    );
  }
  assert.equal(
    where(
      "My left knee didn't hurt yesterday but it hurts today",
      "left knee",
      "left",
    ).status,
    "mapped",
  );
  assert.equal(
    where(
      "My left knee didn't hurt before and it hurts now",
      "left knee",
      "left",
    ).status,
    "mapped",
  );
});

test("7/10 as days, a date, or a count is not a rating", () => {
  for (const [note, ev] of [
    ["My left knee hurts 7/10 days", "7/10"],
    ["My left knee hurts 7/10 days a week", "7/10"],
    ["My left knee hurts, 7 out of 10 times", "7 out of 10"],
    ["My left knee hurts on the 7/10", "7/10"],
    ["My left knee hurts since 7/10", "7/10"],
    ["My left knee hurts, 7/10 last year", "7/10"],
  ] as const) {
    assert.equal(rating(note, ev), undefined, note);
  }
  assert.equal(rating("My left knee hurts, it is 7/10", "7/10"), 7);
  assert.equal(rating("My left knee hurts, a 7 out of 10", "7 out of 10"), 7);
});

test("side replies that are motion or leaving ask again", () => {
  const p = propose("My knee hurts", {
    locations: [{ evidence: "knee", negated: false, sideEvidence: "" }],
  });
  for (const reply of [
    "I just left",
    "turn left",
    "just left",
    "I left",
    "he left",
    "go left",
    "turning left",
  ]) {
    assert.equal(answerFollowUp(p, reply).location.status, "need-side", reply);
  }
  assert.equal(answerFollowUp(p, "left").location.status, "mapped");
  assert.equal(answerFollowUp(p, "it's on the left").location.status, "mapped");
});
