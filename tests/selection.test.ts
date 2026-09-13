import test from "node:test";
import assert from "node:assert/strict";
import { Object3D, Vector3, type Intersection } from "three";
import { nearbySurfaces } from "../src/anatomy/selection.ts";
test("layer picking deduplicates triangles and excludes distant surfaces", () => {
  const a = new Object3D(),
    b = new Object3D(),
    c = new Object3D();
  const hit = (object: Object3D, z: number): Intersection => ({
    object,
    point: new Vector3(0, 0, z),
    distance: 10 - z,
  });
  const choices = nearbySurfaces([
    hit(a, 0.2),
    hit(a, 0.19),
    hit(b, 0.1),
    hit(c, -0.9),
  ]);
  assert.deepEqual(
    choices.map((c) => c.object),
    [a, b],
  );
  assert.deepEqual(nearbySurfaces([]), []);
});
