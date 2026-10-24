import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFollowUp,
  buildProposal,
  confirmProposal,
  describeLocation,
  mapLocation,
  parseIntensityAnswer,
  proposedPinStep,
  ratedIn,
  resolveOnset,
  spanIn,
} from "../src/voice/extraction.ts";
import {
  createAppleIntelligence,
  type RawPainExtraction,
} from "../src/platform/on-device-ai.ts";
import { setLanguagePreference } from "../src/i18n/index.ts";

const today = "2026-10-22"; // jueves
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

const padel =
  "ardor en la articulación del dedo gordo del pie izquierdo después de jugar pádel ayer";

test("the Spanish padel sentence proposes a left foot pin, never places one", () => {
  const proposal = buildProposal(
    raw({
      spokenLocation: "articulación del dedo gordo del pie izquierdo",
      region: "left_foot",
      side: "left",
      qualities: ["ardor"],
      onsetPhrase: "ayer",
      activity: "pádel",
    }),
    padel,
    today,
    "es",
  );
  assert.deepEqual(proposal.location, {
    status: "mapped",
    region: "left_foot",
    spoken: "articulación del dedo gordo del pie izquierdo",
  });
  assert.equal(proposal.fields.quality, "ardor");
  assert.equal(proposal.fields.activity, "pádel");
  assert.deepEqual(proposal.onset, { phrase: "ayer", date: "2026-10-21" });
  assert.equal(proposal.fields.duration, "Desde ayer (2026-10-21)");
  // No rating was said, so it asks in Spanish instead of guessing.
  assert.equal(proposal.followUp?.key, "intensity");
  assert.match(proposal.followUp?.question ?? "", /[¿?]/);
  assert.match(describeLocation(proposal.location, "es"), /Pie izquierdo/);
  // Nothing is saved or pinned until the person confirms.
  assert.throws(() =>
    confirmProposal(proposal, { confirmed: false, fields: {}, pin: true }),
  );
  assert.deepEqual(
    proposedPinStep(null, { type: "propose", region: "left_foot" }),
    {
      state: "left_foot",
      command: null,
    },
  );
  const saved = confirmProposal(proposal, {
    confirmed: true,
    fields: { quality: true },
    pin: false,
  });
  assert.equal(saved.region, "left_foot");
  assert.equal(saved.proposePin, false);
});

test("a translated or stitched location is rejected", () => {
  // The model translated instead of copying.
  assert.equal(
    mapLocation("left big toe joint", "left", padel).status,
    "unmapped",
  );
  // Words said, but not next to each other.
  assert.equal(spanIn("pie gordo", padel), false);
  assert.equal(
    mapLocation("pie gordo izquierdo", "left", padel).status,
    "unmapped",
  );
  // Invented qualities and activities are dropped.
  const proposal = buildProposal(
    raw({
      spokenLocation: "pie izquierdo",
      qualities: ["punzante", "burning"],
      activity: "tenis",
      onsetPhrase: "hace 3 días",
    }),
    padel,
    today,
    "es",
  );
  assert.equal(proposal.fields.quality, undefined);
  assert.equal(proposal.fields.activity, undefined);
  assert.equal(proposal.fields.duration, undefined);
  assert.equal(proposal.location.status, "mapped");
});

test("the model's own region guess never sets the pin", () => {
  const proposal = buildProposal(
    raw({ spokenLocation: "", region: "left_foot", side: "left" }),
    "me duele mucho después de jugar pádel",
    today,
    "es",
  );
  assert.equal(proposal.location.status, "missing");
  assert.equal(proposal.followUp?.key, "location");
});

test("Spanish sides, accents and the follow-up answer", () => {
  const note = "tengo un dolor sordo en la rodilla";
  const proposal = buildProposal(
    raw({ spokenLocation: "rodilla", qualities: ["sordo"] }),
    note,
    today,
    "es",
  );
  assert.equal(proposal.location.status, "need-side");
  assert.match(proposal.followUp?.question ?? "", /rodilla/);
  const answered = answerFollowUp(proposal, "la derecha");
  assert.deepEqual(answered.location, {
    status: "mapped",
    region: "right_knee",
    spoken: "rodilla derecha",
  });
  assert.equal(answered.asked, true);
  assert.equal(
    mapLocation(
      "Tobillo Izquierdo",
      "unspecified",
      "me torcí el tobillo izquierdo",
    ).status,
    "mapped",
  );
  assert.equal(
    mapLocation("hombros", "both", "me duelen ambos hombros").status,
    "need-side",
  );
  assert.equal(
    mapLocation("muñeca derecha", "right", "hormigueo en la muneca derecha")
      .status,
    "mapped",
  );
  assert.equal(
    mapLocation("espalda", "unspecified", "me duele la espalda").status,
    "unmapped",
  );
  assert.deepEqual(
    mapLocation(
      "parte baja de la espalda",
      "unspecified",
      "dolor en la parte baja de la espalda",
    ),
    {
      status: "mapped",
      region: "lower_back",
      spoken: "parte baja de la espalda",
    },
  );
  // "de pie" means standing, not a foot.
  assert.equal(
    mapLocation("de pie", "unspecified", "me duele estar de pie").status,
    "unmapped",
  );
});

test("Spanish ratings and onset words", () => {
  assert.equal(parseIntensityAnswer("un siete"), 7);
  assert.equal(parseIntensityAnswer("7 de 10"), 7);
  assert.equal(parseIntensityAnswer("seis sobre diez"), 6);
  assert.equal(parseIntensityAnswer("no sé"), null);
  assert.equal(resolveOnset("anteayer", today).date, "2026-10-20");
  assert.equal(resolveOnset("anoche", today).date, "2026-10-21");
  assert.equal(resolveOnset("esta mañana", today).date, today);
  assert.equal(resolveOnset("hace dos días", today).date, "2026-10-20");
  assert.equal(resolveOnset("hace una semana", today).date, "2026-10-15");
  assert.equal(resolveOnset("el lunes", today).date, "2026-10-19");
  assert.equal(resolveOnset("el miércoles", today).date, "2026-10-21");
  assert.equal(resolveOnset("hace tiempo", today).date, undefined);
});

test("an unsupported Spanish locale reports an en or es message and falls back to dictation", async () => {
  const bridge = {
    isAvailable: async () => ({
      available: false,
      code: "ai-locale-unsupported",
      reason: "native English text",
    }),
    extractPainEntry: async () => ({}),
    cancelExtraction: async () => {},
    speak: async () => {},
    stopSpeaking: async () => {},
  };
  const ai = createAppleIntelligence(bridge);
  setLanguagePreference("es");
  const es = await ai.isAvailable("es");
  assert.equal(es.available, false);
  assert.equal(es.code, "ai-locale-unsupported");
  assert.match(es.reason ?? "", /Apple Intelligence todavía no admite español/);
  setLanguagePreference("en");
  const en = await ai.isAvailable("en");
  assert.match(en.reason ?? "", /does not support English/);
  setLanguagePreference("auto");
});

test("negated clauses are rejected in Spanish and English", () => {
  const note =
    "no es ardor, es punzante. No me duele la rodilla, sino el tobillo izquierdo";
  const proposal = buildProposal(
    raw({
      spokenLocation: "rodilla",
      qualities: ["ardor", "punzante"],
    }),
    note,
    today,
    "es",
  );
  assert.equal(proposal.fields.quality, "punzante");
  assert.equal(proposal.location.status, "unmapped");
  assert.equal(mapLocation("tobillo izquierdo", "left", note).status, "mapped");
  const sin = buildProposal(
    raw({ spokenLocation: "codo derecho", qualities: ["hormigueo"] }),
    "sin hormigueo en el codo derecho",
    today,
    "es",
  );
  assert.equal(sin.fields.quality, undefined);
  assert.equal(sin.location.status, "unmapped");
  const nunca = buildProposal(
    raw({ spokenLocation: "pie", activity: "correr", onsetPhrase: "ayer" }),
    "nunca me duele el pie al correr ayer tampoco",
    today,
    "es",
  );
  assert.equal(nunca.fields.activity, undefined);
  assert.equal(nunca.fields.duration, undefined);
  const english = buildProposal(
    raw({ spokenLocation: "knee", qualities: ["burning", "sharp"] }),
    "It's not burning, it's sharp. It is not my knee",
    today,
  );
  assert.equal(english.fields.quality, "sharp");
  assert.equal(english.location.status, "unmapped");
  // A denial covers what follows it, so the knee said before it still counts.
  const mixed = buildProposal(
    raw({
      spokenLocation: "rodilla izquierda",
      side: "left",
      qualities: ["ardor", "punzante"],
    }),
    "mi rodilla izquierda no tiene ardor, es punzante",
    today,
    "es",
  );
  assert.equal(mixed.location.status, "mapped");
  assert.equal(mixed.fields.quality, "punzante");
  // The denial stops at "y" and "pero".
  const after = buildProposal(
    raw({
      spokenLocation: "rodilla izquierda",
      side: "left",
      qualities: ["ardor"],
    }),
    "no es ardor pero me duele la rodilla izquierda",
    today,
    "es",
  );
  assert.equal(after.location.status, "mapped");
  assert.equal(after.fields.quality, undefined);
});

test("a Spanish side and part from different phrases do not map", () => {
  const said = "me duele la rodilla izquierda y el pie derecho";
  assert.equal(mapLocation("pie izquierdo", "left", said).status, "unmapped");
  assert.equal(
    mapLocation("rodilla derecha", "right", said).status,
    "unmapped",
  );
  assert.equal(mapLocation("rodilla izquierda", "left", said).status, "mapped");
  assert.equal(mapLocation("pie derecho", "right", said).status, "mapped");
});

test("Spanish intensity ignores times of day", () => {
  assert.equal(ratedIn("me despertó a las 7 de la mañana", 7), false);
  assert.equal(ratedIn("I rated it 7", 7), true);
  assert.equal(ratedIn("it woke me at 7 am", 7), false);
});

test("intensity needs rating context in Spanish and English", () => {
  assert.equal(ratedIn("dolor de 7 sobre 10", 7), true);
  assert.equal(ratedIn("le doy un siete", 7), true);
  assert.equal(ratedIn("la intensidad es 5", 5), true);
  assert.equal(ratedIn("diría que 4/10", 4), true);
  assert.equal(ratedIn("hace 3 días que me duele", 3), false);
  assert.equal(ratedIn("jugué 2 partidos de pádel", 2), false);
  assert.equal(ratedIn("no es un 8", 8), false);
  assert.equal(ratedIn("about a six", 6), true);
  assert.equal(ratedIn("7 out of 10", 7), true);
  assert.equal(ratedIn("started 3 days ago", 3), false);
  const proposal = buildProposal(
    raw({ spokenLocation: "pie izquierdo", intensity: 3 }),
    "me duele el pie izquierdo desde hace 3 días",
    today,
    "es",
  );
  assert.equal(proposal.fields.intensity, undefined);
  assert.equal(proposal.followUp?.key, "intensity");
});

test("only same-day phrases resolve to today", () => {
  assert.equal(resolveOnset("earlier", today).date, today);
  assert.equal(resolveOnset("earlier this week", today).date, undefined);
  assert.equal(resolveOnset("earlier today", today).date, today);
  assert.equal(resolveOnset("más temprano", today).date, today);
  assert.equal(resolveOnset("más temprano este año", today).date, undefined);
  assert.equal(resolveOnset("más temprano hoy", today).date, today);
  assert.equal(resolveOnset("hace un rato", today).date, today);
  assert.equal(resolveOnset("esta tarde", today).date, today);
});
