import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { writeZip, packPaths } from "../server/packs.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform;
const label = `zju842-${pkg.version}-${platform}-${process.arch}`;
const releaseDir = path.join(root, "releases");
fs.mkdirSync(releaseDir, { recursive: true });
const stage = fs.mkdtempSync(path.join(releaseDir, "package-"));
const target = path.join(stage, label);
fs.mkdirSync(target);
const copy = (from, to = from) =>
  fs.cpSync(path.join(root, from), path.join(target, to), { recursive: true });
for (const name of ["server", "LICENSE", "CONTENT-NOTICE.md", "package.json"])
  copy(name);
for (const name of ["study.js", "review.js", "papers.js"]) copy("src/" + name);
copy("dist/index.html");
copy("dist/assets");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "public/catalog.json"), "utf8"),
);
for (const name of packPaths(catalog)) copy("public/" + name);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const dependencyPaths = execFileSync(
  npm,
  ["ls", "--omit=dev", "--all", "--parseable"],
  { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
)
  .trim()
  .split(/\r?\n/)
  .filter(
    (p) =>
      p !== root && p.startsWith(path.join(root, "node_modules") + path.sep),
  );
for (const dependency of [...new Set(dependencyPaths)].sort(
  (a, b) => a.length - b.length,
)) {
  const relative = path.relative(root, dependency);
  if (!fs.existsSync(path.join(target, relative))) copy(relative);
}
fs.mkdirSync(path.join(target, "runtime"), { recursive: true });
fs.copyFileSync(
  process.execPath,
  path.join(
    target,
    "runtime",
    process.platform === "win32" ? "node.exe" : "node",
  ),
);
const licenseResponse = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
  { signal: AbortSignal.timeout(20000) },
);
if (!licenseResponse.ok) throw new Error("无法获取运行环境许可证");
fs.writeFileSync(
  path.join(target, "runtime/LICENSE"),
  await licenseResponse.text(),
);
if (process.platform === "win32")
  fs.writeFileSync(
    path.join(target, "启动题库.cmd"),
    '@echo off\r\ncd /d "%~dp0"\r\n"runtime\\node.exe" "server\\desktop.js"\r\nif errorlevel 1 pause\r\n',
  );
else {
  fs.writeFileSync(
    path.join(target, "启动题库.command"),
    '#!/bin/sh\ncd "$(dirname "$0")"\n./runtime/node server/desktop.js\n',
  );
  fs.chmodSync(path.join(target, "启动题库.command"), 0o755);
  fs.chmodSync(path.join(target, "runtime/node"), 0o755);
}
fs.copyFileSync(
  path.join(root, "docs/local-guide.md"),
  path.join(target, "使用说明.md"),
);
const entries = [];
function walk(dir, relative = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = relative ? relative + "/" + entry.name : entry.name;
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(file, name);
    else entries.push({ name: label + "/" + name, file });
  }
}
walk(target);
const zip = path.join(releaseDir, label + ".zip");
if (fs.existsSync(zip))
  throw new Error("发布包已存在，请使用新版本或移走旧包后重试");
await writeZip(zip, entries);
console.log(
  JSON.stringify({
    directory: target,
    archive: zip,
    downloadMiB: fs.statSync(zip).size / 1048576,
    files: entries.length,
  }),
);
