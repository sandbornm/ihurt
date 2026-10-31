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
  ModelRaces             \* FALSE only in the chart config, which omits these races

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
  research,    \* stored research version. 0 is none. 1 and 2 are committed searches
  newest,      \* newest research version committed for this id. 0 is none
  storedAt,    \* rank of the stored updated stamp. A search raises it
  owed,        \* a research write committed and the entry was not deleted since
  editorResearch, \* research version the open editor will snapshot next
  snapResearch,\* research version copied by the in-flight save
  fresh,       \* the stored note is the newer save, not an older draft
  owedNote,    \* that newer note must still be the one stored
  resurrected, \* a late search put a deleted id back
  lateDeleteSeen \* a search finished after the id was deleted

vars == <<
  phase, flightT, flightX, text, filled, revised,
  e1, e2, c1, c2, snap2, busy, undo, dropped, banned,
  clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
  draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote,
  resurrected, lateDeleteSeen
>>

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
  /\ research \in 0..2 /\ newest \in 0..2 /\ storedAt \in 0..2
  /\ owed \in BOOLEAN /\ editorResearch \in 0..2 /\ snapResearch \in 0..2
  /\ fresh \in BOOLEAN /\ owedNote \in BOOLEAN
  /\ resurrected \in BOOLEAN /\ lateDeleteSeen \in BOOLEAN

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
CoverNewer == ~(research = 2 /\ snapResearch = 1 /\ ~busy /\ retrySeen /\ ~failSeen /\ e1 \in {"saved", "dup"})
CoverNote == ~(owedNote /\ fresh)
CoverGone == ~lateDeleteSeen

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

panel == phase \in {"idle", "ready", "error", "extracting"}

\* The voice button opens the editor. Nothing is stored yet.
OpenVoice ==
  /\ phase = "shut" /\ ~busy
  /\ phase' = "idle"
  /\ text' = FALSE
  /\ flightT' = "none"
  /\ UNCHANGED <<flightX, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* record() bumps the recording generation and stops extraction.
StartRecording ==
  /\ panel /\ ~busy
  /\ phase' = "recording"
  /\ flightT' = "none"
  /\ flightX' = IF flightX = "live" THEN "stale" ELSE flightX
  /\ UNCHANGED <<text, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

StopRecording ==
  /\ phase = "recording"
  /\ phase' = "processing"
  /\ flightT' = "live"
  /\ UNCHANGED <<flightX, text, filled, revised, e1, e2, c1, c2, snap2, busy,
       undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

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

\* Web path. The final transcript is shown and suggestions are local.
TranscriptReady ==
  /\ flightT = "live" /\ phase = "processing"
  /\ flightT' = "none"
  /\ phase' = "idle"
  /\ text' = TRUE
  /\ UNCHANGED <<flightX, filled, revised, e1, e2, c1, c2, snap2, busy, undo,
       dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

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

\* suggest-once and the generation check drop a finished-too-late transcript.
LateTranscript ==
  /\ flightT = "stale"
  /\ flightT' = "none"
  /\ lateSeen' = TRUE
  /\ UNCHANGED <<phase, flightX, text, filled, revised, e1, e2, c1, c2, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

BeginExtraction ==
  /\ phase = "idle" /\ text /\ flightX = "none" /\ ~busy
  /\ phase' = "extracting"
  /\ flightX' = "live"
  /\ UNCHANGED <<flightT, text, filled, revised, e1, e2, c1, c2, snap2, busy,
       undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

ExtractionReady ==
  /\ flightX = "live"
  /\ flightX' = "none"
  /\ phase' = "ready"
  /\ UNCHANGED <<flightT, text, filled, revised, e1, e2, c1, c2, snap2, busy,
       undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* The generation check. SkipGenerationGuard is the mutant that deletes it.
LateExtraction ==
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

EditTranscript ==
  /\ phase \in {"idle", "ready", "error"} /\ text
  /\ phase' = "idle"
  /\ UNCHANGED <<flightT, flightX, text, filled, revised, e1, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

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

\* A pin or a chosen region. Not the viewport PNG, which is export-only.
PlacePin ==
  /\ phase = "shut" /\ ~busy /\ ~filled
  /\ filled' = TRUE
  /\ draftStored' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, revised, e1, e2, c1, c2, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen,
       failSeen, undoSeen, retrySeen, research, newest, storedAt, owed, editorResearch,
       snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* change() patches the open entry and leaves its id alone.
EditEntry ==
  /\ phase = "shut" /\ ~busy /\ filled /\ (~revised \/ draftStored)
  /\ revised' = TRUE
  /\ draftStored' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, e1, e2, c1, c2, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen,
       failSeen, undoSeen, retrySeen, research, newest, storedAt, owed, editorResearch,
       snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* saveDraft writes the one settings record.
FlushDraft ==
  /\ filled /\ ~draftStored /\ ~busy /\ phase = "shut"
  /\ draftStored' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, research, newest, storedAt, owed,
       editorResearch, snapResearch, fresh, owedNote, resurrected,
       lateDeleteSeen>>

DraftFails ==
  /\ filled /\ ~draftStored /\ ~failSeen /\ ~busy /\ phase = "shut"
  /\ failSeen' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* commit() copies the open entry, then storeEntries runs.
\* The copy's research bit is snapResearch. A double tap does nothing.
PressSave ==
  /\ filled /\ ~busy /\ phase = "shut"
  /\ busy' = TRUE
  /\ snapResearch' = editorResearch
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed,
       editorResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

DoubleTap ==
  /\ busy
  /\ UNCHANGED vars

SaveCommits ==
  /\ busy
  /\ busy' = FALSE
  /\ retrySeen' = (retrySeen \/ (e1 = "saved" /\ ~WriteWrongId /\ ~ReplaceWholeNotebook))
  /\ IF WriteWrongId
     THEN /\ wrongWrite' = TRUE
          /\ e2' = "saved"
          /\ UNCHANGED <<e1, c1, c2, banned, storeOk, research, newest, storedAt, owed,
               editorResearch, snapResearch, fresh, owedNote, resurrected,
               lateDeleteSeen>>
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
          /\ UNCHANGED <<newest, owed, editorResearch, snapResearch, resurrected,
               lateDeleteSeen>>
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, snap2, undo,
       dropped, clobber, lateSeen, failSeen, undoSeen, draftStored>>

\* onerror / abort. The real transaction does not publish its puts.
SaveFails ==
  /\ busy /\ ~failSeen
  /\ busy' = FALSE
  /\ failSeen' = TRUE
  /\ IF CorruptOnFailedWrite
     THEN /\ storeOk' = FALSE
          /\ e1' = "absent"
          /\ e2' = "absent"
          /\ research' = 0
          /\ newest' = 0
          /\ storedAt' = 0
          /\ owed' = FALSE
          /\ editorResearch' = 0
          /\ snapResearch' = 0
          /\ fresh' = FALSE
          /\ owedNote' = FALSE
     ELSE UNCHANGED <<storeOk, e1, e2, research, newest, storedAt, owed, editorResearch,
            snapResearch, fresh, owedNote>>
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, c1, c2, snap2,
       undo, dropped, banned, clobber, wrongWrite, lateSeen, undoSeen,
       retrySeen, draftStored, resurrected, lateDeleteSeen>>

DeleteEntry ==
  /\ ~busy /\ phase = "shut" /\ e1 \in {"saved", "dup"}
  /\ e1' = "absent" /\ c1' = FALSE /\ undo' = TRUE
  /\ filled' = FALSE /\ revised' = FALSE /\ draftStored' = FALSE
  /\ text' = FALSE
  /\ research' = 0 /\ newest' = 0 /\ storedAt' = 0 /\ owed' = FALSE
  /\ editorResearch' = 0 /\ snapResearch' = 0
  /\ fresh' = FALSE /\ owedNote' = FALSE
  /\ UNCHANGED <<phase, flightT, flightX, e2, c2, snap2, busy, dropped, banned,
       clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
       resurrected, lateDeleteSeen>>

UndoDelete ==
  /\ undo /\ ~busy
  /\ e1' = "saved" /\ c1' = TRUE /\ undo' = FALSE /\ undoSeen' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e2, c2, snap2,
       busy, dropped, banned, clobber, storeOk, wrongWrite, lateSeen, failSeen,
       retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* Opening the app again. Voice panel memory is not in the database.
\* Entries stay as the last committed transaction left them.
Reload ==
  /\ phase' = "shut"
  /\ flightT' = "none" /\ flightX' = "none"
  /\ text' = FALSE
  /\ busy' = FALSE
  /\ snap2' = (e2 = "saved")
  /\ UNCHANGED <<filled, revised, e1, e2, c1, c2, undo, dropped, banned,
       clobber, storeOk, wrongWrite, lateSeen, failSeen, undoSeen, retrySeen,
       draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* A second tab puts a different id. It does not replace this tab's record.
OtherTabSaves ==
  /\ e2 = "absent"
  /\ e2' = "saved" /\ c2' = TRUE
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, c1, snap2,
       busy, undo, dropped, banned, clobber, storeOk, wrongWrite, lateSeen,
       failSeen, undoSeen, retrySeen, draftStored, research, newest, storedAt, owed, editorResearch, snapResearch, fresh, owedNote, resurrected, lateDeleteSeen>>

\* saveResearch commits the next version onto the saved id. The in-flight
\* snapshot stays as it was at PressSave. The editor catches up only when
\* no save is in flight, which is when setEntry runs before the next snapshot.
ResearchLands ==
  /\ ModelRaces
  /\ e1 \in {"saved", "dup"}
  /\ phase = "shut"
  /\ newest < 2
  /\ newest' = newest + 1
  /\ research' = newest'
  /\ storedAt' = newest'
  /\ owed' = TRUE
  /\ editorResearch' = IF busy THEN editorResearch ELSE newest'
  /\ snapResearch' = IF busy THEN snapResearch ELSE 0
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e1, e2, c1,
       c2, snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored,
       fresh, owedNote, resurrected, lateDeleteSeen>>

\* saveResearch after a newer storeEntries. The real merge keeps the row
\* with the later updated time. PreferStaleDraft always uses the draft.
ResearchFromDraft ==
  /\ ModelRaces
  /\ e1 \in {"saved", "dup"}
  /\ fresh /\ ~busy /\ phase = "shut"
  /\ newest' = IF newest < 2 THEN newest + 1 ELSE newest
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

\* A search finishes after removeEntry. deleted-ids makes this a no-op.
\* RestoreDeleted puts the row back from the leftover draft.
ResearchAfterDelete ==
  /\ ModelRaces
  /\ undo /\ e1 = "absent" /\ ~lateDeleteSeen
  /\ lateDeleteSeen' = TRUE
  /\ IF RestoreDeleted
     THEN /\ resurrected' = TRUE
          /\ e1' = "saved"
          /\ research' = 1
          /\ newest' = 1
          /\ storedAt' = 1
          /\ owed' = TRUE
     ELSE UNCHANGED <<resurrected, e1, research, newest, storedAt, owed>>
  /\ UNCHANGED <<phase, flightT, flightX, text, filled, revised, e2, c1, c2,
       snap2, busy, undo, dropped, banned, clobber, storeOk, wrongWrite,
       lateSeen, failSeen, undoSeen, retrySeen, draftStored, editorResearch,
       snapResearch, fresh, owedNote>>

Wait ==
  UNCHANGED vars

Next ==
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
  \/ DeleteEntry
  \/ UndoDelete
  \/ Reload
  \/ OtherTabSaves
  \/ SaveFails
  \/ ResearchLands
  \/ ResearchFromDraft
  \/ ResearchAfterDelete
  \/ Wait

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
