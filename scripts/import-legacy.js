import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "../server/catalog.js";

const input = process.argv[2];
if (!input)
  throw new Error("用法：node scripts/import-legacy.js <旧版HTML路径>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacy = fs.readFileSync(input, "utf8");
const match = legacy.match(/const DATA=(.*?), GROUPS=(.*?);\r?\n/);
if (!match) throw new Error("旧版题目索引未找到");
const rows = JSON.parse(match[1]),
  groups = JSON.parse(match[2]);
const types = new Map();
const questions = rows.map((r) => {
  const subject = r.g[0] === "A" ? "signals" : "digital";
  types.set(r.c, {
    id: r.c,
    title: r.t,
    group: r.g,
    groupTitle: groups[r.g],
    subject,
  });
  return {
    id: r.id,
    subject,
    sourceKind: "entrance",
    year: r.y,
    number: r.q,
    title: r.a,
    typeId: r.c,
    sourceTitle: `浙江大学842 · ${r.y}年`,
    tags: r.tags.split("；").filter(Boolean),
    note: r.note || "",
    shared: r.shared,
    images: r.images.map((im) => ({
      src: "questions/" + path.basename(im.src),
      width: im.w,
      height: im.h,
      caption: im.caption || "",
    })),
  };
});
const catalog = validateCatalog({
  version: 1,
  types: [...types.values()],
  questions,
});
const assets = new Set(rows.flatMap((r) => r.images.map((im) => im.src)));
fs.mkdirSync(path.join(root, "public/questions"), { recursive: true });
for (const src of assets) {
  if (!/^assets\/(q-|extra-)[a-zA-Z0-9_-]+\.webp$/.test(src))
    throw new Error(`拒绝非题块素材：${src}`);
  fs.copyFileSync(
    path.resolve(path.dirname(input), src),
    path.join(root, "public/questions", path.basename(src)),
  );
}
fs.writeFileSync(
  path.join(root, "public/catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  `已导入 ${questions.length} 条题目、${types.size} 个题型、${assets.size} 张题块图片。`,
);
