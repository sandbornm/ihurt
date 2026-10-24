import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFollowUp,
  buildProposal,
  parseIntensityAnswer,
  resolveOnset,
} from "../src/voice/extraction.ts";

const today = "2026-10-22";
const raw = (over: object = {}) => ({
  spokenLocation: "tobillo",
  region: "",
  side: "unspecified",
  qualities: [],
  intensity: null,
  onsetPhrase: "",
  activity: "",
  surface: "",
  ...over,
});
const answered = (
  note: string,
  said: string,
  spoken: string,
  lang: "en" | "es",
) => {
  const location = answerFollowUp(
    buildProposal(raw({ spokenLocation: spoken }), note, today, lang),
    said,
  ).location as { status: string; region?: string };
  return location.status === "mapped" ? location.region : location.status;
};
const status = (
  said: string,
  spoken: string,
  side: string,
  lang: "en" | "es",
) =>
  (
    buildProposal(raw({ spokenLocation: spoken, side }), said, today, lang)
      .location as { status: string }
  ).status;

test("a side answer keeps the part when the note ends in a negated clause", () => {
  for (const [note, said, spoken, lang, region] of [
    [
      "Me duele el tobillo, no mucho",
      "la izquierda",
      "tobillo",
      "es",
      "left_ankle",
    ],
    [
      "Me duele el tobillo, no tanto",
      "la derecha",
      "tobillo",
      "es",
      "right_ankle",
    ],
    ["My ankle hurts, not badly", "the left one", "ankle", "en", "left_ankle"],
    ["My ankle hurts, nothing else", "left", "ankle", "en", "left_ankle"],
    ["My ankle hurts, not too bad.", "right", "ankle", "en", "right_ankle"],
  ] as const)
    assert.equal(answered(note, said, spoken, lang), region, note);
});

test("'no,' before an affirmative side statement accepts that side", () => {
  for (const [said, lang, region] of [
    ["no, es la derecha", "es", "right_ankle"],
    ["no, es la izquierda", "es", "left_ankle"],
    ["no, it's the right one", "en", "right_ankle"],
    ["no, it's the left one", "en", "left_ankle"],
  ] as const)
    assert.equal(
      answered(
        lang === "es" ? "Me duele el tobillo" : "My ankle hurts",
        said,
        lang === "es" ? "tobillo" : "ankle",
        lang,
      ),
      region,
      said,
    );
  for (const [said, lang] of [
    ["no es la derecha", "es"],
    ["no es la izquierda", "es"],
    ["it's not the right one", "en"],
    ["no, it's not the left one", "en"],
    ["no left", "en"],
    ["no", "en"],
  ] as const)
    assert.equal(
      answered(
        lang === "es" ? "Me duele el tobillo" : "My ankle hurts",
        said,
        lang === "es" ? "tobillo" : "ankle",
        lang,
      ),
      "need-side",
      said,
    );
});

test("Spanish corrections: 'no está bien' keeps the pain, 'ya está bien' clears it", () => {
  const base = "La rodilla izquierda no me duele, ";
  for (const tail of [
    "es que ya está mejor",
    "es que ya está bien",
    "es que todavía está mejor",
    "es que aún está bien",
    "es que sigue bien",
    "es que sigue sin doler",
  ])
    assert.notEqual(
      status(base + tail, "rodilla izquierda", "left", "es"),
      "mapped",
      tail,
    );
  for (const tail of [
    "es que no está bien",
    "es que todavía sigue",
    "es que sigue doliendo",
    "es que no está mejor",
  ])
    assert.equal(
      status(base + tail, "rodilla izquierda", "left", "es"),
      "mapped",
      tail,
    );
});

test("'can't be on/walking' is ability, 'can't be my knee' is a denial", () => {
  for (const said of [
    "I can't be on my left knee",
    "I couldn't be walking on my left knee",
    "I can't be standing on my left knee",
  ])
    assert.equal(status(said, "left knee", "left", "en"), "mapped", said);
  for (const said of [
    "It can't be my left knee",
    "It couldn't be the left knee",
  ])
    assert.notEqual(status(said, "left knee", "left", "en"), "mapped", said);
});

test("'ayer por la mañana' and a bare 'mañana' next to a counted offset", () => {
  assert.equal(
    resolveOnset("hace una semana ayer por la mañana", today).date,
    "2026-10-14",
  );
  assert.equal(
    resolveOnset("ayer por la mañana hizo una semana", today).date,
    "2026-10-14",
  );
  assert.equal(resolveOnset("ayer hizo una semana", today).date, "2026-10-14");
  assert.equal(
    resolveOnset("a week ago yesterday morning", today).date,
    "2026-10-14",
  );
  assert.equal(
    resolveOnset("hace una semana por la mañana", today).date,
    "2026-10-15",
  );
  assert.equal(resolveOnset("hace una semana mañana", today).date, undefined);
  assert.equal(resolveOnset("a week ago tomorrow", today).date, "2026-10-16");
});

test("'7 en punto', 'del 7' and '7 octubre' are not ratings", () => {
  for (const said of [
    "7 en punto",
    "del 7",
    "desde el 7",
    "7 octubre",
    "7 de octubre",
    "since 7 october",
  ])
    assert.equal(parseIntensityAnswer(said), null, said);
  for (const said of ["7", "un 7", "siete", "como un siete", "I'd say 7"])
    assert.equal(parseIntensityAnswer(said), 7, said);
});
