// Action names only. The body is {"event":"<name>"} with no account or health fields.

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
  return {
    sent,
    record(name: string) {
      const body = accountEventBody(name);
      if (!body) return;
      sent.push(body);
      if (!endpoint) return;
      void fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    },
  };
}

export type AccountAnalytics = ReturnType<typeof createAnalytics>;
