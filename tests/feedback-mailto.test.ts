import test from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_ADDRESS,
  feedbackBody,
  feedbackMailto,
} from "../src/feedback/mailto.ts";

const ctx = {
  version: "0.1.0",
  platform: "iOS app",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) & co",
};

function parse(href: string) {
  const [scheme, rest] = href.split(/:(.*)/s);
  const [to, query] = rest.split("?");
  const params = Object.fromEntries(
    query.split("&").map((p) => {
      const [k, v] = p.split("=");
      return [k, decodeURIComponent(v)];
    }),
  );
  return { scheme, to: decodeURIComponent(to), params, query };
}

test("bug mailto targets the debug inbox with the bug subject", () => {
  const { scheme, to, params } = parse(feedbackMailto("bug", ctx));
  assert.equal(scheme, "mailto");
  assert.equal(to, FEEDBACK_ADDRESS);
  assert.equal(params.subject, "[ihurt] Bug: ");
  assert.match(params.body, /What happened:/);
  assert.match(params.body, /Steps to reproduce:/);
  assert.match(params.body, /What you expected:/);
});

test("feature mailto uses the feature subject", () => {
  assert.equal(
    parse(feedbackMailto("feature", ctx)).params.subject,
    "[ihurt] Feature: ",
  );
});

test("body carries version, platform and user agent", () => {
  const body = feedbackBody("bug", ctx);
  assert.match(body, /App version: 0\.1\.0/);
  assert.match(body, /Platform: iOS app/);
  assert.ok(body.includes(`User agent: ${ctx.userAgent}`));
});

test("query is fully encoded: no raw spaces, &, +, brackets or newlines", () => {
  const href = feedbackMailto("bug", ctx);
  const { query } = parse(href);
  assert.ok(!/[ \n\r+()\[\]]/.test(query));
  assert.equal(query.split("&").length, 2);
  assert.ok(href.startsWith("mailto:jefejeff%2Bbugs@mail.grokbot.com?"));
});

test("builder only accepts diagnostics, so no journal data can leak", () => {
  const body = feedbackBody("feature", ctx);
  assert.ok(!/pin|intensity|note:/i.test(body.split("---")[1]));
});

import {
  feedbackMailto as relayMailto,
  sendFeedback,
} from "../src/feedback/feedback-client.ts";

test("relay client: subject uses [ihurt] tag and summary", () => {
  const href = relayMailto({
    project: "ihurt",
    type: "bug",
    summary: "Crash",
    message: "m",
  });
  assert.equal(
    decodeURIComponent(href.split("subject=")[1].split("&")[0]),
    "[ihurt] Bug: Crash",
  );
});

test("relay client: posts JSON with empty honeypot, falls back on errors", async () => {
  let sent: any;
  const ok = (async (_u: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const input = { project: "ihurt", type: "feature" as const, message: "m" };
  assert.equal(await sendFeedback("https://x/feedback", input, ok), "sent");
  assert.equal(sent.website, "");
  assert.equal(sent.project, "ihurt");
  const err = (async () => new Response("", { status: 500 })) as typeof fetch;
  assert.equal(
    await sendFeedback("https://x/feedback", input, err),
    "fallback",
  );
  const limited = (async () =>
    new Response("", { status: 429 })) as typeof fetch;
  assert.equal(
    await sendFeedback("https://x/feedback", input, limited),
    "rate-limited",
  );
});
