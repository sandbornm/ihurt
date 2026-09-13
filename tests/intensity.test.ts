import test from "node:test";
import assert from "node:assert/strict";
import { intensityColor } from "../src/anatomy/intensity.ts";
test("intensity colors go from cool to warm and keep unrated separate", () => {
  assert.equal(intensityColor(null), "#c4ed76");
  assert.equal(intensityColor(0), "#62baf0");
  assert.equal(intensityColor(10), "#ed5b44");
  assert.equal(intensityColor(-2), intensityColor(0));
  assert.equal(intensityColor(12), intensityColor(10));
  assert.notEqual(intensityColor(5), intensityColor(10));
});
