export function examYears(catalog) {
  return [
    ...new Set(
      catalog.questions
        .filter((q) => q.sourceKind === "entrance")
        .map((q) => q.year),
    ),
  ].sort((a, b) => a - b);
}
export function initialAnalysisState(catalog, subject = "signals") {
  const years = examYears(catalog);
  return {
    subject,
    from: String(years.at(-5) || years[0] || ""),
    to: String(years.at(-1) || ""),
    level: "chapter",
    metric: "count",
    chapter: "",
    search: "",
    selected: "",
    year: "",
    advanced: false,
    extras: false,
    scrollLeft: 0,
    scrollTop: 0,
    scrollY: 0,
  };
}
export function normaliseAnalysisState(catalog, state = {}) {
  const initial = initialAnalysisState(catalog);
  const next = { ...initial, ...state };
  if (!["signals", "digital"].includes(next.subject)) next.subject = "signals";
  if (!["chapter", "topic"].includes(next.level)) next.level = "chapter";
  if (!["count", "presence", "points"].includes(next.metric))
    next.metric = "count";
  const years = examYears(catalog);
  if (!years.includes(Number(next.from))) next.from = initial.from;
  if (!years.includes(Number(next.to))) next.to = initial.to;
  if (Number(next.from) > Number(next.to))
    [next.from, next.to] = [next.to, next.from];
  if (
    !catalog.curriculum?.chapters.some(
      (c) => c.id === next.chapter && c.subject === next.subject,
    )
  )
    next.chapter = "";
  for (const key of ["search", "selected", "year"])
    if (typeof next[key] !== "string") next[key] = "";
  next.search = next.search.slice(0, 100);
  next.advanced = next.advanced === true;
  next.extras = next.extras === true;
  for (const key of ["scrollLeft", "scrollTop", "scrollY"])
    if (!Number.isFinite(next[key]) || next[key] < 0) next[key] = 0;
  return next;
}
export function analysisRange(catalog, state, mode) {
  const years = examYears(catalog);
  return {
    ...state,
    from: String((mode === "all" ? years[0] : years.at(-5) || years[0]) || ""),
    to: String(years.at(-1) || ""),
    selected: "",
    year: "",
    scrollLeft: 0,
    scrollTop: 0,
  };
}
export function drillChapter(state, id) {
  return {
    ...state,
    level: "topic",
    chapter: id,
    search: "",
    selected: "",
    year: "",
    scrollLeft: 0,
    scrollTop: 0,
    scrollY: 0,
  };
}
export function selectionFor(data, id, year = "") {
  const row = data.rows.find((r) => r.id === id);
  const cell = year ? row?.cells.find((c) => c.year === Number(year)) : row;
  return row && cell ? { row, cell } : null;
}
