import assert from "node:assert/strict";
import test from "node:test";
import {
  reportPath,
  saveNativeExport,
  type ExportFile,
} from "../src/platform/files.ts";

const report: ExportFile = {
  name: "ihurt-map-2026-09-19.ihm",
  content: '{"example":true}',
  mimeType: "application/json",
};

test("native exports write the chosen content before sharing a local file", async () => {
  const calls: string[] = [];
  const message = await saveNativeExport(
    report,
    {
      async write(file, path) {
        assert.deepEqual(file, report);
        assert.equal(path, "Reports/ihurt-map-2026-09-19-one.ihm");
        calls.push("write");
        return "file:///example/report.ihm";
      },
      async share(uri) {
        assert.equal(uri, "file:///example/report.ihm");
        calls.push("share");
      },
    },
    "one",
  );
  assert.deepEqual(calls, ["write", "share"]);
  assert.match(message, /Saved in Files/);
  assert.notEqual(
    reportPath(report.name, "one"),
    reportPath(report.name, "two"),
  );
});

test("cancelling or failing to open sharing keeps the saved report accessible", async () => {
  assert.match(
    await saveNativeExport(report, {
      async write() {
        return "file:///example/report.ihm";
      },
      async share() {
        throw new Error("Share canceled");
      },
    }),
    /share it from there/,
  );
});

test("failed writes do not open sharing or claim that the file was saved", async () => {
  let shared = false;
  await assert.rejects(
    saveNativeExport(report, {
      async write() {
        throw new Error("Storage full");
      },
      async share() {
        shared = true;
      },
    }),
    /Storage full/,
  );
  assert.equal(shared, false);
});

test("export names cannot escape the reports directory", () => {
  for (const name of [
    "../secret.json",
    "/report.json",
    "a/b.json",
    "a\\b.json",
    "missing-extension",
    "bad..json",
  ])
    assert.throws(() => reportPath(name, "one"));
  assert.throws(() => reportPath(report.name, "../two"));
});
