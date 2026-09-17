import fs from "node:fs";
import {
  chapters,
  topics,
  trainingTypes,
  annotate,
} from "./curriculum-source.js";
import { validateCatalog } from "../server/catalog.js";

const file = new URL("../public/catalog.json", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
catalog.curriculum = {
  version: 1,
  basis: "2024年842统考大纲；于慧敏学习指导；阎石第六版",
  chapters,
  topics,
  trainingTypes,
  mappingNote:
    "按既有题干摘要、标签及题型重新归类，综合题可涉及多个知识点。知识点标注属于整理者分类，不是官方评分细则。",
  scoreNote:
    "2025年小题分值已对照原卷PDF第61—64页核实；其他年份暂未录入分值，不能据此比较完整历年分值。",
};
const extra = {
  "2009|八|—": "d1.code d7.startup d7.state",
  "2010|九|—": "d4.arithmetic d10.shift",
  "2015|三|(1)": "s7.realization s7.roc s7.limits",
  "2021|三|(1)": "s6.realization",
  "2022|四|(1)": "s6.inverse s6.limits",
  "2023|三|(1)": "s6.realization s6.limits s6.roc",
  "2023|七|—": "d7.startup d6.excitation",
  "2024|八|—": "d7.startup d7.state",
  "2025|三|(1)": "s6.realization s6.inverse s6.roc s6.limits s3.eigen",
  "2025|四|(1)": "s7.roc s7.stability s4.series s4.eigen",
  "2025|五|(1)": "s3.response",
  "2025|五|(2)": "s3.transform s3.symmetry",
  "2025|七|(2)": "d8.schmitt",
};
// Scores transcribed from the section instructions, not inferred from total / item count.
const score2025 = {
  一: [5, 5, 5, 5],
  二: [3, 3, 4],
  三: [5, 4, 5, 5],
  四: [5, 5, 5],
  五: [5, 6],
  六: [5, 5, 5, 5],
  七: [6, 6],
  八: [15],
  九: [5, 5],
  十: [10, 8],
};
const page2025 = {
  一: 61,
  二: 61,
  三: 61,
  四: 62,
  五: 62,
  六: 63,
  七: 63,
  八: 63,
  九: 64,
  十: 64,
};
for (const q of catalog.questions) {
  Object.assign(q, annotate(q));
  q.knowledgeIds = [
    ...new Set([
      ...q.knowledgeIds,
      ...(extra[q.id] || "").split(" ").filter(Boolean),
    ]),
  ];
  if (q.year === 2025) {
    const section = q.id.split("|")[1],
      sub = q.id.split("|")[2];
    const index = sub === "—" ? 0 : Number(sub.replace(/[()]/g, "")) - 1;
    const points = score2025[section]?.[index];
    if (!Number.isFinite(points)) throw new Error("分值索引不完整：" + q.id);
    q.score = {
      points,
      sourcePage: page2025[section],
      note: "原卷题头明确分值",
    };
  }
}
catalog.libraryRevision = 2;
catalog.edition = "2026-09-18 · 考点与训练分类";
catalog.requiresProgram = "0.5.0";
catalog.videoLessons ||= [];
validateCatalog(catalog);
fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
console.log(
  `Classified ${catalog.questions.length} questions without changing IDs; ${topics.length} concepts, ${trainingTypes.length} training tasks.`,
);
