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
      .then((response) => response.ok)
      .catch(() => false));
    attempt++
  ) {
    if (attempt > 100 || server.exitCode !== null) throw Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const errors = [],
    unexpectedRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      unexpectedRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    window.webkit = { messageHandlers: { bridge: {} } };
    const listeners = new Map();
    const history = new Map();
    let callbackNumber = 0;
    window.nativeSpeechTest = {
      availability: { available: true },
      calls: [],
      session: "",
      finalText: "",
      failStart: false,
      holdStart: false,
      startFailure: undefined,
      lateEvents: undefined,
      microphoneRequests: 0,
      emit(name, data) {
        for (const listener of listeners.values())
          if (listener.name === name) listener.callback(data);
      },
      retainCallbacks() {
        const retained = [...history.values()];
        return (name, data) => {
          for (const listener of retained)
            if (listener.name === name) listener.callback(data);
        };
      },
      listenerCount: () => listeners.size,
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.nativeSpeechTest.microphoneRequests++;
      throw Error("Native dictation must not open a browser microphone.");
    };
    window.Capacitor = {
      PluginHeaders: [
        {
          name: "AppleSpeech",
          methods: [
            ...[
              "availability",
              "start",
              "stop",
              "cancel",
              "removeListener",
            ].map((name) => ({ name, rtype: "promise" })),
            { name: "addListener", rtype: "callback" },
          ],
        },
      ],
      nativeCallback(plugin, method, options, callback) {
        if (plugin !== "AppleSpeech" || method !== "addListener")
          throw Error(`Unexpected native callback: ${plugin}.${method}`);
        const id = String(++callbackNumber);
        const listener = { name: options.eventName, callback };
        listeners.set(id, listener);
        history.set(id, listener);
        return id;
      },
      async nativePromise(plugin, method, options) {
        if (plugin !== "AppleSpeech")
          throw Error(`Unexpected native call: ${plugin}.${method}`);
        const state = window.nativeSpeechTest;
        state.calls.push({ method, options });
        if (method === "availability") return { ...state.availability };
        if (method === "removeListener") {
          listeners.delete(options.callbackId);
          return;
        }
        if (method === "start") {
          state.session = options.session;
          if (state.failStart) throw Error("Microphone permission denied.");
          if (state.holdStart)
            await new Promise((_, reject) => (state.startFailure = reject));
          return;
        }
        if (method === "stop") return { text: state.finalText };
        if (method === "cancel") {
          state.startFailure?.(Error("Recording cancelled."));
          state.startFailure = undefined;
          return;
        }
        throw Error(`Unexpected native method: ${method}`);
      },
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const note = page.getByRole("textbox", { name: "Describe your discomfort" });
  await note.fill("An earlier observation.");
  await page.getByRole("button", { name: "Use voice", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Speak, then review" });
  const transcript = dialog.getByRole("textbox", { name: "Review transcript" });
  const record = () =>
    dialog.getByRole("button", { name: /^Record(?: again)?$/ });
  const stop = () => dialog.getByRole("button", { name: /^Stop ·/ });
  const emit = (name, data) =>
    page.evaluate(
      ({ name, data }) => {
        const state = window.nativeSpeechTest;
        state.emit(name, { session: state.session, ...data });
      },
      { name, data },
    );
  const expectText = (text) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector("#voice-transcript").value === expected,
      text,
    );
  const visibility = (state) =>
    page.evaluate((state) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: state,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await dialog
    .getByText("Apple speech recognition runs on your device.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.nativeSpeechTest.calls.some((call) => call.method === "start"),
    ),
    false,
  );
  await record().click();
  await stop().waitFor();
  await emit("transcript", { text: "My calf" });
  await expectText("My calf");
  await emit("transcript", { text: "My left calf feels tight" });
  await expectText("My left calf feels tight");
  assert.equal(await note.inputValue(), "An earlier observation.");
  const finalText =
    "My left calf feels tight, four out of ten. Activity: running.";
  await page.evaluate(
    (text) => (window.nativeSpeechTest.finalText = text),
    finalText,
  );
  await stop().click();
  await expectText(finalText);
  await record().waitFor();
  assert.equal(await transcript.isEnabled(), true);
  await page.waitForFunction(
    () => window.nativeSpeechTest.listenerCount() === 0,
  );

  await page.evaluate(() => (window.nativeSpeechTest.failStart = true));
  await record().click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Recording could not start" })
    .waitFor();
  assert.equal(await transcript.inputValue(), finalText);
  await page.waitForFunction(
    () => window.nativeSpeechTest.listenerCount() === 0,
  );
  await page.evaluate(() => (window.nativeSpeechTest.failStart = false));
  await record().click();
  await stop().waitFor();
  await emit("transcript", { text: "A discarded attempt" });
  await expectText("A discarded attempt");
  await page.evaluate(() => {
    const state = window.nativeSpeechTest;
    const session = state.session;
    const emit = state.retainCallbacks();
    state.lateEvents = () => {
      emit("transcript", { session, text: "Stale cancelled words" });
      emit("ended", { session, error: "Stale cancelled error" });
    };
  });
  await dialog
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await expectText(finalText);
  await page.evaluate(() => window.nativeSpeechTest.lateEvents());
  assert.equal(await transcript.inputValue(), finalText);
  assert.equal(await dialog.getByRole("alert").count(), 0);

  await page.evaluate(() => (window.nativeSpeechTest.holdStart = true));
  await record().click();
  await page.waitForFunction(() => !!window.nativeSpeechTest.startFailure);
  await dialog
    .getByRole("button", { name: "Cancel recording", exact: true })
    .click();
  await expectText(finalText);
  await page.waitForFunction(
    () => window.nativeSpeechTest.listenerCount() === 0,
  );
  await page.evaluate(() => (window.nativeSpeechTest.holdStart = false));
  await record().click();
  await stop().waitFor();
  await emit("transcript", { text: finalText });
  await emit("ended", {});
  await record().waitFor();
  assert.equal(await transcript.inputValue(), finalText);
  assert.equal(await transcript.isEnabled(), true);
  await page.waitForFunction(
    () => window.nativeSpeechTest.listenerCount() === 0,
  );

  await record().click();
  await stop().waitFor();
  await emit("transcript", { text: "Words before an interruption" });
  await emit("ended", {
    error: "Recording interrupted. Review the captured words.",
  });
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Recording interrupted" })
    .waitFor();
  assert.equal(await transcript.inputValue(), "Words before an interruption");
  await transcript.fill(finalText);
  await record().click();
  await stop().waitFor();
  await emit("transcript", { text: finalText });
  await visibility("hidden");
  await dialog
    .getByRole("alert")
    .filter({ hasText: "left the screen" })
    .waitFor();
  await page.waitForFunction(
    () => window.nativeSpeechTest.listenerCount() === 0,
  );
  await visibility("visible");
  await dialog.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(await transcript.inputValue(), finalText);

  await mkdir("output/ios-speech-check", { recursive: true });
  await page.screenshot({ path: "output/ios-speech-check/review-mobile.png" });
  await dialog
    .getByRole("button", { name: "Add to entry", exact: true })
    .click();
  assert.equal(
    await note.inputValue(),
    `An earlier observation.\n\n${finalText}`,
  );
  assert.equal(
    await page
      .getByRole("slider", { name: "Reported intensity", exact: true })
      .inputValue(),
    "4",
  );
  assert.equal(await page.locator("#activity").inputValue(), "running");
  assert.equal(
    await page.getByText("PINNED SPOTS · 1", { exact: true }).count(),
    0,
  );

  await page.evaluate(() => {
    window.nativeSpeechTest.availability = {
      available: false,
      reason: "Enable microphone access in Settings, then return to iHurt.",
    };
  });
  await page.getByRole("button", { name: "Use voice", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Settings" }).waitFor();
  assert.equal(await record().isDisabled(), true);
  const starts = await page.evaluate(
    () =>
      window.nativeSpeechTest.calls.filter((call) => call.method === "start")
        .length,
  );
  await transcript.fill("Keep this typed draft while updating permission.");
  await visibility("hidden");
  await page.evaluate(
    () => (window.nativeSpeechTest.availability = { available: true }),
  );
  await visibility("visible");
  await dialog.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(await record().isEnabled(), true);
  assert.equal(
    await transcript.inputValue(),
    "Keep this typed draft while updating permission.",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.nativeSpeechTest.calls.filter((call) => call.method === "start")
          .length,
    ),
    starts,
  );
  await record().click();
  await stop().waitFor();
  await dialog
    .getByRole("button", { name: "Close voice draft", exact: true })
    .click();
  await page.waitForFunction(
    () => window.nativeSpeechTest.listenerCount() === 0,
  );
  assert.equal(
    await page.evaluate(() => window.nativeSpeechTest.microphoneRequests),
    0,
  );
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS mocked Apple speech UI: partial replacement, final text, permission failure/retry, pending-start cancellation, automatic completion, interruption/background cleanup, and reviewed entry updates; no audio capture or API calls.",
  );
  await context.close();
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
