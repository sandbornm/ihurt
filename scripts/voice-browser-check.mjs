import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium } from "playwright";

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
server.stderr.on("data", (data) => (logs += data));
let browser;
try {
  for (
    let attempt = 0;
    !(await fetch(origin)
      .then((r) => r.ok)
      .catch(() => false));
    attempt++
  ) {
    if (attempt > 100 || server.exitCode !== null) throw Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 390, height: 844 },
  });
  let uploads = 0;
  let configured = true;
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/session")
      return route.fulfill({
        json: {
          transcription_available: configured,
          transcription_provider: configured ? "ElevenLabs" : null,
          max_audio_seconds: 60,
          turnstile_site_key: "",
        },
      });
    if (url.pathname === "/api/transcribe") {
      uploads++;
      assert.match(
        route.request().headers()["content-type"],
        /^multipart\/form-data/,
      );
      const body = route.request().postDataBuffer();
      assert.ok(body.includes(Buffer.from("RIFF")));
      assert.ok(body.includes(Buffer.from('name="consent"\r\n\r\ntrue')));
      return route.fulfill({
        json: {
          text: "My left calf feels tight, four out of ten. Activity: running. Duration: since yesterday.",
        },
      });
    }
    if (url.pathname.startsWith("/api/"))
      throw Error(`Unexpected API request: ${url.pathname}`);
    return route.continue();
  });
  await context.addInitScript(() => {
    window.testTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await audio.resume();
      const stream = destination.stream;
      const track = stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop();
        if (audio.state !== "closed") void audio.close();
      };
      window.testTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const note = page.getByRole("textbox", { name: "Describe your discomfort" });
  await note.fill("An earlier observation.");
  await page
    .getByRole("slider", { name: "Reported intensity", exact: true })
    .fill("7");
  await page.getByRole("button", { name: "Use voice", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Speak, then review" });
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await dialog
    .getByRole("button", { name: /Stop & transcribe/ })
    .waitFor()
    .catch(async (error) => {
      console.error(await dialog.innerText(), errors);
      throw error;
    });
  await page.waitForTimeout(700);
  await dialog.getByRole("button", { name: /Stop & transcribe/ }).click();
  await dialog.getByRole("checkbox", { name: /intensity: 4/ }).waitFor();
  assert.equal(uploads, 1);
  assert.equal(await note.inputValue(), "An earlier observation.");
  assert.equal(
    await dialog.getByRole("checkbox", { name: /intensity: 4/ }).isChecked(),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      window.testTracks.every((track) => track.readyState === "ended"),
    ),
    true,
  );
  await mkdir("output/voice-check", { recursive: true });
  await page.screenshot({ path: "output/voice-check/review-mobile.png" });
  await dialog
    .getByRole("button", { name: "Add to entry", exact: true })
    .click();
  assert.match(
    await note.inputValue(),
    /^An earlier observation\.\n\nMy left calf/,
  );
  assert.equal(
    await page
      .getByRole("slider", { name: "Reported intensity", exact: true })
      .inputValue(),
    "7",
  );
  assert.equal(await page.locator("#activity").inputValue(), "running");
  assert.equal(
    await page.getByText("PINNED SPOTS · 1", { exact: true }).count(),
    0,
  );

  await page.getByRole("button", { name: "Use voice", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Review transcript" })
    .fill("Keep this edited transcript.");
  await dialog
    .getByRole("button", { name: "Record again", exact: true })
    .click();
  await dialog.getByRole("button", { name: /Stop & transcribe/ }).waitFor();
  await dialog
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "Review transcript" })
      .inputValue(),
    "Keep this edited transcript.",
  );
  assert.equal(uploads, 1);
  await dialog
    .getByRole("button", { name: "Record again", exact: true })
    .click();
  await dialog.getByRole("button", { name: /Stop & transcribe/ }).waitFor();
  await dialog
    .getByRole("button", { name: "Close voice draft", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() =>
      window.testTracks.every((track) => track.readyState === "ended"),
    ),
    true,
  );
  assert.equal(uploads, 1);

  configured = false;
  await page.getByRole("button", { name: "Use voice", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Record", exact: true })
      .isDisabled(),
    true,
  );
  await dialog
    .getByRole("textbox", { name: "Review transcript" })
    .fill("A typed observation.");
  await dialog
    .getByRole("button", { name: "Add to entry", exact: true })
    .click();
  assert.match(await note.inputValue(), /A typed observation\.$/);
  assert.deepEqual(errors, []);
  console.log(
    "Voice review, field preservation, cancellation, microphone cleanup, and offline transcript checks passed.",
  );
  await context.close();
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
