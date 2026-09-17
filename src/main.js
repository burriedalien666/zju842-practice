import "./style.css";
import "./navigation.css";
import "./papers.css";
import { StudySaver } from "./persistence.js";
import { createUpdateCenter } from "./updates.js";
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
import { examPapers, validateExamDate, paperStats } from "./papers.js";
import { paintPapers, countdownMarkup, ratingText } from "./paper-view.js";
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
let page = "modules",
  chapters = [];
let focusMode = false;
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
async function api(url, options = {}) {
  const res = await fetch("/api" + url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(data.error || "操作失败"), {
      statusCode: res.status,
    });
  return data;
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
  slot.innerHTML = saver.error
    ? `<span><strong>尚未保存到本机</strong>：${esc(saver.error.message)}${saver.durable ? "（本标签页刷新可恢复；关闭前请导出）" : "；浏览器暂存也不可用，请立即导出"}</span><div>${saver.error.statusCode === 409 ? "" : button("retry-save", "重试保存")}${button("export", "导出本页记录")}${button("reload-study", "读取磁盘记录", "text-button")}</div>`
    : `<span>${saver.dirty ? "正在保存到本机…" : "已保存到本机"}</span>`;
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
    if (adminDraft && current) renderReader();
  });
  $(".topbar").insertAdjacentHTML(
    "afterend",
    '<div id="save-status" class="save-status" role="status" hidden></div>',
  );
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
  $("#exam-countdown-slot").innerHTML = countdownMarkup(study.examDate);
  $(".course-toolbar").hidden = page === "papers" || page === "paper";
  if (page === "papers" || page === "paper") {
    app.classList.remove("focus-mode");
    paintPapers({ catalog, study, year: page === "paper" ? paperYear : "" });
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
  const done = catalog.questions.filter(
    (q) => q.subject === filters.subject && record(q.id).state === "done",
  ).length;
  $("#progress").textContent =
    `已掌握 ${done} / ${catalog.questions.filter((q) => q.subject === filters.subject).length}`;
  $(".question-list").innerHTML =
    visible
      .map(
        (q) =>
          `<button class="question-card ${current === q.id ? "selected" : ""}" data-action="question" data-id="${esc(q.id)}"><span class="row"><strong>${q.year} · ${esc(q.number)}</strong><span class="muted">${record(q.id).star ? "★" : ""} ${record(q.id).state === "done" ? "已掌握" : record(q.id).state === "review" ? "待复习" : ""}</span></span><span class="question-title">${esc(q.title)}</span><span class="tag">${q.sourceKind === "final" ? "期末试题" : "考研真题"}</span></button>`,
      )
      .join("") || '<div class="empty">没有符合条件的题目</div>';
  document
    .querySelectorAll('[data-action="status"]')
    .forEach((b) =>
      b.classList.toggle(
        "active",
        ["reader", "chapter"].includes(page) &&
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
  });
  app.classList.toggle("focus-mode", page === "reader" && focusMode);
  $("#reading-tools").hidden = page !== "reader";
  if (page === "reader") {
    const chapter = chapters.find((c) => c.id === filters.chapter);
    const questions = queue.includes(current)
        ? queue
        : visible.map((q) => q.id),
      index = questions.indexOf(current);
    $("#reading-tools").innerHTML =
      `<div class="reading-location">${button("chapter-picker", "☷ 切换章节", "text-button")}<span>${esc(chapter?.title || subjects[filters.subject])}</span></div><div class="reading-steps"><span>${index >= 0 ? index + 1 : 0} / ${questions.length}</span>${button("previous", "← 上一题", "", index <= 0 ? "disabled" : "")}${button("next", "下一题 →", "primary", index < 0 || index >= questions.length - 1 ? "disabled" : "")}${button("focus", focusMode ? "退出专注" : "专注做题", "", `aria-pressed="${focusMode}"`)}</div>`;
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
async function renderReader() {
  const version = ++readerVersion,
    q = selected();
  if (!q) return;
  answerData = null;
  adminDraft = null;
  const r = record(q.id),
    type =
      chapterForQuestion(chapters, q)?.types.find((t) => t.id === q.typeId) ||
      catalog.types.find((t) => t.id === q.typeId);
  $("#reader").innerHTML =
    `<div class="reader-heading"><div><span class="eyebrow">${esc(q.sourceTitle)}</span><h2>${q.year}年 · ${esc(q.number)}</h2></div>${button("share", "分享", "text-button")}</div><div class="reader-type">${esc(type.title)}</div><div class="reader-actions">${button("star", r.star ? "★ 已收藏" : "☆ 收藏", r.star ? "active" : "")}${button("review", "待复习", r.state === "review" ? "active" : "")}${button("done", "已掌握", r.state === "done" ? "active" : "")}${button("add-list", "加入题单")}</div><div class="question-images">${q.images.map((im) => `<button class="image-button" data-action="zoom" data-src="/${esc(im.src)}" aria-label="放大题目图片"><img src="/${esc(im.src)}" width="${im.width}" height="${im.height}" alt="${esc(q.year + "年 " + q.number + " 原题")}" loading="lazy"></button>${im.caption ? `<p class="muted small">${esc(im.caption)}</p>` : ""}`).join("")}</div>${q.note ? `<p class="source-note">${esc(q.note)}</p>` : ""}<div class="answer-section"><div class="row"><h3>参考答案</h3>${admin ? button("edit-answer", "编辑照片答案", "text-button") : ""}</div><div id="answer-content" class="muted small">正在读取…</div></div><footer class="reader-footer">${button("previous", "上一题")}${button("next", "下一题", "primary")}<span id="queue-position" class="muted small"></span>${button("correction", "题目纠错", "text-button")}</footer>`;
  $(".reader-footer").insertAdjacentHTML(
    "beforebegin",
    `<section class="review-panel"><h3>本次作答</h3><div class="review-ratings">${button("grade-wrong", "做错了")}${button("grade-hard", "答对但吃力")}${button("grade-good", "独立答对", "primary")}</div><p class="muted small">${r.review ? "下次复习：" + new Date(r.review.due).toLocaleString() + " · 累计错误 " + r.review.lapses + " 次" : "作答后自评，开始安排复习"}</p></section>`,
  );
  if (localMode) {
    $('[data-action="share"]').textContent = "复制题号";
    if (admin) $('[data-action="edit-answer"]').textContent = "编辑我的答案";
  }
  $('[data-action="star"]').textContent = r.star ? "★ 取消收藏" : "☆ 收藏";
  $('[data-action="review"]').textContent =
    r.state === "review" ? "取消待复习" : "加入待复习";
  $('[data-action="done"]').textContent =
    r.state === "done" ? "取消掌握" : "标记掌握";
  if (scopeName(filters))
    $(".reader-actions").insertAdjacentHTML(
      "beforeend",
      button(
        "remove-view",
        filters.list
          ? "移出当前题单"
          : {
              star: "移出收藏",
              review: "移出待复习",
              done: "取消掌握标记",
              wrong: "移出错题",
              due: "暂停这题复习",
            }[filters.status],
        "remove-view",
      ),
    );
  if (r.review?.suspended) {
    $(".review-panel p").textContent =
      `已暂停自动复习 · 累计错误 ${r.review.lapses} 次`;
    $(".review-panel").insertAdjacentHTML(
      "beforeend",
      button("resume-review", "恢复自动复习"),
    );
  }
  const ids = queue.includes(current) ? queue : visible.map((q) => q.id),
    i = ids.indexOf(current);
  $("#queue-position").textContent = i >= 0 ? `${i + 1} / ${ids.length}` : "";
  document
    .querySelectorAll('[data-action="previous"]')
    .forEach((b) => (b.disabled = i <= 0));
  document
    .querySelectorAll('[data-action="next"]')
    .forEach((b) => (b.disabled = i < 0 || i >= ids.length - 1));
  try {
    const result = await api("/answers/" + enc(q.id));
    if (version !== readerVersion) return;
    answerData = result;
    if (localMode) {
      const [official, personal] = await Promise.all([
        api("/local/official/" + enc(q.id)),
        admin
          ? api("/admin/answers/" + enc(q.id))
          : Promise.resolve({ draft: [] }),
      ]);
      if (version !== readerVersion) return;
      answerData = { ...result, official: official.photos };
      $("#answer-content").innerHTML =
        `<div class="answer-tabs">${official.photos.length ? button("show-official", "题库答案 · " + official.photos.length + " 张", "", 'aria-pressed="false"') : "<span>题库暂无答案</span>"}${result.photos.length ? button("show-answer", "我的定稿 · " + result.photos.length + " 张", "", 'aria-pressed="false"') : ""}${personal.draft.length ? button("edit-answer", "继续编辑草稿 · " + personal.draft.length + " 张", "text-button") : ""}</div><div id="answer-view" hidden></div>`;
      return;
    }
    $("#answer-content").innerHTML = result.photos.length
      ? `<div class="answer-tabs">${button("show-answer", `查看答案 · ${result.photos.length} 张`, "", 'aria-pressed="false"')}</div><div id="answer-view" hidden></div>`
      : "暂无已发布答案";
  } catch (e) {
    if (version === readerVersion) $("#answer-content").textContent = e.message;
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
        `<button class="image-button" data-action="zoom" data-src="/api/media/${id}" aria-label="放大答案照片"><img src="/api/media/${id}" alt="手写参考答案" loading="lazy"></button>`,
    )
    .join("");
}
function toggleAnswer(kind) {
  const view = $("#answer-view");
  if (!view || !answerData) return;
  const hide = !view.hidden && view.dataset.kind === kind;
  view.hidden = hide;
  view.dataset.kind = kind;
  view.innerHTML = hide
    ? ""
    : kind === "official"
      ? answerData.official
          .map(
            (src) =>
              `<button class="image-button" data-action="zoom" data-src="${esc(src)}" aria-label="放大题库答案"><img src="${esc(src)}" alt="题库答案"></button>`,
          )
          .join("")
      : photoHtml(answerData.photos);
  for (const [action, source] of [
    ["show-official", "official"],
    ["show-answer", "personal"],
  ]) {
    const control = $(`[data-action="${action}"]`, $("#answer-content"));
    if (control) {
      control.setAttribute("aria-pressed", String(!hide && kind === source));
      control.classList.toggle("active", !hide && kind === source);
    }
  }
}
async function editAnswer() {
  const id = current;
  const draft = await api("/admin/answers/" + enc(id));
  if (current !== id || page !== "reader") return;
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
      page = "reader";
      syncNavigation();
      reconcileLearningView([]);
      return;
    }
    if (action === "scope-clear") {
      if ($("#dialog").open) $("#dialog").close();
      filters.status = "";
      filters.list = "";
      filters = clearSearchFilters(filters);
      current = null;
      queue = [];
      if (page === "reader") {
        syncNavigation();
        reconcileLearningView([]);
      } else {
        syncNavigation();
        renderList();
      }
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
      paperYear = b.dataset.year;
      page = "paper";
      current = null;
      queue = [];
      study.papers ||= {};
      study.papers[paperYear] ||= {
        started: Date.now(),
        finished: null,
        marks: {},
      };
      persist();
      syncNavigation();
      renderList();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "paper-jump") {
      e.preventDefault();
      document
        .getElementById("paper-" + encodeURIComponent(b.dataset.id))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action === "paper-grade") {
      const id = b.dataset.id,
        rating = b.dataset.rating,
        run = study.papers[paperYear];
      if (run.finished !== null) {
        toast("本轮已结束；请重新做一轮后再标记");
        return;
      }
      run.marks[id] = rating;
      if (rating !== "done") {
        const r = { ...record(id) };
        r.review = scheduleReview(r.review, rating, study.settings);
        r.state = rating === "good" ? "done" : "review";
        study.records[id] = r;
        study.version = 2;
        study.settings = reviewSettings(study.settings);
      }
      persist();
      b.closest(".paper-question").querySelector(".paper-result").textContent =
        ratingText(rating);
      document.querySelectorAll(".paper-index a").forEach((a) => {
        if (a.dataset.id === id) a.classList.add("answered");
      });
      const stats = paperStats(
        examPapers(catalog).find((p) => p.id === paperYear),
        run,
      );
      $("#paper-progress").textContent =
        `本轮已做 ${stats.completed} / ${stats.total}`;
      return;
    }
    if (action === "paper-answer") {
      const panel = b.closest(".paper-question").querySelector(".paper-answer");
      if (panel.childElementCount) {
        panel.innerHTML = "";
        b.textContent = "查看答案";
        return;
      }
      b.disabled = true;
      try {
        const id = b.dataset.id;
        const [personal, official] = await Promise.all([
          api("/answers/" + enc(id)),
          localMode
            ? api("/local/official/" + enc(id))
            : Promise.resolve({ photos: [] }),
        ]);
        panel.innerHTML = `${official.photos.length ? "<h3>题库答案</h3>" + official.photos.map((src) => `<button class="image-button" data-action="zoom" data-src="${esc(src)}"><img src="${esc(src)}" alt="题库答案" loading="lazy"></button>`).join("") : ""}${personal.photos.length ? "<h3>我的答案</h3>" + photoHtml(personal.photos) : ""}${!official.photos.length && !personal.photos.length ? '<p class="muted">这道题暂无答案</p>' : ""}`;
        b.textContent = "收起答案";
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (action === "paper-finish") {
      const run = study.papers[paperYear],
        paper = examPapers(catalog).find((p) => p.id === paperYear),
        stats = paperStats(paper, run);
      dialog(
        "本轮整卷总结",
        `<p>${paperYear} 年 · 已标记 ${stats.completed}/${stats.total} 项</p><p>未标记 ${stats.total - stats.completed} 项 · 做错 ${stats.wrong} 项 · 独立答对 ${stats.good} 项</p><p class="muted small">根据本轮自评统计，不是试卷得分。做错的题已进入错题与复习安排。</p>${button("paper-confirm-finish", run.finished ? "关闭总结" : "结束本轮", "primary")}`,
      );
      return;
    }
    if (action === "paper-confirm-finish") {
      study.papers[paperYear].finished ||= Date.now();
      persist();
      $("#dialog").close();
      renderList();
      return;
    }
    if (action === "paper-restart") {
      dialog(
        "重新做一轮",
        `<p>清空本卷的本轮作答标记，从头开始。个人答案和复习记录不受影响。</p>${button("paper-confirm-restart", "确认开始新一轮", "primary")}`,
      );
      return;
    }
    if (action === "paper-confirm-restart") {
      study.papers[paperYear] = {
        started: Date.now(),
        finished: null,
        marks: {},
      };
      persist();
      $("#dialog").close();
      renderList();
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
    if (action.startsWith("grade-")) {
      if (!current) return;
      const previousIds = visible.map((q) => q.id);
      const rating = action.slice(6),
        r = { ...record(current) };
      if (!queue.includes(current)) queue = visible.map((q) => q.id);
      r.review = scheduleReview(r.review, rating, study.settings);
      r.state = rating === "good" ? "done" : "review";
      study.version = 2;
      study.settings = reviewSettings(study.settings);
      study.records[current] = r;
      persist();
      reconcileLearningView(previousIds);
      toast(rating === "wrong" ? "已加入错题，10分钟后复习" : "已安排下次复习");
      return;
    }
    if (action === "show-official" || action === "show-answer") {
      toggleAnswer(action === "show-official" ? "official" : "personal");
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
        '<p>信号与系统按基础、时域、连续频域、离散频域、采样调制、拉普拉斯变换、Z变换七章组织。</p><p>数字电路按编码、逻辑代数、门电路、组合逻辑、组合模块、触发器、时序逻辑组织，并保留脉冲电路、存储器等842真题专题。</p><p class="muted small">章节顺序参考你提供的《信号系统与数字电路》大纲。文件注明2020年905单考，本分类仅用于导航，不据此删减842题目或认定当前考试范围。</p>',
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
      page = "reader";
      queue = [];
      renderList();
      if (visible.length) openQuestion(visible[0].id);
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
      page = "reader";
      renderList();
      if (visible.length) openQuestion(visible[0].id);
      else {
        current = null;
        syncNavigation();
        renderList();
        renderEmptyReader();
      }
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
      filters.subject = b.dataset.value;
      filters.chapter = "";
      filters.type = "";
      current = null;
      queue = [];
      page = scopeName(filters) ? "reader" : "modules";
      syncNavigation();
      layout();
      if (page === "reader") reconcileLearningView([]);
      return;
    }
    if (action === "status") {
      filters.status = b.dataset.value;
      filters.list = "";
      filters.chapter = "";
      filters.type = "";
      page = "reader";
      queue = [];
      renderLists();
      renderList();
      if (visible.length) openQuestion(visible[0].id);
      else {
        current = null;
        syncNavigation();
        renderList();
        renderEmptyReader();
      }
    }
    if (action === "list") {
      filters.list = study.lists[Number(b.dataset.index)].name;
      filters.status = "";
      filters.chapter = "";
      filters.type = "";
      page = "reader";
      queue = [];
      renderLists();
      renderList();
      if (visible.length) openQuestion(visible[0].id);
      else {
        current = null;
        syncNavigation();
        renderList();
        renderEmptyReader();
      }
    }
    if (action === "question") {
      queue = [];
      openQuestion(b.dataset.id);
    }
    if (action === "clear") {
      filters = clearSearchFilters(filters);
      queue = [];
      layout();
      if (page === "reader") refreshFilters();
    }
    if (action === "practice" || action === "random") {
      queue = visible.map((q) => q.id);
      if (action === "random") queue = shuffled(queue);
      if (queue.length) openQuestion(queue[0]);
      else toast("当前筛选下没有题目");
    }
    if (action === "previous" || action === "next") {
      const ids = queue.includes(current) ? queue : visible.map((q) => q.id),
        next = ids[ids.indexOf(current) + (action === "next" ? 1 : -1)];
      if (next) {
        openQuestion(next);
        if (focusMode) window.scrollTo({ top: 0, behavior: "smooth" });
      }
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
      dialog(
        "查看大图",
        `<div class="zoom-controls">${button("zoom-out", "缩小")}${button("zoom-in", "放大")}</div><div class="zoom-scroll"><img class="zoom-image" data-scale="100" src="${esc(b.dataset.src)}" alt="放大图片"></div>`,
        true,
      );
    }
    if (action === "zoom-in" || action === "zoom-out") {
      const im = $(".zoom-scroll img"),
        scale = Math.max(
          100,
          Math.min(
            400,
            Number(im.dataset.scale) + (action === "zoom-in" ? 50 : -50),
          ),
        );
      im.dataset.scale = scale;
      im.style.width = scale + "%";
      im.style.maxWidth = "none";
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
      renderReader();
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
document.addEventListener("keydown", (event) => {
  if (
    page !== "reader" ||
    busy ||
    $("#dialog")?.open ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.repeat
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
  const control = action && $(`#reading-tools [data-action="${action}"]`);
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
    !["modules", "chapter", "reader", "papers", "paper"].includes(saved.page) ||
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
  page = saved.page;
  paperYear = saved.paperYear || "";
  focusMode = !!saved.focusMode;
  const available = filterQuestions(catalog, filters, study, chapters).map(
    (q) => q.id,
  );
  current =
    page === "reader"
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
  return true;
}
function syncNavigation() {
  const url = new URL(location.href);
  if (page === "paper") url.searchParams.set("paper", paperYear);
  else url.searchParams.delete("paper");
  if (current) url.searchParams.set("q", current);
  else url.searchParams.delete("q");
  history.replaceState(history.state, "", url);
}
function goModules() {
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
    study.papers[year] ||= { started: Date.now(), finished: null, marks: {} };
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
    study.papers[year] ||= { started: Date.now(), finished: null, marks: {} };
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
  if (localMode) void updateCenter.automatic();
} catch (error) {
  app.innerHTML = `<main class="empty"><h1>暂时无法打开题库</h1><p>${esc(error.message)}</p><a href="/">重新加载</a></main>`;
}
