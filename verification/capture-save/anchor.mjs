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
const types = read("src/types.ts");
const exp = read("src/export.ts");

assert.equal(storage.includes("localStorage"), false);
assert.match(storage, /indexedDB\.open\("ihurt-notebook"/);
assert.match(
  storage,
  /stampMs\(researchVersion\(existing\)\) > stampMs\(researchVersion\(entry\)\)/,
);
assert.match(storage, /version: now/);
assert.match(storage, /laterStamp\(existing\?\.updated, entry\.updated\)/);
assert.match(storage, /deleted-ids/);
assert.match(storage, /stampMs\(draft\.updated\) > stampMs\(stored\.updated\)/);
assert.match(
  storage,
  /if \(deletedIds\(tomb\.result\)\.includes\(entryId\)\) return;/,
);
assert.match(storage, /objectStore\("entries"\)\.delete\(id\)/);
assert.match(
  storage,
  /const references = unionByUrl\(\s*existing\.references \?\? existing\.research\?\.references,\s*entry\.references,/,
);
// Notes and pins share one rule in both save paths (incomingWins). A stamp on
// either side decides, with ties to stored. With no stamp on either side, only
// an addition (more note text after stored, or more pins) beats stored.
assert.match(
  storage,
  /if \(storedAt !== "" \|\| incomingAt !== ""\)\s*return stampMs\(incomingAt\) > stampMs\(storedAt\);\s*return adds\(stored, incoming\);/,
);
assert.match(
  storage,
  /incoming\.note\.length > stored\.note\.length &&\s*incoming\.note\.startsWith\(stored\.note\)/,
);
assert.match(
  storage,
  /have\.size > old\.length && old\.every\(\(id\) => have\.has\(id\)\)/,
);
assert.match(
  storage,
  /existing !== undefined && !incomingNoteWins\(existing, entry\)/,
);
assert.match(
  storage,
  /existing !== undefined && !incomingPointsWin\(existing, entry\)/,
);
assert.match(
  storage,
  /return incomingNoteWins\(stored, draft\) \? draft : stored;/,
);
assert.match(
  storage,
  /return incomingPointsWin\(stored, draft\) \? draft : stored;/,
);
assert.equal(
  /stampMs\(incoming\.updated\) > stampMs\(stored\.updated\)/.test(storage),
  false,
  "the missing-stamp rule must not rank a note or pins by row updated",
);
assert.match(
  storage,
  /const noteEntry = newerNote\(draftEntry, stored\) \?\? entry;/,
);
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
  /const noteEdited =\s*editor\.note !== snapshot\.note \|\|\s*editor\.noteUpdated !== snapshot\.noteUpdated;/,
);
assert.match(
  storage,
  /const fieldsEdited = \(editor\.updated \?\? ""\) !== \(snapshot\.updated \?\? ""\);\s*if \(!fieldsEdited\) return \{ \.\.\.editor, \.\.\.saved, id: editor\.id \};\s*return \{\s*\.\.\.editor,\s*\.\.\.pins,\s*note: saved\.note,\s*\.\.\.\(typeof saved\.noteUpdated === "string"\s*\? \{ noteUpdated: saved\.noteUpdated \}\s*: \{\}\),/,
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
  /const stamped = ensureNoteStamp\(\s*withTime,\s*\(kept \?\? entry\)\.updated \?\? updated \?\? new Date\(\)\.toISOString\(\),\s*\);/,
);
// saveResearch stamps a missing note stamp with the row's own time, not the
// search time, so a search never outranks a note typed in the editor.
assert.match(
  storage,
  /typeof noteEntry\.noteUpdated === "string"\s*\? noteEntry\.noteUpdated\s*: noteEntry\.updated;/,
);
assert.equal(
  /noteEntry\.noteUpdated\s*: now/.test(storage),
  false,
  "saveResearch must not stamp a note with the search time",
);
assert.match(
  storage,
  /noteAt !== undefined \? \{ noteUpdated: noteAt \} : \{\}/,
);
assert.match(
  storage,
  /return stampMs\(stored\.noteUpdated\) > stampMs\(editor\.noteUpdated\);/,
);
assert.match(
  storage,
  /if \(!storedNoteNewerThanEditor\(stored, editor\)\)\s*return \{ \.\.\.editor, \.\.\.pins, research: stored\.research \};\s*return \{\s*\.\.\.editor,\s*\.\.\.pins,\s*research: stored\.research,\s*note: stored\.note,/,
);
// The editor takes the row's pins after a save or search unless its own are
// newer, so the next pin edit does not write a shorter list over the row.
assert.match(
  storage,
  /stampMs\(editor\.pointsUpdated\) > stampMs\(stored\.pointsUpdated\)\s*\? \{\}\s*: storedPins\(editor, stored\);/,
);
assert.match(
  storage,
  /const pins = pinsEdited \? \{\} : storedPins\(editor, saved\);/,
);
assert.match(
  storage,
  /if \(noteEdited\) return \{ \.\.\.editor, \.\.\.pins, \.\.\.researchAndRefs \};/,
);
assert.match(
  storage,
  /points: stored\.points \?\? \[\],\s*map: \{ \.\.\.editor\.map, regions: stored\.map\.regions \},/,
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

assert.match(storage, /function stampMs\(value\?: string\): number \{/);
assert.match(storage, /Date\.parse\(value\)/);
assert.match(storage, /return -Infinity;/);
assert.match(
  storage,
  /return stampMs\(left\) > stampMs\(right\) \? left : right;/,
);
assert.equal(
  /existing !== undefined && existingNote >= incomingNote/.test(storage),
  false,
  "note stamps must compare as instants",
);
assert.equal(
  /\(draft\.updated \?\? ""\) > \(stored\.updated \?\? ""\)/.test(storage),
  false,
  "updated stamps must compare as instants",
);
assert.equal(
  /researchVersion\(existing\) > researchVersion\(entry\)/.test(storage),
  false,
  "research versions must compare as instants",
);
assert.equal(
  /return left > right \? left : right;/.test(storage),
  false,
  "laterStamp must compare instants",
);
assert.match(storage, /summary: chosenNote/);
assert.match(storage, /summary: noteEntry\.note/);
assert.match(
  storage,
  /description is the text sent to the source search\. History, not the note\./,
);
assert.match(storage, /keepLandedResearch\(stored, raw\.entry\)/);
assert.match(storage, /function newerPoints/);
assert.equal(
  /!pointsStamp\(draft\) && !pointsStamp\(stored\)/.test(storage),
  false,
  "legacy pins must not fall back to the newer row",
);

// The model's corrupt-write branch clears the confirmed ids with the store,
// and run.sh runs TLC deterministically.
const spec = read("verification/capture-save/CaptureSave.tla");
assert.match(
  spec,
  /THEN \/\\ storeOk' = FALSE\s*\/\\ e1' = "absent"\s*\/\\ e2' = "absent"[\s\S]*?\/\\ c1' = FALSE\s*\/\\ c2' = FALSE/,
);
const runner = read("verification/capture-save/run.sh");
assert.match(runner, /WORKERS="\$\{TLC_WORKERS:-1\}"/);
assert.match(runner, /-fp 0/);
assert.match(
  runner,
  /\[\[ "\$\{expect\}" == "PASS" \]\] && workers="\$\{PASS_WORKERS\}"/,
);
assert.match(types, /pointsUpdated\?: string/);
assert.match(data, /entry\.pointsUpdated = date\(e\.pointsUpdated\)/);
assert.match(data, /pointsUpdated: entry\.pointsUpdated/);
assert.match(notebook, /pointsUpdated: now/);
assert.match(exp, /export function entryForExport/);
assert.match(
  notebook,
  /entryForExport\(\s*item,\s*valid \? currentEntry\(\) : undefined/,
);
assert.equal(
  /download\(\s*item,\s*"json"\s*\)/.test(notebook),
  false,
  "journal card export must use the open editor when it is that id",
);

const kept = voice.indexOf("if (extraction.current !== current) return;");
assert.ok(kept > 0, "extraction result must check its generation");
assert.ok(voice.indexOf("setProposal(next)", kept) > kept);
assert.match(voice, /const current = \+\+generation\.current;/);
assert.match(
  once,
  /if \(recording !== active \|\| suggested === recording\) return;/,
);
assert.match(
  gate,
  /if \(check !== undefined && check !== latest\) return undefined;/,
);
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
