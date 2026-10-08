import assert from "node:assert/strict";

async function reachable(control) {
  assert.equal(
    await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.top >= 0 &&
        box.bottom <= innerHeight &&
        (hit === element || element.contains(hit))
      );
    }),
    true,
    "Pin confirmation must be visible and unobstructed without scrolling to it",
  );
}

// Run only in the fresh contexts created by ios-browser-check.mjs.
export async function checkTouchLayout(page, context, output) {
  const atlas = page.locator('[data-atlas="z-anatomy"]');
  const canvas = atlas.locator("canvas[data-engine]");
  await canvas.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const box = await canvas.boundingBox();
  const beforeImage = await canvas.screenshot();
  const scrollY = await page.evaluate(() => window.scrollY);
  const touch = await context.newCDPSession(page);
  try {
    // Swipe alongside the canvas, inside the body panel. The page must move
    // without rotating the body or creating a mark.
    const x = box.x - 16;
    const startY = box.y + box.height * 0.8;
    // Explicit touch events work on both Linux and macOS. Chromium's
    // synthesized scroll gesture produced no page movement on the Linux runner.
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY, id: 1 }],
    });
    for (let step = 1; step <= 12; step++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: startY - step * 12.5, id: 1 }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForFunction(
      (before) => window.scrollY > before + 30,
      scrollY,
      { timeout: 5000 },
    );
  } catch (error) {
    await page.screenshot({ path: `${output}/touch-scroll-failure.png` });
    throw error;
  } finally {
    await touch.detach();
  }
  assert.deepEqual(
    await canvas.screenshot(),
    beforeImage,
    "Page scrolling turned the body",
  );
  assert.equal(await page.locator(".notebook-pin").count(), 0);

  await page.getByRole("button", { name: "Find a region" }).click();
  const search = page.getByRole("textbox", { name: "Search body regions" });
  assert.ok(
    await search.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 16,
    ),
  );
  await search.fill("neck");
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(
    await search.evaluate((el) => document.activeElement === el),
    true,
  );
  await search.press("Enter");
  assert.equal(
    await search.evaluate((el) => document.activeElement === el),
    false,
  );
  // Finishing a search must not report a location until the person chooses it.
  assert.equal(
    await page
      .getByRole("button", { name: "Add pin in selected region" })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Neck", exact: true }).click();
  await page
    .getByRole("button", { name: "Add pin in selected region" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose anatomy layer" });
  const confirm = picker.getByRole("button", { name: "Pin this structure" });
  await picker.waitFor();
  await reachable(confirm);
  const choices = picker.locator(".layer-choices button");
  assert.ok(
    (await choices.count()) > 1,
    "Exercise a list with overlapping surfaces",
  );
  await choices.last().click();
  await reachable(confirm);
  await picker
    .getByRole("button", { name: "Spread layers", exact: true })
    .click();
  await picker.getByRole("slider", { name: "Layer separation" }).fill("1");
  await reachable(confirm);
  await picker.screenshot({ path: `${output}/pin-picker-spread.png` });
  await picker
    .getByRole("button", { name: "Spread layers", exact: true })
    .click();
  // Exercise keyboard selection after the list has scrolled, too.
  await choices.first().focus();
  await choices.first().press("Enter");
  const chosen = await choices
    .first()
    .locator("span")
    .nth(1)
    .evaluate((el) => el.firstChild.textContent);
  // Passing over another row on the way to Pin must not change the selection.
  await choices.last().hover();
  assert.equal(await choices.first().getAttribute("aria-pressed"), "true");
  await reachable(confirm);
  await picker.screenshot({ path: `${output}/pin-picker.png` });
  await confirm.click();
  const pin = page.locator(".notebook-pin");
  assert.equal(await pin.count(), 1);
  assert.equal(await pin.locator("button small").textContent(), chosen);
  for (const name of ["Describe your discomfort", "Note for spot 1"]) {
    const editor = page.getByRole("textbox", { name });
    await editor.focus();
    assert.ok(
      await editor.evaluate(
        (el) => parseFloat(getComputedStyle(el).fontSize) >= 16,
      ),
    );
  }
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  assert.doesNotMatch(
    await page.locator('meta[name="viewport"]').getAttribute("content"),
    /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/,
  );
  // Restore a blank draft so the existing import/export scenario is independent.
  await page
    .getByRole("button", { name: "Remove spot 1", exact: true })
    .click();
  await page.getByRole("button", { name: "New entry", exact: true }).click();
}
