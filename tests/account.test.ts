import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_RESPONSE_BYTES,
  AccountApiError,
  accountApiOrigin,
  createAccountApi,
  remoteEntries,
  SYNC_ENTRY_LIMIT,
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
  idsDeletedOnServer,
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
  passkeySignInAllowed,
  readAccountConfig,
  testRuntimeAllowed,
} from "../src/account/config.ts";
import { acceptStoredEntry, STORED_PIN_LIMIT } from "../src/notebook-data.ts";
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
  rememberRemoteDeletes,
  rememberSeenEntries,
  rememberSynced,
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
  const crowded = storedEntry(validMap);
  crowded.points = Array.from({ length: STORED_PIN_LIMIT + 1 }, (_, index) => ({
    id: `pin-${index}`,
    region: "neck",
    structure: "Sternum",
    position: [0, 1, 0],
  }));
  assert.throws(
    () => remoteEntries({ entries: [crowded] }),
    (error: unknown) =>
      error instanceof AccountApiError && error.code === "invalid",
  );
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
    pull: async () => [entry("keep", 1)],
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
      [entry("keep", 1)],
      new Set(),
      NOW,
    ),
    ["gone"],
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
  const mergeAt = enable.indexOf("const merged = await onMerge(remote)");
  const snapAt = enable.indexOf("await readBackupSnapshot()");
  const putAt = enable.indexOf("await api.putEntries");
  assert.ok(mergeAt > 0 && snapAt > mergeAt && putAt > snapAt);
  assert.equal(
    enable.slice(snapAt, putAt).includes("snapshot.deletedIds"),
    true,
  );
  assert.equal(button.includes("backupRowsAfterMerge(entries"), false);
  const pullAt = store.indexOf("const remote = await current.getEntries(next)");
  const mergeCall = store.indexOf("await onMerge?.(remote)", pullAt);
  assert.ok(pullAt > 0 && mergeCall > pullAt);
  assert.equal(
    store.slice(pullAt, mergeCall).includes("await clearDeletedIds(revived)"),
    true,
  );
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
  const sync = readFileSync(new URL("src/account/sync.ts", root), "utf8");
  const push = sync.indexOf("export async function pushBackup");
  const uploaded = sync.indexOf("await input.put(input.token, windowed)", push);
  const claimedAfter = sync.indexOf("rememberSeenEntries(", uploaded);
  assert.ok(push > 0 && uploaded > push && claimedAfter > uploaded);
  const beforeUpload = sync.slice(push, uploaded);
  assert.equal(beforeUpload.includes("rememberSeenEntries("), true);
  assert.equal(beforeUpload.includes("rememberDownloaded("), true);
  assert.equal(beforeUpload.includes("remote.map((entry) => entry.id)"), true);
  const pullAt = beforeUpload.indexOf("await input.pull");
  const claimedAt = beforeUpload.indexOf("rememberSeenEntries(");
  const abortAt = beforeUpload.indexOf("if (!current()) return []", pullAt);
  assert.ok(pullAt >= 0 && claimedAt > pullAt && abortAt > claimedAt);
  const enable = store.indexOf("export async function enableBackup");
  const put = store.indexOf("await api.putEntries(token, windowed)", enable);
  const claimed = store.indexOf("rememberSeenEntries(", put);
  assert.ok(enable > 0 && put > enable && claimed > put);
  const beforePut = store.slice(enable, put);
  assert.equal(beforePut.includes("rememberSeenEntries("), true);
  assert.equal(beforePut.includes("rememberDownloaded("), true);
  assert.equal(beforePut.includes("merged.map((entry) => entry.id)"), true);
  const mergedAt = beforePut.indexOf("const merged = await onMerge(remote)");
  const afterMerge = beforePut.slice(mergedAt);
  const claimedMerge = afterMerge.indexOf("rememberSeenEntries(");
  const epochAfterMerge = afterMerge.indexOf(
    "backupEpoch(browserStore()) !== epoch",
  );
  assert.ok(
    mergedAt >= 0 && claimedMerge > 0 && epochAfterMerge > claimedMerge,
  );
  assert.equal(store.includes("await onMerge?.(remote)"), true);
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
    sync.slice(cloudDelete, authDelete).includes("input.sameAccount"),
    true,
  );
  assert.equal(notebook.includes("savedAfterBackupPull"), true);
  assert.equal(auth.includes("storage()?.setItem(REFRESH_KEY"), false);
  assert.equal(auth.includes("storage()?.getItem(REFRESH_KEY"), false);
  assert.equal(
    auth.includes("sessionStorageOrNull()?.setItem(REFRESH_KEY, token)"),
    true,
  );
  const passkey = auth.indexOf('exported.signInWithPasskey(auth, "iHurt")');
  const fallback = auth.indexOf("passkeySignIn(", passkey);
  assert.ok(passkey > 0 && fallback > passkey);
  const between = auth.slice(passkey, fallback);
  assert.equal(
    between.includes('throw new AccountAuthError("passkey-unavailable")'),
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
