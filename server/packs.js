import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import yauzl from "yauzl";
import yazl from "yazl";
import sharp from "sharp";
import { validateCatalog, loadCatalog } from "./catalog.js";

export async function writeZip(file, entries) {
  const zip = new yazl.ZipFile();
  const output = fs.createWriteStream(file, { flags: "wx" });
  let owned = false;
  output.once("open", () => { owned = true; });
  zip.on("error", error => zip.outputStream.destroy(error));
  const completion = pipeline(zip.outputStream, output);
  // Observe promptly even when addFile/addBuffer throws synchronously.
  void completion.catch(() => {});
  try {
    for (const entry of entries) {
      if (entry.file)
        zip.addFile(entry.file, entry.name, { compress: !/\.(webp|png|jpe?g)$/.test(entry.name) });
      else zip.addBuffer(entry.bytes, entry.name, { compress: false });
    }
    zip.end();
    await completion;
  } catch (error) {
    zip.outputStream.destroy(error);
    await completion.catch(() => {});
    if (owned) fs.rmSync(file, { force: true });
    throw error;
  }
}
export function packPaths(catalog) {
  validateCatalog(catalog);
  const paths = new Set([
    "catalog.json",
    ...catalog.questions.flatMap((q) => q.images.map((i) => i.src)),
  ]);
  const ids = new Set(catalog.questions.map((q) => q.id));
  if (
    catalog.edition != null &&
    (typeof catalog.edition !== "string" || catalog.edition.length > 100)
  )
    throw new Error("题库版本不合法");
  if (
    catalog.officialAnswers != null &&
    (typeof catalog.officialAnswers !== "object" ||
      Array.isArray(catalog.officialAnswers))
  )
    throw new Error("答案索引不合法");
  for (const [id, photos] of Object.entries(catalog.officialAnswers || {})) {
    if (
      !ids.has(id) ||
      !Array.isArray(photos) ||
      photos.length > 12 ||
      photos.some((p) => !/^answers\/[a-zA-Z0-9_-]+\.webp$/.test(p))
    )
      throw new Error("答案图片路径不合法");
    photos.forEach((p) => paths.add(p));
  }
  return paths;
}
export async function extractPack(file, destination) {
  const zip = await promisify(yauzl.open)(file, {
    lazyEntries: true,
    autoClose: true,
  });
  const names = new Set();
  let total = 0;
  await new Promise((resolve, reject) => {
    const fail = (error) => {
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      (async () => {
        const name = entry.fileName;
        if (
          !/^(catalog\.json|(?:questions|answers)\/[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g))$/.test(
            name,
          ) ||
          names.has(name) ||
          ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
        )
          throw new Error("更新包含不支持或重复的文件");
        const limit =
          name === "catalog.json" ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
        total += entry.uncompressedSize;
        if (
          entry.uncompressedSize > limit ||
          total > 2 * 1024 ** 3 ||
          names.size > 20000
        )
          throw new Error("更新包超过容量限制");
        names.add(name);
        const target = path.join(destination, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const stream = await promisify(zip.openReadStream.bind(zip))(entry);
        await pipeline(stream, fs.createWriteStream(target, { flags: "wx" }));
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
  const catalog = loadCatalog(
    path.join(destination, "catalog.json"),
    destination,
  );
  const expected = packPaths(catalog);
  if (names.size !== expected.size || [...expected].some((n) => !names.has(n)))
    throw new Error("更新包图片不完整或包含未引用文件");
  for (const name of expected)
    if (name !== "catalog.json") {
      const imageBytes = fs.readFileSync(path.join(destination, name));
      const metadata = await sharp(
        imageBytes,
        {
          limitInputPixels: 60000000,
        },
      ).metadata();
      if (
        !["jpeg", "png", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) > 1
      )
        throw new Error("更新包包含不可读取的图片");
      const extension = path.extname(name).slice(1).replace("jpg", "jpeg");
      if (metadata.format !== extension) throw new Error("\u56fe\u7247\u6269\u5c55\u540d\u4e0e\u5b9e\u9645\u683c\u5f0f\u4e0d\u5339\u914d");
      // Do not give libvips a filename: failed installs must be removable on Windows.
      await sharp(imageBytes, { limitInputPixels: 60000000, failOn: "warning" })
        .resize({ width: 1, height: 1, fit: "inside" }).raw().toBuffer();
    }
  return catalog;
}
