import assert from "node:assert/strict";
import { waitForDraft } from "./browser-storage.mjs";
import { checkTouchLayout } from "./touch-layout-check.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, devices } from "playwright";

const output = resolve("output/ios-check");
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
let browser;
try {
  for (
    let count = 0;
    !(await fetch(origin)
      .then((r) => r.ok)
      .catch(() => false));
    count++
  ) {
    if (count > 100 || server.exitCode !== null)
      throw new Error("Preview did not start.");
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  for (const device of ["iPhone 16 Pro", "iPad (gen 7)"]) {
    const deviceOutput = `${output}/${device.replaceAll(" ", "-")}`;
    await mkdir(deviceOutput, { recursive: true });
    const profile = devices[device];
    const context = await browser.newContext({
      ...profile,
      viewport: profile.screen ?? profile.viewport,
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      window.webkit = { messageHandlers: { bridge: {} } };
      window.nativeExports = {
        writes: [],
        shares: [],
        failWrites: false,
        cancelSharing: false,
      };
      window.Capacitor = {
        PluginHeaders: [
          {
            name: "Filesystem",
            methods: [{ name: "writeFile", rtype: "promise" }],
          },
          { name: "Share", methods: [{ name: "share", rtype: "promise" }] },
        ],
        async nativePromise(plugin, method, options) {
          const state = window.nativeExports;
          if (plugin === "Filesystem" && method === "writeFile") {
            if (state.failWrites) throw new Error("Storage full");
            state.writes.push(options);
            return { uri: `file:///example/Documents/${options.path}` };
          }
          if (plugin === "Share" && method === "share") {
            state.shares.push(options);
            if (state.cancelSharing) throw new Error("Share canceled");
            return { activityType: "test" };
          }
          throw new Error(`Unexpected native method ${plugin}.${method}`);
        },
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [],
      external = [],
      downloads = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        new URL(r.url()).origin !== origin ||
        new URL(r.url()).pathname.startsWith("/api/")
      )
        external.push(r.url());
    });
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    );
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin && !url.pathname.startsWith("/api/")
        ? route.continue()
        : route.abort();
    });
    await page.goto(origin);
    await page
      .locator('[data-atlas="z-anatomy"][data-heat-engine="wasm"]')
      .waitFor();
    await page.locator('[data-offline="ready"]').waitFor();
    await checkTouchLayout(page, context, deviceOutput);
    assert.equal(
      await page.getByRole("button", { name: "Optional AI" }).count(),
      0,
    );
    await page.getByRole("button", { name: "Privacy & limitations" }).click();
    const info = page.getByRole("dialog", { name: "Your notebook, your data" });
    await context.setOffline(true);
    await info
      .getByText("iHurt has no accounts or analytics.", { exact: false })
      .waitFor();
    await info
      .getByText("Anatomy credits and licenses", { exact: true })
      .click();
    assert.equal(
      await info.locator(".anatomy-credits > .license-text").textContent(),
      await readFile("public/models/ATTRIBUTION.md", "utf8"),
    );
    for (const [title, file] of [
      ["Upstream anatomy notice", "public/models/UPSTREAM-LICENSE.txt"],
      ["Outer-body reference license", "public/models/REFERENCE-LICENSE.txt"],
      ["Draco decoder license", "public/draco/LICENSE"],
      ["iHurt code license", "LICENSE"],
    ]) {
      const notice = info
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: title }) })
        .last();
      await notice.locator("summary").click();
      assert.equal(
        await notice.locator(".license-text").textContent(),
        await readFile(file, "utf8"),
      );
      assert.equal(await notice.locator(".license-text").isVisible(), true);
      await notice.locator("summary").click();
    }
    assert.equal(
      await info.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await info.screenshot({ path: `${deviceOutput}/credits.png` });
    await info.getByRole("button", { name: "Close information" }).click();
    await context.setOffline(false);
    const portrait = page.viewportSize();
    await page.setViewportSize({
      width: portrait.height,
      height: portrait.width,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({ path: `${deviceOutput}/landscape.png` });
    await page.setViewportSize(portrait);
    await page.getByRole("button", { name: /^Notebook/ }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles("docs/examples/neck-tennis.json");
    await page.getByRole("button", { name: "Open entry", exact: true }).click();
    const atlas = page.locator(
      '[data-atlas="z-anatomy"][data-heat-engine="wasm"]',
    );
    await atlas.waitFor();
    await atlas.screenshot({ path: `${deviceOutput}/body.png` });
    const fixture = JSON.parse(
      await readFile("docs/examples/neck-tennis.json", "utf8"),
    );
    await page.getByRole("button", { name: "Save entry", exact: true }).click();
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    await page.waitForFunction(() => window.nativeExports.shares.length === 1);
    const json = await page.evaluate(() => window.nativeExports.writes[0]);
    assert.equal(json.directory, "DOCUMENTS");
    assert.equal(json.encoding, "utf8");
    assert.match(json.path, /^Reports\/ihurt-map-.*\.json$/);
    assert.equal(
      JSON.parse(json.data).entries[0].note,
      fixture.entries[0].note,
    );
    assert.deepEqual(
      JSON.parse(json.data).entries[0].highlights,
      fixture.entries[0].highlights,
    );
    assert.deepEqual(
      JSON.parse(json.data).anatomy.coordinates,
      fixture.anatomy.coordinates,
    );
    await page
      .getByRole("button", { name: "Save / share report", exact: true })
      .click();
    await page.waitForFunction(() => window.nativeExports.shares.length === 2);
    const report = await page.evaluate(() => window.nativeExports.writes[1]);
    assert.match(report.path, /\.html$/);
    assert.ok(report.data.includes("Content-Security-Policy"));
    assert.ok(report.data.includes("In your words"));
    assert.ok(report.data.includes("Not medical advice"));
    await page.getByRole("button", { name: "Map image", exact: true }).click();
    await page.waitForFunction(() => window.nativeExports.shares.length === 3);
    const png = await page.evaluate(() => window.nativeExports.writes[2]);
    assert.match(png.path, /\.png$/);
    assert.equal(png.encoding, undefined);
    assert.match(png.data, /^iVBOR/);
    await page.locator(".share-with-ai > summary").click();
    await page
      .getByText("Suggested prompt and .ihm file", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save / share .ihm", exact: true })
      .click();
    await page.waitForFunction(() => window.nativeExports.shares.length === 4);
    const ihm = await page.evaluate(() => window.nativeExports.writes[3]);
    assert.match(ihm.path, /\.ihm$/);
    assert.equal(JSON.parse(ihm.data).bundle.kind, "ihurt.map");
    await page.evaluate(() => {
      window.nativeExports.cancelSharing = true;
    });
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    await page
      .getByText(
        "Saved in Files → iHurt → Reports. You can share it from there.",
        { exact: true },
      )
      .waitFor();
    await page.evaluate(() => {
      window.nativeExports.failWrites = true;
    });
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    await page
      .getByText(
        "The file could not be saved. Check available storage and try again.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.nativeExports.shares.length),
      5,
    );
    const note = page.getByRole("textbox", {
      name: "Describe your discomfort",
    });
    const unfinished = `${fixture.entries[0].note}\nUnfinished draft.`;
    await note.fill(unfinished);
    await page
      .getByText("Draft saved on this device", { exact: true })
      .waitFor();
    await waitForDraft(page, unfinished);
    await page.reload();
    await page
      .locator('[data-atlas="z-anatomy"][data-heat-engine="wasm"]')
      .waitFor();
    await page.waitForFunction(
      (expected) => document.querySelector("#pain-note")?.value === expected,
      unfinished,
    );
    await page.getByRole("button", { name: /^Notebook/ }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Open entry", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Export notebook", exact: true })
      .click();
    await page.waitForFunction(() => window.nativeExports.writes.length === 1);
    assert.equal(
      JSON.parse(await page.evaluate(() => window.nativeExports.writes[0].data))
        .entries[0].note,
      unfinished,
    );
    await page.screenshot({ path: `${deviceOutput}/notebook.png` });
    // A failed final save must show a useful error, without an unhandled rejection.
    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === "readwrite")
          throw new DOMException("Test storage full", "QuotaExceededError");
        return transaction.apply(this, args);
      };
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await page.getByText("Draft not saved", { exact: true }).waitFor();
    await page
      .getByText(
        "This browser could not save your draft. Export JSON to keep it.",
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(downloads, []);
    console.log(
      `PASS ${device} mocked iOS bridge: touch scrolling, readable editors, keyboard dismissal, reachable pin confirmation, offline credits, portrait/landscape layout, import, persisted entry/draft, native JSON/.ihm/PNG/HTML/notebook files, sharing cancellation, storage failure; no browser downloads or API calls.`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
