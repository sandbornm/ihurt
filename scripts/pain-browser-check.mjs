import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "pipe" },
);
let logs = "";
server.stderr.on("data", (chunk) => {
  logs += chunk;
});
server.stdout.on("data", (chunk) => {
  logs += chunk;
});

const suggestion = {
  // Region-like fields are ignored: Jev only suggests side and pain level now.
  regions: [
    {
      id: "left_deltoid",
      anatomy_id: "left_shoulder",
      side: "left",
      name: "<img src=x onerror=alert(1)>",
      confidence: 0.82,
    },
  ],
  side: { id: "right", label: "<i>Right</i>", confidence: 0.9 },
  pain_level: { band: "severe", label: "<b>Severe</b>", value: 6, confidence: 0.8 },
  red_flags: [{ id: "chest_pain", label: "<img>", confidence: 0.91 }],
  model: "jev-1.13.0",
};

function session(enabled) {
  return {
    provider: "demo",
    providers: [],
    remaining: 3,
    limit: 3,
    turn_limit: 6,
    turnstile_site_key: "",
    max_audio_seconds: 60,
    transcription_available: false,
    transcription_provider: null,
    pain_suggestions: enabled,
  };
}

let browser;
try {
  for (
    let attempt = 0;
    !(await fetch(origin)
      .then((response) => response.ok)
      .catch(() => false));
    attempt++
  ) {
    if (attempt > 100 || server.exitCode !== null) throw new Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const leaks = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    class FakeSpeech {
      start() {
        this.onresult?.({
          results: [[{ transcript: "sharp pain in my left shoulder about 7 out of 10" }]],
        });
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    window.SpeechRecognition = FakeSpeech;
    window.webkitSpeechRecognition = FakeSpeech;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  const painPosts = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", () => {
    throw new Error("Model text opened a dialog.");
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("typesafe") || url.includes("api.typesafe.ai"))
      leaks.push(url);
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      leaks.push(route.request().url());
      return route.abort();
    }
    if (url.pathname === "/api/session")
      return route.fulfill({ json: session(true) });
    if (url.pathname === "/api/pain" && route.request().method() === "POST") {
      painPosts.push(route.request().postDataJSON());
      return route.fulfill({ json: { suggestion } });
    }
    return route.fulfill({ status: 404, json: { detail: "Not used." } });
  });
  await page.goto(origin);
  const atlas = page.locator('[data-atlas="z-anatomy"]');
  await atlas.waitFor();
  await page.getByText("Pain suggestion", { exact: true }).click();
  await page.getByRole("button", { name: "Start speech" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#pain-description") instanceof HTMLTextAreaElement &&
      document.querySelector("#pain-description").value.includes("left shoulder"),
  );
  assert.equal(painPosts.length, 0);
  await page.getByRole("checkbox", { name: /TypeSafe/ }).check();
  await page.getByRole("button", { name: "Suggest", exact: true }).click();
  await page.getByText("AI suggestion", { exact: true }).waitFor();
  assert.equal(painPosts.length, 1);
  assert.equal(painPosts[0].consent, true);
  assert.match(painPosts[0].text, /left shoulder/);
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  await page.getByText("Right side", { exact: true }).waitFor();
  await page.getByText("AI band: Severe (6-7)", { exact: true }).waitFor();
  const beforeLevel = await page
    .getByRole("slider", { name: "Reported intensity" })
    .getAttribute("aria-valuetext");
  assert.equal(beforeLevel, "Not recorded");
  await page.getByRole("button", { name: "Use stated level (7/10)" }).click();
  const afterLevel = await page
    .getByRole("slider", { name: "Reported intensity" })
    .getAttribute("aria-valuetext");
  assert.equal(afterLevel, "7 out of 10");
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  const suggested = await page
    .locator('[data-atlas="z-anatomy"]')
    .getAttribute("data-suggested");
  assert.equal(Boolean(suggested && suggested.includes("left_shoulder")), false);
  const suggestionText = await page.locator(".pain-suggestion").innerText();
  assert.equal(suggestionText.includes("<"), false);
  assert.equal(suggestionText.includes("onerror"), false);
  assert.equal(suggestionText.includes("deltoid"), false);
  assert.equal(suggestionText.includes("Chest pain"), false);
  assert.equal(await page.getByRole("button", { name: /on the body$/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^Add a pin for/ }).count(), 0);
  assert.equal(leaks.length, 0);
  assert.deepEqual(errors, []);

  const narrow = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const phone = await narrow.newPage();
  phone.setDefaultTimeout(60000);
  await phone.route("**/api/**", (route) => route.fulfill({ json: session(false) }));
  await phone.goto(origin);
  await phone.getByText("Pain suggestion", { exact: true }).click();
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, true);
  await phone.getByLabel("Describe the pain").fill("Left calf is burning after a run.");
  await phone.getByRole("checkbox", { name: /TypeSafe/ }).check();
  await phone.getByRole("button", { name: "Suggest", exact: true }).click();
  await phone.getByText("Suggestions are off on this server.", { exact: true }).waitFor();
  assert.equal(await phone.getByText("PINNED SPOTS").count(), 0);
  await narrow.close();
  console.log(
    "PASS pain suggestion: speech fills text, Jev shows side and level only, no region highlight or pin from Jev.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
