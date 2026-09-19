import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { videoUrl } from "../src/curriculum.js";
import { validateCatalog } from "../server/catalog.js";
import { atomicJson, newer } from "../server/update-files.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { discoverPublicCollection } from "../server/video-collection.js";
import {
  mergeVideoBatch,
  prepareCollectionBatch,
} from "../src/video-batches.js";
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(`${name}缺少值`);
  return args[i + 1];
}
if (args.includes("--help")) {
  console.log(`作者视频维护（不上传、不自动发布）
  --discover-url 公开BV链接 --out 选集.json
    仅此命令联网读取公开分P/合集元数据，不下载视频或读取Cookie。
  --list [--catalog 路径]
  --import 批次.json [--catalog 路径] [--apply]
    默认仅预览。--apply才写入；同编号更新文字，同目标同链接不能重复。
  --collection 选集.json --prefix 前缀 --target question --target-id 原题号 --from 1 --to 2 --out 批次.json [--catalog 路径]
    从公开选集元数据生成部分批次，明确指定关联，不猜题号。输出存在时拒绝覆盖。
  无以上选项：交互式添加单条；--remove：交互式移除。
  选集：{format:1,title,author,items:[{key,title,url,segments?}]}
  批次：{format:1,items:[{id,target,targetId,title,url,author?,collection?,segments?}]}`);
  process.exit(0);
}
if (option("--discover-url")) {
  if (args.includes("--apply") || option("--import") || option("--collection"))
    throw new Error("读取与导入请分开执行");
  const output = option("--out");
  if (!output) throw new Error("请提供--out输出文件");
  if (fs.existsSync(output)) throw new Error("输出文件已存在，不会覆盖");
  const collection = await discoverPublicCollection(option("--discover-url"));
  fs.writeFileSync(output, JSON.stringify(collection, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      output: path.resolve(output),
      count: collection.items.length,
      author: collection.author,
      catalogChanged: false,
    }),
  );
  process.exit(0);
}
const file = option("--catalog")
  ? path.resolve(option("--catalog"))
  : fileURLToPath(new URL("../public/catalog.json", import.meta.url));
const original = fs.readFileSync(file, "utf8");
const catalog = JSON.parse(original);
const importFile = option("--import"),
  collectionFile = option("--collection");
if (importFile && collectionFile)
  throw new Error("生成批次和导入批次请分开执行");
if (!catalog.curriculum) throw new Error("请先整理知识点目录");
if (collectionFile) {
  const output = option("--out");
  if (!output) throw new Error("请提供--out批次文件路径");
  const batch = prepareCollectionBatch(
    JSON.parse(fs.readFileSync(collectionFile, "utf8")),
    {
      prefix: option("--prefix"),
      target: option("--target"),
      targetId: option("--target-id"),
      from: option("--from") ? Number(option("--from")) : 1,
      to: option("--to") ? Number(option("--to")) : undefined,
    },
  );
  validateCatalog(mergeVideoBatch(catalog, batch).catalog);
  fs.writeFileSync(output, JSON.stringify(batch, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      prepared: path.resolve(output),
      count: batch.items.length,
      catalogChanged: false,
    }),
  );
} else if (importFile) {
  const { catalog: next, counts } = mergeVideoBatch(
    catalog,
    JSON.parse(fs.readFileSync(importFile, "utf8")),
  );
  validateCatalog(next);
  if (
    next.videoLessons.some(
      (v) => v.target === "knowledge" || v.segments?.length,
    ) &&
    newer("0.5.5", next.requiresProgram || "0.4.0")
  )
    next.requiresProgram = "0.5.5";
  if (args.includes("--apply")) {
    if (fs.readFileSync(file, "utf8") !== original)
      throw new Error("题库在预览期间已变化，请重新导入");
    if (
      counts.added ||
      counts.updated ||
      next.requiresProgram !== catalog.requiresProgram
    )
      atomicJson(file, next);
  }
  console.log(
    JSON.stringify({
      ...counts,
      total: next.videoLessons.length,
      applied: args.includes("--apply"),
      catalog: file,
    }),
  );
  console.log(
    args.includes("--apply")
      ? "已写入本地。核对后递增题库版本并验收；未发布。"
      : "仅预览，未写入。确认关联后加--apply导入。",
  );
} else if (args.includes("--list")) {
  for (const v of catalog.videoLessons || [])
    console.log(`${v.id} | ${v.target} ${v.targetId} | ${v.title} | ${v.url}`);
  if (!catalog.videoLessons?.length) console.log("尚未添加视频链接。");
} else {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    console.log(
      "作者视频链接维护：只修改本地公开题库索引，不上传视频，不自动发布。",
    );
    const id = (
      await prompt.question(
        "链接编号（英文字母、数字、短横线；同编号为修改）：",
      )
    ).trim();
    const existing = (catalog.videoLessons || []).find((v) => v.id === id);
    if (args.includes("--remove")) {
      if (!existing) throw new Error("编号不存在");
      if (
        (
          await prompt.question(
            `从公开索引移除「${existing.title}」？输入 yes：`,
          )
        ).trim() !== "yes"
      )
        throw new Error("已取消");
      catalog.videoLessons = catalog.videoLessons.filter((v) => v.id !== id);
    } else {
      const target = "question";
      const targetId = (
        await prompt.question("题号（网页“复制题号”取得，如2025|三|(1)）：")
      ).trim();
      const title = (await prompt.question("视频标题：")).trim();
      const url = videoUrl(
        (
          await prompt.question("完整B站链接（可带 ?p=分P&t=起始秒数）：")
        ).trim(),
      );
      const lesson = { id, target, targetId, title, url };
      catalog.videoLessons = [
        ...(catalog.videoLessons || []).filter((v) => v.id !== id),
        lesson,
      ];
    }
    validateCatalog(catalog);
    if (
      catalog.videoLessons.some(
        (v) => v.target === "knowledge" || v.segments?.length,
      ) &&
      newer("0.5.5", catalog.requiresProgram || "0.4.0")
    )
      catalog.requiresProgram = "0.5.5";
    if (
      (
        await prompt.question("已准备修改。确认写入本地题库？输入 yes：")
      ).trim() !== "yes"
    )
      throw new Error("已取消");
    if (fs.readFileSync(file, "utf8") !== original)
      throw new Error("题库已被其他操作修改，请重试");
    atomicJson(file, catalog);
    console.log(
      "已保存本地索引。请核对链接，构建验收后随题库更新发布；这不是公共答案图片更新。",
    );
  } finally {
    prompt.close();
  }
}
