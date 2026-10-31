export const title = "From a pain note to a saved entry";

export const colors = {
  Voice: "orange",
  Entry: "blue",
  Saving: "yellow",
  Saved: "teal",
};

export function group(v) {
  if (v.phase !== "shut") return "Voice";
  if (v.busy) return "Saving";
  if (v.e1 === "saved" || v.revised) return "Saved";
  return "Entry";
}

export function state(v) {
  if (v.phase === "recording") return "Recording";
  if (v.phase === "processing") return "Transcribing";
  if (v.phase === "extracting") return "Reading the words";
  if (v.phase === "ready") return "Suggestion ready";
  if (v.phase === "error") return "Capture stopped";
  if (v.phase === "idle" && v.text) return "Draft editable";
  if (v.phase === "idle") return "Voice ready";
  if (v.busy) return "Saving the entry";
  if (v.revised) return "Saved then edited";
  if (v.e1 === "saved") return "Saved on this device";
  if (v.dropped && !v.filled) return "Draft discarded";
  if (v.filled) return "Entry in progress";
  return "Notebook open";
}

const hidden = new Set([
  "Wait",
  "DoubleTap",
  "DraftFails",
  "SaveFails",
  "DeleteEntry",
  "UndoDelete",
  "OtherTabSaves",
  "LateTranscript",
  "LateExtraction",
  "DismissVoice",
  "EditTranscript",
  "FlushDraft",
  "ResearchLands",
  "ResearchFromDraft",
  "ResearchAfterDelete",
  "Reload",
]);

const labels = {
  OpenVoice: "you open voice",
  StartRecording: "you start recording",
  StopRecording: "you stop recording",
  CancelOrHide: "you leave or cancel",
  TranscriptReady: "the transcript arrives",
  TranscriptStartsExtraction: "the transcript arrives",
  BeginExtraction: "the words are read",
  ExtractionReady: "a suggestion is ready",
  EditTranscript: "you edit the words",
  ApplyToEntry: "you add it to the entry",
  DiscardDraft: "you discard the draft",
  DismissVoice: "you close voice",
  PlacePin: "you mark a spot",
  EditEntry: "you edit the entry",
  FlushDraft: "the draft is stored",
  PressSave: "you press save",
  SaveCommits: "the entry is saved",
};

export function step(action) {
  if (hidden.has(action)) return null;
  return labels[action] ?? null;
}
