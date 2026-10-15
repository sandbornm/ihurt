import { useId, useState } from "react";
import { Bug, Lightbulb } from "lucide-react";
import { isNativeApp } from "../platform/files";
import { FEEDBACK_ADDRESS, feedbackBody } from "./mailto";
import {
  feedbackMailto,
  sendFeedback,
  type FeedbackType,
} from "./feedback-client";

// Shared feedback relay. Unset → buttons go straight to the mailto draft.
const ENDPOINT: string | undefined = import.meta.env.VITE_FEEDBACK_ENDPOINT;

function diagnostics() {
  return {
    version: __APP_VERSION__,
    platform: isNativeApp() ? "iOS app" : "Web",
    userAgent: navigator.userAgent,
  };
}

export default function FeedbackLinks() {
  const id = useId();
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
    setStatus(`If no email app opened, write to ${FEEDBACK_ADDRESS}.`);
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
      setStatus("Thanks, sent.");
      setKind(null);
      setSummary("");
      setMessage("");
      setContact("");
    } else if (result === "rate-limited") {
      setStatus("Too many reports for now. Try again later or use email.");
    } else {
      setStatus("Couldn't send. Opening an email draft instead.");
      openMail(kind, message.trim());
    }
  };

  const copy = () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(FEEDBACK_ADDRESS))
      .then(
        () => setStatus(`Copied ${FEEDBACK_ADDRESS}`),
        () => setStatus(`Email ${FEEDBACK_ADDRESS}`),
      );
  };

  return (
    <section className="feedback-links" aria-label="Send feedback">
      <h3>Feedback</h3>
      <div className="feedback-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => start("bug")}
        >
          <Bug size={15} /> Report a bug
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => start("feature")}
        >
          <Lightbulb size={15} /> Suggest a feature
        </button>
        <button type="button" className="secondary" onClick={copy}>
          No mail app? Copy address
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
              {kind === "bug" ? "Bug in a few words" : "Idea in a few words"}
            </label>
            <input
              id={`${id}-summary`}
              value={summary}
              maxLength={120}
              onChange={(e) => setSummary(e.target.value)}
            />
            <label htmlFor={`${id}-message`}>
              {kind === "bug"
                ? "What happened, steps, and what you expected"
                : "What should iHurt do, and why?"}
            </label>
            <textarea
              id={`${id}-message`}
              value={message}
              rows={5}
              maxLength={4000}
              required
              onChange={(e) => setMessage(e.target.value)}
            />
            <label htmlFor={`${id}-contact`}>Your email (optional)</label>
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
                {busy ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => openMail(kind, message.trim())}
              >
                Use email instead
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <p role="status">
        {status || "Leave out health details. Your notebook is never attached."}
      </p>
    </section>
  );
}
