import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const root = path.resolve(process.argv[2] || ".");
const runtime = path.join(
  root,
  "runtime",
  process.platform === "win32" ? "node.exe" : "node",
);
const executable = fs.existsSync(runtime) ? runtime : process.execPath;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-launch-"));
let child;
async function start() {
  child = spawn(executable, [path.join(root, "server/desktop.js")], {
    cwd: root,
    env: {
      ...process.env,
      ZJU842_NO_BROWSER: "1",
      ZJU842_DATA_DIR: dataDir,
      ZJU842_PORT: "18443",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("启动超时")), 20000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/TEST_START_URL=(\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("启动失败：" + code));
    });
  });
  const response = await fetch(url, { redirect: "manual" });
  assert.equal(response.status, 302);
  return {
    base: new URL(url).origin,
    cookie: response.headers.get("set-cookie").split(";")[0],
  };
}
async function stop() {
  const stopped = once(child, "exit");
  child.kill();
  await stopped;
}
try {
  let { base, cookie } = await start();
  const catalog = await (await fetch(base + "/catalog.json")).json();
  assert.ok(catalog.questions.length >= 469);
  const session = await (
    await fetch(base + "/api/session", { headers: { cookie } })
  ).json();
  assert.equal(session.local, true);
  assert.equal(session.admin, true);
  assert.equal((await fetch(base + "/api/local/study")).status, 401);
  const state = {
    version: 2,
    records: { [catalog.questions[0].id]: { state: "review", star: true } },
    settings: { intervals: [1, 3, 7] },
    lists: [],
  };
  const initial = await (
    await fetch(base + "/api/local/study", { headers: { cookie } })
  ).json();
  assert.equal(
    (
      await fetch(base + "/api/local/study", {
        method: "PUT",
        headers: {
          cookie,
          Origin: base,
          "Content-Type": "application/json",
          "If-Match": initial.revision,
        },
        body: JSON.stringify(state),
      })
    ).status,
    200,
  );
  await stop();
  ({ base, cookie } = await start());
  const saved = await (
    await fetch(base + "/api/local/study", { headers: { cookie } })
  ).json();
  assert.deepEqual(saved.study, state);
  assert.equal(
    (await fetch(base + "/" + catalog.questions[0].images[0].src)).status,
    200,
  );
  console.log(
    "DESKTOP PASS: launch, local-only session, question images, saved records after restart",
  );
} finally {
  if (child?.exitCode === null) await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
