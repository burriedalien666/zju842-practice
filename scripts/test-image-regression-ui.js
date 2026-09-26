import fs from "node:fs";
import { legacyCatalog } from "../tests/fixtures/legacy-catalog.js";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-image-regression-"));
const base = path.resolve("public"),
  catalog = legacyCatalog();
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const origin = `http://127.0.0.1:${port}`,
  out = path.resolve(".test-artifacts/image-regression");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(dir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
let app, browser;
try {
  app = await createApp({
    dataDir: dir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir: base, launchToken: "image-regression" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1463, height: 900 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/image-regression");
  await page.locator(".site-header").waitFor();
  const saved = () =>
    page.waitForFunction(() =>
      document
        .querySelector("#save-status")
        ?.textContent.includes("已保存到本机"),
    );
  const state = async () =>
    (await context.request.get(origin + "/api/local/study")).json();
  await page.goto(origin + "/?q=" + encodeURIComponent("2015|九|(2)"));
  await page.locator("#reader .image-crop-frame").waitFor();
  const dimensions = await page
    .locator("#reader .image-crop-frame")
    .evaluate((el) => ({
      frame: el.getBoundingClientRect().toJSON(),
      image: el.querySelector("img").getBoundingClientRect().toJSON(),
      crop: JSON.parse(el.querySelector("img").dataset.contentCrop),
    }));
  assert.equal(dimensions.crop.originalHeight, 1333);
  assert.equal(dimensions.crop.height, 630);
  assert.ok(dimensions.frame.height < dimensions.image.height * 0.5);
  assert.ok(
    Math.abs(
      dimensions.frame.width / dimensions.crop.width -
        dimensions.image.width / 1070,
    ) < 0.001,
    "same pixel scale after crop",
  );
  await page.screenshot({
    path: path.join(out, "2015-trimmed.png"),
    fullPage: true,
  });
  await page.locator('#reader [data-action="zoom"]').first().click();
  await page.locator(".image-fit .image-crop-frame").waitFor();
  const fit = await page.locator(".image-fit .image-crop-frame").boundingBox();
  assert.ok(
    fit.x >= 0 &&
      fit.y >= 0 &&
      fit.y + fit.height <= 900 &&
      fit.x + fit.width <= 1463,
  );
  await page.locator('[data-action="original-image"]').click();
  assert.equal(await page.locator(".image-fit .image-crop-frame").count(), 0);
  await page.locator(".image-fit img").evaluate((im) => im.decode());
  assert.equal(
    await page.locator(".image-fit img").evaluate((im) => im.naturalHeight),
    1333,
  );
  await page.locator('[data-action="close-dialog"]').click();
  await page.waitForFunction(
    () => document.querySelector("#practice-time").textContent !== "00:00",
    {},
    { timeout: 5000 },
  );
  await page.locator('[data-action="timer-toggle"]').click();
  await saved();
  const before = (await state()).study;
  await page.locator('[data-action="timer-reset"]').click();
  assert.equal(await page.locator("#practice-time").innerText(), "00:00");
  assert.equal(await page.locator("#dialog").evaluate((el) => el.open), false);
  assert.equal(
    await page
      .locator('[data-action="timer-toggle"]')
      .getAttribute("aria-label"),
    "继续计时",
    "reset preserves pause state",
  );
  assert.deepEqual(
    (await state()).study,
    before,
    "chapter timer reset does not alter learning data",
  );
  await page.locator(".question-more summary").click();
  await page.locator('[data-action="add-list"]').click();
  await page.locator('#dialog [data-action="new-list"]').click();
  await page.locator("#list-form input").fill("回归题单");
  await page.locator("#list-form button").click();
  await page.locator(".question-more summary").click();
  await page.locator('[data-action="add-list"]').click();
  await page.locator('[data-action="toggle-list-item"]').click();
  await saved();
  assert.deepEqual((await state()).study.lists[0].ids, ["2015|九|(2)"]);
  await page.locator('[data-action="close-dialog"]').click();
  await page.locator('[data-action="toggle-answers"]').click();
  await page.locator('[data-action="edit-answer"]').click();
  await page
    .locator("#gallery")
    .setInputFiles(path.join(base, "questions/q-2015-22-29.webp"));
  await page.locator(".photo-card").waitFor();
  await page.locator('[data-action="publish"]').click();
  await page.locator('[data-action="close-editor"]').click();
  await page.locator("#answer-content img").waitFor();
  assert.equal(await page.locator(".answer-section").isVisible(), true);
  assert.equal(
    await page.locator("#answer-content .image-crop-frame").count(),
    0,
    "private answer photos are not automatically trimmed",
  );
  await page.locator('[data-action="star"]').click();
  await saved();
  await page.locator('[data-action="reader-back"]').click();
  await page.locator('#global-nav [data-action="status"]').click();
  await page.locator('#learning-scope [data-action="scope-back"]').click();
  assert.equal(await page.locator("#app.catalog-mode").count(), 1);
  assert.equal(await page.locator(".question-card").count(), 1);
  await page.locator(".saved-lists summary").click();
  await page.locator('[data-action="list"]').click();
  await page.locator(".question-card").click();
  await page.locator(".question-more summary").click();
  await page.locator('[data-action="remove-view"]').click();
  await saved();
  assert.deepEqual((await state()).study.lists[0].ids, []);
  assert.equal(
    (await state()).study.records["2015|九|(2)"].star,
    true,
    "removing from list does not unstar",
  );
  await page.locator('[data-action="reader-back"]').click();
  await page.locator('#learning-scope [data-action="scope-clear"]').click();
  assert.equal(await page.locator("#app.catalog-mode").count(), 1);
  assert.ok((await page.locator(".question-card").count()) > 1);
  await page.locator('#global-nav [data-action="papers"]').click();
  await page.locator('[data-action="open-paper"][data-year="2025"]').click();
  await page.locator('[data-action="grade-hard"]').click();
  await page.waitForFunction(
    () => document.querySelector("#practice-time").textContent !== "00:00",
    {},
    { timeout: 5000 },
  );
  await page.locator('[data-action="timer-toggle"]').click();
  await saved();
  const oldRun = (await state()).study.papers["2025"];
  await page.locator('[data-action="timer-reset"]').click();
  await saved();
  const newRun = (await state()).study.papers["2025"];
  assert.equal(newRun.elapsedMs, 0);
  assert.deepEqual(newRun.marks, oldRun.marks);
  assert.equal(newRun.started, oldRun.started);
  assert.equal(await page.locator("#dialog").evaluate((el) => el.open), false);
  assert.deepEqual(errors, []);
  console.log(
    "IMAGE/LEGACY UI PASS: 2015 whitespace collapsed without scaling; original view intact; direct timer reset; list create/add/remove; favorite scope returns list; private photo edit/save keeps answers expanded; paper reset preserves marks",
  );
} catch (error) {
  console.error(error);
  if (browser)
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
}
