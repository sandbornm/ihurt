import credits from "../public/models/ATTRIBUTION.md?raw";
import upstream from "../public/models/UPSTREAM-LICENSE.txt?raw";
import references from "../public/models/REFERENCE-LICENSE.txt?raw";
import draco from "../public/draco/LICENSE?raw";
import code from "../LICENSE?raw";

// Bundle the authoritative notices so they remain readable offline, including
// in WKWebView. Render as text; never interpret license files as HTML.
export default function AnatomyCredits() {
  return (
    <details className="anatomy-credits">
      <summary>Anatomy credits and licenses</summary>
      <div className="license-text">{credits}</div>
      {[
        ["Upstream anatomy notice", upstream],
        ["Outer-body reference license", references],
        ["Draco decoder license", draco],
        ["iHurt code license", code],
      ].map(([title, text]) => (
        <details key={title}>
          <summary>{title}</summary>
          <div className="license-text">{text}</div>
        </details>
      ))}
    </details>
  );
}
