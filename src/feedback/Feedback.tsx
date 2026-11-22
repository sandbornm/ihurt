import { useId, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import "./feedback.css";
import { useI18n } from "../i18n/react";

export default function Feedback() {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useI18n();
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
        <MessageSquare size={15} /> {t("fb.title")}
      </button>
      <dialog
        ref={dialog}
        className="feedback-dialog"
        aria-labelledby={`${id}-title`}
      >
        <div className="feedback-heading">
          <h2 id={`${id}-title`}>{t("fb.makeBetter")}</h2>
          <button
            type="button"
            aria-label={t("fb.close")}
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <label htmlFor={`${id}-note`}>{t("fb.whatConfusing")}</label>
        <textarea
          id={`${id}-note`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setStatus("");
          }}
          rows={5}
          maxLength={1500}
          placeholder={t("fb.placeholder")}
        />
        <p>{t("fb.noHealthRec")}</p>
        <div className="feedback-actions">
          <a
            className="secondary"
            href={message ? email : undefined}
            aria-disabled={!message}
            onClick={(event) => {
              if (!message) event.preventDefault();
              else setStatus(t("fb.finishInMail"));
            }}
          >
            {t("fb.openDraft")}
          </a>
          <button
            type="button"
            className="secondary"
            disabled={!message}
            onClick={() => {
              void Promise.resolve()
                .then(() => navigator.clipboard.writeText(message))
                .then(
                  () => setStatus(t("fb.copied")),
                  () => setStatus(t("fb.copyManual")),
                );
            }}
          >
            {t("fb.copy")}
          </button>
        </div>
        <p role="status">{status || t("fb.youSend")}</p>
      </dialog>
    </>
  );
}
