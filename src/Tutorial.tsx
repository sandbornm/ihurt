import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

const steps = [
  {
    title: "Find your spot",
    text: "Choose Front or Back, then Find a region to move closer. Left and right always mean your own left and right.",
    picture: "locate",
  },
  {
    title: "Place a pin",
    text: "Tap the body to pin a spot. Drag to turn it. Use two fingers to zoom or move, or use the + and − buttons.",
    picture: "pin",
  },
  {
    title: "Describe what you feel",
    text: "Add a note, an activity, and an intensity. For a wider area, choose Highlight and drag across the body. Undo removes a mistaken mark.",
    picture: "note",
  },
  {
    title: "Keep it or share it",
    text: "Your draft saves on this device. Print a report or export an .ihm file to keep the map and notes together. Optional source search lets you review what goes to Grok first.",
    picture: "share",
  },
];

export default function Tutorial({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
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
          QUICK TOUR · {step + 1} OF {steps.length}
        </span>
        <button
          aria-label="Close tutorial"
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
        {item.title}
      </h2>
      <p>{item.text}</p>
      {step === 0 && (
        <p className="tutorial-limit">
          This is reference anatomy. Pins help describe a location; they do not
          measure your body or identify the cause of pain.
        </p>
      )}
      <div className="tutorial-actions">
        <button
          className="secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          className="primary"
          onClick={() =>
            step === steps.length - 1
              ? dialog.current?.close()
              : setStep(step + 1)
          }
        >
          {step === steps.length - 1 ? "Start mapping" : "Next"}
          <ArrowRight size={18} />
        </button>
      </div>
    </dialog>
  );
}
