import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useI18n } from "./i18n/react";

const steps = (["locate", "pin", "note", "voice", "share"] as const).map(
  (picture, index) => ({ picture, n: (index + 1) as 1 | 2 | 3 | 4 | 5 }),
);

export default function Tutorial({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const item = steps[step];
  return (
    <dialog
      ref={dialog}
      className="dialog tutorial"
      aria-labelledby="tutorial-title"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <span>
          {t("tour.progress", { step: step + 1, total: steps.length })}
        </span>
        <button
          aria-label={t("tour.close")}
          onClick={() => dialog.current?.close()}
        >
          <X size={22} />
        </button>
      </div>
      <div
        className={`tutorial-picture tutorial-${item.picture}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 300 180">
          <path
            className="tutorial-body"
            d="M140 23a13 13 0 1 0 26 0a13 13 0 1 0-26 0 M142 41l-28 9-19 54 15 6 19-39-5 50 13 50h14l-3-48h10l-2 48h15l11-50-5-50 19 39 15-6-19-54-28-9z"
          />
          <circle className="tutorial-pin" cx="174" cy="58" r="10" />
          <path className="tutorial-line" d="M186 58h27v49h44" />
          <rect
            className="tutorial-sheet"
            x="208"
            y="95"
            width="60"
            height="66"
            rx="8"
          />
          <path
            className="tutorial-writing"
            d="M220 112h34m-34 12h26m-26 12h32"
          />
        </svg>
      </div>
      <h2 ref={heading} tabIndex={-1} id="tutorial-title">
        {t(`tour.${item.n}.title`)}
      </h2>
      <p>{t(`tour.${item.n}.text`)}</p>
      {step === 0 && <p className="tutorial-limit">{t("tour.limit")}</p>}
      <div className="tutorial-actions">
        <button
          className="secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft size={18} />
          {t("tour.back")}
        </button>
        <button
          className="primary"
          onClick={() =>
            step === steps.length - 1
              ? dialog.current?.close()
              : setStep(step + 1)
          }
        >
          {step === steps.length - 1 ? t("tour.start") : t("tour.next")}
          <ArrowRight size={18} />
        </button>
      </div>
    </dialog>
  );
}
