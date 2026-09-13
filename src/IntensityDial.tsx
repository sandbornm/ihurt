import type { CSSProperties } from "react";
import { intensityColor } from "./anatomy/intensity";

export default function IntensityDial({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <section
      className="intensity-control"
      aria-label="Discomfort intensity"
      style={
        {
          "--intensity-color": intensityColor(value),
          "--dial-angle": `${(value ?? 0) * 27}deg`,
        } as CSSProperties
      }
    >
      <div className="intensity-dial" aria-hidden="true">
        <strong>
          {value ?? "—"}
          <small>{value === null ? "Unrated" : "out of 10"}</small>
        </strong>
      </div>
      <div className="intensity-adjust">
        <div>
          <label htmlFor="intensity">How strong is it?</label>
          <button
            className="text-button"
            onClick={() => onChange(null)}
            disabled={value === null}
          >
            Clear
          </button>
        </div>
        <input
          id="intensity"
          type="range"
          min="0"
          max="10"
          step="1"
          value={value ?? 0}
          aria-label="Reported intensity"
          aria-valuetext={
            value === null ? "Not recorded" : `${value} out of 10`
          }
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className="intensity-scale">
          <button
            onClick={() => onChange(0)}
            aria-label="Set intensity to zero"
          >
            0 · None
          </button>
          <button
            onClick={() => onChange(10)}
            aria-label="Set intensity to ten"
          >
            10 · Strongest
          </button>
        </div>
        <small>Colors show intensity, not temperature.</small>
      </div>
    </section>
  );
}
