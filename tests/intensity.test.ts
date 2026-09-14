import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Color, Float32BufferAttribute, Matrix4, Vector3 } from "three";
import { intensityColor } from "../src/anatomy/intensity.ts";
import { fallbackHeat, paintHeat, samplesNear } from "../src/anatomy/heat.ts";
test("intensity colors go from cool to warm and keep unrated separate", () => {
  assert.equal(intensityColor(null), "#c4ed76");
  assert.equal(intensityColor(0), "#62baf0");
  assert.equal(intensityColor(10), "#ed5b44");
  assert.equal(intensityColor(-2), intensityColor(0));
  assert.equal(intensityColor(12), intensityColor(10));
  assert.notEqual(intensityColor(5), intensityColor(10));
});
test("heat painting tints nearby vertices and leaves distant ones on the base", () => {
  const positions = new Float32BufferAttribute([0, 0, 0, 8, 8, 8], 3);
  const colors = new Float32BufferAttribute([0.4, 0.4, 0.4, 0.4, 0.4, 0.4], 3);
  const base = new Color("#666666");
  paintHeat(
    positions,
    colors,
    new Matrix4(),
    base,
    false,
    [{ position: [0, 0, 0], radius: 0.27 }],
    null,
    10,
    fallbackHeat,
  );
  assert.ok(colors.getX(0) > colors.getX(1) + 0.2);
  assert.ok(Math.abs(colors.getX(1) - base.r) < 0.02);
});
test("heat samples skip volumes that cannot reach a mesh", () => {
  const bounds = new Box3(
    new Vector3(-0.1, -0.1, -0.1),
    new Vector3(0.1, 0.1, 0.1),
  );
  const nearby = samplesNear(
    [
      { position: [0, 0, 0], radius: 0.27 },
      { position: [4, 4, 4], radius: 0.27 },
    ],
    bounds,
  );
  assert.equal(nearby.length, 1);
  assert.deepEqual(nearby[0].position, [0, 0, 0]);
});
