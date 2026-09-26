import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { structuredLibrary } from "./build-structured-library.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-polish-")),
  out = path.resolve(".test-artifacts/reader-polish");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(dir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const baseDir = path.resolve("public"),
  catalog = structuredLibrary(
    JSON.parse(fs.readFileSync(path.join(baseDir, "catalog.json"))),
  );
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const origin = "http://127.0.0.1:" + port,
  report = { checks: [], errors: [], passed: false };
let app, browser;
try {
  app = await createApp({
    dataDir: dir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: "polish-fixture" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 950 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(origin + "/__open/polish-fixture");
  await page.locator(".site-header").waitFor();
  await page.locator("[data-action=subject][data-value=digital]").click();
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    const directory = page.locator("#chapter-shortcuts details");
    await directory.evaluate((e) => (e.open = true));
    const btn = page
      .locator("#chapter-shortcuts [data-action=chapter]")
      .first();
    await btn.hover();
    const size = await btn.evaluate((e) => {
      const r = e.getBoundingClientRect(),
        parent = e.parentElement.getBoundingClientRect(),
        child = e.querySelector(".shortcut-copy").getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        parentRight: parent.right,
        childRight: child.right,
        bg: getComputedStyle(e).backgroundColor,
        accent: getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-soft")
          .trim(),
      };
    });
    assert.ok(
      size.childRight <= size.right + 1,
      JSON.stringify({ width, ...size }),
    );
    if (width > 850)
      assert.ok(
        Math.abs(size.parentRight - size.right) < 2,
        JSON.stringify({ width, ...size }),
      );
    assert.notEqual(
      size.bg,
      "rgb(237, 244, 237)",
      "dark hover cannot use light-only background",
    );
    const hero = await page.locator(".learning-overview").evaluate((e) => {
      const r = e.getBoundingClientRect(),
        b = e.querySelector(".resume-block"),
        br = b.getBoundingClientRect(),
        s = getComputedStyle(b);
      return {
        width: r.width,
        block: br.width,
        right: s.borderRightWidth,
        bottom: s.borderBottomWidth,
      };
    });
    assert.ok(hero.width - hero.block < 4, JSON.stringify({ width, hero }));
    assert.equal(hero.right, "0px");
    assert.equal(hero.bottom, "0px");
    await page.screenshot({
      path: path.join(out, "directory-" + width + ".png"),
      fullPage: true,
    });
  }
  report.checks.push(
    "full-width chapter hover and single-column borderless overview at 1440/900/390",
  );
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(origin + "/?q=" + encodeURIComponent("2015|九|(2)"));
  await page.locator(".structured-question").waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page
      .locator("#reader > .source-note,.structured-question > .source-note")
      .count(),
    0,
  );
  const note = page.locator(".question-source-details");
  assert.equal(await note.getAttribute("open"), null);
  await note.locator("summary").click();
  assert.ok((await note.innerText()).length > 20);
  await note.locator("summary").click();
  await page.screenshot({
    path: path.join(out, "accepted-2015-nine.png"),
    fullPage: true,
  });
  report.checks.push(
    "previous screenshot-only question now structured; notes are folded and retain source information",
  );
  await page.goto(origin + "/?q=" + encodeURIComponent("2023|一|3"));
  await page.locator("#reader .question-actions").waitFor();
  await page.locator("[data-action=question-picker]").click();
  const last = await page.locator("#jump-number").getAttribute("max");
  await page.locator("#jump-number").fill(last);
  await page.locator("#jump-form button").click();
  const original = await page.locator("#reader").getAttribute("data-qid");
  await page.locator("[data-action=star]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status")?.textContent === "已保存到本机",
  );
  const study = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  assert.equal(await page.locator(".arrow-next").isEnabled(), true);
  assert.equal(
    await page.locator(".arrow-next").getAttribute("aria-label"),
    "选择下一专题",
  );
  await page.keyboard.press("ArrowRight");
  await page.locator(".continue-recommended").waitFor();
  await page.screenshot({ path: path.join(out, "continue-topic.png") });
  await page.locator(".continue-other summary").click();
  assert.ok(await page.locator(".continue-topic-list button").count());
  await page.locator(".continue-recommended button").click();
  await page.waitForFunction(
    (id) => document.querySelector("#reader")?.dataset.qid !== id,
    original,
  );
  assert.equal(await page.locator("#app.reader-mode").count(), 1);
  assert.equal(await page.locator("#dialog").evaluate((e) => e.open), false);
  const after = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  assert.deepEqual(after.study.records, study.study.records);
  report.checks.push(
    "last-question right arrow and keyboard open next-topic chooser; choosing starts reader directly without changing ratings",
  );
  await page.goto(origin + "/?paper=2025");
  await page.locator("#reader .question-actions").waitFor();
  await page.locator("[data-action=question-picker]").click();
  await page
    .locator("#jump-number")
    .fill(await page.locator("#jump-number").getAttribute("max"));
  await page.locator("#jump-form button").click();
  await page.locator(".arrow-next").click();
  await page.locator("[data-action=paper-confirm-finish]").waitFor();
  assert.equal(
    (await (await context.request.get(origin + "/api/local/study")).json())
      .study.papers["2025"].finished,
    null,
  );
  report.checks.push(
    "paper last arrow opens summary without automatically finishing the round",
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.errors.push(e.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
