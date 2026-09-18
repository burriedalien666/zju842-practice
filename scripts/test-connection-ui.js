import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { GitHubUpdates } from "../server/update-source.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-connection-ui-"));
const baseDir = path.resolve("public");
const reservation = net.createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
let app, browser;
let pauseCheck = false,
  releaseCheck,
  startedCheck;
async function start(token) {
  app = await createApp({
    dataDir,
    origin,
    staticDir: path.resolve("dist"),
    catalog: loadCatalog(path.join(baseDir, "catalog.json"), baseDir),
    local: {
      baseDir,
      launchToken: token,
      updateSource: new GitHubUpdates(async () => {
        if (pauseCheck) {
          startedCheck();
          await new Promise((resolve) => {
            releaseCheck = resolve;
          });
        }
        throw new TypeError("fetch failed");
      }),
    },
  });
  await app.listen({ host: "127.0.0.1", port });
}
try {
  await start("first");
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/first");
  await page.locator('[data-action="local-updates"]').click();
  await page.locator("#update-check").click();
  await page.waitForFunction(() =>
    document.querySelector("#update-error")?.textContent.includes("GitHub"),
  );
  assert.equal(
    await page.locator("#connection-status").isVisible(),
    false,
    "remote failure is not local disconnection",
  );
  await page.locator('[data-action="close-dialog"]').click();
  await page.goto(origin + "/?q=" + encodeURIComponent("2009|一|1"));
  await page.locator('[data-action="star"]').waitFor();
  await app.close();
  app = null;
  // No save or update click is needed: the visible page detects a stopped service.
  await page
    .locator("#connection-status")
    .waitFor({ state: "visible", timeout: 23000 });
  assert.match(
    await page.locator("#connection-status").innerText(),
    /本地题库服务已断开/,
  );
  await page.locator('[data-action="star"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#save-status")?.textContent.includes("尚未保存"),
  );
  await page.locator('[data-action="local-updates"]').click();
  await page.locator("#update-reconnect").waitFor();
  assert.match(
    await page.locator("#update-center").innerText(),
    /不要先刷新或关闭/,
  );
  await page.locator("#update-reconnect").click();
  await page.locator("#update-reconnect:enabled").waitFor();
  fs.mkdirSync(".test-artifacts/connection-ui", { recursive: true });
  await page.screenshot({
    path: ".test-artifacts/connection-ui/disconnected.png",
    fullPage: true,
  });
  await start("second");
  await page.locator("#update-reconnect").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#update-center")
      ?.textContent.includes("会话已失效"),
  );
  const fresh = await context.newPage();
  await fresh.goto(origin + "/__open/second");
  await fresh.locator('[data-action="local-updates"]').waitFor();
  await page.bringToFront();
  // Reconnect the original page without navigation or abandoning its pending save.
  await page.locator("#update-reconnect").click();
  await page.locator("#update-check").waitFor();
  await page.locator('[data-action="close-dialog"]').click();
  await page.locator('[data-action="retry-save"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status")?.textContent === "已保存到本机",
  );
  const stored = await context.request.get(origin + "/api/local/study");
  assert.equal((await stored.json()).study.records["2009|一|1"].star, true);
  assert.ok(
    page.url().includes("?q="),
    "original page did not reload or redirect",
  );
  await page.screenshot({
    path: ".test-artifacts/connection-ui/recovered.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(dataDir, "update-settings.json"),
    JSON.stringify({ autoCheck: true }),
  );
  pauseCheck = true;
  const started = new Promise((resolve) => {
    startedCheck = resolve;
  });
  const automaticPage = await context.newPage();
  await automaticPage.goto(origin);
  await started;
  await automaticPage.locator('[data-action="local-updates"]').click();
  assert.equal(await automaticPage.locator("#update-check").isDisabled(), true);
  pauseCheck = false;
  releaseCheck();
  await automaticPage.locator("#update-check:enabled").waitFor();
  assert.match(
    await automaticPage.locator("#update-error").innerText(),
    /GitHub/,
  );
  console.log(
    "CONNECTION UI PASS: real service stop, passive detection, persistent update recovery, expired session, restart and original-tab unsaved study recovery; GitHub failure distinguished; opening during automatic check unblocks on completion",
  );
} finally {
  await browser?.close();
  if (app) await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
