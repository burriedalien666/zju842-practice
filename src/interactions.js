export const SCOPE_NAMES = {
  star: "我的收藏",
  review: "待复习",
  done: "已掌握",
  due: "到期复习",
  wrong: "错题重做",
};
export function scopeName(filters) {
  return filters.list || SCOPE_NAMES[filters.status] || "";
}
export function clearSearchFilters(filters) {
  return { ...filters, source: "", year: "", search: "" };
}
export function toggleMark(record, action) {
  const next = structuredClone(record || { state: "", star: false });
  if (action === "star") next.star = !next.star;
  else if (["review", "done"].includes(action))
    next.state = next.state === action ? "" : action;
  else throw new Error("未知学习标记");
  return next;
}
export function removeScopeMark(study, id, filters) {
  const row = study.records[id] || { state: "", star: false };
  if (filters.list) {
    const list = study.lists.find((l) => l.name === filters.list);
    if (list) list.ids = list.ids.filter((q) => q !== id);
    return;
  }
  if (filters.status === "star") row.star = false;
  else if (filters.status === "review" && row.state === "review")
    row.state = "";
  else if (filters.status === "done" && row.state === "done") row.state = "";
  else if (filters.status === "wrong" && row.review) row.review.wrong = false;
  else if (filters.status === "due" && row.review) row.review.suspended = true;
  study.records[id] = row;
}
export function reconcileSelection(previousIds, nextIds, current, queue = []) {
  const allowed = new Set(nextIds),
    prior = queue.length ? queue : previousIds;
  const remaining = queue.length ? queue.filter((id) => allowed.has(id)) : [];
  let selected = allowed.has(current) ? current : null;
  if (!selected) {
    const index = prior.indexOf(current);
    selected =
      prior.slice(index + 1).find((id) => allowed.has(id)) ||
      prior
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((id) => allowed.has(id)) ||
      nextIds[0] ||
      null;
  }
  return { current: selected, queue: remaining };
}
