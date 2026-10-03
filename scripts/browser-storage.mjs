// Wait for this edit's committed transaction, not a status left by an older save.
export async function waitForDraft(page, note) {
  // Poll here so each asynchronous IndexedDB read resolves before retrying.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await page.evaluate(
        (expected) =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open("ihurt-notebook", 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction("settings", "readonly");
              const draft = tx.objectStore("settings").get("draft");
              tx.oncomplete = () => {
                db.close();
                resolve(draft.result?.entry.note === expected);
              };
              tx.onabort = tx.onerror = () => {
                db.close();
                reject(tx.error);
              };
            };
          }),
        note,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The edited draft was not committed before reloading.");
}
