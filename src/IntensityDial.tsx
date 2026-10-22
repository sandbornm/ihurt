import type { CSSProperties } from "react";
import { intensityColor } from "./anatomy/intensity";
import { useI18n } from "./i18n/react";

export default function IntensityDial({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { t } = useI18n();
  return (
    <section
      className="intensity-control"
      aria-label={t("dial.label")}
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
          <small>{value === null ? t("dial.unrated") : t("dial.outOf10")}</small>
        </strong>
      </div>
      <div className="intensity-adjust">
        <div>
          <label htmlFor="intensity">{t("dial.howStrong")}</label>
          <button
            className="text-button"
            onClick={() => onChange(null)}
            disabled={value === null}
          >
            {t("dial.clear")}
          </button>
        </div>
        <input
          id="intensity"
          type="range"
          min="0"
          max="10"
          step="1"
          value={value ?? 0}
          aria-label={t("dial.reported")}
          aria-valuetext={
            value === null ? t("dial.notRecorded") : t("dial.valueText", { value })
          }
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className="intensity-scale">
          <button
            onClick={() => onChange(0)}
            aria-label={t("dial.setZero")}
          >
            {t("dial.none")}
          </button>
          <button
            onClick={() => onChange(10)}
            aria-label={t("dial.setTen")}
          >
            {t("dial.strongest")}
          </button>
        </div>
        <small>{t("dial.colors")}</small>
      </div>
    </section>
  );
}
