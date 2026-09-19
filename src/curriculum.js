export function filterLabel(catalog, value) {
  if (value?.startsWith("knowledge:"))
    return catalog.curriculum?.topics.find((t) => t.id === value.slice(10));
  if (value?.startsWith("training:"))
    return catalog.curriculum?.trainingTypes.find(
      (t) => t.id === value.slice(9),
    );
  return catalog.types.find((t) => t.id === value);
}
export function matchesTraining(q, value) {
  if (!value) return true;
  if (value.startsWith("knowledge:"))
    return q.knowledgeIds?.includes(value.slice(10)) || false;
  if (value.startsWith("training:"))
    return q.trainingIds?.includes(value.slice(9)) || false;
  return q.typeId === value;
}
export function curriculumChapters(catalog) {
  const assigned = new Set();
  const chapters = catalog.curriculum.chapters.map((c) => {
    const qs = catalog.questions.filter((q) => q.primaryChapter === c.id);
    qs.forEach((q) => assigned.add(q.id));
    const legacy = catalog.types.filter((t) =>
      qs.some((q) => q.typeId === t.id),
    );
    const types = catalog.curriculum.trainingTypes
      .filter(
        (t) =>
          t.subject === c.subject &&
          qs.some((q) => q.trainingIds?.includes(t.id)),
      )
      .map((t) => ({ ...t, id: "training:" + t.id }));
    return {
      ...c,
      types: [...types, ...legacy],
      legacyTypes: legacy,
      questionIds: new Set(qs.map((q) => q.id)),
      sections: [{ title: "按解题任务训练", types }],
      knowledge: catalog.curriculum.topics.filter((t) => t.chapter === c.id),
    };
  });
  for (const subject of ["signals", "digital"]) {
    const qs = catalog.questions.filter(
      (q) => q.subject === subject && !assigned.has(q.id),
    );
    const orphanTypes = catalog.types.filter(
      (t) =>
        t.subject === subject &&
        !chapters.some((c) => c.types.some((x) => x.id === t.id)),
    );
    if (qs.length || orphanTypes.length)
      chapters.push({
        id: subject + "-other",
        subject,
        number: "补充",
        title: "待归类题目",
        summary: "新导入或尚未标注的题目",
        symbol: "+",
        questionIds: new Set(qs.map((q) => q.id)),
        types: orphanTypes,
        sections: [{ title: "原题型", types: orphanTypes }],
        knowledge: [],
      });
  }
  return chapters;
}

export function videoUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["www.bilibili.com", "bilibili.com"].includes(url.hostname) ||
    !/^\/video\/(BV[a-zA-Z0-9]{10}|av[1-9]\d*)\/?$/.test(url.pathname)
  )
    throw new Error("请使用完整的 https://www.bilibili.com/video/BV… 视频链接");
  url.hostname = "www.bilibili.com";
  url.hash = "";
  const clean = new URL(url.origin + url.pathname);
  for (const key of ["p", "t"])
    if (url.searchParams.has(key)) {
      const value = url.searchParams.get(key);
      if (
        !/^\d+$/.test(value) ||
        Number(value) > (key === "p" ? 10000 : 86400) ||
        (key === "p" && Number(value) < 1)
      )
        throw new Error("视频分P或起始时间不合法");
      clean.searchParams.set(key, String(Number(value)));
    }
  return clean.href;
}
export function validateCurriculum(catalog) {
  const c = catalog.curriculum;
  if (!c) {
    if (catalog.videoLessons?.length) throw new Error("视频关联需要考点目录");
    return;
  }
  if (c.version !== 1) throw new Error("考点目录版本不正确");
  function table(rows, label) {
    if (!Array.isArray(rows) || rows.length > 2000)
      throw new Error(label + "格式不正确");
    const map = new Map();
    for (const r of rows) {
      if (
        !r ||
        typeof r.id !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,80}$/.test(r.id) ||
        map.has(r.id) ||
        typeof r.title !== "string" ||
        !r.title.trim() ||
        r.title.length > 150
      )
        throw new Error(label + "编号或标题不正确");
      map.set(r.id, r);
    }
    return map;
  }
  const chapters = table(c.chapters, "章节"),
    topics = table(c.topics, "知识点"),
    training = table(c.trainingTypes, "训练题型");
  for (const ch of chapters.values())
    if (
      !["signals", "digital"].includes(ch.subject) ||
      typeof ch.summary !== "string" ||
      typeof ch.number !== "string"
    )
      throw new Error("章节科目或摘要不正确");
  for (const t of topics.values())
    if (!chapters.has(t.chapter)) throw new Error("知识点缺少所属章节");
  for (const t of training.values())
    if (!["signals", "digital"].includes(t.subject))
      throw new Error("训练题型科目不正确");
  for (const q of catalog.questions) {
    if (
      q.primaryChapter == null &&
      q.knowledgeIds == null &&
      q.trainingIds == null
    )
      continue;
    if (chapters.get(q.primaryChapter)?.subject !== q.subject)
      throw new Error("题目主章节不正确：" + q.id);
    for (const [values, map, label] of [
      [q.knowledgeIds, topics, "知识点"],
      [q.trainingIds, training, "训练题型"],
    ]) {
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.length > 30 ||
        new Set(values).size !== values.length ||
        values.some(
          (id) =>
            !map.has(id) ||
            (map === topics
              ? chapters.get(map.get(id).chapter).subject
              : map.get(id).subject) !== q.subject,
        )
      )
        throw new Error("题目" + label + "关联不正确：" + q.id);
    }
  }
  for (const q of catalog.questions)
    if (
      q.score != null &&
      (!Number.isFinite(q.score.points) ||
        q.score.points <= 0 ||
        q.score.points > 150 ||
        !Number.isInteger(q.score.sourcePage) ||
        q.score.sourcePage < 1 ||
        typeof q.score.note !== "string")
    )
      throw new Error("题目分值依据不正确");
  if (
    !Array.isArray(catalog.videoLessons || []) ||
    (catalog.videoLessons || []).length > 5000
  )
    throw new Error("视频目录格式不正确");
  const ids = new Set();
  for (const v of catalog.videoLessons || []) {
    if (
      !v ||
      typeof v.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(v.id) ||
      ids.has(v.id) ||
      typeof v.title !== "string" ||
      !v.title.trim() ||
      v.title.length > 150 ||
      !["question", "chapter", "knowledge"].includes(v.target) ||
      (v.target === "chapter"
        ? !chapters.has(v.targetId)
        : v.target === "knowledge"
          ? !topics.has(v.targetId)
          : !catalog.questions.some((q) => q.id === v.targetId))
    )
      throw new Error("视频关联不正确");
    videoUrl(v.url);
    for (const field of ["author", "collection"])
      if (
        v[field] != null &&
        (typeof v[field] !== "string" ||
          !v[field].trim() ||
          v[field].length > 150)
      )
        throw new Error("视频作者或合集名称不合法");
    if (v.segments != null) {
      if (!Array.isArray(v.segments) || v.segments.length > 100)
        throw new Error("视频分段目录不合法");
      let previous = -1;
      for (const segment of v.segments) {
        if (
          !segment ||
          typeof segment.title !== "string" ||
          !segment.title.trim() ||
          segment.title.length > 100 ||
          !Number.isInteger(segment.seconds) ||
          segment.seconds < 0 ||
          segment.seconds > 86400 ||
          segment.seconds <= previous
        )
          throw new Error("视频分段时间必须递增且标题有效");
        previous = segment.seconds;
      }
    }
    ids.add(v.id);
  }
}
