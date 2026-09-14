import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { describeGrabbers, HandNavigator } from "../src/anatomy/hands.ts";
import { applyHandDelta } from "../src/anatomy/motion.ts";

function hand(overrides: Record<number, { x: number; y: number }> = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [index, point] of Object.entries(overrides))
    points[Number(index)] = point;
  return points;
}

function openPalm(x: number, y: number) {
  return hand({
    0: { x, y },
    5: { x: x + 0.04, y },
    17: { x: x - 0.04, y },
    4: { x: x - 0.12, y },
    8: { x: x + 0.12, y },
  });
}

function pinched(x: number, y: number, gap: number) {
  return hand({
    0: { x, y },
    5: { x: x + 0.03, y },
    17: { x: x - 0.03, y },
    4: { x, y },
    8: { x: x + gap, y },
  });
}

test("no hands and tiny jitters do not move the camera", () => {
  const navigator = new HandNavigator();
  assert.equal(navigator.apply([]), null);
  navigator.apply([openPalm(0.5, 0.5)]);
  const jitter = navigator.apply([openPalm(0.502, 0.501)]);
  assert.equal(jitter, null);
});

test("an open hand sliding sideways turns the body, and does not zoom", () => {
  const navigator = new HandNavigator();
  assert.equal(navigator.apply([openPalm(0.4, 0.5)]), null);
  const motion = navigator.apply([openPalm(0.55, 0.5)]);
  assert.ok(motion);
  assert.ok(motion.rotateX > 0.1);
  assert.equal(motion.zoom, 1);
  assert.equal(motion.panX, 0);
});

test("pinching in zooms in without rotating", () => {
  const navigator = new HandNavigator();
  assert.equal(navigator.apply([pinched(0.5, 0.5, 0.05)]), null);
  const motion = navigator.apply([pinched(0.5, 0.5, 0.03)]);
  assert.ok(motion);
  assert.ok(motion.zoom > 1);
  assert.equal(motion.rotateX, 0);
  assert.equal(motion.rotateY, 0);
});

test("two hands sliding together pan instead of turning", () => {
  const navigator = new HandNavigator();
  navigator.apply([openPalm(0.3, 0.4), openPalm(0.7, 0.4)]);
  const motion = navigator.apply([openPalm(0.3, 0.55), openPalm(0.7, 0.55)]);
  assert.ok(motion);
  assert.ok(Math.abs(motion.panY) > 0.05);
  assert.equal(motion.rotateX, 0);
  assert.equal(motion.zoom, 1);
});

test("a short hand and a vanished hand reset instead of jumping", () => {
  const navigator = new HandNavigator();
  navigator.apply([openPalm(0.2, 0.2)]);
  assert.equal(navigator.apply([[{ x: 0.5, y: 0.5 }]]), null);
  navigator.apply([openPalm(0.8, 0.8)]);
  assert.equal(navigator.apply([]), null);
  assert.equal(navigator.apply([openPalm(0.5, 0.5)]), null);
});

test("grabbers follow each hand, mirrored, and name the current action", () => {
  assert.deepEqual(describeGrabbers([]), []);
  const turned = describeGrabbers([openPalm(0.2, 0.4)]);
  assert.equal(turned.length, 1);
  assert.equal(turned[0].mode, "turn");
  assert.ok(Math.abs(turned[0].x - 0.8) < 0.02);
  assert.ok(Math.abs(turned[0].y - 0.4) < 0.02);
  const zoomed = describeGrabbers([pinched(0.5, 0.5, 0.04)]);
  assert.equal(zoomed[0].mode, "zoom");
  assert.ok(zoomed[0].pinch > 0.3);
  const sliding = describeGrabbers([openPalm(0.3, 0.4), openPalm(0.7, 0.5)]);
  assert.equal(sliding.length, 2);
  assert.equal(sliding[0].mode, "slide");
  assert.equal(sliding[1].mode, "slide");
  assert.ok(sliding[0].x > sliding[1].x);
});

test("hand deltas rotate, dolly and pan within the existing camera limits", () => {
  const position = new Vector3(0, 0.65, 10);
  const look = new Vector3(0, 0.4, 0);
  const cursor = new Vector3(0, 0.4, 0);
  const turned = applyHandDelta(position, look, {
    rotateX: 0.4,
    rotateY: 0,
    panX: 0,
    panY: 0,
    zoom: 1,
  });
  assert.ok(turned.position.x > position.x);
  const zoomed = applyHandDelta(position, look, {
    rotateX: 0,
    rotateY: 0,
    panX: 0,
    panY: 0,
    zoom: 2,
  });
  assert.ok(zoomed.position.distanceTo(look) < position.distanceTo(look));
  const panned = applyHandDelta(
    position,
    look,
    { rotateX: 0, rotateY: 0, panX: 0.5, panY: 0, zoom: 1 },
    { minDistance: 0.35, maxDistance: 13, maxTargetRadius: 4, cursor },
  );
  assert.ok(panned.look.distanceTo(look) > 0.1);
  const clamped = applyHandDelta(position, look, {
    rotateX: 0,
    rotateY: 0,
    panX: 0,
    panY: 0,
    zoom: 100,
  });
  assert.ok(clamped.position.distanceTo(clamped.look) >= 0.35);
});
