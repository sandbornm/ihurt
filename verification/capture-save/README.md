# Capture and save

The model checks one pain entry from voice or a body mark through to IndexedDB. The store is database `ihurt-notebook` in `src/notebook-storage.ts`. Entries are put by id. Settings holds one draft and the deleted-id list. Nothing here rewrites a localStorage blob of the whole notebook.

Run `bash verification/capture-save/run.sh` from the repo root. Exit 0 means the anchor, the storage test, and every line in `expected.txt` matched. Set `TLC_WORKERS=2` when other model checks are already using the machine. The default is `auto`.

Read results with the pstack /statechart skill.

## Invariants

A save that has returned is still in the store until that entry is deleted.

One capture writes one record. Saving again updates that id.

A late extraction does not rewrite a draft.

Discard draft does not put that voice into the notebook.

A failed write leaves the store readable.

The id that is written is the id that was open.

Research that has committed is still on that entry after a later save.

A note save that has committed is not replaced by an older draft.

A deleted id is not put back when a search finishes.

## Actions

| Action | Code |
| --- | --- |
| OpenVoice | `src/voice/VoiceDraft.tsx` showModal at 183 |
| StartRecording | `record` at 269, generation bump at 271 |
| StopRecording | `stop` at 322, mode processing at 325 |
| CancelOrHide | visibility handler at 239, `cancelCapture` at 164 |
| TranscriptReady | `stop` finally at 355, `suggestFinal` at 368, `src/voice/suggest-once.ts` 13 |
| TranscriptStartsExtraction | same stop path, then `runExtraction` at 380 |
| LateTranscript | `suggest-once.ts` 13, and generation checks in `stop` |
| BeginExtraction | `propose` at 373, `runExtraction` at 380 |
| ExtractionReady | generation check at 395, then `setProposal` |
| LateExtraction | the same check at 395. `src/voice/ai-gate.ts` 42 drops a stale availability check the same way |
| EditTranscript | textarea at 563 |
| ApplyToEntry | `apply` at 432, `confirmProposal` in `src/voice/extraction.ts` 2369, `onApply` in `src/Notebook.tsx` 1191, `applyVoiceDraft` in `src/voice/draft.ts` 149 |
| DiscardDraft | discard button at 699. It calls `cancelCapture` and `close`, not `onApply` |
| DismissVoice | `dismiss` at 151 |
| PlacePin | pin and region updates in `src/Notebook.tsx` around 210. `src/anatomy/capture.ts` `captureViewport` is a PNG for export, not a save |
| EditEntry | `change` at 222. The id stays |
| FlushDraft | `saveDraft` in `src/notebook-storage.ts` 96, effect in `src/Notebook.tsx` 262, `pagehide` at 290 |
| DraftFails | the effect catch at 274 |
| PressSave | `commit` at 355. The button is disabled at 1364. Hand entry uses the same `commit` at 949 |
| DoubleTap | `commit` returns at 356 while `busy` is set |
| SaveCommits | `storeEntries` at 100. `keepLandedResearch` at 77 keeps research the snapshot does not have |
| SaveFails | `commit` catch at 365. `mutate` rejects on abort at 57 and does not publish the transaction |
| DeleteEntry | `erase` at 425, `removeEntry` at 119. The id is recorded under `deleted-ids` |
| UndoDelete | `undoDelete` at 443, which puts the removed entry back and clears that id |
| Reload | `loadNotebook` effect at 235, `loadNotebook` in storage at 37 |
| OtherTabSaves | a second tab puts a different id. Puts do not replace the other id |
| ResearchLands | `saveResearch` at 130 while `storeEntries` is in flight. The screen calls it at 1340 |
| ResearchFromDraft | `newerEntry` at 90. The later `updated` value wins |
| ResearchAfterDelete | the `deleted-ids` check at 144 |
| Wait | no screen step. It keeps the model from treating a finished screen as a deadlock |

## Mutants

Each `mutant_*.cfg` turns one constant on. That constant is one guard removed or one old write put back.

| Config | Broken behavior | Invariant that fails |
| --- | --- | --- |
| mutant_skip_generation | ignore the extraction generation | LateSafe |
| mutant_append_on_save | keep a second record on save | NoDuplicate |
| mutant_save_on_discard | discard writes the notebook | DiscardStaysOut |
| mutant_corrupt_write | a failed save clears records | StoreParseable |
| mutant_wrong_id | the save writes another id | WritesIntended |
| mutant_replace_notebook | the save writes a stale copy of every entry | ConfirmedPresent |
| mutant_drop_research | the save puts the snapshot and drops research | ResearchKept |
| mutant_stale_draft | research bases the row on an older draft | NewerNoteKept |
| mutant_restore_deleted | research puts a deleted id back | NoResurrection |

`cover_*.cfg` files must reach the situation they name. A pass there would mean the safety check never visited it.

## Bounds

Two entry ids. One in-flight transcript and one in-flight extraction. A generation is live or stale, not a counter. Timestamps are only newer or not. The voice dialog is modal, so Save runs only while voice is shut. `busy` is set before the await, so a second click does not start a second save. `pagehide` is a draft flush. A kill that never starts the transaction is outside the model. The chart config turns `ModelRaces` off so the picture stays on the capture path. `base.cfg` leaves it on. The base check found 253008 distinct states, depth 35.

## Not covered

Import re-ids on collision. The assistant's own save. Whether a suggestion is medically right. Two full puts of the same id from two tabs. The later commit wins for the note. The model does not merge those snapshots. Undo puts back the deleted record. The model tracks the id, not whether that copy still holds research. `captureViewport` is not a write.
