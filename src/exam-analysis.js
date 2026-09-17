export function analyse(
  catalog,
  { subject = "signals", from, to, level = "chapter" } = {},
) {
  const years = [
    ...new Set(
      catalog.questions
        .filter((q) => q.sourceKind === "entrance" && q.subject === subject)
        .map((q) => q.year),
    ),
  ]
    .sort((a, b) => a - b)
    .filter((y) => (!from || y >= Number(from)) && (!to || y <= Number(to)));
  const questions = catalog.questions.filter(
    (q) =>
      q.sourceKind === "entrance" &&
      q.subject === subject &&
      years.includes(q.year),
  );
  const chapters = (catalog.curriculum?.chapters || []).filter(
    (c) => c.subject === subject,
  );
  const definitions =
    level === "topic"
      ? (catalog.curriculum?.topics || []).filter((t) =>
          chapters.some((c) => c.id === t.chapter),
        )
      : chapters;
  const summarize = (qs) => ({
    ids: [...new Set(qs.map((q) => q.id))],
    count: qs.length,
    scored: qs.filter((q) => q.score != null).length,
    points: qs.some((q) => q.score != null)
      ? qs.reduce((s, q) => s + (q.score?.points || 0), 0)
      : null,
    years: new Set(qs.map((q) => q.year)).size,
  });
  const rows = definitions.map((def) => {
    const qs = questions.filter((q) =>
      level === "topic"
        ? q.knowledgeIds?.includes(def.id)
        : q.primaryChapter === def.id,
    );
    return {
      ...def,
      ...summarize(qs),
      cells: years.map((year) => ({
        year,
        ...summarize(qs.filter((q) => q.year === year)),
      })),
    };
  });
  return {
    years,
    rows,
    summary: summarize(questions),
    yearTotals: years.map((year) => ({
      year,
      ...summarize(questions.filter((q) => q.year === year)),
    })),
    unclassified: questions.filter(
      (q) => !chapters.some((c) => c.id === q.primaryChapter),
    ).length,
    coveredTopics: new Set(questions.flatMap((q) => q.knowledgeIds || [])).size,
  };
}
export function cellText(cell, metric) {
  if (!cell.count) return "0";
  if (metric === "points")
    return cell.points == null
      ? "—"
      : String(cell.points) + (cell.scored < cell.count ? "*" : "");
  return metric === "presence" ? "●" : String(cell.count);
}
