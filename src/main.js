import { completionProgress, recordProgress } from "./learning-progress.js";
import { uiIcon } from "./ui-icons.js";
import { prepareQuestionImages, cropImageView } from "./question-image-view.js";
import { questionBodyMarkup } from "./structured-question.js";
import { validateStructured } from "./structured-schema.js";
import { prepareStructured } from "./structured-layout.js";
import "katex/dist/katex.min.css";
import "./structured-question.css";
import "./structured-figures.css";
import "./style.css";
import "./navigation.css";
import "./papers.css";
import "./practice.css";
import {
  readerMarkup,
  pickerMarkup,
  questionRating,
  ratingCounts,
  ratingNames,
  roundSummaryMarkup,
  durationText,
} from "./practice-view.js";
import { PracticeClock } from "./practice-clock.js";
import { continuationTopics } from "./practice-continuation.js";
import { StudySaver } from "./persistence.js";
import { saveFeedback } from "./save-feedback.js";
import {
  requestApi,
  createLocalConnection,
  connectionFeedback,
} from "./local-connection.js";
import { createUpdateCenter } from "./updates.js";
import { paintAnalysis } from "./analysis-view.js";
import {
  initialAnalysisState,
  normaliseAnalysisState,
} from "./analysis-state.js";
import { videoEntryMarkup, videoDialogMarkup } from "./learning-content.js";
import {
  buildChapters,
  chapterForType,
  chapterForQuestion,
  filterQuestions,
} from "./chapters.js";
import { paintNavigation } from "./navigation.js";
import {
  scopeName,
  toggleMark,
  removeScopeMark,
  reconcileSelection,
  clearSearchFilters,
} from "./interactions.js";
import { examPapers, validateExamDate, startPaperRound } from "./papers.js";
import { paintPapers, countdownMarkup } from "./paper-view.js";
import {
  scheduleReview,
  isDue,
  reviewSettings,
  DEFAULT_INTERVALS,
} from "./review.js";
import {
  STORAGE_KEY,
  emptyStudy,
  loadStudy,
  validateStudy,
  shuffled,
} from "./study.js";

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const enc = encodeURIComponent;
const subjects = { signals: "信号与系统", digital: "数字电路" };
const app = $("#app");
let localMode = false,
  saveQueue = Promise.resolve(),
  saver = null,
  pendingSaves = 0;
let connection = null;
let page = "modules",
  chapters = [];
let focusMode = false;
let chapterMode = "training";
let analysisState = initialAnalysisState({ questions: [] });
let fromAnalysis = false;
let paperYear = "";
let catalog,
  study,
  admin = false,
  current,
  queue = [],
  answerData,
  adminDraft,
  busy = false;
let filters = {
  subject: "signals",
  source: "",
  year: "",
  type: "",
  chapter: "",
  status: "",
  list: "",
  search: "",
};
let visible = [],
  readerVersion = 0;
let returnPosition = 0,
  paperReturnPosition = 0,
  undoChange = null;
let practiceClock = null,
  clockKey = "",
  clockRun = null,
  clockSavedAt = 0;
let progressVisible = localStorage.getItem("842-progress-visible") !== "false";
document.documentElement.dataset.theme =
  localStorage.getItem("842-theme") ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function isPracticing() {
  return page === "reader" || page === "paper";
}
function activePaper() {
  return examPapers(catalog).find((p) => p.id === paperYear);
}
function practiceQuestions() {
  if (page === "paper") return activePaper()?.questions || [];
  const ids = queue.includes(current) ? queue : visible.map((q) => q.id);
  return ids
    .map((id) => catalog.questions.find((q) => q.id === id))
    .filter(Boolean);
}
function currentMarks() {
  return page === "paper"
    ? study.papers[paperYear].marks
    : Object.fromEntries(
        catalog.questions.map((q) => [q.id, questionRating(record(q.id))]),
      );
}
function flushClock(save = true) {
  if (!practiceClock) return;
  practiceClock.tick(performance.now(), !document.hidden && isPracticing());
  try {
    sessionStorage.setItem(
      "842-practice-clock",
      JSON.stringify({
        key: clockKey,
        elapsed: practiceClock.elapsed,
        paused: practiceClock.paused,
      }),
    );
  } catch {
    /* Timer still works without browser storage. */
  }
  if (
    save &&
    clockRun &&
    clockRun.finished === null &&
    clockRun.elapsedMs !== Math.round(practiceClock.elapsed)
  ) {
    clockRun.elapsedMs = Math.round(practiceClock.elapsed);
    persist();
  }
}
function syncClock() {
  const run = page === "paper" ? study.papers[paperYear] : null;
  const key = !isPracticing()
    ? ""
    : run
      ? `paper:${paperYear}:${run.started}`
      : `chapter:${JSON.stringify(filters)}`;
  if (key !== clockKey || (run && run !== clockRun)) {
    flushClock();
    clockKey = key;
    clockRun = run;
    practiceClock = null;
    if (key) {
      if (run && run.finished === null && run.elapsedMs === undefined)
        run.timingPartial = true;
      let cached;
      try {
        cached = JSON.parse(sessionStorage.getItem("842-practice-clock"));
      } catch {
        /* No timer checkpoint. */
      }
      const valid =
        cached?.key === key &&
        Number.isFinite(cached.elapsed) &&
        cached.elapsed >= 0;
      practiceClock = new PracticeClock(
        valid
          ? Math.max(cached.elapsed, run?.elapsedMs || 0)
          : run?.elapsedMs || 0,
        performance.now(),
        (run && run.finished !== null) || (valid && cached.paused),
      );
    }
  }
}
function renderPracticeTools() {
  syncClock();
  const questions = practiceQuestions(),
    index = questions.findIndex((q) => q.id === current);
  const title =
    page === "paper"
      ? `${paperYear} 年真题 · 第 ${(study.paperHistory?.[paperYear]?.length || 0) + 1} 轮`
      : scopeName(filters) ||
        chapters.find((c) => c.id === filters.chapter)?.title ||
        subjects[filters.subject];
  $("#reading-tools").hidden = false;
  $("#reading-tools").innerHTML =
    `<div class="practice-location">${button("reader-back", uiIcon("back") + "<span>返回</span>", "back-button")}<strong>${esc(title)}</strong></div><div class="practice-controls"><div class="picker-wrap">${button("question-picker", `选题 · ${index + 1}/${questions.length}`, "picker-trigger", 'aria-expanded="false" aria-controls="question-picker"')}<div id="question-picker" class="question-picker" hidden>${pickerMarkup(questions, current, study.records, currentMarks())}</div></div><div class="practice-timer">${uiIcon("clock")}<span id="practice-time" aria-label="本次练习用时">${durationText(practiceClock?.elapsed || 0)}</span>${button("timer-toggle", uiIcon(practiceClock?.paused ? "play" : "pause"), "timer-button", `title="${practiceClock?.paused ? "继续计时" : "暂停计时"}" aria-label="${practiceClock?.paused ? "继续计时" : "暂停计时"}" ${study.papers?.[paperYear]?.finished && page === "paper" ? "disabled" : ""}`)}${button("timer-reset", uiIcon("reset"), "timer-button", 'aria-label="重置计时" title="重置计时"')}</div>${page === "paper" ? `<details class="paper-more"><summary>本轮</summary><div>${button("paper-finish", "本轮总结")}${button("practice-history", "练习记录")}${button("paper-restart", "重新做一轮")}</div></details>` : ""}${button("theme-toggle", uiIcon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"), "theme-toggle reader-theme", `aria-label="${document.documentElement.dataset.theme === "dark" ? "切换日间模式" : "切换夜间模式"}"`)}</div>`;
  $(".workspace").querySelector(".page-arrow")?.remove();
  $(".workspace").querySelector(".page-arrow")?.remove();
  $(".workspace").insertAdjacentHTML(
    "beforeend",
    `${button("previous", uiIcon("left"), "page-arrow arrow-previous", `aria-label="上一题" ${index <= 0 ? "disabled" : ""}`)}${button("next", uiIcon("right"), "page-arrow arrow-next", `aria-label="${index === questions.length - 1 ? (page === "paper" ? "查看本轮总结" : "选择下一专题") : "下一题"}" title="${index === questions.length - 1 ? (page === "paper" ? "查看本轮总结" : "继续练习其他专题") : "下一题"}" ${index < 0 ? "disabled" : ""}`)}`,
  );
}
function showContinuation() {
  if (page === "paper") {
    flushClock();
    const run = study.papers[paperYear];
    dialog(
      "本轮总结",
      roundSummaryMarkup(activePaper(), run) +
        button(
          "paper-confirm-finish",
          run.finished ? "关闭总结" : "结束本轮",
          "primary",
        ),
    );
    return;
  }
  const choices = continuationTopics(catalog, chapters, filters, study);
  const first = choices[0];
  const topicButton = (choice, cls = "") =>
    button(
      "continue-topic",
      `<span><strong>${esc(choice.title)}</strong><small>${esc(choice.chapterTitle)} · ${choice.count}题</small></span>${uiIcon("right")}`,
      cls,
      `data-id="${esc(choice.id)}" data-chapter="${esc(choice.chapter)}"`,
    );
  dialog(
    "继续练习",
    `<p class="muted small">已到当前范围最后一题。选择专题后直接开始，收藏和自评记录保留。</p>${
      first
        ? `<div class="continue-recommended"><span class="muted small">下一专题</span>${topicButton(first, "primary")}</div><details class="continue-other"><summary>选择其他专题</summary><div class="continue-topic-list">${choices
            .slice(1)
            .map((c) => topicButton(c))
            .join("")}</div></details>`
          : "<p>当前筛选下没有其他专题，可返回目录调整筛选。</p>" + button("chapter-picker", "选择其他章节")
      }`,
    );
}
function closePicker(restoreFocus = false) {
  const panel = $("#question-picker");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const trigger = $('[data-action="question-picker"]');
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger?.focus();
}
function moveToQuestion(id) {
  if (!practiceQuestions().some((q) => q.id === id)) return;
  closePicker();
  if (page === "paper") {
    current = id;
    renderList();
    syncNavigation();
  } else openQuestion(id);
  window.scrollTo(0, 0);
  rememberNavigation();
}
function captureUndo(id, label, withRun = false) {
  const run = withRun && page === "paper" ? study.papers[paperYear] : null;
  undoChange = {
    id,
    label,
    year: paperYear,
    record: study.records[id] ? structuredClone(study.records[id]) : null,
    run,
    mark: run?.marks[id],
  };
}
function offerUndo() {
  undoChange.after = JSON.stringify(study.records[undoChange.id]);
  undoChange.afterMark = undoChange.run?.marks[undoChange.id];
  toast(undoChange.label);
  $("#notice").insertAdjacentHTML(
    "beforeend",
    button("undo-mark", "撤销", "undo-button"),
  );
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#notice")?.classList.remove("show"), 8000);
}
function showPracticeHistory(year = "") {
  const papers = examPapers(catalog).filter((p) => !year || p.id === year);
  const groups = papers
    .map((p) => {
      const history = study.paperHistory?.[p.id] || [];
      const rounds = [
        ...history,
        ...(study.papers?.[p.id] ? [study.papers[p.id]] : []),
      ];
      return rounds.length
        ? `<section class="history-year"><h3>${p.year} 年真题</h3>${rounds
            .map(
              (run, i) =>
                `<button type="button" class="history-row" data-action="history-round" data-year="${p.id}" data-index="${i}"><span><strong>第 ${i + 1} 轮</strong><small>${new Date(run.started).toLocaleString()} · ${run.finished ? "已结束" : i < history.length ? "未做完归档" : "进行中"}</small></span><span>${
                  completionProgress(
                    (run.questionIds || p.questions.map((q) => q.id)).map(
                      (id) => ({ id }),
                    ),
                    run.marks,
                  ).completed
                } 题已做 · ${durationText(run.elapsedMs)}　→</span></button>`,
            )
            .reverse()
            .join("")}</section>`
        : "";
    })
    .join("");
  dialog(
    "练习记录",
    groups ||
      '<p class="empty">还没有整卷练习记录。开始一套真题后，每一轮都会保存在这里。</p>',
    true,
  );
}
function showHistoryRound(year, index) {
  const paper = examPapers(catalog).find((p) => p.id === year);
  const history = study.paperHistory?.[year] || [];
  const run = index === history.length ? study.papers?.[year] : history[index];
  if (!paper || !run) return;
  const ids = run.questionIds || paper.questions.map((q) => q.id);
  dialog(
    `${year} 年 · 第 ${index + 1} 轮`,
    `<div class="history-toolbar">${button("practice-history", "← 全部记录")}<span>${new Date(run.started).toLocaleString()}${run.finished ? " — " + new Date(run.finished).toLocaleString() : ""}</span></div>${roundSummaryMarkup(paper, run)}<p class="muted small">以下为本轮自评；展开可回看原题，不改动记录。</p><div class="history-questions">${ids
      .map((id, i) => {
        const q = catalog.questions.find((q) => q.id === id);
        return `<details><summary><span>${i + 1} · ${esc(q?.number || id)}</span><span class="history-rating mark-${esc(run.marks[id] || "none")}">${ratingNames[run.marks[id]] || "未自评"}</span></summary>${q ? questionBodyMarkup(catalog, q) : "<p>当前题库中没有这道题，历史标记已保留。</p>"}</details>`;
      })
      .join("")}</div>`,
    true,
  );
  prepareQuestionImages($("#dialog-body"));
  prepareStructured($("#dialog-body"));
}
async function api(url, options = {}) {
  return requestApi(url, options, {
    local: localMode,
    onError: (error) => connection?.failed(error),
  });
}
function renderConnectionStatus() {
  const slot = $("#connection-status");
  if (!slot) return;
  const error = connection?.error;
  slot.hidden = !error;
  if (!error) return;
  const feedback = connectionFeedback(error) || {
    title: "暂时无法确认本地服务状态",
    detail: error.message,
  };
  slot.innerHTML = `<strong>${esc(feedback.title)}</strong><p>${esc(feedback.detail)}</p><p class="small">当前页面：${esc(location.origin)} · 已显示的更新数量是上次检查结果。</p><div>${button("check-connection", "重新检查连接")}${button("local-updates", "更新与恢复")}${button("export", "导出本页记录")}</div>`;
}
function toast(message) {
  $("#notice").textContent = message;
  $("#notice").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#notice").classList.remove("show"), 4500);
}
function renderSaveStatus() {
  const slot = $("#save-status");
  if (!slot || !saver) return;
  pendingSaves = saver.dirty ? 1 : 0;
  slot.hidden = false;
  slot.classList.toggle("save-warning", !!saver.error);
  const feedback = saveFeedback(saver);
  slot.innerHTML = saver.error
    ? `<span><strong>${esc(feedback.title)}</strong></span><p>${esc(feedback.detail)}</p><div>${feedback.retry ? button("retry-save", saver.retrying ? "正在核对保存状态…" : "重试保存", "", saver.retrying ? "disabled" : "") : ""}${button("export", "导出本页记录")}${button("reload-study", "放弃本页改动，读取磁盘记录", "text-button")}</div>`
    : `<span>${esc(feedback.title)}</span>`;
}
function persist() {
  if (localMode && saver) saveQueue = saver.queue(study);
  try {
    if (!localMode) localStorage.setItem(STORAGE_KEY, JSON.stringify(study));
  } catch {
    toast("浏览器无法保存记录，请先导出备份");
  }
}
async function requireSavedStudy() {
  await saveQueue;
  if (saver?.dirty)
    throw new Error("尚有未写入磁盘的记录，请先重试保存或导出本页记录");
}
function record(id) {
  return study.records[id] || { star: false, state: "" };
}
function selected() {
  return catalog.questions.find((q) => q.id === current);
}
const updateCenter = createUpdateCenter({
  api,
  dialog,
  esc,
  toast,
  requireSaved: requireSavedStudy,
  revision: () => saver.revision,
  verifyConnection: async () => {
    if (connection && !(await connection.check())) throw connection.error;
  },
});
function button(action, text, cls = "", attrs = "") {
  return `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${text}</button>`;
}
function layout() {
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="/">842<span>专业课做题网</span></a><div class="side-caption">科目</div><nav class="subjects">${Object.entries(
    subjects,
  )
    .map(([id, label]) =>
      button(
        "subject",
        label,
        id === filters.subject ? "active" : "",
        `data-value="${id}"`,
      ),
    )
    .join(
      "",
    )}</nav><div class="side-caption">我的学习</div><nav class="study-nav">${button("status", "全部题目", "", 'data-value=""')}${button("status", "☆ 我的收藏", "", 'data-value="star"')}${button("status", "待复习", "", 'data-value="review"')}${button("status", "已掌握", "", 'data-value="done"')}</nav><div class="side-caption row">题单 ${button("new-list", "＋", "icon", 'aria-label="新建题单"')}</div><div id="lists"></div><div class="sidebar-bottom">${button("export", "导出记录", "text-button")}${button("import", "导入记录", "text-button")}<input id="import-file" type="file" accept="application/json,.json" hidden>${button("admin", admin ? "管理中心" : "管理员", "text-button")}</div></aside><main><header class="topbar"><div><span class="eyebrow">面对浙大842考生的专业课做题网</span><h1 id="heading"></h1></div><div id="progress" class="progress"></div></header><section class="workspace"><div class="catalog-panel"><div class="filter-row"><input id="search" type="search" placeholder="搜索题目、题型或知识点" aria-label="搜索题目"><select id="source" aria-label="题源"><option value="">全部题源</option><option value="entrance">考研真题</option><option value="final">期末试题</option></select><select id="year" aria-label="年份"><option value="">全部年份</option>${[
    ...new Set(catalog.questions.map((q) => q.year)),
  ]
    .sort((a, b) => b - a)
    .map((y) => `<option>${y}</option>`)
    .join(
      "",
    )}</select></div><div class="filter-row">${button("back-chapter", "章节目录", "text-button")}<span id="count"></span></div><div class="practice-bar">${button("practice", "顺序练习", "primary")}${button("random", "随机练习")}${button("clear", "重置筛选", "text-button")}</div><div id="question-list" class="question-list"></div></div><article id="reader" class="reader"><div class="empty">选择一道题开始</div></article></section></main><dialog id="dialog"><div class="dialog-head"><h2 id="dialog-title"></h2>${button("close-dialog", "×", "icon", 'aria-label="关闭"')}</div><div id="dialog-body"></div></dialog><div id="notice" class="notice" role="status"></div>`;
  $(".topbar").insertAdjacentHTML(
    "beforebegin",
    '<nav id="breadcrumb" class="breadcrumb" aria-label="当前位置"></nav>',
  );
  $(".subjects").insertAdjacentHTML(
    "afterend",
    button("modules", "▦ 章节学习"),
  );
  $('[data-action="modules"]').insertAdjacentHTML(
    "afterend",
    button("papers", "▤ 历年真题卷"),
  );
  $('[data-action="papers"]').insertAdjacentHTML(
    "afterend",
    button("analysis", "▥ 历年考点分析"),
  );
  $(".topbar").insertAdjacentHTML(
    "afterbegin",
    '<div id="exam-countdown-slot"></div>',
  );
  $(".sidebar").insertAdjacentHTML(
    "beforeend",
    '<nav id="chapter-shortcuts" class="chapter-shortcuts" aria-label="本学科章节目录"></nav>',
  );
  $(".study-nav").previousElementSibling.before($("#chapter-shortcuts"));
  const workspace = $(".workspace");
  const toolbar = $(".catalog-panel>.filter-row");
  toolbar.className = "course-toolbar";
  toolbar.append($('[data-action="clear"]'));
  workspace.before(toolbar);
  toolbar.insertAdjacentHTML(
    "afterend",
    '<div id="learning-scope" class="learning-scope" hidden></div>',
  );
  workspace.insertAdjacentHTML(
    "beforebegin",
    '<div id="reading-tools" class="reading-tools" hidden></div>',
  );
  workspace.insertAdjacentHTML(
    "beforebegin",
    '<section id="chapter-browser" class="chapter-browser" aria-label="章节与题型"></section>',
  );
  $("#search").value = filters.search;
  $(".study-nav").insertAdjacentHTML(
    "beforeend",
    `${button("status", "到期复习", "", 'data-value="due"')}${button("status", "错题重做", "", 'data-value="wrong"')}${button("review-settings", "复习间隔", "text-button")}`,
  );
  if (localMode) {
    $('[data-action="admin"]').textContent = "资料与备份";
    $(".sidebar-bottom").insertAdjacentHTML(
      "afterbegin",
      button("local-updates", "更新中心", "text-button"),
    );
  }
  $("#source").value = filters.source;
  $("#year").value = filters.year;
  $("#search").addEventListener("input", (e) => {
    filters.search = e.target.value;
    refreshFilters();
  });
  for (const name of ["source", "year"])
    $("#" + name).addEventListener("change", (e) => {
      filters[name] = e.target.value;
      refreshFilters();
    });
  $("#import-file").addEventListener("change", importRecords);
  $("#dialog").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("#dialog").addEventListener("close", () => {
    if (adminDraft && current) renderReader(true);
  });
  $(".topbar").insertAdjacentHTML(
    "afterend",
    '<div id="connection-status" class="save-status save-warning" role="status" hidden></div><div id="save-status" class="save-status" role="status" hidden></div>',
  );
  app.insertAdjacentHTML(
    "afterbegin",
    `<header class="site-header"><a class="site-brand" href="/">842<span>专业课做题</span></a><nav id="global-nav" aria-label="主要功能"></nav><div class="global-tools">${button("theme-toggle", uiIcon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"), "theme-toggle", 'aria-label="' + (document.documentElement.dataset.theme === "dark" ? "切换日间模式" : "切换夜间模式") + '"')}</div></header>`,
  );
  for (const action of ["modules", "papers", "analysis"]) {
    const control = $('.sidebar [data-action="' + action + '"]');
    control.textContent = {
      modules: "章节学习",
      papers: "历年真题",
      analysis: "考点分析",
    }[action];
    $("#global-nav").append(control);
  }
  const favorites = $('.study-nav [data-value="star"]');
  favorites.textContent = "我的收藏";
  $("#global-nav").append(favorites);
  $("#global-nav").insertAdjacentHTML(
    "beforeend",
    button("practice-history", "练习记录"),
  );
  $(".study-nav").previousElementSibling.remove();
  $(".study-nav").remove();
  $(".global-tools").append($('[data-action="admin"]'));
  if (localMode) {
    const updates = $('[data-action="local-updates"]');
    updates.textContent = "更新";
    $(".global-tools").append(updates);
  }
  const lists = $("#lists"),
    caption = lists.previousElementSibling;
  lists.insertAdjacentHTML(
    "beforebegin",
    '<details class="saved-lists"><summary>我的题单</summary></details>',
  );
  $(".saved-lists").append(caption, lists);
  renderConnectionStatus();
  renderSaveStatus();
  renderLists();
  renderList();
}
function renderLists() {
  $("#lists").innerHTML =
    study.lists
      .map(
        (l, i) =>
          `<div class="list-row">${button("list", `${esc(l.name)} <small>${l.ids.length}</small>`, filters.list === l.name ? "active" : "", `data-index="${i}"`)}${button("delete-list", "×", "icon", `data-index="${i}" aria-label="删除题单${esc(l.name)}"`)}</div>`,
      )
      .join("") || '<span class="muted small">暂无题单</span>';
}
function refreshFilters() {
  queue = [];
  renderList();
  if (page !== "reader") {
    rememberNavigation();
    return;
  }
  if (visible.length) {
    if (!visible.some((q) => q.id === current))
      openQuestion(visible[0].id, true);
    else renderReader();
  } else {
    current = null;
    syncNavigation();
    renderEmptyReader();
  }
  rememberNavigation();
}
function renderEmptyReader() {
  readerVersion++;
  answerData = null;
  adminDraft = null;
  queue = [];
  $("#reader").innerHTML =
    `<div class="empty reader-empty"><h2>暂无${esc(scopeName(filters) || "符合条件的")}题目</h2><p>可以选择其他章节，或返回当前列表。</p><div>${button("chapter-picker", "切换章节", "primary")}${button("scope-back", "返回" + (scopeName(filters) || "全部题目"))}${button("scope-clear", "浏览全部题目", "text-button")}</div></div>`;
}
function reconcileLearningView(previousIds) {
  renderLists();
  renderList();
  if (page !== "reader") return;
  const next = reconcileSelection(
    previousIds,
    visible.map((q) => q.id),
    current,
    queue,
  );
  current = next.current;
  queue = next.queue;
  syncNavigation();
  renderList();
  if (current) renderReader();
  else renderEmptyReader();
}
function renderList() {
  app.classList.toggle("reader-mode", isPracticing());
  app.classList.toggle("catalog-mode", page === "catalog");
  app.classList.toggle("progress-hidden", !progressVisible);
  $('[data-action="progress-toggle"]')?.setAttribute(
    "aria-checked",
    String(progressVisible),
  );
  syncClock();
  if (!isPracticing()) readerVersion++;
  app.classList.toggle("analysis-mode", page === "analysis");
  $("#exam-countdown-slot").hidden = page === "analysis";
  document
    .querySelectorAll('[data-action="analysis"]')
    .forEach((b) => b.classList.toggle("active", page === "analysis"));
  if (page === "analysis") {
    paintAnalysis({
      catalog,
      state: analysisState,
      dialog,
      remember: rememberNavigation,
      change: (next) => {
        analysisState = normaliseAnalysisState(catalog, next);
        if (filters.subject !== next.subject) {
          filters.subject = next.subject;
          filters.chapter = "";
          filters.type = "";
          layout();
        } else renderList();
        rememberNavigation();
      },
      openQuestion: (id, ids) => {
        rememberNavigation();
        history.pushState({}, "", location.href);
        const q = catalog.questions.find((q) => q.id === id);
        filters = {
          subject: q.subject,
          source: "entrance",
          year: "",
          type: "",
          chapter: "",
          status: "",
          list: "",
          search: "",
          questionIds: ids,
        };
        fromAnalysis = true;
        page = "reader";
        openQuestion(id, true);
        rememberNavigation();
      },
    });
    app.classList.remove("focus-mode");
    $("#progress").textContent = "";
    document
      .querySelectorAll(
        '[data-action="papers"],[data-action="modules"],[data-action="status"]',
      )
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll('[data-action="analysis"]')
      .forEach((b) => b.classList.add("active"));
    return;
  }
  $(".course-toolbar").hidden = false;
  $("#source").value = filters.source;
  $("#year").value = filters.year;
  $("#search").value = filters.search;
  $("#exam-countdown-slot").innerHTML = countdownMarkup(study.examDate);
  $(".course-toolbar").hidden = page === "papers" || page === "paper";
  if (page === "papers") {
    app.classList.remove("focus-mode");
    paintPapers({ catalog, study });
    return;
  }
  if (page === "paper") {
    const paper = activePaper();
    if (!paper || !study.papers?.[paperYear]) {
      page = "papers";
      renderList();
      return;
    }
    if (!paper.questions.some((q) => q.id === current))
      current = paper.questions[0]?.id;
    $("#chapter-browser").hidden = true;
    $(".workspace").hidden = false;
    $("#learning-scope").hidden = true;
    renderPracticeTools();
    renderReader();
    return;
  }
  $('[data-action="papers"]').classList.remove("active");
  visible = filterQuestions(catalog, filters, study, chapters);
  $("#heading").textContent = filters.list || subjects[filters.subject];
  if (filters.status === "due") {
    visible.sort((a, b) => record(a.id).review.due - record(b.id).review.due);
    $("#heading").textContent = "到期复习";
  }
  if (filters.status === "wrong") $("#heading").textContent = "错题重做";
  $("#count").textContent = `${visible.length} 道题`;
  const stats = recordProgress(
    catalog.questions.filter((q) => q.subject === filters.subject),
    study.records,
  );
  $("#progress").textContent =
    `已做 ${stats.completed} / ${stats.total} · 掌握 ${stats.good}`;
  $(".question-list").innerHTML =
    visible
      .map(
        (q) =>
          `<button class="question-card ${current === q.id ? "selected" : ""}" data-action="question" data-id="${esc(q.id)}"><span class="row"><strong>${q.year} · ${esc(q.number)}</strong><span class="muted">${record(q.id).star ? "★" : ""} ${ratingNames[questionRating(record(q.id))] || ""}</span></span><span class="question-title">${esc(q.title)}</span><span class="tag">${q.sourceKind === "final" ? "期末试题" : "考研真题"}</span></button>`,
      )
      .join("") || '<div class="empty">没有符合条件的题目</div>';
  document
    .querySelectorAll('[data-action="status"]')
    .forEach((b) =>
      b.classList.toggle(
        "active",
        ["reader", "catalog", "chapter"].includes(page) &&
          b.dataset.value === filters.status &&
          !filters.list,
      ),
    );
  paintNavigation({
    chapters,
    catalog,
    filters,
    page,
    records: study.records,
    matching: filterQuestions(catalog, filters, study, chapters, false),
    current,
    lastQuestion: study.lastQuestion,
    focusMode,
    chapterMode,
    progressVisible,
  });
  app.classList.remove("focus-mode");
  $("#reading-tools").hidden = page !== "reader";
  if (page === "reader") {
    renderPracticeTools();
    return;
  }
}

function openQuestion(id, replace = false) {
  if (busy) {
    toast("照片正在保存，请稍候");
    return;
  }
  const q = catalog.questions.find((q) => q.id === id);
  if (!q) {
    toast("此题目链接不存在");
    return;
  }
  if (page === "catalog") returnPosition = window.scrollY;
  page = "reader";
  current = id;
  if (study.lastQuestion !== id) {
    study.lastQuestion = id;
    persist();
  }
  if (filters.subject !== q.subject) {
    filters.subject = q.subject;
    filters.chapter = chapterForQuestion(chapters, q)?.id || "";
    filters.type = "";
    layout();
  }
  const url = new URL(location.href);
  url.searchParams.set("q", id);
  url.searchParams.delete("paper");
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  renderList();
  renderReader();
}
async function renderReader(preserve = false) {
  const version = ++readerVersion,
    q = selected();
  if (!q || !isPracticing()) return;
  const expanded =
    preserve &&
    $("#reader").dataset.qid === q.id &&
    !$(".answer-section")?.hidden;
  answerData = null;
  adminDraft = null;
  const run = page === "paper" ? study.papers[paperYear] : null;
  $("#reader").dataset.qid = q.id;
  $("#reader").innerHTML = readerMarkup({
    catalog,
    q,
    record: record(q.id),
    rating: run ? run.marks[q.id] : questionRating(record(q.id)),
    finished: run?.finished !== null && !!run,
    admin,
    localMode,
    preserveAnswer: expanded,
    inList: page === "reader" && !!filters.list,
  });
  prepareQuestionImages($("#reader"));
  prepareStructured($("#reader"));
  try {
    const [personal, official] = await Promise.all([
      api("/answers/" + enc(q.id)),
      localMode
        ? api("/local/official/" + enc(q.id))
        : Promise.resolve({ photos: [] }),
    ]);
    if (version !== readerVersion || current !== q.id || !isPracticing())
      return;
    answerData = { ...personal, official: official.photos };
    $("#answer-content").innerHTML =
      `${official.photos.length ? "<h4>题库答案</h4>" + official.photos.map((src) => `<button type="button" class="image-button" data-action="zoom" data-src="${esc(src)}" aria-label="查看题库答案图片"><img src="${esc(src)}" alt="题库答案" loading="lazy"></button>`).join("") : ""}${personal.photos.length ? "<h4>我的答案</h4>" + photoHtml(personal.photos) : ""}${!official.photos.length && !personal.photos.length ? '<p class="muted">这道题暂无答案。</p>' : ""}`;
  } catch (error) {
    if (version === readerVersion)
      $("#answer-content").textContent = error.message;
  }
}
function dialog(title, content, wide = false) {
  const d = $("#dialog");
  d.classList.toggle("wide", wide);
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = content;
  if (!d.open) d.showModal();
}
function photoHtml(ids) {
  return ids
    .map(
      (id) =>
        `<button class="image-button" data-action="zoom" data-src="/api/media/${id}" aria-label="查看答案照片"><img src="/api/media/${id}" alt="手写参考答案" loading="lazy"></button>`,
    )
    .join("");
}
async function editAnswer() {
  const id = current;
  const draft = await api("/admin/answers/" + enc(id));
  if (current !== id || !isPracticing()) return;
  adminDraft = draft;
  renderEditor();
}
function renderEditor() {
  dialog(
    "编辑照片答案",
    `<p class="muted small">草稿自动保存；点击发布后所有人可见。每题最多12张，每张不超过12MB。</p><div class="upload-bar"><label class="button primary">拍照<input id="camera" type="file" accept="image/*" capture="environment" hidden></label><label class="button">从相册选择<input id="gallery" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label><span class="muted small">已发布 ${adminDraft.published.length} 张 · 草稿 ${adminDraft.draft.length} 张</span></div><div class="photo-grid">${adminDraft.draft.map((id, i) => `<section class="photo-card"><button class="image-button" data-action="preview-photo" data-id="${id}" aria-label="预览第${i + 1}张答案"><img src="/api/media/${id}" alt="第${i + 1}张草稿"></button><div class="photo-actions"><span>${i + 1}</span>${button("photo-up", "前移", "", `data-index="${i}" ${i === 0 ? "disabled" : ""}`)}${button("photo-down", "后移", "", `data-index="${i}" ${i === adminDraft.draft.length - 1 ? "disabled" : ""}`)}${button("photo-rotate", "旋转", "", `data-id="${id}"`)}<label class="button">替换<input class="replace-photo" data-index="${i}" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${button("photo-remove", "移除", "", `data-index="${i}"`)}</div></section>`).join("") || '<div class="empty">拍下手写答案，或从相册中选择</div>'}</div><div class="editor-bottom">${button("publish", "发布答案", "primary", adminDraft.draft.length ? "" : "disabled")}${button("withdraw", "撤下公开答案", "", adminDraft.published.length ? "" : "disabled")}${button("close-editor", "完成")}</div>`,
    true,
  );
  $("#camera").onchange = (e) => upload(e.target.files);
  if (localMode) {
    $("#dialog-title").textContent = "编辑我的答案";
    $("#dialog-body>p").textContent =
      "只保存在你的电脑；标记为定稿后仍不会自动公开。每题最多12张，每张不超过12MB。";
    $('[data-action="publish"]').textContent = "标记为定稿";
    $('[data-action="withdraw"]').textContent = "取消定稿";
    $(".upload-bar .muted").textContent =
      `已定稿 ${adminDraft.published.length} 张 · 草稿 ${adminDraft.draft.length} 张`;
  }
  $("#gallery").onchange = (e) => upload(e.target.files);
  document
    .querySelectorAll(".replace-photo")
    .forEach(
      (el) =>
        (el.onchange = (e) => upload(e.target.files, Number(el.dataset.index))),
    );
}
async function upload(files, replaceIndex) {
  if (!files.length || busy) return;
  const n = files.length,
    capacity = 12 - adminDraft.draft.length + (replaceIndex != null ? 1 : 0);
  if (n > capacity) {
    toast("草稿最多12张");
    return;
  }
  await locked(async () => {
    const q = current;
    for (const [i, file] of [...files].entries()) {
      if (file.size > 12 * 1024 * 1024) throw new Error("单张图片不能超过12MB");
      toast(`正在保存第 ${i + 1} / ${n} 张照片…`);
      const form = new FormData();
      form.append("photo", file);
      const suffix =
        replaceIndex != null
          ? "?replace=" + adminDraft.draft[replaceIndex]
          : "";
      adminDraft = await api("/admin/answers/" + enc(q) + "/photos" + suffix, {
        method: "POST",
        body: form,
      });
    }
    toast("已保存草稿");
  });
  renderEditor();
}
async function locked(fn) {
  if (busy) return;
  busy = true;
  $("#dialog").classList.add("busy");
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    $("#dialog").classList.remove("busy");
  }
}
async function saveDraft(ids) {
  adminDraft = await api("/admin/answers/" + enc(current) + "/draft", {
    method: "PUT",
    body: JSON.stringify({ photos: ids }),
  });
  renderEditor();
}
async function management(page = 0) {
  const result = await api("/admin/corrections?page=" + page);
  dialog(
    "管理中心",
    `<div class="row"><span>${result.total} 条纠错</span>${button("logout", "退出登录", "text-button")}</div><div class="corrections">${result.items.map((row) => `<section class="correction"><div class="row"><a href="?q=${enc(row.qid)}" data-action="correction-question" data-id="${esc(row.qid)}">${esc(row.qid)}</a><span class="muted small">${esc(new Date(row.created).toLocaleDateString())}</span></div><p>${esc(row.message)}</p>${button("resolve", row.resolved ? "已处理 · 重新打开" : "标记已处理", row.resolved ? "" : "primary", `data-id="${row.id}" data-resolved="${row.resolved}"`)}</section>`).join("") || '<div class="empty">暂无纠错</div>'}</div><div class="row">${button("correction-page", "上一页", "", `data-page="${page - 1}" ${page === 0 ? "disabled" : ""}`)}${button("correction-page", "下一页", "", `data-page="${page + 1}" ${(page + 1) * 50 >= result.total ? "disabled" : ""}`)}</div>`,
  );
}
async function importRecords(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("备份文件过大");
    const imported = validateStudy(
      JSON.parse(await file.text()),
      new Set(catalog.questions.map((q) => q.id)),
    );
    dialog(
      "导入学习记录",
      `<p>将替换当前${localMode ? "本地" : "浏览器"}记录：${Object.keys(imported.records).length} 道题的标记、${imported.lists.length} 个题单。</p>${button("confirm-import", "确认替换", "primary")}`,
    );
    $('[data-action="confirm-import"]').onclick = () => {
      const previousIds = visible.map((q) => q.id);
      flushClock();
      practiceClock = null;
      clockRun = null;
      clockKey = "";
      try {
        sessionStorage.removeItem("842-practice-clock");
      } catch {
        /* No persistent checkpoint available. */
      }
      undoChange = null;
      study = imported;
      if (page === "paper" && !study.papers?.[paperYear]) {
        page = "papers";
        paperYear = "";
      }
      persist();
      $("#dialog").close();
      reconcileLearningView(previousIds);
      syncNavigation();
      rememberNavigation();
      toast("记录已导入");
    };
  } catch (error) {
    toast(error.message);
  }
  e.target.value = "";
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled) return;
  const action = b.dataset.action;
  if (busy) {
    e.preventDefault();
    return;
  }
  try {
    if (!b.isConnected) return;
    b.closest(".paper-more")?.removeAttribute("open");
    b.closest(".question-more")?.removeAttribute("open");
    if (action === "theme-toggle") {
      const next =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("842-theme", next);
      document
        .querySelectorAll('[data-action="theme-toggle"]')
        .forEach((control) => {
          control.innerHTML = uiIcon(next === "dark" ? "sun" : "moon");
          control.setAttribute(
            "aria-label",
            next === "dark" ? "切换日间模式" : "切换夜间模式",
          );
        });
      b.setAttribute(
        "aria-label",
        next === "dark" ? "切换日间模式" : "切换夜间模式",
      );
      return;
    }
    if (action === "progress-toggle") {
      e.preventDefault();
      progressVisible = !progressVisible;
      localStorage.setItem("842-progress-visible", String(progressVisible));
      renderList();
      if (e.detail === 0)
        $('[data-action="progress-toggle"]')?.focus({ preventScroll: true });
      return;
    }
    if (action === "reader-back") {
      flushClock();
      if (fromAnalysis && page === "reader") {
        page = "analysis";
        current = null;
        queue = [];
        delete filters.questionIds;
        fromAnalysis = false;
        syncNavigation();
        renderList();
        window.scrollTo(0, analysisState.scrollY || 0);
        return;
      }
      const wasPaper = page === "paper";
      page = wasPaper ? "papers" : "catalog";
      if (wasPaper) current = null;
      syncNavigation();
      layout();
      window.scrollTo(0, wasPaper ? paperReturnPosition : returnPosition);
      return;
    }
    if (action === "question-picker") {
      const panel = $("#question-picker");
      panel.hidden = !panel.hidden;
      b.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) panel.querySelector('[aria-current="true"]')?.focus();
      return;
    }
    if (action === "select-question") {
      moveToQuestion(b.dataset.id);
      return;
    }
    if (action === "practice-history") {
      flushClock();
      showPracticeHistory(b.dataset.year || "");
      return;
    }
    if (action === "history-round") {
      showHistoryRound(b.dataset.year, Number(b.dataset.index));
      return;
    }
    if (action === "toggle-answers") {
      const section = $(".answer-section");
      section.hidden = !section.hidden;
      b.innerHTML =
        uiIcon("checkCircle") +
        `<span>${section.hidden ? "查看答案" : "收起答案"}</span>`;
      b.setAttribute("aria-expanded", String(!section.hidden));
      return;
    }
    if (action === "timer-toggle") {
      if (
        !practiceClock ||
        (page === "paper" && study.papers[paperYear].finished !== null)
      )
        return;
      practiceClock.paused
        ? practiceClock.resume(performance.now())
        : practiceClock.pause(performance.now());
      flushClock();
      renderPracticeTools();
      return;
    }
    if (action === "timer-reset") {
      if (page === "paper" && study.papers[paperYear].finished !== null)
        return toast("已结束轮次的用时不能修改");
      practiceClock?.reset(performance.now());
      flushClock();
      renderPracticeTools();
      return;
    }
    if (action === "undo-mark") {
      const u = undoChange;
      if (
        !u ||
        JSON.stringify(study.records[u.id]) !== u.after ||
        (u.run &&
          (study.papers?.[u.year] !== u.run ||
            u.run.finished !== null ||
            u.run.marks[u.id] !== u.afterMark))
      )
        return toast("记录已发生变化，无法撤销这次操作");
      if (u.record) study.records[u.id] = u.record;
      else delete study.records[u.id];
      if (u.run) {
        if (u.mark) u.run.marks[u.id] = u.mark;
        else delete u.run.marks[u.id];
      }
      undoChange = null;
      persist();
      if (isPracticing()) {
        renderPracticeTools();
        renderReader(true);
      } else renderList();
      toast("已撤销，恢复原记录");
      return;
    }
    if (action.startsWith("grade-")) {
      if (!current || !isPracticing()) return;
      const rating = action.slice(6),
        run = page === "paper" ? study.papers[paperYear] : null;
      if (run?.finished !== null && run)
        return toast("本轮已结束，请开始新一轮");
      if (!["good", "hard", "wrong"].includes(rating)) return;
      if (
        (run ? run.marks[current] : questionRating(record(current))) === rating
      )
        return;
      captureUndo(current, "已标记：" + ratingNames[rating], true);
      const r = { ...record(current) };
      r.review = scheduleReview(r.review, rating, study.settings);
      r.state = rating === "good" ? "done" : "review";
      study.records[current] = r;
      study.version = 2;
      study.settings = reviewSettings(study.settings);
      if (run) run.marks[current] = rating;
      persist();
      renderPracticeTools();
      renderReader(true);
      offerUndo();
      return;
    }
    if (action === "star") {
      if (!current) return;
      if (page === "reader" && !queue.includes(current))
        queue = visible.map((q) => q.id);
      captureUndo(current, record(current).star ? "已取消收藏" : "已收藏");
      study.records[current] = toggleMark(record(current), "star");
      persist();
      renderPracticeTools();
      renderReader(true);
      offerUndo();
      return;
    }
    if (action === "open-videos") {
      dialog("本题视频", videoDialogMarkup(catalog, b.dataset.id));
      return;
    }
    if (
      [
        "modules",
        "chapter",
        "type",
        "subject",
        "status",
        "list",
        "browse-all",
        "papers",
        "resume",
        "chapter-choice",
        "scope-back",
        "scope-clear",
        "clear",
      ].includes(action)
    ) {
      delete filters.questionIds;
      fromAnalysis = false;
    }
    if (action === "analysis" || action === "analysis-return") {
      if (action === "analysis") analysisState.subject = filters.subject;
      page = "analysis";
      current = null;
      queue = [];
      delete filters.questionIds;
      fromAnalysis = false;
      syncNavigation();
      renderList();
      rememberNavigation();
      window.scrollTo(
        0,
        action === "analysis-return" ? analysisState.scrollY || 0 : 0,
      );
      return;
    }
    if (action === "chapter-mode") {
      chapterMode = b.dataset.mode;
      renderList();
      rememberNavigation();
      return;
    }
    if (action === "knowledge") {
      const topic = catalog.curriculum?.topics.find(
        (t) => t.id === b.dataset.id,
      );
      if (!topic) return;
      fromAnalysis = false;
      delete filters.questionIds;
      filters.chapter = topic.chapter;
      filters.type = "knowledge:" + topic.id;
      filters.subject = catalog.curriculum.chapters.find(
        (c) => c.id === topic.chapter,
      ).subject;
      current = null;
      queue = [];
      page = "catalog";
      returnPosition = 0;
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      rememberNavigation();
      return;
    }
    if (action === "check-connection") {
      if (await connection.check())
        toast(
          saver?.dirty
            ? "连接已恢复，请点击重试保存；未自动覆盖记录"
            : "本地连接已恢复，可以重新打开更新中心",
        );
      return;
    }
    if (action === "retry-save") {
      saveQueue = saver.retry();
      await saveQueue;
      return;
    }
    if (action === "reload-study") {
      dialog(
        "读取磁盘记录",
        `<p>将放弃本页未保存的改动，读取磁盘中的最新记录。请先导出本页记录以免丢失。</p>${button("export", "先导出本页记录", "primary")}${button("confirm-reload-study", "放弃本页改动并读取")}`,
      );
      return;
    }
    if (action === "confirm-reload-study") {
      await saveQueue;
      const saved = await api("/local/study");
      const nextStudy = validateStudy(
        saved.study || emptyStudy(),
        new Set(catalog.questions.map((q) => q.id)),
      );
      const previousIds = visible.map((q) => q.id);
      saver.reset(saved.revision);
      practiceClock = null;
      clockRun = null;
      clockKey = "";
      try {
        sessionStorage.removeItem("842-practice-clock");
      } catch {
        /* No persistent checkpoint available. */
      }
      undoChange = null;
      study = nextStudy;
      if (page === "paper" && !study.papers?.[paperYear]) {
        page = "papers";
        paperYear = "";
      }
      $("#dialog").close();
      reconcileLearningView(previousIds);
      syncNavigation();
      toast("已读取磁盘记录");
      return;
    }
    if (action === "remove-view") {
      if (!current) return;
      const ids = visible.map((q) => q.id),
        name = scopeName(filters);
      removeScopeMark(study, current, filters);
      persist();
      reconcileLearningView(ids);
      toast(
        filters.status === "due"
          ? "已暂停这题的到期提醒，历史记录保留"
          : "已移出" + name + "，其他标记和答案保留",
      );
      return;
    }
    if (action === "resume-review") {
      const r = record(current);
      if (r.review) {
        r.review.suspended = false;
        r.review.due = Date.now();
        study.records[current] = r;
        persist();
        renderReader();
        toast("已恢复，加入到期复习");
      }
      return;
    }
    if (action === "scope-back") {
      if ($("#dialog").open) $("#dialog").close();
      filters.chapter = "";
      filters.type = "";
      current = null;
      queue = [];
      page = "catalog";
      syncNavigation();
      renderLists();
      renderList();
      return;
    }
    if (action === "scope-clear") {
      if ($("#dialog").open) $("#dialog").close();
      filters.status = "";
      filters.list = "";
      filters = clearSearchFilters(filters);
      current = null;
      queue = [];
      if (page === "reader") page = "catalog";
      syncNavigation();
      renderList();
      return;
    }
    if (action === "exam-date") {
      dialog(
        "考研倒计时",
        `<form id="exam-date-form"><label>你的目标考试日期<input type="date" name="date" required min="2020-01-01" max="2099-12-31" value="${esc(study.examDate || "")}"></label><p class="muted small">按本地日历计算剩余天数，30天内突出提醒。请以报考当年的官方通知为准。</p><button class="primary">保存日期</button>${button("exam-date-clear", "暂不显示天数")}</form>`,
      );
      $("#exam-date-form").onsubmit = (e) => {
        e.preventDefault();
        try {
          study.examDate = validateExamDate(new FormData(e.target).get("date"));
          persist();
          $("#dialog").close();
          renderList();
        } catch (error) {
          toast(error.message);
        }
      };
      return;
    }
    if (action === "exam-date-clear") {
      study.examDate = "";
      persist();
      $("#dialog").close();
      renderList();
      return;
    }
    if (action === "papers") {
      flushClock();
      page = "papers";
      current = null;
      queue = [];
      paperYear = "";
      syncNavigation();
      layout();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "open-paper") {
      flushClock();
      paperReturnPosition = window.scrollY;
      paperYear = b.dataset.year;
      const paper = activePaper();
      if (!paper) return;
      page = "paper";
      current = paper.questions[0]?.id;
      queue = [];
      study.papers ||= {};
      if (!study.papers[paperYear]) {
        startPaperRound(study, paper);
        persist();
      }
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "paper-finish") {
      flushClock();
      const run = study.papers[paperYear],
        paper = activePaper();
      dialog(
        "本轮总结",
        roundSummaryMarkup(paper, run) +
          button(
            "paper-confirm-finish",
            run.finished ? "关闭总结" : "结束本轮",
            "primary",
          ),
      );
      return;
    }
    if (action === "paper-confirm-finish") {
      flushClock();
      study.papers[paperYear].finished ||= Date.now();
      practiceClock?.pause(performance.now());
      persist();
      $("#dialog").close();
      renderList();
      return;
    }
    if (action === "paper-restart") {
      dialog(
        "重新做一轮",
        "<p>当前轮次会保留在“练习记录”中，然后开始新一轮。个人答案和收藏不变。</p>" +
          button("paper-confirm-restart", "保存本轮并开始新一轮", "primary"),
      );
      return;
    }
    if (action === "paper-confirm-restart") {
      flushClock();
      startPaperRound(study, activePaper());
      undoChange = null;
      current = activePaper().questions[0]?.id;
      persist();
      $("#dialog").close();
      renderList();
      syncNavigation();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "focus") {
      focusMode = !focusMode;
      renderList();
      return;
    }
    if (action === "resume") {
      const q = catalog.questions.find((q) => q.id === study.lastQuestion);
      if (!q) return;
      filters = {
        subject: q.subject,
        chapter: chapterForQuestion(chapters, q)?.id || "",
        type: q.typeId,
        source: "",
        year: "",
        status: "",
        list: "",
        search: "",
      };
      queue = [];
      page = "reader";
      layout();
      openQuestion(q.id);
      return;
    }
    if (action === "chapter-picker") {
      const matching = filterQuestions(
        catalog,
        filters,
        study,
        chapters,
        false,
      );
      dialog(
        "切换章节",
        `<p class="scope-picker-note">当前范围：${esc(scopeName(filters) || "全部题目")} · ${subjects[filters.subject]}</p><div class="chapter-picker-grid">${chapters
          .filter((c) => c.subject === filters.subject)
          .map((c) =>
            button(
              "picker-chapter",
              `<small>${esc(c.number)}</small><span>${esc(c.title)}</span><em>${matching.filter((q) => c.questionIds.has(q.id)).length} 题</em>`,
              c.id === filters.chapter ? "active" : "",
              `data-id="${c.id}"`,
            ),
          )
          .join("")}</div>`,
      );
      return;
    }
    if (action === "picker-chapter") {
      $("#dialog").close();
      filters.chapter = b.dataset.id;
      filters.type = "";
      page = "chapter";
      current = null;
      queue = [];
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "review-settings") {
      dialog(
        "复习间隔",
        `<form id="review-form"><label>答对后的间隔（天，用逗号分隔）<input name="intervals" value="${(study.settings?.intervals || DEFAULT_INTERVALS).join(",")}"></label><p class="muted small">做错后10分钟重练；吃力时缩短间隔。间隔是复习建议，不是记忆力测量。更改只影响以后作答，已有到期时间不变。</p><button class="primary">保存</button></form>`,
      );
      $("#review-form").onsubmit = (e) => {
        e.preventDefault();
        try {
          study.settings = reviewSettings({
            intervals: new FormData(e.target)
              .get("intervals")
              .split(/[,，]/)
              .map(Number),
          });
          study.version = 2;
          persist();
          $("#dialog").close();
        } catch (err) {
          toast(err.message);
        }
      };
      return;
    }
    if (action.startsWith("local-")) {
      await localAction(action);
      return;
    }
    if (action === "classification-source") {
      dialog(
        "分类依据",
        `<p>以所提供的2024年842统考大纲为主，结合于慧敏《信号与系统学习指导》和阎石《数字电子技术基础》第六版细化。不是最新年度官方考纲。</p><p>知识点表示“考什么”，训练题型表示“怎么考”。综合题标多个知识点，主章节只归属一次，题号和个人记录不变。</p><p>同题可进入多个知识点统计，各行题量和涉及分值不可相加。未标分值不按0处理，不用历史频次预测未来命题。</p><p class="muted small">${esc(catalog.curriculum?.mappingNote || "旧题库请先更新以获得新分类。")}</p><p>${esc(catalog.curriculum?.scoreNote || "")}</p>`,
      );
      return;
    }
    if (action === "modules") {
      goModules();
      return;
    }
    if (action === "chapter") {
      filters.chapter = b.dataset.id;
      filters.type = "";
      page = "chapter";
      current = null;
      queue = [];
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "type") {
      filters.type = b.dataset.id;
      if (
        !chapters
          .find((c) => c.id === filters.chapter)
          ?.types.some((t) => t.id === filters.type)
      )
        filters.chapter = chapterForType(chapters, filters.type)?.id || "";
      page = "catalog";
      current = null;
      queue = [];
      returnPosition = 0;
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "back-chapter") {
      page = filters.chapter ? "chapter" : "modules";
      filters.type = "";
      current = null;
      queue = [];
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "browse-all") {
      filters.chapter = "";
      filters.type = "";
      page = "catalog";
      current = null;
      queue = [];
      returnPosition = 0;
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "chapter-practice" || action === "chapter-random") {
      page = "reader";
      filters.type = "";
      renderList();
      queue = visible.map((q) => q.id);
      if (action === "chapter-random") queue = shuffled(queue);
      if (queue.length) openQuestion(queue[0]);
      return;
    }
    if (action === "subject") {
      if (page === "analysis") {
        analysisState = normaliseAnalysisState(catalog, {
          ...analysisState,
          subject: b.dataset.value,
          chapter: "",
          search: "",
          selected: "",
          year: "",
          scrollLeft: 0,
          scrollTop: 0,
        });
        filters.subject = b.dataset.value;
        filters.chapter = "";
        filters.type = "";
        layout();
        rememberNavigation();
        return;
      }
      filters.subject = b.dataset.value;
      filters.chapter = "";
      filters.type = "";
      current = null;
      queue = [];
      page = scopeName(filters) ? "catalog" : "modules";
      syncNavigation();
      layout();
      if (page === "reader") reconcileLearningView([]);
      return;
    }
    if (action === "status" || action === "list") {
      filters.status = action === "status" ? b.dataset.value : "";
      filters.list =
        action === "list" ? study.lists[Number(b.dataset.index)].name : "";
      filters.chapter = "";
      filters.type = "";
      page = "catalog";
      current = null;
      queue = [];
      returnPosition = 0;
      syncNavigation();
      renderLists();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "question") {
      queue = [];
      openQuestion(b.dataset.id);
    }
    if (action === "clear") {
      filters = clearSearchFilters(filters);
      queue = [];
      layout();
      if (page === "reader" || page === "catalog") refreshFilters();
    }
    if (action === "practice" || action === "random") {
      queue = visible.map((q) => q.id);
      if (action === "random") queue = shuffled(queue);
      if (queue.length) openQuestion(queue[0]);
      else toast("当前筛选下没有题目");
    }
    if (action === "previous" || action === "next") {
      const qs = practiceQuestions(),
        index = qs.findIndex((q) => q.id === current);
      const next = qs[index + (action === "next" ? 1 : -1)];
      if (next) moveToQuestion(next.id);
      else if (action === "next" && index === qs.length - 1) showContinuation();
      return;
    }
    if (action === "continue-topic") {
      const choice = continuationTopics(catalog, chapters, filters, study).find(
        (c) => c.id === b.dataset.id && c.chapter === b.dataset.chapter,
      );
      if (!choice) return;
      flushClock();
      $("#dialog").close();
      fromAnalysis = false;
      delete filters.questionIds;
      filters.chapter = choice.chapter;
      filters.type = choice.id;
      page = "reader";
      current = null;
      queue = [];
      returnPosition = 0;
      syncNavigation();
      renderList();
      queue = choice.questionIds;
      openQuestion(choice.questionIds[0]);
      window.scrollTo(0, 0);
      rememberNavigation();
      return;
    }
    if (["star", "review", "done"].includes(action)) {
      if (!current) return;
      const previousIds = visible.map((q) => q.id);
      study.records[current] = toggleMark(record(current), action);
      persist();
      reconcileLearningView(previousIds);
    }
    if (action === "share") {
      const shareText = localMode ? current : location.href;
      try {
        await navigator.clipboard.writeText(shareText);
        toast(localMode ? "题号已复制，可粘贴到搜索框" : "题目链接已复制");
      } catch {
        dialog(
          "分享题目",
          `<input readonly value="${esc(shareText)}" aria-label="题目链接">`,
        );
      }
    }
    if (action === "zoom") {
      const crop = b.querySelector("img")?.dataset.contentCrop;
      dialog(
        "查看完整图片",
        `${crop ? '<div class="image-view-tools">' + button("original-image", "查看原图", "text-button", `data-src="${esc(b.dataset.src)}"`) + "</div>" : ""}<div class="image-fit"><img src="${esc(b.dataset.src)}" alt="完整图片"></div>`,
        true,
      );
      if (crop) cropImageView($(".image-fit img"), JSON.parse(crop), true);
    }
    if (action === "original-image") {
      dialog(
        "原始题图",
        `<div class="image-fit"><img src="${esc(b.dataset.src)}" alt="未经裁剪的原始题图"></div>`,
        true,
      );
    }
    if (action === "close-dialog") $("#dialog").close();
    if (action === "new-list") {
      dialog(
        "新建题单",
        '<form id="list-form"><label>题单名称<input name="name" maxlength="40" required autofocus></label><button class="primary">创建题单</button></form>',
      );
      $("#list-form").onsubmit = (event) => {
        event.preventDefault();
        const name = new FormData(event.target).get("name").trim();
        if (
          !name ||
          study.lists.some((l) => l.name === name) ||
          study.lists.length >= 100
        )
          return toast("名称不能为空或重复，最多100个题单");
        study.lists.push({ name, ids: [] });
        persist();
        renderLists();
        $("#dialog").close();
      };
    }
    if (action === "delete-list") {
      const i = Number(b.dataset.index);
      dialog(
        "删除题单",
        `<p>删除「${esc(study.lists[i].name)}」？题目和学习标记不会删除。</p>${button("confirm-delete-list", "删除题单")}`,
      );
      $('[data-action="confirm-delete-list"]').onclick = () => {
        const previousIds = visible.map((q) => q.id);
        if (filters.list === study.lists[i].name) {
          filters.list = "";
          queue = [];
        }
        study.lists.splice(i, 1);
        persist();
        reconcileLearningView(previousIds);
        rememberNavigation();
        $("#dialog").close();
      };
    }
    if (action === "add-list")
      dialog(
        "加入题单",
        study.lists
          .map((l, i) =>
            button(
              "toggle-list-item",
              `${l.ids.includes(current) ? "✓ 已加入 · 点击移出 " : "＋ 加入 "}${esc(l.name)}`,
              "list-choice",
              `data-index="${i}" data-qid="${esc(current)}"`,
            ),
          )
          .join("") ||
          `<p>还没有题单。</p>${button("new-list", "创建题单", "primary")}`,
      );
    if (action === "toggle-list-item") {
      const previousIds = visible.map((q) => q.id),
        id = b.dataset.qid;
      const l = study.lists[Number(b.dataset.index)];
      l.ids = l.ids.includes(id)
        ? l.ids.filter((item) => item !== id)
        : [...l.ids, id];
      persist();
      renderLists();
      if (page === "reader" && filters.list === l.name)
        reconcileLearningView(previousIds);
      b.textContent = `${l.ids.includes(id) ? "✓ 已加入 · 点击移出 " : "＋ 加入 "}${l.name}`;
    }
    if (action === "export") {
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(study, null, 2)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `842学习记录-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (action === "import") $("#import-file").click();
    if (action === "correction") {
      if (localMode) {
        const text = `题号：${current}\n题库版本：${catalog.edition || "初始题库"}\n问题描述：`;
        dialog(
          "题目纠错",
          `<p>复制下方信息，在 GitHub Q&A 描述问题。</p><textarea readonly rows="4">${esc(text)}</textarea><p><a target="_blank" rel="noopener" href="https://github.com/burriedalien666/zju842-practice/discussions/categories/q-a">打开 GitHub Q&A</a></p>`,
        );
        return;
      }
      const q = current;
      dialog(
        "题目纠错",
        `<form id="correction-form"><p class="muted">${esc(selected().sourceTitle)} · ${esc(selected().number)}</p><label>问题描述<textarea name="message" minlength="5" maxlength="2000" required rows="6" placeholder="例如：题图不完整，缺少第（2）问"></textarea></label><button class="primary">提交纠错</button></form>`,
      );
      $("#correction-form").onsubmit = async (event) => {
        event.preventDefault();
        await locked(async () => {
          await api("/corrections", {
            method: "POST",
            body: JSON.stringify({
              questionId: q,
              message: new FormData(event.target).get("message"),
            }),
          });
          $("#dialog").close();
          toast("纠错已提交");
        });
      };
    }
    if (action === "admin") {
      if (localMode) {
        await localCenter();
        return;
      }
      if (admin) await management();
      else {
        dialog(
          "管理员登录",
          '<form id="login-form"><label>密码<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button class="primary">登录</button></form>',
        );
        $("#login-form").onsubmit = async (event) => {
          event.preventDefault();
          const password = new FormData(event.target).get("password");
          await locked(async () => {
            await api("/login", {
              method: "POST",
              body: JSON.stringify({ password }),
            });
            admin = true;
            $("#dialog").close();
            layout();
            if (current) renderReader();
            toast("已登录，可在题目下编辑照片答案");
          });
        };
      }
    }
    if (action === "logout") {
      await api("/logout", { method: "POST" });
      admin = false;
      $("#dialog").close();
      layout();
      if (current) renderReader();
    }
    if (action === "edit-answer") await editAnswer();
    if (action === "preview-photo") {
      dialog(
        "答案预览",
        `<img class="zoom-image" src="/api/media/${b.dataset.id}" alt="答案预览">${button("back-editor", "返回编辑", "primary")}`,
        true,
      );
    }
    if (action === "back-editor") renderEditor();
    if (action === "photo-up" || action === "photo-down") {
      const ids = [...adminDraft.draft],
        i = Number(b.dataset.index),
        j = i + (action === "photo-up" ? -1 : 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await locked(() => saveDraft(ids));
    }
    if (action === "photo-remove")
      await locked(() =>
        saveDraft(
          adminDraft.draft.filter((_, i) => i !== Number(b.dataset.index)),
        ),
      );
    if (action === "photo-rotate")
      await locked(async () => {
        adminDraft = await api(
          "/admin/answers/" + enc(current) + "/rotate/" + b.dataset.id,
          { method: "POST" },
        );
        renderEditor();
      });
    if (action === "publish" || action === "withdraw")
      await locked(async () => {
        adminDraft = await api(
          "/admin/answers/" + enc(current) + "/" + action,
          { method: "POST" },
        );
        renderEditor();
        toast(
          localMode
            ? action === "publish"
              ? "已定稿，仅本地保存"
              : "已取消定稿，草稿保留"
            : action === "publish"
              ? "答案已发布"
              : "公开答案已撤下，草稿保留",
        );
      });
    if (action === "close-editor") {
      $("#dialog").close();
      renderReader(true);
    }
    if (action === "resolve") {
      await api("/admin/corrections/" + b.dataset.id, {
        method: "PATCH",
        body: JSON.stringify({ resolved: b.dataset.resolved === "0" }),
      });
      await management();
    }
    if (action === "correction-page") await management(Number(b.dataset.page));
    if (action === "correction-question") {
      e.preventDefault();
      $("#dialog").close();
      queue = [];
      openQuestion(b.dataset.id);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    rememberNavigation();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".picker-wrap")) closePicker();
  if (!event.target.closest(".paper-more"))
    $(".paper-more")?.removeAttribute("open");
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "jump-form") return;
  event.preventDefault();
  const index = Number(new FormData(event.target).get("index"));
  const questions = practiceQuestions();
  if (!Number.isInteger(index) || index < 1 || index > questions.length) return;
  moveToQuestion(questions[index - 1].id);
});
document.addEventListener("visibilitychange", () => {
  if (!practiceClock) return;
  // Account for foreground time up to the moment the tab becomes hidden.
  practiceClock.tick(performance.now(), document.hidden);
  flushClock(false);
});
// A write during unload can finish after the new page reads the revision.
// Keep the final timer checkpoint in this tab; the next page resumes it.
window.addEventListener("pagehide", () => flushClock(false));
setInterval(() => {
  if (!practiceClock || !isPracticing()) return;
  practiceClock.tick(performance.now(), !document.hidden);
  const label = $("#practice-time");
  if (label) label.textContent = durationText(practiceClock.elapsed);
  if (performance.now() - clockSavedAt > 10000) {
    flushClock();
    clockSavedAt = performance.now();
  }
}, 1000);
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    $("#question-picker") &&
    !$("#question-picker").hidden
  ) {
    event.preventDefault();
    closePicker(true);
    return;
  }
  if (
    !isPracticing() ||
    busy ||
    $("#dialog")?.open ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.repeat ||
    !$("#question-picker")?.hidden
  )
    return;
  if (event.target.closest("input, textarea, select, [contenteditable]"))
    return;
  const action =
    event.key === "ArrowLeft"
      ? "previous"
      : event.key === "ArrowRight"
        ? "next"
        : null;
  const control = action && $(`.page-arrow[data-action="${action}"]`);
  if (control && !control.disabled) {
    event.preventDefault();
    control.click();
  }
});
function rememberNavigation() {
  history.replaceState(
    {
      ...history.state,
      practiceView: {
        page,
        filters: { ...filters },
        current,
        queue: [...queue],
        paperYear,
        focusMode,
        chapterMode,
        analysisState: { ...analysisState },
        fromAnalysis,
        returnPosition,
        paperReturnPosition,
      },
    },
    "",
    location.href,
  );
}
function restoreNavigation() {
  const saved = history.state?.practiceView;
  if (
    !saved ||
    ![
      "modules",
      "chapter",
      "catalog",
      "reader",
      "papers",
      "paper",
      "analysis",
    ].includes(saved.page) ||
    !saved.filters ||
    !["signals", "digital"].includes(saved.filters.subject)
  )
    return false;
  for (const key of [
    "subject",
    "source",
    "year",
    "chapter",
    "type",
    "status",
    "list",
    "search",
  ])
    if (typeof saved.filters[key] !== "string") return false;
  if (
    saved.filters.chapter &&
    !chapters.some((c) => c.id === saved.filters.chapter)
  )
    return false;
  filters = { ...saved.filters };
  if (filters.questionIds && !Array.isArray(filters.questionIds))
    delete filters.questionIds;
  if (saved.analysisState && typeof saved.analysisState === "object")
    analysisState = normaliseAnalysisState(catalog, saved.analysisState);
  chapterMode = saved.chapterMode === "knowledge" ? "knowledge" : "training";
  fromAnalysis = !!saved.fromAnalysis;
  returnPosition = Number(saved.returnPosition) || 0;
  paperReturnPosition = Number(saved.paperReturnPosition) || 0;
  page = saved.page;
  paperYear = saved.paperYear || "";
  focusMode = !!saved.focusMode;
  const available = filterQuestions(catalog, filters, study, chapters).map(
    (q) => q.id,
  );
  current = ["reader", "catalog"].includes(page)
    ? available.includes(saved.current)
      ? saved.current
      : available[0] || null
    : null;
  queue = Array.isArray(saved.queue)
    ? saved.queue.filter((id) => available.includes(id))
    : [];
  if (
    page === "paper" &&
    (!examPapers(catalog).some((p) => p.id === paperYear) ||
      !study.papers?.[paperYear])
  ) {
    page = "papers";
    paperYear = "";
  }
  if (page === "paper")
    current =
      activePaper()?.questions.find((q) => q.id === saved.current)?.id ||
      activePaper()?.questions[0]?.id;
  return true;
}
function syncNavigation() {
  const url = new URL(location.href);
  if (page === "paper") url.searchParams.set("paper", paperYear);
  else url.searchParams.delete("paper");
  if (current && isPracticing()) url.searchParams.set("q", current);
  else url.searchParams.delete("q");
  history.replaceState(history.state, "", url);
}
function goModules() {
  delete filters.questionIds;
  fromAnalysis = false;
  page = "modules";
  filters.chapter = "";
  filters.type = "";
  filters.status = "";
  filters.list = "";
  current = null;
  queue = [];
  syncNavigation();
  renderList();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", () => {
  if (busy) {
    syncNavigation();
    rememberNavigation();
    toast("照片正在保存，请完成后再返回");
    return;
  }
  if (restoreNavigation()) {
    syncNavigation();
    rememberNavigation();
    layout();
    if (page === "reader") {
      if (current) renderReader();
      else renderEmptyReader();
    }
    return;
  }
  const year = new URL(location.href).searchParams.get("paper");
  if (year && examPapers(catalog).some((p) => p.id === year)) {
    paperYear = year;
    page = "paper";
    current = null;
    queue = [];
    study.papers ||= {};
    if (!study.papers[year]) {
      startPaperRound(study, activePaper());
      persist();
    }
    layout();
    return;
  }
  const id = new URL(location.href).searchParams.get("q"),
    q = catalog.questions.find((q) => q.id === id);
  current = q?.id || null;
  queue = [];
  if (q) {
    page = "reader";
    filters.subject = q.subject;
    filters.chapter = chapterForQuestion(chapters, q)?.id || "";
    filters.type = q.typeId;
  } else {
    page = "modules";
    filters.chapter = "";
    filters.type = "";
  }
  layout();
  if (current) renderReader();
});
window.addEventListener("beforeunload", (e) => {
  if (pendingSaves || saver?.dirty || busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
setInterval(() => {
  if ($("#exam-countdown-slot"))
    $("#exam-countdown-slot").innerHTML = countdownMarkup(study.examDate);
  if (
    page === "reader" &&
    filters.status === "due" &&
    !busy &&
    !$("#dialog")?.open
  ) {
    const previousIds = visible.map((q) => q.id);
    const nextIds = filterQuestions(catalog, filters, study, chapters).map(
      (q) => q.id,
    );
    if (
      nextIds.length !== previousIds.length ||
      nextIds.some((id) => !previousIds.includes(id))
    ) {
      reconcileLearningView(previousIds);
      rememberNavigation();
    }
  }
}, 30000);
async function localCenter() {
  const info = await api("/local/info");
  dialog(
    "资料与备份",
    `<p>程序版本：v${esc(info.version)} · 题库：${esc(info.edition)}</p><p class="muted small">个人数据：${esc(info.dataDir)}</p><div class="local-controls">${button("local-updates", "更新中心")}${button("local-import", "手动导入题库包")}${button("local-import-answers", "手动导入公共答案")}${button("local-backup", "备份全部个人资料")}${button("local-restore", "恢复个人资料")}${button("local-export", "导出公开题库包")}${button("local-export-answers", "导出公共答案包")}</div><p class="muted small">题库和公共答案更新不覆盖个人答案或复习进度。个人备份含照片，请妥善保存。</p>`,
  );
}
async function downloadResponse(res, filename) {
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "操作失败");
  }
  const url = URL.createObjectURL(await res.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function localAction(action) {
  if (action === "local-backup") {
    await requireSavedStudy();
    await downloadResponse(
      await fetch("/api/local/backup"),
      "842个人资料.sqlite",
    );
    return;
  }
  if (action === "local-updates") {
    await updateCenter.open();
    return;
  }
  if (
    action === "local-import" ||
    action === "local-restore" ||
    action === "local-import-answers"
  ) {
    const restore = action === "local-restore";
    const answers = action === "local-import-answers";
    dialog(
      restore ? "恢复个人资料" : answers ? "导入公共答案更新" : "导入题库更新",
      `<p>${restore ? "将替换个人答案、题单和复习记录；建议先备份。" : "更新公共资料，保留个人答案和学习记录。请选择可信来源的资料包。"}</p><form id="pack-form"><input name="file" type="file" accept="${restore ? ".sqlite" : answers ? ".842answers" : ".842pack"}" required><button class="primary">确认${restore ? "恢复" : "导入"}</button></form>`,
    );
    $("#pack-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      await locked(async () => {
        await requireSavedStudy();
        await api(
          "/local/" +
            (restore ? "restore" : answers ? "import-answers" : "import-pack"),
          {
            method: "POST",
            body: form,
            ...(restore ? { headers: { "If-Match": saver.revision } } : {}),
          },
        );
        location.reload();
      });
    };
    return;
  }
  if (action === "local-export" || action === "local-export-answers") {
    const answersOnly = action === "local-export-answers";
    const result = await api("/local/exportable");
    const version = answersOnly
      ? (await api("/local/updates")).entries.answers.current + 1
      : 0;
    dialog(
      answersOnly ? "导出公共答案包" : "导出公开题库包",
      `<form id="export-pack-form">${answersOnly ? `<label>答案版本号（每次发布递增）<input name="revision" type="number" min="${version}" value="${version}" required></label>` : ""}<label>版本说明<input name="edition" required maxlength="100" value="${new Date().toISOString().slice(0, 10)}"></label><p>仅导出已有公共资料和下面明确勾选的个人定稿答案；私人草稿和学习记录不会导出。导出不等于发布。</p>${result.items.map((i) => `<label class="export-choice"><input type="checkbox" name="ids" value="${esc(i.id)}">${esc(i.id)} · ${i.count}张</label>`).join("")}<button class="primary">生成${answersOnly ? "答案" : "题库"}包</button></form>`,
    );
    $("#export-pack-form").onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      await locked(async () => {
        await downloadResponse(
          await fetch(
            "/api/local/" + (answersOnly ? "export-answers" : "export-pack"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                edition: data.get("edition"),
                ids: data.getAll("ids"),
                ...(answersOnly
                  ? { revision: Number(data.get("revision")) }
                  : {}),
              }),
            },
          ),
          answersOnly ? "842公共答案.842answers" : "842题库.842pack",
        );
        toast("资料包已导出，请检查后发布到GitHub");
      });
    };
    return;
  }
}
try {
  const res = await fetch("/catalog.json");
  if (!res.ok) throw new Error("题库加载失败");
  catalog = await res.json();
  try {
    validateStructured(catalog);
  } catch {
    delete catalog.structured;
    console.warn("结构化题面格式不支持，继续使用原图。");
  }
  analysisState = initialAnalysisState(catalog);
  chapters = buildChapters(catalog);
  let storageError;
  try {
    const session = await api("/session");
    admin = session.admin;
    localMode = !!session.local;
  } catch {
    throw new Error(
      "无法确认保存模式，请确认本地启动器仍在运行后重试；已有记录未修改",
    );
  }
  if (localMode) {
    const [saved, info] = await Promise.all([
      api("/local/study"),
      api("/local/info"),
    ]);
    connection = createLocalConnection({
      dataDir: info.dataDir,
      readInfo: () => api("/local/info", { signal: AbortSignal.timeout(5000) }),
      onChange: (error) => {
        renderConnectionStatus();
        updateCenter.connectionChanged(error);
      },
    });
    study = validateStudy(
      saved.study || emptyStudy(),
      new Set(catalog.questions.map((q) => q.id)),
    );
    let staging;
    try {
      staging = sessionStorage;
    } catch {
      staging = {
        getItem() {
          throw new Error("storage unavailable");
        },
        setItem() {
          throw new Error("storage unavailable");
        },
        removeItem() {
          throw new Error("storage unavailable");
        },
      };
    }
    saver = new StudySaver({
      storage: staging,
      key: STORAGE_KEY + ":pending:" + enc(info.dataDir),
      revision: saved.revision,
      send: (body, revision) =>
        api("/local/study", {
          method: "PUT",
          headers: { "If-Match": revision },
          body,
        }),
      readCurrent: async () => {
        const [saved, currentInfo] = await Promise.all([
          api("/local/study"),
          api("/local/info"),
        ]);
        if (currentInfo.dataDir !== info.dataDir)
          throw new Error(
            "当前服务使用了不同的资料目录，请启动原资料目录，或先导出本页记录",
          );
        return {
          ...saved,
          study: validateStudy(
            saved.study || emptyStudy(),
            new Set(catalog.questions.map((q) => q.id)),
          ),
        };
      },
      onChange: renderSaveStatus,
    });
    const pending = saver.readPending();
    if (pending) {
      const recovered = validateStudy(
        JSON.parse(pending.payload),
        new Set(catalog.questions.map((q) => q.id)),
      );
      if (saver.restore(pending, study)) study = recovered;
    }
  } else {
    try {
      study = loadStudy(
        localStorage,
        new Set(catalog.questions.map((q) => q.id)),
      );
    } catch {
      study = emptyStudy();
      storageError = "已有浏览器记录无法读取，请检查备份";
    }
  }
  const restoredNavigation = restoreNavigation();
  layout();
  const id = new URL(location.href).searchParams.get("q");
  const year = new URL(location.href).searchParams.get("paper");
  if (restoredNavigation) {
    if (page === "reader") {
      if (current) renderReader();
      else renderEmptyReader();
    }
  } else if (year && examPapers(catalog).some((p) => p.id === year)) {
    paperYear = year;
    page = "paper";
    current = null;
    study.papers ||= {};
    if (!study.papers[year]) {
      startPaperRound(study, activePaper());
      persist();
    }
    persist();
    renderList();
  } else if (id && catalog.questions.some((q) => q.id === id)) {
    const q = catalog.questions.find((q) => q.id === id);
    filters.subject = q.subject;
    filters.chapter = chapterForQuestion(chapters, q)?.id || "";
    filters.type = q.typeId;
    layout();
    openQuestion(id, true);
  }
  syncNavigation();
  rememberNavigation();
  if (storageError) toast(storageError);
  if (localMode) {
    void updateCenter.automatic();
    setInterval(() => {
      if (!document.hidden) void connection.check();
    }, 15000);
    window.addEventListener("focus", () => void connection.check());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void connection.check();
    });
  }
} catch (error) {
  app.innerHTML = `<main class="empty"><h1>暂时无法打开题库</h1><p>${esc(error.message)}</p><a href="/">重新加载</a></main>`;
}
