import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFollowUp,
  buildProposal,
  confirmProposal,
  mapLocation,
  parseIntensityAnswer,
  proposedPinStep,
  resolveOnset,
} from "../src/voice/extraction.ts";
import {
  createAppleIntelligence,
  parseRawExtraction,
  type RawPainExtraction,
} from "../src/platform/on-device-ai.ts";

const today = "2026-10-22"; // Thursday
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
  "I played padel yesterday on turf and got burning in my left big toe joint";

test("maps the padel example to a proposed left foot pin", () => {
  const proposal = buildProposal(
    raw({
      spokenLocation: "left big toe joint",
      region: "left_foot",
      side: "left",
      qualities: ["burning"],
      onsetPhrase: "yesterday",
      activity: "padel",
      surface: "turf",
    }),
    padel,
    today,
  );
  assert.deepEqual(proposal.location, {
    status: "mapped",
    region: "left_foot",
    spoken: "left big toe joint",
  });
  assert.deepEqual(proposal.fields, {
    quality: "burning",
    activity: "padel on turf",
    duration: "Since yesterday (2026-10-21)",
  });
  assert.deepEqual(proposal.followUp, {
    key: "intensity",
    question: "How strong is it, from 0 to 10?",
  });
});

test("rejects locations outside the anatomy list and asks instead", () => {
  const transcript = "My spleen has a stabbing feeling";
  const proposal = buildProposal(
    raw({ spokenLocation: "spleen", region: "spleen" }),
    transcript,
    today,
  );
  assert.equal(proposal.location.status, "unmapped");
  assert.equal(proposal.followUp?.key, "location");
  // A valid-looking region id from the model is not enough on its own.
  assert.equal(mapLocation("spleen", "left", transcript).status, "unmapped");
  // Ids missing from the provided list are rejected too.
  assert.equal(
    mapLocation("left knee", "left", "left knee hurts", ["right_knee"]).status,
    "unmapped",
  );
});

test("never takes a location the person did not say", () => {
  // The model infers "knee" from the sport; the transcript never says it.
  const proposal = buildProposal(
    raw({ spokenLocation: "right knee", region: "right_knee", side: "right" }),
    "Played padel and it hurts",
    today,
  );
  assert.equal(proposal.location.status, "unmapped");
  assert.equal(proposal.followUp?.key, "location");
});

test("needs a stated side for left and right regions", () => {
  assert.deepEqual(mapLocation("knee", "unspecified", "my knee aches"), {
    status: "need-side",
    spoken: "knee",
    part: "knee",
  });
  // The model claims a side the person never said.
  assert.equal(
    mapLocation("knee", "right", "my knee aches").status,
    "need-side",
  );
  assert.equal(
    mapLocation("knee", "both", "both knees ache").status,
    "need-side",
  );
  assert.deepEqual(mapLocation("knee", "right", "my right knee aches"), {
    status: "mapped",
    region: "right_knee",
    spoken: "knee",
  });
  assert.deepEqual(mapLocation("lower back", "left", "lower back is stiff"), {
    status: "mapped",
    region: "lower_back",
    spoken: "lower back",
  });
  assert.equal(
    mapLocation("shoulder blade", "unspecified", "pain at my shoulder blade")
      .status,
    "mapped",
  );
  assert.equal(
    mapLocation("knee and ankle", "left", "left knee and ankle").status,
    "ambiguous",
  );
});

test("one follow-up answers the side and never asks again", () => {
  const proposal = buildProposal(
    raw({ spokenLocation: "ankle", qualities: ["sharp"], intensity: 6 }),
    "Sharp pain in my ankle, about a six",
    today,
  );
  assert.equal(proposal.followUp?.key, "side");
  assert.equal(proposal.fields.intensity, 6);
  const answered = answerFollowUp(proposal, "The left one");
  assert.deepEqual(answered.location, {
    status: "mapped",
    region: "left_ankle",
    spoken: "left ankle",
  });
  assert.equal(answered.followUp, null);
  assert.equal(answered.asked, true);
  assert.match(answered.transcript, /The left one$/);
  const unclear = answerFollowUp(proposal, "not sure");
  assert.equal(unclear.location.status, "need-side");
  assert.equal(unclear.followUp, null);
});

test("follow-up answers for intensity and location", () => {
  assert.equal(parseIntensityAnswer("seven"), 7);
  assert.equal(parseIntensityAnswer("about 4 out of 10"), 4);
  assert.equal(parseIntensityAnswer("between 3 and 5"), null);
  const proposal = buildProposal(raw(), "It burns", today);
  assert.equal(proposal.followUp?.key, "location");
  assert.equal(
    answerFollowUp(proposal, "Right heel").location.status,
    "mapped",
  );
  assert.equal(answerFollowUp(proposal, "my aura").location.status, "missing");
});

test("drops invented intensity, qualities and activity", () => {
  const proposal = buildProposal(
    raw({
      spokenLocation: "neck",
      qualities: ["throbbing", "stiff"],
      intensity: 8,
      activity: "tennis",
      onsetPhrase: "last week",
    }),
    "My neck is stiff",
    today,
  );
  assert.deepEqual(proposal.fields, { quality: "stiff" });
  assert.equal(proposal.followUp?.key, "intensity");
});

test("resolves relative onset dates against the local day", () => {
  assert.equal(resolveOnset("yesterday", today).date, "2026-10-21");
  assert.equal(resolveOnset("last night", today).date, "2026-10-21");
  assert.equal(resolveOnset("this morning", today).date, "2026-10-22");
  assert.equal(
    resolveOnset("the day before yesterday", today).date,
    "2026-10-20",
  );
  assert.equal(resolveOnset("three days ago", today).date, "2026-10-19");
  assert.equal(resolveOnset("2 weeks ago", today).date, "2026-10-08");
  assert.equal(resolveOnset("last Saturday", today).date, "2026-10-17");
  assert.equal(resolveOnset("on Thursday", today).date, "2026-10-15");
  assert.equal(resolveOnset("yesterday", "2026-03-01").date, "2026-02-28");
  assert.equal(resolveOnset("a while back", today).date, undefined);
  assert.equal(resolveOnset("yesterday", "not-a-date").date, undefined);
});

test("nothing is added without explicit confirmation", () => {
  const proposal = buildProposal(
    raw({
      spokenLocation: "left big toe joint",
      side: "left",
      qualities: ["burning"],
    }),
    padel,
    today,
  );
  for (const confirmed of [false, undefined, "yes"] as unknown[])
    assert.throws(
      () =>
        confirmProposal(proposal, {
          confirmed: confirmed as boolean,
          fields: { quality: true },
          pin: true,
        }),
      /Confirm/,
    );
  assert.deepEqual(
    confirmProposal(proposal, {
      confirmed: true,
      fields: { quality: false },
      pin: true,
    }),
    { text: padel, fields: {}, region: "left_foot", proposePin: true },
  );
});

test("a proposed pin is placed only on confirm", () => {
  let step = proposedPinStep(null, { type: "propose", region: "left_foot" });
  assert.deepEqual(step, { state: "left_foot", command: null });
  assert.equal(
    proposedPinStep(step.state, { type: "select", region: "left_foot" }).state,
    "left_foot",
  );
  assert.deepEqual(
    proposedPinStep(step.state, { type: "select", region: "right_knee" }),
    { state: null, command: null },
  );
  assert.deepEqual(proposedPinStep(step.state, { type: "dismiss" }), {
    state: null,
    command: null,
  });
  assert.deepEqual(proposedPinStep(null, { type: "confirm" }), {
    state: null,
    command: null,
  });
  step = proposedPinStep(step.state, { type: "confirm" });
  assert.deepEqual(step, { state: null, command: "pin-center" });
});

test("bridge output is validated as untrusted", async () => {
  assert.deepEqual(
    parseRawExtraction({
      spokenLocation: " <b>left knee</b> ",
      side: "sideways",
      qualities: ["sharp", 4, ""],
      intensity: 11,
    }),
    raw({ spokenLocation: "<b>left knee</b>", qualities: ["sharp"] }),
  );
  assert.throws(() => parseRawExtraction(null), /no fields/);
  const calls: unknown[] = [];
  const ai = createAppleIntelligence({
    isAvailable: async () => {
      throw new Error("missing");
    },
    extractPainEntry: async (options) => {
      calls.push(options);
      return { intensity: 3, side: "left" };
    },
    speak: async (options) => calls.push(options),
    stopSpeaking: async () => {},
  });
  assert.deepEqual(await ai.isAvailable(), { available: false });
  assert.equal(
    (await ai.extractPainEntry({ transcript: "x", anatomyList: [], today }))
      .intensity,
    3,
  );
  await ai.speak("a".repeat(400));
  assert.equal((calls[1] as { text: string }).text.length, 300);
});
