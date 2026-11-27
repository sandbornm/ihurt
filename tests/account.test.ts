import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AccountApiError,
  accountApiOrigin,
  createAccountApi,
  remoteEntries,
} from "../src/account/api.ts";
import { accountEventBody, createAnalytics } from "../src/account/analytics.ts";
import { readTestRuntime } from "../src/account/auth.ts";
import { completeEmailLink } from "../src/account/firebase-auth.ts";
import {
  BACKUP_DAYS,
  backupRowsAfterMerge,
  backupUploadSet,
  entriesForBackup,
  FREE_SEARCHES,
  mergeBackupWindow,
  savedAfterBackupPull,
  toBackupPayload,
  withLocalPrivateFields,
  withinBackupWindow,
} from "../src/account/backup.ts";
import {
  emailContinueUrl,
  emailSignInAllowed,
  googleSignInAllowed,
  passkeySignInAllowed,
  readAccountConfig,
  testRuntimeAllowed,
} from "../src/account/config.ts";
import { acceptStoredEntry } from "../src/notebook-data.ts";
import {
  passkeyRpId,
  passkeySignIn,
  prepareCreationOptions,
  prepareRequestOptions,
  publicKeyCredentialToJSON,
} from "../src/account/passkey.ts";
import {
  backupEpoch,
  nextBackupEpoch,
  accountDeleteKeepsDevice,
  accountDeleteStage,
  backedIdsFor,
  clearOptIn,
  deleteSignedInAccount,
  grantOptIn,
  optedIn,
  pushBackup,
  readSyncedIds,
  rememberSeenEntries,
  rememberSynced,
  syncedIdsFor,
  withoutOtherAccountEntries,
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
  assert.equal(withinBackupWindow(future, NOW), true);
  assert.deepEqual(
    entriesForBackup([recent, edge, old, future], NOW).map((row) => row.id),
    ["recent", "edge", "future"],
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
  const older = {
    id: "same",
    created: new Date(NOW - DAY).toISOString(),
    noteUpdated: new Date(NOW - DAY).toISOString(),
    note: "older-note",
  };
  const newer = {
    id: "same",
    created: new Date(NOW - DAY).toISOString(),
    noteUpdated: new Date(NOW).toISOString(),
    note: "newer-note",
  };
  assert.equal(backupUploadSet([older], [newer], NOW)[0]?.note, "newer-note");
  assert.equal(backupUploadSet([newer], [older], NOW)[0]?.note, "newer-note");
  const local = {
    id: "same",
    created: new Date(NOW - DAY).toISOString(),
    note: "newer-note",
    points: [{ id: "pin-old" }],
  };
  const merged = {
    id: "same",
    created: new Date(NOW - DAY).toISOString(),
    note: "newer-note",
    points: [{ id: "pin-new" }],
  };
  const onlyLocal = {
    id: "local-only",
    created: new Date(NOW).toISOString(),
    note: "only-here",
  };
  const rows = backupRowsAfterMerge(
    [local, onlyLocal],
    [merged],
    new Set(["gone"]),
  );
  assert.deepEqual(rows.find((row) => row.id === "same")?.points, [
    { id: "pin-new" },
  ]);
  assert.equal(rows.find((row) => row.id === "local-only")?.note, "only-here");
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
  assert.deepEqual(syncedIdsFor(store, "user-a"), ["recent"]);
});

test("an entry aging out of the window does not block the next backup", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const sent: string[][] = [];
  const put = async (_token: string, rows: { id: string }[]) => {
    sent.push(rows.map((row) => row.id));
  };
  const aging = entry("aging", 89);
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [aging],
    now: NOW,
    store,
    put,
  });
  assert.deepEqual(sent, [["aging"]]);
  assert.deepEqual(syncedIdsFor(store, "user-a"), ["aging"]);

  const later = NOW + 2 * DAY;
  const fresh = {
    id: "fresh",
    created: new Date(later).toISOString(),
    note: "fresh",
  };
  const saved = await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [aging, fresh],
    now: later,
    store,
    put,
  });
  assert.deepEqual(
    saved.map((row) => row.id),
    ["fresh"],
  );
  assert.deepEqual(sent, [["aging"], ["fresh"]]);
  assert.deepEqual(syncedIdsFor(store, "user-a"), ["fresh"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["aging", "fresh"]);

  const wiped: string[] = [];
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    confirmRecentLogin: async () => {},
    api: { async deleteAccount() {} },
    removeLocal: async (ids) => {
      wiped.push(...ids);
    },
    deleteAuth: async () => {},
    store,
  });
  assert.deepEqual(wiped, ["aging", "fresh"]);
});

test("a stale sign-in deletes nothing", async () => {
  const store = memory();
  rememberSynced(store, ["synced"], "user-a");
  grantOptIn(store, "user-a");
  const steps: string[] = [];
  const stale = new Error("requires-recent-login");
  Object.defineProperty(stale, "code", { value: "auth/requires-recent-login" });
  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        confirmRecentLogin: async () => {
          steps.push("reauth");
          throw stale;
        },
        api: {
          async deleteAccount() {
            steps.push("api");
          },
        },
        removeLocal: async () => {
          steps.push("local");
        },
        deleteAuth: async () => {
          steps.push("auth");
        },
        store,
      }),
    (caught) => accountDeleteStage(caught) === "auth",
  );
  assert.deepEqual(steps, ["reauth"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["synced"]);
  assert.equal(optedIn(store, "user-a"), true);
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

test("each account keeps its own synced ids", async () => {
  const store = memory();
  rememberSynced(store, ["from-a"], "user-a");
  rememberSynced(store, ["from-b"], "user-b");
  assert.deepEqual(syncedIdsFor(store, "user-a"), ["from-a"]);
  assert.deepEqual(syncedIdsFor(store, "user-b"), ["from-b"]);
  const wiped: string[] = [];
  await deleteSignedInAccount({
    uid: "user-b",
    token: "token-b",
    api: { async deleteAccount() {} },
    removeLocal: async (ids) => {
      wiped.push(...ids);
    },
    deleteAuth: async () => {},
    store,
  });
  assert.deepEqual(wiped, ["from-b"]);
  assert.deepEqual(syncedIdsFor(store, "user-a"), ["from-a"]);
  const wipedAgain: string[] = [];
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: { async deleteAccount() {} },
    removeLocal: async (ids) => {
      wipedAgain.push(...ids);
    },
    deleteAuth: async () => {},
    store,
  });
  assert.deepEqual(wipedAgain, ["from-a"]);
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
        throw new AccountApiError(404, "not_found");
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

test("an unknown 404 does not delete local entries", async () => {
  const store = memory();
  rememberSynced(store, ["synced"], "user-a");
  grantOptIn(store, "user-a");
  const done: string[] = [];
  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        api: {
          async deleteAccount() {
            done.push("api");
            throw new AccountApiError(404, "invalid");
          },
        },
        removeLocal: async () => {
          done.push("local");
        },
        deleteAuth: async () => {
          done.push("auth");
        },
        store,
      }),
    (error: unknown) => accountDeleteStage(error) === "api",
  );
  assert.deepEqual(done, ["api"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["synced"]);
  assert.equal(optedIn(store, "user-a"), true);
});

test("a later save keeps another device's newer note and new entry", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["a"], "user-a");
  const localA = {
    id: "a",
    created: new Date(NOW - DAY).toISOString(),
    note: "old-a",
    noteUpdated: new Date(NOW - 2 * DAY).toISOString(),
    pointsUpdated: new Date(NOW).toISOString(),
    points: [{ id: "pin-new" }],
  };
  const remoteA = {
    ...localA,
    note: "new-a",
    noteUpdated: new Date(NOW).toISOString(),
    pointsUpdated: new Date(NOW - 2 * DAY).toISOString(),
    points: [{ id: "pin-old" }],
  };
  const sent: { id: string; note?: string; points?: { id: string }[] }[][] = [];
  const pushed = await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [
      localA,
      {
        id: "c",
        created: new Date(NOW).toISOString(),
        note: "laptop-c",
        noteUpdated: new Date(NOW).toISOString(),
      },
    ],
    now: NOW,
    store,
    pull: async () => [
      remoteA,
      {
        id: "b",
        created: new Date(NOW).toISOString(),
        note: "from-phone",
        noteUpdated: new Date(NOW).toISOString(),
      },
    ],
    put: async (_token, rows) => {
      sent.push(rows);
    },
  });
  const byId = new Map(pushed.map((row) => [row.id, row]));
  assert.equal(byId.get("a")?.note, "new-a");
  assert.deepEqual(byId.get("a")?.points, [{ id: "pin-new" }]);
  assert.equal(byId.get("b")?.note, "from-phone");
  assert.equal(byId.get("c")?.note, "laptop-c");
  assert.equal(sent.length, 1);

  const blocked: string[] = [];
  await assert.rejects(() =>
    pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("a", 1)],
      now: NOW,
      store,
      pull: async () => {
        throw new AccountApiError(500, "down");
      },
      put: async () => {
        blocked.push("put");
      },
    }),
  );
  assert.deepEqual(blocked, []);
});

test("clearing every pin does not upload pins with an empty region list", () => {
  const created = new Date(NOW - DAY).toISOString();
  const local = {
    id: "a",
    created,
    note: "note",
    noteUpdated: new Date(NOW - DAY).toISOString(),
    pointsUpdated: new Date(NOW - DAY).toISOString(),
    points: [
      {
        id: "pin-1",
        region: "neck",
        structure: "Sternum",
        position: [0, 1, 0] as [number, number, number],
      },
    ],
    map: { regions: ["neck"], title: "keep-title", summary: "note" },
  };
  const cleared = {
    id: "a",
    created,
    note: "note",
    noteUpdated: local.noteUpdated,
    pointsUpdated: new Date(NOW).toISOString(),
    map: { regions: [] as string[], title: "", summary: "note" },
  };
  const [merged] = mergeBackupWindow([local], [cleared], new Set(), NOW);
  assert.deepEqual(merged?.points, []);
  assert.deepEqual(merged?.map?.regions, []);
  assert.equal(merged?.map?.title, "keep-title");
  const payload = toBackupPayload(merged!);
  assert.deepEqual(payload.points, []);
  assert.deepEqual(payload.map.regions, []);
  assert.equal(acceptStoredEntry(payload)?.id, "a");
});

test("a slow clock does not drop cloud entries dated ahead of this device", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const ahead = {
    id: "ahead",
    created: new Date(NOW + 2 * DAY).toISOString(),
    note: "today-elsewhere",
  };
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("recent", 1)],
    now: NOW,
    store,
    pull: async () => [ahead],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent[0]?.sort(), ["ahead", "recent"]);
});

test("a fast clock does not drop a cloud entry the server still returned", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const remote = {
    id: "cloud",
    created: new Date(NOW - 88 * DAY).toISOString(),
    note: "still-in-window",
  };
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("recent", 1)],
    now: NOW + 5 * DAY,
    store,
    pull: async () => [remote],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent[0]?.sort(), ["cloud", "recent"]);
});

test("a backup started before sign-out does not upload after the same account returns", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const epoch = backupEpoch(store);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[] = [];
  const pending = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("deleted-later", 1)],
    now: NOW,
    store,
    epoch,
    pull: async () => {
      await gate;
      return [];
    },
    put: async () => {
      sent.push("put");
    },
  });
  nextBackupEpoch(store);
  clearOptIn(store);
  grantOptIn(store, "user-a");
  release();
  assert.deepEqual(await pending, []);
  assert.deepEqual(sent, []);
  assert.equal(optedIn(store, "user-a"), true);
});

test("a delete during the pull is left out of the upload", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  let entries = [entry("keep", 1), entry("gone", 1)];
  let deleted: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[][] = [];
  const pending = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: () => entries,
    now: NOW,
    store,
    deletedIds: () => deleted,
    pull: async () => {
      await gate;
      return [entry("keep", 1), entry("gone", 1)];
    },
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  entries = [entry("keep", 1)];
  deleted = ["gone"];
  release();
  const pushed = await pending;
  assert.deepEqual(
    pushed.map((row) => row.id),
    ["keep"],
  );
  assert.deepEqual(sent, [["keep"]]);
});

test("turning backup off during the pull skips the upload", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[] = [];
  const pending = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("recent", 1)],
    now: NOW,
    store,
    pull: async () => {
      await gate;
      return [];
    },
    put: async () => {
      sent.push("put");
    },
  });
  clearOptIn(store);
  release();
  assert.deepEqual(await pending, []);
  assert.deepEqual(sent, []);
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
  assert.throws(
    () =>
      remoteEntries({
        entries: [valid, storedEntry({}), { id: "nope" }],
      }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  assert.deepEqual(remoteEntries({ entries: [] }), []);
});

test("a mixed sync response is rejected before upload", async () => {
  const calls: string[] = [];
  const api = createAccountApi("https://ihurt-api.test", async (_url, init) => {
    calls.push(init?.method ?? "GET");
    return new Response(
      JSON.stringify({
        entries: [storedEntry(validMap), { id: "broken" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  assert.ok(api);
  await assert.rejects(
    () => api.getEntries("token"),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  assert.deepEqual(calls, ["GET"]);
});

test("duplicate sync ids are rejected before upload", () => {
  const row = storedEntry(validMap);
  assert.throws(
    () => remoteEntries({ entries: [row, { ...row, note: "other note" }] }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
});

test("backup upload sends notes and pins only", async () => {
  const entry = storedEntry({
    ...validMap,
    quality: "quality-marker",
    activity: "activity-marker",
  });
  entry.points = [
    {
      id: "pin-1",
      region: "neck",
      structure: "Sternum",
      position: [0, 1, 0],
      comment: "comment-marker",
    },
  ];
  entry.answers = [{ key: "quality", text: "answer-marker" }];
  entry.ai = {
    provider: "grok",
    created: "2026-11-27T00:00:00.000Z",
    based_on: "fp",
    map: { ...validMap, summary: "ai-marker" },
    answers: [],
  };
  entry.research = {
    activity: "Walking",
    description: "research-marker",
    regions: ["neck"],
    checked: "2026-11-27T00:00:00.000Z",
    references: [],
  };
  entry.references = [
    {
      title: "ref-marker",
      url: "https://example.org/reading",
      publisher: "Publisher",
    },
  ];
  entry.map = { ...validMap, title: "title-marker" };
  const payload = toBackupPayload(entry);
  const kept = withLocalPrivateFields(entry, payload);
  assert.equal(payload.map.title, "");
  assert.equal(kept.map.title, "title-marker");
  assert.equal(kept.points?.[0]?.comment, "comment-marker");
  assert.equal(kept.answers[0]?.text, "answer-marker");
  assert.equal(kept.research?.description, "research-marker");
  assert.equal(kept.ai?.map.summary, "ai-marker");
  let body = "";
  const api = createAccountApi("https://api.ihurt.app", async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response("{}", { status: 200 });
  });
  await api?.putEntries("token", [entry]);
  assert.equal(
    body.includes("note-marker") || body.includes("Stiff after a walk."),
    true,
  );
  assert.equal(body.includes("comment-marker"), false);
  assert.equal(body.includes("ai-marker"), false);
  assert.equal(body.includes("research-marker"), false);
  assert.equal(body.includes("answer-marker"), false);
  assert.equal(body.includes("ref-marker"), false);
  assert.equal(body.includes("quality-marker"), false);
  assert.equal(body.includes("title-marker"), false);
});

test("a downloaded backup does not keep server comments, answers, or AI notes", () => {
  const local = storedEntry(validMap);
  local.points = [
    {
      id: "pin-1",
      region: "neck",
      structure: "Sternum",
      position: [0, 1, 0],
      comment: "local-comment",
    },
  ];
  local.answers = [{ key: "quality", text: "local-answer" }];
  local.ai = {
    provider: "grok",
    created: "2026-11-27T00:00:00.000Z",
    based_on: "fp",
    map: { ...validMap, summary: "local-ai" },
    answers: [],
  };
  const incoming = storedEntry(validMap);
  incoming.points = [
    {
      id: "pin-1",
      region: "neck",
      structure: "Sternum",
      position: [0, 1, 0],
      comment: "server-comment",
    },
  ];
  incoming.answers = [{ key: "quality", text: "server-answer" }];
  incoming.ai = {
    provider: "grok",
    created: "2026-11-27T00:00:00.000Z",
    based_on: "fp",
    map: { ...validMap, summary: "server-ai" },
    answers: [],
  };
  incoming.research = {
    activity: "Walking",
    description: "server-research",
    regions: ["neck"],
    checked: "2026-11-27T00:00:00.000Z",
    references: [],
  };
  const bare = withLocalPrivateFields(undefined, incoming);
  assert.equal(bare.points?.[0]?.comment, undefined);
  assert.deepEqual(bare.answers, []);
  assert.equal(bare.ai, undefined);
  assert.equal(bare.research, undefined);
  const kept = withLocalPrivateFields(local, incoming);
  assert.equal(kept.points?.[0]?.comment, "local-comment");
  assert.equal(kept.answers[0]?.text, "local-answer");
  assert.equal(kept.ai?.map.summary, "local-ai");
  assert.equal(kept.research, undefined);
  assert.equal(JSON.stringify(kept).includes("server-"), false);
});

test("a later backup replaces the journal note and stays quiet when it is unchanged", () => {
  const local = {
    ...storedEntry({ ...validMap, title: "alpha-marker" }),
    note: "alpha-marker",
    noteUpdated: "2026-11-27T00:00:00.000Z",
  };
  const remote = {
    ...local,
    note: "cloud-note-marker",
    noteUpdated: "2026-11-27T01:00:00.000Z",
    map: { ...local.map, summary: "cloud-note-marker" },
  };
  const next = savedAfterBackupPull([local], [remote], [remote]);
  assert.equal(next[0]?.note, "cloud-note-marker");
  assert.equal(savedAfterBackupPull(next, [remote], [remote]), next);
});

test("account delete waits for an in-flight upload", async () => {
  const store = memory();
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const upload = (async () => {
    order.push("put-start");
    await gate;
    order.push("put-done");
  })();
  const pending = deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: {
      async deleteAccount() {
        order.push("delete");
      },
    },
    removeLocal: async () => {},
    deleteAuth: async () => {},
    settleUploads: () => upload,
    store,
  });
  await Promise.resolve();
  assert.deepEqual(order, ["put-start"]);
  release();
  await pending;
  assert.deepEqual(order, ["put-start", "put-done", "delete"]);
});

test("the next account does not upload the previous account's entries", async () => {
  const store = memory();
  rememberSeenEntries(store, "user-a", ["from-a"]);
  rememberSeenEntries(store, "user-b", ["from-a", "from-b"]);
  assert.deepEqual(
    withoutOtherAccountEntries(
      [entry("from-a", 1), entry("from-b", 1)],
      store,
      "user-b",
    ).map((row) => row.id),
    ["from-b"],
  );
  grantOptIn(store, "user-b");
  const sent = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [entry("from-a", 1), entry("from-b", 1)],
    now: NOW,
    store,
    pull: async () => [],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["from-b"]]);
});

test("a later save applies the downloaded note before the next upload", () => {
  const root = new URL("../", import.meta.url);
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  const store = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  const auth = readFileSync(
    new URL("src/account/firebase-auth.ts", root),
    "utf8",
  );
  assert.equal(
    button.includes("pushBackupEntries(entries, deleted, onMerge)"),
    true,
  );
  assert.equal(button.includes("rememberSeenEntries("), true);
  assert.equal(store.includes("await onMerge?.(remote)"), true);
  assert.equal(
    store.includes(
      "withoutOtherAccountEntries(kept, browserStore(), session.uid)",
    ),
    true,
  );
  assert.equal(store.includes("settleUploads: () => pushChain"), true);
  assert.equal(notebook.includes("savedAfterBackupPull"), true);
  assert.equal(auth.includes("storage()?.setItem(REFRESH_KEY"), false);
  assert.equal(auth.includes("storage()?.getItem(REFRESH_KEY"), false);
  assert.equal(
    auth.includes("sessionStorageOrNull()?.setItem(REFRESH_KEY, token)"),
    true,
  );
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
  const analytics = createAnalytics(
    "https://analytics.test/collect",
    async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(null, { status: 204 });
    },
  );
  analytics.record("sign_in");
  analytics.record("note: shoulder pain person@example.com");
  analytics.record("upgrade_sheet");
  assert.equal(accountEventBody("sign_in"), '{"event":"sign_in"}');
  assert.equal(accountEventBody("uid-123"), null);
  assert.deepEqual(analytics.sent, [
    '{"event":"sign_in"}',
    '{"event":"upgrade_sheet"}',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const body of bodies) {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ["event"]);
    assert.equal(body.includes("shoulder"), false);
    assert.equal(String(parsed.event).includes("@"), false);
  }
});

test("account API accepts https and loopback, and maps limit codes", async () => {
  assert.equal(
    accountApiOrigin("https://api.ihurt.app"),
    "https://api.ihurt.app",
  );
  assert.equal(
    accountApiOrigin("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787",
  );
  assert.equal(
    accountApiOrigin("http://localhost:8787"),
    "http://localhost:8787",
  );
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
    return new Response(
      JSON.stringify({
        tier: "free",
        searchesRemaining: 5,
        backupDays: 90,
        sync: false,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
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
      user: {
        id: btoa("user"),
        name: "person@example.com",
        displayName: "Person",
      },
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
      assert.equal(
        target.startsWith("https://identitytoolkit.googleapis.com/"),
        true,
      );
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
        authenticatorAuthenticationResponse: {
          id: string;
          rawId: string;
          response: {
            clientDataJSON: string;
            authenticatorData: string;
            signature: string;
          };
        };
        name: string;
        sessionId?: string;
      };
      assert.equal(body.authenticatorAuthenticationResponse.rawId, "-_8");
      assert.equal(
        body.authenticatorAuthenticationResponse.response.clientDataJSON,
        "-_8",
      );
      assert.equal(
        body.authenticatorAuthenticationResponse.response.signature,
        "-_8",
      );
      assert.equal(
        body.authenticatorAuthenticationResponse.rawId.includes("+"),
        false,
      );
      assert.equal(
        body.authenticatorAuthenticationResponse.rawId.includes("/"),
        false,
      );
      assert.equal(
        body.authenticatorAuthenticationResponse.rawId.includes("="),
        false,
      );
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
        const raw = new Uint8Array([251, 255]).buffer;
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

test("passkey bytes that need base64url are unpadded", () => {
  const raw = new Uint8Array([251, 255]).buffer;
  const assertion = publicKeyCredentialToJSON({
    id: "cred",
    type: "public-key",
    rawId: raw,
    response: {
      clientDataJSON: raw,
      authenticatorData: raw,
      signature: raw,
      userHandle: raw,
    },
  } as PublicKeyCredential) as {
    rawId: string;
    response: Record<string, string>;
  };
  assert.equal(assertion.rawId, "-_8");
  assert.equal(assertion.response.authenticatorData, "-_8");
  assert.equal(assertion.response.userHandle, "-_8");
  assert.equal(assertion.rawId.includes("+"), false);
  assert.equal(assertion.rawId.includes("="), false);
  const registered = publicKeyCredentialToJSON({
    id: "cred",
    type: "public-key",
    rawId: raw,
    response: { clientDataJSON: raw, attestationObject: raw },
  } as PublicKeyCredential) as { response: { attestationObject: string } };
  assert.equal(registered.response.attestationObject, "-_8");
  const fromJson = publicKeyCredentialToJSON({
    id: "cred",
    type: "public-key",
    rawId: raw,
    response: { clientDataJSON: raw },
    toJSON: () => ({ id: "from-json", rawId: "-_8" }),
  } as PublicKeyCredential) as { id: string };
  assert.equal(fromJson.id, "from-json");
});

test("config comes from env and the test runtime stays on loopback", async () => {
  assert.equal(testRuntimeAllowed("ihurt.app"), false);
  assert.equal(testRuntimeAllowed("localhost"), true);
  assert.equal(testRuntimeAllowed("127.0.0.1"), true);
  assert.equal(testRuntimeAllowed("localhost", "capacitor:"), false);
  assert.equal(emailSignInAllowed("https:"), true);
  assert.equal(emailSignInAllowed("capacitor:"), false);
  assert.equal(passkeySignInAllowed("https:"), true);
  assert.equal(passkeySignInAllowed("capacitor:"), false);
  assert.equal(googleSignInAllowed("https:"), true);
  assert.equal(googleSignInAllowed("capacitor:"), false);
  assert.equal(
    emailContinueUrl("https://ihurt.app/notebook", "ihurt.app"),
    "https://ihurt.app/?emailLink=1",
  );
  assert.equal(
    emailContinueUrl("http://localhost:5173/notebook", "ihurt.app"),
    "http://localhost:5173/?emailLink=1",
  );
  assert.equal(
    emailContinueUrl("capacitor://localhost", "ihurt.app"),
    "https://ihurt.app/?emailLink=1",
  );
  const cleared: string[] = [];
  const failed = await completeEmailLink({
    isLink: true,
    email: "person@example.com",
    href: "https://ihurt.app/?oobCode=bad",
    signIn: async () => {
      throw new Error("invalid-action-code");
    },
    clearEmail: () => cleared.push("email"),
    clearQuery: () => cleared.push("query"),
  });
  assert.equal(failed, false);
  assert.deepEqual(cleared, ["email", "query"]);
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
  const iosEnv = {
    VITE_FIREBASE_API_KEY: "website-key",
    VITE_FIREBASE_IOS_API_KEY: "ios-key",
    VITE_FIREBASE_AUTH_DOMAIN: "ihurt.app",
    VITE_FIREBASE_PROJECT_ID: "ihurt",
    VITE_FIREBASE_APP_ID: "app",
  };
  assert.equal(
    readAccountConfig(iosEnv, "https:").firebase?.apiKey,
    "website-key",
  );
  assert.equal(
    readAccountConfig(iosEnv, "capacitor:").firebase?.apiKey,
    "ios-key",
  );
  assert.equal(
    readAccountConfig(
      { ...iosEnv, VITE_FIREBASE_IOS_API_KEY: "" },
      "capacitor:",
    ).firebase,
    null,
  );
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
      async reauthenticate() {},
      async deleteUser() {},
      async enrollPasskey() {},
    },
    apiBase: "https://ihurt-api.test",
  };
  assert.equal(
    readTestRuntime("ihurt.app", { __IHURT_ACCOUNT_RUNTIME__: runtime }),
    null,
  );
  assert.equal(
    readTestRuntime(
      "localhost",
      { __IHURT_ACCOUNT_RUNTIME__: runtime },
      "capacitor:",
    ),
    null,
  );
  assert.equal(
    readTestRuntime("127.0.0.1", { __IHURT_ACCOUNT_RUNTIME__: runtime })
      ?.apiBase,
    "https://ihurt-api.test",
  );
});
