import test from "node:test";
import assert from "node:assert/strict";
import {
  HandEntryGesture,
  thumbsUp,
  type HandEntryAction,
} from "../src/anatomy/hand-entry.ts";
import { classifyPose, type Landmark } from "../src/anatomy/hands.ts";

function hand(curl = false): Landmark[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  for (const [base, x] of [
    [5, 0.54],
    [9, 0.515],
    [13, 0.485],
    [17, 0.46],
  ]) {
    points[base] = { x, y: 0.5 };
    for (let joint = 1; joint <= 3; joint++)
      points[base + joint] = {
        x,
        y: curl ? 0.53 : 0.5 - joint * 0.04,
      };
  }
  points[3] = { x: 0.42, y: 0.56 };
  points[4] = { x: 0.39, y: 0.52 };
  return points;
}

function pinch() {
  const points = hand();
  points[4] = { x: points[8].x - 0.02, y: points[8].y };
  return points;
}

function thumbs() {
  const points = hand(true);
  points[3] = { x: 0.45, y: 0.47 };
  points[4] = { x: 0.45, y: 0.36 };
  return points;
}

function rotate(points: Landmark[], degrees: number) {
  const angle = (-degrees * Math.PI) / 180;
  return points.map((point) => ({
    x:
      0.5 +
      (point.x - 0.5) * Math.cos(angle) -
      (point.y - 0.5) * Math.sin(angle),
    y:
      0.5 +
      (point.x - 0.5) * Math.sin(angle) +
      (point.y - 0.5) * Math.cos(angle),
  }));
}

function setup() {
  const flow = new HandEntryGesture();
  let now = 0,
    intensity: number | null = null;
  const actions: HandEntryAction[] = [];
  const frame = (
    options: Partial<Parameters<HandEntryGesture["frame"]>[0]> = {},
  ) => {
    now += 50;
    const action = flow.frame({
      hand: hand(),
      pose: "point",
      point: { x: 0.5, y: 0.4 },
      target: { key: "example-muscle", label: "Example muscle" },
      intensity,
      now,
      ...options,
    });
    if (action) actions.push(action);
    if (action?.type === "intensity") intensity = action.value;
    if (action?.type === "pin")
      flow.pinned({ id: "example-pin", label: "Example muscle" });
    return action;
  };
  const repeat = (
    frames: number,
    options: Parameters<typeof frame>[0] = {},
  ) => {
    for (let count = 0; count < frames; count++) frame(options);
  };
  return { flow, frame, repeat, actions, intensity: () => intensity };
}

test("point and hold pins a real target once, without a thumb tap", () => {
  const session = setup();
  session.repeat(19);
  assert.equal(session.actions.length, 0);
  assert.ok(session.flow.state.progress > 0.8);
  session.repeat(30);
  assert.equal(
    session.actions.filter((action) => action.type === "pin").length,
    1,
  );
  assert.equal(session.flow.state.phase, "rate");
  assert.equal(session.intensity(), null);
});

test("moving, leaving the surface, and changing targets restart the hold", () => {
  for (const interruption of [
    { point: { x: 0.7, y: 0.4 } },
    { target: null },
    { target: { key: "another-muscle", label: "Another muscle" } },
    { pose: "fist" as const },
  ]) {
    const session = setup();
    session.repeat(15);
    session.frame(interruption);
    session.repeat(10);
    assert.equal(session.actions.length, 0);
  }
});

test("tracking loss and long frame gaps cannot complete a pending hold", () => {
  const session = setup();
  session.repeat(15);
  session.frame({ hand: null });
  session.repeat(10);
  assert.equal(session.actions.length, 0);
  session.frame({ now: 9000 });
  assert.equal(session.actions.length, 0);
  assert.equal(session.flow.state.progress, 0);
});

test("pinching alone and dial jitter leave intensity unrated", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame({ hand: pinch() });
  for (const degrees of [2, -2, 3, 0, -3, 0])
    session.frame({ hand: rotate(pinch(), degrees) });
  assert.equal(session.intensity(), null);
  assert.equal(session.actions.length, 0);
});

test("clockwise increases, counterclockwise decreases, and release allows regripping", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame({ hand: pinch() });
  for (const degrees of [18, 36, 54])
    session.frame({ hand: rotate(pinch(), degrees) });
  assert.equal(session.intensity(), 3);
  session.frame({ hand: hand() });
  session.frame({ hand: rotate(pinch(), -90) });
  assert.equal(session.intensity(), 3);
  session.frame({ hand: rotate(pinch(), -108) });
  assert.equal(session.intensity(), 2);
  assert.equal(
    session.actions.some((action) => action.type === "save"),
    false,
  );
});

test("the dial stays between zero and ten and handles the angle wrap", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame({ hand: rotate(pinch(), 170) });
  for (let degrees = 188; degrees <= 458; degrees += 18)
    session.frame({ hand: rotate(pinch(), degrees) });
  assert.equal(session.intensity(), 10);
  for (let degrees = 440; degrees >= 80; degrees -= 18)
    session.frame({ hand: rotate(pinch(), degrees) });
  assert.equal(session.intensity(), 0);
});

test("a tracking jump and a lost hand do not change the dial", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame({ hand: pinch(), intensity: 5 });
  assert.equal(
    session.frame({ hand: rotate(pinch(), 100), intensity: 5 }),
    null,
  );
  session.frame({ hand: null });
  assert.equal(
    session.frame({ hand: rotate(pinch(), -40), intensity: 5 }),
    null,
  );
});

test("thumbs-up is distinct from an ordinary closed fist", () => {
  assert.equal(classifyPose(hand(true)), "fist");
  assert.equal(thumbsUp(hand(true)), false);
  assert.equal(thumbsUp(thumbs()), true);
  assert.equal(thumbsUp(hand()), false);
});

test("a deliberate thumbs-up saves once and waits for confirmed storage success", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame();
  session.repeat(17, { hand: thumbs() });
  assert.equal(session.actions.length, 0);
  session.repeat(20, { hand: thumbs() });
  assert.deepEqual(session.actions, [{ type: "save" }]);
  assert.equal(session.flow.state.phase, "saving");
  session.flow.saved(true);
  assert.equal(session.flow.state.phase, "saved");
  session.repeat(25, { hand: thumbs() });
  assert.equal(session.actions.length, 1);
  session.repeat(8, { hand: hand(), pose: "open" });
  assert.equal(session.flow.state.phase, "aim");
});

test("a lost thumbs-up must be released before saving can resume", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame();
  session.repeat(10, { hand: thumbs() });
  session.frame({ hand: null });
  session.repeat(25, { hand: thumbs() });
  assert.equal(session.actions.length, 0);
  session.frame({ hand: hand() });
  session.repeat(20, { hand: thumbs() });
  assert.deepEqual(session.actions, [{ type: "save" }]);
});

test("a failed save retains the pin and requires a fresh gesture to retry", () => {
  const session = setup();
  session.flow.pinned({ id: "example-pin", label: "Example" });
  session.frame();
  session.repeat(20, { hand: thumbs() });
  session.flow.saved(false);
  assert.equal(session.flow.state.phase, "rate");
  assert.equal(session.flow.state.pin?.id, "example-pin");
  assert.match(session.flow.state.hint, /Could not save/);
  session.repeat(25, { hand: thumbs() });
  assert.equal(session.actions.length, 1);
  session.frame();
  session.repeat(20, { hand: thumbs() });
  assert.equal(session.actions.length, 2);
});
