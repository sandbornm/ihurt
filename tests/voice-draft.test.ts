import assert from "node:assert/strict";
import test from "node:test";
import { applyVoiceDraft, suggestVoiceDraft } from "../src/voice/draft.ts";
import { blankEntry } from "../src/notebook-data.ts";

test("spoken ratings and explicit details become editable field suggestions", () => {
  assert.deepEqual(
    suggestVoiceDraft(
      "My left calf feels tight, four out of ten. Activity: running. Duration: since yesterday.",
    ),
    {
      fields: {
        intensity: 4,
        quality: "tight",
        activity: "running",
        duration: "since yesterday",
      },
      locations: ["left_calf"],
    },
  );
});
test("ambiguous ratings, negation, activities and posture never place pins", () => {
  for (const text of [
    "I ran five miles.",
    "I slept on my left shoulder.",
    "My left knee does not hurt.",
    "No pain in my right calf.",
    "Played tennis today.",
  ])
    assert.deepEqual(suggestVoiceDraft(text).locations, []);
  assert.equal(suggestVoiceDraft("My knee is sore.").locations.length, 0);
  assert.equal(
    suggestVoiceDraft("Four out of ten yesterday; seven out of ten today.")
      .fields.intensity,
    undefined,
  );
  assert.equal(
    suggestVoiceDraft("Not four out of ten.").fields.intensity,
    undefined,
  );
  assert.equal(
    suggestVoiceDraft("A 40 out of 100 rating.").fields.intensity,
    undefined,
  );
});
test("applying a reviewed draft appends text and only changes chosen fields", () => {
  const entry = blankEntry();
  entry.note = "An earlier observation.";
  entry.map.intensity = 7;
  entry.map.activity = "Walking";
  const next = applyVoiceDraft(entry, {
    text: "Left calf feels tight.",
    fields: { quality: "tight" },
    region: "left_calf",
  });
  assert.equal(next.note, "An earlier observation.\n\nLeft calf feels tight.");
  assert.equal(next.map.intensity, 7);
  assert.equal(next.map.activity, "Walking");
  assert.deepEqual(next.points, entry.points);
  assert.deepEqual(next.map.regions, []);
  assert.equal(entry.note, "An earlier observation.");
  assert.throws(
    () => applyVoiceDraft(entry, { text: "x".repeat(3000), fields: {} }),
    /combined note/,
  );
});
