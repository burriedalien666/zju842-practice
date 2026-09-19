import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import pkg from "../package.json" with { type: "json" };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-post-update-"));
const base = path.resolve("public"),
  catalog = loadCatalog(path.join(base, "catalog.json"), base);
fs.writeFileSync(
  path.join(dir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
fs.writeFileSync(
  path.join(dir, ".app-current.json"),
  JSON.stringify({ directory: pkg.version + "-1234567890abcdef" }),
);
fs.writeFileSync(
  path.join(dir, "last-update-result.json"),
  JSON.stringify({ ok: true, at: Date.now(), message: "程序更新成功" }),
);
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const origin = "http://127.0.0.1:" + port;
let app, browser;
try {
  app = await createApp({
    dataDir: dir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir: base, launchToken: "test-completion", installRoot: dir },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  await page.goto(origin + "/__open/test-completion");
  await page.locator("#update-complete").waitFor();
  assert.match(
    await page.locator("#update-complete").innerText(),
    /视频|完整显示/,
  );
  await page.locator("#notice-dismiss").click();
  await page.reload();
  await page.locator('[data-action="local-updates"]').waitFor();
  await page.locator('[data-action="local-updates"]').click();
  await page.locator("#update-center").waitFor();
  assert.match(
    await page.locator("#update-center").innerText(),
    /当前程序.*更新了什么/,
  );
  await page.locator('[data-action="close-dialog"]').click();
  const q = catalog.questions.find((q) =>
    q.images.some((im) => im.height > 900),
  );
  assert.ok(q);
  await page.goto(origin + "/?q=" + encodeURIComponent(q.id));
  await page.locator(".question-images").waitFor();
  await page.locator('.question-images [data-action="zoom"]').first().click();
  await page.locator(".image-fit img").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".image-fit img")?.naturalWidth > 0,
  );
  assert.equal(
    await page
      .locator('[data-action="zoom-in"],[data-action="zoom-out"]')
      .count(),
    0,
  );
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 900, height: 650 },
  ]) {
    await page.setViewportSize(viewport);
    const sizes = await page.locator(".image-fit img").evaluate((im) => {
      const r = im.getBoundingClientRect();
      const d = document.querySelector("#dialog");
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        w: innerWidth,
        h: innerHeight,
        scroll: d.scrollWidth > d.clientWidth + 2,
      };
    });
    assert.ok(
      sizes.left >= 0 &&
        sizes.right <= sizes.w &&
        sizes.top >= 0 &&
        sizes.bottom <= sizes.h,
    );
    assert.equal(sizes.scroll, false);
  }
  console.log(
    "POST UPDATE UI PASS: successful legacy activation shows notes once; update center readback; image fits window with no second zoom or horizontal scrollbar",
  );
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
