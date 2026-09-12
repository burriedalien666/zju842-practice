import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog, loadCatalog } from "../server/catalog.js";

export function importQuestions(packageDir, publicDir) {
  const incoming = loadCatalog(
    path.join(packageDir, "catalog.json"),
    packageDir,
  );
  const file = path.join(publicDir, "catalog.json");
  const existing = loadCatalog(file, publicDir);
  const types = new Map(existing.types.map((t) => [t.id, t]));
  for (const type of incoming.types) {
    const old = types.get(type.id);
    if (
      old &&
      ["title", "group", "groupTitle", "subject"].some(
        (key) => old[key] !== type[key],
      )
    )
      throw new Error(`已有题型定义不同：${type.id}`);
    types.set(type.id, type);
  }
  const merged = validateCatalog({
    version: 1,
    types: [...types.values()],
    questions: [...existing.questions, ...incoming.questions],
  });
  const assets = [
    ...new Set(incoming.questions.flatMap((q) => q.images.map((im) => im.src))),
  ];
  // 同名素材不能覆盖旧题图；引用已有素材只允许内容完全相同。
  for (const src of assets) {
    const target = path.join(publicDir, src);
    if (
      fs.existsSync(target) &&
      !fs
        .readFileSync(target)
        .equals(fs.readFileSync(path.join(packageDir, src)))
    )
      throw new Error(`题图名称已使用：${src}`);
  }
  for (const src of assets) {
    const target = path.join(publicDir, src);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target))
      fs.copyFileSync(
        path.join(packageDir, src),
        target,
        fs.constants.COPYFILE_EXCL,
      );
  }
  // 最后替换索引，复制中断时旧题库仍可继续读取。
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(merged, null, 2) + "\n");
  fs.renameSync(temp, file);
  return incoming.questions.length;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2])
    throw new Error("用法：npm run import:questions -- <整理后的题包目录>");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  console.log(
    `新增 ${importQuestions(path.resolve(process.argv[2]), path.join(root, "public"))} 道题。请重新构建并重启网站。`,
  );
}
