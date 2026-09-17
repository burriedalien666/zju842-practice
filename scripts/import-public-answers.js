import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAnswers, answerFiles } from "../server/answer-packs.js";
import { atomicJson } from "../server/update-files.js";

if (!process.argv[2])
  throw new Error(
    "用法：npm run import:answers -- <已审查的公共答案.842answers>",
  );
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-public-answers-"));
try {
  const value = await extractAnswers(path.resolve(process.argv[2]), temp);
  const catalog = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
  const previous = JSON.parse(fs.readFileSync("public/answers.json", "utf8"));
  if (value.revision <= previous.revision)
    throw new Error("公共答案版本号必须递增");
  if (
    value.requiresLibraryRevision > catalog.libraryRevision ||
    Object.keys(value.answers).some(
      (id) => !catalog.questions.some((q) => q.id === id),
    )
  )
    throw new Error("请先整理对应题库");
  for (const name of answerFiles(value))
    if (name !== "answers.json") {
      const destination = path.resolve("public", name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(temp, name), destination);
    }
  atomicJson(path.resolve("public/answers.json"), value);
  console.log(
    `已准备公共答案 r${value.revision}，共 ${Object.keys(value.answers).length} 题。尚未发布，请检查素材后按发布流程操作。`,
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
