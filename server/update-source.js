import fs from "node:fs";
import { validVersion } from "./update-files.js";

export const REPOSITORY = "burriedalien666/zju842-practice";
export const RELEASES = `https://github.com/${REPOSITORY}/releases`;
export const platformKey = () =>
  `${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform}-${process.arch}`;
const assetUrl = (asset) =>
  `${RELEASES}/download/${asset.release}/${asset.name}`;
function asset(value) {
  if (
    !value ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.release) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/.test(value.name) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 1024 ** 3
  )
    throw new Error("发布文件信息不合法");
}
export function validateManifest(m) {
  if (
    !m ||
    m.format !== 1 ||
    m.libraryId !== "zju842" ||
    !validVersion(m.program?.version) ||
    m.program.protocol !== 1 ||
    typeof m.program.assets !== "object"
  )
    throw new Error("更新清单不受支持");
  for (const kind of ["program", "library", "answers"])
    if (
      m[kind]?.notes != null &&
      (typeof m[kind].notes !== "string" || m[kind].notes.length > 12000)
    )
      throw new Error("更新说明格式不正确");
  for (const p of ["windows-x64", "macos-x64", "macos-arm64"]) {
    const a = m.program.assets[p];
    asset(a);
    if (a.name !== `zju842-${m.program.version}-${p}.zip`)
      throw new Error("程序包与平台版本不匹配");
  }
  for (const kind of ["library", "answers"]) {
    const item = m[kind];
    if (
      !item ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 0 ||
      typeof item.edition !== "string" ||
      item.edition.length > 100 ||
      !validVersion(item.requiresProgram)
    )
      throw new Error("资料更新版本不合法");
    asset(item.asset);
    if (
      !item.asset.name.endsWith(kind === "library" ? ".842pack" : ".842answers")
    )
      throw new Error("资料包类型不匹配");
  }
  if (
    !Number.isSafeInteger(m.answers.requiresLibraryRevision) ||
    m.answers.requiresLibraryRevision < 0
  )
    throw new Error("答案依赖版本不合法");
  return m;
}
// Never accept a URL supplied by a browser or by an update manifest.
export class GitHubUpdates {
  constructor(fetchImpl = fetch) {
    this.fetch = fetchImpl;
  }
  async response(url, timeout = 20000) {
    let target = new URL(url);
    const signal = AbortSignal.timeout(timeout);
    for (let i = 0; i < 5; i++) {
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        ![
          "api.github.com",
          "github.com",
          "release-assets.githubusercontent.com",
          "objects.githubusercontent.com",
        ].includes(target.hostname)
      )
        throw new Error("更新下载地址不在可信发布服务中");
      const r = await this.fetch(target.href, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "zju842-updater",
          Accept:
            target.hostname === "api.github.com"
              ? "application/vnd.github+json"
              : "application/octet-stream",
        },
      });
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const location = r.headers.get("location");
        await r.body?.cancel();
        if (!location) throw new Error("下载跳转缺少地址");
        target = new URL(location, target);
        continue;
      }
      if (!r.ok) {
        await r.body?.cancel();
        throw new Error(
          `无法访问 GitHub（${r.status}），请稍后重试；已有内容仍可离线使用`,
        );
      }
      return r;
    }
    throw new Error("更新下载跳转过多");
  }
  async json(url) {
    const r = await this.response(url);
    const chunks = [];
    let size = 0;
    for await (const c of r.body) {
      size += c.length;
      if (size > 1024 ** 2) throw new Error("更新清单过大");
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async check() {
    const r = await this.json(
      `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
    );
    if (
      r.draft ||
      r.prerelease ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(r.tag_name)
    )
      throw new Error("发布版本不合法");
    const entry = r.assets?.find((a) => a.name === "zju842-updates.json");
    if (!entry) throw new Error("当前发布尚未提供内置更新清单，请稍后重试");
    return validateManifest(
      await this.json(assetUrl({ release: r.tag_name, name: entry.name })),
    );
  }
  async download(item, file, progress) {
    asset(item);
    const response = await this.response(assetUrl(item), 10 * 60 * 1000);
    const output = fs.openSync(file, "wx");
    let received = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > item.size) throw new Error("下载文件大小与发布信息不符");
        fs.writeFileSync(output, chunk);
        progress(received, item.size);
      }
      if (received !== item.size) throw new Error("下载不完整，请重试");
    } finally {
      fs.closeSync(output);
    }
  }
}
