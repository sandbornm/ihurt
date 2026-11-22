import credits from "../public/models/ATTRIBUTION.md?raw";
import upstream from "../public/models/UPSTREAM-LICENSE.txt?raw";
import references from "../public/models/REFERENCE-LICENSE.txt?raw";
import draco from "../public/draco/LICENSE?raw";
import code from "../LICENSE?raw";
import { useI18n } from "./i18n/react";

// Bundle the authoritative notices so they remain readable offline, including
// in WKWebView. Render as text; never interpret license files as HTML.
export default function AnatomyCredits() {
  const { t } = useI18n();
  return (
    <details className="anatomy-credits">
      <summary>{t("credits.title")}</summary>
      <div className="license-text">{credits}</div>
      {[
        [t("credits.upstream"), upstream],
        [t("credits.reference"), references],
        [t("credits.draco"), draco],
        [t("credits.code"), code],
      ].map(([title, text]) => (
        <details key={title}>
          <summary>{title}</summary>
          <div className="license-text">{text}</div>
        </details>
      ))}
    </details>
  );
}
