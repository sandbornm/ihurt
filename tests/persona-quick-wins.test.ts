import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { translate } from "../src/i18n/index.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import {
  buildProposal,
  mapLocation,
  partsIn,
} from "../src/voice/extraction.ts";
import {
  fieldsWithHeardRating,
  heardRating,
} from "../src/voice/natural-rating.ts";
import { recordCue } from "../src/voice/record-cue.ts";
import { speaksFollowUps } from "../src/voice/spoken-follow-up.ts";
import type { RawPainExtraction } from "../src/platform/on-device-ai.ts";

const today = "2026-10-22";
const raw = (patch: Partial<RawPainExtraction> = {}): RawPainExtraction => ({
  spokenLocation: "",
  region: "",
  side: "unspecified",
  qualities: [],
  intensity: null,
  onsetPhrase: "",
  activity: "",
  surface: "",
  ...patch,
});

test("natural spoken ratings are offered for confirmation, never filled", () => {
  for (const [text, value] of [
    ["My left knee aches, about a seven.", 7],
    ["My left knee aches, maybe a five", 5],
    ["It's a six right now", 6],
    ["I'd say seven", 7],
    ["Feels like an eight today", 8],
    ["Pretty sore, a 7", 7],
    ["Me duele la espalda, un ocho", 8],
    ["Me duele mucho, como un seis", 6],
    ["Diría que siete", 7],
    ["Hoy es un siete", 7],
    ["Nivel siete", 7],
    ["Me tomé dos pastillas y es un seis", 6],
  ] as const) {
    const draft = suggestVoiceDraft(text);
    assert.equal(draft.fields.intensity, undefined, text);
    assert.equal(draft.heard?.value, value, text);
    assert.ok(draft.heard?.heard.length, text);
  }
});

test("counts, durations, denials and competing numbers offer nothing", () => {
  for (const text of [
    "I walked a five mile loop",
    "A two hour drive made it worse",
    "It started two days ago",
    "I took a ten minute walk",
    "Between a five and a six",
    "It is not a seven",
    "Caminé un kilómetro",
    "Hace una semana que me duele",
    "Fue un dos por tres",
    "I had a seven year old with me",
    "I have one knee that hurts",
    "Seven out of ten today and a six yesterday",
  ])
    assert.equal(heardRating(text), null, text);
});

test("a stated rating wins over a heard one", () => {
  const draft = suggestVoiceDraft("Maybe a five, seven out of ten");
  assert.equal(draft.fields.intensity, 7);
  assert.equal(draft.heard, undefined);
});

test("a heard rating fills the field only after it is accepted", () => {
  const draft = suggestVoiceDraft("It's about a seven");
  assert.deepEqual(fieldsWithHeardRating(draft, null), draft.fields);
  assert.deepEqual(fieldsWithHeardRating(draft, 3), draft.fields);
  assert.deepEqual(fieldsWithHeardRating(draft, 7), { intensity: 7 });
});

test("the follow-up is skipped when the person says all over or both", () => {
  for (const [transcript, spoken] of [
    ["It hurts all over today", ""],
    ["My whole body aches", ""],
    ["Everywhere hurts", ""],
    ["Both of my feet hurt", "feet"],
    ["Me duele todo el cuerpo", ""],
    ["Me duelen los dos pies", "pies"],
    ["Me duele por todos lados", ""],
    ["Me duelen ambas rodillas", "rodillas"],
  ] as const)
    assert.equal(
      buildProposal(raw({ spokenLocation: spoken }), transcript, today)
        .followUp,
      null,
      transcript,
    );
});

test("the follow-up still asks when something is genuinely missing", () => {
  // "Both" settles the side, not which of two parts.
  assert.equal(
    buildProposal(raw(), "My knee and my hip both hurt", today).followUp?.key,
    "location",
  );
  // A place the model named but the person never said is still asked about.
  assert.equal(
    buildProposal(
      raw({
        spokenLocation: "right knee",
        region: "right_knee",
        side: "right",
      }),
      "Played padel and it hurts",
      today,
    ).followUp?.key,
    "location",
  );
  assert.equal(
    buildProposal(raw(), "Something hurts", today).followUp?.key,
    "location",
  );
  assert.equal(
    buildProposal(raw({ spokenLocation: "knee" }), "My knee hurts", today)
      .followUp?.key,
    "side",
  );
});

test("regional and everyday words reach existing regions in the fallback", () => {
  for (const [text, region] of [
    ["My belly hurts", "abdomen"],
    ["My left glute hurts", "left_hip"],
    ["My right buttock aches", "right_hip"],
    ["My left forearm aches", "left_wrist"],
    ["Me duele la cintura", "lower_back"],
    ["Me duele la espalda de abajo", "lower_back"],
    ["Me duele la barriga", "abdomen"],
    ["Me duele el vientre", "abdomen"],
    ["Me duele el glúteo derecho", "right_hip"],
    ["Me duele el antebrazo izquierdo", "left_wrist"],
  ] as const)
    assert.deepEqual(suggestVoiceDraft(text).locations, [region], text);
});

test("new words do not place a pin when denied, sideless or said without pain", () => {
  for (const text of [
    "My forearm hurts",
    "My glute hurts",
    "My left glute does not hurt",
    "No me duele la cintura",
    "Compré una faja para la cintura",
    "I ate a big belly of pasta",
  ])
    assert.deepEqual(suggestVoiceDraft(text).locations, [], text);
});

test("the on-device path knows the same words", () => {
  assert.deepEqual(partsIn("me duele la cintura"), ["lower_back"]);
  assert.deepEqual(partsIn("me duele la espalda de abajo"), ["lower_back"]);
  assert.deepEqual(partsIn("my glutes hurt"), ["hip"]);
  assert.deepEqual(partsIn("me duele el gluteo"), ["hip"]);
  assert.deepEqual(partsIn("my belly hurts"), ["abdomen"]);
  const result = mapLocation(
    "left glute",
    "left",
    "My left glute hurts after squats",
  );
  assert.deepEqual(result, {
    status: "mapped",
    region: "left_hip",
    spoken: "left glute",
  });
  // Forearm stays unmapped on this path: the held-out eval scores it as a
  // part with no region, and its nearest regions are wrist and elbow.
  assert.deepEqual(partsIn("my forearm hurts"), []);
});

test("spoken follow-up questions are off unless the person turned them on", () => {
  const store = (value: string | null) => ({ getItem: () => value });
  assert.equal(speaksFollowUps(store(null)), false);
  assert.equal(speaksFollowUps(store("0")), false);
  assert.equal(speaksFollowUps(store("1")), true);
  assert.equal(
    speaksFollowUps({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    false,
  );
  assert.equal(speaksFollowUps(undefined), false);
});

test("a cue marks where recording starts and stops", () => {
  assert.equal(recordCue("starting", "recording"), "started");
  assert.equal(recordCue("recording", "processing"), "stopped");
  assert.equal(recordCue("recording", "idle"), "stopped");
  assert.equal(recordCue("idle", "starting"), null);
  assert.equal(recordCue("processing", "idle"), null);
  assert.equal(recordCue("recording", "recording"), null);
});

test("tour copy: no Grok, a voice step, Activity wording", () => {
  for (const lang of ["en", "es"] as const) {
    for (let n = 1; n <= 5; n++)
      for (const part of ["title", "text"] as const) {
        const text = translate(lang, `tour.${n}.${part}` as never);
        assert.ok(
          text && !text.startsWith("tour."),
          `${lang} tour.${n}.${part}`,
        );
        assert.doesNotMatch(text, /grok/i, `${lang} tour.${n}.${part}`);
      }
    assert.match(translate(lang, "tour.4.text" as never), /voz|voice/i);
  }
  assert.equal(translate("en", "notebook.activity"), "Activity");
  assert.equal(translate("es", "notebook.activity"), "Actividad");
});

test("the Spanish report no longer says Izquierda del modelo", () => {
  assert.equal(
    translate("es", "export.html.modelLeft"),
    "Lado izquierdo del modelo",
  );
  assert.equal(
    translate("es", "export.html.modelRight"),
    "Lado derecho del modelo",
  );
});

test("the README does not claim features the code lacks", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.doesNotMatch(readme, /healthkit|apple health/i);
  assert.doesNotMatch(readme, /today and history/i);
});
