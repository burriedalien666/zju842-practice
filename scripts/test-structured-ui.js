import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { questionBodyMarkup } from "../src/structured-question.js";
import { buildStructuredLibrary } from "./build-structured-library.js";
import { examPapers } from "../src/papers.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-structured-ui-")),
  out = path.resolve(".test-artifacts/structured-ui");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const baseDir = path.resolve("public"),
  catalog = loadCatalog(path.join(baseDir, "catalog.json"), baseDir);
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const origin = "http://127.0.0.1:" + port,
  token = "structured-disposable-test";
let app, browser;
const result = {
  scenarios: [],
  renderedGroups: 0,
  layoutErrors: [],
  errors: [],
  passed: false,
};
try {
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: token },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  await context.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  page.on("pageerror", (e) => result.errors.push(e.message));
  await page.goto(origin + "/__open/" + token);
  await page.locator(".site-header").waitFor();
  const qid = "2025|九|(1)",
    childId = "2025|九|(2)";
  const open = async (id) => {
    await page.goto(origin + "/?q=" + encodeURIComponent(id));
    await page
      .locator('#reader[data-qid="' + id + '"] .question-actions')
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const read = async () =>
    await (await context.request.get(origin + "/api/local/study")).json();
  const saved = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#save-status")?.textContent === "已保存到本机",
    );
  await open(qid);
  assert.equal(await page.locator("#reader .structured-question").count(), 0);
  const before = await read();
  before.study.records[qid] = { star: true, state: "done" };
  before.study.lists = [{ name: "结构化测试题单", ids: [qid, childId] }];
  before.study.paperHistory = {
    2025: [
      {
        started: 1000,
        finished: 9000,
        closedAt: 9500,
        elapsedMs: 8000,
        questionIds: [qid, childId],
        marks: { [qid]: "good", [childId]: "hard" },
      },
    ],
  };
  assert.equal(
    (
      await context.request.put(origin + "/api/local/study", {
        headers: { Origin: origin, "If-Match": before.revision },
        data: before.study,
      })
    ).status(),
    200,
  );
  const stored = await read();
  const zip = path.join(dataDir, "r3.842pack");
  await buildStructuredLibrary(zip);
  const install = await context.request.post(
    origin + "/api/local/import-pack",
    {
      headers: { Origin: origin },
      multipart: {
        file: {
          name: "r3.842pack",
          mimeType: "application/zip",
          buffer: fs.readFileSync(zip),
        },
      },
    },
  );
  assert.equal(install.status(), 200, await install.text());
  assert.deepEqual(await read(), stored);
  result.scenarios.push("real HTTP r2->r3 ZIP import retains existing study");
  await open(qid);
  assert.equal(await page.locator("#reader .structured-question").count(), 1);
  await page.locator("#notice-dismiss").click();
  result.scenarios.push(
    "completed library update notice is shown and can be dismissed",
  );
  assert.equal(
    await page.locator("[data-action=star]").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".structured-original summary").click();
  await page
    .locator(".structured-original img")
    .evaluateAll((es) => Promise.all(es.map((e) => e.decode())));
  await page.locator(".structured-original summary").click();
  await page.locator("[data-action=toggle-answers]").click();
  await page.locator("[data-action=edit-answer]").click();
  const picture = await sharp({
    create: { width: 120, height: 70, channels: 3, background: "#207854" },
  })
    .png()
    .toBuffer();
  await page
    .locator("#gallery")
    .setInputFiles({
      name: "disposable-answer.png",
      mimeType: "image/png",
      buffer: picture,
    });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".photo-card").length === 1 &&
      !document.querySelector("#dialog")?.classList.contains("busy"),
  );
  const published = page.waitForResponse((r) => r.url().endsWith("/publish"));
  await page.locator("[data-action=publish]").click();
  assert.equal((await published).status(), 200);
  await page.locator("[data-action=close-editor]").click();
  await page.locator("#answer-content img").waitFor();
  await page.locator("[data-action=open-videos]").click();
  assert.match(
    await page.locator("#dialog-body").innerText(),
    /讲解视频待发布/,
  );
  await page.locator("[data-action=close-dialog]").click();
  await page.locator("[data-action=grade-hard]").click();
  await saved();
  await open(childId);
  assert.equal(
    await page
      .locator(".structured-question")
      .getAttribute("data-structured-group"),
    qid,
  );
  assert.equal(
    await page.locator("[data-action=star]").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("[data-action=toggle-answers]").click();
  assert.equal(await page.locator("#answer-content img").count(), 0);
  await saved();
  assert.equal((await read()).study.records[qid].star, true);
  assert.equal((await read()).study.records[childId]?.star ?? false, false);
  result.scenarios.push(
    "shared group keeps independent IDs, ratings, favorites, private screenshot answers and video entry",
  );
  await open(qid);
  await page.screenshot({
    path: path.join(out, "c18-desktop.png"),
    fullPage: true,
  });
  for (const [width, theme] of [
    [900, "dark"],
    [390, "light"],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    const fig = page.locator("[data-figure=C18_schmitt]");
    await fig.evaluate((e) => (e.scrollLeft = e.scrollWidth));
    assert.ok(await fig.evaluate((e) => e.scrollLeft > 0));
    await fig.screenshot({
      path: path.join(out, "c18-" + width + "-" + theme + ".png"),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/?paper=2025");
  await page.locator("#reader .question-actions").waitFor();
  await page.locator("[data-action=question-picker]").click();
  const questions = examPapers(catalog).find((p) => p.id === "2025").questions;
  await page
    .locator("#jump-number")
    .fill(String(questions.findIndex((q) => q.id === qid) + 1));
  await page.locator("#jump-form button").click();
  assert.equal(await page.locator("#reader").getAttribute("data-qid"), qid);
  assert.equal(await page.locator(".structured-question").count(), 1);
  await saved();
  await page.locator(".paper-more summary").click();
  await page.locator(".paper-more [data-action=practice-history]").click();
  await page.locator('[data-action=history-round][data-index="0"]').click();
  await page.locator(".history-questions>details>summary").first().click();
  assert.equal(
    await page.locator(".history-questions .structured-question").count(),
    2,
  );
  const ids = await page
    .locator(".history-questions svg [id]")
    .evaluateAll((es) => es.map((e) => e.id));
  assert.equal(new Set(ids).size, ids.length);
  await page.screenshot({
    path: path.join(out, "history.png"),
    fullPage: true,
  });
  await page.locator("[data-action=close-dialog]").click();
  result.scenarios.push(
    "whole-paper jump and archived rounds use the same structured content with unique SVG IDs",
  );
  await open("2025|七|(1)");
  assert.equal(await page.locator(".structured-question").count(), 1);
  assert.equal(await page.locator('.question-source-details').getAttribute('open'),null);
  assert.equal(await page.locator('#reader > .source-note,.structured-question > .source-note').count(),0);
  await open('2015|九|(2)');assert.equal(await page.locator('.structured-question').count(),1);
  result.scenarios.push("all accepted groups use structured content, with source notes folded by default");
  // Full content render uses the production markup and built page CSS, without touching live study records.
  for (const g of catalog.structured.groups
    .filter((g) => g.blocks.some((b) => b.narrowTex))
    .slice(0, 6)) {
    await open(g.id);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      assert.equal(
        await page
          .locator(".formula-block .katex-display")
          .evaluateAll((es) =>
            es.some((e) => e.scrollHeight > e.clientHeight + 1),
          ),
        false,
        g.id + " responsive formula",
      );
    }
  }
  for (const g of catalog.structured.groups) {
    const q = catalog.questions.find((q) => q.id === g.id),
      html = questionBodyMarkup(catalog, q);
    await page
      .locator("#reader")
      .evaluate((e, markup) => (e.innerHTML = markup), html);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
      });
      assert.equal(await page.locator("#reader .katex-error").count(), 0, g.id);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        g.id + " page overflow",
      );
      const boxes = await page.locator("#reader svg").evaluateAll((es) =>
        es.map((e) => {
          const b = (e.querySelector("g.drawing") ?? e).getBBox(),
            v = e.viewBox.baseVal;
          return [b.x, b.y, b.width, b.height, v.width, v.height];
        }),
      );
      for (const [x, y, w, h, vw, vh] of boxes)
        if (!(x >= -1 && y >= -1 && x + w <= vw + 1 && y + h <= vh + 1))
          result.layoutErrors.push({
            id: g.id,
            width,
            bounds: [x, y, w, h, vw, vh],
          });
      assert.equal(
        await page
          .locator(".formula-block .katex-display")
          .evaluateAll((es) =>
            es.some((e) => e.scrollHeight > e.clientHeight + 1),
          ),
        false,
        g.id + " formula vertical clipping",
      );
    }
    result.renderedGroups++;
  }
  assert.deepEqual(result.layoutErrors, []);
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (e) {
  result.errors.push(e.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
}
