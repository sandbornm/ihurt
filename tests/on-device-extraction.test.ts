import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFollowUp,
  buildProposal,
  confirmProposal,
  describeLocation,
  grounded,
  mapLocation,
  seedSuggestedFields,
  parseIntensityAnswer,
  proposedPinStep,
  resolveOnset,
} from "../src/voice/extraction.ts";
import { createAvailabilityGate } from "../src/voice/ai-gate.ts";
import { voiceNotice } from "../src/voice/draft.ts";
import {
  createAppleIntelligence,
  ExtractionCancelled,
  parseRawExtraction,
  type AppleIntelligenceBridge,
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
    cancelExtraction: async () => {},
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

// A bridge whose extraction never answers until told to, like a slow model.
function slowBridge() {
  const log: string[] = [];
  let next = 0;
  const pending = new Map<number, (value: unknown) => void>();
  const bridge: AppleIntelligenceBridge = {
    isAvailable: async () => ({ available: true }),
    extractPainEntry: () =>
      new Promise((resolve) => {
        const id = ++next;
        log.push(`start ${id}`);
        pending.set(id, resolve);
      }),
    cancelExtraction: async () => {
      log.push("cancel");
    },
    speak: async () => {},
    stopSpeaking: async () => {},
  };
  return { bridge, log, pending };
}
const request = {
  transcript: "my left knee",
  anatomyList: ["left_knee"],
  today,
};

test("an extraction times out, cancels natively, and the next one works", async () => {
  const { bridge, log, pending } = slowBridge();
  const ai = createAppleIntelligence(bridge);
  await assert.rejects(ai.extractPainEntry(request, { timeoutMs: 10 }), {
    message: /took too long/,
  });
  assert.deepEqual(log, ["start 1", "cancel"]);
  const second = ai.extractPainEntry(request, { timeoutMs: 1000 });
  pending.get(2)?.({ intensity: 4 });
  assert.equal((await second).intensity, 4);
  // A late answer from the timed-out call changes nothing.
  pending.get(1)?.({ intensity: 9 });
});

test("cancel stops an in-flight extraction and a new request still runs", async () => {
  const { bridge, log, pending } = slowBridge();
  const ai = createAppleIntelligence(bridge);
  const controller = new AbortController();
  const first = ai.extractPainEntry(request, { signal: controller.signal });
  controller.abort();
  await assert.rejects(first, ExtractionCancelled);
  assert.deepEqual(log, ["start 1", "cancel"]);
  await assert.rejects(
    ai.extractPainEntry(request, { signal: controller.signal }),
    ExtractionCancelled,
  );
  const second = ai.extractPainEntry(request);
  pending.get(2)?.({ side: "left" });
  assert.equal((await second).side, "left");
  await ai.cancel();
  assert.equal(log.at(-1), "cancel");
});

test("a late native rejection after a timeout or cancel is not unhandled", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const rejects: ((reason: Error) => void)[] = [];
    const bridge: AppleIntelligenceBridge = {
      isAvailable: async () => ({ available: true }),
      extractPainEntry: () =>
        new Promise((_, reject) => {
          rejects.push(reject);
        }),
      cancelExtraction: async () => {},
      speak: async () => {},
      stopSpeaking: async () => {},
    };
    const ai = createAppleIntelligence(bridge);
    await assert.rejects(ai.extractPainEntry(request, { timeoutMs: 5 }), {
      message: /took too long/,
    });
    const controller = new AbortController();
    const second = ai.extractPainEntry(request, { signal: controller.signal });
    controller.abort();
    await assert.rejects(second, ExtractionCancelled);
    // The native side answers late, as it does when cancelled.
    for (const reject of rejects)
      reject(new Error("Apple Intelligence stopped reading this note."));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("the voice notice matches the transcription state", () => {
  const base = { checking: false, maxSeconds: 60 };
  assert.match(
    voiceNotice({ ...base, native: true, provider: null, available: true }),
    /runs on your device/,
  );
  const off = voiceNotice({
    ...base,
    native: false,
    provider: null,
    available: false,
  });
  assert.match(off, /off here/);
  assert.doesNotMatch(off, /sends audio/);
  // A provider name without a working server is still off.
  assert.doesNotMatch(
    voiceNotice({
      ...base,
      native: false,
      provider: "ElevenLabs",
      available: false,
    }),
    /sends audio/,
  );
  assert.match(
    voiceNotice({
      ...base,
      native: false,
      provider: "ElevenLabs",
      available: true,
    }),
    /sends audio to ElevenLabs/,
  );
  assert.match(
    voiceNotice({
      ...base,
      checking: true,
      native: false,
      provider: null,
      available: false,
    }),
    /Checking/,
  );
});

test("new suggestions are pre-ticked and reach the entry", () => {
  const proposal = buildProposal(
    raw({ onsetPhrase: "yesterday", qualities: ["burning"] }),
    "burning since yesterday in my left foot",
    today,
  );
  // The person had unticked duration on an earlier draft.
  const choice = seedSuggestedFields(
    { duration: false, quality: false, intensity: true },
    {},
    proposal.fields,
    { quality: "dull" },
  );
  assert.equal(choice.duration, true);
  // Replacing an existing value stays the person's choice.
  assert.equal(choice.quality, false);
  const value = confirmProposal(proposal, {
    confirmed: true,
    fields: choice,
    pin: true,
  });
  assert.equal(value.fields.duration, "Since yesterday (2026-10-21)");
  assert.equal(value.fields.quality, undefined);
  // An intensity that arrives with the follow-up answer is ticked too, but a
  // field the person already saw and unticked stays unticked.
  const answered = answerFollowUp(proposal, "about a 6");
  const after = seedSuggestedFields(
    { ...choice, duration: false },
    proposal.fields,
    answered.fields,
    {},
  );
  assert.equal(after.intensity, true);
  assert.equal(after.duration, false);
  // The confirm gate is unchanged.
  assert.throws(
    () =>
      confirmProposal(answered, { confirmed: false, fields: after, pin: true }),
    /Confirm the proposed entry/,
  );
});

test("a recording that finishes during the availability check is read once ready", () => {
  const gate = createAvailabilityGate();
  assert.equal(gate.request("first note"), undefined);
  assert.equal(gate.request("second note"), undefined);
  assert.equal(gate.settle(true), "second note");
  assert.equal(gate.settle(true), undefined);
  assert.equal(gate.request("third"), "third");
  const off = createAvailabilityGate();
  off.request("note");
  assert.equal(off.settle(false), undefined);
  assert.equal(off.request("later"), undefined);
  const cleared = createAvailabilityGate();
  cleared.request("note");
  cleared.clear();
  assert.equal(cleared.settle(true), undefined);
});

test("location text tells the truth for side and ambiguous questions", () => {
  assert.equal(
    describeLocation({ status: "need-side", spoken: "knee", part: "knee" }),
    "You said “knee” · left or right?",
  );
  assert.match(
    describeLocation({ status: "ambiguous", spoken: "knee and hip" }),
    /more than one area/,
  );
});

test("grounding accepts irregular plurals", () => {
  assert.ok(grounded("foot", "both feet ache"));
  assert.ok(grounded("calves", "my calf is tight"));
  assert.ok(grounded("calf", "tight calves"));
  assert.equal(grounded("ankle", "both feet ache"), false);
});

test("intensity needs a rating, not any number", () => {
  const accepted: [string, number][] = [
    ["The pain is 7 out of 10", 7],
    ["It was 7/10", 7],
    ["I would call it a 7", 7],
    ["about a seven", 7],
    ["the pain is 7", 7],
    ["I rated it 7", 7],
    ["pain level 7", 7],
    ["intensity 7", 7],
    ["seven out of ten", 7],
    ["it's a 4", 4],
  ];
  for (const [transcript, intensity] of accepted)
    assert.equal(
      buildProposal(raw({ intensity }), transcript, today).fields.intensity,
      intensity,
      transcript,
    );
  const rejected: [string, number][] = [
    ["My left knee started 3 days ago", 3],
    ["It has been 2 weeks", 2],
    ["I walked 5 miles", 5],
    ["It woke me at 7 am", 7],
    ["It happened 3 times", 3],
  ];
  for (const [transcript, intensity] of rejected)
    assert.equal(
      buildProposal(raw({ intensity }), transcript, today).fields.intensity,
      undefined,
      transcript,
    );
  // "3" is how long ago it started. "7" is the rating.
  const both = "My left knee started 3 days ago and the pain is 7";
  assert.equal(
    buildProposal(raw({ intensity: 3 }), both, today).fields.intensity,
    undefined,
  );
  assert.equal(
    buildProposal(raw({ intensity: 7 }), both, today).fields.intensity,
    7,
  );
  // The 10 in "7 out of 10" is the scale, not the rating.
  assert.equal(
    buildProposal(raw({ intensity: 10 }), "pain is 7 out of 10", today).fields
      .intensity,
    undefined,
  );
  const started = buildProposal(
    raw({ spokenLocation: "left knee", side: "left", intensity: 3 }),
    "My left knee started 3 days ago",
    today,
  );
  assert.equal(started.fields.intensity, undefined);
  assert.equal(started.location.status, "mapped");
  assert.equal(started.followUp?.key, "intensity");
});

test("a value in a denied clause is not grounded", () => {
  const denied = "It is not my left knee and it isn't burning";
  const dropped = buildProposal(
    raw({
      spokenLocation: "left knee",
      side: "left",
      qualities: ["burning"],
    }),
    denied,
    today,
  );
  assert.notEqual(dropped.location.status, "mapped");
  assert.equal(mapLocation("left knee", "left", denied).status, "unmapped");
  assert.equal(dropped.fields.quality, undefined);

  const mixed = "my left knee isn't burning, it's aching";
  const kept = buildProposal(
    raw({
      spokenLocation: "left knee",
      side: "left",
      qualities: ["burning", "aching"],
    }),
    mixed,
    today,
  );
  assert.deepEqual(kept.location, {
    status: "mapped",
    region: "left_knee",
    spoken: "left knee",
  });
  assert.equal(kept.fields.quality, "aching");

  const affirmed = "my left knee is burning";
  const yes = buildProposal(
    raw({
      spokenLocation: "left knee",
      side: "left",
      qualities: ["burning"],
    }),
    affirmed,
    today,
  );
  assert.deepEqual(yes.location, {
    status: "mapped",
    region: "left_knee",
    spoken: "left knee",
  });
  assert.equal(yes.fields.quality, "burning");

  // The denial stops at "and". The knee was still named.
  const ordered = "it isn't burning and my left knee hurts";
  const after = buildProposal(
    raw({
      spokenLocation: "left knee",
      side: "left",
      qualities: ["burning"],
    }),
    ordered,
    today,
  );
  assert.equal(after.location.status, "mapped");
  assert.equal(after.fields.quality, undefined);
  const hurting = "my left knee hurts and it's burning";
  const both = buildProposal(
    raw({
      spokenLocation: "left knee",
      side: "left",
      qualities: ["burning"],
    }),
    hurting,
    today,
  );
  assert.equal(both.location.status, "mapped");
  assert.equal(both.fields.quality, "burning");
});

test("earlier is today only in a same-day phrase", () => {
  for (const phrase of [
    "earlier",
    "earlier today",
    "earlier this morning",
    "earlier this afternoon",
    "earlier this evening",
  ])
    assert.equal(resolveOnset(phrase, today).date, today, phrase);
  for (const phrase of [
    "earlier this year",
    "earlier in my life",
    "earlier this month",
    "earlier this week",
  ]) {
    const onset = resolveOnset(phrase, today);
    assert.equal(onset.date, undefined, phrase);
    assert.equal(onset.phrase, phrase);
  }
});

test("a side and a part from different phrases do not map", () => {
  const said = "my left knee and right foot hurt";
  assert.equal(mapLocation("left foot", "left", said).status, "unmapped");
  assert.equal(mapLocation("right knee", "right", said).status, "unmapped");
  assert.deepEqual(mapLocation("left knee", "left", said), {
    status: "mapped",
    region: "left_knee",
    spoken: "left knee",
  });
  assert.deepEqual(mapLocation("right foot", "right", said), {
    status: "mapped",
    region: "right_foot",
    spoken: "right foot",
  });
});

test("a negated rating or a rating-shaped count or date is not intensity", () => {
  const raw = (intensity: number) => ({
    spokenLocation: "left knee",
    side: "left" as const,
    qualities: [],
    intensity,
    activity: "",
    surface: "",
    onsetPhrase: "",
  });
  for (const [said, n] of [
    ["My left knee is not a 7.", 7],
    ["My left knee, it's not 7 out of 10.", 7],
    ["My left knee, I wouldn't call it a 7.", 7],
    ["My left knee flared 3 out of 10 days.", 3],
    ["My left knee hurt 7 out of 10 times.", 7],
    ["My left knee started on 7/10.", 7],
    ["My left knee since 7/10/26.", 7],
  ] as const)
    assert.equal(
      buildProposal(raw(n), said, today).fields.intensity,
      undefined,
      said,
    );
  for (const [said, n] of [
    ["My left knee doesn't hurt much. It's a 4.", 4],
    ["My left knee is 7 out of 10.", 7],
    ["My left knee is about 6/10.", 6],
  ] as const)
    assert.equal(buildProposal(raw(n), said, today).fields.intensity, n, said);
});

test("a denial covers what it denies, not what is affected", () => {
  assert.equal(
    mapLocation("left knee", "left", "I can't bend my left knee").status,
    "mapped",
  );
  assert.equal(
    mapLocation("right foot", "right", "I cannot walk on my right foot").status,
    "mapped",
  );
  const said = "my left knee is not the problem but it is my right ankle";
  assert.notEqual(mapLocation("left knee", "left", said).status, "mapped");
  assert.deepEqual(mapLocation("right ankle", "right", said), {
    status: "mapped",
    region: "right_ankle",
    spoken: "right ankle",
  });
  assert.notEqual(
    mapLocation("left knee", "left", "my left knee doesn't hurt").status,
    "mapped",
  );
  assert.equal(
    grounded("aching", "my left knee isn't burning, it's aching"),
    true,
  );
});

test("the model's side needs a stated, undenied side for that one part", () => {
  assert.equal(
    mapLocation("knee", "left", "my knee hurts but not the left").status,
    "need-side",
  );
  assert.equal(
    mapLocation("foot", "left", "my left knee and my foot hurt").status,
    "need-side",
  );
  assert.equal(
    mapLocation("knee", "left", "my knee hurts, the left one").status,
    "mapped",
  );
  assert.equal(
    mapLocation("knee", "left", "My knee hurts. I left work early.").status,
    "need-side",
  );
});

test("affected parts and hedged hurt keep the location; other fields keep negators", () => {
  for (const said of [
    "My left knee doesn't hurt much",
    "My left knee doesn't hurt much. It's a 4.",
    "my left knee isn't sore, it's aching",
    "my left knee isn't hurting, it's aching",
    "I couldn't run because my left knee hurts",
  ])
    assert.equal(mapLocation("left knee", "left", said).status, "mapped", said);
  assert.notEqual(
    mapLocation("left knee", "left", "my left knee doesn't hurt at all").status,
    "mapped",
  );
  assert.notEqual(
    mapLocation(
      "left knee",
      "left",
      "I wouldn't say my left knee is the problem",
    ).status,
    "mapped",
  );
  assert.equal(
    grounded("run", "I couldn't run because my left knee hurts"),
    false,
  );
});

test("denied, verb, and loose sides do not map a location", () => {
  for (const said of [
    "my left knee doesn't hurt anymore",
    "my left knee doesn't hurt today",
    "My left knee isn't hurting at all",
    "my left knee isn't painful",
    "I couldn't say my left knee is the problem",
    "I can't tell if my left knee is the problem",
    "I left work because my knee hurts",
  ])
    assert.notEqual(
      mapLocation("left knee", "left", said).status,
      "mapped",
      said,
    );
  for (const said of [
    "I left work early because my knee hurts",
    "It hurts right at my knee",
    "My knee hurts. The bag is on the left.",
  ])
    assert.equal(
      mapLocation("knee", said.includes("right") ? "right" : "left", said)
        .status,
      "need-side",
      said,
    );
  for (const said of [
    "my left knee doesn't hurt, it's aching",
    "I can't bend my left knee",
  ])
    assert.equal(
      mapLocation("left knee", "unspecified", said).status,
      "mapped",
      said,
    );
  assert.equal(
    grounded(
      "run on pavement",
      "I run daily but I couldn't run on pavement",
      true,
    ),
    false,
  );
});

test("a negated follow-up rating is not recorded", () => {
  assert.equal(parseIntensityAnswer("not seven"), null);
  assert.equal(parseIntensityAnswer("it isn't a 7"), null);
  assert.equal(parseIntensityAnswer("seven"), 7);
});

test("a follow-up that would be cut from the transcript is not used", () => {
  const proposal = buildProposal(
    {
      spokenLocation: "left knee",
      side: "left",
      qualities: [],
      intensity: null,
      activity: "",
      surface: "",
      onsetPhrase: "",
    },
    `my left knee hurts ${"x".repeat(2985)}`,
    today,
  );
  assert.equal(proposal.followUp?.key, "intensity");
  const next = answerFollowUp(proposal, "seven");
  assert.equal(next.fields.intensity, undefined);
  assert.equal(next.transcript, proposal.transcript);
  const short = answerFollowUp(
    { ...proposal, transcript: "my left knee hurts" },
    "seven",
  );
  assert.equal(short.fields.intensity, 7);
  assert.equal(short.transcript, "my left knee hurts\nseven");
});

test("an onset and an activity surface must be said together", () => {
  const raw = {
    spokenLocation: "",
    side: null,
    qualities: [],
    intensity: null,
    activity: "",
    surface: "",
    onsetPhrase: "",
  };
  const onset = buildProposal(
    { ...raw, onsetPhrase: "three weeks ago" },
    "I ran three miles and my left knee started weeks ago",
    today,
  );
  assert.equal(onset.fields.duration, undefined);
  assert.equal(
    buildProposal(
      { ...raw, onsetPhrase: "three weeks ago" },
      "My left knee started three weeks ago",
      today,
    ).fields.duration,
    "Since three weeks ago (2026-10-01)",
  );
  const said = "I ran on pavement and played tennis on clay";
  assert.equal(
    buildProposal({ ...raw, activity: "ran", surface: "clay" }, said, today)
      .fields.activity,
    "ran",
  );
  assert.equal(
    buildProposal({ ...raw, activity: "ran", surface: "pavement" }, said, today)
      .fields.activity,
    "ran on pavement",
  );
});

test("intensity replies accept N/10 and reject numbers that are not ratings", () => {
  assert.equal(parseIntensityAnswer("7/10"), 7);
  assert.equal(parseIntensityAnswer("about 6/10"), 6);
  assert.equal(parseIntensityAnswer("seven out of ten"), 7);
  for (const reply of [
    "seven days ago",
    "7 miles",
    "I am 7 years old",
    "7/10/26",
    "6/10 and 4/10",
    "not 7/10",
  ])
    assert.equal(parseIntensityAnswer(reply), null, reply);
});

test("a side reply must name a side, not deny one or use the verb", () => {
  const asked = buildProposal(
    raw({ spokenLocation: "ankle" }),
    "My ankle hurts",
    today,
  );
  assert.equal(asked.location.status, "need-side");
  for (const reply of ["not left.", "not left", "I left work", "I left it"])
    assert.equal(
      answerFollowUp(asked, reply).location.status,
      "need-side",
      reply,
    );
  for (const [reply, region] of [
    ["left", "left_ankle"],
    ["the left one", "left_ankle"],
    ["it's the right", "right_ankle"],
  ])
    assert.deepEqual(
      answerFollowUp(asked, reply).location.status === "mapped" &&
        (answerFollowUp(asked, reply).location as { region: string }).region,
      region,
      reply,
    );
});

test("the verb left is not a side in the model's own spoken location", () => {
  assert.equal(
    buildProposal(
      raw({ spokenLocation: "left knee" }),
      "I left work because my knee hurts",
      today,
    ).location.status,
    "unmapped",
  );
});

test("an activity must be one spoken phrase", () => {
  const said = "I went running and played tennis and my knee hurts";
  assert.equal(
    buildProposal(
      raw({ spokenLocation: "knee", activity: "running tennis" }),
      said,
      today,
    ).fields.activity,
    undefined,
  );
  assert.equal(
    buildProposal(
      raw({ spokenLocation: "knee", activity: "running" }),
      said,
      today,
    ).fields.activity,
    "running",
  );
});

test("a counted offset wins over a day word inside it", () => {
  assert.equal(resolveOnset("a week ago today", today).date, "2026-10-15");
  assert.equal(
    resolveOnset("two weeks ago yesterday", today).date,
    "2026-10-07",
  );
  assert.equal(resolveOnset("a week ago yesterday", today).date, "2026-10-14");
  assert.equal(resolveOnset("a week ago tomorrow", today).date, "2026-10-16");
  assert.equal(resolveOnset("today", today).date, today);
});

test("'it's fine' after a denial clears the part; 'it's aching' only corrects", () => {
  const location = (said: string, spoken = "left knee") =>
    buildProposal(raw({ spokenLocation: spoken, side: "left" }), said, today)
      .location.status;
  assert.equal(location("My left knee doesn't hurt, it's fine."), "unmapped");
  assert.equal(location("My left knee doesn't hurt, it's gone"), "unmapped");
  assert.equal(location("My left knee isn't sore, it's aching."), "mapped");
});

test("the availability gate follows a later check when Settings changes", () => {
  const gate = createAvailabilityGate();
  assert.equal(gate.settle(false), undefined);
  assert.equal(gate.request("a note"), undefined);
  assert.equal(gate.recheck(true), undefined);
  assert.equal(gate.state, "ready");
  assert.equal(gate.request("a note"), "a note");
  gate.recheck(false);
  assert.equal(gate.state, "off");
  const waiting = createAvailabilityGate();
  waiting.request("first");
  assert.equal(waiting.recheck(true), "first");
});

test("derecho means straight, not the right side, in 'camino derecho'", () => {
  const where = (said: string, spoken: string, side: "left" | "right") =>
    buildProposal(raw({ spokenLocation: spoken, side }), said, today).location;
  assert.equal(
    where("Me duele la rodilla y camino derecho", "rodilla derecha", "right")
      .status,
    "unmapped",
  );
  assert.equal(
    where("Voy derecho a casa. Me duele la rodilla", "rodilla", "right").status,
    "need-side",
  );
  assert.equal(
    where(
      "Camino derecho y me duele la rodilla derecha",
      "rodilla derecha",
      "right",
    ).status,
    "mapped",
  );
  assert.equal(parseIntensityAnswer("sin duda un 7"), 7);
  assert.equal(parseIntensityAnswer("7 de 10"), 7);
  assert.equal(parseIntensityAnswer("siete dias"), null);
  const noRun = buildProposal(
    raw({ spokenLocation: "rodilla", activity: "correr" }),
    "Me duele la rodilla, no puedo correr desde ayer",
    today,
  );
  assert.equal(noRun.fields.activity, undefined);
});

test("a date or a scale alone is not a rating; 'I'm 7' is", () => {
  for (const reply of ["on 7/10", "since 7/10", "7/10 days ago", "7/10/26"])
    assert.equal(parseIntensityAnswer(reply), null, reply);
  for (const reply of ["out of 10", "/10", "of 10", "n/10"])
    assert.equal(parseIntensityAnswer(reply), null, reply);
  assert.equal(parseIntensityAnswer("I'm 7"), 7);
  assert.equal(parseIntensityAnswer("I am seven"), 7);
  assert.equal(parseIntensityAnswer("I\u2019m 7"), 7);
  assert.equal(parseIntensityAnswer("I am 7 years old"), null);
  assert.equal(parseIntensityAnswer("aged 7"), null);
  assert.equal(parseIntensityAnswer("7/10"), 7);
  assert.equal(parseIntensityAnswer("a 7 out of 10"), 7);
});

test("plain side answers are read, and non-side uses of left and right are not", () => {
  const side = (reply: string) =>
    answerFollowUp(
      buildProposal(
        raw({ spokenLocation: "ankle", side: "unspecified" }),
        "My ankle hurts",
        today,
      ),
      reply,
    ).location;
  for (const [reply, region] of [
    ["no, the right one", "right_ankle"],
    ["that left one", "left_ankle"],
    ["I think it is the left one", "left_ankle"],
    ["not the left, the right", "right_ankle"],
  ])
    assert.deepEqual(
      (side(reply) as { region?: string }).region,
      region,
      reply,
    );
  for (const reply of [
    "all right",
    "left now",
    "left right after",
    "right now",
    "right away",
    "not the left",
  ])
    assert.equal(side(reply).status, "need-side", reply);
});

test("clearing phrases: finished clears, 'not gone' and 'better than yesterday' do not", () => {
  const location = (said: string) =>
    buildProposal(
      raw({ spokenLocation: "left knee", side: "left" }),
      said,
      today,
    ).location.status;
  for (const said of [
    "My left knee doesn't hurt, it's over",
    "My left knee doesn't hurt, it's resolved",
    "My left knee doesn't hurt, it's stopped",
    "My left knee doesn't hurt, it's my ankle",
  ])
    assert.equal(location(said), "unmapped", said);
  for (const said of [
    "My left knee isn't sore, it's good pain",
    "My left knee isn't sore, it's better than yesterday",
    "My left knee doesn't hurt, it's not gone",
  ])
    assert.equal(location(said), "mapped", said);
});
