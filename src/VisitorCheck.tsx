import { useEffect, useRef } from "react";
interface Turnstile {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
export default function VisitorCheck({
  siteKey,
  nonce,
  onToken,
}: {
  siteKey: string;
  nonce: number;
  onToken: (token: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    if (!siteKey || !root.current) return;
    let widget: string | undefined,
      stopped = false;
    const render = () => {
      if (!stopped && root.current && window.turnstile && !widget)
        widget = window.turnstile.render(root.current, {
          sitekey: siteKey,
          theme: "dark",
          action: "map",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
    };
    let script = document.getElementById(
      "turnstile-script",
    ) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "turnstile-script";
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      stopped = true;
      script?.removeEventListener("load", render);
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, nonce]);
  return siteKey ? <div ref={root} className="visitor-check" /> : null;
}
