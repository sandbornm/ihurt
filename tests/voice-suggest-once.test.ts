import assert from "node:assert/strict";
import test from "node:test";
import { createSuggestOnce } from "../src/voice/suggest-once.ts";

test("suggests at most once when stop and the end callback both deliver", () => {
  const once = createSuggestOnce();
  const stop = once.deliver(1, 1, "my left knee hurts");
  const end = once.deliver(1, 1, "my left knee hurts");
  assert.equal(stop, "my left knee hurts");
  assert.equal(end, undefined);
});

test("an empty or whitespace-only final transcript does not suggest", () => {
  const once = createSuggestOnce();
  assert.equal(once.deliver(1, 1, ""), undefined);
  assert.equal(once.deliver(1, 1, " \n\t "), undefined);
});

test("a late final after cancel or unmount does not suggest", () => {
  const once = createSuggestOnce();
  assert.equal(once.deliver(1, 2, "my left knee hurts"), undefined);
});

test("a new recording generation can suggest again", () => {
  const once = createSuggestOnce();
  assert.equal(once.deliver(1, 1, "first note"), "first note");
  assert.equal(once.deliver(2, 2, "second note"), "second note");
});

test("a blank final does not block a later real one from the same recording", () => {
  const once = createSuggestOnce();
  assert.equal(once.deliver(1, 1, "  "), undefined);
  assert.equal(once.deliver(1, 1, "my left knee hurts"), "my left knee hurts");
  assert.equal(once.deliver(1, 1, "my left knee hurts"), undefined);
});

test("the suggested transcript is capped at 3000 characters", () => {
  const once = createSuggestOnce();
  assert.equal(once.deliver(1, 1, "a".repeat(3500))?.length, 3000);
});
