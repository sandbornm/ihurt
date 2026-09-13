import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
const output = "output/fictional";
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
const examples = [
  {
    id: "desk-shoulders",
    title: "Fictional · Desk shoulders",
    activity: "Desk work",
    muscle: "trapezius",
    note: "A tight patch across my left shoulder after an afternoon at my desk. I notice it when reaching for the mouse.",
    comment: "Feels stiff across this area after sitting.",
    intensity: 5,
  },
  {
    id: "running-calf",
    title: "Fictional · After a run",
    activity: "Running",
    muscle: "gastrocnemius",
    note: "My calf feels sore after a longer run than usual. I notice it most when walking upstairs.",
    comment: "A dull ache here after running.",
    intensity: 6,
  },
  {
    id: "gaming-forearm",
    title: "Fictional · Gaming break",
    activity: "Gaming",
    muscle: "extensor carpi radialis",
    note: "An ache along my forearm after a long gaming session. It is more noticeable while gripping the mouse.",
    comment: "This patch feels tired when gripping.",
    intensity: 4,
  },
];
let browser;
try {
  for (
    let i = 0;
    !(await fetch(origin)
      .then((r) => r.ok)
      .catch(() => false));
    i++
  ) {
    if (i > 100) throw Error("Preview unavailable");
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: output, size: { width: 1920, height: 1080 } },
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin && !url.pathname.startsWith("/api/")
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const start = Date.now(),
    clips = [];
  await page.goto(origin);
  const atlas = page.locator('[data-atlas="z-anatomy"]');
  await atlas.waitFor();
  for (const [index, example] of examples.entries()) {
    if (index) {
      await page
        .getByRole("button", { name: "New entry", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#pain-note")?.value === "",
      );
    }
    await atlas.waitFor();
    await page
      .getByRole("textbox", { name: "Describe your discomfort" })
      .waitFor();
    const clipStart = (Date.now() - start) / 1000;
    await page.locator("#entry-title").fill(example.title);
    await page.locator("#activity").fill(example.activity);
    await page
      .getByRole("textbox", { name: "Describe your discomfort" })
      .fill(example.note);
    await page
      .getByRole("button", { name: "Muscle list", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Find a muscle" })
      .fill(example.muscle);
    const choices = page.locator(".muscle-browser-list button");
    const left = choices.filter({ hasText: "Left" });
    await ((await left.count()) ? left.first() : choices.first()).click();
    await page
      .getByRole("button", { name: "Add pin to muscle", exact: true })
      .click();
    const picker = page.getByRole("dialog", { name: "Choose anatomy layer" });
    await picker.waitFor();
    await picker.getByRole("button", { name: "Pin this structure" }).click();
    await page
      .getByRole("textbox", { name: "Note for spot 1", exact: true })
      .fill(example.comment);
    const intensity = page.getByRole("slider", {
      name: "Reported intensity",
      exact: true,
    });
    for (const number of [2, 4, example.intensity]) {
      await intensity.fill(String(number));
      await page.waitForTimeout(650);
    }
    await page.locator(".anatomy-stage").scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "Explore layers at spot 1", exact: true })
      .click();
    await picker.waitFor();
    if (
      await picker
        .getByRole("button", { name: "Spread layers", exact: true })
        .count()
    ) {
      await picker
        .getByRole("button", { name: "Spread layers", exact: true })
        .click();
      await page.waitForTimeout(1800);
      const layers = picker.locator(".layer-choices button");
      for (let n = 0; n < Math.min(3, await layers.count()); n++) {
        await layers.nth(n).hover();
        await page.waitForTimeout(1100);
      }
      await picker.getByRole("slider", { name: "Layer separation" }).fill("1");
      await page.waitForTimeout(1100);
      await picker.evaluate((element) => (element.scrollTop = 0));
      await page.screenshot({ path: `${output}/${example.id}-layers.png` });
    }
    await picker.getByRole("button", { name: "Close layers" }).click();
    await page.waitForTimeout(1400);
    await page
      .getByRole("checkbox", { name: "Show bones", exact: true })
      .uncheck();
    await page.waitForTimeout(1000);
    if (index === 0) {
      await page
        .getByRole("button", { name: "Highlight", exact: true })
        .click();
      const canvas = atlas.locator("canvas");
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.46);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width * 0.54,
        box.y + box.height * 0.54,
        { steps: 20 },
      );
      await page.mouse.up();
      await page.waitForTimeout(800);
      if ((await page.locator(".notebook-pin").count()) > 1) {
        await page.getByRole("button", { name: "Undo last mark" }).click();
        await page.waitForTimeout(700);
        await page.getByRole("button", { name: "Redo last mark" }).click();
      }
      await page.getByRole("button", { name: "Turn", exact: true }).click();
    }
    await page.evaluate(() =>
      window.scrollTo({ top: 130, behavior: "smooth" }),
    );
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${output}/${example.id}.png` });
    await page.getByRole("button", { name: "Save entry", exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    await (await downloaded).saveAs(`docs/examples/${example.id}.json`);
    const png = page.waitForEvent("download");
    await page.getByRole("button", { name: "Map image", exact: true }).click();
    await (await png).saveAs(`${output}/${example.id}-map.png`);
    await page.locator(".anatomy-stage").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    clips.push({
      id: example.id,
      start: clipStart,
      end: (Date.now() - start) / 1000,
    });
    console.log(`Recorded ${example.id}.`);
  }
  const video = page.video();
  await context.close();
  await video.saveAs(`${output}/raw.webm`);
  await writeFile(`${output}/clips.json`, JSON.stringify(clips, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
