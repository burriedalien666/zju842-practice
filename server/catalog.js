import fs from "node:fs";
import path from "node:path";
import { validateCurriculum } from "../src/curriculum.js";

export function validateCatalog(catalog) {
  if (
    !catalog || typeof catalog !== "object" || Array.isArray(catalog) ||
    ["__proto__", "constructor", "prototype"].some(k => Object.hasOwn(catalog, k)) ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.questions) ||
    !Array.isArray(catalog.types)
  )
    throw new Error("题库格式应为version=1、questions和types数组");
  const types = new Map();
  for (const t of catalog.types) {
    if (
      typeof t.id !== "string" ||
      !t.id ||
      typeof t.title !== "string" ||
      !t.title ||
      typeof t.group !== "string" ||
      !t.group ||
      typeof t.groupTitle !== "string" ||
      !t.groupTitle ||
      !["signals", "digital"].includes(t.subject) ||
      types.has(t.id)
    )
      throw new Error("题型编号、名称或科目不合法");
    types.set(t.id, t);
  }
  const ids = new Set();
  for (const q of catalog.questions) {
    if (typeof q.id !== "string" || !q.id || q.id.length > 160 || ids.has(q.id) || ["__proto__", "constructor", "prototype"].includes(q.id))
      throw new Error("题目编号为空、过长或重复");
    const type = types.get(q.typeId);
    if (
      !type ||
      type.subject !== q.subject ||
      !["entrance", "final"].includes(q.sourceKind) ||
      !Number.isInteger(q.year) ||
      q.year < 1900 ||
      q.year > 2200
    )
      throw new Error(`题目来源或分类不合法：${q.id}`);
    for (const key of ["number", "title", "sourceTitle"])
      if (typeof q[key] !== "string" || !q[key])
        throw new Error(`题目缺少${key}：${q.id}`);
    if (
      !Array.isArray(q.tags) ||
      q.tags.some((t) => typeof t !== "string") ||
      (q.note != null && typeof q.note !== "string")
    )
      throw new Error(`题目标签或备注不合法：${q.id}`);
    if (!Array.isArray(q.images) || !q.images.length)
      throw new Error(`题目缺少题图：${q.id}`);
    for (const im of q.images) {
      if (
        !/^questions\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g)$/.test(im.src) ||
        /\/page[-_]/i.test(im.src) ||
        !Number.isInteger(im.width) ||
        im.width < 1 ||
        !Number.isInteger(im.height) ||
        im.height < 1
      )
        throw new Error(`题图路径或尺寸不合法：${q.id}`);
    }
    ids.add(q.id);
  }
  validateCurriculum(catalog);
  return catalog;
}

export function loadCatalog(file, publicDir) {
  const catalog = validateCatalog(JSON.parse(fs.readFileSync(file, "utf8")));
  for (const q of catalog.questions)
    for (const im of q.images)
      if (!fs.existsSync(path.join(publicDir, im.src)))
        throw new Error(`题图不存在：${im.src}`);
  return catalog;
}
