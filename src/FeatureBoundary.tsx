import { Component, type ReactNode } from "react";
import { t } from "./i18n";
export default class FeatureBoundary extends Component<
  { children: ReactNode; label: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div
        role="status"
        style={{ padding: 24, color: "#a9bd99", fontSize: 13, lineHeight: 1.7 }}
      >
        {t("boundary.failed", { label: this.props.label })}{" "}
        <button
          style={{ color: "#baf38b", textDecoration: "underline", padding: 0 }}
          onClick={() => window.location.reload()}
        >
          {t("boundary.reload")}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
