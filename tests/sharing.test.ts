import test from "node:test";
import assert from "node:assert/strict";
import { exampleEntry } from "../src/example.ts";
import { finishEntry, parseNotebook } from "../src/notebook-data.ts";
import { stringifyIhm } from "../src/export.ts";
import {
  defaultSharing,
  prepareSharedEntry,
  sharedSummary,
} from "../src/sharing/share-data.ts";

test("sharing choices remove copied observations without changing the saved entry", () => {
  const entry = finishEntry(exampleEntry());
  entry.note = entry.map.summary = entry.map.title = "Example private note";
  entry.points![0].comment = "Example private comment";
  entry.ai = {
    provider: "Example AI",
    created: entry.created,
    based_on: "Example private note",
    answers: [],
    map: { ...entry.map },
  };
  entry.research = {
    activity: "Tennis",
    description: "Example private note",
    regions: entry.map.regions,
    checked: entry.created,
    references: [],
  };
  const before = structuredClone(entry);
  const shared = prepareSharedEntry(entry, {
    ...defaultSharing,
    notes: false,
    comments: false,
    ai: true,
  });
  const json = stringifyIhm(shared);
  assert.ok(!json.includes("Example private"));
  assert.equal(shared.ai, undefined);
  assert.equal(shared.research, undefined);
  assert.deepEqual(entry, before);
  assert.deepEqual(
    parseNotebook(json)[0].points?.[0].position,
    entry.points![0].position,
  );
});

test("AI output is opt-in and is kept separate from author observations", () => {
  const entry = finishEntry(exampleEntry());
  entry.ai = {
    provider: "Example AI",
    created: entry.created,
    based_on: "example",
    answers: [],
    map: { ...entry.map, summary: "Example interpretation" },
  };
  assert.equal(prepareSharedEntry(entry, defaultSharing).ai, undefined);
  const shared = prepareSharedEntry(entry, { ...defaultSharing, ai: true });
  assert.equal(shared.ai?.map.summary, "Example interpretation");
  assert.ok(sharedSummary(shared).includes("Separate AI interpretation"));
});

test("text sharing keeps zero intensity, comments and source attribution", () => {
  const entry = finishEntry(exampleEntry());
  entry.map.intensity = 0;
  entry.points![0].comment = "Example observation";
  entry.references = [
    {
      title: "Example reading",
      publisher: "Example publisher",
      url: "https://example.org/reading",
      checked: "2026-09-16",
    },
  ];
  const summary = sharedSummary(prepareSharedEntry(entry, defaultSharing));
  assert.ok(summary.includes("Reported intensity: 0/10"));
  assert.ok(summary.includes("Example observation"));
  assert.ok(summary.includes("https://example.org/reading"));
  assert.ok(summary.includes("Checked: 2026-09-16"));
  assert.deepEqual(
    prepareSharedEntry(entry, { ...defaultSharing, sources: false }).references,
    [],
  );
});
