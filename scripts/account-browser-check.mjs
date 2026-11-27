import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, devices } from "playwright";

const output = resolve("output/account-browser-check");
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "pipe" },
);
  let logs = "";
  let cloudEntries = [];
server.stderr.on("data", (chunk) => {
  logs += chunk;
});
let browser;
try {
  for (
    let i = 0;
    !(await fetch(origin)
      .then((response) => response.ok)
      .catch(() => false));
    i++
  ) {
    if (i > 100 || server.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  await runFlow("desktop", {
    viewport: { width: 1440, height: 1050 },
    locale: "en-US",
  }, "upgrade_coming_soon");
  await runFlow(
    "iphone",
    { ...devices["iPhone 16 Pro"], locale: "en-US" },
    "limit_reached",
  );
  console.log("PASS account sign-in, backup, limit sheet, and delete");
} finally {
  await browser?.close();
  server.kill();
}

async function runFlow(name, contextOptions, limitCode) {
  const context = await browser.newContext({
    ...contextOptions,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  const blocked = [];
  const calls = [];
  const analytics = [];
  const flags = { search: "ok" };
  await page.addInitScript(() => {
    const listeners = new Set();
    let session = null;
    const state = { deleted: false };
    window.__IHURT_ACCOUNT_STATE__ = state;
    window.__IHURT_ACCOUNT_RUNTIME__ = {
      apiBase: "https://ihurt-api.test",
      analyticsEndpoint: "https://analytics.test/collect",
      auth: {
        async current() {
          return session;
        },
        onChange(listener) {
          listeners.add(listener);
          listener(session);
          return () => listeners.delete(listener);
        },
        async signIn(method) {
          session = {
            uid: "uid-1",
            email: "person@example.com",
            provider: method,
            getIdToken: async () => "test-id-token",
          };
          for (const listener of listeners) listener(session);
          return session;
        },
        async signOut() {
          session = null;
          for (const listener of listeners) listener(null);
        },
        async reauthenticate() {},
        async deleteUser() {
          state.deleted = true;
          session = null;
          for (const listener of listeners) listener(null);
        },
        async enrollPasskey() {},
      },
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.host === "ihurt-api.test") {
      const method = route.request().method();
      const body = route.request().postData() ?? "";
      calls.push({
        method,
        path: url.pathname,
        body,
        authorization: route.request().headers().authorization ?? "",
      });
      if (url.pathname === "/v1/searches") {
        if (flags.search !== "ok") {
          return route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ code: flags.search, remaining: 0 }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ remaining: 4 }),
        });
      }
      if (url.pathname === "/v1/account" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            tier: "free",
            searchesRemaining: 5,
            backupDays: 90,
            sync: false,
          }),
        });
      }
      if (url.pathname === "/v1/account/sync") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
      if (url.pathname === "/v1/sync" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ entries: cloudEntries }),
        });
      }
      if (url.pathname === "/v1/sync" && method === "PUT") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
      if (url.pathname === "/v1/account" && method === "DELETE") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
      return route.fulfill({ status: 404, body: "missing" });
    }
    if (url.host === "analytics.test") {
      analytics.push(route.request().postData() ?? "");
      return route.fulfill({ status: 204, body: "" });
    }
    blocked.push(url.host);
    return route.abort();
  });
  await page.goto(origin);
  await page
    .locator('[data-atlas="z-anatomy"][data-heat-engine="wasm"]')
    .waitFor();
  const note = page.getByRole("textbox", { name: "Describe your discomfort" });
  await note.fill("alpha-marker after a walk.");
  await page.locator("#entry-title").fill("alpha-marker");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await page.getByText("Entry saved on this device.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const account = page.locator("dialog.account-dialog").first();
  const signInName = name === "iphone" ? "Sign in with Apple" : "Sign in with Google";
  const signIn = account.getByRole("button", { name: signInName });
  const box = await signIn.boundingBox();
  assert.ok(box && box.height >= 44, `${name} sign-in target`);
  await signIn.click();
  await account.getByText("5 source searches left this month.", { exact: true }).waitFor();
  assert.equal(
    calls.some((call) => call.method === "PUT"),
    false,
    `${name} uploaded before opt-in`,
  );
  const local = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("ihurt-notebook");
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction("entries", "readonly").objectStore("entries").getAll();
          all.onsuccess = () => {
            db.close();
            const row = all.result.find((item) =>
              String(item.note ?? "").includes("alpha-marker"),
            );
            resolve(
              row
                ? {
                    id: row.id,
                    created: row.created,
                    noteUpdated: row.noteUpdated || row.updated || row.created,
                  }
                : null,
            );
          };
        };
      }),
  );
  assert.ok(local?.id, `${name} saved entry`);
  const newer = new Date(Date.parse(local.noteUpdated) + 60_000).toISOString();
  cloudEntries = [
    {
      id: local.id,
      created: local.created,
      note: "cloud-note-marker",
      noteUpdated: newer,
      updated: newer,
      provider: "Your notes",
      answers: [],
      points: [],
      map: {
        title: "",
        summary: "cloud-note-marker",
        regions: [],
        quality: "",
        activity: "",
        duration: "",
        intensity: null,
        question: null,
        urgent: false,
        safety_message: null,
      },
    },
  ];
  await account.getByRole("button", { name: "Turn on backup" }).click();
  await account.getByText("This copies 1 entry", { exact: false }).waitFor();
  await account.getByRole("button", { name: "Copy to this account" }).click();
  for (let i = 0; i < 50 && !calls.some((call) => call.method === "PUT"); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const puts = calls.filter((call) => call.method === "PUT");
  assert.ok(puts.length >= 1, `${name} backup request`);
  for (const put of puts) {
    assert.equal(put.authorization, "Bearer test-id-token");
    assert.equal(put.body.includes("cloud-note-marker"), true);
    assert.equal(put.body.includes("alpha-marker"), false);
    assert.equal(put.body.includes("@"), false);
    const payload = JSON.parse(put.body);
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].map.title, "");
    assert.equal("email" in payload, false);
  }
  for (const body of analytics) {
    const parsed = JSON.parse(body);
    assert.deepEqual(Object.keys(parsed), ["event"]);
    assert.equal(body.includes("alpha-marker"), false);
    assert.equal(body.includes("@"), false);
    assert.equal(body.includes("uid-1"), false);
  }
  assert.ok(analytics.some((body) => body === '{"event":"sign_in"}'));
  assert.ok(analytics.some((body) => body === '{"event":"sync_on"}'));
  flags.search = limitCode;
  const allowed = await page.evaluate(() => window.__IHURT_GUARD_SEARCH__());
  assert.equal(allowed, false, `${name} search was not blocked`);
  const sheet = page.getByRole("dialog", { name: "Pro: upgrade coming soon" });
  await sheet.waitFor();
  await sheet.getByText("$4.99", { exact: false }).waitFor();
  await sheet.getByText("$39.99", { exact: false }).waitFor();
  assert.equal(await sheet.getByRole("button", { name: /buy/i }).count(), 0);
  await sheet.getByRole("button", { name: "Close" }).click();
  await sheet.waitFor({ state: "hidden" });
  await account.getByRole("button", { name: "Sign out" }).click();
  await account.getByRole("button", { name: signInName }).waitFor();
  await page.waitForFunction(
    () => document.querySelector("#pain-note")?.value === "cloud-note-marker",
  );
  assert.equal(await note.inputValue(), "cloud-note-marker");
  const putsAfterSignOut = calls.filter((call) => call.method === "PUT").length;
  await account.getByRole("button", { name: "Close account" }).click();
  await account.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#pain-note")?.value === "",
  );
  await note.fill("beta-marker after a rest.");
  await page.locator("#entry-title").fill("beta-marker");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await page.getByText("Entry saved on this device.", { exact: true }).waitFor();
  assert.equal(
    calls.filter((call) => call.method === "PUT").length,
    putsAfterSignOut,
    `${name} uploaded after sign-out`,
  );
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const signedIn = page.locator("dialog.account-dialog").first();
  await signedIn.getByRole("button", { name: signInName }).click();
  await signedIn.getByRole("button", { name: "Delete account" }).click();
  await signedIn.getByRole("heading", { name: "Delete this account?" }).waitFor();
  await signedIn
    .getByText("Entries that were never backed up stay on this device.", {
      exact: false,
    })
    .waitFor();
  await signedIn.getByRole("button", { name: "Delete account" }).click();
  await signedIn.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /^Notebook/ }).click();
  await page.getByRole("heading", { name: "beta-marker", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "alpha-marker", exact: true }).count(),
    0,
  );
  assert.ok(calls.some((call) => call.method === "DELETE" && call.path === "/v1/account"));
  const deleted = await page.evaluate(() => window.__IHURT_ACCOUNT_STATE__.deleted);
  assert.equal(deleted, true);
  assert.deepEqual(blocked, [], `${name} contacted ${blocked.join(",")}`);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  await context.close();
}
