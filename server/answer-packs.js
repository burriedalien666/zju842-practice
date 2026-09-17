import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractUpdateZip, atomicJson, readJson } from "./update-files.js";

export function validateAnswers(value) {
  if (
    !value ||
    value.format !== 1 ||
    value.kind !== "answers" ||
    value.libraryId !== "zju842" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Number.isSafeInteger(value.requiresLibraryRevision) ||
    value.requiresLibraryRevision < 0 ||
    typeof value.edition !== "string" ||
    value.edition.length > 100 ||
    !value.answers ||
    typeof value.answers !== "object" ||
    Array.isArray(value.answers)
  )
    throw new Error("答案包版本或索引格式不正确");
  for (const [id, images] of Object.entries(value.answers)) {
    if (
      !id ||
      id.length > 160 ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      !Array.isArray(images) ||
      images.length > 12 ||
      images.some(
        (p) =>
          typeof p !== "string" || !/^answers\/[a-zA-Z0-9_-]+\.webp$/.test(p),
      )
    )
      throw new Error("答案题号或图片路径不正确");
  }
  return value;
}
export function answerFiles(value) {
  validateAnswers(value);
  return new Set(["answers.json", ...Object.values(value.answers).flat()]);
}
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
      const m = await sharp(fs.readFileSync(path.join(destination, name)), {
        limitInputPixels: 60000000,
      }).metadata();
      if (m.format !== "webp" || (m.pages || 1) > 1)
        throw new Error("答案图片无法读取");
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
