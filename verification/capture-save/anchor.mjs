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
assert.match(storage, /if \(deletedIds\(tomb\.result\)\.includes\(entryId\)\) return;/);
assert.match(storage, /objectStore\("entries"\)\.delete\(id\)/);
assert.match(
  storage,
  /const references = unionByUrl\(\s*existing\.references \?\? existing\.research\?\.references,\s*entry\.references,/,
);
assert.match(storage, /existingNote > incomingNote/);
assert.match(storage, /noteStamp\(draft\) > noteStamp\(stored\)/);
assert.match(storage, /note: noteEntry\.note/);
assert.match(
  storage,
  /export function storeEntries\(entries: SavedMap\[\]\): Promise<SavedMap\[\]>/,
);
assert.match(storage, /const row = keepLandedResearch\(existing, entry\)/);
assert.match(storage, /merged\.push\(row\)/);
assert.match(storage, /tx\.oncomplete = \(\) => resolve\(merged\)/);

assert.match(notebook, /if \(!valid \|\| busy\) return false;/);
assert.match(notebook, /disabled=\{!valid \|\| busy\}/);
assert.match(notebook, /window\.addEventListener\("pagehide", flush\)/);
assert.match(notebook, /applyVoiceDraft\(entry, draft\)/);
assert.match(notebook, /await saveResearch\(entry\.id, research\)/);
assert.match(notebook, /e\.id === entry\.id/);
assert.match(notebook, /withStampedResearch\(e, entry\.id, updated\)/);
assert.match(notebook, /const \[savedRow\] = await storeEntries\(\[item\]\);/);
assert.match(notebook, /const saved = savedRow \?\? item;/);
assert.match(notebook, /editorAfterSave\(current, item, saved\)/);
assert.match(storage, /export function editorAfterSave/);
assert.match(
  storage,
  /const noteEdited =\s*editor\.note !== snapshot\.note \|\| editor\.noteUpdated !== snapshot\.noteUpdated;/,
);
assert.match(
  storage,
  /const fieldsEdited = \(editor\.updated \?\? ""\) !== \(snapshot\.updated \?\? ""\);\s*if \(!fieldsEdited\) return \{ \.\.\.editor, \.\.\.saved, id: editor\.id \};\s*return \{\s*\.\.\.editor,\s*note: saved\.note,\s*\.\.\.\(typeof saved\.noteUpdated === "string"\s*\? \{ noteUpdated: saved\.noteUpdated \}\s*: \{\}\),/,
);
assert.equal(
  /noteEdited = noteStamp\(editor\) !== noteStamp\(snapshot\)/.test(storage),
  false,
  "editorAfterSave must not rank a note edit through noteStamp",
);
assert.match(
  storage,
  /function noteStamp\(entry: SavedMap \| undefined\): string \{\s*if \(!entry\) return "";\s*return typeof entry\.noteUpdated === "string" \? entry\.noteUpdated : "";\s*\}/,
);
assert.equal(
  /noteUpdated === "string"\s*\? entry\.noteUpdated\s*: \(entry\.updated \?\? ""\)/.test(
    storage,
  ),
  false,
  "noteStamp must not fall back to updated",
);
assert.match(storage, /function ensureNoteStamp/);
assert.match(
  storage,
  /const stamped = ensureNoteStamp\(\s*withTime,\s*updated \?\? new Date\(\)\.toISOString\(\),\s*\);/,
);
assert.match(
  storage,
  /typeof noteEntry\.noteUpdated === "string"\s*\? noteEntry\.noteUpdated\s*: now/,
);
assert.match(storage, /noteUpdated: noteAt,/);
assert.match(
  storage,
  /if \(typeof storedAt !== "string"\) return false;\s*if \(typeof editorAt !== "string"\) return true;\s*return storedAt > editorAt;/,
);
assert.match(
  storage,
  /if \(!storedNoteNewerThanEditor\(stored, editor\)\)\s*return \{ \.\.\.editor, research: stored\.research \};\s*return \{\s*\.\.\.editor,\s*research: stored\.research,\s*note: stored\.note,/,
);
assert.match(
  storage,
  /research: existing\.research\s*\?\s*\{ \.\.\.existing\.research, references \}\s*: existing\.research,/,
);
assert.match(
  storage,
  /unionByUrl\(entry\.research\?\.references, entry\.references\)/,
);
assert.match(notebook, /entryReferences\(/);
assert.match(
  storage,
  /saved\.research !== undefined \? \{ research: saved\.research \} : \{\}/,
);
assert.match(
  storage,
  /saved\.references !== undefined \? \{ references: saved\.references \} : \{\}/,
);
assert.match(
  notebook,
  /patch\.note !== undefined \? \{ noteUpdated: now \} : \{\}/,
);

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
