import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../src/api.ts";
import { configureNativeExports } from "../src/platform/files.ts";

test("the packaged iOS app never sends local API requests, even if a caller reaches the web client", async (t) => {
  configureNativeExports({
    async write() {
      throw new Error("Unexpected export");
    },
    async share() {
      throw new Error("Unexpected share");
    },
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  await assert.rejects(api("session"), /On iOS/);
  await assert.rejects(api("map", { note: "Example note" }), /On iOS/);
  await assert.rejects(api("transcribe", new FormData()), /On iOS/);
  assert.equal(fetch.mock.callCount(), 0);
});
