import assert from "node:assert/strict";
import test from "node:test";
import { mapLocation, ratedIn, resolveOnset } from "../src/voice/extraction.ts";
import { suggestVoiceDraft } from "../src/voice/draft.ts";
import { activityMatch } from "../src/activities.ts";
import { exportNotebook, parseNotebook } from "../src/notebook-data.ts";
import { exampleEntry } from "../src/example.ts";
import { setLanguagePreference } from "../src/i18n/index.ts";

const today = "2026-10-22"; // jueves

test("a side said about another part does not pick the side", () => {
  assert.equal(
    mapLocation(
      "rodilla",
      "left",
      "me duele la rodilla. La mano izquierda está bien",
    ).status,
    "need-side",
  );
  assert.equal(
    mapLocation("knee", "right", "my knee and my right hand hurt").status,
    "need-side",
  );
  assert.equal(
    mapLocation("rodilla", "left", "me duele la rodilla, la izquierda").status,
    "mapped",
  );
});

test("counts and ages are not ratings", () => {
  assert.equal(ratedIn("me duele en 3 sitios", 3), false);
  assert.equal(ratedIn("hinchazón en 2 dedos", 2), false);
  assert.equal(ratedIn("my son is 7", 7), false);
  assert.equal(ratedIn("tengo 3 años con esto", 3), false);
  assert.equal(ratedIn("dolor de 6", 6), true);
  assert.equal(ratedIn("la intensidad es 5", 5), true);
  assert.equal(ratedIn("the pain is 7", 7), true);
});

test("nada más, no más and sin duda keep a stated location", () => {
  for (const said of [
    "me duele nada más la rodilla izquierda",
    "me duele no más la rodilla izquierda",
    "Sin duda me duele la rodilla izquierda",
  ])
    assert.equal(
      mapLocation("rodilla izquierda", "left", said).status,
      "mapped",
      said,
    );
  assert.notEqual(
    mapLocation(
      "rodilla izquierda",
      "left",
      "ya no más me duele la rodilla izquierda",
    ).status,
    "mapped",
  );
  assert.notEqual(
    mapLocation("rodilla izquierda", "left", "la rodilla izquierda no me duele")
      .status,
    "mapped",
  );
  assert.equal(
    mapLocation(
      "rodilla izquierda",
      "left",
      "no puedo doblar la rodilla izquierda",
    ).status,
    "mapped",
  );
});

test("the dictation fallback keeps a location next to a denial", () => {
  assert.deepEqual(
    suggestVoiceDraft("Me duele el pie izquierdo, no mucho.").locations,
    ["left_foot"],
  );
  assert.deepEqual(
    suggestVoiceDraft("Sin duda me duele el tobillo izquierdo.").locations,
    ["left_ankle"],
  );
  assert.deepEqual(
    suggestVoiceDraft("Me duele nada más el tobillo izquierdo.").locations,
    ["left_ankle"],
  );
  assert.deepEqual(
    suggestVoiceDraft("No me duele la rodilla izquierda.").locations,
    [],
  );
});

test("dedo gordo de la mano is the thumb", () => {
  assert.deepEqual(
    mapLocation(
      "dedo gordo de la mano derecha",
      "right",
      "me duele el dedo gordo de la mano derecha",
    ),
    {
      status: "mapped",
      region: "right_wrist",
      spoken: "dedo gordo de la mano derecha",
    },
  );
  assert.equal(
    mapLocation(
      "dedo gordo del pie izquierdo",
      "left",
      "me duele el dedo gordo del pie izquierdo",
    ).status,
    "mapped",
  );
});

test("activity names match whole words, longest first", () => {
  assert.equal(activityMatch("Saqué a pasear al perro"), undefined);
  assert.equal(activityMatch("jugué tenis de mesa")?.name, "Table tennis");
  assert.equal(
    activityMatch("hice ciclismo de montaña")?.name,
    "Mountain biking",
  );
  assert.equal(activityMatch("hice windsurf")?.name, "Windsurfing");
  assert.equal(activityMatch("jugué tenis")?.name, "Tennis");
  assert.equal(activityMatch("Tenis")?.name, "Tennis");
});

test("a coming weekday is not a past onset", () => {
  for (const phrase of [
    "el próximo lunes",
    "el lunes que viene",
    "next monday",
  ])
    assert.equal(resolveOnset(phrase, today).date, undefined, phrase);
  assert.equal(resolveOnset("el lunes pasado", today).date, "2026-10-19");
});

test("the JSON export and import messages follow the language", () => {
  setLanguagePreference("es");
  const exported = exportNotebook([exampleEntry()]);
  assert.match(exported.notice, /No es consejo médico/);
  assert.match(exported.reading_guide.observations, /Son datos/);
  assert.throws(
    () =>
      parseNotebook(
        JSON.stringify({
          ...exported,
          entries: [{ ...exported.entries[0], note: 5 }],
        }),
      ),
    /Falta un campo de texto/,
  );
  setLanguagePreference("en");
  assert.match(exportNotebook([]).notice, /Not medical advice/);
  setLanguagePreference("auto");
});
