import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
const output = "output/controls";
await mkdir(output, { recursive: true });
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
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
  { stdio: "ignore" },
);
let browser;
try {
  for (
    let i = 0;
    !(await fetch(origin)
      .then((r) => r.ok)
      .catch(() => false));
    i++
  ) {
    if (i > 100) throw Error("server");
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
      colorScheme: "dark",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    const atlas = page.locator('[data-atlas="z-anatomy"]');
    await atlas.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Muscle list", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(await atlas.getAttribute("data-drag-mode"), "pin");
    await page.getByRole("button", { name: "Quick tour", exact: true }).click();
    for (let i = 0; i < 3; i++)
      await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("button", { name: "Start mapping", exact: true })
      .click();
    assert.equal(
      await page.locator(".notebook-pin").count(),
      0,
      "Tutorial changed the journal",
    );
    await page
      .getByRole("button", { name: "Switch to light mode", exact: true })
      .click();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
    await page.screenshot({
      path: `${output}/simple-light-${width}.png`,
      animations: "disabled",
    });
    await page.reload();
    await atlas.waitFor();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
    await page.getByRole("button", { name: "Quick tour", exact: true }).click();
    await page.screenshot({ path: `${output}/tour-${width}.png` });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Switch to dark mode", exact: true })
      .click();
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Hands", exact: true })
        .isVisible(),
      true,
    );
    await page.getByRole("button", { name: "Hands", exact: true }).click();
    await page.locator(".hand-grabbers[data-hands-ready]").waitFor();
    const openPalm = (x, y) => {
      const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
      points[0] = { x, y };
      points[5] = { x: x + 0.04, y };
      points[17] = { x: x - 0.04, y };
      points[4] = { x: x - 0.12, y };
      points[8] = { x: x + 0.12, y };
      return points;
    };
    const pinched = (gap) => {
      const points = openPalm(0.5, 0.5);
      points[4] = { x: 0.5, y: 0.5 };
      points[8] = { x: 0.5 + gap, y: 0.5 };
      return points;
    };
    const spoof = (landmarks) =>
      page.evaluate((hands) => {
        window.dispatchEvent(
          new CustomEvent("ihurt:hands", { detail: { landmarks: hands } }),
        );
      }, landmarks);
    await spoof([openPalm(0.35, 0.5)]);
    await spoof([openPalm(0.6, 0.5)]);
    await page.locator(".hand-grabber.is-on").waitFor();
    assert.equal(await atlas.getAttribute("data-hands-mode"), "turn");
    assert.equal(await atlas.getAttribute("data-hands-moved"), "turn");
    await spoof([pinched(0.05)]);
    await spoof([pinched(0.03)]);
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-hands-mode]")
          ?.getAttribute("data-hands-mode") === "zoom",
    );
    await spoof([openPalm(0.3, 0.4), openPalm(0.7, 0.4)]);
    await spoof([openPalm(0.3, 0.58), openPalm(0.7, 0.58)]);
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-hands-grabbers]")
          ?.getAttribute("data-hands-grabbers") === "2",
    );
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page.getByRole("button", { name: "Find a region" }).focus();
    await page.keyboard.press("Space");
    const regionField = page.getByRole("textbox", {
      name: "Search body regions",
    });
    await regionField.waitFor();
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "Search body regions",
    );
    assert.equal(await regionField.inputValue(), "");
    await page.keyboard.press("Escape");
    await page
      .getByRole("checkbox", { name: "Show bones", exact: true })
      .uncheck();
    assert.equal(await atlas.getAttribute("data-bones"), "hidden");
    await page
      .getByRole("button", { name: "Muscle list", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") === "Find a muscle",
    );
    await page
      .getByRole("textbox", { name: "Find a muscle" })
      .fill("biceps brachii");
    await page.locator(".muscle-browser-list button").first().click();
    await page
      .getByRole("button", { name: "Add pin to muscle", exact: true })
      .click();
    const picker = page.getByRole("dialog", { name: "Choose anatomy layer" });
    await picker.waitFor();
    await picker.getByRole("button", { name: "Pin this structure" }).click();
    await page.getByText("PINNED SPOTS · 1/10", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Undo last mark" }).click();
    assert.equal(await page.locator(".notebook-pin").count(), 0);
    await page.getByRole("button", { name: "Redo last mark" }).click();
    await page.getByText("PINNED SPOTS · 1/10", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Remove spot 1", exact: true })
      .click();
    await page.getByRole("button", { name: "Undo last mark" }).click();
    await page.getByText("PINNED SPOTS · 1/10", { exact: true }).waitFor();
    // Paint over the isolated muscle without rotating the camera.
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    const canvas = atlas.locator("canvas[data-engine]");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.46);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.51, box.y + box.height * 0.56, {
      steps: 10,
    });
    await page.mouse.up();
    await page.getByText("PINNED SPOTS · 2/10", { exact: true }).waitFor();
    const bundleDownload = page.waitForEvent("download");
    await page
      .getByText("Full report with Grok or another AI", { exact: true })
      .click();
    await page.getByRole("button", { name: "Download .ihm map" }).click();
    const bundle = await bundleDownload;
    const path = `${output}/marks-${width}.ihm`;
    await bundle.saveAs(path);
    const data = JSON.parse(await readFile(path, "utf8"));
    assert.ok(data.entries[0].highlights[1].area.path.length > 1);
    assert.equal(data.entries[0].highlights[1].area.radius, 0.12);
    await page.getByRole("button", { name: "Turn", exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const turnBox = await canvas.boundingBox();
    await page.mouse.click(
      turnBox.x + turnBox.width * 0.5,
      turnBox.y + turnBox.height * 0.5,
    );
    assert.equal(
      await page.locator(".notebook-pin").count(),
      2,
      "Turning placed an unwanted pin",
    );
    await page
      .getByRole("button", { name: "Explore layers at spot 1", exact: true })
      .click();
    await picker.waitFor();
    const choices = picker.locator(".layer-choices button");
    if ((await choices.count()) > 1) {
      await picker
        .getByRole("button", { name: "Spread layers", exact: true })
        .click();
      assert.equal(await atlas.getAttribute("data-exploded"), "true");
      await picker.getByRole("slider", { name: "Layer separation" }).fill("1");
      await choices.last().hover();
      await page.screenshot({ path: `${output}/spread-${width}.png` });
      await picker
        .getByRole("button", { name: "Spread layers", exact: true })
        .click();
      assert.equal(await atlas.getAttribute("data-exploded"), "false");
    }
    await picker.getByRole("button", { name: "Close layers" }).click();
    await page
      .getByRole("slider", { name: "Reported intensity", exact: true })
      .fill("8");
    const imageDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Map image", exact: true }).click();
    const picture = await imageDownload;
    await picture.saveAs(`${output}/map-${width}.png`);
    assert.equal(
      (await readFile(`${output}/map-${width}.png`)).subarray(1, 4).toString(),
      "PNG",
    );
    const popupPromise = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    const popup = await popupPromise;
    await popup.locator("figure img").waitFor();
    assert.ok(
      (await popup.locator(".medical-notice").innerText()).startsWith(
        "Not medical advice. Not a prescription.",
      ),
    );
    await popup.waitForFunction(
      () => document.querySelector("figure img")?.naturalWidth > 0,
    );
    assert.ok(
      (await popup.locator("figcaption").innerText()).includes("bones hidden"),
    );
    await popup.close();
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Body reference", exact: true })
      .click();
    const reference = page.getByRole("dialog", {
      name: "Body references",
      exact: true,
    });
    await reference.locator('[data-body="female"] canvas').waitFor();
    await page.screenshot({ path: `${output}/female-${width}.png` });
    await reference.getByRole("button", { name: "Male", exact: true }).click();
    await reference.locator('[data-body="male"] canvas').waitFor();
    await page.screenshot({ path: `${output}/male-${width}.png` });
    await reference.getByRole("button", { name: "Return to map" }).click();
    assert.equal(await page.locator(".notebook-pin").count(), 2);
    await page
      .getByText("Draft saved on this device", { exact: true })
      .waitFor();
    await page.reload();
    await atlas.waitFor();
    assert.equal(await atlas.getAttribute("data-bones"), "hidden");
    assert.equal(await page.locator(".notebook-pin").count(), 2);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS controls ${width}: simple controls, tutorial, light mode, turn without pins, paint, undo/redo, bone visibility, viewport PNG, print image, reference models, refresh`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
