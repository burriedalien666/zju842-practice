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
  if (!isRecord(value) || Object.keys(value).length > 200)
    throw new Error("整卷记录不合法");
  const result = {};
  for (const [year, run] of Object.entries(value)) {
    if (!/^\d{4}$/.test(year)) throw new Error("整卷记录不合法");
    result[year] = validatePaperRun(run);
  }
  return result;
}
function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function validQuestionId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 160 &&
    !["__proto__", "prototype", "constructor"].includes(id)
  );
}
function validateQuestionIds(value) {
  if (
    !Array.isArray(value) ||
    value.length > 2000 ||
    !Array.from(value).every(validQuestionId) ||
    new Set(value).size !== value.length
  )
    throw new Error("整卷题目顺序不合法");
  return [...value];
}
function validatePaperRun(run) {
  if (
    !isRecord(run) ||
    !Number.isFinite(run.started) ||
    run.started < 0 ||
    !(
      run.finished === null ||
      (Number.isFinite(run.finished) && run.finished >= run.started)
    ) ||
    !isRecord(run.marks) ||
    Object.keys(run.marks).length > 2000
  )
    throw new Error("整卷记录不合法");
  const marks = {};
  for (const [id, rating] of Object.entries(run.marks)) {
    if (
      !validQuestionId(id) ||
      !["wrong", "hard", "good", "done"].includes(rating)
    )
      throw new Error("整卷作答标记不合法");
    marks[id] = rating;
  }
  const result = { started: run.started, finished: run.finished, marks };
  if (run.elapsedMs !== undefined) {
    if (!Number.isFinite(run.elapsedMs) || run.elapsedMs < 0)
      throw new Error("整卷练习用时不合法");
    result.elapsedMs = run.elapsedMs;
  }
  if (run.timingPartial !== undefined) {
    if (typeof run.timingPartial !== "boolean")
      throw new Error("整卷部分计时标记不合法");
    result.timingPartial = run.timingPartial;
  }
  if (run.questionIds !== undefined)
    result.questionIds = validateQuestionIds(run.questionIds);
  return result;
}
export function validatePaperHistory(value) {
  if (!isRecord(value) || Object.keys(value).length > 200)
    throw new Error("整卷历史记录不合法");
  const result = {};
  for (const [year, runs] of Object.entries(value)) {
    if (!/^\d{4}$/.test(year) || !Array.isArray(runs))
      throw new Error("整卷历史记录不合法");
    result[year] = Array.from(runs, (run) => {
      const clean = validatePaperRun(run);
      if (!Number.isFinite(run.closedAt) || run.closedAt < run.started)
        throw new Error("整卷历史归档时间不合法");
      return { ...clean, closedAt: run.closedAt };
    });
  }
  return result;
}
export function startPaperRound(study, paper, now = Date.now()) {
  const year = String(paper.year);
  if (!/^\d{4}$/.test(year) || !Number.isFinite(now) || now < 0)
    throw new Error("整卷记录不合法");
  const questionIds = validateQuestionIds(paper.questions.map((q) => q.id));
  const run = {
    started: now,
    finished: null,
    marks: {},
    elapsedMs: 0,
    questionIds,
  };
  const current = study.papers?.[year];
  if (current) {
    const archived = structuredClone(current);
    archived.closedAt = now;
    if (archived.questionIds === undefined)
      archived.questionIds = [...questionIds];
    validatePaperHistory({ [year]: [archived] });
    study.paperHistory ??= {};
    study.paperHistory[year] ??= [];
    study.paperHistory[year].push(archived);
  }
  study.papers ??= {};
  study.papers[year] = run;
  return run;
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
