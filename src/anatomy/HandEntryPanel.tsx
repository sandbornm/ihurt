import type { CSSProperties } from "react";
import type { HandEntryState } from "./hand-entry";
import { intensityColor } from "./intensity";
import { t } from "../i18n";

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
      aria-label={t("hands.panel.controls")}
    >
      <strong>
        {state.phase === "saved"
          ? t("hands.panel.saved")
          : t("hands.panel.placed")}
      </strong>
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
        <output aria-label={t("hands.panel.intensityLabel")}>
          {intensity ?? "—"}
          <small>
            {intensity === null
              ? t("hands.panel.unrated")
              : t("hands.panel.outOf")}
          </small>
        </output>
      </div>
      <span className="hand-entry-scope">
        {state.turning ? t("hands.panel.dialHeld") : t("hands.panel.intensity")}
      </span>
      <p role="status">
        {state.phase === "rate" && trackingHint ? trackingHint : state.hint}
      </p>
      {state.phase === "rate" && (
        <>
          <small>{t("hands.panel.clockwise")}</small>
          <div className="hand-save-progress" aria-hidden="true">
            <span />
          </div>
          <button className="secondary" onClick={onSave}>
            {t("hands.panel.save")}
          </button>
          <button className="text-button" onClick={onUndo}>
            {t("hands.panel.undo")}
          </button>
        </>
      )}
      {state.phase !== "saving" && (
        <button className="text-button" onClick={onBack}>
          {t("hands.panel.back")}
        </button>
      )}
    </section>
  );
}
