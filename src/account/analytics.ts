// Action names only. The body is {"event":"<name>"} with no account or health fields.

import { accountApiOrigin } from "./api.ts";

// Same https and loopback rule as the backup API. A path is allowed, because
// this is the full collect URL and not an origin.
export function allowedAnalyticsUrl(endpoint: string): string | null {
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (!accountApiOrigin(url.origin)) return null;
  return trimmed;
}

export const ACCOUNT_EVENTS = [
  "sign_in",
  "sign_out",
  "sync_on",
  "sync_off",
  "upgrade_sheet",
  "account_delete",
] as const;

export type AccountEvent = (typeof ACCOUNT_EVENTS)[number];

const ALLOWED = new Set<string>(ACCOUNT_EVENTS);

export function accountEventBody(name: string): string | null {
  if (!ALLOWED.has(name)) return null;
  return JSON.stringify({ event: name });
}

export function createAnalytics(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
) {
  const sent: string[] = [];
  const target = allowedAnalyticsUrl(endpoint);
  return {
    sent,
    record(name: string) {
      const body = accountEventBody(name);
      if (!body) return;
      sent.push(body);
      if (!target) return;
      void fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    },
  };
}

export type AccountAnalytics = ReturnType<typeof createAnalytics>;
