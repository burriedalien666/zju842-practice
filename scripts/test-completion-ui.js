import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { buildChapters } from "../src/chapters.js";
import { scheduleReview } from "../src/review.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-completion-"));
const base = path.resolve("public"),
  catalog = loadCatalog(path.join(base, "catalog.json"), base);
const chapter = buildChapters(catalog).find((c) => c.id === "s1");
const questions = catalog.questions.filter((q) =>
  chapter.questionIds.has(q.id),
);
assert.equal(questions.length, 23);
fs.writeFileSync(
  path.join(dir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const origin = `http://127.0.0.1:${port}`;
let app, browser;
try {
  app = await createApp({
    dataDir: dir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir: base, launchToken: "completion-ui" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1463, height: 724 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/completion-ui");
  await page.locator(".site-header").waitFor();
  const disk = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  const records = {};
  for (const [i, rating] of ["good", "hard", "wrong"].entries())
    records[questions[i].id] = {
      star: false,
      state: rating === "good" ? "done" : "review",
      review: scheduleReview(null, rating, {}, Date.now()),
    };
  records[questions[3].id] = { star: true, state: "" };
  const response = await context.request.put(origin + "/api/local/study", {
    headers: { Origin: origin, "If-Match": disk.revision },
    data: {
      version: 2,
      records,
      settings: { intervals: [1, 3, 7] },
      lists: [],
    },
  });
  assert.equal(response.status(), 200);
  await page.reload();
  const progress = page.locator(
    '#chapter-shortcuts [data-id="s1"] .nav-progress',
  );
  assert.match(await progress.innerText(), /13% \(3\/23\)/);
  assert.match(await progress.getAttribute("title"), /完成进度 13%/);
  assert.match(
    await progress.getAttribute("title"),
    /掌握 1、不熟 1、不会 1、未做 20/,
  );
  const card = page.locator('.chapter-card[data-id="s1"]');
  assert.match(await card.innerText(), /已做 3 \/ 23 · 掌握 1/);
  assert.equal(
    await card.locator('[role="progressbar"]').getAttribute("aria-valuenow"),
    "3",
  );
  assert.equal(await page.locator("#progress").textContent(), "");
  assert.equal(await page.locator("#progress").isVisible(), false);
  assert.equal(await page.locator(".chapter-symbol").count(), 0);
  fs.mkdirSync(".test-artifacts/completion", { recursive: true });
  await page.screenshot({ path: ".test-artifacts/completion/three-of-23.png" });
  await page.goto(origin + "/?q=" + encodeURIComponent(questions[1].id));
  await page.locator('[data-action="grade-wrong"]').click();
  await page.locator('[data-action="undo-mark"]').click();
  await page.locator('[data-action="reader-back"]').click();
  assert.match(
    await progress.innerText(),
    /13% \(3\/23\)/,
    "changing a rating must not add an attempt to progress",
  );
  assert.match(await progress.getAttribute("title"), /掌握 1、不熟 1、不会 1/);
  await page.locator("#source").selectOption("final");
  assert.match(
    await progress.innerText(),
    /0% \(0\/0\)/,
    "zero-result scope cannot show NaN",
  );
  await page.locator("#source").selectOption("");
  await page.locator('#global-nav [data-action="papers"]').click();
  await page.locator('[data-action="open-paper"][data-year="2025"]').click();
  await page.locator('[data-action="grade-wrong"]').click();
  await page.locator('[data-action="reader-back"]').click();
  const paper = page.locator(".paper-card").filter({
    has: page.locator('[data-action="open-paper"][data-year="2025"]'),
  });
  assert.match(await paper.innerText(), /已做 1\/27/);
  assert.ok(
    (
      await paper.locator(".chapter-progress span").getAttribute("style")
    ).includes("4%"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "COMPLETION UI PASS: three of 23 is 13%; sidebar/cards/subject counters agree; favorites excluded; regrade/undo stable; empty filter safe; wrong answer advances paper progress",
  );
} finally {
  await browser?.close();
  await app?.close();
}
