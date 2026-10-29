export const FEEDBACK_ADDRESS = "jefejeff+bugs@mail.grokbot.com";

export type FeedbackKind = "bug" | "feature";

export interface FeedbackContext {
  version: string;
  platform: string;
  userAgent: string;
}

const templates: Record<FeedbackKind, { subject: string; body: string[] }> = {
  bug: {
    subject: "[ihurt] Bug: ",
    body: [
      "What happened:",
      "",
      "",
      "Steps to reproduce:",
      "1. ",
      "",
      "What you expected:",
      "",
    ],
  },
  feature: {
    subject: "[ihurt] Feature: ",
    body: ["What you'd like iHurt to do:", "", "", "Why it would help:", ""],
  },
};

// RFC 6068: encode every reserved character, and use %20 (not +) for spaces.
function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function feedbackBody(kind: FeedbackKind, ctx: FeedbackContext) {
  return [
    ...templates[kind].body,
    "",
    "Please leave out health details.",
    "",
    "---",
    `App version: ${ctx.version}`,
    `Platform: ${ctx.platform}`,
    `User agent: ${ctx.userAgent}`,
  ].join("\r\n");
}

export function feedbackMailto(kind: FeedbackKind, ctx: FeedbackContext) {
  const to = FEEDBACK_ADDRESS.replace("+", "%2B");
  return `mailto:${to}?subject=${encode(templates[kind].subject)}&body=${encode(feedbackBody(kind, ctx))}`;
}
