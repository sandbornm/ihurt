---- MODULE CaptureSave ----
\* How one pain entry moves from voice or body capture to the notebook.
\*
\* Persistence is IndexedDB database "ihurt-notebook" (src/notebook-storage.ts).
\* Object store "entries" is keyed by entry id. Object store "settings" holds
\* one draft. A save puts those records. It does not rewrite a localStorage
\* blob of the whole notebook.
\*
\* Each action is one step the screen takes or one async result the code can
\* still deliver. A CONSTANT that is TRUE turns off one guard from the
\* TypeScript. Those constants are FALSE for the real code.

EXTENDS Integers

CONSTANTS
  SkipGenerationGuard,   \* ignore extraction.current / recording generation
  AppendOnSave,          \* keep a second record instead of put-by-id
  SaveOnDiscard,         \* Discard draft writes the voice into the notebook
  CorruptOnFailedWrite,  \* a failed save clears committed records
  WriteWrongId,          \* the save puts a different entry id
  ReplaceWholeNotebook,  \* the save writes a stale snapshot of every entry
  DropResearch,          \* storeEntries puts the snapshot and drops research
  PreferStaleDraft,      \* saveResearch bases the row on an older draft
  RestoreDeleted,        \* saveResearch puts a deleted id back from the draft
  OverwriteNewerResearch,\* old merge: a snapshot that has any research replaces the row
  KeepOlderUpdated,      \* old merge keeps the save's updated stamp
  DropIncomingReadings,  \* old merge keeps stored research and drops the save's new readings
  RestoreStaleNote,      \* a research write puts back the note from a laundered row
  ShowPreMerge,          \* the journal card keeps the snapshot from before the merge
  KeepEditorNoteOnAnyEdit, \* old editorAfterSave keeps the editor note when any field changed
  UnionTopLevelOnly,     \* old merge writes the URL union only on the top-level list
  CountFieldSecond,      \* cover only. Counts a non-note edit, then the next save
  FallbackToUpdated,     \* old noteStamp falls back to updated when noteUpdated is missing
  CountLegacyFieldSecond,\* cover only. Counts a field edit on a row with no note stamp, then the next save
  TieTakesIncoming,      \* old keepLandedResearch: two missing note stamps tie and the snapshot note wins
  SearchStampsNow,       \* old saveResearch: a missing note stamp becomes the search time
  StaleSummary,          \* old merge keeps the stored note and leaves the incoming map.summary
  DropStoredPins,        \* old merge writes the snapshot points and drops stored pins
  LegacyKeepsStored,     \* old load: no stamp on either side keeps stored, so the draft's edit is lost
  EditorKeepsOldPins,    \* old editorAfterSave/withStampedResearch leave the editor's older pins
  LoadSkipsStamp,        \* load takes the draft but leaves it unstamped, so a later search reverts it
  SearchPrefersEditor,   \* 0db75f3 saveResearch: the open editor replaces the saved draft, so another tab's newer draft is lost
  WholeRecordByUpdated,  \* dc337c7 saveResearch: readings, answers and map details come only from the newest record by updated
  FillBlankDetails,      \* c8b260d saveResearch: a blank map detail fills from an older record even when a newer stamp cleared it
  HandBackNoteOnly,      \* c8b260d withStampedResearch: the editor gets only the merged note, pins and research, so the autosave drops the rest
  PickFirstAi,           \* 1af0a35 saveResearch/withStampedResearch: the AI note comes from the newest record that has one, so a removal is undone
  LandIgnoresStamps,     \* 1af0a35 keepLandedResearch: a later save or load of an older draft puts back a detail or AI note a newer stamp cleared
  HandBackByUpdated,     \* 1af0a35 withStampedResearch: a keystroke after the search makes the editor newest, so its older unstamped fields win
  LoadStampsInMemoryOnly,\* 41347e7 load: stamps the draft in memory and leaves the stored draft to the autosave
  LegacyResearchTakesDraft, \* a search on an unstamped tie takes the draft over the stored row
  SkipPinsOnPinEdit,     \* old editorAfterSave: a pin edit during the save skips the merged pins
  MarkSearch,            \* TRUE only in the search covers: the search leaves a mark; else it returns to idle
  ModelRaces             \* FALSE only in the chart config, which omits these races

\* Research rank. 0 is none. 1 is present with no version. 2 is v1. 3 is v2.
\* A missing version is older than any stamp, and newer than no research at all.

VARIABLES
  phase,       \* shut, idle, recording, processing, extracting, ready, error
  flightT,     \* none, live, stale
  flightX,     \* none, live, stale
  text,        \* panel holds a transcript
  filled,      \* open entry has something commit() will save
  revised,     \* the person edited an entry that was already saved
  e1,          \* absent, saved, or dup for the open entry id
  e2,          \* absent or saved for the other id
  c1, c2,      \* a save of that id has returned and has not been deleted
  snap2,       \* e2 was present in the last loadNotebook snapshot
  busy,        \* storeEntries started and has not finished
  undo,        \* a deleted entry can be put back
  dropped,     \* Discard draft happened
  banned,      \* a discarded voice was written into the notebook
  clobber,     \* a late extraction changed a draft
  storeOk,     \* the store can be opened and read
  wrongWrite,  \* a save wrote an id other than the open entry
  lateSeen,    \* a stale transcript or extraction was ignored
  failSeen,    \* a save failed
  undoSeen,    \* Undo delete restored an entry
  retrySeen,   \* a second save of an already stored entry committed
  draftStored, \* settings.draft has been written for the current editor
  research,    \* stored research rank. 0 none, 1 versionless, 2 v1, 3 v2
  newest,      \* newest stamped search for this id. 0 is none. Skips versionless
  storedAt,    \* rank of the stored updated stamp. A search raises it
  owed,        \* a research write committed and the entry was not deleted since
  editorResearch, \* research rank the open editor will snapshot next
  snapResearch,\* research rank copied by the in-flight save
  fresh,       \* the stored note is the newer save, not an older draft
  owedNote,    \* that newer note must still be the one stored
  resurrected, \* a late search put a deleted id back
  lateDeleteSeen, \* a search finished after the id was deleted
  cardStale,   \* the journal card is showing the pre-merge snapshot
  owedExtra,   \* a save committed a new reading while a newer search was kept
  extra,       \* that reading is on the stored row
  note,        \* stored note rank
  draftNote,   \* note rank in the draft
  best,        \* newest note rank a write was obliged to keep
  laundered,   \* a stale save adopted the research timestamp for an older note
  editorNote,  \* note rank on the open editor
  snapNote,    \* note rank copied when save was pressed
  touch,       \* none, note, or field. What changed while this save is in flight
  pending,     \* the store committed and the editor has not caught up
  newerKept,   \* this save's merge keeps a stored note one rank newer than the snapshot
  afterField,  \* 0 none, 1 a non-note edit was caught up, 2 a later save committed
  researchExtra,\* the extra reading is on research.references as well as the row
  legacy,      \* the editor has no noteUpdated (blankEntry, import, example, old row)
  rowLegacy,   \* the stored row has no noteUpdated
  typed,       \* rank of a note typed in the editor before the draft write ran
  summaryStale,\* stored map.summary does not match the kept note
  pinDropped,  \* a later save wrote empty points over a stored pin
  draftLost,   \* a legacy draft's added note text or pins were replaced by the stored row
  editorPinsStale,\* the editor holds older pins than the row after a save or search
  tabDraft,    \* another tab's newer draft for this entry: "idle", "newer" (saved, not yet merged), "searched"
  tabLost,     \* a search dropped the other tab's newer note or pins for this tab's older editor
  loadStamp,   \* where a legacy load's stamp is, until the next search: "idle", "none", "memory", "stored", "searched"
  staleDraftWon, \* a search took an unstamped draft over the stored row
  pinTouched     \* the user edited pins while storeEntries was writing

vars == <<
  phase, flightT, flightX, text, filled, revised,
  e1, e2, c1, c2, snap2, busy, undo, dropped, banned,
  clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
  draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
  resurrected, lateDeleteSeen, cardStale, owedExtra, extra, note, draftNote, best, laundered,
  editorNote, snapNote, touch, pending, newerKept, afterField, researchExtra,
  legacy, rowLegacy, typed, summaryStale, pinDropped, draftLost, editorPinsStale,
  loadStamp, tabDraft, tabLost, staleDraftWon, pinTouched
>>

\* Left unchanged by actions that do not assign them.
noteVars == <<cardStale, owedExtra, extra, note, draftNote, best, laundered, rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>
editorVars == <<editorNote, snapNote, touch, pending, newerKept, afterField, researchExtra, legacy, typed, pinTouched>>

\* The data each record holds that no other record has. The other tab's draft
\* is newest by updated and holds the newer note and pins. The stored row or
\* the older editor may hold a reading, an answer, or a map detail (title,
\* quality, activity, duration, intensity) that the draft lacks. It may also
\* hold an older value the draft superseded, which must not come back:
\*   "stale"  an older map detail the draft cleared with a newer field stamp
\*   "oldai"  an AI note the draft removed with a newer aiUpdated stamp
\*   "older"  an older unstamped value (an answer, a legacy title) for a field
\*            the newer draft holds as <<"draft", "newer">>
\* h names that one item, or none. Checking one item at a time is enough: the
\* merge treats each item on its own.
TabFamilies == {"reading", "answer", "detail", "stale", "oldai", "older"}
TabHeld == {<<"none", "none">>} \cup ({"stored", "editor"} \X TabFamilies)
StoredRec(h) == IF h[1] = "stored" THEN {h} ELSE {}
EditorRec(h) == IF h[1] = "editor" THEN {h} ELSE {}
DraftRec(h) ==
  {<<"draft", "note">>, <<"draft", "pins">>}
    \cup (IF h[2] = "older" THEN {<<"draft", "newer">>} ELSE {})

TypeOK ==
  /\ phase \in {"shut", "idle", "recording", "processing", "extracting", "ready", "error"}
  /\ flightT \in {"none", "live", "stale"}
  /\ flightX \in {"none", "live", "stale"}
  /\ text \in BOOLEAN /\ filled \in BOOLEAN /\ revised \in BOOLEAN
  /\ e1 \in {"absent", "saved", "dup"} /\ e2 \in {"absent", "saved"}
  /\ c1 \in BOOLEAN /\ c2 \in BOOLEAN /\ snap2 \in BOOLEAN
  /\ busy \in BOOLEAN /\ undo \in BOOLEAN /\ dropped \in BOOLEAN
  /\ banned \in BOOLEAN /\ clobber \in BOOLEAN /\ storeOk \in BOOLEAN
  /\ wrongWrite \in BOOLEAN /\ lateSeen \in BOOLEAN /\ failSeen \in BOOLEAN
  /\ undoSeen \in BOOLEAN /\ retrySeen \in BOOLEAN /\ draftStored \in BOOLEAN
  /\ research \in 0..3 /\ newest \in 0..3 /\ storedAt \in 0..3
  /\ owed \in BOOLEAN /\ editorResearch \in 0..3 /\ snapResearch \in 0..3
  /\ fresh \in BOOLEAN /\ owedNote \in BOOLEAN
  /\ resurrected \in BOOLEAN /\ lateDeleteSeen \in BOOLEAN
  /\ cardStale \in BOOLEAN /\ owedExtra \in BOOLEAN /\ extra \in BOOLEAN
  /\ note \in 0..2 /\ draftNote \in 0..2 /\ best \in 0..2
  /\ laundered \in BOOLEAN
  /\ editorNote \in 0..2 /\ snapNote \in 0..2
  /\ touch \in {"none", "note", "field"}
  /\ pending \in BOOLEAN /\ newerKept \in BOOLEAN
  /\ afterField \in 0..2 /\ researchExtra \in BOOLEAN
  /\ legacy \in BOOLEAN /\ rowLegacy \in BOOLEAN
  /\ typed \in 0..2
  /\ summaryStale \in BOOLEAN /\ pinDropped \in BOOLEAN
  /\ draftLost \in BOOLEAN /\ editorPinsStale \in BOOLEAN
  /\ loadStamp \in {"idle", "none", "memory", "stored", "searched"}
  /\ tabDraft \in {"idle", "newer", "searched"} /\ tabLost \in BOOLEAN /\ staleDraftWon \in BOOLEAN /\ pinTouched \in BOOLEAN

\* After save returns, that id is still in the store until the person deletes it.
ConfirmedPresent ==
  /\ (c1 => e1 \in {"saved", "dup"})
  /\ (c2 => e2 = "saved")

\* One capture produces one stored record. Save again updates that id.
NoDuplicate == e1 /= "dup"

\* A late extraction does not rewrite a draft, saved or still open.
LateSafe == ~clobber

\* Discard draft never puts that voice into the notebook.
DiscardStaysOut == ~banned

\* A failed write does not leave the store unreadable.
StoreParseable == storeOk

\* The id written is the id that was open.
WritesIntended == ~wrongWrite

\* Research that committed is still on that stored entry.
ResearchKept == owed => research > 0

\* The stored research is never an older version than the newest search committed for this id.
NewestResearchKept == e1 \notin {"saved", "dup"} \/ research >= newest

\* The stored updated stamp is never older than a write that has committed for this id.
UpdatedMonotone == e1 \notin {"saved", "dup"} \/ storedAt >= newest

\* A note save that committed is not replaced by an older draft.
NewerNoteKept == owedNote => fresh

\* A deleted id is not put back when a search finishes.
NoResurrection == ~resurrected

\* A committed save's new readings stay on the row and on the kept search.
\* The screen rebuilds the row list from both, and the next save stores that.
ReadingsKept == owedExtra => (extra /\ researchExtra)

\* After a save is applied, the editor does not still show an older note.
\* The gap is allowed while the write is in flight and before the editor catches up.
EditorNoteNotStale ==
  \/ busy
  \/ pending
  \/ editorNote >= note

\* The stored note is never older than the newest note a write had to keep.
NewestNoteKept == note >= best

\* A note typed in the editor is not replaced by an older note before a save
\* stores it. A search must not make the stored note look newer.
TypedNoteKept == editorNote >= typed \/ note >= typed

\* The journal card shows the merged row, not the snapshot from before the merge.
CardMatchesStore == ~cardStale

\* map.summary is the kept note, not the incoming snapshot's leftover summary.
SummaryMatchesNote == ~summaryStale

\* A confirmed pin stays on the stored row unless a newer removal writes it away.
PinsKept == ~pinDropped

\* A draft from before the stamps keeps its edit, whatever it is, through
\* load and every later search or save.
LegacyDraftKept == ~draftLost
TabDraftKept == ~tabLost

\* A search on a row and draft with no stamps keeps the stored row (#46).
SearchKeepsStoredOnTie == ~staleDraftWon

\* Once a save or search is applied, the editor's pins are the row's pins,
\* so the next pin edit does not write a shorter list over the row.
EditorPinsCurrent == busy \/ pending \/ ~editorPinsStale

CoverSaved == ~(c1 /\ e1 = "saved" /\ ~busy)
CoverDiscard == ~dropped
CoverLate == ~lateSeen
CoverUndo == ~undoSeen
CoverRetry == ~retrySeen
CoverTwo == ~(c1 /\ e1 = "saved" /\ c2 /\ e2 = "saved")
CoverFail == ~failSeen
CoverEdit == ~(revised /\ c1 /\ e1 = "saved")
CoverDraft == ~draftStored
CoverResearch == ~(owed /\ research > 0 /\ e1 \in {"saved", "dup"})
CoverNewer == ~(research = 3 /\ snapResearch = 2 /\ ~busy /\ retrySeen /\ ~failSeen /\ e1 \in {"saved", "dup"})
CoverNote == ~(owedNote /\ fresh)
CoverGone == ~lateDeleteSeen
CoverReadings == ~(owedExtra /\ extra /\ researchExtra /\ research >= 2 /\ ~busy /\ ~pending /\ e1 \in {"saved", "dup"})
CoverNewestNote == ~(note = 2 /\ best = 2 /\ draftNote = 2)
CoverMerged == ~(c1 /\ ~cardStale /\ ~busy /\ ~pending /\ research > snapResearch /\ snapResearch > 0 /\ e1 \in {"saved", "dup"})
CoverFieldSecond == ~(afterField = 2 /\ ~pending /\ ~busy /\ editorNote >= note)
CoverPinEdit == ~(pending /\ pinTouched)
CoverSearchAfterLoad == loadStamp # "searched"
CoverTwoTabSearch == tabDraft # "searched"
CoverLegacyFieldSecond == ~(afterField = 2 /\ ~pending /\ ~busy /\ editorNote >= note /\ ~legacy /\ ~rowLegacy)

Init ==
  /\ phase = "shut"
  /\ flightT = "none" /\ flightX = "none"
  /\ text = FALSE /\ filled = FALSE /\ revised = FALSE
  /\ e1 = "absent" /\ e2 = "absent"
  /\ c1 = FALSE /\ c2 = FALSE /\ snap2 = FALSE
  /\ busy = FALSE /\ undo = FALSE /\ dropped = FALSE
  /\ banned = FALSE /\ clobber = FALSE /\ storeOk = TRUE
  /\ wrongWrite = FALSE /\ lateSeen = FALSE /\ failSeen = FALSE
  /\ undoSeen = FALSE /\ retrySeen = FALSE /\ draftStored = FALSE
  /\ research = 0 /\ newest = 0 /\ storedAt = 0
  /\ owed = FALSE /\ editorResearch = 0 /\ snapResearch = 0
  /\ fresh = FALSE /\ owedNote = FALSE
  /\ resurrected = FALSE /\ lateDeleteSeen = FALSE
  /\ cardStale = FALSE /\ owedExtra = FALSE /\ extra = FALSE
  /\ note = 0 /\ draftNote = 0 /\ best = 0 /\ laundered = FALSE
  /\ editorNote = 0 /\ snapNote = 0 /\ touch = "none"
  /\ pending = FALSE /\ newerKept = FALSE
  /\ afterField = 0 /\ researchExtra = FALSE
  /\ legacy = TRUE /\ rowLegacy = TRUE
  /\ typed = 0
  /\ summaryStale = FALSE /\ pinDropped = FALSE
  /\ draftLost = FALSE /\ editorPinsStale = FALSE
  /\ loadStamp = "idle" /\ tabDraft = "idle" /\ tabLost = FALSE /\ staleDraftWon = FALSE /\ pinTouched = FALSE

panel == phase \in {"idle", "ready", "error", "extracting"}

\* The voice button opens the editor. Nothing is stored yet.
OpenVoice ==
  /\ ~pending
  /\ phase = "shut" /\ ~busy
  /\ phase' = "idle"
  /\ text' = FALSE
  /\ flightT' = "none"
  /\ UNCHANGED <<flightX, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* record() bumps the recording generation and stops extraction.
StartRecording ==
  /\ ~pending
  /\ panel /\ ~busy
  /\ phase' = "recording"
  /\ flightT' = "none"
  /\ flightX' = IF flightX = "live" THEN "stale" ELSE flightX
  /\ UNCHANGED <<text, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

StopRecording ==
  /\ phase = "recording"
  /\ phase' = "processing"
  /\ flightT' = "live"
  /\ UNCHANGED <<flightX, text, filled, revised, e1, e2, c1, c2, snap2, busy,
       undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* Cancel, or leaving the screen while a capture is running.
\* The request may still finish. Its generation no longer matches.
CancelOrHide ==
  /\ phase \in {"recording", "processing"}
  /\ phase' = IF phase = "processing" THEN "error" ELSE "idle"
  /\ flightT' = IF flightT = "live" THEN "stale" ELSE flightT
  /\ flightX' = IF flightX = "live" THEN "stale" ELSE flightX
  /\ UNCHANGED <<text, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* Web path. The final transcript is shown and suggestions are local.
TranscriptReady ==
  /\ flightT = "live" /\ phase = "processing"
  /\ flightT' = "none"
  /\ phase' = "idle"
  /\ text' = TRUE
  /\ UNCHANGED <<flightX, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* Native path. The final transcript starts on-device extraction.
TranscriptStartsExtraction ==
  /\ flightT = "live" /\ phase = "processing"
  /\ flightT' = "none"
  /\ phase' = "extracting"
  /\ flightX' = "live"
  /\ text' = TRUE
  /\ UNCHANGED <<filled, revised, e1, e2, c1, c2, snap2, busy, undo, dropped,
       banned, clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen,
       retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* suggest-once and the generation check drop a finished-too-late transcript.
LateTranscript ==
  /\ ~pending
  /\ flightT = "stale"
  /\ flightT' = "none"
  /\ lateSeen' = TRUE
  /\ UNCHANGED <<phase, flightX, text, filled, revised, e1, e2, c1, c2, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

BeginExtraction ==
  /\ ~pending
  /\ phase = "idle" /\ text /\ flightX = "none" /\ ~busy
  /\ phase' = "extracting"
  /\ flightX' = "live"
  /\ UNCHANGED <<flightT, text, filled, revised, e1, e2, c1, c2, snap2, busy,
       undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

ExtractionReady ==
  /\ ~pending
  /\ flightX = "live"
  /\ flightX' = "none"
  /\ phase' = "ready"
  /\ UNCHANGED <<flightT, text, filled, revised, e1, e2, c1, c2, snap2, busy,
       undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* The generation check. SkipGenerationGuard is the mutant that deletes it.
LateExtraction ==
  /\ ~pending
  /\ flightX = "stale"
  /\ flightX' = "none"
  /\ IF SkipGenerationGuard
     THEN /\ clobber' = TRUE
          /\ phase' = IF phase \in {"recording", "processing", "shut"}
                      THEN phase ELSE "ready"
          /\ UNCHANGED <<flightT, text, filled, revised, e1, e2, c1, c2, snap2,
               busy, undo, dropped, banned, storeOk, wrongWrite, lateSeen,
               failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
     ELSE /\ lateSeen' = TRUE
          /\ UNCHANGED <<phase, flightT, text, filled, revised, e1, e2, c1, c2,
               snap2, busy, undo, dropped, banned, clobber, storeOk,
               wrongWrite, failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

EditTranscript ==
  /\ phase \in {"idle", "ready", "error"} /\ text
  /\ phase' = "idle"
  /\ UNCHANGED <<flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* Add to entry. Confirms the proposal, merges it into the open id, closes.
ApplyToEntry ==
  /\ panel /\ text /\ flightX /= "live" /\ ~busy
  /\ phase' = "shut"
  /\ text' = FALSE
  /\ filled' = TRUE
  /\ dropped' = FALSE
  /\ draftStored' = FALSE
  /\ flightX' = "none"
  /\ UNCHANGED <<flightT, revised, e1, e2, c1, c2, snap2, busy, undo, banned,
       clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
       research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* Discard draft calls cancelCapture and close, and does not call onApply.
DiscardDraft ==
  /\ panel /\ text /\ ~busy
  /\ phase' = "shut"
  /\ text' = FALSE
  /\ dropped' = TRUE
  /\ flightX' = IF flightX = "live" THEN "stale" ELSE flightX
  /\ IF SaveOnDiscard
     THEN /\ filled' = TRUE /\ banned' = TRUE /\ e1' = "saved" /\ c1' = TRUE
     ELSE UNCHANGED <<filled, banned, e1, c1>>
  /\ UNCHANGED <<flightT, revised, e2, c2, snap2, busy, undo, clobber, storeOk,
       wrongWrite, lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* The X button. Keeps nothing in the notebook. A late result is now stale.
DismissVoice ==
  /\ phase /= "shut"
  /\ phase' = "shut"
  /\ text' = FALSE
  /\ flightT' = IF flightT = "live" THEN "stale" ELSE flightT
  /\ flightX' = IF flightX = "live" THEN "stale" ELSE flightX
  /\ UNCHANGED <<filled, revised, e1, e2, c1, c2, snap2, busy, undo, dropped,
       banned, clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen,
       retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* A pin or a chosen region. Not the viewport PNG, which is export-only.
PlacePin ==
  /\ ~pending
  /\ phase = "shut" /\ ~busy /\ ~filled
  /\ filled' = TRUE
  /\ draftStored' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, revised, e1, e2, c1, c2, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen,
       failSeen, undoSeen, retrySeen, research, newest, storedAt, owed, editorResearch,
       snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* change() patches the open entry and leaves its id alone.
EditEntry ==
  /\ ~pending
  /\ phase = "shut" /\ ~busy /\ filled /\ (~revised \/ draftStored)
  /\ revised' = TRUE
  /\ draftStored' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, e1, e2, c1, c2, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen,
       failSeen, undoSeen, retrySeen, research, newest, storedAt, owed, editorResearch,
       snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* saveDraft writes the one settings record.
FlushDraft ==
  /\ ~pending
  /\ filled /\ ~draftStored /\ ~busy /\ phase = "shut"
  /\ draftStored' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, research, newest, storedAt, owed,
       editorResearch, snapResearch, fresh, owedNote, resurrected,
       lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

DraftFails ==
  /\ ~pending
  /\ filled /\ ~draftStored /\ ~failSeen /\ ~busy /\ phase = "shut"
  /\ failSeen' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* commit() copies the open entry, then storeEntries runs.
\* The copy's research bit is snapResearch. A double tap does nothing.
PressSave ==
  /\ UNCHANGED pinTouched
  /\ filled /\ ~busy /\ ~pending /\ phase = "shut"
  /\ busy' = TRUE
  /\ snapResearch' = editorResearch
  /\ snapNote' = editorNote
  /\ touch' = "none"
  /\ newerKept' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed,
       editorResearch, fresh, owedNote, resurrected, lateDeleteSeen, editorNote, pending, afterField, researchExtra, legacy, typed>>
  /\ UNCHANGED noteVars

DoubleTap ==
  /\ busy
  /\ UNCHANGED vars

\* AheadOk: both rows were saved before noteUpdated existed, and another writer
\* left a newer note on the stored row while this save was writing. Both stamps
\* are missing, so they tie. That write is folded into this step, so a save that
\* fails or a reload in between never sees it.
AheadOk ==
  /\ ModelRaces /\ legacy /\ rowLegacy /\ ~newerKept
  /\ note < 2 /\ snapNote = note /\ draftNote <= note

SaveCommits ==
  /\ UNCHANGED pinTouched
  /\ busy
  /\ \E ahead \in IF AheadOk THEN BOOLEAN ELSE {FALSE} :
     LET land == snapResearch = 1 /\ research >= 2 /\ ~DropResearch /\ ~OverwriteNewerResearch
         stored == IF (ModelRaces /\ newerKept /\ note < 2) \/ ahead THEN note + 1 ELSE note
         drafted == IF ModelRaces /\ draftNote > stored THEN draftNote ELSE stored
         ranked == IF ModelRaces /\ snapNote > drafted THEN snapNote ELSE drafted
         \* Old noteStamp used updated. An unstamped editor with a later field
         \* edit then looks newer than a stamped stored note.
         overwrite == FallbackToUpdated /\ legacy /\ ~rowLegacy
         \* Both stamps missing. The real merge keeps the stored note on a tie.
         tie == TieTakesIncoming /\ legacy /\ rowLegacy
         chosen == IF overwrite \/ tie THEN snapNote ELSE ranked
         kept == IF ahead /\ stored > chosen THEN stored ELSE chosen
     IN /\ busy' = FALSE
        /\ retrySeen' = (retrySeen \/ (e1 = "saved" /\ ~WriteWrongId /\ ~ReplaceWholeNotebook))
        /\ newerKept' = FALSE
        /\ IF WriteWrongId
           THEN /\ wrongWrite' = TRUE
                /\ e2' = "saved"
                /\ pending' = FALSE
                /\ UNCHANGED <<e1, c1, c2, banned, storeOk, research, newest, storedAt, owed,
                     editorResearch, snapResearch, fresh, owedNote, resurrected,
                     lateDeleteSeen, editorNote, snapNote, touch, afterField, researchExtra, legacy, typed>>
                /\ UNCHANGED noteVars
           ELSE /\ wrongWrite' = FALSE
                /\ e1' = IF ReplaceWholeNotebook
                           THEN "saved"
                           ELSE IF AppendOnSave /\ e1 = "saved" THEN "dup" ELSE "saved"
                /\ c1' = TRUE
                /\ e2' = IF ReplaceWholeNotebook
                           THEN (IF snap2 THEN "saved" ELSE "absent")
                           ELSE e2
                /\ c2' = c2
                /\ banned' = banned
                /\ storeOk' = storeOk
                /\ pending' = ModelRaces
                /\ afterField' = IF (CountFieldSecond \/ CountLegacyFieldSecond) /\ afterField = 1 THEN 2 ELSE afterField
                /\ research' = IF ~ModelRaces THEN research
                               ELSE IF DropResearch THEN snapResearch
                               ELSE IF OverwriteNewerResearch /\ snapResearch > 0
                                    THEN snapResearch
                               ELSE IF snapResearch > research THEN snapResearch
                               ELSE research
                /\ storedAt' = IF ~ModelRaces THEN storedAt
                               ELSE IF KeepOlderUpdated THEN snapResearch
                               ELSE IF snapResearch > storedAt THEN snapResearch
                               ELSE storedAt
                /\ fresh' = IF ModelRaces THEN TRUE ELSE fresh
                /\ owedNote' = IF ModelRaces THEN TRUE ELSE owedNote
                /\ cardStale' = (ShowPreMerge /\ snapResearch > 0 /\ snapResearch < research /\ ~DropResearch /\ ~OverwriteNewerResearch)
                /\ owedExtra' = (owedExtra \/ land)
                /\ extra' = IF DropIncomingReadings /\ land THEN FALSE
                            ELSE IF land THEN TRUE
                            ELSE extra
                /\ researchExtra' = IF land /\ (DropIncomingReadings \/ UnionTopLevelOnly) THEN FALSE
                                    ELSE IF land THEN TRUE
                                    ELSE researchExtra
                /\ note' = chosen
                /\ best' = IF ~ModelRaces THEN best ELSE IF kept > best THEN kept ELSE best
                /\ rowLegacy' = FALSE
                /\ summaryStale' = (StaleSummary /\ chosen /= snapNote)
                /\ pinDropped' = (DropStoredPins /\ e1 = "saved")
                /\ UNCHANGED <<draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>
                /\ UNCHANGED <<newest, owed, editorResearch, snapResearch, resurrected,
                     lateDeleteSeen, draftNote, laundered, editorNote, snapNote, touch, legacy, typed>>
        /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, snap2, undo,
             dropped, clobber, lateSeen, failSeen, undoSeen, draftStored>>

\* onerror / abort. The real transaction does not publish its puts.
SaveFails ==
  /\ busy /\ ~failSeen
  /\ busy' = FALSE
  /\ failSeen' = TRUE
  /\ newerKept' = FALSE
  /\ touch' = "none"
  /\ pinTouched' = FALSE
  /\ pending' = FALSE
  /\ IF CorruptOnFailedWrite
     THEN /\ storeOk' = FALSE
          /\ e1' = "absent"
          /\ e2' = "absent"
          \* The wiped store holds no confirmed ids. Leaving c1/c2 set let
          \* ConfirmedPresent and StoreParseable both fail, and which one TLC
          \* reported depended on worker order.
          /\ c1' = FALSE
          /\ c2' = FALSE
          /\ research' = 0
          /\ newest' = 0
          /\ storedAt' = 0
          /\ owed' = FALSE
          /\ editorResearch' = 0
          /\ snapResearch' = 0
          /\ fresh' = FALSE
          /\ owedNote' = FALSE
          /\ cardStale' = FALSE /\ owedExtra' = FALSE /\ extra' = FALSE
          /\ note' = 0 /\ draftNote' = 0 /\ best' = 0 /\ laundered' = FALSE
          /\ editorNote' = 0 /\ snapNote' = 0
          /\ afterField' = 0 /\ researchExtra' = FALSE
          /\ legacy' = TRUE /\ rowLegacy' = TRUE /\ typed' = 0
          /\ summaryStale' = FALSE /\ pinDropped' = FALSE
          /\ draftLost' = FALSE /\ editorPinsStale' = FALSE
          /\ loadStamp' = "idle" /\ tabDraft' = "idle" /\ tabLost' = FALSE /\ staleDraftWon' = FALSE
     ELSE /\ snapNote' = editorNote
          /\ UNCHANGED <<storeOk, e1, e2, c1, c2, research, newest, storedAt, owed, editorResearch,
               snapResearch, fresh, owedNote, editorNote, afterField, researchExtra, legacy, typed>>
          /\ UNCHANGED noteVars
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, snap2,
       undo, dropped, banned, clobber, wrongWrite, lateSeen, undoSeen,
       retrySeen, draftStored, resurrected, lateDeleteSeen>>

DeleteEntry ==
  /\ ~busy /\ ~pending /\ phase = "shut" /\ e1 \in {"saved", "dup"}
  /\ e1' = "absent" /\ c1' = FALSE /\ undo' = TRUE
  /\ filled' = FALSE /\ revised' = FALSE /\ draftStored' = FALSE
  /\ text' = FALSE
  /\ research' = 0 /\ newest' = 0 /\ storedAt' = 0 /\ owed' = FALSE
  /\ editorResearch' = 0 /\ snapResearch' = 0
  /\ fresh' = FALSE /\ owedNote' = FALSE
  /\ cardStale' = FALSE /\ owedExtra' = FALSE /\ extra' = FALSE
  /\ note' = 0 /\ draftNote' = 0 /\ best' = 0 /\ laundered' = FALSE
  /\ editorNote' = 0 /\ snapNote' = 0 /\ touch' = "none"
  /\ pending' = FALSE /\ newerKept' = FALSE
  /\ afterField' = 0 /\ researchExtra' = FALSE
  /\ legacy' = TRUE /\ rowLegacy' = TRUE /\ typed' = 0
  /\ summaryStale' = FALSE /\ pinDropped' = FALSE
          /\ draftLost' = FALSE /\ editorPinsStale' = FALSE
          /\ loadStamp' = "idle" /\ tabDraft' = "idle" /\ tabLost' = FALSE /\ staleDraftWon' = FALSE
  /\ UNCHANGED pinTouched
  /\ UNCHANGED <<phase, flightT, flightX, e2, c2, snap2, busy, dropped, banned,
       clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
       resurrected, lateDeleteSeen>>

UndoDelete ==
  /\ ~pending
  /\ undo /\ ~busy
  /\ e1' = "saved" /\ c1' = TRUE /\ undo' = FALSE /\ undoSeen' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e2, c2, snap2,
       busy, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* Opening the app again. Voice panel memory is not in the database.
\* Entries stay as the last committed transaction left them.
\* An in-flight save is no longer on screen, so its edit flags do not stick.
Reload ==
  /\ UNCHANGED pinTouched
  /\ ~pending
  /\ phase' = "shut"
  /\ flightT' = "none" /\ flightX' = "none"
  /\ text' = FALSE
  /\ busy' = FALSE
  /\ snap2' = (e2 = "saved")
  /\ touch' = "none"
  /\ newerKept' = FALSE
  /\ snapNote' = editorNote
  /\ UNCHANGED <<filled, revised, e1, e2, c1, c2, undo, dropped, banned,
       clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
       draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED <<editorNote, pending, afterField, researchExtra, legacy, typed>>

\* A second tab puts a different id. It does not replace this tab's record.
OtherTabSaves ==
  /\ ~pending
  /\ e2 = "absent"
  /\ e2' = "saved" /\ c2' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, c1, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen,
       failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* saveResearch commits the next version onto the saved id. The in-flight
\* snapshot stays as it was at PressSave. The editor catches up only when
\* no save is in flight, which is when setEntry runs before the next snapshot.
ResearchLands ==
  /\ ~pending
  /\ ModelRaces
  /\ e1 \in {"saved", "dup"}
  /\ phase = "shut"
  /\ newest < 3
  /\ newest' = IF newest < 2 THEN 2 ELSE 3
  /\ research' = newest'
  /\ storedAt' = newest'
  /\ owed' = TRUE
  /\ editorResearch' = IF busy THEN editorResearch ELSE newest'
  /\ snapResearch' = IF busy THEN snapResearch ELSE 0
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored,
       fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* saveResearch after a newer storeEntries. The real merge keeps the row
\* with the later updated time. PreferStaleDraft always uses the draft.
ResearchFromDraft ==
  /\ ~pending
  /\ ModelRaces
  /\ e1 \in {"saved", "dup"}
  /\ fresh /\ ~busy /\ phase = "shut"
  /\ newest' = IF newest < 2 THEN 2 ELSE IF newest < 3 THEN 3 ELSE newest
  /\ research' = newest'
  /\ storedAt' = newest'
  /\ owed' = TRUE
  /\ editorResearch' = newest'
  /\ snapResearch' = 0
  /\ fresh' = IF PreferStaleDraft THEN FALSE ELSE fresh
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored,
       owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* A search finishes after removeEntry. deleted-ids makes this a no-op.
\* RestoreDeleted puts the row back from the leftover draft.
ResearchAfterDelete ==
  /\ ~pending
  /\ ModelRaces
  /\ undo /\ e1 = "absent" /\ ~lateDeleteSeen
  /\ lateDeleteSeen' = TRUE
  /\ IF RestoreDeleted
     THEN /\ resurrected' = TRUE
          /\ e1' = "saved"
          /\ research' = 2
          /\ newest' = 2
          /\ storedAt' = 2
          /\ owed' = TRUE
     ELSE UNCHANGED <<resurrected, e1, research, newest, storedAt, owed>>
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, editorResearch,
       snapResearch, fresh, owedNote>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* A stored row whose search has no version. Older than any stamped search.
StoreVersionless ==
  /\ ~pending
  /\ ModelRaces
  /\ ~busy /\ phase = "shut"
  /\ e1 \in {"saved", "dup"}
  /\ research = 0 /\ editorResearch = 0
  /\ research' = 1
  /\ editorResearch' = 1
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, newest, storedAt,
       owed, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED editorVars

\* The user types a newer note. It lives in the draft until a write keeps it.
\* Typing never moves the editor back to an older rank.
TypeNote ==
  /\ UNCHANGED pinTouched
  /\ ModelRaces
  /\ ~busy /\ ~pending /\ phase = "shut" /\ filled
  /\ e1 \in {"saved", "dup"}
  /\ research >= 2
  /\ draftNote < 2
  /\ draftNote' = draftNote + 1
  /\ editorNote' = IF editorNote > draftNote' THEN editorNote ELSE draftNote'
  /\ snapNote' = editorNote'
  /\ legacy' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen, cardStale, owedExtra, extra, note, best,
       laundered, touch, pending, newerKept, afterField, researchExtra, rowLegacy, typed,
       summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>

\* The old save copies the research stamp onto an older note.
StaleNoteSave ==
  /\ RestoreStaleNote /\ ModelRaces
  /\ ~busy /\ ~pending /\ phase = "shut"
  /\ e1 \in {"saved", "dup"}
  /\ research >= 2
  /\ draftNote > note
  /\ ~laundered
  /\ laundered' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen, cardStale, owedExtra, extra, note,
       draftNote, best, rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>
  /\ UNCHANGED editorVars

\* saveResearch keeps the newer note. The mutant writes the laundered note.
ResearchKeepsNote ==
  /\ UNCHANGED pinTouched
  /\ ModelRaces
  /\ ~busy /\ ~pending /\ phase = "shut"
  /\ e1 \in {"saved", "dup"}
  /\ draftNote > note
  /\ IF RestoreStaleNote
     THEN /\ laundered
          /\ best' = draftNote
          /\ note' = note
          /\ editorNote' = note
          /\ UNCHANGED legacy
     ELSE /\ note' = draftNote
          /\ best' = draftNote
          /\ editorNote' = draftNote
          /\ legacy' = FALSE
  /\ snapNote' = editorNote'
  /\ summaryStale' = (StaleSummary /\ draftNote /= note)
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen, cardStale, owedExtra, extra, draftNote,
       laundered, touch, pending, newerKept, afterField, researchExtra, rowLegacy, typed,
       pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>

\* A title, pin, or context edit while storeEntries is writing.
\* updated changes. The note stamp does not.
EditFieldWhileSaving ==
  /\ UNCHANGED pinTouched
  /\ ModelRaces /\ busy /\ ~pending /\ touch = "none"
  /\ touch' = "field"
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED <<editorNote, snapNote, pending, newerKept, afterField, researchExtra, legacy, typed>>

\* The note itself changes while storeEntries is writing.
\* The draft rank moves with it, same as a note typed while the screen is idle.
EditNoteWhileSaving ==
  /\ UNCHANGED pinTouched
  /\ ModelRaces /\ busy /\ ~pending /\ touch = "none" /\ editorNote < 2
  /\ touch' = "note"
  /\ editorNote' = editorNote + 1
  /\ draftNote' = editorNote'
  /\ legacy' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen, snapNote, pending, newerKept, afterField, researchExtra, typed>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, best, laundered, rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>

\* keepLandedResearch keeps a stored note whose stamp is newer than the snapshot.
\* The row already exists. The editor still shows the snapshot note, so this is
\* not a note the user typed during the save. The merge reveals that stored note.
MergeKeepsNewer ==
  /\ UNCHANGED pinTouched
  /\ ModelRaces /\ busy /\ ~pending /\ ~newerKept
  /\ e1 \in {"saved", "dup"}
  /\ note < 2 /\ snapNote = note /\ editorNote = snapNote
  /\ newerKept' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED <<editorNote, snapNote, touch, pending, afterField, researchExtra, legacy, typed>>

\* editorAfterSave. A note edit keeps the editor note.
\* Any other edit, or no edit, takes the stored note.
\* Compare note text and noteUpdated. A missing stamp is compared as-is.
\* The old fallback treated a field edit on a row with no noteUpdated as a note edit.
EditorAfterSave ==
  /\ pending
  /\ LET keep == touch = "note"
                 \/ (KeepEditorNoteOnAnyEdit /\ touch = "field")
                 \/ (FallbackToUpdated /\ touch = "field" /\ legacy)
         counted == touch = "field" /\ ~keep /\ afterField = 0
                    /\ (IF CountLegacyFieldSecond THEN legacy ELSE CountFieldSecond)
     IN /\ pending' = FALSE
        /\ touch' = "none"
        /\ editorNote' = IF keep THEN editorNote ELSE note
        /\ snapNote' = editorNote'
        /\ legacy' = IF keep THEN legacy ELSE FALSE
        /\ afterField' = IF counted THEN 1 ELSE afterField
        \* The merge can keep stored pins. A note or other edit during the save
        \* still takes the row's pins. The mutant leaves the editor's older list.
        \* A pin edit during the save is merged per pin onto the saved pins.
        \* SkipPinsOnPinEdit keeps only the editor's list.
        /\ editorPinsStale' = \/ (EditorKeepsOldPins /\ touch = "note")
                              \/ (SkipPinsOnPinEdit /\ pinTouched)
        /\ pinTouched' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen, newerKept, researchExtra, typed>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, draftLost, loadStamp, tabDraft, tabLost, staleDraftWon>>

\* The user types a note. The draft write has not run yet. A search then lands
\* on a row whose note has no noteUpdated. saveResearch stamps that note with
\* the row's own updated, which is older than the typed stamp, so
\* withStampedResearch keeps the typed note. SearchStampsNow stamps the stored
\* note with the search time, and the older note replaces the typed one.
SearchOverTypedNote ==
  /\ UNCHANGED pinTouched
  /\ ModelRaces /\ ~busy /\ ~pending /\ phase = "shut" /\ filled
  /\ e1 \in {"saved", "dup"} /\ rowLegacy
  /\ note < 2 /\ editorNote = note /\ draftNote = note
  /\ newest < 3
  /\ newest' = IF newest < 2 THEN 2 ELSE 3
  /\ research' = newest'
  /\ storedAt' = newest'
  /\ owed' = TRUE
  /\ editorResearch' = newest'
  /\ snapResearch' = 0
  /\ typed' = note + 1
  /\ editorNote' = IF SearchStampsNow THEN note ELSE note + 1
  /\ snapNote' = editorNote'
  /\ legacy' = FALSE
  /\ rowLegacy' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored,
       fresh, owedNote, resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost, staleDraftWon>>
  /\ UNCHANGED <<touch, pending, newerKept, afterField, researchExtra>>

\* loadNotebook reads a draft for a row, and neither has a noteUpdated or
\* pointsUpdated stamp. The draft differs: added, deleted, or rewritten text, a
\* moved, re-commented, added, or removed pin. The draft exists only because of
\* unsaved typing, so load takes it, stamps it, and writes the stamped draft
\* back in the same transaction before it resolves. LegacyKeepsStored keeps
\* the stored row. LoadSkipsStamp takes the draft without a stamp.
\* LoadStampsInMemoryOnly stamps the editor's copy and leaves the stored draft
\* unstamped until the autosave runs about 280 ms later.
LoadLegacyDraft ==
  /\ ModelRaces /\ ~busy /\ ~pending /\ phase = "shut"
  /\ e1 \in {"saved", "dup"} /\ rowLegacy /\ legacy /\ ~draftLost /\ loadStamp = "idle"
  /\ draftLost' = LegacyKeepsStored
  /\ loadStamp' = IF LegacyKeepsStored THEN "idle"
                  ELSE IF LoadSkipsStamp THEN "none"
                  ELSE IF LoadStampsInMemoryOnly THEN "memory"
                  ELSE "stored"
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, editorPinsStale, tabDraft, tabLost, staleDraftWon>>
  /\ UNCHANGED editorVars

\* A search right after that load, before the autosave writes the draft.
\* saveResearch merges the stored row with the stored draft and the editor it
\* is given, and keeps stored on a missing-stamp tie. src "editor" is the tab
\* that loaded, so its editor carries the in-memory stamp. src "other" is a
\* reader without that editor (a second tab on the entry), so only a stamp in
\* the stored draft saves the edit.
SearchAfterLegacyLoad ==
  /\ loadStamp \in {"none", "memory", "stored"}
  /\ \E src \in {"editor", "other"}:
       draftLost' = CASE loadStamp = "stored" -> FALSE
                      [] loadStamp = "memory" -> src = "other"
                      [] OTHER -> TRUE
  /\ loadStamp' = IF MarkSearch THEN "searched" ELSE "idle"
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, editorPinsStale, tabDraft, tabLost, staleDraftWon>>
  /\ UNCHANGED editorVars

\* saveResearch reads a draft that was never loaded and stamped (a stale write
\* from before the last save), and neither side has a stamp. The search keeps
\* the stored row. LegacyResearchTakesDraft writes the draft over it.
LegacyResearchTie ==
  /\ ModelRaces /\ ~busy /\ ~pending /\ phase = "shut"
  /\ e1 \in {"saved", "dup"} /\ rowLegacy /\ ~staleDraftWon
  /\ staleDraftWon' = LegacyResearchTakesDraft
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, tabDraft, tabLost>>
  /\ UNCHANGED editorVars

\* A pin is added, moved, re-commented, or removed while storeEntries writes.
EditPinWhileSaving ==
  /\ ModelRaces /\ busy /\ ~pending /\ ~pinTouched
  /\ pinTouched' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED <<editorNote, snapNote, touch, pending, newerKept, afterField, researchExtra, legacy, typed>>

Wait ==
  UNCHANGED vars

\* The 280 ms between a legacy load and its autosave. Only a search or the
\* autosave runs in it, which keeps the state space near its old size.
LoadWindow == loadStamp \in {"none", "memory", "stored"}

\* The autosave writes the editor's stamped draft and closes the window.
\* LoadSkipsStamp has no stamp to write, so its window ends only in a search.
AutosaveAfterLoad ==
  /\ loadStamp \in {"memory", "stored"}
  /\ loadStamp' = "idle"
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, tabDraft, tabLost, staleDraftWon>>
  /\ UNCHANGED editorVars

\* Two tabs have the entry open. The other tab autosaves a newer note or pin
\* to the shared draft. This tab's editor is older.
OtherTabSavesDraft ==
  /\ ModelRaces /\ ~busy /\ ~pending /\ phase = "shut"
  /\ e1 \in {"saved", "dup"} /\ tabDraft = "idle" /\ ~tabLost
  /\ tabDraft' = "newer"
  /\ UNCHANGED tabLost
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, staleDraftWon>>
  /\ UNCHANGED editorVars

\* The row saveResearch writes, as the set of items on it. Note and pins go by
\* their own stamps, so the draft's newer ones win. Readings union by URL,
\* answers merge by question, and blank map details fill from older records,
\* so the row holds every record's items. WholeRecordByUpdated (dc337c7) takes
\* readings, answers and details from the newest record only.
\* SearchPrefersEditor (0db75f3) reads the editor in place of the saved draft.
\* A superseded value loses to the draft: a stale detail and an old AI note
\* to its newer stamps, an older unstamped value to the newer record.
\* FillBlankDetails (c8b260d) fills the draft's cleared blank from the stale
\* detail; PickFirstAi (1af0a35) takes the old AI note over the removal.
Superseded(h, fam) == {i \in StoredRec(h) \cup EditorRec(h) : i[2] = fam}
Stale(h) == Superseded(h, "stale") \cup Superseded(h, "oldai") \cup Superseded(h, "older")
Needed(h) == DraftRec(h) \cup ((StoredRec(h) \cup EditorRec(h)) \ Stale(h))
Kept(h, row) == Needed(h) \subseteq row /\ row \cap Stale(h) = {}

SearchRow(h) ==
  LET recs == IF SearchPrefersEditor THEN {StoredRec(h), EditorRec(h)}
              ELSE {StoredRec(h), DraftRec(h), EditorRec(h)}
      newestRec == IF SearchPrefersEditor THEN EditorRec(h) ELSE DraftRec(h)
      stamped == {i \in UNION recs : i[2] \in {"note", "pins"}}
      gone == Stale(h)
                   \ ((IF FillBlankDetails THEN Superseded(h, "stale") ELSE {})
                      \cup (IF PickFirstAi THEN Superseded(h, "oldai") ELSE {}))
      merged == UNION recs \ gone
  IN stamped \cup (IF WholeRecordByUpdated THEN newestRec ELSE merged)

\* What withStampedResearch hands this tab's editor. It takes the whole row,
\* so the editor holds every merged item and no superseded one.
\* HandBackNoteOnly (c8b260d) takes only the note and pins and keeps the
\* editor's own items. keyed: a keystroke landed after the search read now
\* and before the handback. The fix keeps an editor field only if it changed
\* since the search; HandBackByUpdated (1af0a35) ranks the editor newest by
\* updated, so its older unstamped value beats the draft's newer one.
EditorAfter(h, keyed) ==
  IF HandBackNoteOnly
  THEN EditorRec(h) \cup {i \in SearchRow(h) : i[2] \in {"note", "pins"}}
  ELSE IF HandBackByUpdated /\ keyed
  THEN (SearchRow(h) \ {<<"draft", "newer">>}) \cup (Superseded(h, "older") \cap EditorRec(h))
  ELSE SearchRow(h)

\* late: a later save or load lands an older draft that still holds the
\* stale detail or the old AI note, unstamped, over the row (storeEntries and
\* loadNotebook both go through keepLandedResearch). The row's newer stamps
\* win, so nothing comes back. LandIgnoresStamps (1af0a35) takes the draft's.
Landed(h, late) ==
  IF late /\ LandIgnoresStamps
  THEN EditorAfter(h, FALSE) \cup Superseded(h, "stale") \cup Superseded(h, "oldai")
  ELSE EditorAfter(h, FALSE)

\* This tab's research lands with its older editor. Every item any record
\* holds must be on the row, then on the editor after the handback (which the
\* autosave and the next save write back), then on the row after a later
\* save or load of an older draft. One step: the handback's choices are
\* existential, so the window adds no states beyond tabLost.
SearchWithOlderEditor ==
  /\ tabDraft = "newer"
  /\ \E h \in TabHeld, keyed \in BOOLEAN, late \in BOOLEAN :
       tabLost' = ~(Kept(h, SearchRow(h)) /\ Kept(h, EditorAfter(h, keyed))
                     /\ Kept(h, Landed(h, late)))
  /\ tabDraft' = IF MarkSearch THEN "searched" ELSE "idle"
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, staleDraftWon>>
  /\ UNCHANGED editorVars

\* The window closes without a search: this tab reloads or the other tab saves.
TabDraftSettles ==
  /\ tabDraft = "newer"
  /\ tabDraft' = "idle"
  /\ UNCHANGED tabLost
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest,
       storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
       resurrected, lateDeleteSeen>>
  /\ UNCHANGED <<cardStale, owedExtra, extra, note, draftNote, best, laundered,
       rowLegacy, summaryStale, pinDropped, draftLost, editorPinsStale, loadStamp, staleDraftWon>>
  /\ UNCHANGED editorVars

\* Like LoadWindow: only the search or the settle runs while the other tab's
\* newer draft is pending, which keeps the state space near its old size.
TabWindow == tabDraft = "newer"

Settled ==
  \/ OpenVoice
  \/ StartRecording
  \/ StopRecording
  \/ CancelOrHide
  \/ TranscriptReady
  \/ TranscriptStartsExtraction
  \/ LateTranscript
  \/ BeginExtraction
  \/ ExtractionReady
  \/ LateExtraction
  \/ EditTranscript
  \/ ApplyToEntry
  \/ DiscardDraft
  \/ DismissVoice
  \/ PlacePin
  \/ EditEntry
  \/ FlushDraft
  \/ DraftFails
  \/ PressSave
  \/ DoubleTap
  \/ SaveCommits
  \/ SaveFails
  \/ DeleteEntry
  \/ UndoDelete
  \/ Reload
  \/ OtherTabSaves
  \/ ResearchLands
  \/ ResearchFromDraft
  \/ ResearchAfterDelete
  \/ StoreVersionless
  \/ TypeNote
  \/ StaleNoteSave
  \/ ResearchKeepsNote
  \/ EditFieldWhileSaving
  \/ EditNoteWhileSaving
  \/ MergeKeepsNewer
  \/ EditorAfterSave
  \/ SearchOverTypedNote
  \/ LoadLegacyDraft
  \/ OtherTabSavesDraft
  \/ LegacyResearchTie
  \/ EditPinWhileSaving
  \/ Wait

Next ==
  IF LoadWindow THEN SearchAfterLegacyLoad \/ AutosaveAfterLoad
  ELSE IF TabWindow THEN SearchWithOlderEditor \/ TabDraftSettles
  ELSE Settled

\* Used only by cfg/chart.cfg so the picture stays readable.
\* The safety configs explore the whole reachable state space.
ChartSlice ==
  /\ ~c2
  /\ ~undo
  /\ ~undoSeen
  /\ ~failSeen
  /\ ~retrySeen
  /\ ~lateSeen
  /\ e1 /= "dup"
  /\ ~banned
  /\ ~clobber
  /\ storeOk
  /\ ~wrongWrite
  /\ flightT /= "stale"
  /\ flightX /= "stale"

Spec == Init /\ [][Next]_vars

====
