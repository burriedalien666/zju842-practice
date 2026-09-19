import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { writeZip, packPaths } from "../server/packs.js";
import { mergeVideoBatch } from "../src/video-batches.js";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-video-ui-"));
const baseDir = path.resolve("public");
const catalog = loadCatalog(path.join(baseDir, "catalog.json"), baseDir);
const q = catalog.questions.find((q) => q.knowledgeIds?.includes("s2.ctconv"));
const link = "https://www.bilibili.com/video/BV1qM411a7N2?p=9";
const lessons = [
  {
    id: "test-q",
    target: "question",
    targetId: q.id,
    title: "测试题目讲解",
    url: link,
    author: "测试作者",
    segments: [
      { seconds: 0, title: "开头" },
      { seconds: 60, title: "测试分段" },
    ],
  },
  {
    id: "test-k",
    target: "knowledge",
    targetId: "s2.ctconv",
    title: "测试卷积知识点",
    url: link,
  },
  {
    id: "test-other-question",
    target: "question",
    targetId: "2009|一|1",
    title: "另一题专属视频",
    url: link.replace("p=9", "p=1"),
  },
  ...[1, 2, 3, 4].map((n) => ({
    id: "test-c-" + n,
    target: "chapter",
    targetId: "s2",
    title: "章节课" + n,
    url: link.replace("p=9", "p=" + n),
  })),
];
const next = mergeVideoBatch(catalog, {
  format: 1,
  items: lessons.filter((v) => v.target === "question"),
}).catalog;
// Legacy chapter/concept links remain loadable but must not become recommendations.
next.videoLessons.push(...lessons.filter((v) => v.target !== "question"));
next.libraryRevision = (catalog.libraryRevision || 0) + 1;
next.requiresProgram = "0.5.5";
next.updateKind = "library";
const pack = path.join(dataDir, "test-videos.842pack");
await writeZip(pack, [
  { name: "catalog.json", bytes: Buffer.from(JSON.stringify(next)) },
  ...[...packPaths(next)]
    .filter((n) => n !== "catalog.json")
    .map((name) => ({ name, file: path.join(baseDir, name) })),
]);
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const reservation = net.createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
let app, browser;
try {
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: "video-ui-test" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  // Deterministic popup check only. Live Bilibili playback is a separate test.
  await context.route("https://www.bilibili.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>External-link test target</h1>",
    }),
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/video-ui-test");
  await page.locator('[data-action="local-updates"]').waitFor();
  const currentStudy = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  const saved = {
    version: 1,
    records: { [q.id]: { star: true, state: "review" } },
    lists: [],
  };
  const save = await context.request.put(origin + "/api/local/study", {
    headers: { Origin: origin, "If-Match": currentStudy.revision },
    data: saved,
  });
  assert.equal(save.status(), 200);
  const before = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  const response = await context.request.post(
    origin + "/api/local/import-pack",
    {
      headers: { Origin: origin },
      multipart: {
        file: {
          name: "videos.842pack",
          mimeType: "application/octet-stream",
          buffer: fs.readFileSync(pack),
        },
      },
    },
  );
  assert.equal(response.status(), 200, await response.text());
  assert.deepEqual(
    await (await context.request.get(origin + "/api/local/study")).json(),
    before,
  );
  assert.equal(
    (await (await context.request.get(origin + "/catalog.json")).json())
      .videoLessons.length,
    lessons.length,
  );
  await page.reload();
  await page.locator('[data-action="local-updates"]').waitFor();
  await page.locator("#notice-dismiss").waitFor();
  assert.match(await page.locator("#update-complete").innerText(), /r3/);
  await page.locator("#notice-dismiss").click();
  await page.locator('[data-action="chapter"][data-id="s2"]').first().click();
  assert.equal(
    await page.locator('[data-action="open-videos"]').count(),
    0,
    "chapter layout has no video courses",
  );
  await page.goto(origin + "/?q=" + encodeURIComponent(q.id));
  await page.locator(".question-images").waitFor();
  assert.equal(await page.locator('[data-action="open-videos"]').count(), 1);
  await page.getByRole("button", { name: "查看本题视频", exact: true }).click();
  await page.locator(".question-video-list").waitFor();
  assert.equal(await page.locator(".question-video-row").count(), 1);
  assert.doesNotMatch(
    await page.locator("#dialog-body").innerText(),
    /测试卷积知识点|章节课|知识点学习|章节课程|展开更多/,
  );
  await page.getByText("分段导航", { exact: true }).click();
  const previous = page.url();
  const popupReady = context.waitForEvent("page");
  await page
    .getByRole("link", { name: "1:00 · 测试分段", exact: true })
    .click();
  const popup = await popupReady;
  await popup.waitForLoadState("domcontentloaded");
  assert.match(popup.url(), /p=9&t=60/);
  assert.equal(await popup.evaluate(() => window.opener === null), true);
  assert.equal(page.url(), previous);
  await popup.close();
  await page.locator('[data-action="close-dialog"]').click();
  assert.equal(await page.locator("#dialog").evaluate((d) => d.open), false);
  assert.deepEqual(errors, []);
  await page.goto(origin + "/?q=" + encodeURIComponent("2009|一|1"));
  await page.locator(".question-images").waitFor();
  await page.getByRole("button", { name: "查看本题视频", exact: true }).click();
  assert.equal(await page.locator(".question-video-row").count(), 1);
  assert.match(
    await page.locator("#dialog-body").innerText(),
    /另一题专属视频/,
  );
  assert.doesNotMatch(
    await page.locator("#dialog-body").innerText(),
    /测试题目讲解|章节课/,
  );
  await page.locator('[data-action="close-dialog"]').click();
  await page.goto(origin + "/?q=" + encodeURIComponent("2009|一|2"));
  await page.locator(".question-images").waitFor();
  assert.equal(
    await page.locator('[data-action="open-videos"]').count(),
    0,
    "unlinked question has no empty video button",
  );
  await page.goto(origin + "/?paper=2010");
  await page.locator(`.paper-question[data-qid="${q.id}"]`).waitFor();
  await page
    .locator(`.paper-question[data-qid="${q.id}"] [data-action="open-videos"]`)
    .click();
  assert.equal(await page.locator(".question-video-row").count(), 1);
  assert.match(await page.locator("#dialog-body").innerText(), /测试题目讲解/);
  console.log(
    "VIDEO UI PASS: real library-pack import preserves study; original chapter layout; only current-question video; no related courses; timestamp popup, isolated opener and reading position retained; empty questions have no button (external page fixture)",
  );
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
