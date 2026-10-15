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
