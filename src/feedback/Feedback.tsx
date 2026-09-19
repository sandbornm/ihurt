import { useId, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import "./feedback.css";

export default function Feedback() {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const message = text.trim();
  const email = `mailto:michael@msandborn.dev?subject=${encodeURIComponent("iHurt feedback")}&body=${encodeURIComponent(message)}`;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStatus("");
          dialog.current?.showModal();
        }}
      >
        <MessageSquare size={15} /> Feedback
      </button>
      <dialog
        ref={dialog}
        className="feedback-dialog"
        aria-labelledby={`${id}-title`}
      >
        <div className="feedback-heading">
          <h2 id={`${id}-title`}>Make iHurt better</h2>
          <button
            type="button"
            aria-label="Close feedback"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <label htmlFor={`${id}-note`}>
          What was confusing, broken, or missing?
        </label>
        <textarea
          id={`${id}-note`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setStatus("");
          }}
          rows={5}
          maxLength={1500}
          placeholder="I tried to…"
        />
        <p>
          Leave out health details. Your notebook and recordings are not
          attached.
        </p>
        <div className="feedback-actions">
          <a
            className="secondary"
            href={message ? email : undefined}
            aria-disabled={!message}
            onClick={(event) => {
              if (!message) event.preventDefault();
              else
                setStatus(
                  "Finish sending in your email app. If it did not open, copy the feedback and email michael@msandborn.dev.",
                );
            }}
          >
            Open email draft
          </a>
          <button
            type="button"
            className="secondary"
            disabled={!message}
            onClick={() => {
              void Promise.resolve()
                .then(() => navigator.clipboard.writeText(message))
                .then(
                  () => setStatus("Copied. Email it to michael@msandborn.dev."),
                  () =>
                    setStatus(
                      "Copy the text above and email it to michael@msandborn.dev.",
                    ),
                );
            }}
          >
            Copy feedback
          </button>
        </div>
        <p role="status">
          {status || "You review and send the email yourself."}
        </p>
      </dialog>
    </>
  );
}
