export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
      style={{
        position: "absolute",
        left: "-9999px",
        zIndex: 999,
        padding: "12px 16px",
        background: "var(--lime)",
        color: "#1c351c",
        fontWeight: 600,
        borderRadius: "8px",
        textDecoration: "none",
      }}
      onFocus={(e) => {
        e.currentTarget.style.left = "16px";
        e.currentTarget.style.top = "16px";
      }}
      onBlur={(e) => {
        e.currentTarget.style.left = "-9999px";
      }}
    >
      Skip to main content
    </a>
  );
}
