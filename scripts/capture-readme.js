import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-readme-"));
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
const origin = `http://127.0.0.1:${port}`;
let app, browser;
try {
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: "readme-only" },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 650 },
    colorScheme: "light",
  });
  await page.goto(origin + "/__open/readme-only");
  await page.locator(".site-header").waitFor();
  const question = catalog.questions.find((q) => q.year === 2025);
  await page.goto(origin + "/?q=" + encodeURIComponent(question.id));
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".question-images img")].length > 0 &&
      [...document.querySelectorAll(".question-images img")].every(
        (im) => im.complete && im.dataset.boundsChecked,
      ),
  );
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync("docs/images", { recursive: true });
  await page.screenshot({ path: "docs/images/practice.png" });
  console.log(
    "Captured current application in an isolated, empty profile: docs/images/practice.png",
  );
} finally {
  await browser?.close();
  await app?.close();
}
