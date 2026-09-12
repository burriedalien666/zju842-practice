import "./style.css";
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
          : record(q.id).state === filters.status)) &&
      (!filters.list || list?.ids.includes(q.id)) &&
      (!filters.search ||
        `${q.title} ${q.number} ${q.year} ${q.tags.join(" ")} ${catalog.types.find((t) => t.id === q.typeId)?.title}`
          .toLowerCase()
          .includes(filters.search.toLowerCase())),
  );
  $("#heading").textContent = filters.list || subjects[filters.subject];
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
  const ids = queue.includes(current) ? queue : visible.map((q) => q.id),
    i = ids.indexOf(current);
  $("#queue-position").textContent = i >= 0 ? `${i + 1} / ${ids.length}` : "";
  $('[data-action="previous"]').disabled = i <= 0;
  $('[data-action="next"]').disabled = i < 0 || i >= ids.length - 1;
  try {
    const result = await api("/answers/" + enc(q.id));
    if (version !== readerVersion) return;
    answerData = result;
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
      `<p>将替换当前浏览器的记录：${Object.keys(imported.records).length} 道题的标记、${imported.lists.length} 个题单。</p>${button("confirm-import", "确认替换", "primary")}`,
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
      try {
        await navigator.clipboard.writeText(location.href);
        toast("题目链接已复制");
      } catch {
        dialog(
          "分享题目",
          `<input readonly value="${esc(location.href)}" aria-label="题目链接">`,
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
        toast(action === "publish" ? "答案已发布" : "公开答案已撤下，草稿保留");
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
    admin = (await api("/session")).admin;
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
