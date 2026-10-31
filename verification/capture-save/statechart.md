# Capture and save

This picture is the path from an empty notebook to a saved entry, including voice. It draws 12 states and 32 arrows. TLC checked 178 states in this slice. The full check is larger and is what `run.sh` runs.

Add and discard can land on the same screen when an entry was already open. Discard throws away the voice text and leaves that entry.

The picture hides these steps. The full model still checks them.

- Waiting, and a second tap while a save is running
- Reopening the app
- Storing the draft, closing voice, and editing the transcript, which stay on the same screen or return to the entry already open
- A late transcript, a late suggestion, a failed draft write, and a failed save
- Delete, undo, and another tab saving a different entry
- Research landing during a save, research merged from a draft, and research after delete
- A search with no version, typing a newer note, a stale save of an older note, and a research write that keeps the note
- A note edit or a title, pin, or context edit while a save is in flight, the merge that keeps a newer stored note, and the editor catching up after the save. The chart config leaves those races off

Read results with the pstack /statechart skill.

```mermaid
---
title: "From a pain note to a saved entry"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: Voice
    lg1: Entry
    lg2: Saving
    lg3: Saved
  }
  class lg0 orange
  class lg1 blue
  class lg2 yellow
  class lg3 teal
  s0: Notebook open
  s1: Voice ready
  s2: Entry in progress
  s3: Recording
  s4: Saving the entry
  s5: Saved then edited
  s6: Transcribing
  s7: Saved on this device
  s8: Reading the words
  s9: Draft editable
  s10: Suggestion ready
  s11: Draft discarded
  [*] --> s0
  s0 --> s1: you open voice
  s0 --> s2: you mark a spot
  s1 --> s3: you start recording
  s2 --> s1: you open voice
  s2 --> s4: you press save
  s2 --> s5: you edit the entry
  s3 --> s1: you leave or cancel
  s3 --> s6: you stop recording
  s4 --> s7: the entry is saved
  s5 --> s1: you open voice
  s5 --> s4: you press save
  s6 --> s8: the transcript arrives
  s6 --> s9: the transcript arrives
  s7 --> s1: you open voice
  s7 --> s4: you press save
  s7 --> s5: you edit the entry
  s4 --> s5: the entry is saved
  s8 --> s10: a suggestion is ready
  s9 --> s2: you add it to the entry or you discard the draft
  s9 --> s8: the words are read
  s9 --> s3: you start recording
  s9 --> s11: you discard the draft
  s10 --> s2: you add it to the entry or you discard the draft
  s10 --> s3: you start recording
  s10 --> s11: you discard the draft
  s3 --> s9: you leave or cancel
  s11 --> s1: you open voice
  s11 --> s2: you mark a spot
  s9 --> s5: you add it to the entry or you discard the draft
  s9 --> s7: you add it to the entry or you discard the draft
  s10 --> s5: you add it to the entry or you discard the draft
  s10 --> s7: you add it to the entry or you discard the draft
  class s0 blue
  class s1 orange
  class s2 blue
  class s3 orange
  class s4 yellow
  class s5 teal
  class s6 orange
  class s7 teal
  class s8 orange
  class s9 orange
  class s10 orange
  class s11 blue
```
