import type { CSSProperties } from "react";
import type { HandEntryState } from "./hand-entry";
import { intensityColor } from "./intensity";

export default function HandEntryPanel({
  state,
  intensity,
  trackingHint,
  onSave,
  onUndo,
  onBack,
}: {
  state: HandEntryState;
  intensity: number | null;
  trackingHint: string;
  onSave: () => void;
  onUndo: () => void;
  onBack: () => void;
}) {
  if (state.phase === "aim") return null;
  return (
    <section
      className="hand-entry-controls"
      aria-label="Gesture entry controls"
    >
      <strong>{state.phase === "saved" ? "Entry saved" : "Pin placed"}</strong>
      <span className="hand-pin-label">{state.pin?.label}</span>
      <div
        className="hand-entry-dial"
        data-held={state.turning}
        style={
          {
            "--intensity-color": intensityColor(intensity),
            "--dial-angle": `${(intensity ?? 0) * 27}deg`,
          } as CSSProperties
        }
      >
        <output aria-label="Gesture entry intensity">
          {intensity ?? "—"}
          <small>{intensity === null ? "Unrated" : "out of 10"}</small>
        </output>
      </div>
      <span className="hand-entry-scope">
        {state.turning
          ? "Entry intensity · dial held"
          : "Intensity for this entry"}
      </span>
      <p role="status">
        {state.phase === "rate" && trackingHint ? trackingHint : state.hint}
      </p>
      {state.phase === "rate" && (
        <>
          <small>Clockwise increases. Release to regrip.</small>
          <div className="hand-save-progress" aria-hidden="true">
            <span />
          </div>
          <button className="secondary" onClick={onSave}>
            Save this entry
          </button>
          <button className="text-button" onClick={onUndo}>
            Undo this pin
          </button>
        </>
      )}
      {state.phase !== "saving" && (
        <button className="text-button" onClick={onBack}>
          Back to body
        </button>
      )}
    </section>
  );
}
