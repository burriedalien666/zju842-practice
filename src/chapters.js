// 章节顺序参考用户提供的2020年905单考大纲；842已有真题全部保留。
import { isDue } from "./review.js";
export const CHAPTERS = [
  {
    id: "s1",
    subject: "signals",
    number: "01",
    title: "信号与系统基础",
    summary: "基本信号 · 自变量变换 · 系统性质",
    symbol: "∿",
    groups: ["A1"],
    sections: [["信号与系统的基本概念", ["A1"]]],
  },
  {
    id: "s2",
    subject: "signals",
    number: "02",
    title: "LTI 系统的时域分析",
    summary: "卷积积分与卷积和 · 响应分解",
    symbol: "∫",
    groups: ["A2"],
    sections: [
      ["卷积与系统响应", ["A2.1", "A2.2", "A2.6", "A2.7"]],
      ["初始状态与响应分解", ["A2.3", "A2.4", "A2.5", "A2.8"]],
    ],
  },
  {
    id: "s3",
    subject: "signals",
    number: "03",
    title: "连续时间频域分析",
    summary: "傅里叶级数与变换 · 频率响应 · 滤波",
    symbol: "ℱ",
    groups: ["A3"],
    types: ["A9.1", "A9.4", "A9.6"],
    sections: [
      ["傅里叶级数与傅里叶变换", ["A3"]],
      ["频率响应与滤波器", ["A9.1", "A9.4", "A9.6"]],
    ],
  },
  {
    id: "s4",
    subject: "signals",
    number: "04",
    title: "离散时间频域分析",
    summary: "DTFT · 离散傅里叶级数 · 频域计算",
    symbol: "Σ",
    groups: ["A4"],
    types: ["A9.2", "A9.3", "A9.5"],
    sections: [
      ["离散傅里叶分析", ["A4"]],
      ["离散频率响应与系统应用", ["A9.2", "A9.3", "A9.5"]],
    ],
  },
  {
    id: "s5",
    subject: "signals",
    number: "05",
    title: "采样、调制与通信",
    summary: "采样与混叠 · 信号重构 · 调制解调",
    symbol: "↗",
    groups: ["A7", "A8"],
    sections: [
      ["采样、恢复与多速率", ["A7"]],
      ["调制、解调与频谱搬移", ["A8"]],
    ],
  },
  {
    id: "s6",
    subject: "signals",
    number: "06",
    title: "拉普拉斯变换与系统分析",
    summary: "拉氏变换 · 收敛域与零极点 · 连续系统",
    symbol: "s",
    groups: ["A5"],
    sections: [
      ["变换、性质与收敛域", ["A5.1", "A5.2", "A5.7"]],
      ["系统函数、响应与实现", ["A5.3", "A5.4", "A5.5", "A5.6", "A5.8"]],
    ],
  },
  {
    id: "s7",
    subject: "signals",
    number: "07",
    title: "Z 变换与离散系统",
    summary: "Z 变换 · 收敛域 · 差分方程与实现",
    symbol: "z",
    groups: ["A6"],
    sections: [
      ["Z 变换与反变换", ["A6.1", "A6.2"]],
      ["离散系统分析与实现", ["A6.3", "A6.4", "A6.5", "A6.6", "A6.7"]],
    ],
  },
  {
    id: "d1",
    subject: "digital",
    number: "01",
    title: "数制与编码",
    summary: "BCD 码 · 格雷码 · 编码与转换",
    symbol: "01",
    groups: ["B1"],
    sections: [["数制与常用编码", ["B1"]]],
  },
  {
    id: "d2",
    subject: "digital",
    number: "02",
    title: "逻辑代数与函数化简",
    summary: "逻辑运算 · 标准形式 · 卡诺图",
    symbol: "⊕",
    groups: ["B2"],
    types: ["B3.1", "B3.3", "B3.4", "B3.5"],
    sections: [
      ["逻辑代数与函数表示", ["B2"]],
      ["公式化简与卡诺图", ["B3.1", "B3.3", "B3.4", "B3.5"]],
    ],
  },
  {
    id: "d3",
    subject: "digital",
    number: "03",
    title: "集成门电路",
    summary: "TTL 与 CMOS · 电平 · 接口与扇出",
    symbol: "&",
    groups: ["B4"],
    sections: [["门电路原理与接口", ["B4"]]],
  },
  {
    id: "d4",
    subject: "digital",
    number: "04",
    title: "组合逻辑分析与设计",
    summary: "真值表 · 逻辑实现 · 竞争冒险",
    symbol: "⊞",
    types: ["B5.1", "B5.7", "B3.2"],
    sections: [
      ["组合逻辑分析与设计", ["B5.1", "B5.7"]],
      ["竞争冒险的判别与消除", ["B3.2"]],
    ],
  },
  {
    id: "d5",
    subject: "digital",
    number: "05",
    title: "常用组合逻辑模块",
    summary: "编码器 · 译码器 · 数据选择器 · 加法器",
    symbol: "▦",
    types: ["B5.2", "B5.3", "B5.4", "B5.5", "B5.6", "B5.8"],
    sections: [
      ["编码、译码与显示", ["B5.2", "B5.5", "B5.6"]],
      ["数据选择与算术模块", ["B5.3", "B5.4", "B5.8"]],
    ],
  },
  {
    id: "d6",
    subject: "digital",
    number: "06",
    title: "触发器",
    summary: "状态与激励方程 · 时钟控制 · 功能转换",
    symbol: "T",
    groups: ["B6"],
    sections: [["触发器结构与功能", ["B6"]]],
  },
  {
    id: "d7",
    subject: "digital",
    number: "07",
    title: "时序逻辑分析与设计",
    summary: "寄存器 · 计数器 · 状态机与控制器",
    symbol: "↻",
    groups: ["B7", "B8", "B9", "B10"],
    sections: [
      ["时序电路分析", ["B9"]],
      ["寄存器、计数器与序列", ["B7", "B8"]],
      ["状态机与控制器设计", ["B10"]],
    ],
  },
  {
    id: "d8",
    subject: "digital",
    number: "专题 01",
    title: "脉冲与波形电路",
    summary: "振荡器 · 单稳态 · 施密特触发器",
    symbol: "⌁",
    supplement: true,
    groups: ["B11"],
    sections: [["脉冲产生、整形与应用", ["B11"]]],
  },
  {
    id: "d9",
    subject: "digital",
    number: "专题 02",
    title: "存储器",
    summary: "容量计算 · 字扩展 · 位扩展",
    symbol: "▤",
    supplement: true,
    groups: ["B12"],
    sections: [["存储器容量与扩展", ["B12"]]],
  },
];
const matches = (type, keys = []) =>
  keys.includes(type.id) || keys.includes(type.group);
// 旧题型混合了连续、离散应用；按已核对的原题编号拆分，保留原题号。
const QUESTION_CHAPTERS = {
  "2013|四|(c)": "s6",
  "2015|二|(1)": "s4",
  "2024|四|(3)": "s4",
};
export function buildChapters(catalog) {
  const assigned = new Set();
  const chapters = CHAPTERS.map((chapter) => {
    const types = catalog.types.filter(
      (type) =>
        type.subject === chapter.subject &&
        matches(type, [...(chapter.groups || []), ...(chapter.types || [])]),
    );
    types.forEach((type) => {
      if (assigned.has(type.id)) throw new Error("章节重复归类：" + type.id);
      assigned.add(type.id);
    });
    const sectioned = new Set();
    const sections = chapter.sections
      .map(([title, keys]) => ({
        title,
        types: types
          .filter((type) => {
            if (!matches(type, keys)) return false;
            sectioned.add(type.id);
            return true;
          })
          .sort((a, b) =>
            a.id.localeCompare(b.id, undefined, { numeric: true }),
          ),
      }))
      .filter((s) => s.types.length);
    const rest = types.filter((type) => !sectioned.has(type.id));
    if (rest.length) sections.push({ title: "相关题型", types: rest });
    return { ...chapter, types, sections };
  });
  for (const subject of ["signals", "digital"]) {
    const types = catalog.types.filter(
      (t) => t.subject === subject && !assigned.has(t.id),
    );
    if (types.length)
      chapters.push({
        id: subject + "-other",
        subject,
        number: "拓展",
        title: "其他题型",
        summary: "新题库中的未归档内容",
        symbol: "＋",
        types,
        sections: [{ title: "其他题型", types }],
      });
  }
  const primary = new Map(
    chapters.flatMap((c) => c.types.map((t) => [t.id, c.id])),
  );
  for (const chapter of chapters) {
    chapter.questionIds = new Set(
      catalog.questions
        .filter(
          (q) =>
            (QUESTION_CHAPTERS[q.id] || primary.get(q.typeId)) === chapter.id,
        )
        .map((q) => q.id),
    );
    for (const q of catalog.questions.filter((q) =>
      chapter.questionIds.has(q.id),
    )) {
      if (chapter.types.some((t) => t.id === q.typeId)) continue;
      const type = catalog.types.find((t) => t.id === q.typeId);
      chapter.types.push(type);
      chapter.sections.at(-1).types.push(type);
    }
    const titles =
      chapter.id === "s6"
        ? { "A9.3": "连续系统的逆系统与冲激响应" }
        : chapter.id === "s4"
          ? { "A9.3": "数字回波消除器设计", "A9.4": "离散滤波器类型与频响性质" }
          : chapter.id === "s3"
            ? { "A9.4": "连续滤波器特性与物理可实现性" }
            : {};
    chapter.types = chapter.types.map((t) => ({
      ...t,
      title: titles[t.id] || t.title,
    }));
    chapter.sections = chapter.sections.map((s) => ({
      ...s,
      types: s.types.map((t) => chapter.types.find((x) => x.id === t.id)),
    }));
  }
  return chapters;
}
export function chapterForType(chapters, id) {
  return chapters.find((c) => c.types.some((t) => t.id === id));
}
export function chapterQuestions(chapter, questions) {
  return questions.filter((q) => chapter.questionIds.has(q.id));
}
export function chapterForQuestion(chapters, q) {
  return (
    chapters.find((c) => c.questionIds.has(q.id)) ||
    chapterForType(chapters, q.typeId)
  );
}
export function filterQuestions(
  catalog,
  filters,
  records,
  chapters,
  scope = true,
) {
  const list = filters.list
    ? records.lists?.find((l) => l.name === filters.list)
    : null;
  const marks = records.records || {};
  const typeMap = new Map(catalog.types.map((t) => [t.id, t]));
  const questionChapters = new Map(
    chapters.flatMap((c) => [...c.questionIds].map((id) => [id, c])),
  );
  const search = (filters.search || "").trim().toLowerCase();
  return catalog.questions.filter((q) => {
    const r = marks[q.id] || {},
      chapter = questionChapters.get(q.id),
      type = typeMap.get(q.typeId);
    return (
      q.subject === filters.subject &&
      (!filters.source || q.sourceKind === filters.source) &&
      (!filters.year || q.year === Number(filters.year)) &&
      (!scope || !filters.chapter || chapter?.id === filters.chapter) &&
      (!scope || !filters.type || q.typeId === filters.type) &&
      (!filters.status ||
        (filters.status === "star"
          ? r.star
          : filters.status === "due"
            ? isDue(r)
            : filters.status === "wrong"
              ? r.review?.wrong
              : r.state === filters.status)) &&
      (!filters.list || list?.ids.includes(q.id)) &&
      (!search ||
        `${q.id} ${q.title} ${q.number} ${q.year} ${q.tags.join(" ")} ${type?.title || ""} ${chapter?.title || ""}`
          .toLowerCase()
          .includes(search))
    );
  });
}
