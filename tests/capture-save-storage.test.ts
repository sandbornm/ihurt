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
  withMapDetails,
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
  // The title edit stamps its field, as Notebook context() does.
  const editor = entry("ws", "old editor", {
    updated: "2026-01-03T00:00:00.000Z",
    noteUpdated: "2026-01-01T00:00:00.000Z",
    mapUpdated: { title: "2026-01-03T00:00:00.000Z" },
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
  // The title edit stamps its field, as Notebook context() does.
  const editor = entry("ws-legacy", "old editor", {
    updated: "2026-01-03T00:00:00.000Z",
    mapUpdated: { title: "2026-01-03T00:00:00.000Z" },
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

test("a legacy draft with no pin stamps keeps its newer pins on load", async () => {
  // Rows and drafts written before pointsUpdated existed. Keep the old rule:
  // the draft's pins win.
  await storeEntries([
    entry("pin-legacy", "saved", {
      updated: "2026-01-02T00:00:00.000Z",
      points: [],
      map: neckMap("saved"),
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("pin-legacy", "saved", {
        updated: "2026-01-03T00:00:00.000Z",
        points: [samplePoint],
        map: neckMap("saved", ["neck"]),
      }),
    ),
  );
  const loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.points?.length, 1);
  assert.equal(loaded.draft?.entry.map.regions.includes("neck"), true);
});

test("saveResearch keeps stored pins on a tie when neither side has a pin stamp", async () => {
  // A search never overwrites what is stored on a tie. A draft only gets
  // past this once loadNotebook has stamped it (see the load-then-search test).
  await storeEntries([
    entry("pin-legacy-sr", "saved", {
      updated: "2026-01-02T00:00:00.000Z",
      points: [samplePoint],
      map: neckMap("saved", ["neck"]),
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("pin-legacy-sr", "saved", {
        updated: "2026-01-03T00:00:00.000Z",
        points: [],
        map: neckMap("saved"),
      }),
    ),
  );
  const after = await saveResearch("pin-legacy-sr", research);
  assert.equal(after?.points?.length, 1);
  assert.equal(after?.map.regions.includes("neck"), true);
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

// Rows and drafts from before noteUpdated/pointsUpdated. storeEntries stamps
// noteUpdated, so the stored legacy row goes straight into the fake store.
const secondPoint = { ...samplePoint, id: "pin-2" };
const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";
function putLegacyRow(row: ReturnType<typeof entry>) {
  committed.entries.set(row.id, structuredClone(row));
}

test("a legacy draft that adds to the stored note keeps it on load", async () => {
  putLegacyRow(entry("lg-add", "ache", { updated: T2 }));
  await saveDraft(
    draftOf(entry("lg-add", "ache, worse at night", { updated: T1 })),
  );
  const loaded = await loadNotebook();
  assert.equal(loaded.draft?.entry.note, "ache, worse at night");
  assert.equal(loaded.draft?.entry.map.summary, "ache, worse at night");
});

test("a legacy tie with different notes keeps the stored note", async () => {
  putLegacyRow(entry("lg-tie", "stored words", { updated: T1 }));
  const [saved] = await storeEntries([
    entry("lg-tie", "other words", { updated: T1 }),
  ]);
  assert.equal(saved?.note, "stored words");
});

test("saveResearch keeps the stored note on a legacy tie", async () => {
  putLegacyRow(entry("lg-sr", "ache", { updated: T1 }));
  await saveDraft(draftOf(entry("lg-sr", "ache, typed more", { updated: T2 })));
  const after = await saveResearch("lg-sr", research);
  assert.equal(after?.note, "ache");
  assert.equal(after?.map.summary, "ache");
});

test("legacy draft-only pins count as an edit even with an older row time", async () => {
  putLegacyRow(
    entry("lg-pins", "n", {
      updated: T2,
      points: [samplePoint],
      map: neckMap("n", ["neck"]),
    }),
  );
  await saveDraft(
    draftOf(
      entry("lg-pins", "n", {
        updated: T1,
        points: [samplePoint, secondPoint],
        map: neckMap("n", ["neck"]),
      }),
    ),
  );
  const loaded = await loadNotebook();
  assert.deepEqual(
    loaded.draft?.entry.points?.map((p) => p.id),
    ["pin-1", "pin-2"],
  );
});

test("an older legacy save that lacks a stored pin keeps the stored pins", async () => {
  putLegacyRow(
    entry("lg-older", "n", {
      updated: T2,
      points: [samplePoint, secondPoint],
      map: neckMap("n", ["neck"]),
    }),
  );
  const [saved] = await storeEntries([
    entry("lg-older", "n", {
      updated: T1,
      points: [samplePoint],
      map: neckMap("n", ["neck"]),
    }),
  ]);
  assert.equal(saved?.points?.length, 2);
});

test("editorAfterSave copies stored pins back when the note changed during the save", () => {
  const snapshot = entry("eas-pins", "before", { updated: T1, points: [] });
  const editor = {
    ...snapshot,
    note: "typed during save",
    noteUpdated: T2,
    updated: T2,
  };
  const saved = entry("eas-pins", "before", {
    updated: T1,
    pointsUpdated: T1,
    points: [samplePoint],
    map: neckMap("before", ["neck"]),
  });
  const next = editorAfterSave(editor, snapshot, saved);
  assert.equal(next.note, "typed during save");
  assert.deepEqual(
    next.points?.map((p) => p.id),
    ["pin-1"],
  );
  assert.deepEqual(next.map.regions, ["neck"]);
  assert.equal(next.pointsUpdated, T1);
});

test("editorAfterSave copies stored pins back after a field edit during the save", () => {
  const snapshot = entry("eas-field", "n", { updated: T1, points: [] });
  const editor = {
    ...snapshot,
    updated: T2,
    map: { ...snapshot.map, title: "retitled" },
  };
  const saved = entry("eas-field", "n", {
    updated: T1,
    pointsUpdated: T1,
    points: [samplePoint],
    map: neckMap("n", ["neck"]),
  });
  const next = editorAfterSave(editor, snapshot, saved);
  assert.equal(next.map.title, "retitled");
  assert.equal(next.points?.length, 1);
  assert.deepEqual(next.map.regions, ["neck"]);
});

test("editorAfterSave keeps the merged pins plus a pin added during the save", () => {
  const snapshot = entry("eas-own", "n", { updated: T1, points: [] });
  const editor = {
    ...snapshot,
    updated: T2,
    pointsUpdated: T2,
    points: [secondPoint],
    map: neckMap("n", ["neck"]),
  };
  const saved = entry("eas-own", "n", {
    updated: T1,
    pointsUpdated: T1,
    points: [samplePoint],
    map: neckMap("n", ["neck"]),
  });
  const next = editorAfterSave(editor, snapshot, saved);
  assert.deepEqual(
    next.points?.map((p) => p.id),
    ["pin-1", "pin-2"],
  );
  assert.deepEqual(next.map.regions, ["neck"]);
  assert.equal(next.pointsUpdated, T2);
});

test("withStampedResearch copies newer stored pins into the editor", () => {
  const editor = entry("ws-pins", "n", { updated: T1, points: [] });
  const stored = entry("ws-pins", "n", {
    updated: T2,
    pointsUpdated: T1,
    points: [samplePoint],
    research: { ...research, version: T2 },
    map: neckMap("n", ["neck"]),
  });
  const next = withStampedResearch(editor, "ws-pins", stored);
  assert.equal(next.points?.length, 1);
  assert.deepEqual(next.map.regions, ["neck"]);
  assert.equal(next.pointsUpdated, T1);
});

test("withStampedResearch keeps editor pins that are newer than the row", () => {
  const editor = entry("ws-own", "n", {
    updated: T2,
    pointsUpdated: T2,
    points: [secondPoint],
    map: neckMap("n", ["neck"]),
  });
  const stored = entry("ws-own", "n", {
    updated: T2,
    pointsUpdated: T1,
    points: [samplePoint],
    research: { ...research, version: T2 },
    map: neckMap("n", ["neck"]),
  });
  const next = withStampedResearch(editor, "ws-own", stored);
  assert.deepEqual(
    next.points?.map((p) => p.id),
    ["pin-2"],
  );
});

// Load path: a draft exists only because of unsaved typing, so on a tie with
// no stamps on either side the draft wins, whatever the edit.
async function loadLegacy(
  id: string,
  stored: Record<string, unknown>,
  draft: Record<string, unknown>,
) {
  putLegacyRow(
    entry(id, (stored.note as string) ?? "n", { updated: T2, ...stored }),
  );
  await saveDraft(
    draftOf(
      entry(id, (draft.note as string) ?? "n", { updated: T1, ...draft }),
    ),
  );
  const loaded = await loadNotebook();
  return loaded.draft?.entry;
}
const pinAt = (id: string, extra: Record<string, unknown> = {}) => ({
  ...samplePoint,
  id,
  ...extra,
});

test("load keeps a legacy draft's mid-note edit", async () => {
  const open = await loadLegacy(
    "ld-mid",
    { note: "neck ache at night" },
    { note: "neck pain at night" },
  );
  assert.equal(open?.note, "neck pain at night");
  assert.equal(open?.map.summary, "neck pain at night");
});

test("load keeps a legacy draft's deletion", async () => {
  const open = await loadLegacy(
    "ld-del",
    { note: "ache, much worse at night" },
    { note: "ache, worse at night" },
  );
  assert.equal(open?.note, "ache, worse at night");
});

test("load keeps a shorter legacy draft", async () => {
  const open = await loadLegacy(
    "ld-short",
    { note: "ache, worse at night" },
    { note: "ache" },
  );
  assert.equal(open?.note, "ache");
});

test("load keeps a legacy draft's moved pin", async () => {
  const open = await loadLegacy(
    "ld-move",
    { points: [pinAt("pin-1")], map: neckMap("n", ["neck"]) },
    {
      points: [pinAt("pin-1", { position: [0, 2, 0] })],
      map: neckMap("n", ["neck"]),
    },
  );
  assert.deepEqual(open?.points?.[0]?.position, [0, 2, 0]);
});

test("load keeps a legacy draft's changed pin comment", async () => {
  const open = await loadLegacy(
    "ld-comment",
    {
      points: [pinAt("pin-1", { comment: "dull" })],
      map: neckMap("n", ["neck"]),
    },
    {
      points: [pinAt("pin-1", { comment: "sharp" })],
      map: neckMap("n", ["neck"]),
    },
  );
  assert.equal(open?.points?.[0]?.comment, "sharp");
});

test("load keeps a legacy draft's deleted pin", async () => {
  const open = await loadLegacy(
    "ld-unpin",
    {
      points: [pinAt("pin-1"), pinAt("pin-2")],
      map: neckMap("n", ["neck"]),
    },
    { points: [pinAt("pin-1")], map: neckMap("n", ["neck"]) },
  );
  assert.deepEqual(
    open?.points?.map((p) => p.id),
    ["pin-1"],
  );
});

test("a search after load keeps the legacy draft's edits", async () => {
  // loadNotebook stamps the draft that won, the autosave writes it, and the
  // search's stored-wins tie no longer applies.
  const open = await loadLegacy(
    "ld-search",
    {
      note: "ache, much worse at night",
      points: [pinAt("pin-1"), pinAt("pin-2")],
      map: neckMap("ache, much worse at night", ["neck"]),
    },
    {
      note: "ache at night",
      points: [pinAt("pin-1", { position: [0, 2, 0] })],
      map: neckMap("ache at night", ["neck"]),
    },
  );
  assert.ok(open);
  await saveDraft(draftOf(open as ReturnType<typeof entry>));
  const after = await saveResearch("ld-search", research);
  assert.equal(after?.note, "ache at night");
  assert.deepEqual(
    after?.points?.map((p) => [p.id, p.position[1]]),
    [["pin-1", 2]],
  );
  const [saved] = await storeEntries([open as ReturnType<typeof entry>]);
  assert.equal(saved?.note, "ache at night");
  assert.equal(saved?.points?.length, 1);
});

test("a search right after load, before any autosave, keeps the legacy draft", async () => {
  // The autosave runs about 280 ms after hydration. A search inside that
  // window must still see the draft load took, not the old stored row.
  const open = await loadLegacy(
    "ld-race",
    {
      note: "ache, much worse at night",
      points: [pinAt("pin-1"), pinAt("pin-2")],
      map: neckMap("ache, much worse at night", ["neck"]),
    },
    {
      note: "ache at night",
      points: [pinAt("pin-1", { position: [0, 2, 0] })],
      map: neckMap("ache at night", ["neck"]),
    },
  );
  assert.equal(open?.note, "ache at night");
  const after = await saveResearch("ld-race", research);
  assert.equal(after?.note, "ache at night");
  assert.equal(after?.map.summary, "ache at night");
  assert.deepEqual(
    after?.points?.map((p) => [p.id, p.position[1]]),
    [["pin-1", 2]],
  );
  const reloaded = await loadNotebook();
  assert.equal(reloaded.draft?.entry.note, "ache at night");
  assert.equal(reloaded.draft?.entry.points?.length, 1);
  const row = reloaded.entries.find((e) => e.id === "ld-race");
  assert.equal(row?.note, "ache at night");
  assert.equal(row?.points?.length, 1);
});

test("load writes the stamped legacy draft before it resolves", async () => {
  const open = await loadLegacy(
    "ld-persist",
    { note: "ache", points: [pinAt("pin-1")], map: neckMap("ache", ["neck"]) },
    { note: "ache, typed", points: [], map: neckMap("ache, typed", []) },
  );
  const stored = committed.settings.get("draft") as {
    entry: ReturnType<typeof entry>;
  };
  assert.equal(stored.entry.note, "ache, typed");
  assert.deepEqual(stored.entry.points, []);
  assert.equal(typeof stored.entry.noteUpdated, "string");
  assert.equal(typeof stored.entry.pointsUpdated, "string");
  assert.equal(stored.entry.noteUpdated, open?.noteUpdated);
  assert.equal(stored.entry.pointsUpdated, open?.pointsUpdated);
});

test("load leaves a draft with no stored row as it is", async () => {
  // Guard: only a draft that load reconciled with a stored row is rewritten.
  await saveDraft(draftOf(entry("ld-new", "fresh", { updated: T1 })));
  const loaded = await loadNotebook();
  const stored = committed.settings.get("draft") as {
    entry: ReturnType<typeof entry>;
  };
  assert.equal(stored.entry.noteUpdated, undefined);
  assert.equal(loaded.draft?.entry.noteUpdated, undefined);
});

test("saveResearch merges against the open editor, not only the stored row", async () => {
  // The stored draft is still the unstamped legacy copy, but the editor holds
  // the stamped draft that load took.
  putLegacyRow(entry("live", "ache", { updated: T2 }));
  await saveDraft(draftOf(entry("live", "ache, typed", { updated: T1 })));
  const T3 = "2026-01-04T00:00:00.000Z";
  const editor = entry("live", "ache, typed more", {
    updated: T3,
    noteUpdated: T3,
    pointsUpdated: T3,
    points: [],
    map: neckMap("ache, typed more", []),
  });
  const after = await saveResearch("live", research, editor);
  assert.equal(after?.note, "ache, typed more");
  assert.equal(after?.noteUpdated, T3);
  assert.deepEqual(after?.points, []);
  const reloaded = await loadNotebook();
  assert.equal(
    reloaded.entries.find((e) => e.id === "live")?.note,
    "ache, typed more",
  );
});

test("a search in an older tab keeps the newer draft another tab saved", async () => {
  // Tab A and tab B have the same entry open. Tab B autosaved a newer note
  // and pin. Tab A's research lands with tab A's older editor.
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("two-tab", "stored", {
      updated: T1,
      noteUpdated: T1,
      pointsUpdated: T1,
      points: [pinAt("pin-1")],
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("two-tab", "tab B, newer", {
        updated: T3,
        noteUpdated: T3,
        pointsUpdated: T3,
        points: [pinAt("pin-1"), pinAt("pin-2")],
        map: neckMap("tab B, newer", ["neck"]),
      }),
    ),
  );
  const tabA = entry("two-tab", "tab A, older", {
    updated: T2,
    noteUpdated: T2,
    pointsUpdated: T2,
    points: [pinAt("pin-1")],
    map: neckMap("tab A, older", ["neck"]),
  });
  const after = await saveResearch("two-tab", research, tabA);
  assert.equal(after?.note, "tab B, newer");
  assert.equal(after?.noteUpdated, T3);
  assert.deepEqual(
    after?.points?.map((p) => p.id),
    ["pin-1", "pin-2"],
  );
  const reloaded = await loadNotebook();
  assert.equal(reloaded.draft?.entry.note, "tab B, newer");
  assert.equal(reloaded.draft?.entry.points?.length, 2);
  const row = reloaded.entries.find((e) => e.id === "two-tab");
  assert.equal(row?.note, "tab B, newer");
  assert.equal(row?.points?.length, 2);
});

test("a search takes each field from whichever of editor and saved draft is newer", async () => {
  // The open editor has the newer note, the other tab's saved draft has the
  // newer pins. Neither is dropped.
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("mixed", "stored", {
      updated: T1,
      noteUpdated: T1,
      pointsUpdated: T1,
      points: [],
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("mixed", "draft note", {
        updated: T2,
        noteUpdated: T1,
        pointsUpdated: T3,
        points: [pinAt("pin-9")],
      }),
    ),
  );
  const editor = entry("mixed", "editor note", {
    updated: T3,
    noteUpdated: T3,
    pointsUpdated: T2,
    points: [],
  });
  const after = await saveResearch("mixed", research, editor);
  assert.equal(after?.note, "editor note");
  assert.deepEqual(
    after?.points?.map((p) => p.id),
    ["pin-9"],
  );
});

const link = (url: string) => ({
  title: url,
  url: `https://example.test/${url}`,
  publisher: "Example",
  checked: T1,
});
const urls = (row: { references?: { url: string }[] } | undefined) =>
  (row?.references ?? []).map((r) => r.url).sort();
const withContext = (note: string, context: Record<string, unknown>) => ({
  ...entry("x", note).map,
  ...context,
});

test("a newer draft from another tab keeps the stored row's readings, answers and map details", async () => {
  // Grok's repro on dc337c7: the stored row holds a link, an answer and a
  // quality. The older editor holds another link and quality. The other tab's
  // draft is newest by updated, with a newer note and none of those.
  const T3 = "2026-01-04T00:00:00.000Z";
  const T4 = "2026-01-05T00:00:00.000Z";
  await storeEntries([
    entry("ctx-stored", "stored", {
      updated: T3,
      noteUpdated: T1,
      references: [link("stored")],
      answers: [{ key: "onset", text: "after a run" }],
      map: withContext("stored", { title: "Stored title", quality: "sharp" }),
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("ctx-stored", "draft, newest", {
        updated: T4,
        noteUpdated: T4,
        references: [],
        answers: [],
        map: withContext("draft, newest", { title: "Draft title" }),
      }),
    ),
  );
  const editor = entry("ctx-stored", "editor, older", {
    updated: T2,
    noteUpdated: T2,
    references: [link("editor")],
    map: withContext("editor, older", { quality: "dull" }),
  });
  const after = await saveResearch("ctx-stored", research, editor);
  for (const row of [
    after,
    (await loadNotebook()).entries.find((e) => e.id === "ctx-stored"),
    (await loadNotebook()).draft?.entry,
  ]) {
    assert.equal(row?.note, "draft, newest");
    assert.deepEqual(urls(row), [
      "https://example.test/editor",
      "https://example.test/knee",
      "https://example.test/stored",
    ]);
    assert.deepEqual(row?.answers, [{ key: "onset", text: "after a run" }]);
    // The newest record's own value wins; a blank there is filled from the
    // next newest record (stored at T3 before the editor at T2).
    assert.equal(row?.map.title, "Draft title");
    assert.equal(row?.map.quality, "sharp");
  }
});

test("a newer draft from another tab keeps the open editor's readings, answers and map details", async () => {
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("ctx-editor", "stored", { updated: T1, noteUpdated: T1 }),
  ]);
  await saveDraft(
    draftOf(
      entry("ctx-editor", "draft, newest", {
        updated: T3,
        noteUpdated: T3,
        map: withContext("draft, newest", { title: "" }),
      }),
    ),
  );
  const editor = entry("ctx-editor", "editor, older", {
    updated: T2,
    noteUpdated: T2,
    references: [link("editor")],
    answers: [{ key: "onset", text: "lifting" }],
    map: withContext("editor, older", {
      title: "Lifting",
      quality: "burning",
      activity: "lifting",
      duration: "2 days",
      intensity: 6,
    }),
  });
  const after = await saveResearch("ctx-editor", research, editor);
  const row = (await loadNotebook()).entries.find((e) => e.id === "ctx-editor");
  for (const r of [after, row]) {
    assert.equal(r?.note, "draft, newest");
    assert.deepEqual(urls(r), [
      "https://example.test/editor",
      "https://example.test/knee",
    ]);
    assert.deepEqual(r?.answers, [{ key: "onset", text: "lifting" }]);
    assert.equal(r?.map.title, "Lifting");
    assert.equal(r?.map.quality, "burning");
    assert.equal(r?.map.activity, "lifting");
    assert.equal(r?.map.duration, "2 days");
    assert.equal(r?.map.intensity, 6);
  }
});

test("a search keeps answers by question from every record, newest first", async () => {
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("answers", "stored", {
      updated: T1,
      answers: [
        { key: "onset", text: "stored onset" },
        { key: "better", text: "rest" },
      ],
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("answers", "draft", {
        updated: T3,
        answers: [{ key: "onset", text: "draft onset" }],
      }),
    ),
  );
  const editor = entry("answers", "editor", {
    updated: T2,
    answers: [{ key: "worse", text: "stairs" }],
  });
  const after = await saveResearch("answers", research, editor);
  assert.deepEqual(after?.answers, [
    { key: "onset", text: "draft onset" },
    { key: "worse", text: "stairs" },
    { key: "better", text: "rest" },
  ]);
});

test("an editor and saved draft with equal stamps keep the saved draft, and blanks fill", async () => {
  await storeEntries([
    entry("equal", "stored", {
      updated: T1,
      noteUpdated: T1,
      pointsUpdated: T1,
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("equal", "draft note", {
        updated: T2,
        noteUpdated: T2,
        pointsUpdated: T2,
        points: [pinAt("pin-d")],
      }),
    ),
  );
  const editor = entry("equal", "editor note", {
    updated: T2,
    noteUpdated: T2,
    pointsUpdated: T2,
    points: [pinAt("pin-e")],
    references: [link("editor")],
    map: withContext("editor note", { quality: "dull" }),
  });
  const after = await saveResearch("equal", research, editor);
  assert.equal(after?.note, "draft note");
  assert.deepEqual(
    after?.points?.map((p) => p.id),
    ["pin-d"],
  );
  assert.equal(after?.map.quality, "dull");
  assert.deepEqual(urls(after), [
    "https://example.test/editor",
    "https://example.test/knee",
  ]);
});

test("a map detail cleared in the newest record stays cleared after a search and reload", async () => {
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("cleared", "stored", {
      updated: T1,
      map: withContext("stored", {
        quality: "sharp",
        safety_message: "See a doctor",
      }),
      mapUpdated: { quality: T1, safety_message: T1 },
    }),
  ]);
  // The other tab cleared both details. The older editor still shows values.
  await saveDraft(
    draftOf(
      entry("cleared", "draft", {
        updated: T3,
        map: withContext("draft", { quality: "", safety_message: null }),
        mapUpdated: { quality: T3, safety_message: T3 },
      }),
    ),
  );
  const editor = entry("cleared", "editor", {
    updated: T2,
    map: withContext("editor", { quality: "dull", safety_message: "Call" }),
  });
  const after = await saveResearch("cleared", research, editor);
  const data = await loadNotebook();
  const row = data.entries.find((e) => e.id === "cleared");
  for (const r of [after, row, data.draft?.entry]) {
    assert.equal(r?.map.quality, "");
    assert.equal(r?.map.safety_message, null);
    assert.equal(r?.mapUpdated?.quality, T3);
    assert.equal(r?.mapUpdated?.safety_message, T3);
  }
});

test("an editor's cleared detail beats an older stamped value on a newer draft", async () => {
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("clear-editor", "stored", {
      updated: T1,
      map: withContext("stored", { quality: "sharp" }),
      mapUpdated: { quality: T1 },
    }),
  ]);
  // The draft is newest by updated (a note edit) but its quality is from T1.
  await saveDraft(
    draftOf(
      entry("clear-editor", "draft", {
        updated: T3,
        noteUpdated: T3,
        map: withContext("draft", { quality: "sharp" }),
        mapUpdated: { quality: T1 },
      }),
    ),
  );
  const editor = entry("clear-editor", "editor", {
    updated: T2,
    map: withContext("editor", { quality: "" }),
    mapUpdated: { quality: T2 },
  });
  const after = await saveResearch("clear-editor", research, editor);
  const row = (await loadNotebook()).entries.find(
    (e) => e.id === "clear-editor",
  );
  for (const r of [after, row]) {
    assert.equal(r?.note, "draft");
    assert.equal(r?.map.quality, "");
    assert.equal(r?.mapUpdated?.quality, T2);
  }
});

test("a legacy unstamped blank is still filled next to a stamped clear", async () => {
  const T3 = "2026-01-04T00:00:00.000Z";
  putLegacyRow(
    entry("legacy-fill", "stored", {
      updated: T1,
      map: withContext("stored", {
        title: "Knee",
        quality: "sharp",
        duration: "a week",
      }),
    }),
  );
  await saveDraft(
    draftOf(
      entry("legacy-fill", "draft", {
        updated: T3,
        map: withContext("draft", { title: "", quality: "", duration: "" }),
        mapUpdated: { quality: T3 },
      }),
    ),
  );
  const after = await saveResearch("legacy-fill", research);
  const row = (await loadNotebook()).entries.find(
    (e) => e.id === "legacy-fill",
  );
  for (const r of [after, row]) {
    // No record stamps title or duration, so the stored values fill in.
    assert.equal(r?.map.title, "Knee");
    assert.equal(r?.map.duration, "a week");
    // quality was cleared with a stamp, so it stays cleared.
    assert.equal(r?.map.quality, "");
    assert.deepEqual(r?.mapUpdated, { quality: T3 });
  }
});

test("a search, the editor update and the next autosave and save keep every merged field", async () => {
  // Grok's repro on c8b260d: withStampedResearch handed the editor only the
  // note and research, so the autosave wrote the editor's older readings,
  // answers and map details back.
  const T3 = "2026-01-04T00:00:00.000Z";
  await storeEntries([
    entry("handback", "stored", {
      updated: T1,
      noteUpdated: T1,
      pointsUpdated: T1,
      references: [link("stored")],
      answers: [{ key: "onset", text: "stored onset" }],
      map: withContext("stored", { title: "Knee", quality: "sharp" }),
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("handback", "draft", {
        updated: T3,
        noteUpdated: T3,
        pointsUpdated: T3,
        points: [pinAt("pin-d")],
        answers: [{ key: "better", text: "rest" }],
        map: withContext("draft", { title: "", safety_message: null }),
        mapUpdated: { safety_message: T3 },
      }),
    ),
  );
  const editor = entry("handback", "editor", {
    updated: T2,
    noteUpdated: T2,
    pointsUpdated: T2,
    points: [pinAt("pin-e")],
    references: [link("editor")],
    answers: [{ key: "worse", text: "stairs" }],
    map: withContext("editor", {
      title: "",
      duration: "2 days",
      safety_message: "Call",
    }),
  });
  const saved = await saveResearch("handback", research, editor);
  const next = withStampedResearch(editor, "handback", saved!);
  await saveDraft(draftOf(next));
  await storeEntries([next]);
  const data = await loadNotebook();
  const row = data.entries.find((e) => e.id === "handback");
  for (const r of [next, data.draft?.entry, row]) {
    assert.equal(r?.note, "draft");
    assert.equal(r?.map.summary, "draft");
    assert.deepEqual(
      r?.points?.map((p) => p.id),
      ["pin-d"],
    );
    assert.deepEqual(urls(r), [
      "https://example.test/editor",
      "https://example.test/knee",
      "https://example.test/stored",
    ]);
    assert.deepEqual(r?.answers.map((a) => a.key).sort(), [
      "better",
      "onset",
      "worse",
    ]);
    assert.equal(r?.map.title, "Knee");
    assert.equal(r?.map.quality, "sharp");
    assert.equal(r?.map.duration, "2 days");
    assert.equal(r?.map.safety_message, null);
    assert.equal(r?.mapUpdated?.safety_message, T3);
    assert.equal(r?.research?.description, research.description);
  }
});

test("a removed AI note stays removed after a search, autosave, save and reload", async () => {
  // Grok's repro on 1af0a35: the search took the first ranked record with an
  // AI note, so a removal came back on the row, the editor and the draft.
  const aiNote = {
    provider: "demo",
    created: T1,
    based_on: "x",
    map: withContext("ai", {}),
    answers: [],
  };
  await storeEntries([
    entry("ai-gone", "knee", { updated: T1, noteUpdated: T1, ai: aiNote }),
  ]);
  const editor = entry("ai-gone", "knee", {
    updated: T2,
    noteUpdated: T1,
    aiUpdated: T2,
  });
  await saveDraft(draftOf(editor));
  const saved = await saveResearch("ai-gone", research, editor);
  assert.equal(saved?.ai, undefined);
  const next = withStampedResearch(editor, "ai-gone", saved!, editor);
  await saveDraft(draftOf(next));
  await storeEntries([next]);
  const data = await loadNotebook();
  const row = data.entries.find((e) => e.id === "ai-gone");
  for (const r of [saved, next, data.draft?.entry, row]) {
    assert.equal(r?.ai, undefined);
    assert.equal(r?.aiUpdated, T2);
  }
  // An older tab's save that still has the note does not bring it back.
  await storeEntries([
    entry("ai-gone", "knee", { updated: T2, noteUpdated: T1, ai: aiNote }),
  ]);
  const again = await loadNotebook();
  assert.equal(again.entries.find((e) => e.id === "ai-gone")?.ai, undefined);
});

test("a newer AI note beats an older removal", async () => {
  const aiNote = {
    provider: "fresh",
    created: T2,
    based_on: "x",
    map: withContext("ai", {}),
    answers: [],
  };
  await storeEntries([
    entry("ai-back", "knee", { updated: T1, noteUpdated: T1, aiUpdated: T1 }),
  ]);
  const editor = entry("ai-back", "knee", {
    updated: T2,
    noteUpdated: T1,
    ai: aiNote,
    aiUpdated: T2,
  });
  const saved = await saveResearch("ai-back", research, editor);
  assert.equal(saved?.ai?.provider, "fresh");
  const next = withStampedResearch(editor, "ai-back", saved!, editor);
  assert.equal(next.ai?.provider, "fresh");
});

test("a cleared detail stays cleared when an older draft with the value is loaded later", async () => {
  // Grok's repro on 1af0a35: loadNotebook and storeEntries took the draft's
  // unstamped value over the row's stamped clear and dropped the stamp.
  await storeEntries([
    entry("late", "knee", {
      updated: T2,
      noteUpdated: T1,
      map: withContext("knee", { quality: "" }),
      mapUpdated: { quality: T2 },
    }),
  ]);
  await saveDraft(
    draftOf(
      entry("late", "newer note", {
        updated: "2026-01-05T00:00:00.000Z",
        noteUpdated: "2026-01-05T00:00:00.000Z",
        map: withContext("newer note", { quality: "dull" }),
      }),
    ),
  );
  const data = await loadNotebook();
  assert.equal(data.draft?.entry.note, "newer note");
  assert.equal(data.draft?.entry.map.quality, "");
  assert.equal(data.draft?.entry.mapUpdated?.quality, T2);
  await storeEntries([
    entry("late", "newer note", {
      updated: "2026-01-05T00:00:00.000Z",
      noteUpdated: "2026-01-05T00:00:00.000Z",
      map: withContext("newer note", { quality: "dull" }),
    }),
  ]);
  const after = await loadNotebook();
  const row = after.entries.find((e) => e.id === "late");
  assert.equal(row?.note, "newer note");
  assert.equal(row?.map.quality, "");
  assert.equal(row?.mapUpdated?.quality, T2);
});

test("a newer stamped value still replaces a stamped clear on save", async () => {
  await storeEntries([
    entry("late2", "knee", {
      updated: T1,
      map: withContext("knee", { quality: "" }),
      mapUpdated: { quality: T1 },
    }),
  ]);
  await storeEntries([
    entry("late2", "knee", {
      updated: T2,
      map: withContext("knee", { quality: "dull" }),
      mapUpdated: { quality: T2 },
    }),
  ]);
  const data = await loadNotebook();
  assert.equal(data.entries.find((e) => e.id === "late2")?.map.quality, "dull");
});

test("typing just after a search saves does not let the editor override merged fields", async () => {
  // Grok's repro on 1af0a35: a keystroke after saveResearch read now made the
  // editor newest by updated, so its title, answers and summary won.
  await saveDraft(
    draftOf(
      entry("typed", "draft note", {
        updated: T2,
        noteUpdated: T2,
        answers: [{ key: "onset", text: "draft onset" }],
        map: withContext("draft note", { title: "Draft title", quality: "" }),
        mapUpdated: { quality: T2 },
      }),
    ),
  );
  await storeEntries([
    entry("typed", "stored", { updated: T1, noteUpdated: T1 }),
  ]);
  const searched = entry("typed", "editor", {
    updated: T1,
    noteUpdated: T1,
    answers: [{ key: "onset", text: "editor onset" }],
    map: withContext("editor", { title: "Elbow", quality: "dull" }),
  });
  const saved = await saveResearch("typed", research, searched);
  assert.equal(saved?.map.title, "Draft title");
  // A keystroke lands after saveResearch read now, before the handback.
  const typed = {
    ...searched,
    note: "typed during search",
    updated: "2027-01-01T00:00:00.000Z",
    noteUpdated: "2027-01-01T00:00:00.000Z",
  };
  const next = withStampedResearch(typed, "typed", saved!, searched);
  assert.equal(next.note, "typed during search");
  assert.equal(next.noteUpdated, "2027-01-01T00:00:00.000Z");
  assert.equal(next.map.summary, "typed during search");
  assert.equal(next.map.title, "Draft title");
  assert.equal(next.map.quality, "");
  assert.deepEqual(next.answers, [{ key: "onset", text: "draft onset" }]);
});

test("an unstamped answer edited during the search still wins in the handback", async () => {
  await storeEntries([
    entry("typed2", "n", {
      updated: T1,
      noteUpdated: T1,
      answers: [
        { key: "onset", text: "stored onset" },
        { key: "worse", text: "stairs" },
      ],
    }),
  ]);
  const searched = entry("typed2", "n", {
    updated: T1,
    noteUpdated: T1,
    answers: [
      { key: "onset", text: "stored onset" },
      { key: "worse", text: "stairs" },
    ],
  });
  const saved = await saveResearch("typed2", research, searched);
  const edited = {
    ...searched,
    updated: "2027-01-01T00:00:00.000Z",
    answers: [
      { key: "onset", text: "typed onset" },
      { key: "worse", text: "stairs" },
      { key: "better", text: "rest" },
    ],
  };
  const next = withStampedResearch(edited, "typed2", saved!, searched);
  assert.deepEqual(next.answers, [
    { key: "onset", text: "typed onset" },
    { key: "worse", text: "stairs" },
    { key: "better", text: "rest" },
  ]);
});

test("withMapDetails stamps only the details that changed, clears included", () => {
  const base = entry("stamp", "n", {
    map: withContext("n", { quality: "sharp", activity: "running" }),
    mapUpdated: { activity: T1 },
  });
  const next = withMapDetails(
    base,
    { quality: "", activity: "running", summary: "n2" },
    T2,
  );
  assert.equal(next.map.quality, "");
  assert.equal(next.map.summary, "n2");
  assert.deepEqual(next.mapUpdated, { activity: T1, quality: T2 });
  const same = withMapDetails(base, { activity: "running" }, T2);
  assert.deepEqual(same.mapUpdated, { activity: T1 });
});

test("saveResearch with an unstamped editor still keeps stored on a tie", async () => {
  putLegacyRow(entry("live-tie", "stored note", { updated: T2 }));
  const editor = entry("live-tie", "editor note", { updated: T1 });
  const after = await saveResearch("live-tie", research, editor);
  assert.equal(after?.note, "stored note");
});

test("editorAfterSave applies a pin removal and a move made during the save", () => {
  const p1 = pinAt("pin-1"),
    p2 = pinAt("pin-2"),
    p3 = pinAt("pin-3");
  const snapshot = entry("eas-merge", "n", {
    updated: T1,
    pointsUpdated: T1,
    points: [p1, p2],
    map: neckMap("n", ["neck"]),
  });
  const editor = {
    ...snapshot,
    updated: T2,
    pointsUpdated: T2,
    points: [{ ...p1, position: [0, 3, 0] as [number, number, number] }],
  };
  // The merge kept pin-3 from the stored row.
  const saved = entry("eas-merge", "n", {
    updated: T1,
    pointsUpdated: T1,
    points: [p1, p2, p3],
    map: neckMap("n", ["neck"]),
  });
  const next = editorAfterSave(editor, snapshot, saved);
  assert.deepEqual(
    next.points?.map((p) => [p.id, p.position[1]]),
    [
      ["pin-1", 3],
      ["pin-3", 1],
    ],
  );
  assert.equal(next.pointsUpdated, T2);
});

test("a pin edit during a save does not let the next save drop a merged pin", async () => {
  await storeEntries([
    entry("eas-next", "n", {
      pointsUpdated: T2,
      points: [pinAt("pin-1")],
      map: neckMap("n", ["neck"]),
    }),
  ]);
  const snapshot = entry("eas-next", "n", {
    pointsUpdated: T1,
    points: [],
    map: neckMap("n"),
  });
  const [saved] = await storeEntries([snapshot]);
  assert.equal(saved?.points?.length, 1);
  const T3 = "2026-01-04T00:00:00.000Z";
  const editor = {
    ...snapshot,
    updated: T3,
    pointsUpdated: T3,
    points: [pinAt("pin-2")],
    map: neckMap("n", ["neck"]),
  };
  const next = editorAfterSave(editor, snapshot, saved!);
  const [again] = await storeEntries([next as ReturnType<typeof entry>]);
  assert.deepEqual(
    again?.points?.map((p) => p.id),
    ["pin-1", "pin-2"],
  );
});
