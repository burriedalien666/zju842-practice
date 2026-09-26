import {
  questionRating,
  ratingCounts,
  completionProgress,
} from "./learning-progress.js";
export { questionRating, ratingCounts } from "./learning-progress.js";
import { escapeHtml as esc, videoEntryMarkup } from "./learning-content.js";
import { uiIcon } from "./ui-icons.js";
import { questionBodyMarkup } from "./structured-question.js";

export const ratingNames = {
  good: "掌握",
  hard: "不熟",
  wrong: "不会",
  done: "已做（未自评）",
};
export function durationText(ms) {
  if (ms === undefined) return "未记录用时";
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function progressMarkup(questions, marks) {
  const counts = completionProgress(questions, marks);
  const { completed, percent } = counts;
  const state = !completed
    ? "none"
    : completed === counts.total
      ? "good"
      : "hard";
  const explanation = `完成进度 ${percent}%（已做 ${completed} / 总题数 ${counts.total}）；掌握 ${counts.good}、不熟 ${counts.hard}、不会 ${counts.wrong}、未做 ${counts.unmarked}${counts.done ? "；另有旧版已做但未自评 " + counts.done + " 题" : ""}`;
  return `<span class="directory-status status-${state}" aria-hidden="true"></span><span class="nav-progress" data-completed="${completed}" data-total="${counts.total}" aria-label="${explanation}" title="${explanation}"><span class="segmented-progress" aria-hidden="true">${[
    ["good", counts.good],
    ["hard", counts.hard],
    ["wrong", counts.wrong],
    ["done", counts.done],
    ["none", counts.unmarked],
  ]
    .filter(([, n]) => n)
    .map(
      ([key, n]) =>
        `<i class="segment-${key}" style="width:${(100 * n) / counts.total}%"></i>`,
    )
    .join(
      "",
    )}</span><span class="mastery-indicator"><i class="status-${state}" aria-hidden="true"></i><span>${percent}% (${completed}/${counts.total})</span></span></span>`;
}
export function starButton(star) {
  return `<button type="button" data-action="star" class="star-toggle ${star ? "is-starred" : ""}" aria-label="${star ? "取消收藏" : "收藏本题"}" aria-pressed="${star}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L1.9 9.6l6.3-.9Z"/></svg></button>`;
}
export function ratingMarkup(rating, disabled = false) {
  return `<div class="review-ratings" aria-label="本题自评">${[
    ["good", "check"],
    ["hard", "unsure"],
    ["wrong", "cross"],
  ]
    .map(
      ([key, icon]) =>
        `<button type="button" data-action="grade-${key}" class="rating-${key} ${rating === key ? "is-rated" : ""}" aria-pressed="${rating === key}" ${disabled ? "disabled" : ""}>${uiIcon(icon)}${ratingNames[key]}</button>`,
    )
    .join("")}</div>`;
}
export function readerMarkup({
  catalog,
  q,
  record,
  rating,
  finished,
  admin,
  localMode,
  preserveAnswer,
  inList = false,
}) {
return `<div class="reader-heading"><div class="question-badges"><span>${q.year}</span><span>${esc(q.number)}</span>${q.score ? `<span class="score-badge">${q.score.points}分</span>` : ""}</div><div class="question-utilities"><button type="button" data-action="share" class="utility-icon" title="复制题号" aria-label="复制题号">${uiIcon("copy")}</button><button type="button" data-action="correction" class="utility-icon" title="题目纠错" aria-label="题目纠错">${uiIcon("alert")}</button>${starButton(record.star)}<details class="question-more"><summary class="utility-icon" aria-label="更多题目操作" title="更多题目操作">${uiIcon("more")}</summary><div><button type="button" data-action="add-list">加入题单</button>${inList ? '<button type="button" data-action="remove-view">移出当前题单</button>' : ""}</div></details></div></div>${questionBodyMarkup(catalog, q)}<div class="question-actions">${videoEntryMarkup(catalog, q.id)}<button type="button" data-action="toggle-answers" class="primary answer-toggle" aria-expanded="${!!preserveAnswer}">${uiIcon("checkCircle")}<span>${preserveAnswer ? "收起答案" : "查看答案"}</span></button></div><section class="answer-section" ${preserveAnswer ? "" : "hidden"}><div class="answer-heading"><h3>参考答案</h3>${admin ? `<button type="button" data-action="edit-answer" class="text-button">${localMode ? "编辑我的答案" : "编辑照片答案"}</button>` : ""}</div><div id="answer-content">正在读取…</div></section><section class="review-panel">${ratingMarkup(rating, finished)}${finished ? '<p class="muted small">本轮已结束，保留本轮自评；可从右上角开始新一轮。</p>' : ""}</section>`;
}
export function pickerMarkup(questions, current, records, marks) {
  return `<div class="picker-title"><strong>快速选题</strong><span class="muted small">共 ${questions.length} 题</span></div><form id="jump-form"><label for="jump-number">跳至序号</label><input id="jump-number" name="index" type="number" min="1" max="${questions.length}" required inputmode="numeric" placeholder="1—${questions.length}"><button type="submit">跳转</button></form><div class="question-number-grid">${questions.map((q, i) => `<button type="button" data-action="select-question" data-id="${esc(q.id)}" class="number-tile ${q.id === current ? "is-current" : ""} ${marks[q.id] ? "mark-" + esc(marks[q.id]) : ""}" ${q.id === current ? 'aria-current="true"' : ""} aria-label="第${i + 1}题，${q.year}年 ${esc(q.number)}，${ratingNames[marks[q.id]] || "未自评"}${records[q.id]?.star ? "，已收藏" : ""}" title="${q.year}年 ${esc(q.number)} · ${esc(q.title)}"><span>${i + 1}</span>${records[q.id]?.star ? '<small aria-hidden="true">★</small>' : ""}<i aria-hidden="true"></i></button>`).join("")}</div><p class="muted small picker-legend">绿色 掌握 · 黄色 不熟 · 红色 不会<br>数字是本次练习序号，原卷题号保留在题面。</p>`;
}
export function roundSummaryMarkup(paper, run) {
  const ids = run.questionIds || paper.questions.map((q) => q.id);
  const qs = ids.map((id) => ({ id }));
  const counts = ratingCounts(qs, run.marks);
  return `<div class="round-stats"><span><strong>${counts.total - counts.unmarked}/${counts.total}</strong>已做</span><span><strong>${counts.good}</strong>掌握</span><span><strong>${counts.hard}</strong>不熟</span><span><strong>${counts.wrong}</strong>不会</span><span><strong>${counts.unmarked}</strong>未做</span></div>${counts.done ? `<p class="muted small">另有 ${counts.done} 题为旧版“已做”标记，未推断掌握程度。</p>` : ""}<p class="muted small">${run.timingPartial ? "升级后累计用时" : "用时"} ${durationText(run.elapsedMs)} · 自评记录，不换算试卷得分</p>${run.timingPartial ? '<p class="muted small">旧版未记录用时，以上不包含升级前的练习时间。</p>' : ""}`;
}
