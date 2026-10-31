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

The stored research is never an older version than the newest search that committed for that id.

The stored updated stamp is never older than a write that has committed for that id.

A note save that has committed is not replaced by an older draft.

A deleted id is not put back when a search finishes.

A committed save's new readings stay on the stored row and on the kept search.

The stored note is never older than the newest note the user saved or typed.

After a save is applied, the editor does not still show an older note. The gap is allowed only while the write is in flight and before the editor catches up.

The journal card shows the row that was stored.

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
| ApplyToEntry | `apply` at 432, `confirmProposal` in `src/voice/extraction.ts` 2361, `onApply` in `src/Notebook.tsx` 1201, `applyVoiceDraft` in `src/voice/draft.ts` 149 |
| DiscardDraft | discard button at 699. It calls `cancelCapture` and `close`, not `onApply` |
| DismissVoice | `dismiss` at 151 |
| PlacePin | pin and region updates in `src/Notebook.tsx` around 210. `src/anatomy/capture.ts` `captureViewport` is a PNG for export, not a save |
| EditEntry | `change` at 225. The id stays |
| FlushDraft | `saveDraft` in `src/notebook-storage.ts` 224, effect in `src/Notebook.tsx` 271, `pagehide` at 299 |
| DraftFails | the effect catch at 283 |
| PressSave | `commit` at 359. The button is disabled at 1364. Hand entry calls that `commit` at 955 |
| DoubleTap | `commit` returns at 360 while `busy` is set |
| SaveCommits | `storeEntries` at 228 returns the merged rows. `keepLandedResearch` at 122 keeps the newer research. The URL union at 145 is stored on the row and on `research.references` at 151. `commit` passes that row to `setSaved` at 367. `importFile` uses the returned rows at 480. The journal card reads the saved list at 677. `backup` at 491 calls `currentEntry` at 344, which rebuilds links with `entryReferences` at 109 |
| SaveFails | `commit` catch at 371. `mutate` rejects on abort at 63 and does not publish the transaction |
| DeleteEntry | `erase` at 430, `removeEntry` at 267. The id is recorded under `deleted-ids` |
| UndoDelete | `undoDelete` at 448, which puts the removed entry back and clears that id |
| Reload | `loadNotebook` effect at 244, `loadNotebook` in storage at 37 |
| OtherTabSaves | a second tab puts a different id. Puts do not replace the other id |
| ResearchLands | `saveResearch` at 278 stamps `research.version` and can commit while `storeEntries` is in flight. The screen calls it at 1346 |
| ResearchFromDraft | `newerEntry` at 208. The later `updated` value wins. `newerNote` at 214 picks the note by its own stamp |
| ResearchAfterDelete | `deletedIds(tomb.result).includes(entryId)` in `saveResearch` at 295. That guard returns before any put. `entries.delete` is `removeEntry` at 269, which only records the id |
| StoreVersionless | `researchVersion` at 76. A missing or non-string version is `""`, older than any stamp. The draft effect at 271 can persist a search payload that has no version |
| TypeNote | `change` at 225. A patch that includes `note` sets `noteUpdated` at 231. Pin and context edits do not |
| StaleNoteSave | the old save, which copied the research time onto an older note. The guard is `existingNote > incomingNote` in `keepLandedResearch` at 126 |
| ResearchKeepsNote | `saveResearch` overlays `noteEntry.note` at 309 and writes `noteUpdated` from `noteStamp` at 303. `withStampedResearch` at 162 copies that stored note onto the editor when its stamp is newer. The screen calls it at 1350. The mutant writes the older note after that clock was laundered |
| EditFieldWhileSaving | `context` at 234 and `setPoints` at 211 bump `updated` and leave `noteUpdated` alone |
| EditNoteWhileSaving | `change` at 225 sets `noteUpdated` at 231 when the patch includes `note` |
| MergeKeepsNewer | `keepLandedResearch` keeps the existing note when `existingNote > incomingNote` at 126. The row was already saved |
| EditorAfterSave | `editorAfterSave` at 184, called from `commit` at 368. A changed note stamp keeps the editor note. Any other edit takes `saved.note` and `saved.noteUpdated` and keeps the edited title, pin, or context |
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
| mutant_overwrite_newer_research | the old merge keeps the snapshot research whenever the snapshot has any | NewestResearchKept |
| mutant_keep_older_updated | the old merge writes the save's `updated` instead of the later stamp | UpdatedMonotone |
| mutant_drop_incoming_readings | a versionless snapshot is kept as the newer search and its new reading is dropped | ReadingsKept |
| mutant_restore_stale_note | a research write puts back the note from a stale save whose clock was the research time | NewestNoteKept |
| mutant_show_pre_merge | the journal card keeps the snapshot from before the merge | CardMatchesStore |
| mutant_keep_editor_note_on_any_edit | the old `editorAfterSave` keeps the editor note whenever `updated` changed during the save | EditorNoteNotStale |
| mutant_union_top_level_only | the old merge writes the URL union only on the top-level `references` list | ReadingsKept |

The research mutants split the old merge in `keepLandedResearch`. One puts an older search back. One writes the save's older stamp. One drops the incoming readings. One lets a research write restore an older note. The card mutant is `setSaved` with the pre-merge snapshot. Each config breaks only the invariant that piece guarded.

`cover_*.cfg` files must reach the situation they name. A pass there would mean the safety check never visited it. `cover_newer.cfg` reaches stored research rank 3 while the in-flight snapshot still holds rank 2. `cover_readings.cfg` reaches a kept extra reading on a saved row and on the kept search. `cover_newest_note.cfg` reaches a stored note at the newest typed rank. `cover_merged.cfg` reaches a card that shows the merged research. `cover_field_edit.cfg` reaches a non-note edit during a save, then a later save, with the editor note still at least the stored note. `CountFieldSecond` is on only in that config. It counts those two steps and does not change the save.

## Bounds

Two entry ids. One in-flight transcript and one in-flight extraction. A generation is live or stale, not a counter. Research rank is 0, 1, 2, or 3. 0 is no research. 1 is research with no version. 2 is the first stamp. 3 is the next stamp. A missing version is older than any stamp and newer than no research. The stored `updated` stamp still uses that rank. Note text has its own rank, 0, 1, or 2, with a separate draft rank. One boolean stands for one new reading URL. The storage test checks real version strings, note timestamps, and more than one URL, including a row that has no version field. A save snapshots the editor's rank. A search raises the stored rank and skips the versionless rank. The voice dialog is modal, so Save runs only while voice is shut. `busy` is set before the await, so a second click does not start a second save. `pagehide` is a draft flush. A kill that never starts the transaction is outside the model. The chart config turns `ModelRaces` off so the picture stays on the capture path. `base.cfg` leaves it on. The base check found 7489104 distinct states, depth 46, and finished in 18 seconds. TLC's optimistic fingerprint collision estimate was 1.9E-5.

## Not covered

Import re-ids on collision and rebuilds research without `version`, so an imported search is treated as oldest until the next `saveResearch`. The assistant's own save. Whether a suggestion is medically right. Two full puts of the same id from two tabs. The later commit wins for the note. The model does not merge those snapshots. Undo puts back the deleted record. The model tracks the id, not whether that copy still holds research. `captureViewport` is not a write. Two searches in the same millisecond share one version string. Readings are one extra URL, not an open set, and the model does not order the links. Both the row list and `research.references` are tracked. A row saved before `noteUpdated` existed falls back to `updated`, so an old research bump can still look like a newer note. New writes set `noteUpdated`. The model always has a separate note clock. A title, pin, context, or note edit during `storeEntries` is one step. Note rank is 0, 1, or 2, and the model does not separate note text from that rank. A fresh stamp on unchanged text is checked by `tests/capture-save-storage.test.ts`. The gap between `saveResearch` returning and `setEntry(withStampedResearch(...))` is not its own step. `ResearchKeepsNote` copies the stored note onto the editor in the same step.
