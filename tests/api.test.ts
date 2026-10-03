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
      assert.equal(options.signal?.aborted, false);
      return Response.json({ text: "Example words" });
    },
  );
  assert.deepEqual(await api("transcribe", form, signal), {
    text: "Example words",
  });
});

test("caller cancellation stops an in-flight request", async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    (_path: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener("abort", () =>
          reject(options.signal!.reason),
        );
      }),
  );
  const pending = api("map", {}, controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
});

test("a caller signal does not disable the deadline, including while reading the body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const waitingForBody of [false, true]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      (_path: string, options: RequestInit) => {
        const stalled = () =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener("abort", () =>
              reject(options.signal!.reason),
            );
          });
        return waitingForBody
          ? Promise.resolve({ ok: true, json: stalled })
          : stalled();
      },
    );
    const pending = api("map", {}, new AbortController().signal);
    const rejected = assert.rejects(pending, { name: "TimeoutError" });
    await Promise.resolve(); // Let fetch resolve before advancing the body deadline.
    t.mock.timers.tick(135000);
    await rejected;
    mock.mock.restore();
  }
});

test("already-cancelled calls never fetch and completed calls release cancellation listeners", async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ok: true }),
  );
  const remove = t.mock.method(controller.signal, "removeEventListener");
  await api("session", undefined, controller.signal);
  assert.equal(remove.mock.callCount(), 1);
  controller.abort();
  await assert.rejects(api("session", undefined, controller.signal), {
    name: "AbortError",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("completed requests clear their deadline and preserve explicit falsy JSON bodies", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_path: string, options: RequestInit) => {
      assert.equal(options.method, "POST");
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      signals.push(options.signal!);
      return Response.json({ received: JSON.parse(options.body as string) });
    },
  );
  for (const body of [false, 0, null])
    assert.deepEqual(await api("map", body), { received: body });
  t.mock.timers.tick(135000);
  assert.ok(signals.every((signal) => !signal.aborted));
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
