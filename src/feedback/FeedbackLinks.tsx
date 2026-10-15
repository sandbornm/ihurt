import { useState } from "react";
import { Bug, Lightbulb } from "lucide-react";
import { isNativeApp } from "../platform/files";
import { FEEDBACK_ADDRESS, feedbackMailto, type FeedbackKind } from "./mailto";

function context() {
  return {
    version: __APP_VERSION__,
    platform: isNativeApp() ? "iOS app" : "Web",
    userAgent: navigator.userAgent,
  };
}

export default function FeedbackLinks() {
  const [status, setStatus] = useState("");
  const open = (kind: FeedbackKind) => {
    // Capacitor's iOS WebView hands non-web schemes like mailto: to iOS, which
    // opens Mail. No Info.plist entry is needed for this.
    window.location.href = feedbackMailto(kind, context());
    setStatus(`If no email app opened, write to ${FEEDBACK_ADDRESS}.`);
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
        <button type="button" className="secondary" onClick={() => open("bug")}>
          <Bug size={15} /> Report a bug
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => open("feature")}
        >
          <Lightbulb size={15} /> Suggest a feature
        </button>
        <button type="button" className="secondary" onClick={copy}>
          No mail app? Copy address
        </button>
      </div>
      <p role="status">
        {status ||
          "Opens a draft you review and send. Your notebook is never attached."}
      </p>
    </section>
  );
}
