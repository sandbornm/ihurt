import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
const output = resolve("output/browser-check");
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
server.stderr.on("data", (d) => (logs += d));
let browser;
try {
  for (
    let i = 0;
    !(await fetch(origin)
      .then((r) => r.ok)
      .catch(() => false));
    i++
  ) {
    if (i > 100 || server.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1050 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [],
      unexpected = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        new URL(r.url()).origin !== origin ||
        new URL(r.url()).pathname.startsWith("/api/")
      )
        unexpected.push(r.url());
    });
    await page.goto(origin);
    const atlas = page.locator(
      '[data-atlas="z-anatomy"][data-heat-engine="wasm"]',
    );
    await atlas.waitFor();
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page.getByRole("button", { name: "Turn", exact: true }).click();
    await page.getByRole("button", { name: "Turn right", exact: true }).click();
    await page.getByRole("button", { name: "Turn left", exact: true }).click();
    await page.getByRole("button", { name: "Move", exact: true }).click();
    assert.equal(await atlas.getAttribute("data-drag-mode"), "move");
    await page.getByRole("button", { name: "Move up", exact: true }).click();
    await page.getByRole("button", { name: "Move down", exact: true }).click();
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    const canvas = atlas.locator("canvas[data-engine]");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const picker = page.getByRole("dialog", { name: "Choose anatomy layer" });
    for (const [x, y] of [
      [0.5, 0.36],
      [0.53, 0.42],
      [0.55, 0.33],
    ]) {
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      if (await picker.isVisible()) break;
    }
    await picker.waitFor();
    const choices = picker.locator(".layer-choices button");
    assert.ok((await choices.count()) > 0);
    await choices.last().click();
    await picker.getByRole("button", { name: "Pin this structure" }).click();
    await page.getByText("PINNED SPOTS · 1/10", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Muscle list", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Find a muscle" })
      .fill("biceps brachii");
    const muscle = page.locator(".muscle-browser-list button").first();
    await muscle.click();
    assert.equal(await muscle.getAttribute("aria-pressed"), "true");
    await page
      .getByRole("button", { name: "Add pin to muscle", exact: true })
      .click();
    await picker.waitFor();
    await page.screenshot({ path: join(output, `layers-${width}.png`) });
    await picker.getByRole("button", { name: "Pin this structure" }).click();
    await page.getByText("PINNED SPOTS · 2/10", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Add pin in selected region" })
      .click();
    await picker.waitFor();
    await picker.getByRole("button", { name: "Pin this structure" }).click();
    await page.getByText("PINNED SPOTS · 3/10", { exact: true }).waitFor();
    await page
      .getByRole("slider", { name: "Reported intensity", exact: true })
      .fill("7");
    const bundleDownload = page.waitForEvent("download");
    await page
      .getByText("Full report with Grok or another AI", { exact: true })
      .click();
    await page.getByRole("button", { name: "Download .ihm map" }).click();
    const bundleFile = await bundleDownload;
    const bundlePath = join(output, `map-${width}.ihm`);
    await bundleFile.saveAs(bundlePath);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    assert.equal(bundle.entries[0].context.intensity, 7);
    assert.equal(bundle.entries[0].highlights.length, 3);
    assert.equal(bundle.materials[0].media_type, "image/svg+xml");
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    const note = page.getByRole("textbox", {
      name: "Describe your discomfort",
    });
    await note.fill("First entry: stiffness after tennis.");
    await page.locator("#entry-title").fill("Tennis");
    await page.locator("#activity").fill("Tennis");
    await page.getByRole("button", { name: "Save entry", exact: true }).click();
    await page
      .getByText("Entry saved on this device.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "New entry", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("#pain-note")?.value === "",
    );
    await note.fill("Second entry: a long walk.");
    await page.locator("#entry-title").fill("Walking");
    await page.getByRole("button", { name: "Save entry", exact: true }).click();
    await page.getByRole("button", { name: /^Notebook/ }).click();
    await page
      .getByRole("button", { name: "Open entry", exact: true })
      .first()
      .click();
    await note.fill("Edited first entry.");
    await page
      .getByText("Draft saved on this device", { exact: true })
      .waitFor();
    await page.reload();
    await atlas.waitFor();
    assert.equal(await note.inputValue(), "Edited first entry.");
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      columns: getComputedStyle(
        document.querySelector(".explorer-grid"),
      ).gridTemplateColumns.split(" ").length,
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.columns, width > 670 ? 2 : 1);
    await page.getByRole("button", { name: /^Notebook/ }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Open entry", exact: true })
        .count(),
      2,
    );
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export notebook", exact: true })
      .click();
    const file = await downloadPromise;
    const path = join(output, `notebook-${width}.json`);
    await file.saveAs(path);
    const report = JSON.parse(await readFile(path, "utf8"));
    assert.equal(report.schema_version, 2);
    assert.equal(report.entries.length, 2);
    assert.ok(report.entries.some((e) => e.note === "Edited first entry."));
    await page.locator('[data-offline="ready"]').waitFor();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await atlas.waitFor();
    await note.fill("An edit made offline.");
    await page
      .getByText("Draft saved on this device", { exact: true })
      .waitFor();
    await page.reload();
    await atlas.waitFor();
    assert.equal(await note.inputValue(), "An edit made offline.");
    await page.screenshot({ path: join(output, `${width}.png`) });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log(
      `PASS ${width}: multiple entries, editing, refresh, JSON backup, offline atlas and storage; no API calls`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
