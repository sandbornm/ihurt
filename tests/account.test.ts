import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AccountApiError,
  accountApiOrigin,
  createAccountApi,
  remoteEntries,
} from "../src/account/api.ts";
import {
  accountEventBody,
  createAnalytics,
} from "../src/account/analytics.ts";
import { readTestRuntime } from "../src/account/auth.ts";
import {
  BACKUP_DAYS,
  backupUploadSet,
  entriesForBackup,
  FREE_SEARCHES,
  withinBackupWindow,
} from "../src/account/backup.ts";
import { readAccountConfig, testRuntimeAllowed } from "../src/account/config.ts";
import { acceptStoredEntry } from "../src/notebook-data.ts";
import {
  passkeyRpId,
  passkeySignIn,
  prepareCreationOptions,
  prepareRequestOptions,
} from "../src/account/passkey.ts";
import {
  accountDeleteKeepsDevice,
  accountDeleteStage,
  clearOptIn,
  deleteSignedInAccount,
  grantOptIn,
  optedIn,
  pushBackup,
  readSyncedIds,
  rememberSynced,
  type KeyValueStore,
} from "../src/account/sync.ts";

const NOW = Date.parse("2026-11-27T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function memory(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function entry(id: string, ageDays: number) {
  return {
    id,
    created: new Date(NOW - ageDays * DAY).toISOString(),
    note: id,
  };
}

test("backup window keeps 90 days and drops older entries", () => {
  assert.equal(BACKUP_DAYS, 90);
  assert.equal(FREE_SEARCHES, 5);
  const recent = entry("recent", 89);
  const edge = entry("edge", 90);
  const old = entry("old", 91);
  const future = entry("future", -2);
  assert.equal(withinBackupWindow(recent, NOW), true);
  assert.equal(withinBackupWindow(edge, NOW), true);
  assert.equal(withinBackupWindow(old, NOW), false);
  assert.equal(withinBackupWindow(future, NOW), false);
  assert.deepEqual(
    entriesForBackup([recent, edge, old, future], NOW).map((row) => row.id),
    ["recent", "edge"],
  );
  const edited = {
    id: "edited",
    created: new Date(NOW - 120 * DAY).toISOString(),
    updated: new Date(NOW - DAY).toISOString(),
  };
  assert.equal(withinBackupWindow(edited, NOW), false);
  assert.deepEqual(
    entriesForBackup([edited, recent], NOW).map((row) => row.id),
    ["recent"],
  );
  const remoteOnly = entry("remote", 2);
  const uploaded = backupUploadSet([recent], [remoteOnly, old], NOW).map(
    (row) => row.id,
  );
  assert.deepEqual(uploaded.sort(), ["recent", "remote"]);
});

test("sync waits for opt-in and does not follow a different account", async () => {
  const store = memory();
  const sent: string[][] = [];
  const entries = [entry("recent", 1), entry("old", 120)];
  const first = await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries,
    now: NOW,
    store,
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(first, []);
  assert.deepEqual(sent, []);
  grantOptIn(store, "user-a");
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries,
    now: NOW,
    store,
    put: async () => {
      sent.push(["wrong-user"]);
    },
  });
  assert.deepEqual(sent, []);
  assert.equal(optedIn(store, "user-b"), false);
  const pushed = await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries,
    now: NOW,
    store,
    put: async (token, rows) => {
      assert.equal(token, "token-a");
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(
    pushed.map((row) => row.id),
    ["recent"],
  );
  assert.deepEqual(readSyncedIds(store), ["recent"]);
  clearOptIn(store);
  assert.equal(optedIn(store, "user-a"), false);

  rememberSynced(store, ["remote", "recent"], "user-a");
  grantOptIn(store, "user-a");
  const stale: string[][] = [];
  const skipped = await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("recent", 1)],
    now: NOW,
    store,
    put: async (_token, rows) => {
      stale.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(skipped, []);
  assert.deepEqual(stale, []);
  const removed = await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("recent", 1)],
    deletedIds: ["remote"],
    now: NOW,
    store,
    put: async (_token, rows) => {
      stale.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(
    removed.map((row) => row.id),
    ["recent"],
  );
  assert.deepEqual(stale, [["recent"]]);
});

test("delete calls the API before wiping local synced entries", async () => {
  const store = memory();
  rememberSynced(store, ["synced"], "user-a");
  grantOptIn(store, "user-a");
  const failed: string[] = [];
  await assert.rejects(() =>
    deleteSignedInAccount({
      uid: "user-a",
      token: "token-a",
      api: {
        async deleteAccount() {
          failed.push("api");
          throw new AccountApiError(500, "down");
        },
      },
      removeLocal: async () => {
        failed.push("local");
      },
      deleteAuth: async () => {
        failed.push("auth");
      },
      store,
    }),
  );
  assert.deepEqual(failed, ["api"]);
  assert.deepEqual(readSyncedIds(store), ["synced"]);
  assert.equal(optedIn(store, "user-a"), true);

  const other: string[] = [];
  await deleteSignedInAccount({
    uid: "user-b",
    token: "token-b",
    api: {
      async deleteAccount() {
        other.push("api");
      },
    },
    removeLocal: async (ids) => {
      other.push(`local:${ids.join(",")}`);
    },
    deleteAuth: async () => {
      other.push("auth");
    },
    store,
  });
  assert.deepEqual(other, ["api", "local:", "auth"]);
  assert.deepEqual(readSyncedIds(store), ["synced"]);

  const done: string[] = [];
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: {
      async deleteAccount(token) {
        assert.equal(token, "token-a");
        done.push("api");
      },
    },
    removeLocal: async (ids) => {
      done.push(`local:${ids.join(",")}`);
    },
    deleteAuth: async () => {
      done.push("auth");
    },
    store,
  });
  assert.deepEqual(done, ["api", "local:synced", "auth"]);
  assert.deepEqual(readSyncedIds(store), []);
  assert.equal(optedIn(store, "user-a"), false);
});

test("delete without a backup API keeps the sign-in", async () => {
  const store = memory();
  rememberSynced(store, ["synced"], "user-a");
  grantOptIn(store, "user-a");
  let wiped = false;
  let removedAuth = false;
  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        api: null,
        removeLocal: async () => {
          wiped = true;
        },
        deleteAuth: async () => {
          removedAuth = true;
        },
        store,
      }),
    (error: unknown) => {
      assert.equal(accountDeleteStage(error), "api");
      assert.equal(accountDeleteKeepsDevice(error), true);
      assert.equal((error as { code?: unknown }).code, "no-api");
      return true;
    },
  );
  assert.equal(wiped, false);
  assert.equal(removedAuth, false);
  assert.deepEqual(readSyncedIds(store), ["synced"]);
  assert.equal(optedIn(store, "user-a"), true);
});

test("a rejected delete keeps the synced ids for a retry", async () => {
  const store = memory();
  rememberSynced(store, ["synced"], "user-a");
  grantOptIn(store, "user-a");
  const wiped: string[] = [];
  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        api: {
          async deleteAccount() {
            throw new TypeError("fetch failed");
          },
        },
        removeLocal: async (ids) => {
          wiped.push(...ids);
        },
        deleteAuth: async () => {
          throw new Error("auth");
        },
        store,
      }),
    (error: unknown) => {
      assert.equal(accountDeleteStage(error), "api");
      assert.equal(accountDeleteKeepsDevice(error), true);
      assert.equal(error instanceof TypeError, true);
      return true;
    },
  );
  assert.deepEqual(wiped, []);
  assert.deepEqual(readSyncedIds(store), ["synced"]);
  assert.equal(optedIn(store, "user-a"), true);

  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        api: {
          async deleteAccount() {},
        },
        removeLocal: async () => {},
        deleteAuth: async () => {
          throw new TypeError("auth network");
        },
        store,
      }),
    (error: unknown) =>
      accountDeleteStage(error) === "auth" && accountDeleteKeepsDevice(error),
  );
  assert.deepEqual(readSyncedIds(store), ["synced"]);
  assert.equal(optedIn(store, "user-a"), true);
});

test("a missing cloud account still finishes local wipe and auth delete", async () => {
  const store = memory();
  rememberSynced(store, ["synced"], "user-a");
  grantOptIn(store, "user-a");
  const done: string[] = [];
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: {
      async deleteAccount() {
        done.push("api");
        throw new AccountApiError(404, "missing");
      },
    },
    removeLocal: async (ids) => {
      done.push(`local:${ids.join(",")}`);
    },
    deleteAuth: async () => {
      done.push("auth");
    },
    store,
  });
  assert.deepEqual(done, ["api", "local:synced", "auth"]);
  assert.deepEqual(readSyncedIds(store), []);
  assert.equal(optedIn(store, "user-a"), false);
});

function storedEntry(map: unknown) {
  return {
    id: "entry-1",
    created: "2026-11-27T00:00:00.000Z",
    note: "Stiff after a walk.",
    provider: "Your notes",
    answers: [],
    map,
  };
}

const validMap = {
  title: "Walk",
  summary: "Stiff after a walk.",
  regions: ["neck"],
  quality: "",
  activity: "Walking",
  duration: "",
  intensity: null,
  question: null,
  urgent: false,
  safety_message: null,
};

test("a backup entry with an empty map is not stored", () => {
  const valid = storedEntry(validMap);
  const accepted = acceptStoredEntry(valid);
  assert.ok(accepted);
  assert.deepEqual(accepted?.map.regions, ["neck"]);
  assert.equal(acceptStoredEntry(storedEntry({})), null);
  assert.equal(
    acceptStoredEntry({
      ...valid,
      points: [
        {
          id: "pin-1",
          region: "chest",
          structure: "Sternum",
          position: [0, 1, 0],
        },
      ],
    }),
    null,
  );
  assert.equal(
    acceptStoredEntry({ ...valid, research: { activity: "Walking" } }),
    null,
  );
  const rows = remoteEntries({
    entries: [valid, storedEntry({}), { id: "nope" }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "entry-1");
});

test("map review does not spend a source search", () => {
  const root = new URL("../", import.meta.url);
  const review = readFileSync(new URL("src/AIOptions.tsx", root), "utf8");
  assert.equal(review.includes("guardSourceSearch"), false);
  assert.equal(review.includes("useSearch"), false);
  assert.equal(review.includes("/v1/searches"), false);
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  assert.equal(notebook.includes("beforeSearch={guardSourceSearch}"), true);
  const search = readFileSync(new URL("src/account/api.ts", root), "utf8");
  const quota = search.indexOf('request("/v1/searches"');
  assert.ok(quota > 0);
  assert.equal(search.slice(0, quota).includes("useSearch"), true);
});

test("account events are an action name and nothing else", async () => {
  const bodies: string[] = [];
  const analytics = createAnalytics("https://analytics.test/collect", async (_url, init) => {
    bodies.push(String(init?.body));
    return new Response(null, { status: 204 });
  });
  analytics.record("sign_in");
  analytics.record("note: shoulder pain person@example.com");
  analytics.record("upgrade_sheet");
  assert.equal(accountEventBody("sign_in"), '{"event":"sign_in"}');
  assert.equal(accountEventBody("uid-123"), null);
  assert.deepEqual(analytics.sent, ['{"event":"sign_in"}', '{"event":"upgrade_sheet"}']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const body of bodies) {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ["event"]);
    assert.equal(body.includes("shoulder"), false);
    assert.equal(String(parsed.event).includes("@"), false);
  }
});

test("account API accepts https and loopback, and maps limit codes", async () => {
  assert.equal(accountApiOrigin("https://api.ihurt.app"), "https://api.ihurt.app");
  assert.equal(accountApiOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(accountApiOrigin("http://localhost:8787"), "http://localhost:8787");
  assert.equal(accountApiOrigin("http://192.168.1.20"), null);
  assert.equal(accountApiOrigin("https://user:pass@api.ihurt.app"), null);
  assert.equal(createAccountApi(""), null);

  const seen: { url: string; authorization?: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({
      url: String(url),
      authorization: headers.authorization,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (String(url).endsWith("/v1/searches")) {
      return new Response(
        JSON.stringify({ code: "upgrade_coming_soon", remaining: 0 }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ tier: "free", searchesRemaining: 5, backupDays: 90, sync: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const api = createAccountApi("https://api.ihurt.app", fetchImpl);
  assert.ok(api);
  const status = await api.getAccount("id-token");
  assert.equal(status.searchesRemaining, 5);
  assert.equal(seen[0]?.authorization, "Bearer id-token");
  await assert.rejects(
    () => api.useSearch("id-token"),
    (error: unknown) => {
      assert.ok(error instanceof AccountApiError);
      assert.equal(error.code, "upgrade_coming_soon");
      assert.equal(error.remaining, 0);
      return true;
    },
  );
  assert.equal(seen[1]?.body, "{}");
  assert.equal(seen[1]?.body?.includes("note"), false);
});

test("passkey relying party is ihurt.app on the public host", async () => {
  assert.equal(passkeyRpId("ihurt.app"), "ihurt.app");
  assert.equal(passkeyRpId("www.ihurt.app"), "ihurt.app");
  assert.equal(passkeyRpId("127.0.0.1"), "127.0.0.1");
  assert.equal(passkeyRpId("localhost", "ihurt.app"), "localhost");
  const options = prepareRequestOptions(
    {
      challenge: btoa("challenge"),
      rpId: "evil.example",
      allowCredentials: [{ id: btoa("abc"), type: "public-key" }],
    },
    "ihurt.app",
  );
  assert.equal(options.rpId, "ihurt.app");
  const created = prepareCreationOptions(
    {
      challenge: btoa("challenge"),
      rp: { id: "evil.example", name: "Other" },
      user: { id: btoa("user"), name: "person@example.com", displayName: "Person" },
    },
    "ihurt.app",
  );
  assert.equal(created.rp.id, "ihurt.app");

  let seenRp = "";
  const tokens = await passkeySignIn({
    apiKey: "public-key",
    rpId: "ihurt.app",
    fetchImpl: async (url, init) => {
      const target = String(url);
      assert.equal(target.startsWith("https://identitytoolkit.googleapis.com/"), true);
      assert.equal(target.includes("key=public-key"), true);
      if (target.includes("passkeySignIn:start")) {
        return new Response(
          JSON.stringify({
            sessionId: "session-1",
            credentialRequestOptions: {
              challenge: btoa("challenge"),
              rpId: "evil.example",
            },
          }),
        );
      }
      const body = JSON.parse(String(init?.body)) as {
        authenticatorAuthenticationResponse: { id: string };
        name: string;
        sessionId?: string;
      };
      assert.equal(typeof body.authenticatorAuthenticationResponse.id, "string");
      assert.equal(body.name, "iHurt");
      assert.equal(body.sessionId, "session-1");
      return new Response(
        JSON.stringify({
          idToken: "header.payload.sig",
          refreshToken: "refresh",
          localId: "uid-pass",
        }),
      );
    },
    credentials: {
      async get(request) {
        seenRp = request.publicKey?.rpId ?? "";
        const raw = new Uint8Array([1, 2, 3]).buffer;
        return {
          id: "cred",
          type: "public-key",
          rawId: raw,
          response: {
            clientDataJSON: raw,
            authenticatorData: raw,
            signature: raw,
            userHandle: null,
          },
        } as PublicKeyCredential;
      },
    },
  });
  assert.equal(seenRp, "ihurt.app");
  assert.equal(tokens.localId, "uid-pass");
});

test("config comes from env and the test runtime stays on loopback", () => {
  assert.equal(testRuntimeAllowed("ihurt.app"), false);
  assert.equal(testRuntimeAllowed("localhost"), true);
  assert.equal(testRuntimeAllowed("127.0.0.1"), true);
  assert.deepEqual(
    readAccountConfig({
      VITE_FIREBASE_API_KEY: "public",
      VITE_FIREBASE_AUTH_DOMAIN: "ihurt.app",
      VITE_FIREBASE_PROJECT_ID: "ihurt",
      VITE_FIREBASE_APP_ID: "app",
      VITE_IHURT_API_BASE: "https://api.ihurt.app",
      VITE_PASSKEY_RP_ID: "",
      VITE_ANALYTICS_ENDPOINT: "",
    }),
    {
      firebase: {
        apiKey: "public",
        authDomain: "ihurt.app",
        projectId: "ihurt",
        appId: "app",
        passkeyRpId: "ihurt.app",
      },
      apiBase: "https://api.ihurt.app",
      passkeyRpId: "ihurt.app",
      analyticsEndpoint: "",
    },
  );
  assert.equal(readAccountConfig({}).firebase, null);
  const runtime = {
    auth: {
      async current() {
        return null;
      },
      onChange() {
        return () => {};
      },
      async signIn() {
        return "email-sent" as const;
      },
      async signOut() {},
      async deleteUser() {},
      async enrollPasskey() {},
    },
    apiBase: "https://ihurt-api.test",
  };
  assert.equal(readTestRuntime("ihurt.app", { __IHURT_ACCOUNT_RUNTIME__: runtime }), null);
  assert.equal(
    readTestRuntime("127.0.0.1", { __IHURT_ACCOUNT_RUNTIME__: runtime })?.apiBase,
    "https://ihurt-api.test",
  );
});
