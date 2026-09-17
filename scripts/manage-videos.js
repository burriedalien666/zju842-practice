import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { videoUrl } from "../src/curriculum.js";
import { validateCatalog } from "../server/catalog.js";
import { atomicJson } from "../server/update-files.js";
import { fileURLToPath } from "node:url";
const file = fileURLToPath(new URL("../public/catalog.json", import.meta.url));
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
if (!catalog.curriculum) throw new Error("请先整理知识点目录");
if (args.includes("--list")) {
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
      const kind = (
        await prompt.question("关联单题填 q，关联章节填 c：")
      ).trim();
      if (!["q", "c"].includes(kind)) throw new Error("请选择 q 或 c");
      const target = kind === "q" ? "question" : "chapter";
      if (target === "chapter")
        for (const c of catalog.curriculum.chapters)
          console.log(c.id + " " + c.title);
      const targetId = (
        await prompt.question(
          target === "chapter"
            ? "章节编号："
            : "题号（网页“复制题号”取得，如2025|三|(1)）：",
        )
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
      (
        await prompt.question("已准备修改。确认写入本地题库？输入 yes：")
      ).trim() !== "yes"
    )
      throw new Error("已取消");
    atomicJson(file, catalog);
    console.log(
      "已保存本地索引。请核对链接，构建验收后随题库更新发布；这不是公共答案图片更新。",
    );
  } finally {
    prompt.close();
  }
}
