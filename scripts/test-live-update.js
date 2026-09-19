import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "playwright";

if (!process.argv[2])
  throw new Error("请指定旧版免安装目录；仅测试临时副本，不修改原目录");
const original = path.resolve(process.argv[2]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-live-upgrade-"));
const root = path.join(temp, "program"),
  dataDir = path.join(temp, "personal");
let child, browser;
try {
  fs.cpSync(original, root, {
    recursive: true,
    filter: (f) =>
      ![
        "userdata",
        ".app-versions",
        ".app-current.json",
        ".app-pending.json",
        ".app-lock",
      ].includes(path.basename(f)),
  });
  const oldVersion = JSON.parse(
    fs.readFileSync(path.join(root, "package.json")),
  ).version;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "update-settings.json"),
    JSON.stringify({ autoCheck: false }),
  );
  const node = path.join(
    root,
    "runtime",
    process.platform === "win32" ? "node.exe" : "node",
  );
  child = spawn(node, [path.join(root, "server/desktop.js")], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ZJU842_DATA_DIR: dataDir,
      ZJU842_NO_BROWSER: "1",
      ZJU842_PORT: "18563",
    },
  });
  let output = "";
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    output += b;
  });
  const deadline = Date.now() + 30000;
  while (!/TEST_START_URL=(\S+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline)
      throw new Error("启动失败: " + output);
    await new Promise((r) => setTimeout(r, 100));
  }
  const launch = output.match(/TEST_START_URL=(\S+)/)[1];
  const origin = new URL(launch).origin;
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(launch);
  await page.locator('[data-action="local-updates"]').waitFor();
  await page.goto(origin + "/?q=" + encodeURIComponent("2009|一|1"));
  await page.locator('[data-action="star"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status")?.textContent === "已保存到本机",
  );
  const before = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  await page.locator('[data-action="local-updates"]').click();
  await page.locator("#update-check").click();
  await page
    .locator('[data-update-kind="program"]:enabled')
    .waitFor({ timeout: 60000 });
  const initial = await (
    await context.request.get(origin + "/api/local/updates")
  ).json();
  const target = initial.entries.program.target;
  if (process.argv[3]) assert.equal(target, process.argv[3]);
  console.log(
    `LIVE: ${oldVersion} -> ${target}, downloading from the public GitHub release`,
  );
  await page.locator('[data-update-kind="program"]').click();
  await page.locator("#confirm-update").click();
  let final,
    reported = "";
  const end = Date.now() + 32 * 60 * 1000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error("升级时程序退出: " + output);
    try {
      const response = await context.request.get(
        origin + "/api/local/updates",
        { timeout: 3000 },
      );
      if (response.ok()) final = await response.json();
    } catch {
      /* The application restarts during activation. */
    }
    if (final?.job?.state === "failed") throw new Error(final.job.message);
    if (final?.lastResult?.ok === false)
      throw new Error(final.lastResult.message);
    if (final?.entries?.program?.current === target) break;
    const progress = final?.job
      ? `${final.job.state}: ${Math.floor((final.job.received || 0) / 1048576)} MB`
      : "waiting";
    if (progress !== reported) {
      console.log(progress);
      reported = progress;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(
    final?.entries.program.current,
    target,
    "actual public upgrade completed",
  );
  assert.deepEqual(
    await (await context.request.get(origin + "/api/local/study")).json(),
    before,
  );
  await page.waitForFunction(() => !document.querySelector("#update-center"), {
    timeout: 15000,
  });
  const completion = page.locator('#notice-dismiss');
  await completion.waitFor({ timeout: 15000 });
  assert.ok((await page.locator('#update-complete').innerText()).includes(target));
  await completion.click();
  await page.locator('[data-action="local-updates"]').click();
  await page.locator("#update-center").waitFor();
  assert.match(
    await page.locator("#update-center").innerText(),
    new RegExp("当前 v" + target.replaceAll(".", "\\.")),
  );
  console.log(
    `LIVE UPDATE PASS: ${oldVersion} -> ${target}; public download, browser confirmation, actual restart, UI refresh and study preserved`,
  );
} finally {
  await browser?.close();
  if (child?.exitCode === null) {
    const done = once(child, "close");
    child.kill();
    await done;
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
