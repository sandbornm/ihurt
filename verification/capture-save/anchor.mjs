// Grep-level facts the capture-save model relies on. A drift here means
// the spec no longer describes the TypeScript.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

const storage = read("src/notebook-storage.ts");
const notebook = read("src/Notebook.tsx");
const voice = read("src/voice/VoiceDraft.tsx");
const draft = read("src/voice/draft.ts");
const once = read("src/voice/suggest-once.ts");
const gate = read("src/voice/ai-gate.ts");
const extraction = read("src/voice/extraction.ts");
const data = read("src/notebook-data.ts");
const capture = read("src/anatomy/capture.ts");

assert.equal(storage.includes("localStorage"), false);
assert.match(storage, /indexedDB\.open\("ihurt-notebook"/);
assert.match(
  storage,
  /researchVersion\(existing\) > researchVersion\(entry\)/,
);
assert.match(storage, /version: now/);
assert.match(storage, /laterStamp\(existing\?\.updated, entry\.updated\)/);
assert.match(storage, /deleted-ids/);
assert.match(
  storage,
  /\(draft\.updated \?\? ""\) > \(stored\.updated \?\? ""\)/,
);
assert.match(storage, /objectStore\("entries"\)\.delete\(id\)/);

assert.match(notebook, /if \(!valid \|\| busy\) return false;/);
assert.match(notebook, /disabled=\{!valid \|\| busy\}/);
assert.match(notebook, /window\.addEventListener\("pagehide", flush\)/);
assert.match(notebook, /applyVoiceDraft\(entry, draft\)/);
assert.match(notebook, /await saveResearch\(entry\.id, research\)/);
assert.match(notebook, /e\.id === entry\.id/);

const kept = voice.indexOf("if (extraction.current !== current) return;");
assert.ok(kept > 0, "extraction result must check its generation");
assert.ok(voice.indexOf("setProposal(next)", kept) > kept);
assert.match(voice, /const current = \+\+generation\.current;/);
assert.match(once, /if \(recording !== active \|\| suggested === recording\) return;/);
assert.match(gate, /if \(check !== undefined && check !== latest\) return undefined;/);
assert.match(extraction, /if \(choice\.confirmed !== true\)/);

const discardAt = voice.indexOf("voice-discard");
assert.ok(discardAt > 0);
const discard = voice.slice(discardAt);
assert.match(discard, /cancelCapture\(\);\s*close\(\);/);
assert.equal(discard.includes("onApply"), false);

assert.match(data, /id: crypto\.randomUUID\(\)/);
assert.match(
  draft,
  /return \{ \.\.\.entry, note, map: \{ \.\.\.entry\.map, \.\.\.draft\.fields \} \};/,
);
assert.equal(capture.includes("storeEntries"), false);

console.log("anchor holds");
