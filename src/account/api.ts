import { acceptStoredEntry } from "../notebook-data.ts";
import type { SavedMap } from "../types.ts";
import {
  toBackupPayload,
  withDownloadedRegions,
  withoutServerMapDetails,
  type BackupEntry,
} from "./backup.ts";

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
  putEntries(
    token: string,
    entries: readonly BackupEntry[],
    revision: string,
  ): Promise<void>;
  getEntries(token: string): Promise<{
    entries: SavedMap[];
    deleted: readonly string[];
    revision: string;
  }>;
  deleteAccount(token: string): Promise<void>;
  useSearch(token: string): Promise<{ remaining: number }>;
  cancelRequests(): void;
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

// Same byte cap as an .ihm import. The entry cap matches that import's list cap.
export const ACCOUNT_RESPONSE_BYTES = 10 * 1024 * 1024;
export const SYNC_ENTRY_LIMIT = 500;
// One upload, then two pulls after a stale snapshot is rejected.
export const SYNC_UPLOAD_ATTEMPTS = 3;
const SYNC_REVISION_LIMIT = 200;

export function isBackupConflict(error: unknown): boolean {
  return error instanceof AccountApiError && error.code === "conflict";
}

function requireRevision(value: unknown, status: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SYNC_REVISION_LIMIT ||
    value.trim() !== value
  )
    throw new AccountApiError(status, "invalid");
  return value;
}

// A download above this limit is rejected. The upload has to stop at the same
// limit, or the next pull cannot be stored.
export function assertSyncEntryLimit(count: number) {
  if (count > SYNC_ENTRY_LIMIT) throw new AccountApiError(0, "too-many");
}

// A stored id is at most 100 characters. JSON writes a control character as
// \uXXXX, six bytes, which is wider than the three-byte UTF-8 form. The next
// pull's deleted list is reserved at that escaped size.
const STORED_ID_LIMIT = 100;
const WIDEST_STORED_ID = "\u0000".repeat(STORED_ID_LIMIT);

// The upload is `revision` and `entries`. The next pull can add `deleted`,
// up to one id per entry in the window. Leave that room or the pull is rejected.
export function deletedListBytes(count: number): number {
  if (count <= 0) return 0;
  const encoder = new TextEncoder();
  const id = encoder.encode(JSON.stringify(WIDEST_STORED_ID)).byteLength;
  return (
    encoder.encode(',"deleted":[').byteLength +
    count * id +
    (count - 1) +
    encoder.encode("]").byteLength
  );
}

export function backupRequestBytes(
  entries: readonly BackupEntry[],
  revision: string,
): number {
  const encoder = new TextEncoder();
  const bytes = (value: string) => encoder.encode(value).byteLength;
  let total = bytes(`{"revision":${JSON.stringify(revision)},"entries":[`);
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) total += 1;
    total += bytes(JSON.stringify(toBackupPayload(entries[index]!)));
  }
  return total + bytes("]}");
}

// Walk the payload and stop once it passes the pull cap. One oversized note
// must not stringify the rest of the journal or leave the device.
export function assertBackupPayload(
  entries: readonly BackupEntry[],
  revision: string,
) {
  const room = ACCOUNT_RESPONSE_BYTES - deletedListBytes(SYNC_ENTRY_LIMIT);
  const encoder = new TextEncoder();
  const bytes = (value: string) => encoder.encode(value).byteLength;
  let total = bytes(`{"revision":${JSON.stringify(revision)},"entries":[`);
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) total += 1;
    total += bytes(JSON.stringify(toBackupPayload(entries[index]!)));
    if (total > room) throw new AccountApiError(0, "too-large");
  }
  total += bytes("]}");
  if (total > room) throw new AccountApiError(0, "too-large");
}
// The local research request uses the same bound. A fetch or a body that never
// finishes must release backup and deletion instead of holding them open.
export const ACCOUNT_REQUEST_MS = 135_000;

export function remoteEntries(value: unknown): SavedMap[] {
  if (!value || typeof value !== "object")
    throw new AccountApiError(200, "invalid");
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries) || entries.length > SYNC_ENTRY_LIMIT)
    throw new AccountApiError(200, "invalid");
  const rows = entries.map((entry) => {
    const accepted = acceptStoredEntry(entry);
    if (!accepted) throw new AccountApiError(200, "invalid");
    const matched = withDownloadedRegions(accepted);
    if (!matched) throw new AccountApiError(200, "invalid");
    return withoutServerMapDetails(matched);
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new AccountApiError(200, "invalid");
    ids.add(row.id);
  }
  return rows;
}

// A missing `deleted` list is not a delete. Another device's full snapshot can
// omit a note this device uploaded. Only ids the server names are deletions.
// `revision` is the snapshot this list was read from. The next replacement
// must send it. Omitting an entry in that replacement deletes it, so a list
// from an older snapshot cannot be written. The server rejects that write
// with 409 and code `conflict`.
export function remoteSync(value: unknown): {
  entries: SavedMap[];
  deleted: readonly string[];
  revision: string;
} {
  const entries = remoteEntries(value);
  const named = (value as { deleted?: unknown }).deleted;
  const revision = requireRevision(
    (value as { revision?: unknown }).revision,
    200,
  );
  if (named === undefined) return { entries, deleted: [], revision };
  if (!Array.isArray(named) || named.length > SYNC_ENTRY_LIMIT)
    throw new AccountApiError(200, "invalid");
  const present = new Set(entries.map((entry) => entry.id));
  const deleted: string[] = [];
  for (const id of named) {
    if (
      typeof id !== "string" ||
      !id ||
      id.length > STORED_ID_LIMIT ||
      present.has(id) ||
      deleted.includes(id)
    )
      throw new AccountApiError(200, "invalid");
    deleted.push(id);
  }
  return { entries, deleted, revision };
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

async function readLimited(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0 || size > ACCOUNT_RESPONSE_BYTES)
      throw new AccountApiError(response.status, "invalid");
  }
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  const onAbort = () => stop();
  signal.addEventListener("abort", onAbort);
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Cancel alone does not settle a read whose pull never finishes. Race the
  // deadline so the caller, and the upload lock it holds, can move on.
  const readChunk = () =>
    new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      if (signal.aborted) {
        reject(new AccountApiError(0, "network"));
        return;
      }
      const fail = () => reject(new AccountApiError(0, "network"));
      signal.addEventListener("abort", fail, { once: true });
      reader.read().then(
        (result) => {
          signal.removeEventListener("abort", fail);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", fail);
          reject(error);
        },
      );
    });
  try {
    for (;;) {
      const { done, value } = await readChunk();
      if (done) break;
      if (!value?.byteLength) continue;
      if (total + value.byteLength > ACCOUNT_RESPONSE_BYTES)
        throw new AccountApiError(response.status, "invalid");
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    stop();
    if (error instanceof AccountApiError) throw error;
    if (signal.aborted) throw new AccountApiError(0, "network");
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  reader.releaseLock();
  if (total === 0) return "";
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function createAccountApi(
  base: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = ACCOUNT_REQUEST_MS,
): AccountApi | null {
  const origin = accountApiOrigin(base);
  if (!origin) return null;

  let flight = new AbortController();

  function cancelRequests() {
    flight.abort();
    flight = new AbortController();
  }

  async function request(
    path: string,
    token: string,
    method: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new AccountApiError(0, "network")),
      timeoutMs,
    );
    const parent = flight;
    const onParent = () =>
      controller.abort(new AccountApiError(0, "cancelled"));
    if (parent.signal.aborted) onParent();
    else parent.signal.addEventListener("abort", onParent, { once: true });
    let response: Response;
    try {
      try {
        response = await fetchImpl(`${origin}${path}`, {
          method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch (error) {
        if (parent.signal.aborted) throw new AccountApiError(0, "cancelled");
        if (error instanceof AccountApiError) throw error;
        throw new AccountApiError(0, "network");
      }
      const text = await readLimited(response, controller.signal);
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
    } catch (error) {
      if (parent.signal.aborted) throw new AccountApiError(0, "cancelled");
      throw error;
    } finally {
      clearTimeout(timer);
      parent.signal.removeEventListener("abort", onParent);
    }
  }

  return {
    async getAccount(token) {
      return statusFrom(await request("/v1/account", token, "GET"));
    },
    async enableSync(token) {
      await request("/v1/account/sync", token, "POST", { optIn: true });
    },
    async putEntries(token, entries, revision) {
      assertSyncEntryLimit(entries.length);
      const generation = requireRevision(revision, 0);
      assertBackupPayload(entries, generation);
      await request("/v1/sync", token, "PUT", {
        revision: generation,
        entries: entries.map((entry) => toBackupPayload(entry)),
      });
    },
    async getEntries(token) {
      return remoteSync(await request("/v1/sync", token, "GET"));
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
    cancelRequests,
  };
}
