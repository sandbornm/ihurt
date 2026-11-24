export type RecordMode =
  "loading" | "idle" | "starting" | "recording" | "processing";

// A cue for the moment recording begins or ends, shown and announced. The app
// has no haptics plugin, and a phone vibration would not reach the web build.
export function recordCue(
  from: RecordMode,
  to: RecordMode,
): "started" | "stopped" | null {
  if (from !== "recording" && to === "recording") return "started";
  if (from === "recording" && to !== "recording") return "stopped";
  return null;
}
