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
  const widths = process.argv.includes("--camera-lifecycle") ? [] : [1440, 390];
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 1050 },
      reducedMotion: "reduce",
      hasTouch: true,
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
    // Native touch events exercise OrbitControls, capture, and pin suppression together.
    const touch = await context.newCDPSession(page);
    const touchCanvas = atlas.locator("canvas[data-engine]");
    await touchCanvas.scrollIntoViewIfNeeded();
    const touchBox = await touchCanvas.boundingBox();
    const x = touchBox.x + touchBox.width * 0.5;
    const y = touchBox.y + touchBox.height * 0.4;
    const sendTouch = (type, points) =>
      touch.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([id, px, py]) => ({ id, x: px, y: py })),
      });
    const beforeTurn = await touchCanvas.screenshot();
    await sendTouch("touchStart", [[1, x, y]]);
    await sendTouch("touchMove", [[1, x + 65, y]]);
    await sendTouch("touchEnd", []);
    assert.notDeepEqual(
      await touchCanvas.screenshot(),
      beforeTurn,
      "Dragging in Pin mode did not turn the body",
    );
    assert.equal(
      await page.locator(".notebook-pin").count(),
      0,
      "Dragging placed a pin",
    );
    const beforePan = await touchCanvas.screenshot();
    await sendTouch("touchStart", [
      [1, x - 30, y],
      [2, x + 30, y],
    ]);
    await sendTouch("touchMove", [
      [1, x - 30, y + 35],
      [2, x + 30, y + 35],
    ]);
    await sendTouch("touchEnd", []);
    assert.notDeepEqual(
      await touchCanvas.screenshot(),
      beforePan,
      "Two-finger pan did not move the body",
    );
    const beforeZoom = await touchCanvas.screenshot();
    await sendTouch("touchStart", [
      [1, x - 20, y],
      [2, x + 20, y],
    ]);
    await sendTouch("touchMove", [
      [1, x - 50, y],
      [2, x + 50, y],
    ]);
    await sendTouch("touchEnd", [[1, x - 50, y]]);
    await sendTouch("touchEnd", []);
    assert.notDeepEqual(
      await touchCanvas.screenshot(),
      beforeZoom,
      "Pinching did not zoom",
    );
    assert.equal(
      await page.locator(".notebook-pin").count(),
      0,
      "Two-finger navigation placed a pin",
    );
    await sendTouch("touchStart", [[1, x, y]]);
    await sendTouch("touchCancel", []);
    assert.equal(
      await page.locator(".notebook-pin").count(),
      0,
      "Canceled touch placed a pin",
    );
    await touch.detach();
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
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
    const blank = (x, y) => Array.from({ length: 21 }, () => ({ x, y }));
    const setFinger = (points, mcp, length, curl) => {
      const base = points[mcp];
      const reach = length * (1 - curl);
      points[mcp + 1] = { x: base.x + reach * 0.4, y: base.y + curl * 0.02 };
      points[mcp + 2] = { x: base.x + reach * 0.7, y: base.y + curl * 0.03 };
      points[mcp + 3] = { x: base.x + reach, y: base.y + curl * 0.02 };
    };
    const posed = (x, y, curls, thumb) => {
      const points = blank(x, y);
      points[0] = { x, y };
      points[5] = { x: x + 0.04, y };
      points[9] = { x: x + 0.015, y };
      points[13] = { x: x - 0.015, y };
      points[17] = { x: x - 0.04, y };
      setFinger(points, 5, 0.12, curls[0]);
      setFinger(points, 9, 0.13, curls[1]);
      setFinger(points, 13, 0.12, curls[2]);
      setFinger(points, 17, 0.1, curls[3]);
      points[1] = { x: x - 0.02, y };
      points[2] = { x: x - 0.04, y };
      points[3] = { x: x - 0.06, y };
      points[4] = thumb;
      return points;
    };
    const openPalm = (x, y) => posed(x, y, [0, 0, 0, 0], { x: x - 0.1, y });
    const fist = (x, y) =>
      posed(x, y, [1, 1, 1, 1], { x: x + 0.02, y: y + 0.02 });
    const pointing = (x, y, thumbGap = 0.12) => {
      const points = posed(x, y, [0, 1, 1, 1], { x, y });
      points[4] = { x: points[8].x - thumbGap, y: points[8].y };
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
    assert.equal(await atlas.getAttribute("data-hands-mode"), "rest");
    assert.notEqual(await atlas.getAttribute("data-hands-moved"), "turn");
    await spoof([fist(0.35, 0.5)]);
    await spoof([fist(0.6, 0.5)]);
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-hands-mode]")
          ?.getAttribute("data-hands-mode") === "turn",
    );
    assert.equal(await atlas.getAttribute("data-hands-mode"), "turn");
    assert.equal(await atlas.getAttribute("data-hands-moved"), "turn");
    await spoof([fist(0.35, 0.5), fist(0.65, 0.5)]);
    await spoof([fist(0.25, 0.5), fist(0.75, 0.5)]);
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
    const pinsBeforeTap = await page.locator(".notebook-pin").count();
    await page.getByRole("button", { name: "Reset view" }).click();
    await page.getByRole("button", { name: "Front", exact: true }).click();
    await spoof([pointing(0.34, 0.48)]);
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-hands-mode]")
          ?.getAttribute("data-hands-mode") === "point",
    );
    await spoof([pointing(0.34, 0.48)]);
    await spoof([pointing(0.34, 0.48, 0.02)]);
    await spoof([pointing(0.34, 0.48, 0.12)]);
    const tapped = await page
      .waitForFunction(
        () =>
          document
            .querySelector("[data-hands-tap]")
            ?.getAttribute("data-hands-tap") === "1",
        undefined,
        { timeout: 5000 },
      )
      .catch(async () => {
        const debug = await page.evaluate(() => ({
          mode: document
            .querySelector("[data-hands-mode]")
            ?.getAttribute("data-hands-mode"),
          pose: document
            .querySelector("[data-hands-pose]")
            ?.getAttribute("data-hands-pose"),
          tap: document
            .querySelector("[data-hands-tap]")
            ?.getAttribute("data-hands-tap"),
        }));
        throw new Error(`air-tap did not fire: ${JSON.stringify(debug)}`);
      });
    assert.ok(tapped);
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll(".notebook-pin").length > before ||
        !!document.querySelector('[aria-label="Choose anatomy layer"]'),
      pinsBeforeTap,
    );
    if (
      await page.getByRole("dialog", { name: "Choose anatomy layer" }).count()
    )
      await page.getByRole("button", { name: "Pin this structure" }).click();
    assert.equal(
      await page.locator(".notebook-pin").count(),
      pinsBeforeTap + 1,
      "Point + air-tap should place a pin",
    );
    await page
      .getByRole("button", { name: "Remove spot 1", exact: true })
      .click();
    assert.equal(await page.locator(".notebook-pin").count(), pinsBeforeTap);
    await spoof([pointing(0.34, 0.48)]);
    await page.waitForFunction(() =>
      document.querySelector("[data-hands-aim]"),
    );
    await spoof([]);
    assert.equal(await atlas.getAttribute("data-hands-aim"), null);
    assert.equal(await page.locator(".hand-grabber.is-on").count(), 0);
    await spoof([pointing(0.34, 0.48, 0.02)]);
    assert.equal(await page.locator(".notebook-pin").count(), pinsBeforeTap);
    assert.equal(
      await page.getByRole("dialog", { name: "Choose anatomy layer" }).count(),
      0,
      "Reacquiring a pinched hand must not place a pin",
    );
    await spoof([]);
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
    await page.getByText("PINNED SPOTS · 1", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Undo last mark" }).click();
    assert.equal(await page.locator(".notebook-pin").count(), 0);
    await page.getByRole("button", { name: "Redo last mark" }).click();
    await page.getByText("PINNED SPOTS · 1", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Remove spot 1", exact: true })
      .click();
    await page.getByRole("button", { name: "Undo last mark" }).click();
    await page.getByText("PINNED SPOTS · 1", { exact: true }).waitFor();
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
    await page.getByText("PINNED SPOTS · 2", { exact: true }).waitFor();
    const sharingNote = "Example observation retained in my journal";
    await page
      .getByRole("textbox", { name: "Describe your discomfort" })
      .fill(sharingNote);
    await page.getByText("Share with AI", { exact: true }).click();
    assert.ok(
      (
        await page
          .getByRole("textbox", { name: "AI sharing summary" })
          .inputValue()
      ).includes(sharingNote),
    );
    await page
      .getByRole("checkbox", { name: "Entry notes and title" })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Pin comments", exact: true })
      .uncheck();
    assert.ok(
      !(
        await page
          .getByRole("textbox", { name: "AI sharing summary" })
          .inputValue()
      ).includes(sharingNote),
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Previous AI interpretation" })
        .isEnabled(),
      false,
    );
    await page.getByText("Preview shared JSON", { exact: true }).click();
    const preview = JSON.parse(
      await page
        .getByRole("textbox", { name: "Shared JSON preview" })
        .inputValue(),
    );
    assert.equal(preview.entries[0].note, "");
    assert.equal(preview.entries[0].highlights.length, 2);
    const sharingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download sharing JSON" }).click();
    const sharingPath = `${output}/sharing-${width}.json`;
    await (await sharingDownload).saveAs(sharingPath);
    const shared = JSON.parse(await readFile(sharingPath, "utf8"));
    assert.equal(shared.entries[0].note, "");
    assert.ok(
      shared.entries[0].highlights.every((pin) => pin.comment === undefined),
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "Describe your discomfort" })
        .inputValue(),
      sharingNote,
    );
    await page.getByRole("checkbox", { name: "Entry notes and title" }).check();
    assert.ok(
      (
        await page
          .getByRole("textbox", { name: "AI sharing summary" })
          .inputValue()
      ).includes(sharingNote),
    );
    const bundleDownload = page.waitForEvent("download");
    await page
      .getByText("Suggested prompt and .ihm file", { exact: true })
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
    // Keep marking after the old ten-pin limit, then verify durable storage.
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Muscle list", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Find a muscle" })
      .fill("biceps brachii");
    await page.locator(".muscle-browser-list button").first().click();
    for (let i = 2; i < 12; i++) {
      await page
        .getByRole("button", {
          name: i === 2 ? "Add pin to muscle" : "Add pin in selected region",
          exact: true,
        })
        .click();
      await picker.waitFor();
      await picker.getByRole("button", { name: "Pin this structure" }).click();
    }
    await page.getByText("PINNED SPOTS · 12", { exact: true }).waitFor();
    await page
      .getByRole("textbox", { name: "Note for spot 12", exact: true })
      .fill("Twelfth example spot");
    await page
      .getByText("Draft saved on this device", { exact: true })
      .waitFor();
    await page.reload();
    await atlas.waitFor();
    assert.equal(await page.locator(".notebook-pin").count(), 12);
    assert.equal(
      await page
        .getByRole("textbox", { name: "Note for spot 12", exact: true })
        .inputValue(),
      "Twelfth example spot",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS controls ${width}: simple controls, tutorial, light mode, hands fist/point/tap, turn without pins, paint, undo/redo, bone visibility, viewport PNG, print image, reference models, refresh`,
    );
    await context.close();
  }
  // Fake streams exercise camera cleanup without a camera or model download.
  for (const phase of ["play failure", "pending play", "pending permission"]) {
    const context = await browser.newContext();
    await context.addInitScript((phase) => {
      window.cameraStops = 0;
      window.cameraRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.cameraRequests++;
        const stream = document.createElement("canvas").captureStream();
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            window.cameraStops++;
            stop();
          };
        }
        if (phase === "pending permission")
          await new Promise((resolve) => (window.finishCamera = resolve));
        return stream;
      };
      HTMLMediaElement.prototype.play = async function () {
        if (phase === "play failure") throw new Error("Example play failure");
        await new Promise((resolve) => (window.finishCamera = resolve));
      };
    }, phase);
    const page = await context.newPage();
    const modelRequests = [];
    page.on("request", (request) => {
      if (/vision_bundle|hand_landmarker|\/mediapipe\//.test(request.url()))
        modelRequests.push(request.url());
    });
    await page.goto(origin);
    const toggle = async () => {
      await page
        .getByRole("button", { name: "More tools", exact: true })
        .click();
      await page.getByRole("button", { name: "Hands", exact: true }).click();
    };
    await toggle();
    await page.waitForFunction(() => window.cameraRequests === 1);
    if (phase === "play failure") {
      await page
        .getByText(
          "Camera unavailable. Check permission, then turn Hands off and on.",
        )
        .waitFor();
      assert.equal(
        await page
          .locator(".hand-camera video")
          .evaluate((video) => video.srcObject),
        null,
      );
    } else {
      await page.waitForFunction(
        () => typeof window.finishCamera === "function",
      );
      await toggle();
      await page.locator(".hand-camera").waitFor({ state: "detached" });
      if (phase === "pending play")
        await page.waitForFunction(() => window.cameraStops === 1);
      await page.evaluate(() => window.finishCamera());
    }
    await page.waitForFunction(() => window.cameraStops === 1);
    assert.deepEqual(
      modelRequests,
      [],
      "Canceled startup loaded hand tracking",
    );
    console.log(`PASS camera cleanup: ${phase}`);
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
