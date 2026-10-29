import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceExtraction } from "../src/platform/on-device-ai.ts";
import {
  answerFollowUp,
  buildProposal,
  parseIntensityAnswer,
  resolveOnset,
} from "../src/voice/extraction.ts";

const today = "2026-10-22";

function propose(
  note: string,
  evidence: Partial<EvidenceExtraction>,
  lang: "en" | "es" = "en",
) {
  return buildProposal(
    {
      spokenLocation: "",
      region: "",
      side: "unspecified",
      qualities: [],
      intensity: null,
      onsetPhrase: "",
      activity: "",
      surface: "",
      evidence: {
        locations: [],
        intensity: null,
        qualities: [],
        onset: null,
        activity: "",
        ...evidence,
      },
    },
    note,
    today,
    lang,
  );
}

function where(
  note: string,
  locations: [string, string][],
  lang: "en" | "es" = "en",
) {
  const found = propose(
    note,
    {
      locations: locations.map(([evidence, sideEvidence]) => ({
        evidence,
        sideEvidence,
        negated: false,
      })),
    },
    lang,
  ).location;
  return found.status === "mapped" ? found.region : found.status;
}

const knee: [string, string][] = [["left knee", "left"]];
const rodilla: [string, string][] = [["rodilla izquierda", "izquierda"]];

test("a past denial is revived only by a phrase about that part or a bare 'it hurts'", () => {
  for (const [note, lang, part] of [
    ["My left knee didn't hurt yesterday. My back hurts.", "en", knee],
    ["My left knee didn't hurt yesterday. Then I went home.", "en", knee],
    ["My left knee didn't hurt yesterday. Still, I went home.", "en", knee],
    ["My left knee didn't hurt yesterday. I went running today", "en", knee],
    [
      "My left knee didn't hurt yesterday. My right ankle hurts today",
      "en",
      knee,
    ],
    ["Mi rodilla izquierda no dolía ayer. Hoy caminé.", "es", rodilla],
    ["Mi rodilla izquierda no dolía ayer. Luego fui a casa.", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...part], lang), "missing", note);
  for (const [note, lang, part] of [
    ["My left knee didn't hurt yesterday. It hurts today", "en", knee],
    ["My left knee didn't hurt yesterday. My left knee hurts now.", "en", knee],
    ["My left knee didn't hurt yesterday but now it does", "en", knee],
    ["Mi rodilla izquierda no dolía ayer pero hoy sí", "es", rodilla],
    ["Mi rodilla izquierda no dolía ayer. Hoy me duele.", "es", rodilla],
  ] as const)
    assert.equal(where(note, [...part], lang), "left_knee", note);
});

test("'has not been hurting at all' denies the part", () => {
  assert.equal(
    where("My left knee has not been hurting at all", knee),
    "missing",
  );
  assert.equal(
    where("My left knee has not been hurting much", knee),
    "left_knee",
  );
});

test("'from left to right' is a direction, not a side", () => {
  for (const note of [
    "The pain goes from left to right across my knee",
    "It spreads from left to right in the knee",
  ])
    for (const side of ["right", "left"])
      assert.equal(where(note, [["knee", side]]), "need-side", note);
  assert.equal(
    where("It spreads from left to right in my right knee", [
      ["right knee", "right"],
    ]),
    "right_knee",
  );
  assert.equal(
    where("Del lado izquierdo, la rodilla", [["rodilla", "izquierda"]], "es"),
    "left_knee",
  );
});

test("'still' before a side does not block it", () => {
  assert.equal(where("Still left knee hurts", knee), "left_knee");
  assert.equal(where("Still my left knee hurts", knee), "left_knee");
  assert.equal(where("I have left knee pain", knee), "left_knee");
  assert.equal(
    where("I still left my brace and my knee hurts", [["knee", "left"]]),
    "need-side",
  );
});

test("stopped, done and finished hurting keep a denial", () => {
  for (const tail of [
    "it's stopped hurting",
    "it's done hurting",
    "it's finished for today",
    "it's finished hurting",
    "it's stopped hurting now",
  ])
    assert.equal(
      where(`My left knee doesn't hurt, ${tail}`, knee),
      "missing",
      tail,
    );
  assert.equal(
    where("My left knee doesn't hurt, it's still hurting", knee),
    "left_knee",
  );
});

test("Spanish 'ya no' only clears when it is about the pain", () => {
  for (const tail of [
    "es que ya no puedo caminar",
    "es que ya no aguanto",
    "es que ya no se me quita",
    "es que ya no mejora",
    "es que ya se me hinchó",
  ])
    assert.equal(
      where(`La rodilla izquierda no me duele, ${tail}`, rodilla, "es"),
      "left_knee",
      tail,
    );
  for (const tail of [
    "es que ya no duele",
    "es que ya no me molesta",
    "es que ya se me quitó",
    "es que sigue bien",
  ])
    assert.equal(
      where(`La rodilla izquierda no me duele, ${tail}`, rodilla, "es"),
      "missing",
      tail,
    );
});

test("'hizo' counts days only after a day word", () => {
  const day = (note: string) => resolveOnset(note, today).date ?? "";
  assert.equal(day("hace dos dias"), "2026-10-20");
  assert.equal(day("ayer hizo una semana"), "2026-10-14");
  assert.equal(day("hizo ejercicio dos dias"), "");
  assert.equal(day("hizo dos dias de reposo"), "");
  const proposal = propose(
    "Hizo dos días de reposo y me duele la rodilla",
    {
      locations: [{ evidence: "rodilla", sideEvidence: "", negated: false }],
      onset: { evidence: "hizo dos días", negated: false },
    },
    "es",
  );
  assert.equal(proposal.fields.duration, undefined);
});

test("a hedge before a side answer is not a denial", () => {
  const asked = propose("My knee hurts", {
    locations: [{ evidence: "knee", sideEvidence: "", negated: false }],
  });
  for (const [reply, region] of [
    ["not sure, the left", "left_knee"],
    ["I'm not sure, the left", "left_knee"],
    ["I don't know, the right one", "right_knee"],
    ["not the left, the right", "right_knee"],
    ["not left", undefined],
  ] as const) {
    const found = answerFollowUp(asked, reply).location;
    assert.equal(
      found.status === "mapped" ? found.region : undefined,
      region,
      reply,
    );
  }
  const askedEs = propose(
    "Me duele la rodilla",
    { locations: [{ evidence: "rodilla", sideEvidence: "", negated: false }] },
    "es",
  );
  for (const [reply, region] of [
    ["no sé, la derecha", "right_knee"],
    ["no estoy seguro, la izquierda", "left_knee"],
    ["no sé", undefined],
    ["no es la derecha", undefined],
  ] as const) {
    const found = answerFollowUp(askedEs, reply).location;
    assert.equal(
      found.status === "mapped" ? found.region : undefined,
      region,
      reply,
    );
  }
});

test("'burning' in the knee still asks which side", () => {
  const found = propose("It's burning in the knee", {
    locations: [{ evidence: "knee", sideEvidence: "", negated: false }],
    qualities: [{ evidence: "burning", negated: false }],
  });
  assert.equal(found.location.status, "need-side");
  assert.equal(found.fields.quality, "burning");
});

test("'I'm at 7' is a rating and a time or place is not", () => {
  for (const [note, value] of [
    ["I'm at 7", 7],
    ["I am at a 7", 7],
    ["I'm at 7 now", 7],
    ["Estoy en 7", 7],
    ["Estoy en un 7", 7],
  ] as const) {
    assert.equal(parseIntensityAnswer(note), value, note);
    const found = propose(`My left knee hurts. ${note}`, {
      locations: [
        { evidence: "left knee", sideEvidence: "left", negated: false },
      ],
      intensity: {
        evidence: "7",
        value,
        kind: "rating",
        negated: false,
      },
    });
    assert.equal(found.fields.intensity, 7, note);
  }
  for (const note of [
    "I'm at 7 pm",
    "I'm at 7 miles",
    "I'm at 7 o'clock",
    "I'm at 7 Main Street",
    "Estoy en 7 sitios",
  ]) {
    const found = propose(`My left knee hurts. ${note}`, {
      locations: [
        { evidence: "left knee", sideEvidence: "left", negated: false },
      ],
      intensity: { evidence: "7", value: 7, kind: "rating", negated: false },
    });
    assert.equal(found.fields.intensity, undefined, note);
  }
});

test("a part the note says hurts is not dropped when the model lists only one", () => {
  for (const [note, lang, part] of [
    ["My left knee and right shoulder hurt", "en", knee],
    ["My left knee hurts and my shoulder hurts too", "en", knee],
    ["My left knee hurts and my right ankle hurts", "en", knee],
    [
      "Me duele la rodilla izquierda y me duele el hombro derecho",
      "es",
      rodilla,
    ],
  ] as const)
    assert.equal(where(note, [...part], lang), "ambiguous", note);
  for (const note of [
    "My left knee hurts but my shoulder is fine",
    "My left knee hurts. My shoulder doesn't hurt",
  ])
    assert.equal(where(note, knee), "left_knee", note);
});

test("'doesn't hurt at rest' or 'when I walk' stays a denial; hedges and 'unless' do not", () => {
  for (const note of [
    "My left knee doesn't hurt at rest",
    "My left knee doesn't hurt when I walk",
    "My left knee doesn't hurt when I walk up stairs today",
    "My left knee doesn't hurt during the day",
  ])
    assert.equal(where(note, knee), "missing", note);
  assert.equal(
    where("Mi rodilla izquierda no me duele en reposo", rodilla, "es"),
    "missing",
  );
  assert.equal(
    where("Mi rodilla izquierda no me duele cuando camino", rodilla, "es"),
    "missing",
  );
  for (const note of [
    "My left knee doesn't hurt much",
    "My left knee doesn't hurt unless I kneel",
  ])
    assert.equal(where(note, knee), "left_knee", note);
});

test("a part named only in the condition of the pain is not another hurting part", () => {
  for (const note of [
    "My left knee hurts when I put my right foot down",
    "My left knee hurts when I lift my right shoulder",
    "My left knee hurts if I turn my head",
    "My left knee hurts every time I move my shoulder",
  ])
    assert.equal(where(note, knee), "left_knee", note);
  assert.equal(
    where(
      "Me duele la rodilla izquierda cuando levanto el hombro derecho",
      rodilla,
      "es",
    ),
    "left_knee",
  );
  assert.equal(
    where("My left knee hurts when I walk, and my right shoulder hurts", knee),
    "ambiguous",
  );
});
