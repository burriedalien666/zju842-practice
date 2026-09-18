import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractUpdateZip, atomicJson, readJson } from "./update-files.js";

export { validateAnswers, answerFiles } from "./answer-schema.js";
import { validateAnswers, answerFiles } from "./answer-schema.js";
export async function extractAnswers(file, destination) {
  const names = await extractUpdateZip(
    file,
    destination,
    (n) => /^(answers\.json|answers\/[a-zA-Z0-9_-]+\.webp)$/.test(n),
    1024 ** 3,
  );
  const stat = fs.statSync(path.join(destination, "answers.json"));
  if (stat.size > 8 * 1024 ** 2) throw new Error("答案索引过大");
  const value = validateAnswers(
    readJson(path.join(destination, "answers.json")),
  );
  const expected = answerFiles(value);
  if (names.size !== expected.size || [...expected].some((n) => !names.has(n)))
    throw new Error("答案包缺少图片或包含未引用文件");
  for (const name of expected)
    if (name !== "answers.json") {
      if (fs.statSync(path.join(destination, name)).size > 12 * 1024 ** 2)
        throw new Error("答案图片过大");
      const imageBytes = fs.readFileSync(path.join(destination, name));
      const m = await sharp(imageBytes, {
        limitInputPixels: 60000000,
      }).metadata();
      if (m.format !== "webp" || (m.pages || 1) > 1)
        throw new Error("答案图片无法读取");
      // Reuse the bytes: filename input can retain a Windows file handle in libvips.
      // Metadata alone can accept truncated payloads; keep the bounded strict decode.
      await sharp(imageBytes, { limitInputPixels: 60000000, failOn: "warning" })
        .resize({ width: 1, height: 1, fit: "inside" }).raw().toBuffer();
    }
  return value;
}
export function readOfficialAnswers(
  dataDir,
  catalog,
  library,
  baseDir = library,
) {
  const pointer = readJson(path.join(dataDir, "official-answers.json"), null);
  if (
    !pointer &&
    !Object.keys(catalog.officialAnswers || {}).length &&
    fs.existsSync(path.join(baseDir, "answers.json"))
  )
    return {
      directory: baseDir,
      value: validateAnswers(readJson(path.join(baseDir, "answers.json"))),
    };
  if (!pointer)
    return {
      directory: library,
      value: {
        format: 1,
        kind: "answers",
        libraryId: "zju842",
        revision: 0,
        requiresLibraryRevision: 0,
        edition: "未安装独立答案包",
        answers: catalog.officialAnswers || {},
      },
    };
  if (!/^answers-[a-f0-9]{16}$/.test(pointer.directory))
    throw new Error("答案目录不合法");
  const directory = path.join(dataDir, "libraries", pointer.directory);
  return {
    directory,
    value: validateAnswers(readJson(path.join(directory, "answers.json"))),
  };
}
export function activateAnswers(dataDir, directory) {
  const name = path.basename(directory);
  if (
    !/^answers-[a-f0-9]{16}$/.test(name) ||
    path.resolve(directory) !== path.resolve(dataDir, "libraries", name)
  )
    throw new Error("答案目录不合法");
  atomicJson(path.join(dataDir, "official-answers.json"), { directory: name });
}
