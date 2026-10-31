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

const {
  loadNotebook,
  storeEntries,
  removeEntry,
  saveDraft,
  saveResearch,
  editorAfterSave,
  withStampedResearch,
  entryReferences,
} = await import("../src/notebook-storage.ts");
const { stringifyNotebook, parseNotebook, blankEntry } =
  await import("../src/notebook-data.ts");
const { exampleEntry } = await import("../src/example.ts");

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
  assert.deepEqual(loaded.entries.map((item) => item.id).sort(), ["a", "b"]);
  await storeEntries([
    entry("a", "knee again", { noteUpdated: "2026-01-02T00:00:00.000Z" }),
  ]);
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
    saveDraft(draftOf(entry("draft-race", "older"))),
    saveDraft(draftOf(entry("draft-race", "newer"))),
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
  const staleWrite = storeEntries([
    entry("b", "typed during the save", {
      noteUpdated: "2026-01-02T00:00:00.000Z",
    }),
  ]);
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
    entry("b", "saved note", {
      updated: "2026-01-04T00:00:00.000Z",
      noteUpdated: "2026-01-04T00:00:00.000Z",
    }),
  ]);
  const afterNewerSave = await saveResearch("b", research);
  assert.equal(afterNewerSave?.note, "saved note");
  assert.equal(afterNewerSave?.research?.description, "stiff");

  // A prior search stamped "now". This save is later than that, and the draft is later still.
  await storeEntries([
    entry("b", "stored earlier", {
      updated: "2099-01-01T00:00:00.000Z",
      noteUpdated: "2099-01-01T00:00:00.000Z",
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("b", "typed after save", {
        updated: "2099-06-01T00:00:00.000Z",
        noteUpdated: "2099-06-01T00:00:00.000Z",
      }),
    ),
  );
  const afterNewerDraft = await saveResearch("b", research);
  assert.equal(afterNewerDraft?.note, "typed after save");
  assert.equal(afterNewerDraft?.research?.description, "stiff");

  await storeEntries([
    entry("b", "still here", { noteUpdated: "2026-01-05T00:00:00.000Z" }),
  ]);
  await saveDraft(
    draftOf(
      entry("b", "still here", { noteUpdated: "2026-01-05T00:00:00.000Z" }),
    ),
  );
  await removeEntry("b");
  const restored = await saveResearch("b", research);
  loaded = await loadNotebook();
  assert.equal(restored, undefined);
  assert.deepEqual(loaded.entries, []);

  const undone = entry("b", "restored", {
    updated: "2026-01-06T00:00:00.000Z",
    noteUpdated: "2026-01-06T00:00:00.000Z",
  });
  await storeEntries([undone]);
  const afterUndo = await saveResearch("b", research);
  assert.equal(afterUndo?.note, "restored");
  assert.equal(afterUndo?.research?.description, "stiff");

  await saveDraft(
    draftOf(
      entry("d", "only a draft", { noteUpdated: "2026-01-01T00:00:00.000Z" }),
    ),
  );
  const created = await saveResearch("d", research);
  assert.equal(created?.note, "only a draft");
  loaded = await loadNotebook();
  assert.equal(
    loaded.entries.find((item) => item.id === "d")?.note,
    "only a draft",
  );
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
      noteUpdated: "2026-01-04T00:00:00.000Z",
      research: older,
      references: older.references,
    }),
  ]);
  loaded = await loadNotebook();
  const merged = loaded.entries.find((item) => item.id === "r") as Row & {
    research?: {
      version?: string;
      description?: string;
      references: { url: string }[];
    };
  };
  assert.equal(merged.note, "just-saved note");
  assert.equal(merged.research?.description, "new search");
  assert.equal(
    merged.research?.references?.[0]?.url,
    "https://example.test/new",
  );
  assert.equal(
    merged.references?.some((item) => item.url === "https://example.test/new"),
    true,
  );
  assert.ok(merged.updated !== undefined && merged.updated >= researchUpdated);
  assert.ok(merged.updated >= "2026-01-04T00:00:00.000Z");

  await saveDraft(
    draftOf(entry("r", "older draft", { updated: "2026-01-03T00:00:00.000Z" })),
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
      noteUpdated: "2026-01-03T00:00:00.000Z",
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
      references: [
        ...research.references,
        {
          title: "Related reading",
          url: "https://example.test/extra-reading",
          publisher: "Example",
          checked: "2026-01-02T00:00:00.000Z",
        },
      ],
    }),
  ]);
  loaded = await loadNotebook();
  const kept = loaded.entries.find((item) => item.id === "legacy") as Row & {
    research?: { version?: string; description?: string };
    references?: { url: string }[];
  };
  assert.equal(kept.research?.description, "versioned search");
  assert.equal(kept.note, "saved later");
  assert.equal(kept.updated, "2026-01-03T00:00:00.000Z");
  // Existing links stay first. The save's new reading is not dropped.
  assert.equal(kept.references?.[0]?.url, "https://example.test/old");
  assert.equal(
    kept.references?.some(
      (item) => item.url === "https://example.test/extra-reading",
    ),
    true,
  );
});

test("storeEntries returns the merged row a card would show", async () => {
  const older = {
    ...research,
    description: "old search",
    version: "2026-01-02T00:00:00.000Z",
    references: [
      {
        title: "Old knee",
        url: "https://example.test/old-card",
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
        url: "https://example.test/new-card",
        publisher: "Example",
        checked: "2026-01-06T00:00:00.000Z",
      },
    ],
  };
  await storeEntries([
    entry("card", "base", { updated: "2026-01-01T00:00:00.000Z" }),
  ]);
  await saveResearch("card", newer);
  const snapshot = entry("card", "saved note", {
    updated: "2026-01-04T00:00:00.000Z",
    noteUpdated: "2026-01-04T00:00:00.000Z",
    research: older,
    references: older.references,
  });
  const returned = await storeEntries([snapshot]);
  assert.equal(returned.length, 1);
  assert.equal(returned[0]?.note, "saved note");
  assert.equal(returned[0]?.research?.description, "new search");
  assert.notEqual(
    returned[0]?.research?.description,
    snapshot.research.description,
  );
  const loaded = await loadNotebook();
  const row = loaded.entries.find((item) => item.id === "card");
  assert.equal(row?.research?.description, returned[0]?.research?.description);
  assert.equal(
    row?.research && "version" in row.research
      ? row.research.version
      : undefined,
    returned[0]?.research && "version" in returned[0].research
      ? returned[0].research.version
      : undefined,
  );
});

test("the editor keeps the stamped research version", () => {
  const bare = { ...research, description: "from the search panel" };
  const stamped = { ...bare, version: "2026-01-06T00:00:00.000Z" };
  const editor = entry("e", "typed", {
    research: bare,
    updated: "2026-01-06T00:00:01.000Z",
  });
  const stored = entry("e", "older row", {
    research: stamped,
    updated: "2026-01-06T00:00:00.000Z",
  });
  const next = withStampedResearch(editor, "e", stored);
  assert.equal(next.research?.version, "2026-01-06T00:00:00.000Z");
  assert.equal(next.note, "typed");
  assert.equal(next.updated, "2026-01-06T00:00:01.000Z");
  const other = withStampedResearch(editor, "nope", stored);
  assert.equal(other, editor);
});

test("a stale save keeps a newer note and a later search does not restore the old one", async () => {
  await storeEntries([
    entry("n", "first", { updated: "2026-01-01T00:00:00.000Z" }),
  ]);
  await saveDraft(
    draftOf(
      entry("n", "typed in between", {
        updated: "2026-01-02T00:00:00.000Z",
        noteUpdated: "2026-01-02T00:00:00.000Z",
      }),
    ),
  );
  const landed = await saveResearch("n", research);
  assert.equal(landed?.note, "typed in between");
  const researchUpdated = landed?.updated ?? "";

  await storeEntries([
    entry("n", "old note", {
      updated: "2026-01-01T00:00:00.000Z",
      research: { ...research, description: "no version" },
      references: research.references,
    }),
  ]);
  let loaded = await loadNotebook();
  let row = loaded.entries.find((item) => item.id === "n");
  assert.equal(row?.note, "typed in between");
  assert.ok((row?.updated ?? "") >= researchUpdated);

  await saveDraft(
    draftOf(
      entry("n", "typed in between", {
        updated: "2026-01-02T00:00:00.000Z",
        noteUpdated: "2026-01-02T00:00:00.000Z",
      }),
    ),
  );
  const again = await saveResearch("n", research);
  assert.equal(again?.note, "typed in between");
  loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.note, "typed in between");
  assert.equal(
    loaded.entries.find((item) => item.id === "n")?.note,
    "typed in between",
  );
});

test("a search keeps a note typed after the snapshot when the row time was bumped", async () => {
  await storeEntries([
    entry("bump", "old note", {
      updated: "2026-10-31T00:00:00.000Z",
      noteUpdated: "2026-01-01T00:00:00.000Z",
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("bump", "typed in between", {
        updated: "2026-01-02T00:00:00.000Z",
        noteUpdated: "2026-01-02T00:00:00.000Z",
      }),
    ),
  );
  const after = await saveResearch("bump", research);
  assert.equal(after?.note, "typed in between");
  const loaded = await loadNotebook();
  assert.equal(
    loaded.entries.find((item) => item.id === "bump")?.note,
    "typed in between",
  );
  assert.equal(loaded.draft?.entry.note, "typed in between");
});

test("an edit made while a save is writing stays in the editor", () => {
  const older = {
    ...research,
    description: "old search",
    version: "2026-01-01T00:00:00.000Z",
  };
  const merged = {
    ...research,
    description: "merged search",
    version: "2026-01-04T00:00:00.000Z",
  };
  const links = [
    {
      title: "Merged",
      url: "https://example.test/merged",
      publisher: "Example",
      checked: "2026-01-04T00:00:00.000Z",
    },
  ];
  const snapshot = entry("e", "before", {
    updated: "2026-01-01T00:00:00.000Z",
    noteUpdated: "2026-01-01T00:00:00.000Z",
    research: older,
  });
  const typed = entry("e", "typed while saving", {
    updated: "2026-01-03T00:00:00.000Z",
    noteUpdated: "2026-01-03T00:00:00.000Z",
    map: { ...snapshot.map, title: "kept title" },
    research: older,
  });
  const saved = entry("e", "stored note", {
    updated: "2026-01-02T00:00:00.000Z",
    noteUpdated: "2026-01-02T00:00:00.000Z",
    research: merged,
    references: links,
  });
  const next = editorAfterSave(typed, snapshot, saved);
  assert.equal(next.note, "typed while saving");
  assert.equal(next.noteUpdated, "2026-01-03T00:00:00.000Z");
  assert.equal(next.updated, "2026-01-03T00:00:00.000Z");
  assert.equal(next.map.title, "kept title");
  assert.equal(next.research?.description, "merged search");
  assert.equal(
    next.research && "version" in next.research
      ? next.research.version
      : undefined,
    "2026-01-04T00:00:00.000Z",
  );
  assert.equal(next.references?.[0]?.url, "https://example.test/merged");

  const retitled = entry("e", "before", {
    updated: "2026-01-03T00:00:00.000Z",
    noteUpdated: "2026-01-01T00:00:00.000Z",
    map: { ...snapshot.map, title: "kept title" },
    research: older,
  });
  const fields = editorAfterSave(retitled, snapshot, saved);
  assert.equal(fields.note, "stored note");
  assert.equal(fields.noteUpdated, "2026-01-02T00:00:00.000Z");
  assert.equal(fields.updated, "2026-01-03T00:00:00.000Z");
  assert.equal(fields.map.title, "kept title");
  assert.equal(fields.research?.description, "merged search");
  assert.equal(fields.references?.[0]?.url, "https://example.test/merged");

  const other = editorAfterSave(
    typed,
    snapshot,
    entry("other", "stored note", { research: merged }),
  );
  assert.equal(other, typed);
});

test("a title edit during a save takes the merged note and the next save keeps it", async () => {
  const snapshot = entry("gap", "editor note", {
    updated: "2026-01-01T00:00:00.000Z",
    noteUpdated: "2026-01-01T00:00:00.000Z",
  });
  await storeEntries([
    entry("gap", "merged note", {
      updated: "2026-01-02T00:00:00.000Z",
      noteUpdated: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  const [saved] = await storeEntries([snapshot]);
  assert.equal(saved?.note, "merged note");
  const during = entry("gap", "editor note", {
    updated: "2026-01-03T00:00:00.000Z",
    noteUpdated: "2026-01-01T00:00:00.000Z",
    map: { ...snapshot.map, title: "kept title" },
  });
  const editor = editorAfterSave(during, snapshot, saved!);
  assert.equal(editor.note, "merged note");
  assert.equal(editor.noteUpdated, "2026-01-02T00:00:00.000Z");
  assert.equal(editor.map.title, "kept title");
  // The next edit stamps a fresh noteUpdated. The text must already be the merged note.
  const retouched = {
    ...editor,
    updated: "2026-01-04T00:00:00.000Z",
    noteUpdated: "2026-01-04T00:00:00.000Z",
  };
  const [again] = await storeEntries([retouched]);
  assert.equal(again?.note, "merged note");
  const loaded = await loadNotebook();
  assert.equal(
    loaded.entries.find((item) => item.id === "gap")?.note,
    "merged note",
  );
});

test("a search keeps a newer stored note on the editor", async () => {
  await storeEntries([
    entry("ws", "old editor", {
      updated: "2026-01-01T00:00:00.000Z",
      noteUpdated: "2026-01-01T00:00:00.000Z",
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("ws", "typed ahead", {
        updated: "2026-01-02T00:00:00.000Z",
        noteUpdated: "2026-01-02T00:00:00.000Z",
      }),
    ),
  );
  const stored = await saveResearch("ws", research);
  assert.equal(stored?.note, "typed ahead");
  const editor = entry("ws", "old editor", {
    updated: "2026-01-03T00:00:00.000Z",
    noteUpdated: "2026-01-01T00:00:00.000Z",
    map: {
      title: "kept title",
      summary: "old editor",
      regions: [],
      quality: "",
      activity: "",
      duration: "",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  });
  const next = withStampedResearch(editor, "ws", stored!);
  assert.equal(next.note, "typed ahead");
  assert.equal(next.noteUpdated, stored?.noteUpdated);
  assert.equal(next.map.title, "kept title");
  assert.equal(
    next.research && "version" in next.research
      ? next.research.version
      : undefined,
    stored?.research && "version" in stored.research
      ? stored.research.version
      : undefined,
  );
  await saveDraft(draftOf(next));
  const loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.note, "typed ahead");
});

test("a second save keeps a reading merged onto a newer search", async () => {
  const versioned = {
    ...research,
    description: "versioned search",
    version: "2026-01-03T00:00:00.000Z",
    references: [
      {
        title: "Old knee",
        url: "https://example.test/old",
        publisher: "Example",
        checked: "2026-01-02T00:00:00.000Z",
      },
    ],
  };
  const extra = {
    title: "Related reading",
    url: "https://example.test/extra-reading",
    publisher: "Example",
    checked: "2026-01-02T00:00:00.000Z",
  };
  await storeEntries([
    entry("round", "saved later", {
      updated: "2026-01-03T00:00:00.000Z",
      research: versioned,
      references: versioned.references,
    }),
  ]);
  const [merged] = await storeEntries([
    entry("round", "saved later", {
      updated: "2026-01-02T00:00:00.000Z",
      noteUpdated: "2026-01-03T00:00:00.000Z",
      research: { ...research, description: "no version" },
      references: [...research.references, extra],
    }),
  ]);
  assert.equal(merged?.research?.description, "versioned search");
  assert.equal(
    merged?.research?.references?.some((item) => item.url === extra.url),
    true,
  );
  assert.equal(
    merged?.references?.some((item) => item.url === extra.url),
    true,
  );
  const topOnly = {
    ...merged!,
    research: {
      ...merged!.research!,
      references: merged!.research!.references.filter(
        (item) => item.url !== extra.url,
      ),
    },
  };
  assert.equal(
    entryReferences(topOnly).some((item) => item.url === extra.url),
    true,
  );
  const snapshot = { ...merged!, references: entryReferences(merged!) };
  const [again] = await storeEntries([snapshot]);
  assert.equal(
    again?.references?.some((item) => item.url === extra.url),
    true,
  );
  assert.equal(
    again?.research?.references?.some((item) => item.url === extra.url),
    true,
  );
  assert.match(
    stringifyNotebook([again!]),
    /https:\/\/example\.test\/extra-reading/,
  );
});

async function fieldEditThenSecondSaveKeepsMergedNote(
  id: string,
  base: ReturnType<typeof entry>,
) {
  assert.equal(base.noteUpdated, undefined);
  await storeEntries([
    {
      ...base,
      id,
      note: "merged note",
      updated: "2026-01-02T00:00:00.000Z",
    },
  ]);
  const snapshot = {
    ...base,
    id,
    note: "editor note",
    updated: "2026-01-01T00:00:00.000Z",
    map: { ...base.map, title: "editor note", summary: "editor note" },
  };
  const [saved] = await storeEntries([snapshot]);
  assert.equal(saved?.note, "merged note");
  const during = {
    ...snapshot,
    updated: "2026-01-03T00:00:00.000Z",
    map: { ...snapshot.map, title: "kept title" },
  };
  assert.equal(during.noteUpdated, undefined);
  const editor = editorAfterSave(during, snapshot, saved!);
  assert.equal(editor.note, "merged note");
  assert.equal(editor.map.title, "kept title");
  const [again] = await storeEntries([editor]);
  assert.equal(again?.note, "merged note");
  const loaded = await loadNotebook();
  assert.equal(
    loaded.entries.find((item) => item.id === id)?.note,
    "merged note",
  );
}

test("a field edit during save on a legacy row keeps the merged note", async () => {
  await fieldEditThenSecondSaveKeepsMergedNote(
    "legacy-row",
    entry("legacy-row", "editor note"),
  );
});

test("a field edit during save on a blankEntry keeps the merged note", async () => {
  const blank = blankEntry();
  assert.equal(blank.noteUpdated, undefined);
  await fieldEditThenSecondSaveKeepsMergedNote(blank.id, {
    ...blank,
    note: "editor note",
    map: { ...blank.map, title: "editor note", summary: "editor note" },
  });
});

test("a field edit during save on an imported entry keeps the merged note", async () => {
  const source = entry("imported-row", "editor note", {
    updated: "2026-01-01T00:00:00.000Z",
  });
  const [imported] = parseNotebook(stringifyNotebook([source]));
  assert.equal(imported.noteUpdated, undefined);
  assert.equal(imported.id, "imported-row");
  await fieldEditThenSecondSaveKeepsMergedNote(imported.id, {
    ...imported,
    map: { ...imported.map, title: "editor note", summary: "editor note" },
  });
});

test("exampleEntry has no noteUpdated, same as a legacy row", () => {
  const example = exampleEntry();
  assert.equal(example.noteUpdated, undefined);
});

test("a search copies a stored note onto an editor that has no noteUpdated after a title edit", async () => {
  await storeEntries([
    entry("ws-legacy", "old editor", {
      updated: "2026-01-01T00:00:00.000Z",
      noteUpdated: "2026-01-01T00:00:00.000Z",
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("ws-legacy", "typed ahead", {
        updated: "2026-01-02T00:00:00.000Z",
        noteUpdated: "2026-01-02T00:00:00.000Z",
      }),
    ),
  );
  const stored = await saveResearch("ws-legacy", research);
  assert.equal(stored?.note, "typed ahead");
  const editor = entry("ws-legacy", "old editor", {
    updated: "2026-01-03T00:00:00.000Z",
    map: {
      title: "kept title",
      summary: "old editor",
      regions: [],
      quality: "",
      activity: "",
      duration: "",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  });
  assert.equal(editor.noteUpdated, undefined);
  const next = withStampedResearch(editor, "ws-legacy", stored!);
  assert.equal(next.note, "typed ahead");
  assert.equal(next.noteUpdated, stored?.noteUpdated);
  assert.equal(next.map.title, "kept title");
  await saveDraft(draftOf(next));
  const loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.note, "typed ahead");
});

test("a save keeps a stamped note when the incoming row has no noteUpdated and a later updated", async () => {
  await storeEntries([
    entry("kl-legacy", "merged note", {
      updated: "2026-01-02T00:00:00.000Z",
      noteUpdated: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  const [row] = await storeEntries([
    entry("kl-legacy", "stale note", {
      updated: "2026-01-04T00:00:00.000Z",
    }),
  ]);
  assert.equal(row?.note, "merged note");
  assert.equal(row?.noteUpdated, "2026-01-02T00:00:00.000Z");
});

test("a search keeps a stamped note when the draft has no noteUpdated and a later updated", async () => {
  await storeEntries([
    entry("nn-legacy", "merged note", {
      updated: "2026-01-02T00:00:00.000Z",
      noteUpdated: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("nn-legacy", "stale note", {
        updated: "2026-01-04T00:00:00.000Z",
      }),
    ),
  );
  const after = await saveResearch("nn-legacy", research);
  assert.equal(after?.note, "merged note");
  assert.equal(after?.noteUpdated, "2026-01-02T00:00:00.000Z");
});

test("a save stamps noteUpdated on a legacy row", async () => {
  const row = entry("stamp-me", "a note");
  assert.equal(row.noteUpdated, undefined);
  const [saved] = await storeEntries([row]);
  assert.equal(typeof saved?.noteUpdated, "string");
  assert.ok((saved?.noteUpdated ?? "").length > 0);
  const loaded = await loadNotebook();
  assert.equal(
    typeof loaded.entries.find((item) => item.id === "stamp-me")?.noteUpdated,
    "string",
  );
  const created = await saveResearch("stamp-me", research);
  assert.equal(typeof created?.noteUpdated, "string");
});

// A row written before noteUpdated existed. storeEntries would stamp it,
// so put it in the committed store directly.
function seedLegacyRow(row: ReturnType<typeof entry>) {
  assert.equal("noteUpdated" in row, false);
  committed.entries.set(row.id, structuredClone(row));
}

test("a save of two rows with no noteUpdated keeps the stored note", async () => {
  seedLegacyRow(
    entry("tie-store", "newer stored note", {
      updated: "2026-06-01T00:00:00.000Z",
    }),
  );
  const [row] = await storeEntries([
    entry("tie-store", "stale incoming note", {
      updated: "2026-01-01T00:00:00.000Z",
    }),
  ]);
  assert.equal(row?.note, "newer stored note");
  assert.equal(row?.noteUpdated, "2026-06-01T00:00:00.000Z");
});

test("a save and a search agree on a pair of rows with no noteUpdated", async () => {
  const stored = entry("tie-both", "stored note", {
    updated: "2026-01-01T00:00:00.000Z",
  });
  const later = entry("tie-both", "editor note", {
    updated: "2026-01-05T00:00:00.000Z",
  });
  seedLegacyRow(stored);
  const [saved] = await storeEntries([later]);
  seedLegacyRow(stored);
  await saveDraft(draftOf(later));
  const searched = await saveResearch("tie-both", research);
  assert.equal(saved?.note, "stored note");
  assert.equal(searched?.note, saved?.note);
});

test("a search on a row with no noteUpdated does not replace a note typed just before", async () => {
  const legacy = entry("typed-first", "empty draft note", {
    updated: "2026-01-01T00:00:00.000Z",
  });
  seedLegacyRow(legacy);
  await saveDraft(draftOf(legacy));
  const typedAt = new Date(Date.now() - 5000).toISOString();
  const editor = {
    ...legacy,
    note: "typed in the editor",
    noteUpdated: typedAt,
    updated: typedAt,
  };
  const stored = await saveResearch("typed-first", research);
  assert.ok(
    (stored?.noteUpdated ?? "") <= typedAt,
    `search stamped the note ${stored?.noteUpdated}, after the typed note ${typedAt}`,
  );
  const next = withStampedResearch(editor, "typed-first", stored!);
  assert.equal(next.note, "typed in the editor");
  assert.equal(next.noteUpdated, typedAt);
  assert.equal(next.research?.version, stored?.research?.version);
});

const samplePoint = {
  id: "pin-1",
  region: "neck" as const,
  position: [0, 1, 0] as [number, number, number],
  structure: "skin",
};

const neckMap = (note: string, regions: string[] = []) => ({
  title: note || "Entry",
  summary: note,
  regions,
  quality: "",
  activity: "",
  duration: "",
  intensity: null,
  question: null,
  urgent: false,
  safety_message: null,
});

test("a kept stored note writes that note as map.summary", async () => {
  await storeEntries([
    entry("sum", "stored note", {
      noteUpdated: "2026-01-02T00:00:00.000Z",
      map: neckMap("stored note"),
    }),
  ]);
  const [row] = await storeEntries([
    entry("sum", "stale incoming", {
      noteUpdated: "2026-01-01T00:00:00.000Z",
      map: neckMap("stale incoming"),
    }),
  ]);
  assert.equal(row?.note, "stored note");
  assert.equal(row?.map.summary, "stored note");
  assert.equal(row?.research?.description, undefined);
});

test("a search copies map.summary from the note it keeps", async () => {
  await storeEntries([
    entry("sum-r", "stored note", {
      updated: "2026-01-04T00:00:00.000Z",
      noteUpdated: "2026-01-01T00:00:00.000Z",
      map: neckMap("stored note"),
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("sum-r", "typed note", {
        updated: "2026-01-02T00:00:00.000Z",
        noteUpdated: "2026-01-02T00:00:00.000Z",
        map: neckMap("typed note"),
      }),
    ),
  );
  const after = await saveResearch("sum-r", research);
  assert.equal(after?.note, "typed note");
  assert.equal(after?.map.summary, "typed note");
  // description is the text sent to the search, not the note.
  assert.equal(after?.research?.description, "stiff");
});

const offsetEarlier = "2026-10-31T10:00:00+10:00";
const utcLater = "2026-10-31T01:00:00.000Z";

test("storeEntries orders notes by instant, not lexical stamp text", async () => {
  await storeEntries([
    entry("tz", "earlier offset", {
      updated: offsetEarlier,
      noteUpdated: offsetEarlier,
    }),
  ]);
  const [row] = await storeEntries([
    entry("tz", "later utc", {
      updated: utcLater,
      noteUpdated: utcLater,
    }),
  ]);
  assert.equal(row?.note, "later utc");
  assert.equal(row?.noteUpdated, utcLater);
  assert.equal(row?.updated, utcLater);
});

test("storeEntries keeps the later instant when the offset stamp sorts after", async () => {
  await storeEntries([
    entry("tz-keep", "later utc", {
      updated: utcLater,
      noteUpdated: utcLater,
    }),
  ]);
  const [row] = await storeEntries([
    entry("tz-keep", "earlier offset", {
      updated: offsetEarlier,
      noteUpdated: offsetEarlier,
    }),
  ]);
  assert.equal(row?.note, "later utc");
  assert.equal(row?.noteUpdated, utcLater);
  assert.equal(row?.updated, utcLater);
});

test("saveResearch orders notes by instant, not lexical stamp text", async () => {
  await storeEntries([
    entry("tz-r", "later utc", {
      updated: utcLater,
      noteUpdated: utcLater,
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("tz-r", "earlier offset", {
        updated: offsetEarlier,
        noteUpdated: offsetEarlier,
      }),
    ),
  );
  const after = await saveResearch("tz-r", research);
  assert.equal(after?.note, "later utc");
  assert.equal(after?.noteUpdated, utcLater);
});

test("saveResearch keeps a later utc note when the draft offset stamp sorts after", async () => {
  await storeEntries([
    entry("tz-r2", "earlier offset", {
      updated: offsetEarlier,
      noteUpdated: offsetEarlier,
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("tz-r2", "later utc", {
        updated: utcLater,
        noteUpdated: utcLater,
      }),
    ),
  );
  const after = await saveResearch("tz-r2", research);
  assert.equal(after?.note, "later utc");
  assert.equal(after?.noteUpdated, utcLater);
});

test("a stale draft with no pins reloads the stored pin", async () => {
  const pinned = entry("pin-reload", "saved", {
    noteUpdated: "2026-01-02T00:00:00.000Z",
    pointsUpdated: "2026-01-02T00:00:00.000Z",
    points: [samplePoint],
    map: neckMap("saved", ["neck"]),
  });
  await storeEntries([pinned]);
  await saveDraft(
    draftOf(
      entry("pin-reload", "saved", {
        noteUpdated: "2026-01-02T00:00:00.000Z",
        points: [],
        map: neckMap("saved"),
      }),
    ),
  );
  const loaded = await loadNotebook();
  const open = loaded.draft?.entry;
  assert.equal(open?.points?.length, 1);
  assert.equal(open?.points?.[0]?.id, "pin-1");
  assert.equal(open?.map.regions.includes("neck"), true);

  const edited = {
    ...open!,
    note: "edited after reload",
    noteUpdated: "2026-01-03T00:00:00.000Z",
    updated: "2026-01-03T00:00:00.000Z",
    map: { ...open!.map, summary: "edited after reload" },
  };
  const [saved] = await storeEntries([edited]);
  assert.equal(saved?.note, "edited after reload");
  assert.equal(saved?.map.summary, "edited after reload");
  assert.equal(saved?.points?.length, 1);
  assert.equal(saved?.points?.[0]?.id, "pin-1");
});

test("a save with empty points does not drop a stored pin that has a newer stamp", async () => {
  await storeEntries([
    entry("pin-keep", "saved", {
      noteUpdated: "2026-01-02T00:00:00.000Z",
      pointsUpdated: "2026-01-02T00:00:00.000Z",
      points: [samplePoint],
      map: neckMap("saved", ["neck"]),
    }),
  ]);
  const [row] = await storeEntries([
    entry("pin-keep", "edited note", {
      noteUpdated: "2026-01-03T00:00:00.000Z",
      points: [],
      map: neckMap("edited note"),
    }),
  ]);
  assert.equal(row?.note, "edited note");
  assert.equal(row?.map.summary, "edited note");
  assert.equal(row?.points?.length, 1);
  assert.equal(row?.map.regions.includes("neck"), true);
});

test("an intentional pin removal with a newer pointsUpdated wins", async () => {
  await storeEntries([
    entry("pin-drop", "saved", {
      pointsUpdated: "2026-01-02T00:00:00.000Z",
      points: [samplePoint],
      map: neckMap("saved", ["neck"]),
    }),
  ]);
  const [row] = await storeEntries([
    entry("pin-drop", "saved", {
      pointsUpdated: "2026-01-03T00:00:00.000Z",
      points: [],
      map: neckMap("saved"),
    }),
  ]);
  assert.equal(row?.points?.length, 0);
  assert.deepEqual(row?.map.regions, []);
});

test("saveResearch keeps stored pins when the draft points are older", async () => {
  await storeEntries([
    entry("pin-sr", "saved", {
      updated: "2026-01-02T00:00:00.000Z",
      pointsUpdated: "2026-01-02T00:00:00.000Z",
      points: [samplePoint],
      map: neckMap("saved", ["neck"]),
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("pin-sr", "typed note", {
        updated: "2026-01-03T00:00:00.000Z",
        noteUpdated: "2026-01-03T00:00:00.000Z",
        points: [],
        map: neckMap("typed note"),
      }),
    ),
  );
  const after = await saveResearch("pin-sr", research);
  assert.equal(after?.note, "typed note");
  assert.equal(after?.map.summary, "typed note");
  assert.equal(after?.points?.length, 1);
  assert.equal(after?.research?.description, "stiff");
});

test("parseNotebook keeps pointsUpdated on a round trip", () => {
  const source = entry("imp-pts", "note", {
    points: [samplePoint],
    pointsUpdated: "2026-01-02T00:00:00.000Z",
    map: neckMap("note", ["neck"]),
  });
  const parsed = parseNotebook(stringifyNotebook([source]))[0];
  assert.equal(parsed.pointsUpdated, "2026-01-02T00:00:00.000Z");
  assert.equal(parsed.points?.length, 1);
});

test("journal export uses the open editor when it is the same id", async () => {
  const { entryForExport } = await import("../src/export.ts");
  const saved = entry("ex", "saved");
  const open = entry("ex", "typed in editor");
  assert.equal(entryForExport(saved, open).note, "typed in editor");
  assert.equal(entryForExport(saved, undefined).note, "saved");
  assert.equal(entryForExport(saved, entry("other", "nope")).note, "saved");
});
