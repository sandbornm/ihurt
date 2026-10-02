import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError } from "../src/api.ts";

test("web API retains same-origin sessions and JSON requests", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (path: string, options: RequestInit) => {
      assert.equal(path, "/api/map");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.method, "POST");
      assert.equal(options.body, JSON.stringify({ note: "Example note" }));
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      return Response.json({ activity_id: "example" });
    },
  );
  assert.deepEqual(await api("map", { note: "Example note" }), {
    activity_id: "example",
  });
});

test("web uploads retain multipart encoding and caller cancellation", async (t) => {
  const form = new FormData();
  const signal = new AbortController().signal;
  t.mock.method(
    globalThis,
    "fetch",
    async (_path: string, options: RequestInit) => {
      assert.equal(options.body, form);
      assert.equal(options.headers, undefined);
      assert.equal(options.signal, signal);
      return Response.json({ text: "Example words" });
    },
  );
  assert.deepEqual(await api("transcribe", form, signal), {
    text: "Example words",
  });
});

test("static-host HTML and malformed success responses do not masquerade as API data", async (t) => {
  for (const body of [
    "<!doctype html><title>Notebook</title>",
    "null",
    "[]",
    '"text"',
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(body),
    );
    await assert.rejects(api("session"), /unreadable response/);
    mock.mock.restore();
  }
});

test("server errors retain quota context and tolerate non-JSON error bodies", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { detail: "Allowance reached", activity_id: "example", remaining: 0 },
      { status: 429 },
    ),
  );
  await assert.rejects(api("map", {}), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, "Allowance reached");
    assert.equal(error.activityId, "example");
    assert.equal(error.remaining, 0);
    return true;
  });
  mock.mock.restore();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("unavailable", { status: 503 }),
  );
  await assert.rejects(api("session"), /server could not complete/);
});
