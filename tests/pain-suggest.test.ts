import test from "node:test";
import assert from "node:assert/strict";
import { regions } from "../src/types.ts";
import {
  advisoryCopy,
  highlightIds,
  painCatalog,
  plainText,
  readSuggestion,
  regionLabel,
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
  assert.equal(advisoryCopy([]), null);
  assert.equal(
    plainText("<img src=x onerror=alert(1)> left shoulder"),
    "left shoulder",
  );
  assert.equal(plainText("pain < 5 > minutes").includes("<"), false);
});

test("suggestions below 0.5 or outside the catalog do not highlight a region", () => {
  const parsed = readSuggestion({
    regions: [
      {
        id: "left_deltoid",
        anatomy_id: "left_shoulder",
        side: "right",
        name: "<b>Left deltoid</b>",
        confidence: 0.82,
      },
      {
        id: "not_a_region",
        anatomy_id: "not_a_region",
        name: "<script>alert(1)</script>",
        confidence: 0.99,
      },
      {
        id: "right_knee",
        anatomy_id: "right_knee",
        name: "Right knee",
        confidence: 0.49,
      },
      {
        id: "left_deltoid",
        anatomy_id: "right_shoulder",
        name: "Wrong side",
        confidence: 0.95,
      },
    ],
    pain_type: { id: "sharp", label: "<i>Sharp</i>", confidence: 0.5 },
    severity: { id: "severe", label: "Severe", confidence: 0.49 },
    pain_level: { value: 6, confidence: 0.8 },
    triggers: [{ id: "movement", label: "<em>Movement</em>", confidence: 0.7 }],
    red_flags: [
      { id: "chest_pain", label: "<img>", confidence: 0.9 },
      { id: "breathing", label: "Trouble breathing", confidence: 0.2 },
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(highlightIds(parsed.regions), ["left_shoulder"]);
  assert.equal(regionLabel(parsed.regions![0].id), "Left deltoid");
  assert.equal(parsed.pain_type?.id, "sharp");
  assert.equal(parsed.severity, null);
  assert.equal(parsed.pain_level?.value, 6);
  assert.deepEqual(
    parsed.triggers?.map((item) => item.id),
    ["movement"],
  );
  assert.deepEqual(
    parsed.red_flags?.map((item) => item.id),
    ["chest_pain"],
  );
  assert.equal(JSON.stringify(parsed).includes("<"), false);
  assert.equal(readSuggestion(null), null);
  assert.deepEqual(highlightIds(null), []);
});

test("speech uses Apple, then the browser, then an upload", () => {
  assert.equal(chooseSpeech(true, true, false, true), "apple");
  assert.equal(chooseSpeech(false, true, false, true), "web");
  assert.equal(chooseSpeech(false, false, true, true), "none");
  assert.equal(chooseSpeech(false, false, false, true), "upload");
  assert.equal(chooseSpeech(false, false, false, false), "none");
});
