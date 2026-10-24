import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProposal,
  parseIntensityAnswer,
  ratedIn,
} from "../src/voice/extraction.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import { translate } from "../src/i18n/index.ts";

const today = "2026-10-22";
const raw = (over: object = {}) => ({
  spokenLocation: "left knee",
  region: "",
  side: "left",
  qualities: [],
  intensity: null,
  onsetPhrase: "",
  activity: "",
  surface: "",
  ...over,
});
const propose = (note: string, over: object = {}, lang: "en" | "es" = "en") =>
  buildProposal(raw(over), note, today, lang);
const status = (note: string, spoken: string, lang: "en" | "es" = "en") =>
  (
    propose(note, { spokenLocation: spoken }, lang).location as {
      status: string;
    }
  ).status;

test("'can't be' denies the part only when the part follows directly", () => {
  for (const note of [
    "It can't be my left knee",
    "It can't be in my left knee",
    "It can't be on my left knee",
    "I can't believe it, it can't be the left knee",
  ])
    assert.equal(status(note, "left knee"), "unmapped", note);
  for (const note of [
    "I can't be at work because of my left knee",
    "I can't be on my feet because my left knee hurts",
    "I can't be walking, my left knee hurts",
  ])
    assert.equal(status(note, "left knee"), "mapped", note);
});

test("Spanish 'no puede estar' denies the part only when the part follows directly", () => {
  for (const note of [
    "No puede ser la rodilla izquierda",
    "No puede estar en la rodilla izquierda",
  ])
    assert.equal(status(note, "rodilla izquierda", "es"), "unmapped", note);
  for (const note of [
    "No puede estar de pie por la rodilla izquierda",
    "No puede estar sentado porque le duele la rodilla izquierda",
    "No puedo estar de pie por la rodilla izquierda",
  ])
    assert.equal(status(note, "rodilla izquierda", "es"), "mapped", note);
});

test("'no es un dolor fuerte' is a hedge, not a denial", () => {
  assert.equal(
    status(
      "La rodilla izquierda no es un dolor fuerte",
      "rodilla izquierda",
      "es",
    ),
    "mapped",
  );
  assert.deepEqual(
    suggestVoiceDraft("La rodilla izquierda no es un dolor fuerte").locations,
    ["left_knee"],
  );
  assert.equal(
    status("La rodilla izquierda no es un dolor", "rodilla izquierda", "es"),
    "unmapped",
  );
});

test("'No puede correr' negates running", () => {
  assert.equal(
    propose("No puede correr", { activity: "correr" }, "es").fields.activity,
    undefined,
  );
  assert.equal(
    propose("Puede correr", { activity: "correr" }, "es").fields.activity,
    "correr",
  );
});

test("a day range after a month is a date, not a rating", () => {
  for (const note of [
    "May 7 or 8",
    "It started May 7 or 8",
    "7 or 8 of May",
    "Empezó el 7 u 8 de mayo",
    "October 7 or 8",
    "mayo 7 o 8",
  ]) {
    assert.equal(parseIntensityAnswer(note), null, note);
    for (const value of [7, 8]) assert.equal(ratedIn(note, value), false, note);
  }
  assert.equal(parseIntensityAnswer("It may be a 7"), 7);
  assert.equal(parseIntensityAnswer("7 out of 10"), 7);
  assert.equal(ratedIn("The pain is a 7, it started May 7", 7), true);
});

test("the map image and share text say 'N de 10' in Spanish", () => {
  assert.equal(
    translate("es", "export.svg.intensity", { value: 7 }),
    "Intensidad: 7 de 10.",
  );
  assert.equal(
    translate("es", "share.text.intensity", { value: 7 }),
    "Intensidad reportada: 7 de 10",
  );
});
