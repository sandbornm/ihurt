import test from "node:test";
import assert from "node:assert/strict";
import {
  blankEntry,
  finishEntry,
  stringifyNotebook,
  parseNotebook,
  exportNotebook,
} from "../src/notebook-data.ts";
import { exampleEntry } from "../src/example.ts";
import { activityRegions } from "../src/activities.ts";
import { renderMapSvg } from "../src/export.ts";

test("notebook round trip preserves the original notes, pin comments and anatomy references", () => {
  const entry = finishEntry(exampleEntry());
  entry.points![0].source = {
    atlas: "z-anatomy-v1",
    layer: "muscle",
    asset: "muscular.glb",
    node_index: 1,
    mesh_name: "Example mesh",
  };
  const parsed = parseNotebook(stringifyNotebook([entry]))[0];
  assert.deepEqual(parsed.points, entry.points);
  assert.equal(parsed.note, entry.note);
  assert.deepEqual(parsed.map, entry.map);
  assert.equal(exportNotebook([parsed]).anatomy.models.length, 2);
});
test("activity suggestions never become reported locations", () => {
  const entry = blankEntry();
  entry.map.activity = "Tennis";
  assert.ok(activityRegions("Tennis").length);
  assert.deepEqual(finishEntry(entry).map.regions, []);
  entry.map.activity = "Competitive underwater basket weaving";
  assert.equal(
    parseNotebook(stringifyNotebook([entry]))[0].map.activity,
    entry.map.activity,
  );
});
test("import rejects incompatible models, malformed points and unsafe links", () => {
  const make = () =>
    JSON.parse(stringifyNotebook([finishEntry(exampleEntry())]));
  for (const change of [
    (v: any) => (v.schema_version = 3),
    (v: any) => (v.anatomy.coordinates.id = "other"),
    (v: any) => (v.anatomy.models[0].sha256 = "other"),
    (v: any) => (v.entries[0].highlights[0].position = [0, 1, 100]),
    (v: any) =>
      (v.entries[0].related_reading = [
        {
          url: "http://example.com",
          title: "Example",
          publisher: "Example",
          checked: "2026-09-12",
        },
      ]),
  ]) {
    const value = make();
    change(value);
    assert.throws(() => parseNotebook(JSON.stringify(value)));
  }
});
test("printout includes pin commentary and escapes all supplied text", () => {
  const entry = finishEntry(exampleEntry());
  entry.note = "<example & note>";
  entry.map.summary = entry.note;
  const svg = renderMapSvg(entry);
  assert.ok(svg.includes("&lt;example &amp; note&gt;"));
  assert.ok(
    svg
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .includes("High left neck when looking down"),
  );
  assert.ok(svg.includes("BACK"));
});

test("ten pins and a reviewed search description survive export and import", () => {
  const entry = finishEntry(exampleEntry());
  entry.points = Array.from({ length: 10 }, (_, i) => ({
    ...entry.points![0],
    id: crypto.randomUUID(),
    comment: `Pin ${i + 1}`,
  }));
  entry.research = {
    activity: "Tennis",
    description: "Stiff when turning",
    regions: ["neck"],
    checked: "2026-09-12T12:00:00Z",
    references: [],
  };
  const parsed = parseNotebook(stringifyNotebook([entry]))[0];
  assert.equal(parsed.points?.length, 10);
  assert.equal(parsed.research?.description, "Stiff when turning");
  entry.points.push({ ...entry.points[0], id: crypto.randomUUID() });
  assert.throws(() => parseNotebook(stringifyNotebook([entry])));
});
