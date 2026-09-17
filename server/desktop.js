import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { atomicJson, readJson } from "./update-files.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(root, process.env.ZJU842_DATA_DIR || "userdata");
fs.mkdirSync(dataDir, { recursive: true });
const lockFile = path.join(dataDir, "desktop.lock");
const pointerFile = path.join(root, ".app-current.json");
const pendingFile = path.join(root, ".app-pending.json");
const validDirectory = (v) =>
  typeof v === "string" && /^\d+\.\d+\.\d+-[a-f0-9]{16}$/.test(v);
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}
const lock = readJson(lockFile, null);
if (lock) {
  if (alive(lock.pid))
    throw new Error("此资料目录已有题库在运行，请先关闭原启动窗口");
  // Windows may terminate the supervisor before its child receives IPC disconnect.
  for (let i = 0; i < 50 && alive(lock.childPid); i++)
    await new Promise((r) => setTimeout(r, 100));
  if (alive(lock.childPid)) throw new Error("旧题库进程仍在关闭，请稍后重试");
  fs.unlinkSync(lockFile);
}
fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), {
  flag: "wx",
});
const rootLockFile = path.join(root, ".app-lock");
let rootLocked = false;
let child,
  stopping = false,
  port = process.env.ZJU842_PORT || "8843";
const token = randomBytes(24).toString("hex");
function installation(directory) {
  if (directory === null) return root;
  if (!validDirectory(directory)) throw new Error("程序更新目录不合法");
  const candidate = path.join(root, ".app-versions", directory);
  if (fs.lstatSync(candidate).isSymbolicLink())
    throw new Error("程序更新目录不能是符号链接");
  return candidate;
}
function restorePending(pending) {
  if (
    !pending ||
    !validDirectory(pending.directory) ||
    !(pending.previous === null || validDirectory(pending.previous)) ||
    !/^before-program-\d+-[a-f0-9]{16}\.sqlite$/.test(pending.backup)
  )
    throw new Error("升级恢复信息不完整");
  const source = path.join(dataDir, "update-backups", pending.backup);
  if (!fs.statSync(source).isFile())
    throw new Error("升级前备份不存在，请勿删除个人资料");
  // No child is running and the data-directory lock is held here.
  for (const suffix of ["-wal", "-shm"]) {
    const file = path.join(dataDir, "site.sqlite" + suffix);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  fs.copyFileSync(source, path.join(dataDir, "site.sqlite"));
  atomicJson(pointerFile, { directory: pending.previous });
  fs.unlinkSync(pendingFile);
  atomicJson(path.join(dataDir, "last-update-result.json"), {
    ok: false,
    message: "新版未能启动，已恢复旧程序和升级前个人资料",
    at: Date.now(),
  });
}
async function run(directory, activating = false) {
  const install = installation(directory);
  const runtime = path.join(
    install,
    "runtime",
    process.platform === "win32" ? "node.exe" : "node",
  );
  child = spawn(
    fs.existsSync(runtime) ? runtime : process.execPath,
    [path.join(install, "server/desktop-app.js")],
    {
      cwd: install,
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: {
        ...process.env,
        ZJU842_DATA_DIR: dataDir,
        ZJU842_INSTALL_ROOT: root,
        ZJU842_LAUNCH_TOKEN: token,
        ZJU842_PORT: port,
        ZJU842_RESTARTING: activating ? "1" : "0",
      },
    },
  );
  atomicJson(lockFile, { pid: process.pid, childPid: child.pid });
  return new Promise((resolve, reject) => {
    let ready = false,
      requested = null,
      error;
    const timer = setTimeout(() => {
      error = new Error("新版启动超时");
      child.kill();
    }, 30000);
    child.on("message", (m) => {
      if (m?.type === "ready") {
        try {
          port = m.port;
          if (activating) {
            atomicJson(path.join(dataDir, "last-update-result.json"), {
              ok: true,
              message: "程序更新成功，个人资料已保留",
              at: Date.now(),
            });
            atomicJson(pointerFile, { directory });
            fs.unlinkSync(pendingFile);
          }
          ready = true;
          clearTimeout(timer);
          child.send({ type: "committed" });
        } catch (e) {
          error = e;
          child.kill();
        }
      }
      if (m?.type === "activate" && ready) {
        try {
          installation(m.directory);
          if (!/^before-program-\d+-[a-f0-9]{16}\.sqlite$/.test(m.backup))
            throw new Error("升级备份名称不正确");
          requested = {
            directory: m.directory,
            previous: directory,
            backup: m.backup,
          };
          atomicJson(pendingFile, requested);
        } catch (e) {
          error = e;
        }
      }
    });
    child.on("error", (e) => {
      error = e;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stopping) return resolve(null);
      if (error || !ready)
        return reject(error || new Error("程序启动失败：" + code));
      resolve(code === 75 && requested ? requested : null);
    });
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    child?.kill();
  });
try {
  if (fs.existsSync(path.join(root, "runtime"))) {
    const owner = readJson(rootLockFile, null);
    if (owner && alive(owner.pid))
      throw new Error("此程序目录已有实例运行，请先关闭原启动窗口");
    if (owner) fs.unlinkSync(rootLockFile);
    fs.writeFileSync(rootLockFile, JSON.stringify({ pid: process.pid }), {
      flag: "wx",
    });
    rootLocked = true;
  }
  if (fs.existsSync(pendingFile)) restorePending(readJson(pendingFile));
  let directory = readJson(pointerFile, { directory: null }).directory;
  let next = await run(directory);
  while (next && !stopping) {
    try {
      directory = next.directory;
      next = await run(directory, true);
    } catch (e) {
      console.error("更新启动失败：" + e.message);
      const pending = readJson(pendingFile, null);
      if (!pending) throw e;
      restorePending(pending);
      directory = pending.previous;
      next = await run(directory);
    }
  }
} finally {
  if (readJson(lockFile, null)?.pid === process.pid) fs.unlinkSync(lockFile);
  if (rootLocked && readJson(rootLockFile, null)?.pid === process.pid)
    fs.unlinkSync(rootLockFile);
}
