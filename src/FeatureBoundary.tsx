import { Component, type ReactNode } from "react";
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
        {this.props.label} couldn’t load. The rest of the page is still
        available.{" "}
        <button
          style={{ color: "#baf38b", textDecoration: "underline", padding: 0 }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
