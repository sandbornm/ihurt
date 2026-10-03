import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

// Exercise the built app and real HTTP/session boundary with no live providers.
const temporary = await mkdtemp(join(tmpdir(), "ihurt-api-check-"));
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  "uv",
  [
    "run",
    "uvicorn",
    "backend.app:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-proxy-headers",
  ],
  {
    stdio: "pipe",
    env: {
      ...process.env,
      APP_ENV: "development",
      LLM_PROVIDER: "demo",
      TRANSCRIPTION_PROVIDER: "off",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      XAI_API_KEY: "",
      ELEVENLABS_API_KEY: "",
      LOCAL_MODEL: "",
      LOCAL_API_KEY: "",
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      SESSION_SECRET: "isolated-browser-check-not-a-deployment-secret",
      DATABASE_PATH: join(temporary, "quota.sqlite3"),
      ALLOWED_ORIGINS: JSON.stringify([origin]),
      ALLOWED_HOSTS: JSON.stringify(["127.0.0.1"]),
      DAILY_BUDGET_USD: "0",
      REQUESTS_PER_MINUTE: "60",
    },
  },
);
let browser;
let serverLog = "";
server.stderr.on("data", (data) => {
  serverLog = (serverLog + data).slice(-4000);
});
try {
  for (let attempt = 0; ; attempt++) {
    if (
      await fetch(origin)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (attempt > 600 || server.exitCode !== null)
      throw new Error(
        `Demo API server did not start. Run npm run build first.\n${serverLog}`,
      );
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [],
    external = [],
    assets = new Set();
  const cameraDiagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") cameraDiagnostics.push(message.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.ok() && new URL(r.url()).pathname.startsWith("/mediapipe/"))
      assets.add(new URL(r.url()).pathname);
  });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  // Observe the fake camera's tracks so stopping Hands is checked as well as starting it.
  await page.addInitScript(() => {
    window.testCameraTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      const stream = canvas.captureStream(24);
      const draw = () => {
        if (stream.getTracks().every((track) => track.readyState === "ended"))
          return;
        ctx.fillStyle = "#555555";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        requestAnimationFrame(draw);
      };
      draw();
      window.testCameraTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const document = await page.goto(origin);
  assert.match(document.headers()["permissions-policy"], /camera=\(self\)/);
  assert.equal(
    await page.evaluate(() => document.featurePolicy.allowsFeature("camera")),
    true,
  );
  await page
    .locator('[data-atlas="z-anatomy"][data-heat-engine="wasm"]')
    .waitFor();
  await page.getByRole("button", { name: "More tools", exact: true }).click();
  await page.getByRole("button", { name: "Hands", exact: true }).click();
  await page
    .getByText("Raise a hand", { exact: false })
    .first()
    .waitFor({ timeout: 30000 })
    .catch(async (error) => {
      console.error(
        "Camera diagnostics:",
        cameraDiagnostics,
        "Loaded assets:",
        [...assets],
        "Camera status:",
        await page.locator(".hand-camera").textContent(),
      );
      throw error;
    });
  for (const path of [
    "/mediapipe/hand_landmarker.task",
    "/mediapipe/wasm/vision_wasm_internal.js",
    "/mediapipe/wasm/vision_wasm_internal.wasm",
  ])
    assert.ok(assets.has(path), `Loaded ${path}`);
  await page.getByRole("button", { name: "More tools", exact: true }).click();
  await page.getByRole("button", { name: "Hands", exact: true }).click();
  await page.locator(".hand-camera").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      () =>
        window.testCameraTracks.length > 0 &&
        window.testCameraTracks.every((t) => t.readyState === "ended"),
    ),
    true,
  );

  const fixture = JSON.parse(
    await readFile("docs/examples/neck-tennis.json", "utf8"),
  );
  const result = await page.evaluate(async (note) => {
    const session = await fetch("/api/session");
    const settings = await session.json();
    const response = await fetch("/api/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        note,
        provider: "demo",
      }),
    });
    return {
      settings,
      status: response.status,
      cache: response.headers.get("cache-control"),
      result: await response.json(),
    };
  }, fixture.entries[0].note);
  assert.equal(result.status, 200);
  assert.equal(result.settings.provider, "demo");
  assert.deepEqual(
    result.settings.providers
      .filter((provider) => provider.available)
      .map((provider) => provider.id),
    ["demo"],
  );
  assert.equal(result.settings.transcription_available, false);
  assert.equal(result.cache, "no-store");
  assert.equal(result.result.map.regions.includes("neck"), true);
  assert.ok(result.result.activity_id);
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "ihurt_visitor");
  assert.equal(session?.httpOnly, true);
  assert.equal(session?.sameSite, "Strict");
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Python-served app: camera permission, bundled hand model/Wasm, camera stop, demo API session/map, HttpOnly cookie, no-store responses; no external requests or paid providers.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise((done) => server.once("exit", done));
    server.kill();
    await stopped;
  }
  await rm(temporary, { recursive: true, force: true });
}
