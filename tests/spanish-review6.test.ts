import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProposal,
  parseIntensityAnswer,
  ratedIn,
} from "../src/voice/extraction.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";

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
const status = (note: string, spoken: string, lang: "en" | "es" = "en") =>
  (
    buildProposal(raw({ spokenLocation: spoken }), note, today, lang)
      .location as { status: string }
  ).status;

test("'can't be because of / from / due to' my knee does not pin the knee", () => {
  for (const note of [
    "It can't be because of my left knee",
    "It can't be from my left knee",
    "It can't be due to my left knee",
    "That can't be because of the left knee",
  ])
    assert.equal(status(note, "left knee"), "unmapped", note);
  for (const note of [
    "I can't be at work because of my left knee",
    "I can't be walking because of my left knee",
    "I can't be on my feet because of my left knee",
  ])
    assert.equal(status(note, "left knee"), "mapped", note);
  for (const note of [
    "No puede ser por la rodilla izquierda",
    "No puede ser debido a la rodilla izquierda",
    "No puede ser a causa de la rodilla izquierda",
  ])
    assert.equal(status(note, "rodilla izquierda", "es"), "unmapped", note);
  assert.equal(
    status(
      "No puedo estar de pie por la rodilla izquierda",
      "rodilla izquierda",
      "es",
    ),
    "mapped",
  );
});

test("Spanish ability verbs in every person keep the part", () => {
  for (const verb of [
    "No pueden",
    "No podría",
    "No podrían",
    "No podías",
    "No podrías",
    "No pudieron",
    "No pudiste",
  ]) {
    assert.equal(
      status(`${verb} doblar la rodilla izquierda`, "rodilla izquierda", "es"),
      "mapped",
      verb,
    );
    assert.equal(
      status(
        `${verb} estar de pie por la rodilla izquierda`,
        "rodilla izquierda",
        "es",
      ),
      "mapped",
      verb,
    );
  }
});

test("'not very strong' agrees between the proposal and the quick draft", () => {
  for (const note of [
    "Me duele la rodilla izquierda y no es un dolor muy fuerte",
    "Me duele la rodilla izquierda y no era un dolor fuerte",
    "Me duele la rodilla izquierda y no es una molestia intensa",
    "Me duele la rodilla izquierda y no era una molestia seria",
    "Me duele la rodilla izquierda y no fue un dolor muy intenso",
  ]) {
    assert.equal(status(note, "rodilla izquierda", "es"), "mapped", note);
    assert.deepEqual(suggestVoiceDraft(note).locations, ["left_knee"], note);
  }
  assert.equal(
    status(
      "Me duele la rodilla izquierda pero no me duele",
      "rodilla izquierda",
      "es",
    ),
    "mapped",
  );
});

test("month-name dates are dates, not ratings", () => {
  for (const text of [
    "7 or 8 May",
    "May 7 or 8",
    "May 7 or 8 out of 10",
    "7 or 8 de mayo",
  ]) {
    assert.equal(parseIntensityAnswer(text), null, text);
    assert.equal(ratedIn(text, 7), false, text);
    assert.equal(ratedIn(text, 8), false, text);
  }
  assert.equal(parseIntensityAnswer("7 may be"), 7);
  assert.equal(parseIntensityAnswer("May 7 out of 10"), 7);
});

test("a frequency or span after the scale is not a fallback rating", () => {
  for (const text of [
    "Me duele la rodilla izquierda siete de diez veces",
    "Me duele la rodilla izquierda 7 de 10 días",
    "My left knee hurts 7 out of 10 times",
    "My left knee hurts 7/10 days",
  ])
    assert.equal(suggestVoiceDraft(text).fields.intensity, undefined, text);
  assert.equal(
    suggestVoiceDraft("Me duele la rodilla izquierda siete de diez").fields
      .intensity,
    7,
  );
  assert.equal(
    suggestVoiceDraft("My left knee hurts 7 out of 10 today").fields.intensity,
    7,
  );
});
