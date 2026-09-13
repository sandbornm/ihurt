import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
const input = process.argv[2] ?? "docs/examples/neck-tennis.json";
const output = process.argv[3] ?? "output/pdf/neck-tennis.pdf";
await mkdir("output/pdf", { recursive: true });
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
    if (i > 100) throw Error("Preview unavailable");
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin && !url.pathname.startsWith("/api/")
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(origin);
  await page.getByRole("button", { name: /^Notebook/ }).click();
  await page.locator("input[type=file]").setInputFiles(input);
  await page.getByText("Imported 1 entry.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Open entry", exact: true })
    .first()
    .click();
  await page.locator('[data-atlas="z-anatomy"]').waitFor();
  await page.locator(".notebook-pin > button").first().click();
  const picturePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Map image", exact: true }).click();
  const picture = await picturePromise;
  await picture.saveAs(output.replace(/\.pdf$/, ".png"));
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  const popup = await popupPromise;
  await popup.locator("figure img").waitFor();
  await popup.waitForFunction(
    () => document.querySelector("figure img")?.naturalWidth > 0,
  );
  await popup.pdf({
    path: output,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font-size:9px;width:100%;text-align:center;color:#75806b">iHurt · Personal journal · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { bottom: "18mm" },
  });
  if (!process.argv[2])
    await writeFile("docs/examples/neck-tennis.pdf", await readFile(output));
  console.log(`Saved ${output} from the rendered viewport. No AI calls.`);
} finally {
  await browser?.close();
  server.kill();
}
