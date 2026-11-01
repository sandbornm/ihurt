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
assert.match(
  storage,
  /stampMs\(b\.r\.updated\) - stampMs\(a\.r\.updated\) \|\| a\.i - b\.i/,
);
assert.match(
  storage,
  /if \(deletedIds\(tomb\.result\)\.includes\(entryId\)\) return;/,
);
assert.match(storage, /objectStore\("entries"\)\.delete\(id\)/);
assert.match(
  storage,
  /const references = unionByUrl\(\s*existing\.references \?\? existing\.research\?\.references,\s*entry\.references,/,
);
// Notes and pins share one rule (incomingWins). A stamp on either side
// decides, with ties to stored. With no stamp on either side, the path picks:
// a load takes the draft, a search or save keeps stored.
assert.match(
  storage,
  /if \(storedAt !== "" \|\| incomingAt !== ""\)\s*return stampMs\(incomingAt\) > stampMs\(storedAt\);\s*return tie === "draft";/,
);
assert.match(storage, /type UnstampedTie = "stored" \| "draft";/);
assert.equal(
  /noteAdds|pointsAdd|pointIds/.test(storage),
  false,
  "a missing-stamp tie must not depend on the edit being an addition",
);
assert.match(
  storage,
  /function keepLandedResearch\(\s*existing: SavedMap \| undefined,\s*entry: SavedMap,\s*tie: UnstampedTie = "stored",\s*\)/,
);
// A loaded draft that won its pins on a tie gets a stamp, so the next search
// (stored wins a tie) does not revert it.
assert.match(
  storage,
  /const loadedPins =\s*tie === "draft" &&\s*existing !== undefined &&\s*!keepPoints &&\s*incomingPts === "" &&\s*existingPts === "" &&\s*!samePins\(existing, entry\);/,
);
assert.match(
  storage,
  /: loadedPins\s*\? \(entry\.updated \?\? new Date\(\)\.toISOString\(\)\)\s*: incomingPts;/,
);
assert.match(
  storage,
  /existing !== undefined && !incomingNoteWins\(existing, entry, tie\)/,
);
assert.match(
  storage,
  /existing !== undefined && !incomingPointsWin\(existing, entry, tie\)/,
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
  /newerNote\(openEditor, newerNote\(savedDraft, stored\)\) \?\? entry;/,
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
assert.match(
  notebook,
  /await saveResearch\(\s*entry\.id,\s*research,\s*searched,\s*\)/,
);
// Load writes the draft it reconciled back in its own readwrite transaction,
// so it resolves only after the stamped draft is stored.
assert.match(
  storage,
  /db\.transaction\(\["entries", "settings"\], "readwrite"\);\s*const settings = tx\.objectStore\("settings"\);\s*const entries = tx\.objectStore\("entries"\)\.getAll\(\),\s*draft = settings\.get\("draft"\);/,
);
assert.match(
  storage,
  /JSON\.stringify\(result\) !== JSON\.stringify\(raw\)\)\s*settings\.put\(result, "draft"\);/,
);
assert.match(
  storage,
  /entries\.onsuccess = reconcile;\s*draft\.onsuccess = reconcile;/,
);
assert.match(
  storage,
  /tx\.oncomplete = \(\) => resolve\(\{ entries: list, draft: result \}\);/,
);
// saveResearch merges the open editor when it is this entry, on top of the
// saved draft, which another tab may have written later (TabDraftKept).
assert.match(
  storage,
  /const openEditor = editor\?\.id === entryId \? editor : undefined;/,
);
assert.match(
  storage,
  /const entry = ranked\[0\];[\s\S]{0,300}newerPoints\(openEditor, newerPoints\(savedDraft, stored\)\)/,
);
// Fields with no stamp come from every record, not only the newest
// (WholeRecordByUpdated, dc337c7).
assert.match(
  storage,
  /const ranked = byUpdated\(\[stored, savedDraft, openEditor\]\);/,
);
assert.match(
  storage,
  /ranked\.reduce<[^>]*>>\(\s*\(all, record\) => unionByUrl\(all, record\.references\),\s*stamped\.references,/,
);
assert.match(storage, /answers: fillAnswers\(ranked\),/);
assert.match(storage, /\.\.\.details\.map,/);
// A stamped map detail wins even when blank (FillBlankDetails, c8b260d).
assert.match(storage, /stampMs\(at\) > stampMs\(detailStamp\(winner, key\)\)/);
assert.match(storage, /map\[key\] = winner\.map\[key\];/);
// The editor takes the whole merge (HandBackNoteOnly, c8b260d), keeping a
// field only if it changed it since the search read it, by field stamp or
// against the searched snapshot, not by updated (HandBackByUpdated, 1af0a35).
assert.match(
  storage,
  /const map: Record<string, unknown> = \{ \.\.\.stored\.map \};[\s\S]{0,500}\? stampMs\(editorAt\) > stampMs\(rowAt\)\s*: differs\(editor\.map\[key\], searched\.map\[key\]\);/,
);
assert.match(
  storage,
  /answers: answersAfterSearch\(stored, editor, searched\),\s*references: unionByUrl\(stored\.references, editor\.references\),/,
);
assert.match(storage, /summary: noteFrom\.note,/);
// A removed AI note stays removed: the newest aiUpdated wins, removal
// included (PickFirstAi, 1af0a35).
assert.match(storage, /\.\.\.pickAi\(ordered, ranked\),/);
assert.match(storage, /\.\.\.aiFields\(aiFrom\),/);
assert.match(notebook, /"ai" in patch \? \{ aiUpdated: now \} : \{\}/);
assert.match(notebook, /aiUpdated: now,/);
// A later save or load of an older draft keeps the row's newer stamped
// details and AI note (LandIgnoresStamps, 1af0a35).
assert.match(storage, /const landed = landStamped\(existing, entry\);/);
// Edits stamp the map details they change.
assert.match(notebook, /withMapDetails\(e, \{ \[field\]: value \}, now\)/);
assert.match(notebook, /map \? withMapDetails\(e, map, now\) : e/);
assert.equal(
  /unionByUrl\(stamped\.references, entry\.references\)/.test(storage),
  false,
  "readings must union across all records (WholeRecordByUpdated)",
);
assert.equal(
  /editor\?\.id === entryId \? editor : savedDraft/.test(storage),
  false,
  "the open editor must not replace the saved draft (SearchPrefersEditor)",
);
assert.match(notebook, /e\.id === entry\.id/);
assert.match(notebook, /const searched = draftRef\.current\.entry;/);
assert.match(
  notebook,
  /withStampedResearch\(e, entry\.id, updated, searched\)/,
);
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
  /const noteFrom = storedNoteNewerThanEditor\(stored, editor\) \? stored : editor;[\s\S]{0,1400}research: stored\.research,\s*note: noteFrom\.note,/,
);
// The editor takes the row's pins after a save or search unless its own are
// newer, so the next pin edit does not write a shorter list over the row.
assert.match(
  storage,
  /stampMs\(editor\.pointsUpdated\) > stampMs\(stored\.pointsUpdated\)\s*\? undefined\s*: storedPins\(editor, stored\);/,
);
// A pin edit during the save is merged per pin onto the saved pins.
assert.match(storage, /function mergePinEdits\(/);
assert.match(
  storage,
  /const merged = mergePinEdits\(\s*snapshot\.points \?\? \[\],\s*editor\.points \?\? \[\],\s*saved\.points \?\? \[\],\s*\);/,
);
assert.match(storage, /const pins = pinsEdited\s*\? \{\s*points: merged,/);
assert.equal(
  /pinsEdited \? \{\} :/.test(storage),
  false,
  "a pin edit during a save must not skip the saved pins",
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
assert.match(storage, /keepLandedResearch\(stored, raw\.entry, "draft"\)/);
assert.match(storage, /function newerPoints/);
assert.equal(
  /!pointsStamp\(draft\) && !pointsStamp\(stored\)/.test(storage),
  false,
  "legacy pins must not fall back to the newer row",
);

// The model's corrupt-write branch clears the confirmed ids with the store,
// and run.sh runs TLC deterministically.
const spec = read("verification/capture-save/CaptureSave.tla");
assert.match(spec, /WholeRecordByUpdated THEN newestRec ELSE merged/);
assert.match(
  spec,
  /IF FillBlankDetails THEN Superseded\(h, "stale"\) ELSE \{\}[\s\S]{0,120}IF PickFirstAi THEN Superseded\(h, "oldai"\) ELSE \{\}/,
);
assert.match(spec, /merged == UNION recs \\ gone/);
assert.match(
  spec,
  /IF HandBackNoteOnly[\s\S]{0,200}ELSE IF HandBackByUpdated \/\\ keyed[\s\S]{0,200}ELSE SearchRow\(h\)/,
);
assert.match(spec, /IF late \/\\ LandIgnoresStamps/);
assert.match(
  spec,
  /tabLost' = ~\(Kept\(h, SearchRow\(h\)\) \/\\ Kept\(h, EditorAfter\(h, keyed\)\)\s*\/\\ Kept\(h, Landed\(h, late\)\)\)/,
);
assert.match(
  spec,
  /THEN \/\\ storeOk' = FALSE\s*\/\\ e1' = "absent"\s*\/\\ e2' = "absent"[\s\S]*?\/\\ c1' = FALSE\s*\/\\ c2' = FALSE/,
);
// The model's load takes and stamps the draft, a search keeps stored on a
// tie, and a pin edit during the save is merged onto the saved pins.
assert.match(
  spec,
  /loadStamp' = IF LegacyKeepsStored THEN "idle"\s*ELSE IF LoadSkipsStamp THEN "none"\s*ELSE IF LoadStampsInMemoryOnly THEN "memory"\s*ELSE "stored"/,
);
assert.match(
  spec,
  /draftLost' = CASE loadStamp = "stored" -> FALSE\s*\[\] loadStamp = "memory" -> src = "other"\s*\[\] OTHER -> TRUE/,
);
assert.match(
  spec,
  /Next ==\s*IF LoadWindow THEN SearchAfterLegacyLoad \\\/ AutosaveAfterLoad\s*ELSE IF TabWindow THEN SearchWithOlderEditor \\\/ TabDraftSettles\s*ELSE Settled/,
);
assert.match(
  spec,
  /IF SearchPrefersEditor THEN \{StoredRec\(h\), EditorRec\(h\)\}/,
);
assert.match(spec, /staleDraftWon' = LegacyResearchTakesDraft/);
assert.match(spec, /\\\/ \(SkipPinsOnPinEdit \/\\ pinTouched\)/);
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
