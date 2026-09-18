import { validVersion } from "./update-files.js";
export function validateAnswers(value) {
  if (
    !value ||
    value.format !== 1 ||
    value.kind !== "answers" ||
    value.libraryId !== "zju842" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    (value.requiresProgram != null && !validVersion(value.requiresProgram)) ||
    !Number.isSafeInteger(value.requiresLibraryRevision) ||
    value.requiresLibraryRevision < 0 ||
    typeof value.edition !== "string" ||
    value.edition.length > 100 ||
    !value.answers ||
    typeof value.answers !== "object" ||
    Array.isArray(value.answers)
  )
    throw new Error("答案包版本或索引格式不正确");
  if (Object.keys(value.answers).length > 20000) throw new Error("\u7b54\u6848\u9898\u53f7\u6570\u91cf\u8d85\u9650");
  const referenced = new Set();
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
    for (const image of images) {
      if (referenced.has(image)) throw new Error("\u7b54\u6848\u56fe\u7247\u91cd\u590d\u5f15\u7528");
      referenced.add(image);
    }
  }
  return value;
}
export function answerFiles(value) {
  validateAnswers(value);
  return new Set(["answers.json", ...Object.values(value.answers).flat()]);
}
