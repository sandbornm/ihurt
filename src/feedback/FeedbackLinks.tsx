import { useId, useState } from "react";
import { Bug, Lightbulb } from "lucide-react";
import { isNativeApp } from "../platform/files";
import { FEEDBACK_ADDRESS, feedbackBody } from "./mailto";
import { useI18n } from "../i18n/react";
import {
  feedbackMailto,
  sendFeedback,
  type FeedbackType,
} from "./feedback-client";

// Shared feedback relay (public URL, not a secret). Override with
// VITE_FEEDBACK_ENDPOINT; set it to an empty string to use only the mailto draft.
const DEFAULT_ENDPOINT = "https://feedback-relay.msxndev.workers.dev/feedback";
const ENDPOINT: string | undefined =
  (import.meta.env.VITE_FEEDBACK_ENDPOINT ?? DEFAULT_ENDPOINT) || undefined;

function diagnostics() {
  return {
    version: __APP_VERSION__,
    platform: isNativeApp() ? "iOS app" : "Web",
    userAgent: navigator.userAgent,
  };
}

export default function FeedbackLinks() {
  const id = useId();
  const { t } = useI18n();
  const [kind, setKind] = useState<FeedbackType | null>(null);
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const openMail = (type: FeedbackType, text: string) => {
    const d = diagnostics();
    // Capacitor's iOS WebView hands mailto: to iOS (Mail). No Info.plist change needed.
    window.location.href = feedbackMailto({
      project: "ihurt",
      type,
      summary: summary.trim(),
      message: text || feedbackBody(type, d).split("\r\n---")[0],
      contact: contact.trim() || undefined,
      appVersion: d.version,
      platform: d.platform,
      userAgent: d.userAgent,
    });
    setStatus(t("fb.noMailApp", { address: FEEDBACK_ADDRESS }));
  };

  const start = (type: FeedbackType) => {
    setStatus("");
    if (!ENDPOINT) return openMail(type, "");
    setKind(type);
  };

  const submit = async () => {
    if (!kind || !message.trim()) return;
    if (website) return setKind(null);
    setBusy(true);
    const d = diagnostics();
    const result = await sendFeedback(ENDPOINT!, {
      project: "ihurt",
      type: kind,
      summary: summary.trim() || undefined,
      message: message.trim(),
      contact: contact.trim() || undefined,
      appVersion: d.version,
      platform: d.platform,
      userAgent: d.userAgent,
    });
    setBusy(false);
    if (result === "sent") {
      setStatus(t("fb.sent"));
      setKind(null);
      setSummary("");
      setMessage("");
      setContact("");
    } else if (result === "rate-limited") {
      setStatus(t("fb.rateLimited"));
    } else {
      setStatus(t("fb.fallback"));
      openMail(kind, message.trim());
    }
  };

  const copy = () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(FEEDBACK_ADDRESS))
      .then(
        () => setStatus(t("fb.copiedAddress", { address: FEEDBACK_ADDRESS })),
        () => setStatus(t("fb.emailAddress", { address: FEEDBACK_ADDRESS })),
      );
  };

  return (
    <section className="feedback-links" aria-label={t("fb.send")}>
      <h3>{t("fb.title")}</h3>
      <div className="feedback-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => start("bug")}
        >
          <Bug size={15} /> {t("fb.bug")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => start("feature")}
        >
          <Lightbulb size={15} /> {t("fb.feature")}
        </button>
        <button type="button" className="secondary" onClick={copy}>
          {t("fb.copyAddress")}
        </button>
      </div>
      {kind && (
        <form
          className="feedback-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="feedback-fieldset">
            <label htmlFor={`${id}-summary`}>
              {kind === "bug" ? t("fb.bugSummary") : t("fb.ideaSummary")}
            </label>
            <input
              id={`${id}-summary`}
              value={summary}
              maxLength={120}
              onChange={(e) => setSummary(e.target.value)}
            />
            <label htmlFor={`${id}-message`}>
              {kind === "bug" ? t("fb.bugMessage") : t("fb.ideaMessage")}
            </label>
            <textarea
              id={`${id}-message`}
              value={message}
              rows={5}
              maxLength={4000}
              required
              onChange={(e) => setMessage(e.target.value)}
            />
            <label htmlFor={`${id}-contact`}>{t("fb.contact")}</label>
            <input
              id={`${id}-contact`}
              type="email"
              value={contact}
              maxLength={254}
              onChange={(e) => setContact(e.target.value)}
            />
            <input
              className="feedback-hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <div className="feedback-actions">
              <button
                type="submit"
                className="secondary"
                disabled={busy || !message.trim()}
              >
                {busy ? t("fb.sending") : t("fb.sendButton")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => openMail(kind, message.trim())}
              >
                {t("fb.useEmail")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <p role="status">
        {status || t("fb.noHealth")}
      </p>
    </section>
  );
}
