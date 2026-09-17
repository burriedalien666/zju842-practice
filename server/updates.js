import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import packageInfo from "../package.json" with { type: "json" };
import {
  atomicJson,
  readJson,
  newer,
  extractUpdateZip,
} from "./update-files.js";
import {
  GitHubUpdates,
  platformKey,
  validateManifest,
  RELEASES,
} from "./update-source.js";
import { assertStudyRevision } from "./study-version.js";

export async function stageProgram(file, root, version, platform) {
  const workspace = fs.mkdtempSync(path.join(root, ".app-versions", "stage-"));
  const prefix = `zju842-${version}-${platform}/`;
  try {
    await extractUpdateZip(file, workspace, (name) => {
      if (!name.startsWith(prefix)) return false;
      const relative = name.slice(prefix.length);
      if (
        relative
          .split("/")
          .some(
            (p) =>
              ["userdata", ".git", ".env", "data", ".app-versions"].includes(
                p,
              ) || p.startsWith(".env."),
          )
      )
        return false;
      return (
        /^(server|src|dist|public|runtime|node_modules)\//.test(relative) ||
        [
          "package.json",
          "LICENSE",
          "CONTENT-NOTICE.md",
          "使用说明.md",
          "启动题库.cmd",
          "启动题库.command",
        ].includes(relative)
      );
    });
    const extracted = path.join(workspace, prefix);
    const pkg = readJson(path.join(extracted, "package.json"));
    if (
      pkg.version !== version ||
      pkg.name !== "zju842-practice" ||
      pkg.desktopUpdateProtocol !== 1
    )
      throw new Error("下载的程序版本或升级协议不匹配");
    for (const name of [
      "server/desktop.js",
      "server/desktop-app.js",
      "dist/index.html",
      platform.startsWith("windows-") ? "runtime/node.exe" : "runtime/node",
    ])
      if (!fs.statSync(path.join(extracted, name)).isFile())
        throw new Error("程序包缺少启动文件");
    const directory = version + "-" + randomBytes(8).toString("hex");
    fs.renameSync(extracted, path.join(root, ".app-versions", directory));
    return directory;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

export function createUpdates({
  app,
  dataDir,
  catalog,
  answers,
  installLibrary,
  installAnswers,
  installRoot,
  activateProgram,
  source = new GitHubUpdates(),
  version = packageInfo.version,
}) {
  const settingsFile = path.join(dataDir, "update-settings.json");
  const cacheFile = path.join(dataDir, "update-cache.json");
  let cache = readJson(cacheFile, null),
    job = null,
    pauseWrites = false;
  if (cache) {
    try {
      validateManifest(cache.manifest);
    } catch {
      cache = null;
    }
  }
  const settings = () => ({
    autoCheck: readJson(settingsFile, { autoCheck: true }).autoCheck !== false,
  });
  const supported = !!(
    installRoot &&
    activateProgram &&
    fs.existsSync(
      path.join(
        installRoot,
        "runtime",
        process.platform === "win32" ? "node.exe" : "node",
      ),
    )
  );
  function status() {
    const installed = {
      program: version,
      library: catalog.libraryRevision || 0,
      answers: answers().value.revision,
    };
    const entries = {};
    for (const kind of ["program", "library", "answers"]) {
      const target = cache?.manifest[kind];
      let reason = "";
      if (kind === "program" && !supported)
        reason = "源码运行模式请使用 Git 更新；免安装发布包支持内置程序升级";
      else if (
        kind !== "program" &&
        target &&
        newer(target.requiresProgram, version)
      )
        reason = "请先更新程序";
      else if (
        kind === "answers" &&
        target?.requiresLibraryRevision > installed.library
      )
        reason = "请先更新题库";
      entries[kind] = {
        current: installed[kind],
        target: target
          ? kind === "program"
            ? target.version
            : target.revision
          : null,
        edition: target?.edition || "",
        notes: target?.notes || "",
        available:
          !!target &&
          (kind === "program"
            ? newer(target.version, version)
            : target.revision > installed[kind]),
        reason,
      };
    }
    return {
      settings: settings(),
      entries,
      job,
      checkedAt: cache?.checkedAt || null,
      releaseUrl: RELEASES + "/latest",
      lastResult: readJson(path.join(dataDir, "last-update-result.json"), null),
    };
  }
  async function check(automatic = false) {
    if (
      automatic &&
      (!settings().autoCheck ||
        (cache && Date.now() - cache.checkedAt < 6 * 3600000))
    )
      return status();
    const manifest = validateManifest(await source.check());
    cache = { manifest, checkedAt: Date.now() };
    atomicJson(cacheFile, cache);
    return status();
  }
  function changeSettings(autoCheck) {
    if (typeof autoCheck !== "boolean") throw new Error("自动检查设置不合法");
    atomicJson(settingsFile, { autoCheck });
    return status();
  }
  async function start(kind, target, revision) {
    if (!["program", "library", "answers"].includes(kind))
      throw new Error("未知更新类型");
    if (job && !["done", "failed"].includes(job.state))
      throw new Error("已有更新正在进行，请等待完成");
    const entry = status().entries[kind];
    if (!entry.available || entry.reason || entry.target !== target)
      throw new Error(entry.reason || "更新版本已变化，请重新检查更新");
    const previous = job;
    job = {
      id: randomBytes(8).toString("hex"),
      kind,
      target,
      state: "checking",
      received: 0,
      total: 0,
      message: "正在确认保存状态",
    };
    try {
      await assertStudyRevision(app.db, revision);
    } catch (e) {
      job = previous;
      throw e;
    }
    job.state = "downloading";
    job.message = "正在下载";
    const item = structuredClone(cache.manifest[kind]);
    // Return promptly; polling can show progress during a large program download.
    setImmediate(() => run(kind, item, revision));
    return status();
  }
  async function run(kind, item, revision) {
    const dir = path.join(dataDir, "update-downloads");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, job.id + ".download");
    try {
      const asset =
        kind === "program" ? item.assets[platformKey()] : item.asset;
      if (!asset) throw new Error("当前系统没有可用更新包");
      await source.download(asset, file, (received, total) => {
        Object.assign(job, { received, total });
      });
      job.state = "installing";
      job.message = "正在验证并安装";
      pauseWrites = true;
      const deadline = Date.now() + 10000;
      while (app.localActiveWrites > 0) {
        if (Date.now() > deadline)
          throw new Error("仍有资料正在保存，请稍后更新");
        await new Promise((r) => setTimeout(r, 50));
      }
      await assertStudyRevision(app.db, revision);
      if (kind === "program") {
        fs.mkdirSync(path.join(installRoot, ".app-versions"), {
          recursive: true,
        });
        const directory = await stageProgram(
          file,
          installRoot,
          item.version,
          platformKey(),
        );
        const backupName =
          "before-program-" + Date.now() + "-" + job.id + ".sqlite";
        fs.mkdirSync(path.join(dataDir, "update-backups"), { recursive: true });
        const connection = new DatabaseSync(path.join(dataDir, "site.sqlite"));
        try {
          await backup(
            connection,
            path.join(dataDir, "update-backups", backupName),
          );
        } finally {
          connection.close();
        }
        job.state = "restarting";
        job.message = "资料已备份，正在启动新版";
        await activateProgram({
          directory,
          backup: backupName,
          version: item.version,
        });
        return;
      }
      if (kind === "library") await installLibrary(file, item);
      else await installAnswers(file, item);
      job.state = "done";
      job.message = "更新已完成";
    } catch (error) {
      job.state = "failed";
      job.message =
        error.code === "ENOSPC" ? "磁盘空间不足，原版本未改变" : error.message;
    } finally {
      if (job.state !== "restarting") pauseWrites = false;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  return {
    status,
    check,
    start,
    changeSettings,
    get pauseWrites() {
      return pauseWrites;
    },
    get busy() {
      return !!job && !["done", "failed"].includes(job.state);
    },
  };
}
