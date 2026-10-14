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
  regions: [
    {
      id: "left_deltoid",
      anatomy_id: "left_shoulder",
      side: "left",
      name: "<img src=x onerror=alert(1)>",
      confidence: 0.82,
      sub_location: { id: "front", label: "<b>Front</b>", confidence: 0.9 },
    },
    {
      id: "lower_back",
      anatomy_id: "lower_back",
      side: null,
      name: "Lower back",
      confidence: 0.8,
      sub_location: { id: "lower", label: "Lower", confidence: 0.84 },
    },
    {
      id: "not_a_region",
      anatomy_id: "not_a_region",
      name: "<script>alert(1)</script>",
      confidence: 0.99,
    },
  ],
  side: { id: "right", label: "<i>Right</i>", confidence: 0.9 },
  pain_type: { id: "sharp", label: "<b>Sharp</b>", confidence: 0.9 },
  severity: { id: "moderate", label: "Moderate", confidence: 0.7 },
  pain_level: { band: "severe", label: "<b>Severe</b>", value: 6, confidence: 0.8 },
  radiation: {
    present: true,
    confidence: 0.86,
    regions: [
      {
        id: "left_thigh",
        anatomy_id: "left_thigh",
        side: "left",
        name: "<script>alert(1)</script>",
        confidence: 0.77,
      },
    ],
  },
  triggers: [
    { id: "movement", label: "<i>Movement</i>", confidence: 0.8 },
    { id: "rest", label: "Rest", confidence: 0.66 },
    { id: "pressure", label: "Pressure", confidence: 0.69 },
  ],
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
          results: [[{ transcript: "sharp pain in my left shoulder" }]],
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
  await page
    .getByText("Consider seeking care. This is not a diagnosis.", { exact: true })
    .waitFor();
  assert.equal(painPosts.length, 1);
  assert.equal(painPosts[0].consent, true);
  assert.match(painPosts[0].text, /left shoulder/);
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  await page.getByText("Left deltoid, front", { exact: true }).waitFor();
  await page.getByText("Lower back, right side", { exact: true }).waitFor();
  await page.getByText("Spreads to Left thigh", { exact: true }).waitFor();
  await page.getByText("Severe (6-7) · 6 / 10", { exact: true }).waitFor();
  const levelGroup = page.getByRole("radiogroup", { name: "Pain level" });
  await levelGroup.waitFor();
  assert.equal(
    await levelGroup.getByRole("radio", { name: "6", exact: true }).getAttribute("aria-checked"),
    "true",
  );
  const beforeLevel = await page
    .getByRole("slider", { name: "Reported intensity" })
    .getAttribute("aria-valuetext");
  assert.equal(beforeLevel, "Not recorded");
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  await levelGroup.getByRole("radio", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Use as level" }).click();
  const afterLevel = await page
    .getByRole("slider", { name: "Reported intensity" })
    .getAttribute("aria-valuetext");
  assert.equal(afterLevel, "7 out of 10");
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  await page.waitForFunction(() =>
    document
      .querySelector('[data-atlas="z-anatomy"]')
      ?.getAttribute("data-suggested")
      ?.includes("left_shoulder"),
  );
  const suggestionText = await page.locator(".pain-suggestion").innerText();
  assert.equal(suggestionText.includes("<"), false);
  assert.equal(suggestionText.includes("onerror"), false);
  assert.equal(suggestionText.includes("not_a_region"), false);
  assert.match(suggestionText, /Left deltoid, front/);
  assert.match(suggestionText, /Lower back, right side/);
  assert.match(suggestionText, /Spreads to Left thigh/);
  assert.equal(suggestionText.includes("Rest"), false);
  assert.equal(suggestionText.includes("Pressure"), false);
  assert.match(suggestionText, /Chest pain/);
  assert.match(
    suggestionText,
    /Consider seeking care\. This is not a diagnosis\./,
  );
  await page.getByRole("button", { name: "Show Left deltoid, front on the body" }).click();
  await page.getByText("AI SUGGESTION", { exact: true }).waitFor();
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  await page.getByRole("button", { name: "Add a pin for Left deltoid, front" }).click();
  const picker = page.getByRole("dialog", { name: "Choose anatomy layer" });
  await picker.waitFor();
  assert.equal(await page.getByText("PINNED SPOTS").count(), 0);
  await picker.getByRole("button", { name: "Pin this structure" }).click();
  await page.getByText("PINNED SPOTS · 1", { exact: true }).waitFor();
  assert.match(await page.locator(".pin-list").innerText(), /Left shoulder/);
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
    "PASS pain suggestion: speech fills text, mocked Jev stays off the page, highlight is not a pin until confirm, red-flag notice is plain text.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
