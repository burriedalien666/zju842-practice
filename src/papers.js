export function examPapers(catalog) {
  const papers = new Map();
  for (const q of catalog.questions) {
    if (q.sourceKind !== "entrance") continue;
    const key = String(q.year);
    if (!papers.has(key))
      papers.set(key, { id: key, year: q.year, questions: [] });
    papers.get(key).questions.push(q);
  }
  return [...papers.values()].sort((a, b) => b.year - a.year);
}
export function validateExamDate(value) {
  if (value === "") return "";
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value))
    throw new Error("请选择有效的目标考试日期");
  const d = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw new Error("目标日期不存在");
  return value;
}
export function countdown(value, now = new Date()) {
  if (!value) return null;
  validateExamDate(value);
  const [y, m, d] = value.split("-").map(Number);
  return Math.round(
    (Date.UTC(y, m - 1, d) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000,
  );
}
export function validatePaperRuns(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 200
  )
    throw new Error("整卷记录不合法");
  const result = {};
  for (const [year, run] of Object.entries(value)) {
    if (
      !/^\d{4}$/.test(year) ||
      !run ||
      !Number.isFinite(run.started) ||
      run.started < 0 ||
      !(
        run.finished === null ||
        (Number.isFinite(run.finished) && run.finished >= run.started)
      ) ||
      !run.marks ||
      typeof run.marks !== "object" ||
      Array.isArray(run.marks) ||
      Object.keys(run.marks).length > 2000
    )
      throw new Error("整卷记录不合法");
    const marks = {};
    for (const [id, rating] of Object.entries(run.marks)) {
      if (
        !id ||
        id.length > 160 ||
        ["__proto__", "prototype", "constructor"].includes(id) ||
        !["wrong", "hard", "good", "done"].includes(rating)
      )
        throw new Error("整卷作答标记不合法");
      marks[id] = rating;
    }
    result[year] = { started: run.started, finished: run.finished, marks };
  }
  return result;
}
export function paperStats(paper, run) {
  const ratings = paper.questions.map((q) => run?.marks?.[q.id]);
  return {
    total: ratings.length,
    completed: ratings.filter(Boolean).length,
    wrong: ratings.filter((r) => r === "wrong").length,
    good: ratings.filter((r) => r === "good").length,
  };
}
