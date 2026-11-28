import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_RESPONSE_BYTES,
  AccountApiError,
  accountApiOrigin,
  backupRequestBytes,
  createAccountApi,
  deletedListBytes,
  remoteEntries,
  remoteSync,
  SYNC_ENTRY_LIMIT,
} from "../src/account/api.ts";
import { accountEventBody, createAnalytics } from "../src/account/analytics.ts";
import { readTestRuntime } from "../src/account/auth.ts";
import {
  remainingForSession,
  sourceSearchDecision,
} from "../src/account/store.ts";
import { completeEmailLink } from "../src/account/firebase-auth.ts";
import {
  BACKUP_DAYS,
  backupClock,
  backupConfirmDecision,
  backupEnableDecision,
  confirmAccountDecision,
  backupRowsAfterMerge,
  backupUploadSet,
  entriesForBackup,
  FREE_SEARCHES,
  idsDeletedOnServer,
  remoteDeletesStillPending,
  mergeBackupWindow,
  entryKeptAfterRemoteDelete,
  entryKeptAfterRemove,
  remoteDeleteClosesEditor,
  restoreClosesEditor,
  savedAfterBackupPull,
  toBackupPayload,
  withLocalPrivateFields,
  withinBackupWindow,
} from "../src/account/backup.ts";
import {
  emailContinueUrl,
  emailSignInAllowed,
  googleSignInAllowed,
  readAccountConfig,
  testRuntimeAllowed,
} from "../src/account/config.ts";
import { acceptStoredEntry } from "../src/notebook-data.ts";
import {
  backupEpoch,
  backupOptInFromStorage,
  nextBackupEpoch,
  OPT_IN_KEY,
  OPT_IN_UID_KEY,
  accountDeleteKeepsDevice,
  accountDeleteStage,
  backedIdsFor,
  clearOptIn,
  signOutAccount,
  accountDeleting,
  claimUpload,
  deleteSignedInAccount,
  grantOptIn,
  optedIn,
  pushBackup,
  readSyncedIds,
  downloadedIdsFor,
  rememberDownloaded,
  rememberRemoteDeletes,
  rememberSeenEntries,
  rememberSynced,
  restoreEntryOwners,
  restoreRetiredEntry,
  retireEntry,
  retireEntryOwners,
  removedIdsFor,
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

test("another tab's backup switch is the opt-in this tab shows", () => {
  const store = memory();
  assert.equal(backupOptInFromStorage("user-a", store, "ihurt-theme"), null);
  assert.equal(backupOptInFromStorage("user-a", store, OPT_IN_KEY), false);
  grantOptIn(store, "user-a");
  assert.equal(backupOptInFromStorage("user-a", store, OPT_IN_KEY), true);
  assert.equal(backupOptInFromStorage("user-a", store, OPT_IN_UID_KEY), true);
  clearOptIn(store);
  assert.equal(backupOptInFromStorage("user-a", store, OPT_IN_UID_KEY), false);
  grantOptIn(store, "user-b");
  assert.equal(backupOptInFromStorage("user-a", store, null), false);
  assert.equal(backupOptInFromStorage(null, store, OPT_IN_KEY), false);
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

test("a failed Firebase delete turns backup off before the next save", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["backed"], "user-a");
  const epoch = backupEpoch(store);
  const sent: string[] = [];
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
          throw new Error("auth down");
        },
        store,
      }),
    (caught) =>
      accountDeleteStage(caught) === "auth" &&
      (caught as { code?: unknown }).code === "delete-partial",
  );
  assert.equal(optedIn(store, "user-a"), false);
  assert.ok(backupEpoch(store) > epoch);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["backed"]);
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("later", 1)],
    now: NOW,
    store,
    epoch: backupEpoch(store),
    pull: async () => [],
    put: async () => {
      sent.push("put");
    },
  });
  assert.deepEqual(sent, []);
});

test("a cloud delete turns that account's backup off before a session switch", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["backed"], "user-a");
  const epoch = backupEpoch(store);
  let uid = "user-a";
  const calls: string[] = [];
  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        api: {
          async deleteAccount() {
            calls.push("api");
            uid = "user-b";
          },
        },
        removeLocal: async () => {
          calls.push("local");
        },
        deleteAuth: async () => {
          calls.push("auth");
        },
        sameAccount: () => uid === "user-a",
        store,
      }),
    (error: unknown) =>
      (error as { code?: string } | null)?.code === "cancelled",
  );
  assert.deepEqual(calls, ["api"]);
  assert.equal(optedIn(store, "user-a"), false);
  assert.ok(backupEpoch(store) > epoch);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["backed"]);
  const sent: string[] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("later", 1)],
    now: NOW,
    store,
    epoch: backupEpoch(store),
    pull: async () => [],
    put: async () => {
      sent.push("put");
    },
  });
  assert.deepEqual(sent, []);
});

test("a failed delete leaves the other tab's deletion in place", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paused = deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: {
      async deleteAccount() {
        await gate;
      },
    },
    removeLocal: async () => {},
    deleteAuth: async () => {},
    store,
  });
  for (let i = 0; i < 20 && !accountDeleting(store, "user-a"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(accountDeleting(store, "user-a"), true);
  await assert.rejects(
    () =>
      deleteSignedInAccount({
        uid: "user-a",
        token: "token-a",
        api: {
          async deleteAccount() {
            throw new Error("api down");
          },
        },
        removeLocal: async () => {},
        deleteAuth: async () => {},
        store,
      }),
    (error: unknown) => accountDeleteStage(error) === "api",
  );
  assert.equal(accountDeleting(store, "user-a"), true);
  const sent: string[] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("during", 1)],
    now: NOW,
    store,
    pull: async () => [],
    put: async () => {
      sent.push("put");
    },
  });
  assert.deepEqual(sent, []);
  release();
  await paused;
  assert.equal(accountDeleting(store, "user-a"), false);
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
  assert.equal(optedIn(store, "user-a"), false);
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

test("a local pin clear without a points array beats an older remote pin list", () => {
  const created = new Date(NOW - DAY).toISOString();
  const remote = {
    id: "a",
    created,
    note: "newer-note",
    noteUpdated: new Date(NOW).toISOString(),
    pointsUpdated: new Date(NOW - 2 * DAY).toISOString(),
    points: [{ id: "old" }],
  };
  const local = {
    id: "a",
    created,
    note: "older-note",
    noteUpdated: new Date(NOW - DAY).toISOString(),
    pointsUpdated: new Date(NOW - DAY).toISOString(),
  };
  const [merged] = mergeBackupWindow([local], [remote], new Set(), NOW);
  assert.equal(merged?.note, "newer-note");
  assert.deepEqual(merged?.points, []);
  assert.equal(merged?.pointsUpdated, local.pointsUpdated);
  const payload = toBackupPayload(merged!);
  assert.deepEqual(payload.points, []);
  assert.deepEqual(payload.map.regions, []);
});

test("a note with regions and no pins does not upload those regions", () => {
  const payload = toBackupPayload({
    id: "legacy",
    created: new Date(NOW).toISOString(),
    note: "imported",
    map: {
      regions: ["neck", "shoulder"],
      title: "title-marker",
      summary: "imported",
    },
  });
  assert.deepEqual(payload.map.regions, []);
  assert.deepEqual(payload.points, []);
  assert.equal(payload.note, "imported");
  assert.equal(payload.map.title, "");
  const pinned = toBackupPayload({
    id: "legacy",
    created: new Date(NOW).toISOString(),
    note: "imported",
    points: [
      {
        id: "pin-1",
        region: "neck",
        structure: "Sternum",
        position: [0, 1, 0],
      },
    ],
    map: { regions: ["neck", "shoulder"], summary: "imported" },
  });
  assert.deepEqual(pinned.map.regions, ["neck"]);
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

test("a future remote stamp does not drop a current local note", async () => {
  const far = new Date(NOW + 400 * DAY).toISOString();
  const fields = [
    "created",
    "updated",
    "noteUpdated",
    "pointsUpdated",
  ] as const;
  for (const field of fields) {
    const clock = backupClock(NOW, [
      {
        id: "ahead",
        created: new Date(NOW).toISOString(),
        [field]: far,
      },
    ]);
    assert.ok(clock < NOW + 60 * DAY, field);
    assert.equal(
      entriesForBackup([entry("today", 0), entry("within", 30)], clock).length,
      2,
      field,
    );
  }
  const store = memory();
  grantOptIn(store, "user-a");
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("today", 0), entry("within", 30)],
    now: NOW,
    store,
    pull: async () => [
      {
        id: "ahead",
        created: far,
        updated: far,
        noteUpdated: far,
        pointsUpdated: far,
        note: "ahead",
      },
    ],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
  });
  assert.deepEqual(sent, [["ahead", "today", "within"]]);
});

test("a backup confirm waits when another tab saved a row", () => {
  assert.equal(backupConfirmDecision(["a"], ["a", "b"]), "refresh");
  assert.equal(backupConfirmDecision(["a", "b"], ["b", "a"]), "upload");
  assert.equal(backupConfirmDecision(["a", "b"], ["a"]), "refresh");
  const root = new URL("../", import.meta.url);
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  const confirm = button.slice(
    button.indexOf('step === "confirm-backup" &&'),
    button.indexOf('step === "confirm-delete" &&'),
  );
  const readAt = confirm.indexOf("readBackupSnapshot(");
  const decisionAt = confirm.indexOf("backupConfirmDecision(");
  const enableAt = confirm.indexOf("enableBackup(");
  assert.ok(readAt > 0 && decisionAt > readAt && enableAt > decisionAt);
  assert.equal(confirm.includes('"refresh"'), true);
});

test("Apple sign-in presents on the main thread", () => {
  const root = new URL("../", import.meta.url);
  const swift = readFileSync(
    new URL("ios/App/App/AppleSignInPlugin.swift", root),
    "utf8",
  );
  const signIn = swift.slice(
    swift.indexOf("func signIn"),
    swift.indexOf("func authorizationController"),
  );
  const hop = signIn.indexOf("DispatchQueue.main.async");
  const present = signIn.indexOf("performRequests()");
  assert.ok(hop > 0 && present > hop);
});

test("a confirmation opened for one account does not run for another", () => {
  assert.equal(confirmAccountDecision("user-a", "user-a"), "proceed");
  assert.equal(confirmAccountDecision("user-a", "user-b"), "refresh");
  assert.equal(confirmAccountDecision("user-a", null), "refresh");
  const root = new URL("../", import.meta.url);
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  const backup = button.slice(
    button.indexOf('step === "confirm-backup" &&'),
    button.indexOf('step === "confirm-delete" &&'),
  );
  const accountAt = backup.indexOf("confirmAccountDecision(");
  const enableAt = backup.indexOf("enableBackup(");
  assert.ok(accountAt > 0 && enableAt > accountAt);
  assert.equal(backup.slice(accountAt, enableAt).includes('"refresh"'), true);
  const deletion = button.slice(button.indexOf('step === "confirm-delete" &&'));
  const deleteAccountAt = deletion.indexOf("deleteAccount(");
  const deleteDecision = deletion.indexOf("confirmAccountDecision(");
  assert.ok(deleteDecision > 0 && deleteAccountAt > deleteDecision);
  assert.equal(
    deletion.slice(deleteDecision, deleteAccountAt).includes('"refresh"'),
    true,
  );
  const turnOn = button.slice(
    button.indexOf('t("account.turnOn")') - 400,
    button.indexOf('t("account.turnOn")'),
  );
  assert.equal(turnOn.includes("setConfirmUid("), true);
  const deleteOpen = button.slice(
    button.indexOf('t("account.delete")') - 400,
    button.indexOf('t("account.delete")'),
  );
  assert.equal(deleteOpen.includes("setConfirmUid("), true);
});

test("a backup enable waits when a row is saved during the download", () => {
  assert.equal(
    backupEnableDecision(["kept"], ["kept", "saved-during-get"]),
    "refresh",
  );
  assert.equal(
    backupEnableDecision(["kept", "other"], ["other", "kept"]),
    "upload",
  );
  assert.equal(backupEnableDecision(["keep", "gone"], ["keep"]), "upload");
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  const enable = source.slice(
    source.indexOf("export async function enableBackup"),
    source.indexOf("export async function disableBackup"),
  );
  const lock = enable.indexOf("await withUploadLock");
  const snap = enable.indexOf("await readBackupSnapshot()", lock);
  const decision = enable.indexOf("backupEnableDecision(", snap);
  const put = enable.indexOf("await api.putEntries", decision);
  assert.ok(lock > 0 && snap > lock && decision > snap && put > decision);
  assert.equal(enable.slice(decision, put).includes('"refresh"'), true);
  assert.equal(enable.includes("return await withUploadLock"), true);
  const confirm = button.slice(
    button.indexOf('step === "confirm-backup" &&'),
    button.indexOf('step === "confirm-delete" &&'),
  );
  const call = confirm.indexOf("enableBackup(");
  const passed = confirm.indexOf("shownBackupIds", call);
  const again = confirm.indexOf('status === "refresh"', passed);
  const preview = confirm.indexOf("setBackupPreview(", again);
  const home = confirm.indexOf('setStep("home")', preview);
  assert.ok(passed > 0 && again > passed && preview > again && home > preview);
});

test("entries claimed while backup enable waited are left out", () => {
  const store = memory();
  const rows = [entry("imported", 1), entry("from-b", 1)];
  rememberSeenEntries(store, "user-a", ["imported"]);
  const upload = entriesForBackup(
    withoutOtherAccountEntries(rows, store, "user-b"),
    NOW,
  );
  assert.deepEqual(
    upload.map((row) => row.id),
    ["from-b"],
  );
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const enable = source.slice(
    source.indexOf("export async function enableBackup"),
    source.indexOf("export async function disableBackup"),
  );
  const lock = enable.indexOf("await withUploadLock");
  const snap = enable.indexOf("await readBackupSnapshot()", lock);
  const owned = enable.indexOf("withoutOtherAccountEntries(", snap);
  const put = enable.indexOf("await api.putEntries", owned);
  assert.ok(lock > 0 && snap > lock && owned > snap && put > owned);
});

test("a remote delete does not use the user tombstone", () => {
  const root = new URL("../", import.meta.url);
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  const start = notebook.indexOf("onRemove={async (ids, reason)");
  const block = notebook.slice(start, notebook.indexOf("/>", start));
  assert.equal(block.includes("dropEntry("), true);
  assert.equal(block.includes("removeEntry("), false);
  const erase = notebook.slice(
    notebook.indexOf("async function erase"),
    notebook.indexOf("async function undoDelete"),
  );
  assert.equal(erase.includes("removeEntry("), true);
});

test("a future remote revision does not overwrite a newer local edit", async () => {
  const created = new Date(NOW - 2 * DAY).toISOString();
  const map = {
    regions: ["neck"],
    summary: "typed-after",
    title: "local-title",
    quality: "",
    activity: "",
    duration: "",
    intensity: null,
    question: null,
    urgent: false,
    safety_message: null,
  };
  const local = {
    id: "a",
    created,
    note: "typed-after",
    noteUpdated: new Date(NOW).toISOString(),
    pointsUpdated: new Date(NOW).toISOString(),
    updated: new Date(NOW).toISOString(),
    provider: "Your notes",
    answers: [],
    points: [
      {
        id: "pin-local",
        region: "neck" as const,
        structure: "Sternum",
        position: [0, 1, 0] as [number, number, number],
      },
    ],
    map,
  };
  const far = new Date(NOW + 400 * DAY).toISOString();
  const remote = {
    ...local,
    note: "from-cloud",
    noteUpdated: far,
    pointsUpdated: far,
    updated: far,
    points: [
      {
        id: "pin-cloud",
        region: "neck" as const,
        structure: "Sternum",
        position: [1, 1, 0] as [number, number, number],
      },
    ],
    map: { ...map, summary: "from-cloud" },
  };
  const [merged] = mergeBackupWindow([local], [remote], new Set(), NOW);
  assert.equal(merged?.note, "typed-after");
  assert.equal(merged?.points?.[0]?.id, "pin-local");
  assert.equal(merged?.noteUpdated, local.noteUpdated);
  assert.equal(merged?.pointsUpdated, local.pointsUpdated);
  const soon = new Date(NOW + 2 * DAY).toISOString();
  const [skewed] = mergeBackupWindow(
    [
      {
        ...local,
        note: "older",
        noteUpdated: new Date(NOW - DAY).toISOString(),
        pointsUpdated: new Date(NOW - DAY).toISOString(),
      },
    ],
    [
      {
        ...remote,
        note: "skewed",
        noteUpdated: soon,
        pointsUpdated: soon,
        updated: soon,
      },
    ],
    new Set(),
    NOW,
  );
  assert.equal(skewed?.note, "skewed");
  const { keepLandedResearch } = await import("../src/notebook-storage.ts");
  const landed = keepLandedResearch(
    local,
    withLocalPrivateFields(local, remote),
  );
  assert.equal(landed.note, "typed-after");
  assert.equal(landed.points?.[0]?.id, "pin-local");
  assert.notEqual(landed.noteUpdated, far);
  assert.notEqual(landed.pointsUpdated, far);
});

test("a slow clock does not delete a note the server aged out", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["aged"], "user-a");
  const forgotten: string[][] = [];
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("aged", 95), entry("local", 1)],
    now: NOW - 10 * DAY,
    store,
    pull: async () => [entry("today", 0)],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(forgotten, []);
  assert.deepEqual(sent, [["local", "today"]]);
});

test("an empty sync snapshot does not delete local notes", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["kept"], "user-a");
  const forgotten: string[][] = [];
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("kept", 1), entry("fresh", 1)],
    now: NOW,
    store,
    pull: async () => [],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(forgotten, []);
  assert.deepEqual(sent, [["fresh", "kept"]]);
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

test("a failed sign-out keeps backup on for the next save", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  await assert.rejects(
    () =>
      signOutAccount({
        store,
        uid: "user-a",
        signOut: async () => {
          throw new Error("firebase");
        },
      }),
    (error: unknown) => error instanceof Error && error.message === "firebase",
  );
  assert.equal(optedIn(store, "user-a"), true);
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["note"]]);
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const signOut = source.slice(
    source.indexOf("export async function signOut"),
    source.indexOf("export async function enableBackup"),
  );
  assert.equal(signOut.includes("signOutAccount("), true);
  assert.equal(signOut.includes("cancelRequests("), true);
  assert.equal(signOut.includes("session: null"), true);
  const failure = signOut.slice(signOut.indexOf("} catch"));
  assert.equal(failure.includes("session: null"), false);
  const disable = source.slice(
    source.indexOf("export async function disableBackup"),
    source.indexOf("export function pushBackupEntries"),
  );
  assert.equal(disable.includes("cancelRequests("), true);
});

test("an upload already in flight stops when backup turns off", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  let rejectPut: (error: unknown) => void = () => {};
  const gate = new Promise<void>((_resolve, reject) => {
    rejectPut = reject;
  });
  const pending = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    pull: async () => ({ entries: [], deleted: [], revision: "rev-1" }),
    put: async () => {
      clearOptIn(store);
      nextBackupEpoch(store);
      await gate;
    },
  });
  rejectPut(new AccountApiError(0, "cancelled"));
  assert.deepEqual(await pending, []);
  assert.deepEqual(backedIdsFor(store, "user-a"), []);

  let signal: AbortSignal | undefined;
  const api = createAccountApi("https://api.example", (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Promise((_resolve, reject) => {
      const abort = init?.signal;
      if (!abort) {
        reject(new Error("missing signal"));
        return;
      }
      abort.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  });
  assert.ok(api);
  const upload = api.putEntries("token", [entry("note", 1)], "rev-1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  api.cancelRequests();
  await assert.rejects(
    Promise.race([
      upload,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("still in flight")), 1000);
      }),
    ]),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "cancelled",
  );
  assert.equal(signal?.aborted, true);
});

test("a note stored from a pull stays with that account after sign-out", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const epoch = backupEpoch(store);
  const cloud = entry("from-a", 1);
  const local = entry("local-only", 1);
  const pending = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [local],
    now: NOW,
    store,
    epoch,
    pull: async () => {
      nextBackupEpoch(store);
      clearOptIn(store);
      return [cloud];
    },
    put: async () => {
      throw new Error("should not upload");
    },
  });
  assert.deepEqual(await pending, []);
  assert.deepEqual(
    withoutOtherAccountEntries([cloud, local], store, "user-b").map(
      (row) => row.id,
    ),
    ["local-only"],
  );
  grantOptIn(store, "user-b");
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [cloud, local],
    now: NOW,
    store,
    pull: async () => [],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["local-only"]]);
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
        entries: [
          {
            ...storedEntry(validMap),
            points: [
              {
                id: "pin-1",
                region: "neck",
                structure: "Sternum",
                position: [0, 1, 0],
              },
            ],
          },
          { id: "broken" },
        ],
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

test("a backup larger than 10 MB is refused before the request", async () => {
  const calls: string[] = [];
  const api = createAccountApi("https://api.example", async () => {
    calls.push("fetch");
    return new Response("{}", { status: 200 });
  });
  await assert.rejects(
    api.putEntries(
      "token",
      [{ id: "big", note: "x".repeat(ACCOUNT_RESPONSE_BYTES) }],
      "rev-1",
    ),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "too-large",
  );
  assert.deepEqual(calls, []);
  const root = new URL("../", import.meta.url);
  const en = readFileSync(new URL("src/i18n/en.ts", root), "utf8");
  const es = readFileSync(new URL("src/i18n/es.ts", root), "utf8");
  assert.equal(en.includes(`"account.tooLarge"`), true);
  assert.equal(es.includes(`"account.tooLarge"`), true);
  assert.equal(en.includes("10 MB"), true);
  assert.equal(es.includes("10 MB"), true);
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  assert.equal(button.includes('code === "too-large"'), true);
});

test("a backup leaves room for 500 deleted ids", async () => {
  const calls: string[] = [];
  const api = createAccountApi("https://api.example", async () => {
    calls.push("fetch");
    return new Response("{}", { status: 200 });
  });
  const reserve = deletedListBytes(SYNC_ENTRY_LIMIT);
  const room = ACCOUNT_RESPONSE_BYTES - reserve;
  assert.ok(reserve > SYNC_ENTRY_LIMIT * 100);
  assert.ok(room > 0);
  let low = 0;
  let high = room;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const request = backupRequestBytes(
      [{ id: "big", note: "x".repeat(mid) }],
      "rev-1",
    );
    if (request <= room) low = mid;
    else high = mid - 1;
  }
  const note = "x".repeat(low);
  const tight = note + "x";
  assert.ok(
    backupRequestBytes([{ id: "big", note: tight }], "rev-1") <=
      ACCOUNT_RESPONSE_BYTES,
  );
  assert.ok(backupRequestBytes([{ id: "big", note: tight }], "rev-1") > room);
  await assert.rejects(
    api.putEntries("token", [{ id: "big", note: tight }], "rev-1"),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "too-large",
  );
  assert.deepEqual(calls, []);
});

test("a near-limit backup still fits when deleted ids are escaped", async () => {
  const encoder = new TextEncoder();
  const widest = [
    "\u0000",
    "\u0001",
    "\u0002",
    "\u0003",
    "\u0004",
    "\u0005",
    "\u0006",
    "\u0007",
    "\u000b",
    "\u000e",
    "\u000f",
    "\u0010",
    "\u0011",
    "\u0012",
    "\u0013",
    "\u0014",
    "\u0015",
    "\u0016",
    "\u0017",
    "\u0018",
    "\u0019",
    "\u001a",
    "\u001b",
    "\u001c",
    "\u001d",
    "\u001e",
    "\u001f",
  ];
  const deleted = Array.from({ length: SYNC_ENTRY_LIMIT }, (_, index) => {
    const chars = Array.from({ length: 100 }, () => "\u0000");
    chars[0] = widest[index % widest.length]!;
    chars[1] = widest[Math.floor(index / widest.length)]!;
    return chars.join("");
  });
  assert.equal(new Set(deleted).size, SYNC_ENTRY_LIMIT);
  for (const id of deleted)
    assert.equal(encoder.encode(JSON.stringify(id)).byteLength, 602);
  const listed = encoder.encode(
    `,"deleted":${JSON.stringify(deleted)}`,
  ).byteLength;
  assert.equal(deletedListBytes(SYNC_ENTRY_LIMIT), listed);

  const revision = "rev-1";
  const created = "2026-11-27T00:00:00.000Z";
  const maxNote = 30_000;
  const room = ACCOUNT_RESPONSE_BYTES - listed;
  const row = (index: number, note: string) => ({
    id: `row-${index}`,
    created,
    note,
  });
  const full = (index: number) => row(index, "x".repeat(maxNote));
  const within = (entries: { id: string; created: string; note: string }[]) =>
    backupRequestBytes(entries, revision) <= room;
  let low = 0;
  let high = SYNC_ENTRY_LIMIT;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (within(Array.from({ length: mid }, (_, index) => full(index))))
      low = mid;
    else high = mid - 1;
  }
  const base = Array.from({ length: low }, (_, index) => full(index));
  let best = base;
  if (low < SYNC_ENTRY_LIMIT && within([...base, row(low, "")])) {
    let noteLow = 0;
    let noteHigh = maxNote;
    while (noteLow < noteHigh) {
      const mid = Math.ceil((noteLow + noteHigh) / 2);
      if (within([...base, row(low, "x".repeat(mid))])) noteLow = mid;
      else noteHigh = mid - 1;
    }
    best = [...base, row(low, "x".repeat(noteLow))];
  }
  const last = best[best.length - 1]!;
  const grown =
    last.note.length < maxNote
      ? best.map((entry, index) =>
          index === best.length - 1
            ? { ...entry, note: `${entry.note}x` }
            : entry,
        )
      : [...best, row(best.length, "x")];
  assert.equal(within(best), true);
  assert.equal(within(grown), false);

  const payloads = best.map((entry) => toBackupPayload(entry));
  const body = JSON.stringify({
    revision,
    entries: payloads,
    deleted,
  });
  assert.ok(encoder.encode(body).byteLength <= ACCOUNT_RESPONSE_BYTES);
  const api = createAccountApi("https://api.example", async () => {
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.ok(api);
  const sync = await api.getEntries("token");
  assert.equal(sync.revision, revision);
  assert.equal(sync.entries.length, best.length);
  assert.deepEqual(sync.deleted, deleted);
  const upload = createAccountApi("https://api.example", async () => {
    return new Response("{}", { status: 200 });
  });
  assert.ok(upload);
  await upload.putEntries("token", best, revision);
});

test("a backup of more than 500 entries is refused before upload", async () => {
  const tooMany = Array.from({ length: SYNC_ENTRY_LIMIT + 1 }, (_, index) =>
    entry(`row-${index}`, 1),
  );
  const calls: string[] = [];
  const api = createAccountApi("https://ihurt-api.test", async (_url, init) => {
    calls.push(init?.method ?? "GET");
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.ok(api);
  await assert.rejects(
    () => api.putEntries("token", tooMany, "rev"),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "too-many",
  );
  assert.deepEqual(calls, []);
  const fitCalls: string[] = [];
  const fit = createAccountApi("https://ihurt-api.test", async (_url, init) => {
    fitCalls.push(init?.method ?? "GET");
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.ok(fit);
  await fit.putEntries(
    "token",
    Array.from({ length: SYNC_ENTRY_LIMIT }, (_, index) =>
      entry(`fit-${index}`, 1),
    ),
    "rev",
  );
  assert.deepEqual(fitCalls, ["PUT"]);
  const bareCalls: string[] = [];
  const bare = createAccountApi(
    "https://ihurt-api.test",
    async (_url, init) => {
      bareCalls.push(init?.method ?? "GET");
      return new Response("{}", { status: 200 });
    },
  );
  assert.ok(bare);
  await assert.rejects(
    () => bare.putEntries("token", [entry("keep", 1)], ""),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  assert.deepEqual(bareCalls, []);
  const store = memory();
  grantOptIn(store, "user-a");
  const sent: string[][] = [];
  await assert.rejects(
    () =>
      pushBackup({
        uid: "user-a",
        token: "token-a",
        entries: tooMany,
        now: NOW,
        store,
        pull: async () => [],
        put: async (_token, rows) => {
          sent.push(rows.map((row) => row.id));
        },
      }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "too-many",
  );
  assert.deepEqual(sent, []);
  const root = new URL("../", import.meta.url);
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  const en = readFileSync(new URL("src/i18n/en.ts", root), "utf8");
  const es = readFileSync(new URL("src/i18n/es.ts", root), "utf8");
  assert.equal(button.includes('code === "too-many"'), true);
  assert.equal(en.includes(`"account.tooMany"`), true);
  assert.equal(es.includes(`"account.tooMany"`), true);
  assert.equal(en.includes(String(SYNC_ENTRY_LIMIT)), true);
  assert.equal(es.includes(String(SYNC_ENTRY_LIMIT)), true);
});

test("an oversized sync response is rejected before upload", async () => {
  const calls: string[] = [];
  const api = createAccountApi("https://ihurt-api.test", async (_url, init) => {
    calls.push(init?.method ?? "GET");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ACCOUNT_RESPONSE_BYTES + 1));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  });
  assert.ok(api);
  await assert.rejects(
    () => api.getEntries("token"),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  assert.deepEqual(calls, ["GET"]);
  assert.throws(
    () =>
      remoteEntries({
        entries: Array.from({ length: SYNC_ENTRY_LIMIT + 1 }, (_, index) => ({
          ...storedEntry(validMap),
          id: `row-${index}`,
        })),
      }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
});

test("an account request that never finishes is abandoned", async () => {
  const bounded = <T>(work: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("still pending")), 500);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const hangingFetch = createAccountApi(
    "https://ihurt-api.test",
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => {
          reject(signal.reason ?? new Error("aborted"));
        });
      }),
    40,
  );
  assert.ok(hangingFetch);
  await assert.rejects(
    () => bounded(hangingFetch.getAccount("token")),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "network",
  );
  const hangingBody = createAccountApi(
    "https://ihurt-api.test",
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        }),
        { status: 200 },
      ),
    40,
  );
  assert.ok(hangingBody);
  await assert.rejects(
    () => bounded(hangingBody.getEntries("token")),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "network",
  );
});

test("a backup row with 2001 pins comes back", () => {
  const many = storedEntry(validMap);
  many.points = Array.from({ length: 2001 }, (_, index) => ({
    id: `pin-${index}`,
    region: "neck",
    structure: "Sternum",
    position: [0, 1, 0],
  }));
  const uploaded = toBackupPayload(many);
  assert.equal(uploaded.points.length, 2001);
  const rows = remoteEntries({ entries: [uploaded] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.points?.length, 2001);
});

test("a backup row with more pins than 500 still syncs", () => {
  const many = storedEntry(validMap);
  many.points = Array.from({ length: 501 }, (_, index) => ({
    id: `pin-${index}`,
    region: "neck",
    structure: "Sternum",
    position: [0, 1, 0],
  }));
  const other = {
    ...storedEntry({ ...validMap, regions: [] }),
    id: "other",
  };
  const rows = remoteEntries({ entries: [many, other] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.points?.length, 501);
  assert.equal(rows[1]?.id, "other");
});

test("duplicate sync ids are rejected before upload", () => {
  const row = storedEntry(validMap);
  row.points = [
    {
      id: "pin-1",
      region: "neck",
      structure: "Sternum",
      position: [0, 1, 0],
    },
  ];
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
  await api?.putEntries("token", [entry], "rev-1");
  assert.equal(JSON.parse(body).revision, "rev-1");
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

test("a backup payload replaces a private provider", async () => {
  const entry = storedEntry(validMap);
  entry.provider = "provider-marker";
  const payload = toBackupPayload(entry);
  assert.equal(payload.provider, "Your notes");
  assert.equal(JSON.stringify(payload).includes("provider-marker"), false);
  let body = "";
  const api = createAccountApi("https://api.ihurt.app", async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response("{}", { status: 200 });
  });
  await api?.putEntries("token", [entry], "rev-1");
  assert.equal(JSON.parse(body).revision, "rev-1");
  assert.equal(body.includes("provider-marker"), false);
  const incoming = storedEntry(validMap);
  incoming.provider = "server-provider-marker";
  const kept = withLocalPrivateFields(entry, incoming);
  assert.equal(kept.provider, "provider-marker");
  const bare = withLocalPrivateFields(undefined, incoming);
  assert.equal(bare.provider, "Your notes");
  assert.equal(JSON.stringify(bare).includes("server-provider-marker"), false);
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

test("a downloaded backup does not keep server map details", () => {
  const local = storedEntry({
    ...validMap,
    regions: [],
    title: "local-title",
    quality: "local-quality",
    activity: "local-activity",
    duration: "local-duration",
    intensity: 4,
    urgent: false,
    safety_message: "local-safety",
  });
  const incoming = storedEntry({
    ...validMap,
    regions: [],
    title: "server-title",
    quality: "server-quality",
    activity: "server-activity",
    duration: "server-duration",
    intensity: 9,
    urgent: true,
    safety_message: "server-safety",
  });
  incoming.mapUpdated = { quality: "2099-01-01T00:00:00.000Z" };
  const bare = withLocalPrivateFields(undefined, incoming);
  assert.equal(bare.map.title, "");
  assert.equal(bare.map.quality, "");
  assert.equal(bare.map.activity, "");
  assert.equal(bare.map.duration, "");
  assert.equal(bare.map.intensity, null);
  assert.equal(bare.map.urgent, false);
  assert.equal(bare.map.safety_message, null);
  assert.equal(bare.map.summary, incoming.note);
  assert.equal(JSON.stringify(bare).includes("server-"), false);
  const kept = withLocalPrivateFields(local, incoming);
  assert.equal(kept.map.title, "local-title");
  assert.equal(kept.map.quality, "local-quality");
  assert.equal(kept.map.activity, "local-activity");
  assert.equal(kept.map.duration, "local-duration");
  assert.equal(kept.map.intensity, 4);
  assert.equal(kept.map.urgent, false);
  assert.equal(kept.map.safety_message, "local-safety");
  assert.equal(JSON.stringify(kept).includes("server-"), false);
  const rows = remoteEntries({ entries: [incoming] });
  assert.equal(rows[0]?.map.title, "");
  assert.equal(rows[0]?.map.quality, "");
  assert.equal(rows[0]?.map.activity, "");
  assert.equal(rows[0]?.map.safety_message, null);
  assert.equal(rows[0]?.note, incoming.note);
  assert.equal(JSON.stringify(rows[0]).includes("server-"), false);
});

test("a downloaded region with no pins is not stored", () => {
  const marker = storedEntry({ ...validMap, regions: ["neck"] });
  assert.throws(
    () => remoteEntries({ entries: [marker] }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  const emptyPins = storedEntry({ ...validMap, regions: ["neck"] });
  emptyPins.points = [];
  assert.throws(
    () => remoteEntries({ entries: [emptyPins] }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  const extra = storedEntry({
    ...validMap,
    regions: ["neck", "left_shoulder"],
  });
  extra.points = [
    {
      id: "pin-1",
      region: "neck",
      structure: "Sternum",
      position: [0, 1, 0],
    },
  ];
  assert.throws(
    () => remoteEntries({ entries: [extra] }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  const matched = storedEntry({
    ...validMap,
    regions: ["left_shoulder", "neck"],
  });
  matched.points = [
    {
      id: "pin-1",
      region: "neck",
      structure: "Sternum",
      position: [0, 1, 0],
    },
    {
      id: "pin-2",
      region: "left_shoulder",
      structure: "Deltoid",
      position: [1, 1, 0],
    },
  ];
  const rows = remoteEntries({ entries: [matched] });
  assert.deepEqual(rows[0]?.map.regions, ["neck", "left_shoulder"]);
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

test("a delete stops when the signed-in account changes", async () => {
  const store = memory();
  rememberSynced(store, ["backed"], "user-a");
  let uid = "user-a";
  const calls: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = deleteSignedInAccount({
    uid: "user-a",
    token: async () => {
      calls.push("token");
      return "token-a";
    },
    confirmRecentLogin: async () => {
      calls.push("reauth");
      await gate;
    },
    settleUploads: async () => {
      calls.push("settle");
    },
    api: {
      async deleteAccount() {
        calls.push("api");
      },
    },
    removeLocal: async () => {
      calls.push("local");
    },
    deleteAuth: async () => {
      calls.push("auth");
    },
    sameAccount: () => uid === "user-a",
    store,
  });
  uid = "user-b";
  release();
  await assert.rejects(
    pending,
    (error: unknown) =>
      (error as { code?: string } | null)?.code === "cancelled",
  );
  assert.deepEqual(calls, ["reauth"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["backed"]);
});

test("delete sends the token from after the recent sign-in", async () => {
  const store = memory();
  const order: string[] = [];
  await deleteSignedInAccount({
    uid: "user-a",
    token: async () => {
      order.push("token");
      return "fresh-token";
    },
    api: {
      async deleteAccount(token) {
        order.push(token);
      },
    },
    removeLocal: async () => {},
    deleteAuth: async () => {},
    confirmRecentLogin: async () => {
      order.push("reauth");
    },
    settleUploads: async () => {
      order.push("settle");
    },
    store,
  });
  assert.deepEqual(order, ["reauth", "settle", "token", "fresh-token"]);
});

test("account delete waits for an in-flight upload", async () => {
  const store = memory();
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const wiped = [];
  const upload = (async () => {
    order.push("put-start");
    await gate;
    rememberSynced(store, ["just-backed"], "user-a");
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
    removeLocal: async (ids) => {
      wiped.push(ids);
    },
    deleteAuth: async () => {},
    settleUploads: () => upload,
    store,
  });
  await Promise.resolve();
  assert.deepEqual(order, ["put-start"]);
  release();
  await pending;
  assert.deepEqual(order, ["put-start", "put-done", "delete"]);
  assert.deepEqual(wiped, [["just-backed"]]);
});

test("a delete waits for an upload another tab already started", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const epoch = backupEpoch(store);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let putStarted = false;
  let putReturned = false;
  const upload = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("from-this-device", 1)],
    now: NOW,
    store,
    epoch,
    pull: async () => [],
    put: async () => {
      putStarted = true;
      await gate;
      putReturned = true;
    },
  });
  for (let attempt = 0; attempt < 20 && !putStarted; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(putStarted, true);
  nextBackupEpoch(store);
  clearOptIn(store);
  const wiped: string[] = [];
  let deleted = false;
  const pending = deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    confirmRecentLogin: async () => {},
    settleUploads: async () => {},
    api: {
      async deleteAccount() {
        deleted = true;
      },
    },
    removeLocal: async (ids) => {
      wiped.push(...ids);
    },
    deleteAuth: async () => {},
    store,
  });
  for (let attempt = 0; attempt < 5; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deleted, false);
  assert.equal(putReturned, false);
  release();
  await upload;
  await pending;
  assert.equal(putReturned, true);
  assert.equal(deleted, true);
  assert.deepEqual(wiped, ["from-this-device"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), []);
});

test("a delete blocks an upload that starts after the wait", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  nextBackupEpoch(store);
  const epoch = backupEpoch(store);
  const sent: string[] = [];
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    confirmRecentLogin: async () => {},
    settleUploads: async () => {},
    api: {
      async deleteAccount() {
        await pushBackup({
          uid: "user-a",
          token: "token-a",
          entries: [entry("late", 1)],
          now: NOW,
          store,
          epoch,
          pull: async () => [],
          put: async () => {
            sent.push("put");
          },
        });
      },
    },
    removeLocal: async () => {},
    deleteAuth: async () => {},
    store,
  });
  assert.deepEqual(sent, []);
  assert.equal(optedIn(store, "user-a"), false);
});

test("the iOS Firebase key is not restricted to the shell origin", () => {
  const root = new URL("../", import.meta.url);
  const docs = readFileSync(new URL("docs/IOS.md", root), "utf8");
  const example = readFileSync(new URL(".env.example", root), "utf8");
  const text = `${docs}\n${example}`;
  assert.equal(text.includes("referrer restriction includes"), false);
  assert.equal(text.includes("list must include capacitor://localhost"), false);
  assert.equal(docs.includes("no HTTP referrer restriction"), true);
  assert.equal(docs.includes("no iOS bundle restriction"), true);
  assert.equal(docs.includes("Identity Toolkit API"), true);
  assert.equal(docs.includes("Token Service API"), true);
});

test("the privacy manifest lists backup notes and the account id", () => {
  const root = new URL("../", import.meta.url);
  const plist = readFileSync(
    new URL("ios/App/App/PrivacyInfo.xcprivacy", root),
    "utf8",
  );
  for (const type of [
    "NSPrivacyCollectedDataTypeHealth",
    "NSPrivacyCollectedDataTypeUserID",
    "NSPrivacyCollectedDataTypeEmailAddress",
  ]) {
    const at = plist.indexOf(type);
    assert.ok(at > 0);
    const block = plist.slice(at, plist.indexOf("</dict>", at));
    assert.equal(
      block.includes(
        "<key>NSPrivacyCollectedDataTypeLinked</key>\n      <true/>",
      ),
      true,
    );
    assert.equal(
      block.includes(
        "<key>NSPrivacyCollectedDataTypeTracking</key>\n      <false/>",
      ),
      true,
    );
    assert.equal(
      block.includes("NSPrivacyCollectedDataTypePurposeAppFunctionality"),
      true,
    );
  }
});

test("a second tab keeps the entry the first tab uploaded", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const epoch = backupEpoch(store);
  let server = [];
  const puts = [];
  let releaseFirst = () => {};
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstPutStarted = false;
  const first = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("from-b", 1)],
    now: NOW,
    store,
    epoch,
    pull: async () => server.map((row) => ({ ...row })),
    put: async (_token, rows) => {
      firstPutStarted = true;
      await gate;
      server = rows.map((row) => ({ ...row }));
      puts.push(rows.map((row) => row.id).sort());
    },
  });
  for (let attempt = 0; attempt < 20 && !firstPutStarted; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(firstPutStarted, true);
  const forgotten = [];
  const second = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("from-a", 1)],
    now: NOW,
    store,
    epoch,
    pull: async () => server.map((row) => ({ ...row })),
    put: async (_token, rows) => {
      server = rows.map((row) => ({ ...row }));
      puts.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(...ids);
    },
  });
  for (let attempt = 0; attempt < 5; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
  releaseFirst();
  await first;
  await second;
  assert.deepEqual(puts.at(-1), ["from-a", "from-b"]);
  const again = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("from-a", 1), entry("from-b", 1)],
    now: NOW,
    store,
    epoch,
    pull: async () => server.map((row) => ({ ...row })),
    put: async (_token, rows) => {
      again.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(...ids);
    },
  });
  assert.deepEqual(forgotten, []);
  assert.deepEqual(again, [["from-a", "from-b"]]);
});

test("account deletion waits for an upload when web locks are missing", async () => {
  const nav = globalThis.navigator as Navigator & { locks?: unknown };
  const previousLocks = Object.getOwnPropertyDescriptor(nav, "locks");
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(nav, "locks", {
    configurable: true,
    get: () => undefined,
  });
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  let releasePut: (() => void) | null = null;
  let firstPutStarted = false;
  let deleted = false;
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note-a"], "user-a");
  try {
    const uploading = pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("note-a", 1)],
      now: NOW,
      store,
      pull: async () => ({
        entries: [entry("note-a", 1)],
        deleted: [],
        revision: "1",
      }),
      put: () =>
        new Promise<void>((resolve) => {
          firstPutStarted = true;
          releasePut = resolve;
        }),
    });
    for (let attempt = 0; attempt < 40 && !firstPutStarted; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(firstPutStarted, true);
    assert.equal(data.has("ihurt-tab-locks:ihurt-backup-uploads"), true);
    const removing = deleteSignedInAccount({
      uid: "user-a",
      token: async () => "token-a",
      api: {
        deleteAccount: async () => {
          deleted = true;
        },
        getEntries: async () => ({ entries: [], deleted: [], revision: "1" }),
        putEntries: async () => undefined,
        getSearchAllowance: async () => ({ remaining: 5, limit: 5 }),
      },
      removeLocal: async () => undefined,
      confirmRecentLogin: async () => undefined,
      deleteAuth: async () => undefined,
      settleUploads: async () => undefined,
      sameAccount: () => true,
      store,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(deleted, false);
    releasePut?.();
    await uploading;
    await removing;
    assert.equal(deleted, true);
  } finally {
    if (previousLocks) Object.defineProperty(nav, "locks", previousLocks);
    else delete (nav as { locks?: unknown }).locks;
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a second tab waits out a fallback lock held longer than 15 seconds", async () => {
  const nav = globalThis.navigator as Navigator & { locks?: unknown };
  const previousLocks = Object.getOwnPropertyDescriptor(nav, "locks");
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const realNow = Date.now;
  let now = NOW;
  Date.now = () => now;
  Object.defineProperty(nav, "locks", {
    configurable: true,
    get: () => undefined,
  });
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  let releasePut: (() => void) | null = null;
  let firstPutStarted = false;
  const sent: string[][] = [];
  const store = memory();
  grantOptIn(store, "user-a");
  try {
    const first = pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("held", 1)],
      now: NOW,
      store,
      pull: async () => ({ entries: [], deleted: [], revision: "rev-1" }),
      put: async (_token, rows) => {
        firstPutStarted = true;
        sent.push(rows.map((row) => row.id));
        await new Promise<void>((resolve) => {
          releasePut = resolve;
        });
      },
    });
    for (let attempt = 0; attempt < 40 && !firstPutStarted; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(firstPutStarted, true);
    const second = pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("held", 1), entry("saved-later", 1)],
      now: NOW,
      store,
      pull: async () => ({ entries: [], deleted: [], revision: "rev-1" }),
      put: async (_token, rows) => {
        sent.push(rows.map((row) => row.id));
      },
    });
    now += 20_000;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(sent, [["held"]]);
    releasePut?.();
    await first;
    await second;
    assert.deepEqual(sent[1], ["held", "saved-later"]);
  } finally {
    Date.now = realNow;
    if (previousLocks) Object.defineProperty(nav, "locks", previousLocks);
    else delete (nav as { locks?: unknown }).locks;
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a slow upload keeps the fallback lock past the lease", async () => {
  const nav = globalThis.navigator as Navigator & { locks?: unknown };
  const previousLocks = Object.getOwnPropertyDescriptor(nav, "locks");
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const realNow = Date.now;
  let now = NOW;
  Date.now = () => now;
  Object.defineProperty(nav, "locks", {
    configurable: true,
    get: () => undefined,
  });
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  let releasePut: (() => void) | null = null;
  let firstPutStarted = false;
  let deleted = false;
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note-a"], "user-a");
  try {
    const uploading = pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("note-a", 1)],
      now: NOW,
      store,
      pull: async () => ({
        entries: [entry("note-a", 1)],
        deleted: [],
        revision: "1",
      }),
      put: () =>
        new Promise<void>((resolve) => {
          firstPutStarted = true;
          releasePut = resolve;
        }),
    });
    for (let attempt = 0; attempt < 40 && !firstPutStarted; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(firstPutStarted, true);
    now += 10 * 60 * 1000;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const row = JSON.parse(
      data.get("ihurt-tab-locks:ihurt-backup-uploads") ?? "{}",
    ) as { expires?: number };
    assert.ok((row.expires ?? 0) > now);
    const removing = deleteSignedInAccount({
      uid: "user-a",
      token: "token-a",
      api: {
        async deleteAccount() {
          deleted = true;
        },
      },
      removeLocal: async () => undefined,
      confirmRecentLogin: async () => undefined,
      deleteAuth: async () => undefined,
      settleUploads: async () => undefined,
      sameAccount: () => true,
      store,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(deleted, false);
    releasePut?.();
    await uploading;
    await removing;
    assert.equal(deleted, true);
  } finally {
    Date.now = realNow;
    if (previousLocks) Object.defineProperty(nav, "locks", previousLocks);
    else delete (nav as { locks?: unknown }).locks;
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a fallback delete lock does not erase a live upload lock", async () => {
  const nav = globalThis.navigator as Navigator & { locks?: unknown };
  const previousLocks = Object.getOwnPropertyDescriptor(nav, "locks");
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(nav, "locks", {
    configurable: true,
    get: () => undefined,
  });
  const data = new Map<string, string>();
  const upload = {
    id: "upload-tab",
    expires: Date.now() + 120_000,
  };
  let planted = false;
  let uploadSurvived = false;
  const storage = {
    getItem(key: string) {
      if (!planted && key.includes("ihurt-account-deleting-lock")) {
        planted = true;
        data.set(
          key.replace("ihurt-account-deleting-lock", "ihurt-backup-uploads"),
          JSON.stringify(upload),
        );
        return null;
      }
      if (!planted && key === "ihurt-tab-locks") {
        planted = true;
        data.set(key, JSON.stringify({ "ihurt-backup-uploads": upload }));
        return "{}";
      }
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
      if (!planted || uploadSurvived) return;
      uploadSurvived = [...data.entries()].some(([name, value]) => {
        if (!name.includes("ihurt-backup-uploads")) return false;
        try {
          const row = JSON.parse(value) as {
            id?: string;
            "ihurt-backup-uploads"?: { id?: string };
          };
          return (
            row.id === "upload-tab" ||
            row["ihurt-backup-uploads"]?.id === "upload-tab"
          );
        } catch {
          return false;
        }
      });
      if (uploadSurvived) {
        for (const name of [...data.keys()]) {
          if (name.includes("ihurt-backup-uploads")) data.delete(name);
        }
      }
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const store = memory();
  grantOptIn(store, "user-a");
  let deleted = false;
  try {
    await deleteSignedInAccount({
      uid: "user-a",
      token: "token-a",
      api: {
        async deleteAccount() {
          deleted = true;
        },
      },
      removeLocal: async () => undefined,
      confirmRecentLogin: async () => undefined,
      deleteAuth: async () => undefined,
      settleUploads: async () => undefined,
      sameAccount: () => true,
      store,
    });
    assert.equal(planted, true);
    assert.equal(uploadSurvived, true);
    assert.equal(deleted, true);
  } finally {
    if (previousLocks) Object.defineProperty(nav, "locks", previousLocks);
    else delete (nav as { locks?: unknown }).locks;
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a sign-in during auth deletion keeps the new account", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["from-a"], "user-a");
  let account: string | null = "user-a";
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: { async deleteAccount() {} },
    removeLocal: async () => undefined,
    confirmRecentLogin: async () => undefined,
    settleUploads: async () => undefined,
    sameAccount: () => true,
    sessionUid: () => account,
    deleteAuth: async () => {
      account = "user-b";
      grantOptIn(store, "user-b");
    },
    store,
  });
  assert.equal(optedIn(store, "user-b"), true);
  assert.deepEqual(syncedIdsFor(store, "user-a"), []);
  account = "user-a";
  grantOptIn(store, "user-a");
  await deleteSignedInAccount({
    uid: "user-a",
    token: "token-a",
    api: { async deleteAccount() {} },
    removeLocal: async () => undefined,
    confirmRecentLogin: async () => undefined,
    settleUploads: async () => undefined,
    sameAccount: () => true,
    sessionUid: () => account,
    deleteAuth: async () => {
      account = null;
    },
    store,
  });
  assert.equal(optedIn(store, "user-a"), false);
  const root = new URL("../", import.meta.url);
  const accountStore = readFileSync(
    new URL("src/account/store.ts", root),
    "utf8",
  );
  const deletion = accountStore.slice(
    accountStore.indexOf("export async function deleteAccount"),
    accountStore.indexOf("export function openUpgrade"),
  );
  const tail = deletion.slice(
    deletion.indexOf("sameAccount: () => state.session?.uid === session.uid"),
  );
  const recheck = tail.indexOf("state.session?.uid !== session.uid");
  const published = tail.indexOf("session: null");
  assert.ok(recheck > 0 && published > recheck);
});

test("a backup still blocks deletion after the upload lease", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const epoch = backupEpoch(store);
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let putStarted = false;
    const upload = pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("from-this-device", 1)],
      now: NOW,
      store,
      epoch,
      pull: async () => [],
      put: async () => {
        putStarted = true;
        now += 10 * 60 * 1000;
        await gate;
      },
    });
    for (let attempt = 0; attempt < 20 && !putStarted; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(putStarted, true);
    const wiped: string[] = [];
    let deleted = false;
    const pending = deleteSignedInAccount({
      uid: "user-a",
      token: "token-a",
      confirmRecentLogin: async () => {},
      settleUploads: async () => {},
      api: {
        async deleteAccount() {
          deleted = true;
        },
      },
      removeLocal: async (ids) => {
        wiped.push(...ids);
      },
      deleteAuth: async () => {},
      store,
    });
    for (let attempt = 0; attempt < 5; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deleted, false);
    release();
    await upload;
    await pending;
    assert.equal(deleted, true);
    assert.deepEqual(wiped, ["from-this-device"]);
  } finally {
    Date.now = realNow;
  }
});

test("two tabs that claim together both keep their uploads", async () => {
  const nav = globalThis.navigator;
  const previous = Object.getOwnPropertyDescriptor(nav, "locks");
  // Node 24 exposes navigator.locks as a getter with no setter. Assignment throws.
  Object.defineProperty(nav, "locks", {
    configurable: true,
    get() {
      return undefined;
    },
  });
  let held = 0;
  let chain: Promise<void> = Promise.resolve();
  Object.defineProperty(nav, "locks", {
    configurable: true,
    writable: true,
    value: {
      request(_name: string, callback: () => unknown) {
        const run = chain.then(async () => {
          held += 1;
          try {
            return await callback();
          } finally {
            held -= 1;
          }
        });
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    },
  });
  try {
    const data = new Map<string, string>();
    const store: KeyValueStore = {
      getItem(key) {
        if (key === "ihurt-backup-uploads" && held === 0) return "{}";
        return data.get(key) ?? null;
      },
      setItem(key, value) {
        data.set(key, value);
      },
      removeItem(key) {
        data.delete(key);
      },
    };
    await Promise.all([
      claimUpload(store, "user-a"),
      claimUpload(store, "user-a"),
    ]);
    const book = JSON.parse(data.get("ihurt-backup-uploads") ?? "{}") as {
      "user-a"?: Record<string, number>;
    };
    assert.equal(Object.keys(book["user-a"] ?? {}).length, 2);
  } finally {
    if (previous) Object.defineProperty(nav, "locks", previous);
    else delete (nav as { locks?: unknown }).locks;
  }
});

test("a later device's snapshot does not delete a note this device already uploaded", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["from-a", "shared"], "user-a");
  const sent: string[][] = [];
  const forgotten: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("from-a", 1), entry("shared", 1)],
    now: NOW,
    store,
    pull: async () => [entry("shared", 1), entry("from-b", 1)],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(forgotten, []);
  assert.deepEqual(sent, [["from-a", "from-b", "shared"]]);
  assert.deepEqual(removedIdsFor(store, "user-a"), []);
});

test("a delete on another device is not uploaded again", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["gone", "keep"], "user-a");
  const sent: string[][] = [];
  const forgotten: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("gone", 1), entry("keep", 1), entry("fresh", 1)],
    now: NOW,
    store,
    pull: async () => ({
      entries: [entry("keep", 1)],
      deleted: ["gone"],
    }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(sent, [["fresh", "keep"]]);
  assert.deepEqual(forgotten, [["gone"]]);
  assert.deepEqual(removedIdsFor(store, "user-a"), ["gone"]);
  const again: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("gone", 1), entry("keep", 1)],
    now: NOW,
    store,
    deletedIds: ["gone"],
    pull: async () => [entry("keep", 1)],
    put: async (_token, rows) => {
      again.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(again, [["keep"]]);
  assert.deepEqual(
    mergeBackupWindow(
      [entry("gone", 1), entry("keep", 1)],
      [entry("keep", 1)],
      new Set(),
      NOW,
    )
      .map((row) => row.id)
      .sort(),
    ["gone", "keep"],
  );
  assert.deepEqual(
    idsDeletedOnServer(
      ["gone", "keep", "old"],
      [entry("gone", 1), entry("keep", 1), entry("old", 91)],
      ["gone", "old"],
      new Set(),
      NOW,
    ),
    ["gone"],
  );
  assert.deepEqual(
    idsDeletedOnServer(
      ["gone"],
      [entry("gone", 1), entry("imported", 1)],
      ["gone", "imported"],
      new Set(),
      NOW,
    ),
    ["gone"],
  );
  assert.deepEqual(
    idsDeletedOnServer(
      ["downloaded-note"],
      [entry("downloaded-note", 1)],
      ["downloaded-note"],
      new Set(),
      NOW,
    ),
    ["downloaded-note"],
  );
  assert.deepEqual(remoteSync({ entries: [], revision: "1" }), {
    entries: [],
    deleted: [],
    revision: "1",
  });
  assert.throws(
    () => remoteSync({ entries: [] }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
  assert.throws(
    () => remoteSync({ entries: [], deleted: ["gone", "gone"], revision: "1" }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
});

test("a shared map stays with the account that already claimed it", async () => {
  const store = memory();
  grantOptIn(store, "user-b");
  rememberSeenEntries(store, "user-a", ["shared"]);
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [entry("from-b", 1)],
    now: NOW,
    store,
    pull: async () => ({
      entries: [entry("shared", 2), entry("from-b", 1)],
      deleted: [],
      revision: "live",
    }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent[0]?.slice().sort(), ["from-b", "shared"]);
  assert.deepEqual(downloadedIdsFor(store, "user-b"), ["from-b"]);
  const enable = readFileSync(
    new URL("../src/account/store.ts", import.meta.url),
    "utf8",
  );
  const start = enable.indexOf("export async function enableBackup");
  const putAt = enable.indexOf(
    "await api.putEntries(token, windowed, sync.revision)",
    start,
  );
  const mergeAt = enable.indexOf("await onMerge(mine)", putAt);
  assert.equal(putAt > start && mergeAt > putAt, true);
  assert.equal(
    enable.slice(start, putAt).includes("await onMerge(remote)"),
    false,
  );
  assert.equal(
    enable.slice(start, putAt).includes("partitionAccountEntries("),
    true,
  );
});

test("another account's delete does not drop a shared cloud row", async () => {
  const store = memory();
  grantOptIn(store, "user-b");
  rememberSeenEntries(store, "user-a", ["shared"]);
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [entry("from-b", 1)],
    now: NOW,
    store,
    deletedIds: ["shared"],
    pull: async () => ({
      entries: [entry("shared", 2), entry("from-b", 1)],
      deleted: [],
      revision: "live",
    }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent[0]?.slice().sort(), ["from-b", "shared"]);
});

test("a stale snapshot does not replace a newer upload", async () => {
  let revision = "1";
  let cloud = [entry("keep", 1)];
  const start = {
    entries: [entry("keep", 1)],
    deleted: [] as string[],
    revision: "1",
  };
  const accepted: string[][] = [];
  const rejected: string[] = [];
  const commit = (sent: string | undefined, rows: { id: string }[]) => {
    if (sent !== undefined && sent !== revision) {
      rejected.push(sent);
      throw new AccountApiError(409, "conflict");
    }
    const nextIds = new Set(rows.map((row) => row.id));
    const removed = cloud
      .filter((row) => !nextIds.has(row.id))
      .map((row) => row.id);
    cloud = rows.map((row) => entry(row.id, 1));
    if (sent !== undefined) {
      revision = String(Number(revision) + 1);
      start.deleted = removed;
    }
    accepted.push(cloud.map((row) => row.id).sort());
  };
  const device = () => {
    const store = memory();
    grantOptIn(store, "user-a");
    return store;
  };
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("keep", 1), entry("from-a", 1)],
    now: NOW,
    store: device(),
    pull: async () => start,
    put: async (_token, rows, sent) => commit(sent, rows),
  });
  let pulls = 0;
  await pushBackup({
    uid: "user-a",
    token: "token-b",
    entries: [entry("keep", 1), entry("from-b", 1)],
    now: NOW,
    store: device(),
    pull: async () => {
      pulls += 1;
      if (pulls === 1) return start;
      return {
        entries: cloud.map((row) => entry(row.id, 1)),
        deleted: [...start.deleted],
        revision,
      };
    },
    put: async (_token, rows, sent) => commit(sent, rows),
  });
  assert.deepEqual(cloud.map((row) => row.id).sort(), [
    "from-a",
    "from-b",
    "keep",
  ]);
  assert.deepEqual(rejected, ["1"]);
  assert.deepEqual(accepted, [
    ["from-a", "keep"],
    ["from-a", "from-b", "keep"],
  ]);

  revision = "1";
  cloud = [entry("keep", 1), entry("extra", 1)];
  start.deleted = [];
  const opened = {
    entries: [entry("keep", 1), entry("extra", 1)],
    deleted: [] as string[],
    revision: "1",
  };
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("keep", 1)],
    now: NOW,
    store: device(),
    deletedIds: ["extra"],
    pull: async () => opened,
    put: async (_token, rows, sent) => commit(sent, rows),
  });
  pulls = 0;
  await pushBackup({
    uid: "user-a",
    token: "token-b",
    entries: [entry("keep", 1), entry("extra", 1)],
    now: NOW,
    store: device(),
    pull: async () => {
      pulls += 1;
      if (pulls === 1) return opened;
      return {
        entries: cloud.map((row) => entry(row.id, 1)),
        deleted: [...start.deleted],
        revision,
      };
    },
    put: async (_token, rows, sent) => commit(sent, rows),
  });
  assert.deepEqual(
    cloud.map((row) => row.id),
    ["keep"],
  );
});

test("an undo on another device clears the remote delete", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["gone", "keep"], "user-a");
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("gone", 1), entry("keep", 1)],
    now: NOW,
    store,
    pull: async () => [entry("keep", 1)],
    put: async () => {},
    forget: async () => {},
  });
  const sent: string[][] = [];
  const forgotten: string[][] = [];
  let tombstones = ["gone"];
  let local = [entry("keep", 1)];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: () => local,
    now: NOW,
    store,
    deletedIds: () => tombstones,
    pull: async () => {
      tombstones = [];
      local = [entry("keep", 1), entry("gone", 1)];
      return [entry("keep", 1), entry("gone", 1)];
    },
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(sent, [["gone", "keep"]]);
  assert.deepEqual(forgotten, []);
  assert.deepEqual(removedIdsFor(store, "user-a"), []);
  const undone: string[][] = [];
  rememberRemoteDeletes(store, ["gone"], "user-a");
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("gone", 1), entry("keep", 1)],
    now: NOW,
    store,
    deletedIds: [],
    pull: async () => [entry("keep", 1)],
    put: async (_token, rows) => {
      undone.push(rows.map((row) => row.id).sort());
    },
  });
  assert.deepEqual(undone, [["gone", "keep"]]);
  assert.deepEqual(removedIdsFor(store, "user-a"), []);
});

test("an imported note that matches a cloud tombstone stays", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberDownloaded(store, ["cloud"], "user-a");
  const sent: string[][] = [];
  const forgotten: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("imported", 1), entry("cloud", 1)],
    now: NOW,
    store,
    pull: async () => ({
      entries: [],
      deleted: ["imported", "cloud"],
      revision: "1",
    }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push([...ids].sort());
    },
  });
  assert.deepEqual(forgotten, [["cloud"]]);
  assert.deepEqual(sent, [["imported"]]);
});

test("a remote delete does not keep the backup claim for a re-import", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note"], "user-a");
  rememberDownloaded(store, ["note"], "user-a");
  rememberSeenEntries(store, "user-a", ["note"]);
  const forgotten: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    pull: async () => ({
      entries: [],
      deleted: ["note"],
      revision: "2",
    }),
    put: async () => {},
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(forgotten, [["note"]]);
  assert.deepEqual(removedIdsFor(store, "user-a"), ["note"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), []);
  assert.deepEqual(downloadedIdsFor(store, "user-a"), []);
  clearOptIn(store);
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
  assert.deepEqual(wiped, []);
});

test("a leftover local copy does not restore a named remote delete", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["gone", "keep"], "user-a");
  rememberRemoteDeletes(store, ["gone"], "user-a");
  const sent: string[][] = [];
  const forgotten: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("gone", 1), entry("keep", 1)],
    now: NOW,
    store,
    deletedIds: [],
    pull: async () => ({
      entries: [entry("keep", 1)],
      deleted: ["gone"],
      revision: "2",
    }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id).sort());
    },
    forget: async (ids) => {
      forgotten.push([...ids].sort());
    },
  });
  assert.deepEqual(sent, [["keep"]]);
  assert.deepEqual(forgotten, [["gone"]]);
  assert.deepEqual(removedIdsFor(store, "user-a"), ["gone"]);
});

test("a newer saved note survives a remote delete", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const older = new Date(NOW - DAY).toISOString();
  const newer = new Date(NOW).toISOString();
  const first = { ...entry("note", 1), note: "first", noteUpdated: older };
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [first],
    now: NOW,
    store,
    pull: async () => ({ entries: [first], deleted: [], revision: "1" }),
    put: async () => undefined,
  });
  const saved = { ...first, note: "typed offline", noteUpdated: newer };
  const sent: { id: string; note?: string }[][] = [];
  const forgotten: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [saved],
    now: NOW,
    store,
    pull: async () => ({
      entries: [],
      deleted: ["note"],
      revision: "2",
    }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => ({ id: row.id, note: row.note })));
    },
    forget: async (ids) => {
      forgotten.push(ids);
    },
  });
  assert.deepEqual(forgotten, []);
  assert.deepEqual(sent, [[{ id: "note", note: "typed offline" }]]);
});

test("a remote delete stays deleted when backup activation fails", () => {
  assert.deepEqual(
    remoteDeletesStillPending(["gone", "other"], new Set(["gone"])),
    ["gone", "other"],
  );
  const enable = readFileSync(
    new URL("../src/account/store.ts", import.meta.url),
    "utf8",
  );
  const start = enable.indexOf("export async function enableBackup");
  const putAt = enable.indexOf(
    "await api.putEntries(token, windowed, sync.revision)",
    start,
  );
  const removeAt = enable.indexOf("await onRemove?.(gone)", putAt);
  const markedAt = enable.indexOf("rememberRemoteDeletes(", removeAt);
  assert.ok(putAt > start && removeAt > putAt && markedAt > removeAt);
  assert.equal(
    enable.slice(start, putAt).includes("rememberRemoteDeletes("),
    false,
  );
  assert.equal(
    enable.slice(start, putAt).includes("!priorRemoved.has("),
    false,
  );
});

test("a delete during backup enable is left out of the first upload", () => {
  const stale = backupRowsAfterMerge(
    [entry("keep", 1), entry("gone", 1)],
    [entry("keep", 1)],
    new Set(),
  );
  assert.deepEqual(stale.map((row) => row.id).sort(), ["gone", "keep"]);
  const current = [entry("keep", 1)];
  const uploaded = backupRowsAfterMerge(current, stale, new Set(["gone"]));
  assert.deepEqual(
    uploaded.map((row) => row.id),
    ["keep"],
  );
  const root = new URL("../", import.meta.url);
  const store = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  const enable = store.slice(
    store.indexOf("export async function enableBackup"),
  );
  const mergeAt = enable.indexOf("const merged = await onMerge(mine)");
  const snapAt = enable.indexOf("await readBackupSnapshot()");
  const putAt = enable.indexOf("await api.putEntries");
  assert.ok(snapAt > 0 && putAt > snapAt && mergeAt > putAt);
  assert.equal(enable.slice(0, putAt).includes("await onMerge(remote)"), false);
  assert.equal(
    enable.slice(snapAt, putAt).includes("snapshot.deletedIds"),
    true,
  );
  assert.equal(button.includes("backupRowsAfterMerge(entries"), false);
  const pullAt = store.indexOf("const sync = await current.getEntries(next)");
  const mergeCall = store.indexOf("await onMerge?.(mine)", pullAt);
  assert.ok(pullAt > 0 && mergeCall > pullAt);
  const laterPull = store.slice(pullAt, mergeCall);
  assert.equal(laterPull.includes("releaseRemoteDeletes("), true);
  assert.equal(laterPull.includes("clearDeletedIds("), false);
  const enablePull = enable.slice(
    enable.indexOf("const sync = await api.getEntries"),
    enable.indexOf("const merged = await onMerge(mine)"),
  );
  assert.equal(enablePull.includes("releaseRemoteDeletes("), true);
  assert.equal(enablePull.includes("clearDeletedIds("), false);
});

test("deleting an account releases entries it never backed up", async () => {
  const store = memory();
  rememberSeenEntries(store, "user-a", ["local-only", "backed"]);
  rememberSynced(store, ["backed"], "user-a");
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
  assert.deepEqual(wiped, ["backed"]);
  assert.deepEqual(
    withoutOtherAccountEntries([entry("local-only", 1)], store, "user-b").map(
      (row) => row.id,
    ),
    ["local-only"],
  );
});

test("a re-imported entry stays after the account is deleted", async () => {
  const store = memory();
  rememberSynced(store, ["note"], "user-a");
  rememberDownloaded(store, ["note"], "user-a");
  retireEntry(store, "user-a", "note");
  assert.deepEqual(backedIdsFor(store, "user-a"), []);
  assert.deepEqual(downloadedIdsFor(store, "user-a"), []);
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
  assert.deepEqual(wiped, []);
  const again = memory();
  rememberSynced(again, ["note"], "user-a");
  retireEntry(again, "user-a", "note");
  restoreRetiredEntry(again, "user-a", "note");
  assert.deepEqual(backedIdsFor(again, "user-a"), ["note"]);
  const root = new URL("../", import.meta.url);
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  const erase = notebook.slice(
    notebook.indexOf("async function erase"),
    notebook.indexOf("async function undoDelete"),
  );
  const undo = notebook.slice(
    notebook.indexOf("async function undoDelete"),
    notebook.indexOf("async function importFile"),
  );
  const imported = notebook.slice(
    notebook.indexOf("async function importFile"),
    notebook.indexOf("function backup"),
  );
  assert.equal(erase.includes("retireCurrentEntry("), true);
  assert.equal(undo.includes("restoreCurrentEntry("), true);
  assert.equal(imported.includes("retireCurrentEntry("), false);
  assert.equal(imported.includes("restoreCurrentEntry("), false);
});

test("a delete while signed out releases the backup claim", async () => {
  const store = memory();
  rememberSynced(store, ["note"], "user-a");
  rememberDownloaded(store, ["note"], "user-a");
  rememberSynced(store, ["note"], "user-b");
  retireEntryOwners(store, "note");
  assert.deepEqual(backedIdsFor(store, "user-a"), []);
  assert.deepEqual(downloadedIdsFor(store, "user-a"), []);
  assert.deepEqual(backedIdsFor(store, "user-b"), []);
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
  assert.deepEqual(wiped, []);
  const again = memory();
  rememberSynced(again, ["note"], "user-a");
  rememberDownloaded(again, ["note"], "user-a");
  retireEntryOwners(again, "note");
  restoreEntryOwners(again, "note");
  assert.deepEqual(backedIdsFor(again, "user-a"), ["note"]);
  assert.deepEqual(downloadedIdsFor(again, "user-a"), ["note"]);
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const retire = source.slice(
    source.indexOf("export function retireCurrentEntry"),
    source.indexOf("export function restoreCurrentEntry"),
  );
  const restore = source.slice(
    source.indexOf("export function restoreCurrentEntry"),
    source.indexOf("export async function disableBackup"),
  );
  assert.equal(retire.includes("if (!uid) return"), false);
  assert.equal(retire.includes("retireEntryOwners("), true);
  assert.equal(restore.includes("if (!uid) return"), false);
  assert.equal(restore.includes("restoreEntryOwners("), true);
});

test("a retired note can be backed up by the next account", async () => {
  const store = memory();
  rememberSynced(store, ["note"], "user-a");
  rememberSeenEntries(store, "user-a", ["note"]);
  retireEntryOwners(store, "note");
  assert.deepEqual(
    withoutOtherAccountEntries([entry("note", 1)], store, "user-b").map(
      (row) => row.id,
    ),
    ["note"],
  );
  grantOptIn(store, "user-b");
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    pull: async () => ({ entries: [], deleted: [], revision: "1" }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["note"]]);
  restoreEntryOwners(store, "note");
  const again: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    pull: async () => ({ entries: [], deleted: [], revision: "2" }),
    put: async (_token, rows) => {
      again.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(again, [[]]);
});

test("undo after deleting a re-import does not restore the old backup claim", async () => {
  const store = memory();
  rememberSynced(store, ["note"], "user-a");
  rememberDownloaded(store, ["note"], "user-a");
  retireEntryOwners(store, "note");
  retireEntryOwners(store, "note");
  restoreEntryOwners(store, "note");
  assert.deepEqual(backedIdsFor(store, "user-a"), []);
  assert.deepEqual(downloadedIdsFor(store, "user-a"), []);
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
  assert.deepEqual(wiped, []);
});

test("a pull that skips a deleted row does not claim the re-import", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note", "kept"], "user-a");
  retireEntry(store, "user-a", "note");
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("kept", 1)],
    now: NOW,
    store,
    deletedIds: ["note"],
    pull: async () => ({
      entries: [entry("note", 1), entry("kept", 1)],
      deleted: [],
      revision: "2",
      stored: ["kept"],
    }),
    put: async () => {},
  });
  assert.deepEqual(downloadedIdsFor(store, "user-a"), ["kept"]);
  assert.deepEqual(backedIdsFor(store, "user-a"), ["kept"]);
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
  assert.deepEqual(wiped, ["kept"]);
  const wiring = readFileSync(
    new URL("../src/account/store.ts", import.meta.url),
    "utf8",
  );
  const pull = wiring.slice(wiring.indexOf("pull: async"));
  assert.equal(pull.includes("const stored = await onMerge?.(mine)"), true);
  assert.equal(pull.includes("stored: stored.map((entry) => entry.id)"), true);
});

test("a skipped download does not keep the next account from backing up that id", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("kept", 1)],
    now: NOW,
    store,
    deletedIds: ["note"],
    pull: async () => ({
      entries: [entry("note", 1), entry("kept", 1)],
      deleted: [],
      revision: "2",
      stored: ["kept"],
    }),
    put: async () => {},
  });
  clearOptIn(store);
  assert.deepEqual(
    withoutOtherAccountEntries([entry("note", 1)], store, "user-b").map(
      (row) => row.id,
    ),
    ["note"],
  );
  grantOptIn(store, "user-b");
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    pull: async () => ({ entries: [], deleted: [], revision: "1" }),
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["note"]]);
});

test("a pull discarded by sign-out does not claim the snapshot", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const cloud = entry("cloud-note", 1);
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("local", 1)],
    now: NOW,
    store,
    epoch: backupEpoch(store),
    pull: async () => {
      clearOptIn(store);
      nextBackupEpoch(store);
      return { entries: [cloud], deleted: [], revision: "2" };
    },
    put: async () => {
      throw new Error("uploaded");
    },
  });
  assert.deepEqual(downloadedIdsFor(store, "user-a"), []);
  assert.deepEqual(
    withoutOtherAccountEntries([cloud], store, "user-b").map((row) => row.id),
    ["cloud-note"],
  );
  const wiring = readFileSync(
    new URL("../src/account/store.ts", import.meta.url),
    "utf8",
  );
  const pull = wiring.slice(wiring.indexOf("pull: async"));
  assert.equal(pull.includes("return { ...sync, stored: [] }"), true);
});

test("rows stored before sign-out stay with that account", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const cloud = entry("cloud-note", 1);
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("local", 1)],
    now: NOW,
    store,
    epoch: backupEpoch(store),
    pull: async () => {
      clearOptIn(store);
      nextBackupEpoch(store);
      return {
        entries: [cloud],
        deleted: [],
        revision: "2",
        stored: ["cloud-note"],
      };
    },
    put: async () => {
      throw new Error("uploaded");
    },
  });
  assert.deepEqual(downloadedIdsFor(store, "user-a"), ["cloud-note"]);
});

test("a rejected upload keeps a pin comment on a remotely deleted note", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note"], "user-a");
  const pin = {
    id: "pin",
    region: "neck" as const,
    structure: "Sternum",
    position: [0, 1, 0] as [number, number, number],
    comment: "slept on it",
  };
  const map = {
    regions: ["neck"],
    summary: "kept",
    title: "Neck",
    quality: "",
    activity: "tennis",
    duration: "",
    intensity: null,
    question: null,
    urgent: false,
    safety_message: null,
  };
  const local = {
    ...entry("note", 1),
    note: "kept",
    points: [pin],
    map,
    provider: "Your notes",
    answers: [],
  };
  let journal = [local];
  const incoming = {
    ...entry("note", 1),
    note: "rewritten",
    points: [
      {
        id: "pin",
        region: "neck" as const,
        structure: "Sternum",
        position: [0, 1, 0] as [number, number, number],
      },
    ],
    map: { ...map, summary: "rewritten", activity: "", title: "" },
  };
  let attempt = 0;
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: () => journal,
    now: NOW,
    store,
    pull: async () => {
      attempt += 1;
      if (attempt === 1)
        return { entries: [], deleted: ["note"], revision: "1" };
      return { entries: [incoming], deleted: [], revision: "2" };
    },
    put: async (_token, rows, revision) => {
      if (revision === "1") throw new AccountApiError(409, "conflict");
      sent.push(rows.map((row) => row.id));
    },
    forget: async (ids) => {
      journal = journal.filter((row) => !ids.includes(row.id));
    },
  });
  assert.deepEqual(sent, [["note"]]);
  const restored = withLocalPrivateFields(
    journal.find((row) => row.id === "note"),
    incoming,
  );
  assert.equal(restored.points?.[0]?.comment, "slept on it");
  assert.equal(restored.map.activity, "tennis");
  assert.deepEqual(removedIdsFor(store, "user-a"), []);
});

test("a failed upload does not remove a note another device deleted", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note"], "user-a");
  let journal = [entry("note", 1)];
  await assert.rejects(() =>
    pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: () => journal,
      now: NOW,
      store,
      pull: async () => ({ entries: [], deleted: ["note"], revision: "1" }),
      put: async () => {
        throw new Error("down");
      },
      forget: async (ids) => {
        journal = journal.filter((row) => !ids.includes(row.id));
      },
    }),
  );
  assert.deepEqual(
    journal.map((row) => row.id),
    ["note"],
  );
  assert.deepEqual(removedIdsFor(store, "user-a"), []);
});

test("a delete during an in-flight upload does not restore the backup claim", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  rememberSynced(store, ["note"], "user-a");
  rememberSeenEntries(store, "user-a", ["note"]);
  let tombstones: string[] = [];
  let releasePut = () => {};
  const gate = new Promise<void>((resolve) => {
    releasePut = resolve;
  });
  let putStarted = () => {};
  const started = new Promise<void>((resolve) => {
    putStarted = resolve;
  });
  const pending = pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("note", 1)],
    now: NOW,
    store,
    deletedIds: () => tombstones,
    pull: async () => ({ entries: [], deleted: [], revision: "1" }),
    put: async () => {
      putStarted();
      await gate;
    },
  });
  await started;
  tombstones = ["note"];
  retireEntryOwners(store, "note");
  releasePut();
  await pending;
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [],
    now: NOW,
    store,
    deletedIds: ["note"],
    pull: async () => ({ entries: [], deleted: [], revision: "2" }),
    put: async () => {},
  });
  assert.deepEqual(backedIdsFor(store, "user-a"), []);
  assert.deepEqual(downloadedIdsFor(store, "user-a"), []);
  restoreEntryOwners(store, "note");
  assert.deepEqual(backedIdsFor(store, "user-a"), ["note"]);
  retireEntryOwners(store, "note");
  assert.deepEqual(
    withoutOtherAccountEntries([entry("note", 1)], store, "user-b").map(
      (row) => row.id,
    ),
    ["note"],
  );
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
  assert.deepEqual(wiped, []);
});

test("a failed upload does not claim the entry for the next account", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  await assert.rejects(() =>
    pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [entry("local-only", 1)],
      now: NOW,
      store,
      pull: async () => [],
      put: async () => {
        throw new Error("down");
      },
    }),
  );
  assert.deepEqual(
    withoutOtherAccountEntries([entry("local-only", 1)], store, "user-b").map(
      (row) => row.id,
    ),
    ["local-only"],
  );
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-a",
    token: "token-a",
    entries: [entry("local-only", 1)],
    now: NOW,
    store,
    pull: async () => [],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["local-only"]]);
  assert.deepEqual(
    withoutOtherAccountEntries([entry("local-only", 1)], store, "user-b").map(
      (row) => row.id,
    ),
    [],
  );
});

test("a restored cloud row stays with that account when the upload fails", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const cloud = entry("from-a", 1);
  const local = entry("local-only", 1);
  await assert.rejects(() =>
    pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [local],
      now: NOW,
      store,
      pull: async () => [cloud],
      put: async () => {
        throw new Error("down");
      },
    }),
  );
  assert.deepEqual(
    withoutOtherAccountEntries([cloud, local], store, "user-b").map(
      (row) => row.id,
    ),
    ["local-only"],
  );
});

test("deleting an account wipes a downloaded row the upload did not finish", async () => {
  const store = memory();
  grantOptIn(store, "user-a");
  const cloud = entry("from-a", 1);
  const local = entry("local-only", 1);
  await assert.rejects(() =>
    pushBackup({
      uid: "user-a",
      token: "token-a",
      entries: [local],
      now: NOW,
      store,
      pull: async () => [cloud],
      put: async () => {
        throw new Error("down");
      },
    }),
  );
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
  assert.deepEqual(wiped, ["from-a"]);
  const remaining = [cloud, local].filter((row) => !wiped.includes(row.id));
  grantOptIn(store, "user-b");
  const sent: string[][] = [];
  await pushBackup({
    uid: "user-b",
    token: "token-b",
    entries: remaining,
    now: NOW,
    store,
    pull: async () => [],
    put: async (_token, rows) => {
      sent.push(rows.map((row) => row.id));
    },
  });
  assert.deepEqual(sent, [["local-only"]]);
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

test("a remote delete closes the entry opened while the pull was in flight", () => {
  const openWhenThePullStarted = "entry-a";
  const openedDuringThePull = "entry-x";
  assert.equal(
    remoteDeleteClosesEditor(openWhenThePullStarted, ["entry-x"]),
    false,
  );
  assert.equal(
    remoteDeleteClosesEditor(openedDuringThePull, ["entry-x"]),
    true,
  );
  const root = new URL("../", import.meta.url);
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  const start = notebook.indexOf("onRemove={async (ids, reason)");
  assert.ok(start > 0);
  const block = notebook.slice(start, notebook.indexOf("/>", start));
  assert.equal(block.includes("entryRef.current.id"), true);
  assert.equal(block.includes("entry.id"), false);
  assert.equal(block.includes("entryKeptAfterRemove("), true);
  const keptAt = block.indexOf("entryKeptAfterRemove(");
  const blankAt = block.indexOf("blankEntry()", keptAt);
  assert.ok(keptAt > 0 && blankAt > keptAt);
});

test("typing during a remote delete keeps the draft as a new entry", () => {
  const prior = {
    id: "open",
    created: new Date(NOW).toISOString(),
    updated: new Date(NOW).toISOString(),
    note: "saved before the pull",
    provider: "notes",
    answers: [],
    points: [],
    map: {
      title: "",
      summary: "saved before the pull",
      regions: [],
      quality: "",
      activity: "",
      duration: "",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  };
  const typed = {
    ...prior,
    note: "typed while the pull was open",
    noteUpdated: new Date(NOW + 1000).toISOString(),
    map: { ...prior.map, summary: "typed while the pull was open" },
  };
  const kept = entryKeptAfterRemoteDelete(typed, prior, "kept-copy");
  assert.equal(kept?.id, "kept-copy");
  assert.equal(kept?.note, "typed while the pull was open");
  assert.equal(entryKeptAfterRemoteDelete(prior, prior, "unused"), null);
  assert.equal(
    entryKeptAfterRemoteDelete({ ...prior, note: "" }, undefined, "unused"),
    null,
  );
  assert.equal(
    entryKeptAfterRemove(typed, prior, "kept-copy", "remote")?.note,
    "typed while the pull was open",
  );
});

test("account deletion does not keep an edited open entry", () => {
  const prior = {
    id: "open",
    created: new Date(NOW).toISOString(),
    updated: new Date(NOW).toISOString(),
    note: "backed",
    provider: "notes",
    answers: [],
    points: [],
    map: {
      title: "",
      summary: "backed",
      regions: [],
      quality: "",
      activity: "",
      duration: "",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  };
  const typed = {
    ...prior,
    note: "edited while deleting",
    noteUpdated: new Date(NOW + 1000).toISOString(),
  };
  assert.equal(entryKeptAfterRemove(typed, prior, "copy", "account"), null);
  assert.equal(
    entryKeptAfterRemove(typed, prior, "copy", "remote")?.id,
    "copy",
  );
});

test("a restore that skips one entry leaves the entry opened during the restore", () => {
  const skipped = new Set<string>();
  assert.equal(
    restoreClosesEditor("entry-y", "entry-x", skipped, ["entry-x"]),
    false,
  );
  assert.equal(
    restoreClosesEditor("entry-x", "entry-x", skipped, ["entry-x"]),
    true,
  );
  assert.equal(
    restoreClosesEditor("entry-x", "entry-x", new Set(["entry-x"]), [
      "entry-x",
    ]),
    false,
  );
  const root = new URL("../", import.meta.url);
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  const start = notebook.indexOf("onMerge={async (incoming)");
  assert.ok(start > 0);
  const block = notebook.slice(
    start,
    notebook.indexOf("onRemove={async", start),
  );
  const gate = block.indexOf("restoreClosesEditor(");
  const keep = block.indexOf("entryKeptAfterRemove(", gate);
  const blank = block.indexOf("blankEntry()", keep);
  assert.ok(gate > 0 && keep > gate && blank > keep);
  assert.equal(block.slice(gate, keep).includes("entryRef.current.id"), true);
});

test("a backup pull reads private fields from the stored row", () => {
  const root = new URL("../", import.meta.url);
  const notebook = readFileSync(new URL("src/Notebook.tsx", root), "utf8");
  const start = notebook.indexOf("onMerge={async (incoming)");
  assert.ok(start > 0);
  const block = notebook.slice(
    start,
    notebook.indexOf("onRemove={async", start),
  );
  assert.equal(block.includes("saved.map"), false);
  assert.equal(block.includes("withLocalPrivateFields"), false);
  const storage = readFileSync(
    new URL("src/notebook-storage.ts", root),
    "utf8",
  );
  assert.equal(
    storage.includes("withLocalPrivateFields(existing, entry)"),
    true,
  );
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
    button.includes(
      'pushBackupEntries(entries, deleted, onMerge, (ids) =>\n          onRemove(ids, "remote"),',
    ),
    true,
  );
  assert.equal(
    button.includes('deleteAccount((ids) => onRemove(ids, "account"))'),
    true,
  );
  assert.equal(button.includes("rememberSeenEntries("), false);
  const turnOn = button.indexOf('t("account.turnOn")');
  const backupGate = button.lastIndexOf("snapshot.canBackup", turnOn);
  assert.ok(turnOn > 0 && backupGate >= 0 && backupGate < turnOn);
  const sync = readFileSync(new URL("src/account/sync.ts", root), "utf8");
  const push = sync.indexOf("export async function pushBackup");
  const uploaded = sync.indexOf(
    "await input.put(input.token, windowed, pulled.revision)",
    push,
  );
  const claimedAfter = sync.indexOf("rememberSeenEntries(", uploaded);
  assert.ok(push > 0 && uploaded > push && claimedAfter > uploaded);
  const beforeUpload = sync.slice(push, uploaded);
  assert.equal(beforeUpload.includes("rememberSeenEntries("), true);
  assert.equal(beforeUpload.includes("rememberDownloaded("), true);
  assert.equal(beforeUpload.includes("withUploadLock("), true);
  assert.equal(beforeUpload.includes("claimUpload("), true);
  assert.equal(beforeUpload.includes("mine.map((entry) => entry.id)"), true);
  const pullAt = beforeUpload.indexOf("await input.pull");
  const claimedAt = beforeUpload.indexOf("rememberSeenEntries(");
  const abortAt = beforeUpload.indexOf("if (!current()) return []", pullAt);
  assert.ok(pullAt >= 0 && claimedAt > pullAt && abortAt > claimedAt);
  const enable = store.indexOf("export async function enableBackup");
  const enableBody = store.slice(
    enable,
    store.indexOf("export async function disableBackup"),
  );
  assert.equal(enableBody.includes("backupClock("), true);
  assert.equal(store.includes('addEventListener("storage"'), true);
  const stored = store.indexOf('addEventListener("storage"');
  const storedBody = store.slice(stored, stored + 500);
  assert.equal(storedBody.includes("backupOptInFromStorage("), true);
  assert.equal(storedBody.includes("optedIn: next"), true);
  assert.equal(enableBody.includes("sync.deleted"), true);
  const put = store.indexOf(
    "await api.putEntries(token, windowed, sync.revision)",
    enable,
  );
  const claimed = store.indexOf("rememberSeenEntries(", put);
  assert.ok(enable > 0 && put > enable && claimed > put);
  const beforePut = store.slice(enable, put);
  assert.equal(beforePut.includes("await onMerge(remote)"), false);
  assert.equal(beforePut.includes("withUploadLock("), true);
  assert.equal(beforePut.includes("claimUpload("), true);
  assert.equal(beforePut.includes("await readBackupSnapshot()"), true);
  const afterPut = store.slice(put);
  const mergedAt = afterPut.indexOf("const merged = await onMerge(mine)");
  const claimedMerge = afterPut.indexOf("rememberSeenEntries(", mergedAt);
  const downloadedMerge = afterPut.indexOf("rememberDownloaded(", claimedMerge);
  const optIn = afterPut.indexOf("grantOptIn(", downloadedMerge);
  assert.ok(
    mergedAt > 0 &&
      claimedMerge > mergedAt &&
      downloadedMerge > claimedMerge &&
      optIn > downloadedMerge,
  );
  const mapped = afterPut.indexOf("merged.map((entry) => entry.id)", mergedAt);
  assert.ok(mapped > claimedMerge && mapped < downloadedMerge);
  assert.equal(store.includes("await onMerge?.(mine)"), true);
  assert.equal(store.includes("idsDeletedOnServer("), true);
  assert.equal(store.includes("rememberRemoteDeletes("), true);
  assert.equal(store.includes("settleUploads: () => pushChain"), true);
  assert.equal(store.includes("getIdToken(true)"), true);
  assert.equal(store.includes("state.session?.uid !== session.uid"), true);
  assert.equal(
    store.includes("sameAccount: () => state.session?.uid === session.uid"),
    true,
  );
  const deleting = sync.indexOf("export async function deleteSignedInAccount");
  const cloudDelete = sync.indexOf("await input.api.deleteAccount", deleting);
  const authDelete = sync.indexOf("await input.deleteAuth", deleting);
  assert.ok(deleting > 0 && cloudDelete > deleting && authDelete > cloudDelete);
  assert.equal(
    sync.slice(deleting, cloudDelete).includes("input.sameAccount"),
    true,
  );
  assert.equal(
    sync.slice(deleting, cloudDelete).includes("waitForAccountUploads("),
    true,
  );
  const waiting = sync.indexOf("export function waitForAccountUploads");
  const waitingBody = sync.slice(waiting, waiting + 500);
  assert.equal(waitingBody.includes("withUploadLock("), true);
  assert.equal(waitingBody.includes("UPLOAD_LEASE_MS"), false);
  const afterCloud = sync.slice(cloudDelete, authDelete);
  const backupOff = afterCloud.indexOf("clearOptIn(");
  const switched = afterCloud.indexOf("input.sameAccount");
  assert.ok(backupOff >= 0 && switched > backupOff);
  assert.equal(notebook.includes("savedAfterBackupPull"), true);
  assert.equal(auth.includes("REFRESH_KEY"), false);
  assert.equal(auth.includes("passkeySignIn"), false);
  assert.equal(auth.includes("passkeyEnrollment"), false);
});

test("another account does not keep the previous search allowance", () => {
  assert.equal(remainingForSession("user-a", 4, "user-a"), 4);
  assert.equal(remainingForSession("user-a", 4, "user-b"), null);
  assert.equal(remainingForSession("user-a", 4, null), null);
  assert.equal(remainingForSession(null, null, "user-b"), null);
  const root = new URL("../", import.meta.url);
  const store = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const refresh = store.slice(
    store.indexOf("export async function refreshAccount"),
    store.indexOf("export async function signIn"),
  );
  const failed = refresh.slice(refresh.indexOf("} catch"));
  assert.equal(failed.includes("remaining"), false);
  const apply = store.slice(
    store.indexOf("function applySession"),
    store.indexOf("function wire"),
  );
  assert.equal(apply.includes("remainingForSession("), true);
});

test("a source search started by one account does not finish for another", () => {
  assert.equal(sourceSearchDecision("user-a", "user-a", false), "allow");
  assert.equal(sourceSearchDecision("user-a", "user-b", false), "stop");
  assert.equal(sourceSearchDecision("user-a", null, false), "stop");
  assert.equal(sourceSearchDecision("user-a", "user-b", true), "stop");
  assert.equal(sourceSearchDecision("user-a", "user-a", true), "upgrade");
  const root = new URL("../", import.meta.url);
  const store = readFileSync(new URL("src/account/store.ts", root), "utf8");
  const guard = store.slice(
    store.indexOf("export async function guardSourceSearch"),
    store.indexOf("export function syncedIds"),
  );
  const allow = guard.indexOf('decision !== "allow"');
  const upgrade = guard.indexOf("openUpgrade()");
  assert.ok(allow > 0);
  assert.ok(upgrade > allow);
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
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 204 });
  };
  createAnalytics("http://analytics.example/collect", fetchImpl).record(
    "sync_on",
  );
  createAnalytics("https://analytics.test/collect", fetchImpl).record(
    "sign_out",
  );
  createAnalytics("http://127.0.0.1:9/collect", fetchImpl).record("sync_off");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [
    "https://analytics.test/collect",
    "http://127.0.0.1:9/collect",
  ]);
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

test("passkeys stay hidden until Firebase publishes a sign-in method", async () => {
  const auth = await import("firebase/auth");
  assert.equal(
    typeof (auth as { signInWithPasskey?: unknown }).signInWithPasskey,
    "undefined",
  );
  const root = new URL("../", import.meta.url);
  const client = readFileSync(
    new URL("src/account/firebase-auth.ts", root),
    "utf8",
  );
  assert.equal(client.includes("passkeySignIn"), false);
  assert.equal(client.includes("passkeyEnrollment"), false);
  assert.equal(client.includes("/v2/accounts/"), false);
  const button = readFileSync(
    new URL("src/account/AccountButton.tsx", root),
    "utf8",
  );
  assert.equal(button.includes("account.passkey"), false);
  assert.equal(button.includes('signIn("passkey")'), false);
  const settings = readFileSync(new URL("src/account/config.ts", root), "utf8");
  assert.equal(settings.includes("passkeySignInAllowed"), false);
  assert.equal(settings.includes("VITE_PASSKEY_RP_ID"), false);
  const passkeyFile = new URL("src/account/passkey.ts", root);
  assert.equal(existsSync(passkeyFile), false);
});

test("config comes from env and the test runtime stays on loopback", async () => {
  assert.equal(testRuntimeAllowed("ihurt.app"), false);
  assert.equal(testRuntimeAllowed("localhost"), true);
  assert.equal(testRuntimeAllowed("127.0.0.1"), true);
  assert.equal(testRuntimeAllowed("localhost", "capacitor:"), false);
  assert.equal(emailSignInAllowed("https:"), true);
  assert.equal(emailSignInAllowed("capacitor:"), false);
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
  const retry: string[] = [];
  const network = new Error("network-request-failed");
  Object.assign(network, { code: "auth/network-request-failed" });
  const again = await completeEmailLink({
    isLink: true,
    email: "person@example.com",
    href: "https://ihurt.app/?oobCode=still-good",
    signIn: async () => {
      throw network;
    },
    clearEmail: () => retry.push("email"),
    clearQuery: () => retry.push("query"),
  });
  assert.equal(again, false);
  assert.deepEqual(retry, []);
  assert.deepEqual(
    readAccountConfig({
      VITE_FIREBASE_API_KEY: "public",
      VITE_FIREBASE_AUTH_DOMAIN: "ihurt.app",
      VITE_FIREBASE_PROJECT_ID: "ihurt",
      VITE_FIREBASE_APP_ID: "app",
      VITE_IHURT_API_BASE: "https://api.ihurt.app",
      VITE_ANALYTICS_ENDPOINT: "",
    }),
    {
      firebase: {
        apiKey: "public",
        authDomain: "ihurt.app",
        projectId: "ihurt",
        appId: "app",
      },
      apiBase: "https://api.ihurt.app",
      analyticsEndpoint: "",
    },
  );
  assert.equal(
    readAccountConfig({
      VITE_ANALYTICS_ENDPOINT: "http://analytics.example/collect",
    }).analyticsEndpoint,
    "",
  );
  assert.equal(
    readAccountConfig({
      VITE_ANALYTICS_ENDPOINT: "https://analytics.test/collect",
    }).analyticsEndpoint,
    "https://analytics.test/collect",
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
