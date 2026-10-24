import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProposal,
  parseIntensityAnswer,
} from "../src/voice/extraction.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import { activityLabel } from "../src/activities.ts";
import { setDeviceLanguages, speechLocale } from "../src/i18n/index.ts";

const today = "2026-10-22";
const raw = (over: object = {}) => ({
  spokenLocation: "left knee",
  region: "",
  side: "unspecified",
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
    propose(note, { spokenLocation: spoken, side: "left" }, lang).location as {
      status: string;
    }
  ).status;

test("speech locale uses the tag's own base language", () => {
  setDeviceLanguages(["fr-FR"]);
  assert.equal(speechLocale("en"), "en-US");
  assert.equal(speechLocale("es"), "es-MX");
  setDeviceLanguages(["fr-FR", "es-ES", "en-GB"]);
  assert.equal(speechLocale("es"), "es-ES");
  assert.equal(speechLocale("en"), "en-GB");
  setDeviceLanguages([]);
});

test("a slash rating in the voice fallback is read once", () => {
  assert.equal(suggestVoiceDraft("pain 7/10").fields.intensity, 7);
  assert.equal(suggestVoiceDraft("dolor 7/10").fields.intensity, 7);
  assert.equal(
    suggestVoiceDraft("pain 7/10 and 4/10").fields.intensity,
    undefined,
  );
});

test("'mano' finds the wrist-and-hand region in the voice fallback", () => {
  assert.deepEqual(suggestVoiceDraft("Me duele la mano izquierda").locations, [
    "left_wrist",
  ]);
  assert.deepEqual(suggestVoiceDraft("Me duele la mano derecha").locations, [
    "right_wrist",
  ]);
  assert.deepEqual(
    suggestVoiceDraft("Me duele la muñeca izquierda").locations,
    ["left_wrist"],
  );
});

test("'right at my knee' is not a side", () => {
  assert.equal(
    status("It hurts right at my knee", "right at my knee"),
    "need-side",
  );
  assert.equal(status("It hurts in my right knee", "right knee"), "mapped");
});

test("a rating needs rating context, not a time or a count", () => {
  for (const [note, said] of [
    [
      "My left knee hurts around seven in the morning",
      "around seven in the morning",
    ],
    ["My left knee hurts. I walked about seven blocks.", "about seven blocks"],
    ["My left knee hurts. I took about 7 pills.", "about 7 pills"],
  ])
    assert.equal(
      propose(note, { intensity: 7 }).fields.intensity,
      undefined,
      said,
    );
  for (const note of [
    "My left knee hurts about a 7",
    "My left knee hurts about seven",
    "My left knee hurts around 7 or so",
    "My left knee hurts, 7 out of 10",
  ])
    assert.equal(propose(note, { intensity: 7 }).fields.intensity, 7, note);
});

test("a slash count or distance is not a rating", () => {
  for (const note of ["My left knee hurt 7/10 times", "I walked 7/10 miles"])
    assert.equal(
      propose(note, { intensity: 7 }).fields.intensity,
      undefined,
      note,
    );
});

test("a Spanish pain-free clause does not map a pin", () => {
  for (const note of [
    "La rodilla izquierda no tiene dolor",
    "La rodilla izquierda está sin dolor",
    "La rodilla izquierda no tiene molestia",
  ])
    assert.notEqual(status(note, "rodilla izquierda", "es"), "mapped", note);
  for (const note of [
    "La rodilla izquierda no tiene mucho dolor",
    "Tengo dolor en la rodilla izquierda",
  ])
    assert.equal(status(note, "rodilla izquierda", "es"), "mapped", note);
});

test("'can't be in/on my left knee' and 'no puede estar en' are denials", () => {
  for (const [note, lang] of [
    ["It can't be in my left knee", "en"],
    ["It can't be on my left knee", "en"],
    ["can't be on my left knee", "en"],
    ["No puede estar en la rodilla izquierda", "es"],
  ] as const)
    assert.notEqual(
      status(note, lang === "es" ? "rodilla izquierda" : "left knee", lang),
      "mapped",
      note,
    );
});

test("dates with May or a month before the number are not ratings", () => {
  for (const said of [
    "7 of May",
    "October 7",
    "May 7",
    "mayo 7",
    "7 de mayo",
    "7 May 2026",
    "7 octubre",
    "7 of October",
  ])
    assert.equal(parseIntensityAnswer(said), null, said);
  assert.equal(parseIntensityAnswer("7"), 7);
  assert.equal(parseIntensityAnswer("it may be a 7"), 7);
});

test("activity names print in the current language, typed text is kept", () => {
  assert.equal(activityLabel("Trail running", "es"), "Carrera de montaña");
  assert.equal(activityLabel("Skiing", "es"), "Esquí");
  assert.equal(activityLabel("esquí", "en"), "Skiing");
  assert.equal(
    activityLabel("long walk with the dog", "es"),
    "long walk with the dog",
  );
});

test("the Spanish print report says 'N de 10' and translates the activity", async () => {
  const { renderPrintHtml } = await import("../src/export.ts");
  const { finishEntry } = await import("../src/notebook-data.ts");
  const { exampleEntry } = await import("../src/example.ts");
  const { setLanguagePreference } = await import("../src/i18n/index.ts");
  const entry = finishEntry(exampleEntry());
  entry.map.activity = "Trail running";
  entry.map.intensity = 7;
  try {
    setLanguagePreference("es");
    const html = renderPrintHtml(entry);
    assert.ok(html.includes("7 de 10"), "N de 10");
    assert.ok(!html.includes("7 / 10"));
    assert.ok(html.includes("Carrera de montaña"));
    assert.ok(!html.includes("Trail running"));
    setLanguagePreference("en");
    const english = renderPrintHtml(entry);
    assert.ok(english.includes("7 / 10"));
    assert.ok(english.includes("Trail running"));
  } finally {
    setLanguagePreference("auto");
  }
});
