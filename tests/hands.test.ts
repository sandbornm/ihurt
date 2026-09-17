import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  classifyPose,
  describeGrabbers,
  formatHandLog,
  HandNavigator,
  recordHandEvent,
  resetHandLog,
  validHands,
} from "../src/anatomy/hands.ts";
import { applyHandDelta } from "../src/anatomy/motion.ts";

type Pt = { x: number; y: number };

function blank(x: number, y: number): Pt[] {
  return Array.from({ length: 21 }, () => ({ x, y }));
}

function setFinger(points: Pt[], mcp: number, length: number, curl: number) {
  const base = points[mcp];
  const reach = length * (1 - curl);
  points[mcp + 1] = { x: base.x + reach * 0.4, y: base.y + curl * 0.02 };
  points[mcp + 2] = { x: base.x + reach * 0.7, y: base.y + curl * 0.03 };
  points[mcp + 3] = { x: base.x + reach, y: base.y + curl * 0.02 };
}

function posed(
  x: number,
  y: number,
  curls: [number, number, number, number],
  thumb: Pt,
) {
  const points = blank(x, y);
  points[0] = { x, y };
  points[5] = { x: x + 0.04, y };
  points[9] = { x: x + 0.015, y };
  points[13] = { x: x - 0.015, y };
  points[17] = { x: x - 0.04, y };
  setFinger(points, 5, 0.12, curls[0]);
  setFinger(points, 9, 0.13, curls[1]);
  setFinger(points, 13, 0.12, curls[2]);
  setFinger(points, 17, 0.1, curls[3]);
  points[1] = { x: x - 0.02, y };
  points[2] = { x: x - 0.04, y };
  points[3] = { x: x - 0.06, y };
  points[4] = thumb;
  return points;
}

function openPalm(x: number, y: number) {
  return posed(x, y, [0, 0, 0, 0], { x: x - 0.1, y });
}

function fist(x: number, y: number) {
  return posed(x, y, [1, 1, 1, 1], { x: x + 0.02, y: y + 0.02 });
}

function pinched(x: number, y: number, gap: number) {
  const points = posed(x, y, [0, 0, 0, 0], { x, y });
  points[4] = { x: points[8].x - gap, y: points[8].y };
  return points;
}

function pointing(x: number, y: number, thumbGap = 0.12) {
  const points = posed(x, y, [0, 1, 1, 1], { x, y });
  points[4] = { x: points[8].x - thumbGap, y: points[8].y };
  return points;
}

test("open, fist, pinch, and point poses classify from landmarks", () => {
  assert.equal(classifyPose(openPalm(0.5, 0.5)), "open");
  assert.equal(classifyPose(fist(0.5, 0.5)), "fist");
  assert.equal(classifyPose(pinched(0.5, 0.5, 0.04)), "pinch");
  assert.equal(classifyPose(pointing(0.5, 0.5)), "point");
});

test("a half-closed hand with a small thumb gap does not zoom", () => {
  const half = posed(0.5, 0.5, [0, 0.55, 0.55, 0.55], { x: 0.5, y: 0.5 });
  half[4] = { x: half[8].x - 0.03, y: half[8].y };
  assert.notEqual(classifyPose(half), "pinch");
  const navigator = new HandNavigator();
  navigator.apply([half]);
  const moved = posed(0.5, 0.4, [0, 0.55, 0.55, 0.55], { x: 0.5, y: 0.4 });
  moved[4] = { x: moved[8].x - 0.03, y: moved[8].y };
  const motion = navigator.apply([moved]);
  if (motion) assert.equal(motion.zoom, 1);
});

test("a closing hand with a small thumb gap is a fist, not a pinch", () => {
  const closing = posed(0.5, 0.5, [0.7, 0.85, 0.9, 0.85], {
    x: 0.53,
    y: 0.52,
  });
  assert.equal(classifyPose(closing), "fist");
  const navigator = new HandNavigator();
  navigator.apply([closing]);
  const motion = navigator.apply([
    posed(0.62, 0.5, [0.7, 0.85, 0.9, 0.85], { x: 0.65, y: 0.52 }),
  ]);
  assert.ok(motion);
  assert.equal(motion.zoom, 1);
  assert.ok(motion.rotateX > 0.05);
});

test("pointing still aims when one other finger is only partly curled", () => {
  const sloppy = posed(0.4, 0.45, [0, 0.9, 0.4, 0.85], { x: 0.4, y: 0.45 });
  sloppy[4] = { x: sloppy[8].x - 0.12, y: sloppy[8].y };
  assert.equal(classifyPose(sloppy), "point");
});

test("a short unknown flicker does not drop a pointing pose", () => {
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.4, 0.45)]);
  assert.equal(navigator.currentPose(), "point");
  const messy = posed(0.4, 0.45, [0.2, 0.5, 0.5, 0.5], { x: 0.35, y: 0.45 });
  navigator.apply([messy]);
  assert.equal(navigator.currentPose(), "point");
});

test("rest and zoom do not fill the hands log every frame", () => {
  resetHandLog();
  const navigator = new HandNavigator();
  for (let i = 0; i < 8; i++) navigator.apply([openPalm(0.5, 0.5)]);
  navigator.apply([fist(0.35, 0.5), fist(0.65, 0.5)]);
  navigator.apply([fist(0.3, 0.5), fist(0.7, 0.5)]);
  navigator.apply([fist(0.28, 0.5), fist(0.72, 0.5)]);
  const lines = formatHandLog().split("\n").filter(Boolean);
  assert.ok(lines.length <= 4);
  assert.equal(lines.filter((line) => line.includes("\tidle")).length, 1);
});

test("a fist exits pointing and clears the aim", () => {
  assert.equal(classifyPose(fist(0.4, 0.45), "point"), "fist");
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.4, 0.45)]);
  navigator.apply([pointing(0.4, 0.45, 0.02)]);
  assert.ok(navigator.aim());
  navigator.apply([fist(0.4, 0.45)]);
  assert.equal(navigator.currentPose(), "fist");
});

test("opening a pointed hand into a real fist with the thumb out can turn", () => {
  const thumbOut = posed(0.4, 0.5, [1, 1, 1, 1], { x: 0.28, y: 0.5 });
  assert.equal(classifyPose(thumbOut, "point"), "fist");
});

test("no hands and tiny jitters do not move the camera", () => {
  const navigator = new HandNavigator();
  assert.equal(navigator.apply([]), null);
  navigator.apply([fist(0.5, 0.5)]);
  const jitter = navigator.apply([fist(0.502, 0.501)]);
  assert.equal(jitter, null);
});

test("an open hand sliding does not turn the body", () => {
  const navigator = new HandNavigator();
  assert.equal(navigator.apply([openPalm(0.4, 0.5)]), null);
  assert.equal(navigator.apply([openPalm(0.55, 0.5)]), null);
});

test("a closed fist sliding turns the body, and does not zoom", () => {
  const navigator = new HandNavigator();
  assert.equal(navigator.apply([fist(0.4, 0.5)]), null);
  const motion = navigator.apply([fist(0.55, 0.5)]);
  assert.ok(motion);
  assert.ok(motion.rotateX > 0.1);
  assert.equal(motion.zoom, 1);
  assert.equal(motion.panX, 0);
});

test("a fist with a small thumb-index gap still turns, and does not zoom", () => {
  const navigator = new HandNavigator();
  const closed = fist(0.4, 0.5);
  const moved = fist(0.55, 0.5);
  assert.ok(
    Math.hypot(closed[4].x - closed[8].x, closed[4].y - closed[8].y) < 0.08,
  );
  navigator.apply([closed]);
  const motion = navigator.apply([moved]);
  assert.ok(motion);
  assert.ok(motion.rotateX > 0.1);
  assert.equal(motion.zoom, 1);
});

test("one hand pinching does not zoom", () => {
  const navigator = new HandNavigator();
  navigator.apply([pinched(0.5, 0.5, 0.05)]);
  const motion = navigator.apply([pinched(0.5, 0.5, 0.03)]);
  if (motion) assert.equal(motion.zoom, 1);
});

test("two fists pulling apart zoom in, and do not turn or pan", () => {
  const navigator = new HandNavigator();
  navigator.apply([fist(0.35, 0.5), fist(0.65, 0.5)]);
  const motion = navigator.apply([fist(0.25, 0.5), fist(0.75, 0.5)]);
  assert.ok(motion);
  assert.ok(motion.zoom > 1);
  assert.equal(motion.rotateX, 0);
  assert.equal(motion.panX, 0);
});

test("one fist held still and the other pulling zooms", () => {
  const navigator = new HandNavigator();
  navigator.apply([fist(0.35, 0.5), fist(0.65, 0.5)]);
  const motion = navigator.apply([fist(0.35, 0.5), fist(0.8, 0.5)]);
  assert.ok(motion);
  assert.ok(motion.zoom > 1);
  assert.equal(motion.rotateX, 0);
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

test("a fist plus an open palm turns instead of panning", () => {
  const navigator = new HandNavigator();
  navigator.apply([fist(0.3, 0.5), openPalm(0.7, 0.5)]);
  const motion = navigator.apply([fist(0.45, 0.5), openPalm(0.7, 0.5)]);
  assert.ok(motion);
  assert.ok(motion.rotateX > 0.1);
  assert.equal(motion.panX, 0);
  assert.equal(motion.panY, 0);
  assert.equal(motion.zoom, 1);
});

test("a moving closed pinch turns instead of zooming", () => {
  const navigator = new HandNavigator();
  navigator.apply([pinched(0.4, 0.5, 0.04)]);
  const motion = navigator.apply([pinched(0.55, 0.5, 0.035)]);
  assert.ok(motion);
  assert.equal(motion.zoom, 1);
  assert.ok(motion.rotateX > 0.1);
});

test("pointing still aims after a pinch and a two-hand pan", () => {
  const navigator = new HandNavigator();
  navigator.apply([pinched(0.5, 0.5, 0.05)]);
  navigator.apply([pinched(0.5, 0.5, 0.03)]);
  navigator.apply([openPalm(0.3, 0.4), openPalm(0.7, 0.4)]);
  navigator.apply([openPalm(0.3, 0.58), openPalm(0.7, 0.58)]);
  navigator.apply([pointing(0.4, 0.45)]);
  assert.equal(navigator.currentPose(), "point");
  navigator.apply([pointing(0.4, 0.45, 0.02)]);
  assert.ok(navigator.aim());
});

test("a pointing hand still aims when a second open palm is in frame", () => {
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.4, 0.45), openPalm(0.75, 0.5)]);
  const aim = navigator.aim();
  assert.ok(aim);
  navigator.apply([pointing(0.4, 0.45, 0.02), openPalm(0.75, 0.5)]);
  assert.ok(navigator.aim());
});

test("a short hand and a vanished hand reset instead of jumping", () => {
  const navigator = new HandNavigator();
  navigator.apply([fist(0.2, 0.2)]);
  assert.equal(navigator.apply([[{ x: 0.5, y: 0.5 }]]), null);
  assert.equal(navigator.apply([]), null);
  assert.equal(navigator.apply([]), null);
  navigator.apply([fist(0.8, 0.8)]);
  assert.equal(navigator.apply([]), null);
  assert.equal(navigator.apply([]), null);
  assert.equal(navigator.apply([]), null);
  assert.equal(navigator.apply([fist(0.5, 0.5)]), null);
});

test("opening the hand after a turn does not jump the camera", () => {
  const navigator = new HandNavigator();
  navigator.apply([fist(0.4, 0.5)]);
  navigator.apply([fist(0.55, 0.5)]);
  assert.equal(navigator.apply([openPalm(0.55, 0.5)]), null);
  assert.equal(navigator.apply([openPalm(0.7, 0.5)]), null);
});

test("grabbers follow each hand, mirrored, and name the current action", () => {
  assert.deepEqual(describeGrabbers([]), []);
  const rest = describeGrabbers([openPalm(0.2, 0.4)]);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].mode, "rest");
  assert.ok(Math.abs(rest[0].x - 0.8) < 0.02);
  assert.ok(Math.abs(rest[0].y - 0.4) < 0.02);
  const turned = describeGrabbers([fist(0.2, 0.4)]);
  assert.equal(turned[0].mode, "turn");
  const pinchedHand = describeGrabbers([pinched(0.5, 0.5, 0.04)]);
  assert.equal(pinchedHand[0].mode, "turn");
  const zoomed = describeGrabbers([fist(0.3, 0.5), fist(0.7, 0.5)]);
  assert.equal(zoomed.length, 2);
  assert.equal(zoomed[0].mode, "zoom");
  assert.equal(zoomed[1].mode, "zoom");
  const aimed = describeGrabbers([pointing(0.3, 0.4)]);
  assert.equal(aimed[0].mode, "point");
  assert.ok(Math.abs(aimed[0].x - (1 - pointing(0.3, 0.4)[8].x)) < 0.02);
  const sliding = describeGrabbers([openPalm(0.3, 0.4), openPalm(0.7, 0.5)]);
  assert.equal(sliding.length, 2);
  assert.equal(sliding[0].mode, "slide");
  assert.equal(sliding[1].mode, "slide");
  assert.ok(sliding[0].x > sliding[1].x);
});

test("a fist ends a pointing slide", () => {
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.3, 0.4)]);
  navigator.apply([pointing(0.55, 0.4)]);
  const thumbOut = posed(0.4, 0.5, [1, 1, 1, 1], { x: 0.28, y: 0.5 });
  navigator.apply([thumbOut]);
  assert.equal(navigator.currentPose(), "fist");
});

test("a hands log records pose and action for later tuning", () => {
  resetHandLog();
  recordHandEvent({
    pose: "fist",
    mode: "turn",
    action: "turn",
    x: 0.4,
    y: 0.5,
  });
  recordHandEvent({
    pose: "point",
    mode: "point",
    action: "tap",
    x: 0.6,
    y: 0.4,
  });
  const text = formatHandLog();
  assert.match(text, /fist\tturn\tturn/);
  assert.match(text, /point\tpoint\ttap/);
  resetHandLog();
  assert.equal(formatHandLog(), "");
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

test("losing tracking clears the aim and grabbers", () => {
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.4, 0.45, 0.02)]);
  navigator.apply([pointing(0.4, 0.45)]);
  navigator.apply([]);
  assert.equal(navigator.aim(), null);
  assert.deepEqual(navigator.grabbers(), []);
  navigator.apply([pointing(0.4, 0.45, 0.02)]);
});

test("point recognition follows hand size rather than camera distance", () => {
  for (const scale of [0.4, 1, 1.8]) {
    const resize = (hand: Pt[]) =>
      hand.map((p) => ({
        x: 0.5 + (p.x - 0.5) * scale,
        y: 0.5 + (p.y - 0.5) * scale,
      }));
    const navigator = new HandNavigator();
    navigator.apply([resize(pointing(0.4, 0.45))]);
    navigator.apply([resize(pointing(0.4, 0.45, 0.02))]);
    assert.ok(navigator.aim());
  }
});

test("invalid and collapsed landmarks are discarded", () => {
  const invalid = pointing(0.4, 0.45);
  invalid[8].x = NaN;
  assert.deepEqual(validHands([null, [], invalid, blank(0.5, 0.5)]), []);
  assert.equal(classifyPose(invalid), "unknown");
  assert.equal(
    validHands([fist(0.2, 0.4), fist(0.5, 0.4), fist(0.8, 0.4)]).length,
    2,
  );
});

test("the aiming cursor smooths jitter and the visible grabber follows it", () => {
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.4, 0.45)], 1000);
  const first = navigator.aim()!;
  navigator.apply([pointing(0.41, 0.46)], 1040);
  const next = navigator.aim()!;
  assert.ok(Math.abs(next.x - first.x) < 0.01);
  assert.ok(Math.abs(next.x - first.x) > 0.002);
  assert.equal(navigator.grabbers()[0].x, next.x);
  assert.equal(navigator.grabbers()[0].y, next.y);
  navigator.apply([], 1080);
  navigator.apply([pointing(0.2, 0.3)], 1120);
  assert.ok(
    Math.abs(navigator.aim()!.x - (1 - pointing(0.2, 0.3)[8].x)) < 1e-6,
  );
});

test("two fists can zoom immediately after pointing", () => {
  const navigator = new HandNavigator();
  navigator.apply([pointing(0.4, 0.45)]);
  navigator.apply([fist(0.3, 0.5), fist(0.7, 0.5)]);
  const delta = navigator.apply([fist(0.2, 0.5), fist(0.8, 0.5)]);
  assert.ok(delta && delta.zoom > 1);
});
