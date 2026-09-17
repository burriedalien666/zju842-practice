const DAY = 86400000;
export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 60, 120];
export function reviewSettings(value = {}) {
  const intervals = value.intervals ?? DEFAULT_INTERVALS;
  if (
    !Array.isArray(intervals) ||
    intervals.length < 3 ||
    intervals.length > 12 ||
    intervals.some(
      (n, i) =>
        !Number.isInteger(n) ||
        n < 1 ||
        n > 365 ||
        (i && n <= intervals[i - 1]),
    )
  )
    throw new Error("复习间隔须为递增的1—365天整数，至少3项");
  return { intervals: [...intervals] };
}
export function validateReview(r) {
  if (
    !r ||
    !Number.isInteger(r.stage) ||
    r.stage < 0 ||
    r.stage > 12 ||
    !Number.isInteger(r.lapses) ||
    r.lapses < 0 ||
    !Number.isInteger(r.attempts) ||
    r.attempts < 1 ||
    !Number.isFinite(r.due) ||
    r.due < 0 ||
    !Number.isFinite(r.last) ||
    r.last < 0 ||
    !["wrong", "hard", "good"].includes(r.rating) ||
    typeof r.wrong !== "boolean"
  )
    throw new Error("复习记录格式不正确");
  if (r.suspended !== undefined && typeof r.suspended !== "boolean")
    throw new Error("复习暂停状态不合法");
  return {
    ...(r.suspended !== undefined ? { suspended: r.suspended } : {}),
    stage: r.stage,
    lapses: r.lapses,
    attempts: r.attempts,
    due: r.due,
    last: r.last,
    rating: r.rating,
    wrong: r.wrong,
  };
}
export function scheduleReview(
  previous,
  rating,
  settings = {},
  now = Date.now(),
) {
  if (!["wrong", "hard", "good"].includes(rating) || !Number.isFinite(now))
    throw new Error("复习评价不合法");
  const { intervals } = reviewSettings(settings);
  const old = previous
    ? validateReview(previous)
    : { stage: 0, lapses: 0, attempts: 0, wrong: false };
  let stage = old.stage,
    due,
    wrong = old.wrong;
  if (rating === "wrong") {
    stage = 0;
    due = now + 10 * 60000;
    wrong = true;
  } else if (rating === "hard") {
    stage = Math.max(0, stage - 1);
    due = now + intervals[Math.min(stage, intervals.length - 1)] * DAY;
  } else {
    // 提前反复点击不算完成新的到期复习，避免一天内把间隔推到数月。
    const advances = !previous || old.due <= now;
    due =
      previous && !advances
        ? old.due
        : now + intervals[Math.min(stage, intervals.length - 1)] * DAY;
    if (advances) stage = Math.min(stage + 1, intervals.length);
    wrong = false;
  }
  return {
    stage,
    lapses: old.lapses + (rating === "wrong" ? 1 : 0),
    attempts: old.attempts + 1,
    due,
    last: now,
    rating,
    wrong,
  };
}
export function isDue(record, now = Date.now()) {
  return (
    !!record?.review && !record.review.suspended && record.review.due <= now
  );
}
export function dueIds(questions, records, now = Date.now()) {
  return questions
    .filter((q) => isDue(records[q.id], now))
    .sort((a, b) => records[a.id].review.due - records[b.id].review.due)
    .map((q) => q.id);
}
