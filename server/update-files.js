import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";


export const validVersion = (v) =>
  typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
export function newer(a, b) {
  if (!validVersion(a) || !validVersion(b))
    throw new Error("程序版本格式不正确");
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
export function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + randomBytes(8).toString("hex");
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}
export function readJson(file, fallback) {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : fallback;
}

// ZIP is an external boundary: reject links, traversal and oversized entries before writing.
export async function extractUpdateZip(
  file,
  destination,
  allow,
  maxBytes = 2 * 1024 ** 3,
) {
  const { default: yauzl } = await import("yauzl");
  const zip = await promisify(yauzl.open)(file, { lazyEntries: true });
  const names = new Set();
  let total = 0;
  await new Promise((resolve, reject) => {
    const fail = (e) => {
      zip.close();
      reject(e);
    };
    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      (async () => {
        const name = entry.fileName;
        const mode = entry.externalFileAttributes >>> 16;
        if (
          /[\\:\x00-\x1f]/.test(name) ||
          name.startsWith("/") ||
          name.split("/").some((p) => p === ".." || p === ".") ||
          names.has(name) ||
          (mode & 0o170000) === 0o120000 ||
          !allow(name)
        )
          throw new Error("更新包含不允许的路径、重复文件或符号链接");
        total += entry.uncompressedSize;
        if (
          total > maxBytes ||
          entry.uncompressedSize > 256 * 1024 ** 2 ||
          names.size > 30000
        )
          throw new Error("更新包超过解压容量限制");
        names.add(name);
        const target = path.resolve(destination, name);
        if (!target.startsWith(path.resolve(destination) + path.sep))
          throw new Error("更新路径越界");
        if (name.endsWith("/")) fs.mkdirSync(target, { recursive: true });
        else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const stream = await promisify(zip.openReadStream.bind(zip))(entry);
          await pipeline(stream, fs.createWriteStream(target, { flags: "wx" }));
          if (process.platform !== "win32")
            fs.chmodSync(target, mode & 0o111 ? 0o755 : 0o644);
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
  return names;
}
