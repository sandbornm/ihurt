import test from "node:test";
import assert from "node:assert/strict";
import { searchDescription } from "../src/search-context.ts";
import { exampleEntry } from "../src/example.ts";
import {
  parseNotebook,
  stringifyNotebook,
  finishEntry,
} from "../src/notebook-data.ts";
import { renderPrintHtml } from "../src/export.ts";
test("reviewable search text includes observations without sending model files or coordinates", () => {
  const entry = exampleEntry();
  entry.note = "Stiff after serving";
  entry.points![0].comment = "Sore when looking left";
  const description = searchDescription(entry);
  assert.ok(description.includes(entry.note));
  assert.ok(description.includes(entry.points![0].comment));
  assert.ok(description.includes("Spot 1"));
  assert.ok(!description.includes(JSON.stringify(entry.points![0].position)));
  entry.note = "Long note ".repeat(400);
  entry.points = Array.from({ length: 10 }, (_, i) => ({
    ...entry.points![0],
    id: String(i),
    comment: "A comment ".repeat(50),
  }));
  assert.ok(searchDescription(entry).includes("Spot 10"));
  entry.note = "🌱".repeat(2000);
  assert.ok(new TextEncoder().encode(searchDescription(entry)).length <= 5000);
});
test("video sources and publisher context survive export and remain escaped in the report", () => {
  const entry = finishEntry(exampleEntry());
  entry.references = [
    {
      title: "Video <script>bad</script>",
      publisher: "NHS",
      url: "https://www.youtube.com/playlist?list=example",
      context_url: "https://www.nhs.uk/",
      kind: "video",
      checked: "2026-09-13",
    },
  ];
  const parsed = parseNotebook(stringifyNotebook([entry]))[0];
  assert.deepEqual(parsed.references, entry.references);
  const report = renderPrintHtml(parsed);
  assert.ok(
    report.indexOf("Not medical advice. Not a prescription.") <
      report.indexOf("<header>"),
  );
  assert.ok(report.includes("Video resources to discuss"));
  assert.ok(!report.includes("<script>bad"));
  entry.references[0].context_url = "javascript:alert(1)";
  assert.throws(() => parseNotebook(stringifyNotebook([entry])));
});
