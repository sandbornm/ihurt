import { test } from "node:test";
import assert from "node:assert/strict";
import { PinGesture } from "../src/anatomy/gesture.ts";

test("a primary tap places a pin", () => {
  const g = new PinGesture();
  g.down(1, 10, 10);
  assert.equal(g.up(1, 12, 11, 0), true);
});
test("a drag returning to its start does not place a pin", () => {
  const g = new PinGesture();
  g.down(1, 10, 10);
  g.move(1, 90, 90);
  assert.equal(g.up(1, 10, 10, 0), false);
});
test("right-click and multi-touch do not place pins", () => {
  const g = new PinGesture();
  g.down(1, 10, 10);
  assert.equal(g.up(1, 10, 10, 2), false);
  g.down(1, 10, 10);
  g.down(2, 20, 20);
  assert.equal(g.up(1, 10, 10, 0), false);
  assert.equal(g.up(2, 20, 20, 0), false);
});
test("a canceled gesture does not place a pin and the next tap works", () => {
  const g = new PinGesture();
  g.down(1, 10, 10);
  g.cancel(1);
  assert.equal(g.up(1, 10, 10, 0), false);
  g.down(2, 10, 10);
  assert.equal(g.up(2, 10, 10, 0), true);
});

test("losing focus clears all pointers and allows a fresh tap", () => {
  const g = new PinGesture();
  g.down(1, 10, 10);
  g.down(2, 20, 20);
  g.reset();
  assert.equal(g.up(1, 10, 10, 0), false);
  g.down(3, 10, 10);
  assert.equal(g.up(3, 10, 10, 0), true);
});
test("lifting one finger never turns the rest of a pinch into a pin", () => {
  const g = new PinGesture();
  g.down(1, 10, 10);
  g.down(2, 20, 20);
  assert.equal(g.up(2, 20, 20, 0), false);
  g.move(1, 30, 30);
  assert.equal(g.up(1, 30, 30, 0), false);
  g.down(1, 30, 30);
  assert.equal(g.up(1, 30, 30, 0), true);
});
