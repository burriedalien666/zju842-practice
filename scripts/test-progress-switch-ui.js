import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-switch-ui-"));
const baseDir = path.resolve("public"),
  catalog = loadCatalog(path.join(baseDir, "catalog.json"), baseDir);
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const origin = `http://127.0.0.1:${port}`,
  out = path.resolve(".test-artifacts/progress-switch");
fs.mkdirSync(out, { recursive: true });
let app, browser;
try {
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: "switch-ui" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1463, height: 724 },
    deviceScaleFactor: 1.75,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/switch-ui");
  const toggle = page.locator('[data-action="progress-toggle"]'),
    summary = page.locator("#chapter-shortcuts summary");
  await toggle.waitFor();
  const initial = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  async function checkAndCapture(name) {
    const state = await toggle.evaluate((el) => {
      const style = getComputedStyle(el),
        track = el.querySelector(".progress-track"),
        thumb = el.querySelector(".progress-thumb");
      const r = el.getBoundingClientRect(),
        t = track.getBoundingClientRect(),
        b = thumb.getBoundingClientRect();
      const summary = el.closest("#chapter-shortcuts").querySelector("summary"),
        s = summary.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        decoration: style.textDecorationLine,
        arrow: getComputedStyle(summary, "::after").content,
        button: r.toJSON(),
        summary: s.toJSON(),
        track: t.toJSON(),
        thumb: b.toJSON(),
        radius: getComputedStyle(thumb).borderRadius,
      };
    });
    assert.equal(state.background, "rgba(0, 0, 0, 0)");
    assert.equal(state.decoration, "none");
    assert.equal(state.arrow, "none");
    assert.ok(
      state.summary.right <= state.button.x + 1,
      "separate non-overlapping header columns",
    );
    assert.equal(state.track.width, 44);
    assert.equal(state.track.height, 24);
    assert.equal(state.thumb.width, 20);
    assert.equal(state.thumb.height, 20);
    assert.ok(
      state.thumb.x >= state.track.x && state.thumb.right <= state.track.right,
    );
    assert.equal(state.radius, "50%");
    const box = await page.locator("#chapter-shortcuts").boundingBox();
    await page.screenshot({
      path: path.join(out, name + ".png"),
      clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: 52 },
    });
    return state;
  }
  if ((await toggle.getAttribute("aria-checked")) === "true")
    await toggle.click();
  await page.mouse.move(700, 80);
  await checkAndCapture("off");
  await toggle.hover();
  await checkAndCapture("off-hover");
  assert.equal(await page.locator(".nav-progress").first().isVisible(), false);
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-action="progress-toggle"]')
        .getAttribute("aria-checked") === "true",
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".progress-thumb")).transform ===
      "matrix(1, 0, 0, 1, 20, 0)",
  );
  await checkAndCapture("on-hover");
  await page.mouse.move(700, 80);
  await checkAndCapture("on");
  assert.equal(await page.locator(".nav-progress").first().isVisible(), true);
  await summary.click();
  assert.equal(
    await page.locator("#chapter-shortcuts details").evaluate((el) => el.open),
    false,
  );
  await toggle.click();
  assert.equal(
    await page.locator("#chapter-shortcuts details").evaluate((el) => el.open),
    false,
    "progress switch must not expand directory",
  );
  await summary.click();
  await toggle.focus();
  await page.keyboard.press("Space");
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  assert.equal(
    await toggle.evaluate((el) => document.activeElement === el),
    true,
    "keyboard focus survives rerender",
  );
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await page.locator('[data-action="theme-toggle"]:visible').click();
  await toggle.hover();
  await checkAndCapture("dark-on-hover");
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await checkAndCapture("width-" + width);
  }
  assert.deepEqual(
    await (await context.request.get(origin + "/api/local/study")).json(),
    initial,
    "display preference does not change study",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PROGRESS SWITCH UI PASS: on/off/hover/dark, no stray arrow or background, separated layout, round 44x24 track/20px thumb, directory collapse independent, keyboard and persistence, 1463/900/390 widths",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
}
