import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceExtraction } from "../src/platform/on-device-ai.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import { answerFollowUp, buildProposal } from "../src/voice/extraction.ts";

const today = "2026-10-22";

function where(
  note: string,
  locations: { evidence: string; sideEvidence: string }[],
  lang: "en" | "es" = "en",
) {
  const evidence: EvidenceExtraction = {
    locations: locations.map((item) => ({ ...item, negated: false })),
    intensity: null,
    qualities: [],
    onset: null,
    activity: "",
  };
  const found = buildProposal(
    {
      spokenLocation: "",
      region: "",
      side: "unspecified",
      qualities: [],
      intensity: null,
      onsetPhrase: "",
      activity: "",
      surface: "",
      evidence,
    },
    note,
    today,
    lang,
  ).location;
  return found.status === "mapped" ? found.region : found.status;
}

const one = (evidence: string, sideEvidence: string) => [
  { evidence, sideEvidence },
];

test("'didn't hurt yesterday' is not a current pain unless a later clause says it hurts now", () => {
  for (const [note, lang] of [
    ["My left knee didn't hurt yesterday", "en"],
    ["My left knee wasn't hurting earlier", "en"],
    ["Mi rodilla izquierda no dolía ayer", "es"],
  ] as const)
    assert.equal(
      where(
        note,
        one(lang === "es" ? "rodilla izquierda" : "left knee", "left"),
        lang,
      ),
      "missing",
      note,
    );
  for (const [note, lang] of [
    ["My left knee didn't hurt yesterday but now it does", "en"],
    ["My left knee didn't hurt yesterday. It hurts today", "en"],
    ["Mi rodilla izquierda no dolía ayer pero hoy sí", "es"],
  ] as const)
    assert.equal(
      where(
        note,
        one(lang === "es" ? "rodilla izquierda" : "left knee", "left"),
        lang,
      ),
      "left_knee",
      note,
    );
  assert.equal(
    where(
      "My left knee didn't hurt yesterday and it doesn't hurt today",
      one("left knee", "left"),
    ),
    "missing",
  );
});

test("the part said twice with a side each is both, even when the model kept one", () => {
  for (const [note, lang] of [
    ["My left knee and my right knee hurt", "en"],
    ["Left knee and right knee", "en"],
    ["Me duelen la rodilla izquierda y la rodilla derecha", "es"],
    ["Rodilla izquierda y rodilla derecha", "es"],
  ] as const) {
    const part = lang === "es" ? "rodilla" : "knee";
    assert.equal(where(note, one(part, ""), lang), "both", note);
    assert.equal(
      where(
        note,
        one(`${lang === "es" ? "rodilla izquierda" : "left knee"}`, "left"),
        lang,
      ),
      "both",
      note,
    );
  }
  assert.notEqual(
    where("My left knee and right ankle hurt", one("left knee", "left")),
    "both",
  );
});

test("a left or right alternative asks, and 'no left' does not save left", () => {
  assert.equal(
    where("My left knee or my right knee hurts", one("knee", "")),
    "need-side",
  );
  const asked = buildProposal(
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
        locations: [{ evidence: "knee", negated: false, sideEvidence: "" }],
        intensity: null,
        qualities: [],
        onset: null,
        activity: "",
      },
    },
    "My knee hurts",
    today,
    "en",
  );
  assert.equal(asked.location.status, "need-side");
  for (const said of ["no left", "not the left one", "no la izquierda"]) {
    const next = answerFollowUp(asked, said).location;
    assert.equal(next.status, "need-side", said);
  }
});

test("only real hedges become 'poco'; 'not that ankle' still denies the part", () => {
  assert.deepEqual(
    suggestVoiceDraft("My left ankle hurts, not that bad").locations,
    ["left_ankle"],
  );
  assert.deepEqual(
    suggestVoiceDraft("Me duele el tobillo izquierdo no mucho").locations,
    ["left_ankle"],
  );
  assert.deepEqual(
    suggestVoiceDraft("My left ankle hurts not too bad").locations,
    ["left_ankle"],
  );
  assert.deepEqual(
    suggestVoiceDraft("Not that left ankle hurts").locations,
    [],
  );
  assert.deepEqual(
    suggestVoiceDraft("No tanto el tobillo izquierdo duele").locations,
    [],
  );
});

test("'I can't lie', 'dormitorio' and 'acostumbrada' are not sleep", () => {
  assert.equal(
    where(
      "I can't lie to you but on the left my knee hurts",
      one("knee", "left"),
    ),
    "left_knee",
  );
  assert.equal(
    where(
      "En el dormitorio a la izquierda me duele la rodilla",
      one("rodilla", "izquierda"),
      "es",
    ),
    "left_knee",
  );
  assert.equal(
    where(
      "Estoy acostumbrada pero a la izquierda me duele la rodilla",
      one("rodilla", "izquierda"),
      "es",
    ),
    "left_knee",
  );
  for (const [note, lang, side, part] of [
    ["I lie down on the left and my knee hurts", "en", "left", "knee"],
    [
      "Dormí a la izquierda y me duele la rodilla",
      "es",
      "izquierda",
      "rodilla",
    ],
  ] as const)
    assert.notEqual(where(note, one(part, side), lang), "left_knee", note);
});

test("'it's not stopped' and 'it's no better' keep the pain", () => {
  for (const tail of [
    "it's not stopped",
    "it's no better",
    "it's not improved",
  ]) {
    assert.equal(
      where(`My left knee doesn't hurt, ${tail}`, one("left knee", "left")),
      "left_knee",
      tail,
    );
  }
  assert.equal(
    where("My left knee doesn't hurt, it's stopped", one("left knee", "left")),
    "missing",
  );
});
