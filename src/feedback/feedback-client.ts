// Vendored from sandbornm/feedback-relay client/feedback-client.ts. Keep in sync.
// Never pass user data beyond what the person typed (no journal/app content).
export const FEEDBACK_ADDRESS = "jefejeff+bugs@mail.grokbot.com";

export type FeedbackType = "bug" | "feature";
export interface FeedbackInput {
  project: string;
  type: FeedbackType;
  summary?: string;
  message: string;
  contact?: string;
  appVersion?: string;
  platform?: string;
  userAgent?: string;
}

const encode = (v: string) =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function feedbackMailto(
  input: FeedbackInput,
  address = FEEDBACK_ADDRESS,
) {
  const label = input.type === "bug" ? "Bug" : "Feature";
  const subject = `[${input.project}] ${label}: ${input.summary ?? ""}`;
  const body = [
    input.message,
    "",
    "---",
    ...(input.contact ? [`Contact: ${input.contact}`] : []),
    `App version: ${input.appVersion ?? ""}`,
    `Platform: ${input.platform ?? ""}`,
    `User agent: ${input.userAgent ?? ""}`,
  ].join("\r\n");
  return `mailto:${address.replace("+", "%2B")}?subject=${encode(subject)}&body=${encode(body)}`;
}

/** POSTs to the relay. Resolves "sent" or "fallback" (caller should offer mailto). */
export async function sendFeedback(
  endpoint: string,
  input: FeedbackInput,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<"sent" | "rate-limited" | "fallback"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      signal: ctrl.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, website: "" }),
    });
    if (res.ok) return "sent";
    if (res.status === 429) return "rate-limited";
    return "fallback";
  } catch {
    return "fallback";
  } finally {
    clearTimeout(timer);
  }
}
