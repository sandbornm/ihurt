import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFollowUp,
  buildProposal,
  parseIntensityAnswer,
  ratedIn,
  resolveOnset,
} from "../src/voice/extraction.ts";
import { createAvailabilityGate } from "../src/voice/ai-gate.ts";

const today = "2026-10-22"; // jueves
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
const reply = (said: string, lang: "en" | "es" = "es") => {
  const location = answerFollowUp(
    buildProposal(
      raw(lang === "en" ? { spokenLocation: "ankle" } : {}),
      lang === "en" ? "My ankle hurts" : "Me duele el tobillo",
      today,
      lang,
    ),
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

test("Spanish side answers keep the side and honor the denial", () => {
  for (const [said, expected] of [
    ["no es la izquierda", "need-side"],
    ["la izquierda no", "need-side"],
    ["sin duda, la derecha", "right_ankle"],
    ["sin duda la izquierda", "left_ankle"],
    ["no más la izquierda", "left_ankle"],
    ["no mas la derecha", "right_ankle"],
    ["no es la izquierda, es la derecha", "right_ankle"],
    ["no, la derecha", "right_ankle"],
    ["la izquierda, no la derecha", "left_ankle"],
    ["ni la izquierda ni la derecha", "need-side"],
    ["izquierda y derecha", "need-side"],
    ["voy derecho", "need-side"],
    ["camino derecho", "need-side"],
    ["la izquierda, no, la derecha", "need-side"],
    ["derecha no, izquierda", "need-side"],
    ["me fui a la izquierda", "need-side"],
    ["doblé a la derecha", "need-side"],
    ["por supuesto la izquierda", "left_ankle"],
    ["el de la izquierda", "left_ankle"],
    ["a la derecha", "right_ankle"],
  ] as const)
    assert.equal(reply(said), expected, said);
});

test("a negated or impossible part is not logged, in both languages", () => {
  for (const said of [
    "It's not that my left knee hurts",
    "It's not that the left knee hurts, it's the ankle",
    "It can't be my left knee",
    "It couldn't be the left knee",
  ])
    assert.notEqual(status(said, "left knee", "left", "en"), "mapped", said);
  for (const said of [
    "No puede ser la rodilla izquierda",
    "No podría ser la rodilla izquierda",
    "No es que me duela la rodilla izquierda",
  ])
    assert.notEqual(
      status(said, "rodilla izquierda", "left", "es"),
      "mapped",
      said,
    );
  assert.equal(
    status("I can't bend my left knee", "left knee", "left", "en"),
    "mapped",
  );
  assert.equal(
    status(
      "No puedo doblar la rodilla izquierda",
      "rodilla izquierda",
      "left",
      "es",
    ),
    "mapped",
  );
});

test("a Spanish correction clears a finished pain and keeps an ongoing one", () => {
  const base = "La rodilla izquierda no me duele, ";
  for (const tail of [
    "es que ya pasó",
    "es que ya terminó",
    "es que ya se me quitó",
    "es que ya no",
    "es que está mejor",
  ])
    assert.notEqual(
      status(base + tail, "rodilla izquierda", "left", "es"),
      "mapped",
      tail,
    );
  for (const tail of [
    "es que no se ha ido",
    "es que todavía sigue",
    "es que aún sigue",
    "es que no está mejor",
    "es que está mejor que ayer",
  ])
    assert.equal(
      status(base + tail, "rodilla izquierda", "left", "es"),
      "mapped",
      tail,
    );
});

test("Spanish months, clock times and ages are not ratings", () => {
  for (const said of [
    "el 7 de octubre",
    "desde el 7 de octubre",
    "tengo 7",
    "tengo 7 años",
    "a las 7",
    "son las 7",
    "desde el 7/10",
    "7 de 10 días",
  ])
    assert.equal(parseIntensityAnswer(said), null, said);
  for (const said of [
    "es el 7 de 10",
    "le doy el 7/10",
    "un 7",
    "siete de diez",
  ])
    assert.equal(parseIntensityAnswer(said), 7, said);
  assert.equal(ratedIn("Me duele el tobillo, le doy el 7/10", 7), true);
  assert.equal(ratedIn("Me duele el tobillo, es el 7 de 10", 7), true);
  for (const said of [
    "El 7 de octubre me empezó a doler el tobillo",
    "Me duele el tobillo desde el 7/10",
    "Me duele el tobillo, tengo 7",
    "Me duele el tobillo a las 7",
    "Me duele el tobillo, 7 de 10 días",
  ])
    assert.equal(ratedIn(said, 7), false, said);
});

test("Spanish day counts combine with ayer and with extra parts", () => {
  assert.equal(resolveOnset("hace una semana ayer", today).date, "2026-10-14");
  assert.equal(resolveOnset("ayer hizo una semana", today).date, "2026-10-14");
  assert.equal(resolveOnset("hace una semana", today).date, "2026-10-15");
  assert.equal(
    resolveOnset("hace una semana y dos días", today).date,
    undefined,
  );
  assert.equal(resolveOnset("a week and two days ago", today).date, undefined);
});

test("overlapping availability checks: only the newest one decides", () => {
  const gate = createAvailabilityGate();
  const first = gate.begin();
  assert.equal(gate.request("note"), undefined);
  const second = gate.begin();
  // The older, slower check says no after a newer one began: ignored.
  assert.equal(gate.recheck(false, first), undefined);
  assert.equal(gate.state, "checking");
  assert.equal(gate.recheck(true, second), "note");
  assert.equal(gate.state, "ready");
  // A stale answer cannot turn a good state off.
  const third = gate.begin();
  const fourth = gate.begin();
  assert.equal(gate.recheck(true, fourth), undefined);
  assert.equal(gate.recheck(false, third), undefined);
  assert.equal(gate.state, "ready");
});
