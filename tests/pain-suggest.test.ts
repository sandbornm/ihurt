import test from "node:test";
import assert from "node:assert/strict";
import { regions } from "../src/types.ts";
import {
  advisoryCopy,
  painCatalog,
  painLevelCopy,
  plainText,
  readSuggestion,
  regionLabel,
  sideCopy,
  statedIntensity,
} from "../src/pain/catalog.ts";
import { chooseSpeech } from "../src/pain/dictate.ts";

test("pain regions map only onto known anatomy ids", () => {
  const ids = new Set(regions.map((region) => region.id));
  const covered = new Set<string>();
  for (const region of painCatalog.regions) {
    assert.equal(ids.has(region.anatomy_id), true);
    assert.equal(regionLabel(region.id), region.name);
    if (region.anatomy_id.startsWith("left_")) assert.equal(region.side, "left");
    if (region.anatomy_id.startsWith("right_"))
      assert.equal(region.side, "right");
    if (region.id === region.anatomy_id) covered.add(region.anatomy_id);
  }
  assert.equal(covered.size, ids.size);
});

test("red flags use the care notice and model text is not html", () => {
  assert.equal(
    advisoryCopy([{ id: "chest_pain" }]),
    "Consider seeking care. This is not a diagnosis.",
  );
  assert.equal(advisoryCopy(null), null);
  assert.equal(
    plainText("<img src=x onerror=alert(1)> left shoulder"),
    "left shoulder",
  );
  assert.equal(plainText("pain < 5 > minutes").includes("<"), false);
});

test("suggestions keep only side and pain level", () => {
  const parsed = readSuggestion({
    regions: [
      {
        id: "left_deltoid",
        anatomy_id: "left_shoulder",
        confidence: 0.99,
        sub_location: null,
      },
    ],
    side: { id: "left", label: "Left", confidence: 0.9 },
    pain_type: { id: "sharp", confidence: 0.9 },
    pain_level: {
      band: "severe",
      label: "Severe (6-7)",
      value: 6,
      confidence: 0.8,
    },
    red_flags: [{ id: "chest_pain", confidence: 0.9 }],
  });
  assert.deepEqual(Object.keys(parsed!).sort(), ["pain_level", "side"]);
  assert.equal(parsed!.side?.id, "left");
  assert.equal(parsed!.pain_level?.value, 6);
  assert.equal(sideCopy("left"), "Left side");
  assert.equal(sideCopy("unspecified"), null);
  assert.equal(painLevelCopy(parsed!.pain_level!), "AI band: Severe (6-7)");
  assert.equal(
    readSuggestion({
      side: { id: "right", confidence: 0.49 },
      pain_level: { band: "mild", label: "Mild (2-3)", value: 2, confidence: 0.5 },
    })!.side,
    null,
  );
});

test("statedIntensity keeps exact ratings and drops negated ones", () => {
  assert.equal(statedIntensity("about 7/10 in my knee"), 7);
  assert.equal(statedIntensity("pain is 3 out of 10"), 3);
  assert.equal(statedIntensity("it is not 7/10, more like a 3/10"), 3);
  assert.equal(statedIntensity("sharp pain in my left shoulder"), null);
  assert.equal(statedIntensity("not 7/10"), null);
  assert.equal(statedIntensity("5/10 and also 8/10"), null);
});

test("speech uses Apple, then the browser, then an upload", () => {
  assert.equal(chooseSpeech(true, true, false, true), "apple");
  assert.equal(chooseSpeech(false, true, false, true), "web");
  assert.equal(chooseSpeech(false, false, true, true), "none");
  assert.equal(chooseSpeech(false, false, false, true), "upload");
  assert.equal(chooseSpeech(false, false, false, false), "none");
});
