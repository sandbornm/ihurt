import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { advanceCamera } from "../src/anatomy/motion.ts";

test("camera travel agrees at 30, 60, and 144 frames per second", () => {
  const positions = [30, 60, 144].map((fps) => {
    const position = new Vector3(0, 0, 10);
    const look = new Vector3();
    for (let frame = 0; frame < fps / 2; frame++)
      advanceCamera(
        position,
        look,
        new Vector3(0, 2, 3),
        new Vector3(0, 2, 0),
        1 / fps,
        false,
      );
    return { position, look };
  });
  for (const state of positions.slice(1)) {
    assert.ok(state.position.distanceTo(positions[0].position) < 1e-10);
    assert.ok(state.look.distanceTo(positions[0].look) < 1e-10);
  }
});

test("reduced motion reaches both targets without waiting for a frame", () => {
  const position = new Vector3(0, 0, 10);
  const look = new Vector3();
  const target = new Vector3(0, 2, -3);
  const targetLook = new Vector3(0, 2, 0);
  assert.equal(
    advanceCamera(position, look, target, targetLook, 0, true),
    false,
  );
  assert.deepEqual(position, target);
  assert.deepEqual(look, targetLook);
});

test("camera keeps easing until its look target arrives, then settles exactly", () => {
  const position = new Vector3();
  const look = new Vector3(0, 2, 0);
  const target = new Vector3();
  assert.equal(
    advanceCamera(position, look, target, target, 1 / 60, false),
    true,
  );
  let moving = true;
  for (let frame = 0; frame < 180 && moving; frame++)
    moving = advanceCamera(position, look, target, target, 1 / 60, false);
  assert.equal(moving, false);
  assert.deepEqual(look, target);
});

test("a long frame gap cannot jump straight to the target", () => {
  const position = new Vector3(0, 0, 10);
  const target = new Vector3();
  assert.equal(
    advanceCamera(position, new Vector3(), target, target, 30, false),
    true,
  );
  assert.ok(position.z > 7 && position.z < 10);
});
