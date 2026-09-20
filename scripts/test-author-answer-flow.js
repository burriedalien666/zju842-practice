import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { extractAnswers, answerFiles } from "../server/answer-packs.js";
import packageInfo from "../package.json" with { type: "json" };

// Real browser, HTTP, SQLite and answer ZIP; all images and user data are fixtures.
// This tests a downloaded manual answer update, not GitHub publication/transport.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-author-answer-flow-"));
const out = path.resolve(".test-artifacts/author-answer-flow");
const baseDir = path.resolve("public");
const catalog = loadCatalog(path.join(baseDir, "catalog.json"), baseDir);
const [first, second] = catalog.questions;
const apps = [];
const errors = [];
const report = { version: packageInfo.version, scenarios: [], passed: false };
fs.mkdirSync(out, { recursive: true });
let browser;

async function fixture(name, format, width, height, color) {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: color },
  })
    [format]()
    .toBuffer();
  return { name, mimeType: `image/${format}`, buffer };
}

async function start(name) {
  const reserve = net.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = path.join(temp, name);
  fs.mkdirSync(dataDir);
  fs.writeFileSync(
    path.join(dataDir, "update-settings.json"),
    JSON.stringify({ autoCheck: false }),
  );
  const app = await createApp({
    dataDir,
    catalog: structuredClone(catalog),
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: name },
  });
  apps.push(app);
  await app.listen({ host: "127.0.0.1", port });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  await page.goto(`${origin}/__open/${name}`);
  await page.locator(".site-header").waitFor();
  const json = async (url) => {
    const response = await context.request.get(origin + url);
    assert.equal(response.status(), 200, `GET ${url}`);
    return response.json();
  };
  return {
    page,
    context,
    origin,
    json,
    answer: (id) => json(`/api/admin/answers/${encodeURIComponent(id)}`),
  };
}

async function openQuestion(client, id) {
  await client.page.goto(`${client.origin}/?q=${encodeURIComponent(id)}`);
  await client.page.locator('[data-action="toggle-answers"]').click();
  await client.page.locator("#answer-content").waitFor();
}

async function edit(client) {
  await client.page.locator('[data-action="edit-answer"]').click();
  await client.page.locator("#gallery").waitFor({ state: "attached" });
}

async function idle(page) {
  await page.waitForFunction(
    () => !document.querySelector("#dialog")?.classList.contains("busy"),
  );
}

async function upload(client, images, count, selector = "#gallery") {
  await client.page.locator(selector).setInputFiles(images);
  await client.page.waitForFunction(
    (expected) =>
      !document.querySelector("#dialog")?.classList.contains("busy") &&
      document.querySelectorAll(".photo-card").length === expected,
    count,
  );
}

async function mutation(client, selector, suffix, status = 200) {
  const response = client.page.waitForResponse(
    (r) => r.url().includes("/api/admin/answers/") && r.url().endsWith(suffix),
  );
  await client.page.locator(selector).click();
  assert.equal((await response).status(), status, suffix);
  await idle(client.page);
}

async function saved(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status")?.textContent === "已保存到本机",
  );
}

async function metadata(client, id) {
  const response = await client.context.request.get(
    `${client.origin}/api/media/${id}`,
  );
  assert.equal(response.status(), 200);
  return sharp(await response.body()).metadata();
}

function pass(message) {
  report.scenarios.push(message);
  console.log(`PASS: ${message}`);
}

try {
  assert.ok(
    fs.existsSync(path.resolve("dist/index.html")),
    "Run npm run build first",
  );
  assert.ok(first && second, "Two catalog questions are required");
  const png = await fixture("author-first.png", "png", 80, 48, "#217c50");
  const jpeg = await fixture("author-second.jpeg", "jpeg", 64, 96, "#315bbe");
  const webp = await fixture(
    "author-replacement.webp",
    "webp",
    72,
    40,
    "#f09c38",
  );
  const privateImage = await fixture(
    "private-draft.webp",
    "webp",
    52,
    36,
    "#8151b0",
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const author = await start("author-fixture");
  await openQuestion(author, first.id);
  await edit(author);
  await upload(author, [png, jpeg], 2);
  const uploaded = await author.answer(first.id);
  assert.equal(uploaded.draft.length, 2);
  assert.equal(uploaded.published.length, 0);
  assert.equal((await metadata(author, uploaded.draft[0])).width, 80);
  assert.equal((await metadata(author, uploaded.draft[1])).height, 96);

  await mutation(author, '[data-action="photo-up"][data-index="1"]', "/draft");
  assert.deepEqual(
    (await author.answer(first.id)).draft,
    [...uploaded.draft].reverse(),
  );
  await mutation(
    author,
    '.photo-card:first-child [data-action="photo-rotate"]',
    `/rotate/${uploaded.draft[1]}`,
  );
  const rotated = await author.answer(first.id);
  assert.notEqual(rotated.draft[0], uploaded.draft[1]);
  const rotatedSize = await metadata(author, rotated.draft[0]);
  assert.equal(rotatedSize.width, 96);
  assert.equal(rotatedSize.height, 64);
  const replacement = author.page.waitForResponse((r) =>
    r.url().includes("/photos?replace="),
  );
  await upload(author, webp, 2, '.replace-photo[data-index="1"]');
  assert.equal((await replacement).status(), 200);
  await idle(author.page);
  const replaced = await author.answer(first.id);
  assert.notEqual(replaced.draft[1], uploaded.draft[0]);
  assert.equal((await metadata(author, replaced.draft[1])).width, 72);
  await mutation(author, '[data-action="publish"]', "/publish");
  const finalized = await author.answer(first.id);
  assert.deepEqual(finalized.published, replaced.draft);
  await author.page.locator('[data-action="close-editor"]').click();
  await author.page.locator("#answer-content img").first().waitFor();
  await author.page.reload();
  await author.page.locator('[data-action="toggle-answers"]').click();
  await author.page.locator("#answer-content img").first().waitFor();
  assert.equal(await author.page.locator("#answer-content img").count(), 2);
  await edit(author);
  assert.equal(await author.page.locator(".photo-card").count(), 2);
  assert.deepEqual(await author.answer(first.id), finalized);
  await author.page.screenshot({
    path: path.join(out, "author-finalized.png"),
    fullPage: true,
  });
  pass(
    "PNG/JPEG import, photo reorder, rotation, WebP replacement and finalized images persist after reopening",
  );

  const badResponse = author.page.waitForResponse((r) =>
    r.url().endsWith(`/answers/${encodeURIComponent(first.id)}/photos`),
  );
  await author.page.locator("#gallery").setInputFiles({
    name: "corrupt.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image; private fixture only"),
  });
  const rejected = await badResponse;
  assert.equal(rejected.status(), 400);
  assert.match((await rejected.json()).error, /图片无法读取/);
  await idle(author.page);
  assert.deepEqual(await author.answer(first.id), finalized);
  assert.equal(await author.page.locator(".photo-card").count(), 2);
  pass(
    "Corrupt PNG is rejected through the upload UI; finalized and draft image lists are unchanged",
  );
  await author.page.locator('[data-action="close-editor"]').click();

  await openQuestion(author, second.id);
  await edit(author);
  await upload(author, privateImage, 1);
  const privateDraft = await author.answer(second.id);
  assert.equal(privateDraft.published.length, 0);
  await author.page.locator('[data-action="close-editor"]').click();
  await author.page.locator('[data-action="star"]').click();
  await author.page.locator('[data-action="grade-hard"]').click();
  await saved(author.page);
  await author.page.locator('[data-action="reader-back"]').click();
  await author.page.locator('[data-action="admin"]').click();
  await author.page.locator('[data-action="local-export-answers"]').click();
  await author.page.locator("#export-pack-form").waitFor();
  const choices = author.page.locator('#export-pack-form input[name="ids"]');
  assert.deepEqual(
    await choices.evaluateAll((els) => els.map((el) => el.value)),
    [first.id],
  );
  await choices.check();
  await author.page
    .locator('#export-pack-form input[name="revision"]')
    .fill("1");
  await author.page
    .locator('#export-pack-form input[name="edition"]')
    .fill("作者到使用者答案链路测试");
  const downloadEvent = author.page.waitForEvent("download");
  await author.page.locator("#export-pack-form button").click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.842answers$/);
  const pack = path.join(temp, "exported.842answers");
  await download.saveAs(pack);
  assert.equal(await download.failure(), null);
  const extractedDir = path.join(temp, "extracted");
  const manifest = await extractAnswers(pack, extractedDir);
  assert.equal(manifest.revision, 1);
  assert.deepEqual(Object.keys(manifest.answers), [first.id]);
  assert.deepEqual(
    manifest.answers[first.id],
    finalized.published.map((id) => `answers/${id}.webp`),
  );
  assert.equal(answerFiles(manifest).size, 3);
  const extractedFiles = fs
    .readdirSync(extractedDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(extractedDir, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/"),
    );
  assert.deepEqual(extractedFiles.sort(), [...answerFiles(manifest)].sort());
  assert.ok(!JSON.stringify(manifest).includes(privateDraft.draft[0]));
  assert.ok(
    !extractedFiles.some((name) => /sqlite|study|userdata|draft/i.test(name)),
  );
  pass(
    "UI exports r1 answer ZIP containing only the selected final answer and two public images, without private draft/database/study records",
  );

  const consumer = await start("consumer-fixture");
  await openQuestion(consumer, first.id);
  await edit(consumer);
  await upload(consumer, privateImage, 1);
  await mutation(consumer, '[data-action="publish"]', "/publish");
  await consumer.page.locator('[data-action="close-editor"]').click();
  await consumer.page.locator('[data-action="star"]').click();
  await consumer.page.locator('[data-action="grade-hard"]').click();
  await consumer.page.locator('[data-action="timer-toggle"]').click();
  await saved(consumer.page);
  const personalBefore = await consumer.answer(first.id);
  const studyBefore = await consumer.json("/api/local/study");
  assert.equal(studyBefore.study.records[first.id].star, true);
  await consumer.page.locator('[data-action="reader-back"]').click();
  await consumer.page.locator('[data-action="admin"]').click();
  await consumer.page.locator('[data-action="local-import-answers"]').click();
  await consumer.page
    .locator('#pack-form input[name="file"]')
    .setInputFiles(pack);
  const importedResponse = consumer.page.waitForResponse((r) =>
    r.url().endsWith("/api/local/import-answers"),
  );
  const reload = consumer.page.waitForEvent("domcontentloaded");
  await consumer.page.locator("#pack-form button").click();
  assert.equal((await importedResponse).status(), 200);
  await reload;
  await consumer.page.locator(".site-header").waitFor();
  await consumer.page.locator("#notice-dismiss").click();
  assert.deepEqual(await consumer.answer(first.id), personalBefore);
  assert.deepEqual(await consumer.json("/api/local/study"), studyBefore);
  const official = await consumer.json(
    `/api/local/official/${encodeURIComponent(first.id)}`,
  );
  assert.equal(official.photos.length, 2);
  for (let index = 0; index < official.photos.length; index++) {
    const response = await consumer.context.request.get(
      consumer.origin + official.photos[index],
    );
    assert.equal(response.status(), 200);
    assert.deepEqual(
      await response.body(),
      fs.readFileSync(
        path.join(extractedDir, manifest.answers[first.id][index]),
      ),
    );
  }
  assert.equal(
    (
      await consumer.json(
        `/api/local/official/${encodeURIComponent(second.id)}`,
      )
    ).photos.length,
    0,
  );
  await openQuestion(consumer, first.id);
  await consumer.page
    .locator('#answer-content img[alt="题库答案"]')
    .first()
    .waitFor();
  assert.equal(
    await consumer.page.locator('#answer-content img[alt="题库答案"]').count(),
    2,
  );
  assert.equal(
    await consumer.page
      .locator('#answer-content img[alt="手写参考答案"]')
      .count(),
    1,
  );
  await consumer.page
    .locator("#answer-content img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => image.decode())),
    );
  await consumer.page.screenshot({
    path: path.join(out, "consumer-public-and-private.png"),
    fullPage: true,
  });
  pass(
    "Second isolated user imports the downloaded pack via UI and sees public + private images while own finalized answer, favorite and study records remain intact",
  );
  assert.deepEqual(errors, []);
  report.passed = true;
  report.browser = process.platform === "win32" ? "Chrome" : "Chromium";
  report.questionIds = [first.id, second.id];
  report.exportedImageCount = manifest.answers[first.id].length;
  console.log(
    "AUTHOR ANSWER FLOW PASS: real browser + HTTP + ZIP + isolated author/consumer; no real user data or GitHub publication",
  );
} catch (error) {
  report.error = error.stack || String(error);
  console.error(error);
  for (const [index, context] of (browser?.contexts() || []).entries())
    await context
      .pages()[0]
      ?.screenshot({
        path: path.join(out, `failure-${index}.png`),
        fullPage: true,
      })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  for (const app of apps.reverse()) await app.close();
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith("842-author-answer-flow-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
