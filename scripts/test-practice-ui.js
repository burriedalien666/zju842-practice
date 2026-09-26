import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { examPapers } from "../src/papers.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-practice-ui-"));
const baseDir = path.resolve("public");
const catalog = loadCatalog(path.join(baseDir, "catalog.json"), baseDir);
const paper = examPapers(catalog)[0];
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const reserve = net.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const out = path.resolve(".test-artifacts/practice-ui");
fs.mkdirSync(out, { recursive: true });
let app, browser;
const checks = [];
try {
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: "practice-ui-fixture" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/practice-ui-fixture");
  await page.locator(".site-header").waitFor();
  async function readStudy() {
    return (await context.request.get(origin + "/api/local/study")).json();
  }
  async function saved() {
    await page.waitForFunction(() =>
      document
        .querySelector("#save-status")
        ?.textContent.includes("已保存到本机"),
    );
  }
  let disk = await readStudy();
  const seed = {
    version: 1,
    records: {},
    lists: [],
    papers: {
      [paper.id]: {
        started: Date.now() - 7200000,
        finished: null,
        marks: { [paper.questions[0].id]: "hard" },
      },
    },
  };
  const seeded = await context.request.put(origin + "/api/local/study", {
    headers: { "If-Match": disk.revision, Origin: origin },
    data: seed,
  });
  assert.equal(seeded.status(), 200);
  await page.reload();
  await page.locator(".chapter-card").first().click();
  await page.locator('[data-action="type"]').first().click();
  assert.equal(await page.locator("#app.catalog-mode").count(), 1);
  await page.screenshot({ path: path.join(out, "catalog.png") });
  await page.locator(".question-card").first().click();
  await page.locator("#reader .question-actions").waitFor();
  assert.equal(await page.locator("#app.reader-mode").count(), 1);
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  assert.equal(
    await page.locator(".site-header").isVisible(),
    false,
    "single toolbar without duplicate site header",
  );
  const readerBounds = await page.locator("#reader").boundingBox();
  assert.ok(
    readerBounds.width <= 901,
    "question card is capped at reference width",
  );
  assert.ok(
    (await page.locator("#reading-tools").boundingBox()).height <= 64,
    "desktop reader toolbar is a single 60px row",
  );
  await page.locator('[data-action="open-videos"]').click();
  assert.match(
    await page.locator("#dialog-body").innerText(),
    /讲解视频待发布/,
  );
  assert.equal(
    await page.locator("#dialog-body a").count(),
    0,
    "no fabricated link",
  );
  await page.locator('[data-action="close-dialog"]').click();
  assert.equal(
    await page.locator('[data-action="timer-toggle"] svg').count(),
    1,
  );
  assert.equal(
    await page.locator('[data-action="timer-reset"] svg').count(),
    1,
  );
  assert.equal(await page.locator(".answer-section").isVisible(), false);
  assert.equal(await page.locator(".review-ratings button").count(), 3);
  await page.locator('[data-action="toggle-answers"]').click();
  assert.equal(await page.locator(".answer-section").isVisible(), true);
  await page.locator('[data-action="toggle-answers"]').click();
  await page.locator('[data-action="star"]').click();
  assert.equal(
    await page.locator('[data-action="star"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-action="grade-good"]').click();
  assert.equal(
    await page
      .locator('[data-action="grade-good"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-action="undo-mark"]').click();
  assert.equal(
    await page
      .locator('[data-action="grade-good"]')
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    await page.locator('[data-action="star"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-action="question-picker"]').click();
  assert.equal(await page.locator("#question-picker").isVisible(), true);
  await page.screenshot({ path: path.join(out, "picker.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#question-picker").isVisible(), false);
  await page.screenshot({ path: path.join(out, "single-day.png") });
  await page.setViewportSize({ width: 1463, height: 724 });
  const referenceSize = await page.locator("#reader").boundingBox();
  assert.ok(Math.abs(referenceSize.width - 900) < 2);
  assert.ok(
    referenceSize.y >= 79 && referenceSize.y <= 84,
    "same reference top spacing",
  );
  assert.ok(
    referenceSize.y + referenceSize.height < 724,
    "short question no forced 580px height",
  );
  await page.screenshot({ path: path.join(out, "reference-scale.png") });
  await page.setViewportSize({ width: 1366, height: 900 });
  checks.push(
    "chapter catalog, single reader, answer expansion, star, rating undo, compact picker",
  );
  await saved();
  await page.locator('[data-action="reader-back"]').click();
  assert.equal(await page.locator("#app.catalog-mode").count(), 1);
  await page.locator('#global-nav [data-action="papers"]').click();
  await page
    .locator(`[data-action="open-paper"][data-year="${paper.id}"]`)
    .click();
  assert.equal(await page.locator(".reader .question-images").count(), 1);
  assert.equal(
    await page
      .locator('[data-action="grade-hard"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-action="question-picker"]').click();
  await page.locator("#jump-number").fill("2");
  await page.locator("#jump-form button").click();
  assert.equal(await page.locator("#question-picker").isVisible(), false);
  assert.equal(
    await page.locator("#reader").getAttribute("data-qid"),
    paper.questions[1].id,
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#reader").getAttribute("data-qid"),
    paper.questions[2].id,
  );
  await page.locator('[data-action="previous"]').click();
  await page.locator('[data-action="grade-wrong"]').click();
  await page.locator('[data-action="timer-toggle"]').click();
  assert.equal(
    await page
      .locator('[data-action="timer-toggle"]')
      .getAttribute("aria-label"),
    "继续计时",
  );
  await saved();
  await page.locator(".paper-more summary").click();
  await page.locator('[data-action="paper-restart"]').click();
  await page.locator('[data-action="paper-confirm-restart"]').click();
  await saved();
  disk = await readStudy();
  assert.equal(disk.study.paperHistory[paper.id].length, 1);
  assert.equal(
    disk.study.paperHistory[paper.id][0].marks[paper.questions[0].id],
    "hard",
  );
  assert.equal(
    disk.study.paperHistory[paper.id][0].marks[paper.questions[1].id],
    "wrong",
  );
  assert.deepEqual(disk.study.papers[paper.id].marks, {});
  assert.equal(disk.study.paperHistory[paper.id][0].finished, null);
  await page.locator(".paper-more summary").click();
  await page.locator('.paper-more [data-action="practice-history"]').click();
  await page.locator('[data-action="history-round"][data-index="0"]').click();
  assert.equal(
    await page.locator(".history-questions > details").count(),
    paper.questions.length,
  );
  assert.match(await page.locator("#dialog-body").innerText(), /不熟/);
  await page.screenshot({ path: path.join(out, "history.png") });
  await page.locator('[data-action="close-dialog"]').click();
  checks.push(
    "paper order, numeric jump, left/right, paused timer, archive previous round, read-only history",
  );
  await page.locator('[data-action="theme-toggle"]:visible').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".back-button"))
        .backgroundColor === "rgb(32, 43, 41)",
  );
  await page.screenshot({ path: path.join(out, "single-night.png") });
  await saved();
  await page.reload();
  await page.locator("#reader .question-actions").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal((await readStudy()).study.paperHistory[paper.id].length, 1);
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 900, height: 650 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "horizontal overflow " + viewport.width,
    );
    await page.locator('[data-action="question-picker"]').click();
    const box = await page.locator("#question-picker").boundingBox();
    assert.ok(
      box.x >= 0 && box.x + box.width <= viewport.width + 1,
      "picker in viewport",
    );
    await page.screenshot({
      path: path.join(out, `night-${viewport.width}.png`),
    });
    await page.keyboard.press("Escape");
  }
  checks.push(
    "theme survives reload, history survives server save, 1366/900/390 layout and picker bounds",
  );
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('[data-action="grade-good"]').click();
  await page.locator(".paper-more summary").click();
  await page.locator('[data-action="paper-finish"]').click();
  await page.locator('[data-action="paper-confirm-finish"]').click();
  assert.equal(
    await page.locator(".review-ratings button:disabled").count(),
    3,
  );
  await page.locator(".paper-more summary").click();
  await page.locator('[data-action="paper-restart"]').click();
  await page.locator('[data-action="paper-confirm-restart"]').click();
  await saved();
  disk = await readStudy();
  assert.equal(disk.study.paperHistory[paper.id].length, 2);
  assert.ok(disk.study.paperHistory[paper.id][1].finished);
  assert.equal(disk.study.paperHistory[paper.id][0].timingPartial, true);
  assert.equal(disk.study.paperHistory[paper.id][1].timingPartial, undefined);
  assert.equal(
    disk.study.paperHistory[paper.id][1].marks[paper.questions[0].id],
    "good",
  );
  assert.deepEqual(disk.study.papers[paper.id].marks, {});
  await page.locator('[data-action="reader-back"]').click();
  await page.locator('#global-nav [data-action="analysis"]').click();
  await page.locator(".analysis-table").waitFor();
  await page.screenshot({ path: path.join(out, "analysis-night.png") });
  assert.equal(
    await page
      .locator(".analysis-controls")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(32, 43, 41)",
  );
  await page.locator('#global-nav [data-action="status"]').click();
  await page.locator(".question-card").first().click();
  const favoriteId = await page.locator("#reader").getAttribute("data-qid");
  await page.locator('[data-action="star"]').click();
  assert.equal(
    await page.locator("#reader").getAttribute("data-qid"),
    favoriteId,
    "cancel favorite keeps current question",
  );
  await page.locator('[data-action="undo-mark"]').click();
  assert.equal(
    await page.locator('[data-action="star"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-action="reader-back"]').click();
  await page.locator('[data-action="progress-toggle"]').click();
  assert.equal(await page.locator(".nav-progress").first().isVisible(), false);
  await page.locator('[data-action="progress-toggle"]').click();
  assert.equal(await page.locator(".nav-progress").first().isVisible(), true);
  checks.push(
    "finished round locks ratings; third round retains both archives; legacy partial timer; analysis dark mode; favorite removal stays; progress toggle",
  );
  await saved();
  const otherPaper = examPapers(catalog)[1];
  await page.goto(origin + "/?paper=" + otherPaper.id);
  await page.locator("#reader .question-actions").waitFor();
  await page.locator('[data-action="timer-toggle"]').click();
  await saved();
  disk = await readStudy();
  assert.equal(
    disk.study.papers[otherPaper.id].timingPartial,
    undefined,
    "new deep-linked round is not legacy",
  );
  assert.deepEqual(
    disk.study.papers[otherPaper.id].questionIds,
    otherPaper.questions.map((q) => q.id),
  );
  const restore = structuredClone(disk.study);
  restore.papers[otherPaper.id].elapsedMs = 5000;
  await page.evaluate(
    ({ year, started }) =>
      sessionStorage.setItem(
        "842-practice-clock",
        JSON.stringify({
          key: `paper:${year}:${started}`,
          elapsed: 3600000,
          paused: true,
        }),
      ),
    { year: otherPaper.id, started: restore.papers[otherPaper.id].started },
  );
  await page.locator("#import-file").setInputFiles({
    name: "isolated-study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restore)),
  });
  await page.locator('[data-action="confirm-import"]').click();
  assert.equal(
    await page.locator("#practice-time").innerText(),
    "00:05",
    "import discards stale timer cache",
  );
  await saved();
  assert.equal(
    (await readStudy()).study.paperHistory[paper.id].length,
    2,
    "history survives export/import",
  );
  checks.push(
    "fresh paper URL creates full timed round; importing same-round backup discards stale elapsed cache and retains history",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, out }, null, 2));
} catch (error) {
  console.error(error);
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    await pages[0]?.screenshot({ path: path.join(out, "failure.png") });
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
}
