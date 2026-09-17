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
  const completion = pipeline(
    zip.outputStream,
    fs.createWriteStream(file, { flags: "wx" }),
  );
  for (const entry of entries) {
    if (entry.file)
      zip.addFile(entry.file, entry.name, {
        compress: !/\.(webp|png|jpe?g)$/.test(entry.name),
      });
    else zip.addBuffer(entry.bytes, entry.name, { compress: false });
  }
  zip.end();
  await completion;
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
      const metadata = await sharp(
        fs.readFileSync(path.join(destination, name)),
        {
          limitInputPixels: 60000000,
        },
      ).metadata();
      if (
        !["jpeg", "png", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) > 1
      )
        throw new Error("更新包包含不可读取的图片");
    }
  return catalog;
}
