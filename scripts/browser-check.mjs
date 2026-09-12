import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const output = resolve("output/browser-check");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "ihurt-browser-"));
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const origin = `http://127.0.0.1:${port}`;
const python = resolve(
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const server = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "backend.app:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-proxy-headers",
    "--no-access-log",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LLM_PROVIDER: "demo",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      XAI_API_KEY: "",
      LOCAL_MODEL: "",
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      APP_ENV: "development",
      SESSION_SECRET: "browser-check-only-".repeat(3),
      DATABASE_PATH: join(temporary, "quota.sqlite3"),
      DAILY_BUDGET_USD: "0",
      ALLOWED_ORIGINS: JSON.stringify([origin]),
      ALLOWED_HOSTS: '["127.0.0.1"]',
    },
  },
);
let serverLog = "";
server.stdout.on("data", (data) => {
  serverLog += data;
});
server.stderr.on("data", (data) => {
  serverLog += data;
});
let browser;
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    if (
      await fetch(`${origin}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (i === 100) throw new Error(`Test server did not start. ${serverLog}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  // Always launch a new headless browser. Never attach to a user's preview.
  browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--enable-unsafe-swiftshader"],
  });
  for (const viewport of [
    { width: 1440, height: 1050 },
    { width: 390, height: 844 },
  ]) {
    const name = viewport.width > 670 ? "desktop" : "phone";
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route(/^https?:/, (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    try {
      for (let load = 0; load < 2; load++) {
        if (load) await page.reload();
        else await page.goto(origin);
        await page
          .locator('[data-atlas="z-anatomy"][data-heat-engine="wasm"]')
          .waitFor();
        await page
          .getByRole("combobox", { name: "Map with" })
          .selectOption("demo");
        const layout = await page.evaluate(() => {
          return {
            width: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            columns: getComputedStyle(
              document.querySelector(".explorer-grid"),
            ).gridTemplateColumns.split(" ").length,
          };
        });
        assert.equal(layout.width, viewport.width);
        assert.equal(layout.overflow, false, `${name} layout overflows`);
        assert.equal(layout.columns, name === "desktop" ? 2 : 1);
        assert.equal(
          await page
            .getByRole("button", { name: "Landmarks", exact: true })
            .getAttribute("aria-pressed"),
          "false",
        );
      }
      await page.screenshot({
        path: join(output, `${name}.png`),
        animations: "disabled",
      });
      if (name === "desktop") {
        const box = await page.locator("canvas").boundingBox();
        const x = box.x + box.width / 2,
          y = box.y + box.height * 0.4;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 0; i < 3; i++) {
          await page.mouse.move(x + 120, y + 40, { steps: 10 });
          await page.mouse.move(x - 120, y + 80, { steps: 10 });
          await page.mouse.move(x, y, { steps: 10 });
        }
        await page.mouse.up();
        await page.mouse.click(x, y, { button: "right" });
        assert.equal(
          await page.locator(".pin-list").count(),
          0,
          "Dragging added a pin",
        );
        await page
          .getByRole("button", { name: "Reset view", exact: true })
          .click();
        await page.evaluate(
          () =>
            new Promise((done) =>
              requestAnimationFrame(() => requestAnimationFrame(done)),
            ),
        );
        await page.mouse.click(
          box.x + box.width * 0.44,
          box.y + box.height * 0.23,
        );
        await page.mouse.click(
          box.x + box.width * 0.56,
          box.y + box.height * 0.23,
        );
        await page.getByText("PINNED SPOTS · 2/6").waitFor();
        const note =
          "Both pinned spots feel tight when reaching overhead after tennis yesterday.";
        await page
          .getByRole("textbox", { name: "Describe your discomfort" })
          .fill(note);
        await page
          .getByRole("button", { name: "Make my map", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Explore related reading" })
          .waitFor();
        const downloaded = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Export map data (.json)" })
          .click();
        const file = await downloaded;
        const path = join(output, "example-map.json");
        await file.saveAs(path);
        const report = JSON.parse(await readFile(path, "utf8"));
        assert.equal(report.schema_version, 1);
        assert.equal(report.points.length, 2);
        assert.equal(report.note, note);
        assert.ok(report.references.length > 0);
        assert.equal(await page.evaluate(() => innerWidth), viewport.width);
        await page.screenshot({
          path: join(output, "two-pin-map.png"),
          fullPage: true,
        });
      }
      assert.deepEqual(errors, [], "Browser errors");
      assert.deepEqual(external, [], "The demo contacted an external service");
      console.log(
        `PASS ${name}: atlas, WASM, stable layout after refresh${name === "desktop" ? ", drag, two pins, note, JSON export" : ""}`,
      );
      await context.tracing.stop();
    } catch (error) {
      await page
        .screenshot({
          path: join(output, `${name}-failure.png`),
          fullPage: true,
        })
        .catch(() => {});
      await context.tracing.stop({ path: join(output, `${name}-trace.zip`) });
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  if (server.exitCode === null)
    await new Promise((done) => server.once("exit", done));
  await rm(temporary, { recursive: true, force: true });
}
