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

test("many pins and a reviewed search description survive export and import", () => {
  const entry = finishEntry(exampleEntry());
  entry.points = Array.from({ length: 600 }, (_, i) => ({
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
  assert.equal(parsed.points?.length, 600);
  assert.equal(parsed.research?.description, "Stiff when turning");
  assert.deepEqual(parsed.points, entry.points);
  entry.points[599].position = [0, 0, 99];
  assert.throws(() => parseNotebook(stringifyNotebook([entry])));
});

test("ihm packages remain ordinary JSON with inert derived materials", async () => {
  const { stringifyIhm } = await import("../src/export.ts");
  const entry = finishEntry(exampleEntry());
  const content = stringifyIhm(entry),
    bundle = JSON.parse(content);
  assert.equal(bundle.bundle.kind, "ihurt.map");
  assert.equal(bundle.bundle.version, 1);
  assert.equal(bundle.materials[0].media_type, "image/svg+xml");
  assert.ok(bundle.materials[0].content.startsWith("<svg"));
  assert.equal(parseNotebook(content)[0].note, entry.note);
  bundle.materials[0].content = "<script>untrusted</script>";
  assert.equal(parseNotebook(JSON.stringify(bundle))[0].note, entry.note);
  bundle.bundle.version = 999;
  assert.throws(() => parseNotebook(JSON.stringify(bundle)), /bundle version/);
});

test("print uses a local viewport capture and escapes its labels", async () => {
  const { renderPrintHtml } = await import("../src/export.ts");
  const entry = finishEntry(exampleEntry());
  const view = {
    image: "data:image/png;base64,aGVsbG8=",
    width: 100,
    height: 100,
    visiblePins: [1],
    caption: "<caption>",
  };
  const html = renderPrintHtml(entry, view);
  assert.ok(html.includes(view.image));
  assert.ok(html.includes("&lt;caption&gt;"));
  assert.ok(!html.includes("<svg"));
  assert.ok(
    !renderPrintHtml(entry, {
      ...view,
      image: "https://tracking.example/image.png",
    }).includes("https://tracking.example"),
  );
  assert.ok(renderPrintHtml(entry).includes("No 3D capture"));
});

test("surface highlights round trip and reject oversized or disconnected paths", () => {
  const entry = finishEntry(exampleEntry()),
    point = entry.points![0];
  point.area = {
    path: [
      point.position,
      [point.position[0] + 0.1, point.position[1], point.position[2]],
    ],
    radius: 0.12,
  };
  assert.deepEqual(
    parseNotebook(stringifyNotebook([entry]))[0].points![0].area,
    point.area,
  );
  const make = () => JSON.parse(stringifyNotebook([entry]));
  for (const change of [
    (v: any) => v.entries[0].highlights[0].area.path.push([9, 9, 9]),
    (v: any) => (v.entries[0].highlights[0].area.radius = 5),
    (v: any) =>
      (v.entries[0].highlights[0].area.path = Array(49).fill(point.position)),
  ]) {
    const value = make();
    change(value);
    assert.throws(() => parseNotebook(JSON.stringify(value)));
  }
});

test("AI notes print readable headings and links while keeping supplied HTML inert", async () => {
  const { renderPrintHtml } = await import("../src/export.ts");
  const entry = finishEntry(exampleEntry());
  entry.ai = {
    provider: "Test",
    created: entry.created,
    based_on: "test",
    answers: [],
    map: {
      ...entry.map,
      summary:
        "## Reading\n\n**A note** and [source](https://example.com/page). <script>alert(1)</script>\n\n- One\n- Two",
    },
  };
  const html = renderPrintHtml(entry);
  assert.ok(html.includes("<h3>Reading</h3>"));
  assert.ok(html.includes("<strong>A note</strong>"));
  assert.ok(html.includes('<a href="https://example.com/page">source</a>'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});
