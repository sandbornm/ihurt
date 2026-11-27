import type { SavedMap } from "../types.ts";
import type { BackupEntry } from "./backup.ts";

export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly remaining?: number;
  constructor(status: number, code = "", remaining?: number) {
    super(code || `account-${status}`);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
    this.remaining = remaining;
  }
}

export interface AccountStatus {
  tier: string;
  searchesRemaining: number;
  backupDays: number;
  sync: boolean;
}

export interface AccountApi {
  getAccount(token: string): Promise<AccountStatus>;
  enableSync(token: string): Promise<void>;
  putEntries(token: string, entries: readonly BackupEntry[]): Promise<void>;
  getEntries(token: string): Promise<SavedMap[]>;
  deleteAccount(token: string): Promise<void>;
  useSearch(token: string): Promise<{ remaining: number }>;
}

export function accountApiOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && local) return url.origin;
  return null;
}

function isSavedMap(value: unknown): value is SavedMap {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SavedMap>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    row.id.length < 80 &&
    typeof row.created === "string" &&
    row.created.length < 40 &&
    typeof row.note === "string" &&
    typeof row.provider === "string" &&
    Array.isArray(row.answers) &&
    !!row.map &&
    typeof row.map === "object"
  );
}

export function remoteEntries(value: unknown): SavedMap[] {
  if (!value || typeof value !== "object") return [];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(isSavedMap);
}

function statusFrom(value: unknown): AccountStatus {
  if (!value || typeof value !== "object")
    throw new AccountApiError(200, "invalid");
  const row = value as {
    tier?: unknown;
    searchesRemaining?: unknown;
    backupDays?: unknown;
    sync?: unknown;
  };
  if (typeof row.tier !== "string" || !row.tier)
    throw new AccountApiError(200, "invalid");
  if (
    typeof row.searchesRemaining !== "number" ||
    !Number.isFinite(row.searchesRemaining)
  )
    throw new AccountApiError(200, "invalid");
  return {
    tier: row.tier,
    searchesRemaining: row.searchesRemaining,
    backupDays:
      typeof row.backupDays === "number" && Number.isFinite(row.backupDays)
        ? row.backupDays
        : 90,
    sync: row.sync === true,
  };
}

export function createAccountApi(
  base: string,
  fetchImpl: typeof fetch = fetch,
): AccountApi | null {
  const origin = accountApiOrigin(base);
  if (!origin) return null;

  async function request(
    path: string,
    token: string,
    method: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetchImpl(`${origin}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new AccountApiError(response.status, "invalid");
      }
    }
    if (!response.ok) {
      const row = data as { code?: unknown; remaining?: unknown };
      throw new AccountApiError(
        response.status,
        typeof row.code === "string" ? row.code : "",
        typeof row.remaining === "number" ? row.remaining : undefined,
      );
    }
    return data;
  }

  return {
    async getAccount(token) {
      return statusFrom(await request("/v1/account", token, "GET"));
    },
    async enableSync(token) {
      await request("/v1/account/sync", token, "POST", { optIn: true });
    },
    async putEntries(token, entries) {
      await request("/v1/sync", token, "PUT", { entries });
    },
    async getEntries(token) {
      return remoteEntries(await request("/v1/sync", token, "GET"));
    },
    async deleteAccount(token) {
      await request("/v1/account", token, "DELETE");
    },
    async useSearch(token) {
      const data = await request("/v1/searches", token, "POST", {});
      const remaining = (data as { remaining?: unknown }).remaining;
      if (typeof remaining !== "number" || !Number.isFinite(remaining))
        throw new AccountApiError(200, "invalid");
      return { remaining };
    },
  };
}
