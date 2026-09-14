import test from "node:test";
import assert from "node:assert/strict";
import { serviceWorkerSource } from "../scripts/offline-build.mjs";

test("offline worker caches misses and can finish after the first load", () => {
  const source = serviceWorkerSource("ihurt-static-test", [
    "/index.html",
    "/models/muscular.glb",
  ]);
  assert.match(source, /ensure-cache/);
  assert.match(source, /cache\.put\(path, response\.clone\(\)\)/);
  assert.match(source, /skipWaiting/);
  assert.match(source, /path\.endsWith\("\.glb"\)/);
  assert.match(source, /startsWith\("\/mediapipe\/"\)/);
});
