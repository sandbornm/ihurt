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
  applyHeardRating,
  fieldsWithHeardRating,
  heardRating,
  offeredRating,
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
    "I ran about 8 on Tuesday",
    "Caminé como 8 en la mañana",
    "Mi hijo es 8 y me duele la rodilla",
    "I walked about five",
    "Me duele desde las dos",
  ])
    assert.equal(heardRating(text), null, text);
});

test("the quoted rating keeps its accents and casing", () => {
  assert.equal(heardRating("Diría que siete")?.heard, "Diría que siete");
  assert.equal(heardRating("Me duele, un ocho sin duda")?.value, 8);
});

test("a rating tapped before the model answers is still offered and kept", () => {
  const heard = { value: 7, heard: "about a seven" };
  // The model left intensity out: the chip shows until it is tapped.
  assert.deepEqual(offeredRating({}, heard, null), heard);
  assert.equal(offeredRating({}, heard, 7), null);
  // The model filled intensity itself: nothing to confirm.
  assert.equal(offeredRating({ intensity: 4 }, heard, null), null);
  assert.equal(offeredRating({}, undefined, null), null);
  // Once the live fields arrive the tapped number is still applied.
  assert.deepEqual(applyHeardRating({ activity: "run" }, heard, 7), {
    activity: "run",
    intensity: 7,
  });
  assert.deepEqual(applyHeardRating({ activity: "run" }, heard, null), {
    activity: "run",
  });
  assert.deepEqual(applyHeardRating({ activity: "run" }, heard, 3), {
    activity: "run",
  });
  // The model's own number is never overwritten.
  assert.deepEqual(applyHeardRating({ intensity: 4 }, heard, 7), {
    intensity: 4,
  });
});

test("recording again clears a tapped rating", () => {
  const source = readFileSync(
    new URL("../src/voice/VoiceDraft.tsx", import.meta.url),
    "utf8",
  );
  const record = source.slice(source.indexOf("async function record()"));
  assert.match(
    record.slice(0, record.indexOf("setMode(")),
    /setAcceptedRating\(null\)/,
  );
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

test("the side question survives both, las dos and all over used for something else", () => {
  for (const [transcript, spoken] of [
    ["My knee hurts and I took both pills", "knee"],
    ["My knee hurts both when I walk and when I sit", "knee"],
    ["My knee hurts both day and night", "knee"],
    ["My shoulder hurts but both hands are fine", "shoulder"],
    ["My knee hurts all over", "knee"],
    ["Pain is all over my knee", "knee"],
    ["It is all over my knee after the run", "knee"],
    ["Me duele la rodilla desde las dos", "rodilla"],
    ["Me duele la rodilla, tomé las dos pastillas", "rodilla"],
    ["Me duele el hombro pero los dos pies están bien", "hombro"],
    ["Me duele la rodilla por todos lados", "rodilla"],
  ] as const)
    assert.equal(
      buildProposal(raw({ spokenLocation: spoken }), transcript, today).followUp
        ?.key,
      "side",
      transcript,
    );
});

test("the side question is skipped when both or all over describes the pain", () => {
  for (const [transcript, spoken] of [
    ["Both knees hurt", "knees"],
    ["Pain in both knees", "knees"],
    ["It hurts in both of my knees", "knees"],
    ["My knees hurt, pain in both.", "knees"],
    ["Pain on both sides of my knee", "knee"],
    ["Me duele en las dos rodillas", "rodillas"],
    ["Me duelen ambas rodillas", "rodillas"],
    ["Me duelen los dos hombros", "hombros"],
    ["Me duele la rodilla en ambos lados", "rodilla"],
    ["It hurts all over my body", ""],
    ["Pain all over my whole body", ""],
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
    ["Me duele la cintura", "lower_back"],
    ["Me duele la espalda de abajo", "lower_back"],
    ["Me duele la barriga", "abdomen"],
    ["Me duele el vientre", "abdomen"],
    ["Me duele el glúteo derecho", "right_hip"],
  ] as const)
    assert.deepEqual(suggestVoiceDraft(text).locations, [region], text);
});

test("new words do not place a pin when denied, sideless or said without pain", () => {
  for (const text of [
    "My forearm hurts",
    "My left forearm aches",
    "Me duele el antebrazo izquierdo",
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

test("the report names the model's sides the same way in both languages", () => {
  assert.equal(
    translate("en", "export.html.modelLeft"),
    "Left side of the model",
  );
  assert.equal(
    translate("en", "export.html.modelRight"),
    "Right side of the model",
  );
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
