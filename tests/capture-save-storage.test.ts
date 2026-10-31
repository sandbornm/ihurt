// IndexedDB stand-in for the notebook store. Transactions commit in the
// order they are opened, and a throw inside a request rolls the transaction
// back. That is enough to replay the capture-save races against the real
// notebook-storage functions.
import test from "node:test";
import assert from "node:assert/strict";

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

const committed = {
  entries: new Map<string, unknown>(),
  settings: new Map<string, unknown>(),
};
let tail = Promise.resolve();
let failPut = false;

type StoreName = "entries" | "settings";

function makeTransaction(names: StoreName[]) {
  const tx = {
    oncomplete: null as null | (() => void),
    onerror: null as null | (() => void),
    onabort: null as null | (() => void),
    error: null as Error | null,
    aborted: false,
    committed: false,
    pending: 0,
    started: false,
    early: [] as Array<() => void>,
    local: {
      entries: new Map<string, unknown>(),
      settings: new Map<string, unknown>(),
    },
    abort() {
      if (tx.aborted) return;
      tx.aborted = true;
      queueMicrotask(() => tx.onabort?.());
    },
    objectStore(name: StoreName) {
      return store(name);
    },
  };
  const arm = (fn: () => void) => {
    if (tx.started) fn();
    else tx.early.push(fn);
  };
  const commit = () => {
    if (tx.aborted || tx.pending > 0 || tx.committed) return;
    tx.committed = true;
    for (const name of names) committed[name] = tx.local[name];
    queueMicrotask(() => tx.oncomplete?.());
  };
  const store = (name: StoreName) => ({
    get(key: string) {
      const request = {
        result: undefined as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
      };
      arm(() => {
        tx.pending += 1;
        queueMicrotask(() => {
          if (tx.aborted) return;
          request.result = clone(tx.local[name].get(key));
          tx.pending -= 1;
          try {
            request.onsuccess?.();
          } catch (error) {
            tx.error = error as Error;
            tx.abort();
            return;
          }
          commit();
        });
      });
      return request;
    },
    getAll() {
      const request = {
        result: undefined as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
      };
      arm(() => {
        tx.pending += 1;
        queueMicrotask(() => {
          if (tx.aborted) return;
          request.result = [...tx.local[name].values()].map((item) =>
            clone(item),
          );
          tx.pending -= 1;
          try {
            request.onsuccess?.();
          } catch (error) {
            tx.error = error as Error;
            tx.abort();
            return;
          }
          commit();
        });
      });
      return request;
    },
    put(value: { id?: string }, key?: string) {
      if (failPut) {
        const error = new Error("quota");
        tx.error = error;
        throw error;
      }
      arm(() => {
        const id = name === "entries" ? value.id : key;
        tx.local[name].set(id as string, clone(value));
      });
      return { result: undefined, onsuccess: null };
    },
    delete(key: string) {
      arm(() => {
        tx.local[name].delete(key);
      });
    },
  });

  const previous = tail;
  let release = () => {};
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  previous.then(() => {
    if (tx.aborted) {
      release();
      return;
    }
    tx.local = {
      entries: new Map(
        [...committed.entries].map(([key, value]) => [key, clone(value)]),
      ),
      settings: new Map(
        [...committed.settings].map(([key, value]) => [key, clone(value)]),
      ),
    };
    tx.started = true;
    try {
      for (const fn of tx.early) fn();
    } catch (error) {
      tx.error = error as Error;
      tx.abort();
      release();
      return;
    }
    commit();
    const finish = () => release();
    if (tx.committed || tx.aborted) queueMicrotask(finish);
    else {
      const prior = tx.oncomplete;
      tx.oncomplete = () => {
        prior?.();
        finish();
      };
      const priorAbort = tx.onabort;
      tx.onabort = () => {
        priorAbort?.();
        finish();
      };
    }
  });
  return tx;
}

const database = {
  createObjectStore() {},
  close() {},
  transaction(names: StoreName[]) {
    return makeTransaction(names);
  },
};

globalThis.indexedDB = {
  open() {
    const request = {
      result: database,
      error: null,
      onupgradeneeded: null as null | (() => void),
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
      onblocked: null as null | (() => void),
    };
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  },
} as unknown as IDBFactory;

const { loadNotebook, storeEntries, removeEntry, saveDraft, saveResearch } =
  await import("../src/notebook-storage.ts");

type Row = {
  id: string;
  note: string;
  research?: { description?: string; references: { url: string }[] };
  references?: { url: string }[];
  updated?: string;
};

const entry = (
  id: string,
  note: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  created: "2026-01-01T00:00:00.000Z",
  updated: "2026-01-01T00:00:00.000Z",
  note,
  provider: "Your notes",
  answers: [],
  points: [],
  map: {
    title: note || "Entry",
    summary: note,
    regions: [],
    quality: "",
    activity: "",
    duration: "",
    intensity: null,
    question: null,
    urgent: false,
    safety_message: null,
  },
  ...extra,
});

const draftOf = (row: ReturnType<typeof entry>) => ({
  entry: row,
  selected: null,
  view: "front" as const,
  layer: "muscle" as const,
  sources: [] as string[],
});

const research = {
  activity: "Walk",
  description: "stiff",
  regions: ["knee"],
  checked: "2026-01-02T00:00:00.000Z",
  references: [
    {
      title: "Knee guide",
      url: "https://example.test/knee",
      publisher: "Example",
      checked: "2026-01-02T00:00:00.000Z",
    },
  ],
};

test("notebook saves keep each id, a landed search, and a deleted row", async () => {
  await storeEntries([entry("a", "knee"), entry("b", "calf")]);
  let loaded = await loadNotebook();
  assert.deepEqual(
    loaded.entries.map((item) => item.id).sort(),
    ["a", "b"],
  );
  await storeEntries([entry("a", "knee again")]);
  loaded = await loadNotebook();
  assert.equal(loaded.entries.find((item) => item.id === "b")?.note, "calf");
  assert.equal(
    loaded.entries.find((item) => item.id === "a")?.note,
    "knee again",
  );

  await removeEntry("a");
  loaded = await loadNotebook();
  assert.deepEqual(
    loaded.entries.map((item) => item.id),
    ["b"],
  );

  await saveDraft(draftOf(entry("b", "calf")));
  loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.id, "b");

  await Promise.all([
    saveDraft(draftOf(entry("b", "older"))),
    saveDraft(draftOf(entry("b", "newer"))),
  ]);
  loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.note, "newer");

  failPut = true;
  await assert.rejects(storeEntries([entry("b", "nope"), entry("c", "nope")]));
  failPut = false;
  loaded = await loadNotebook();
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0].note, "calf");
  assert.equal(
    loaded.entries.some((item) => item.id === "c"),
    false,
  );

  const researchWrite = saveResearch("b", research);
  const staleWrite = storeEntries([entry("b", "typed during the save")]);
  const settled = await Promise.allSettled([researchWrite, staleWrite]);
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[1].status, "fulfilled");
  loaded = await loadNotebook();
  const saved = loaded.entries.find((item) => item.id === "b") as Row;
  assert.equal(saved.note, "typed during the save");
  assert.equal(saved.research?.description, "stiff");
  assert.equal(saved.references?.[0]?.url, "https://example.test/knee");
  assert.equal(loaded.entries.length, 1);

  await saveDraft(
    draftOf(entry("b", "old draft", { updated: "2026-01-01T00:00:00.000Z" })),
  );
  await storeEntries([
    entry("b", "saved note", { updated: "2026-01-04T00:00:00.000Z" }),
  ]);
  const afterNewerSave = await saveResearch("b", research);
  assert.equal(afterNewerSave?.note, "saved note");
  assert.equal(afterNewerSave?.research?.description, "stiff");

  // A prior search stamped "now". This save is later than that, and the draft is later still.
  await storeEntries([
    entry("b", "stored earlier", { updated: "2099-01-01T00:00:00.000Z" }),
  ]);
  await saveDraft(
    draftOf(
      entry("b", "typed after save", { updated: "2099-06-01T00:00:00.000Z" }),
    ),
  );
  const afterNewerDraft = await saveResearch("b", research);
  assert.equal(afterNewerDraft?.note, "typed after save");
  assert.equal(afterNewerDraft?.research?.description, "stiff");

  await storeEntries([entry("b", "still here")]);
  await saveDraft(draftOf(entry("b", "still here")));
  await removeEntry("b");
  const restored = await saveResearch("b", research);
  loaded = await loadNotebook();
  assert.equal(restored, undefined);
  assert.deepEqual(loaded.entries, []);

  const undone = entry("b", "restored", {
    updated: "2026-01-06T00:00:00.000Z",
  });
  await storeEntries([undone]);
  const afterUndo = await saveResearch("b", research);
  assert.equal(afterUndo?.note, "restored");
  assert.equal(afterUndo?.research?.description, "stiff");

  await saveDraft(draftOf(entry("d", "only a draft")));
  const created = await saveResearch("d", research);
  assert.equal(created?.note, "only a draft");
  loaded = await loadNotebook();
  assert.equal(loaded.entries.find((item) => item.id === "d")?.note, "only a draft");
});

test("a save with older research does not replace a newer search", async () => {
  const older = {
    ...research,
    description: "old search",
    version: "2026-01-02T00:00:00.000Z",
    references: [
      {
        title: "Old knee",
        url: "https://example.test/old",
        publisher: "Example",
        checked: "2026-01-02T00:00:00.000Z",
      },
    ],
  };
  const newer = {
    ...research,
    description: "new search",
    references: [
      {
        title: "New knee",
        url: "https://example.test/new",
        publisher: "Example",
        checked: "2026-01-06T00:00:00.000Z",
      },
    ],
  };
  await storeEntries([
    entry("r", "base", { updated: "2026-01-01T00:00:00.000Z" }),
  ]);
  await saveResearch("r", newer);
  let loaded = await loadNotebook();
  const committed = loaded.entries.find((item) => item.id === "r") as Row & {
    research?: {
      version?: string;
      description?: string;
      references: { url: string }[];
    };
  };
  const researchUpdated = committed.updated ?? "";
  assert.equal(committed.research?.description, "new search");

  await storeEntries([
    entry("r", "just-saved note", {
      updated: "2026-01-04T00:00:00.000Z",
      research: older,
      references: older.references,
    }),
  ]);
  loaded = await loadNotebook();
  const merged = loaded.entries.find((item) => item.id === "r") as Row & {
    research?: { version?: string; description?: string; references: { url: string }[] };
  };
  assert.equal(merged.note, "just-saved note");
  assert.equal(merged.research?.description, "new search");
  assert.equal(merged.research?.references?.[0]?.url, "https://example.test/new");
  assert.equal(
    merged.references?.some((item) => item.url === "https://example.test/new"),
    true,
  );
  assert.ok(merged.updated !== undefined && merged.updated >= researchUpdated);
  assert.ok(merged.updated >= "2026-01-04T00:00:00.000Z");

  await saveDraft(
    draftOf(entry("r", "stale draft", { updated: "2026-01-05T00:00:00.000Z" })),
  );
  const afterDraft = await saveResearch("r", newer);
  assert.equal(afterDraft?.note, "just-saved note");
  assert.equal(afterDraft?.research?.description, "new search");

  await storeEntries([
    entry("legacy", "old row", {
      updated: "2026-01-01T00:00:00.000Z",
      research: { ...research, description: "unversioned" },
      references: research.references,
    }),
  ]);
  await storeEntries([
    entry("legacy", "saved later", {
      updated: "2026-01-03T00:00:00.000Z",
      research: { ...older, description: "versioned search" },
      references: older.references,
    }),
  ]);
  loaded = await loadNotebook();
  const legacy = loaded.entries.find((item) => item.id === "legacy") as Row;
  assert.equal(legacy.note, "saved later");
  assert.equal(legacy.research?.description, "versioned search");
  assert.equal(legacy.updated, "2026-01-03T00:00:00.000Z");

  await storeEntries([
    entry("legacy", "plain snapshot", {
      updated: "2026-01-02T00:00:00.000Z",
      research: { ...research, description: "no version" },
      references: research.references,
    }),
  ]);
  loaded = await loadNotebook();
  const kept = loaded.entries.find((item) => item.id === "legacy") as Row & {
    research?: { version?: string; description?: string };
  };
  assert.equal(kept.research?.description, "versioned search");
  assert.equal(kept.note, "plain snapshot");
  assert.equal(kept.updated, "2026-01-03T00:00:00.000Z");
});
