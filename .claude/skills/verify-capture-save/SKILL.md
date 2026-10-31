---
name: verify-capture-save
description: Use when a change touches capturing a pain entry or saving it, including voice apply, the notebook draft, IndexedDB writes, research merge, delete, and undo.
---

# Verify capture and save

The check is a TLA+ model of one pain entry from voice or a body mark through to IndexedDB, plus a small test of the real storage functions. TLC explores the model. The test runs the TypeScript against an in-memory IndexedDB.

## Does this change touch it

Look at the diff. It touches this check if it edits any of these.

- `src/notebook-storage.ts` functions `open`, `loadNotebook`, `mutate`, `saveDraft`, `storeEntries`, `removeEntry`, `saveResearch`
- `src/Notebook.tsx` functions `change`, `commit`, `newMap`, `openSaved`, `erase`, `undoDelete`, the draft effect, voice `onApply`, research `onSave`
- `src/voice/VoiceDraft.tsx` functions `record`, `stop`, `suggestFinal`, `runExtraction`, `apply`, `dismiss`, `cancelCapture`, and the discard button
- `src/voice/draft.ts` function `applyVoiceDraft`
- `src/voice/suggest-once.ts` function `deliver`
- `src/voice/extraction.ts` function `confirmProposal`
- `src/voice/ai-gate.ts` function `recheck`
- `src/notebook-data.ts` function `blankEntry`
- `src/anatomy/capture.ts` only if a viewport capture starts being stored. Today it is not a save

`src/anatomy/hand-entry.ts` saves through `commit`. A change there matters only if it stops calling `commit` or starts writing storage itself.

## How to run

From the repo root, `bash verification/capture-save/run.sh`. Set `TLC_WORKERS=2` when other model checks are already using the machine. Exit 0 means the anchor, the storage test, and every config in `expected.txt` matched. Read a failure with the pstack /statechart skill.

## A real bug or a modeling error

The anchor reads the TypeScript and checks the guards the model relies on. If it fails, the code moved. Open the file the assertion names. If the guard is gone, that is a real change to replay against the model. If the guard moved but still does the same thing, update the anchor text and leave the spec.

A safety config that fails prints `Invariant NAME is violated` and the shortest path. Replay each action against the file and line in `verification/capture-save/README.md`. If the TypeScript can do those steps, it is a bug. If it cannot, the model is wrong. Fix the model. Do not weaken the invariant and do not delete the action to make the run pass.

A mutant config is supposed to fail the invariant named in `expected.txt`. If it passes, the guard it removes no longer protects that invariant, or the model no longer breaks when the guard is gone. Treat a passing mutant as a hole in the check.

A cover config is supposed to fail its `Cover*` invariant, which only means that situation was reached. If a cover passes, the safety run may no longer visit that situation. The pass would be vacuous. Make the situation reachable again.

## How to update the model

Change the action, the constant, `cfg/*.cfg`, `expected.txt`, `anchor.mjs`, and the action row in `README.md` together. Keep one mutant per guard, and keep a cover for each situation the safety run must visit. Run `run.sh` until it exits 0.

Move the sync commit below only after a run against the new code exits 0 and the action rows still name the lines you just read.

## Coverage

Synced to `addab96`. The model matches the storage fix on that commit. The branch started from `1441c4f`.

| File | What the check covers |
| --- | --- |
| `src/notebook-storage.ts` | `open`, `loadNotebook`, `mutate`, `saveDraft`, `storeEntries`, `removeEntry`, `saveResearch` |
| `src/Notebook.tsx` | `change`, draft effect, `commit`, `erase`, `undoDelete`, voice `onApply`, research `onSave` |
| `src/voice/VoiceDraft.tsx` | `record`, `stop`, `suggestFinal`, `runExtraction`, `apply`, `dismiss`, `cancelCapture`, discard |
| `src/voice/draft.ts` | `applyVoiceDraft` |
| `src/voice/suggest-once.ts` | `deliver` |
| `src/voice/extraction.ts` | `confirmProposal` |
| `src/voice/ai-gate.ts` | `recheck`, anchored only. The model treats it as the same stale-result drop as extraction |
| `src/notebook-data.ts` | `blankEntry` id allocation, anchored only |
| `src/anatomy/capture.ts` | confirmed not to call `storeEntries` |

## After a change that did not recheck

Use `/maintain-formal-verification-skill` when the covered files move and this check was not run against that commit.
