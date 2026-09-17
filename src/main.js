import "./style.css";
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
  pendingSaves = 0;
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
  if (!res.ok) throw new Error(data.error || "操作失败");
  return data;
}
function toast(message) {
  $("#notice").textContent = message;
  $("#notice").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#notice").classList.remove("show"), 4500);
}
function persist() {
  if (localMode) {
    const payload = JSON.stringify(study);
    pendingSaves++;
    saveQueue = saveQueue
      .then(() => api("/local/study", { method: "PUT", body: payload }))
      .catch((e) => toast("保存失败：" + e.message + "；请导出记录"))
      .finally(() => pendingSaves--);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(study));
  } catch {
    toast("浏览器无法保存记录，请先导出备份");
  }
}
function record(id) {
  return study.records[id] || { star: false, state: "" };
}
function selected() {
  return catalog.questions.find((q) => q.id === current);
}
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
    )}</select></div><div class="filter-row"><select id="type" aria-label="题型"></select><span id="count"></span></div><div class="practice-bar">${button("practice", "顺序练习", "primary")}${button("random", "随机练习")}${button("clear", "重置筛选", "text-button")}</div><div id="question-list" class="question-list"></div></div><article id="reader" class="reader"><div class="empty">选择一道题开始</div></article></section></main><dialog id="dialog"><div class="dialog-head"><h2 id="dialog-title"></h2>${button("close-dialog", "×", "icon", 'aria-label="关闭"')}</div><div id="dialog-body"></div></dialog><div id="notice" class="notice" role="status"></div>`;
  $("#search").value = filters.search;
  $(".study-nav").insertAdjacentHTML(
    "beforeend",
    `${button("status", "到期复习", "", 'data-value="due"')}${button("status", "错题重做", "", 'data-value="wrong"')}${button("review-settings", "复习间隔", "text-button")}`,
  );
  if (localMode) $('[data-action="admin"]').textContent = "资料与备份";
  $("#source").value = filters.source;
  $("#year").value = filters.year;
  $("#search").addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderList();
  });
  for (const name of ["source", "year", "type"])
    $("#" + name).addEventListener("change", (e) => {
      filters[name] = e.target.value;
      renderList();
    });
  $("#import-file").addEventListener("change", importRecords);
  $("#dialog").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("#dialog").addEventListener("close", () => {
    if (adminDraft && current) renderReader();
  });
  renderTypes();
  renderLists();
  renderList();
}
function renderTypes() {
  $("#type").innerHTML =
    '<option value="">全部题型</option>' +
    catalog.types
      .filter((t) => t.subject === filters.subject)
      .map(
        (t) =>
          `<option value="${esc(t.id)}">${esc(t.groupTitle)} · ${esc(t.title)}</option>`,
      )
      .join("");
  $("#type").value = filters.type;
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
function renderList() {
  const list = study.lists.find((l) => l.name === filters.list);
  visible = catalog.questions.filter(
    (q) =>
      q.subject === filters.subject &&
      (!filters.source || q.sourceKind === filters.source) &&
      (!filters.year || q.year === Number(filters.year)) &&
      (!filters.type || q.typeId === filters.type) &&
      (!filters.status ||
        (filters.status === "star"
          ? record(q.id).star
          : filters.status === "due"
            ? isDue(record(q.id))
            : filters.status === "wrong"
              ? record(q.id).review?.wrong
              : record(q.id).state === filters.status)) &&
      (!filters.list || list?.ids.includes(q.id)) &&
      (!filters.search ||
        `${q.id} ${q.title} ${q.number} ${q.year} ${q.tags.join(" ")} ${catalog.types.find((t) => t.id === q.typeId)?.title}`
          .toLowerCase()
          .includes(filters.search.toLowerCase())),
  );
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
        b.dataset.value === filters.status && !filters.list,
      ),
    );
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
  current = id;
  if (filters.subject !== q.subject) {
    filters.subject = q.subject;
    filters.type = "";
    layout();
  }
  const url = new URL(location.href);
  url.searchParams.set("q", id);
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
    type = catalog.types.find((t) => t.id === q.typeId);
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
  const ids = queue.includes(current) ? queue : visible.map((q) => q.id),
    i = ids.indexOf(current);
  $("#queue-position").textContent = i >= 0 ? `${i + 1} / ${ids.length}` : "";
  $('[data-action="previous"]').disabled = i <= 0;
  $('[data-action="next"]').disabled = i < 0 || i >= ids.length - 1;
  try {
    const result = await api("/answers/" + enc(q.id));
    if (version !== readerVersion) return;
    answerData = result;
    if (localMode) {
      const official = await api("/local/official/" + enc(q.id));
      if (version !== readerVersion) return;
      answerData = { ...result, official: official.photos };
      $("#answer-content").innerHTML =
        `<div class="answer-tabs">${official.photos.length ? button("show-official", "题库答案 · " + official.photos.length + " 张") : "<span>题库暂无答案</span>"}${result.photos.length ? button("show-answer", "我的答案 · " + result.photos.length + " 张") : ""}</div>`;
      return;
    }
    $("#answer-content").innerHTML = result.photos.length
      ? button("show-answer", `查看答案 · ${result.photos.length} 张`)
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
async function editAnswer() {
  adminDraft = await api("/admin/answers/" + enc(current));
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
      study = imported;
      persist();
      $("#dialog").close();
      renderLists();
      renderList();
      renderReader();
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
    if (action.startsWith("grade-")) {
      const rating = action.slice(6),
        r = { ...record(current) };
      if (!queue.includes(current)) queue = visible.map((q) => q.id);
      r.review = scheduleReview(r.review, rating, study.settings);
      r.state = rating === "good" ? "done" : "review";
      study.version = 2;
      study.settings = reviewSettings(study.settings);
      study.records[current] = r;
      persist();
      renderList();
      renderReader();
      toast(rating === "wrong" ? "已加入错题，10分钟后复习" : "已安排下次复习");
      return;
    }
    if (action === "show-official") {
      $("#answer-content").innerHTML = answerData.official
        .map(
          (src) =>
            `<button class="image-button" data-action="zoom" data-src="${esc(src)}"><img src="${esc(src)}" alt="题库答案"></button>`,
        )
        .join("");
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
    if (action === "subject") {
      filters.subject = b.dataset.value;
      filters.type = "";
      queue = [];
      layout();
      if (visible.length) openQuestion(visible[0].id);
      else {
        current = null;
        const url = new URL(location.href);
        url.searchParams.delete("q");
        history.pushState({}, "", url);
      }
    }
    if (action === "status") {
      filters.status = b.dataset.value;
      filters.list = "";
      queue = [];
      renderLists();
      renderList();
    }
    if (action === "list") {
      filters.list = study.lists[Number(b.dataset.index)].name;
      filters.status = "";
      queue = [];
      renderLists();
      renderList();
    }
    if (action === "question") {
      queue = [];
      openQuestion(b.dataset.id);
    }
    if (action === "clear") {
      filters = {
        subject: filters.subject,
        source: "",
        year: "",
        type: "",
        status: "",
        list: "",
        search: "",
      };
      queue = [];
      layout();
      if (current) renderReader();
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
      if (next) openQuestion(next);
    }
    if (["star", "review", "done"].includes(action)) {
      if (!queue.includes(current) && visible.some((q) => q.id === current))
        queue = visible.map((q) => q.id);
      const r = { ...record(current) };
      if (action === "star") r.star = !r.star;
      else r.state = r.state === action ? "" : action;
      study.records[current] = r;
      persist();
      renderList();
      renderReader();
    }
    if (action === "share") {
      const shareText = localMode
        ? `${selected().sourceTitle} · ${selected().number}（题号：${current}）`
        : location.href;
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
    if (action === "show-answer")
      $("#answer-content").innerHTML = photoHtml(answerData.photos);
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
        if (filters.list === study.lists[i].name) filters.list = "";
        study.lists.splice(i, 1);
        persist();
        renderLists();
        renderList();
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
              `${l.ids.includes(current) ? "✓ " : "＋ "}${esc(l.name)}`,
              "list-choice",
              `data-index="${i}"`,
            ),
          )
          .join("") ||
          `<p>还没有题单。</p>${button("new-list", "创建题单", "primary")}`,
      );
    if (action === "toggle-list-item") {
      const l = study.lists[Number(b.dataset.index)];
      l.ids = l.ids.includes(current)
        ? l.ids.filter((id) => id !== current)
        : [...l.ids, current];
      persist();
      renderLists();
      renderList();
      b.textContent = `${l.ids.includes(current) ? "✓ " : "＋ "}${l.name}`;
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
  }
});
window.addEventListener("popstate", () => {
  const id = new URL(location.href).searchParams.get("q");
  if (id) {
    current = id;
    if (selected()) {
      filters.subject = selected().subject;
      filters.type = "";
      layout();
      renderReader();
    }
  }
});
window.addEventListener("beforeunload", (e) => {
  if (pendingSaves) {
    e.preventDefault();
    e.returnValue = "";
  }
});
setInterval(() => {
  if (filters.status === "due" && !busy) renderList();
}, 30000);
async function localCenter() {
  const info = await api("/local/info");
  dialog(
    "资料与备份",
    `<p>题库版本：${esc(info.edition)}</p><p class="muted small">个人数据：${esc(info.dataDir)}</p><div class="local-controls">${button("local-updates", "检查题库更新")}${button("local-import", "导入题库包")}${button("local-backup", "备份全部个人资料")}${button("local-restore", "恢复个人资料")}${button("local-export", "导出公开题库包")}</div><p class="muted small">题库更新不覆盖个人答案或复习进度。个人备份含照片，请妥善保存。</p>`,
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
    await saveQueue;
    await downloadResponse(
      await fetch("/api/local/backup"),
      "842个人资料.sqlite",
    );
    return;
  }
  if (action === "local-updates") {
    dialog("检查更新", "正在检查 GitHub…");
    try {
      const result = await api("/local/updates");
      dialog(
        "题库更新",
        `<p>本地：${esc(catalog.edition || "初始题库")}</p><p>GitHub最新版本：${esc(result.name)}</p><p><a target="_blank" rel="noopener" href="${esc(result.url)}">查看发布页并下载题库包</a></p>${button("local-import", "导入已下载的题库包", "primary")}<p class="muted small">不自动替换程序。请按发布说明选择 .842pack 文件。</p>`,
      );
    } catch {
      dialog(
        "检查更新",
        '<p>暂时无法连接 GitHub，已有内容可继续离线使用。</p><a target="_blank" rel="noopener" href="https://github.com/burriedalien666/zju842-practice/releases">手动打开发布页</a>',
      );
    }
    return;
  }
  if (action === "local-import" || action === "local-restore") {
    const restore = action === "local-restore";
    dialog(
      restore ? "恢复个人资料" : "导入题库更新",
      `<p>${restore ? "将替换个人答案、题单和复习记录；建议先备份。" : "替换官方题库，保留个人答案和学习记录。请选择可信来源的题库包。"}</p><form id="pack-form"><input name="file" type="file" accept="${restore ? ".sqlite" : ".842pack"}" required><button class="primary">确认${restore ? "恢复" : "导入"}</button></form>`,
    );
    $("#pack-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      await locked(async () => {
        await saveQueue;
        await api("/local/" + (restore ? "restore" : "import-pack"), {
          method: "POST",
          body: form,
        });
        location.reload();
      });
    };
    return;
  }
  if (action === "local-export") {
    const result = await api("/local/exportable");
    dialog(
      "导出公开题库包",
      `<form id="export-pack-form"><label>题库版本<input name="edition" required maxlength="100" value="${new Date().toISOString().slice(0, 10)}"></label><p>默认仅导出已有题库资料。下面勾选的个人定稿答案也会进入公开包；私人草稿和学习记录不会导出。</p>${result.items.map((i) => `<label class="export-choice"><input type="checkbox" name="ids" value="${esc(i.id)}">${esc(i.id)} · ${i.count}张</label>`).join("")}<button class="primary">生成题库包</button></form>`,
    );
    $("#export-pack-form").onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      await locked(async () => {
        await downloadResponse(
          await fetch("/api/local/export-pack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              edition: data.get("edition"),
              ids: data.getAll("ids"),
            }),
          }),
          "842题库.842pack",
        );
        toast("题库包已导出，请检查后发布到GitHub");
      });
    };
    return;
  }
}
try {
  const res = await fetch("/catalog.json");
  if (!res.ok) throw new Error("题库加载失败");
  catalog = await res.json();
  let storageError;
  try {
    study = loadStudy(
      localStorage,
      new Set(catalog.questions.map((q) => q.id)),
    );
  } catch {
    study = emptyStudy();
    storageError = "已有学习记录无法读取，请先检查备份；未覆盖原记录";
  }
  try {
    const session = await api("/session");
    admin = session.admin;
    localMode = !!session.local;
    if (localMode) {
      const saved = await api("/local/study");
      if (saved.study)
        study = validateStudy(
          saved.study,
          new Set(catalog.questions.map((q) => q.id)),
        );
      else persist();
    }
  } catch {
    /* 离线时仍可读取已加载题目。 */
  }
  layout();
  const id = new URL(location.href).searchParams.get("q");
  if (id && catalog.questions.some((q) => q.id === id)) openQuestion(id, true);
  else if (visible.length) openQuestion(visible[0].id, true);
  if (storageError) toast(storageError);
} catch (error) {
  app.innerHTML = `<main class="empty"><h1>暂时无法打开题库</h1><p>${esc(error.message)}</p><a href="/">重新加载</a></main>`;
}
