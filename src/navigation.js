import { chapterQuestions, chapterForType } from "./chapters.js";
import { learningSummary, resumeQuestion } from "./learning-view.js";
import { scopeName } from "./interactions.js";
import { filterLabel, matchesTraining } from "./curriculum.js";
import { videosMarkup } from "./learning-content.js";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const action = (name, label, attrs = "", className = "") =>
  `<button type="button" data-action="${name}" class="${className}" ${attrs}>${label}</button>`;

export function paintNavigation({
  chapters,
  catalog,
  filters,
  page,
  records,
  matching,
  current,
  lastQuestion,
  chapterMode = "training",
}) {
  const root = document.querySelector("#chapter-browser"),
    crumb = document.querySelector("#breadcrumb");
  const currentChapter = chapters.find((c) => c.id === filters.chapter);
  const type =
    currentChapter?.types.find((t) => t.id === filters.type) ||
    filterLabel(catalog, filters.type);
  const subject = filters.subject === "signals" ? "信号与系统" : "数字电路";
  const inReader = page === "reader";
  const scope = scopeName(filters);
  const scopeBar = document.querySelector("#learning-scope");
  scopeBar.hidden = !scope;
  scopeBar.innerHTML = scope
    ? `<span>当前范围：<strong>${esc(scope)}</strong> · ${esc(subject)}</span><div>${action("scope-back", "返回" + esc(scope))}${action("scope-clear", "显示全部题目", "", "text-button")}</div>`
    : "";
  document.querySelector(".workspace").hidden = !inReader;
  root.hidden = inReader;
  const shortcuts = document.querySelector("#chapter-shortcuts");
  const subjectChapters = chapters.filter((c) => c.subject === filters.subject);
  const directoryOpen =
    shortcuts.querySelector("details")?.open ??
    window.matchMedia("(min-width: 851px)").matches;
  shortcuts.innerHTML = `<details ${directoryOpen ? "open" : ""}><summary>本学科目录</summary><div>${subjectChapters.map((c) => action("chapter", `<span class="shortcut-number">${esc(c.number.replace("专题 ", "补"))}</span><span>${esc(c.title)}</span>`, `data-id="${c.id}" ${c.id === filters.chapter ? 'aria-current="page"' : ""}`, c.id === filters.chapter ? "selected" : "")).join("")}</div></details>`;
  const crumbs = [action("modules", subject)];
  if (scope)
    crumbs.push(
      '<span aria-hidden="true">/</span>',
      action("scope-back", esc(scope)),
    );
  if (currentChapter)
    crumbs.push(
      '<span aria-hidden="true">/</span>',
      action(
        "chapter",
        esc(currentChapter.title),
        `data-id="${currentChapter.id}"`,
      ),
    );
  if (type)
    crumbs.push(
      '<span aria-hidden="true">/</span>',
      `<span class="crumb-current">${esc(type.title)}</span>`,
    );
  else if (inReader && !scope)
    crumbs.push(
      '<span aria-hidden="true">/</span>',
      `<span class="crumb-current">${esc(filters.list || { star: "我的收藏", review: "待复习", done: "已掌握", due: "到期复习", wrong: "错题重做" }[filters.status] || "全部题目")}</span>`,
    );
  crumb.innerHTML = crumbs.join("");
  document
    .querySelectorAll('[data-action="modules"]')
    .forEach((b) => b.classList.toggle("active", page === "modules"));
  const switcher = document.querySelector('[data-action="back-chapter"]');
  switcher.textContent = currentChapter ? "切换题型" : "章节目录";
  if (inReader) return;
  document.querySelector("#heading").textContent =
    currentChapter?.title || subject;
  const done = (qs) => qs.filter((q) => records[q.id]?.state === "done").length;
  const trainingCount = (qs) =>
    new Set(qs.flatMap((q) => q.trainingIds || [q.typeId])).size;
  if (!currentChapter) {
    const courseChapters = chapters.filter(
      (c) => c.subject === filters.subject,
    );
    const total = matching.length,
      completed = done(matching);
    root.innerHTML = `<div class="course-summary"><div><span class="section-kicker">章节学习</span><h2>从一个章节开始</h2><p>${courseChapters.length} 个章节与专题 · ${total} 道题 · 已掌握 ${completed} 道</p></div>${action("browse-all", '浏览全部题目 <span aria-hidden="true">↗</span>', "", "browse-all")}</div><div class="chapter-grid">${courseChapters
      .map((c) => {
        const qs = chapterQuestions(c, matching),
          all = chapterQuestions(c, catalog.questions),
          completed = done(qs),
          percent = qs.length ? Math.round((completed / qs.length) * 100) : 0;
        return `<button type="button" class="chapter-card ${c.supplement ? "supplement" : ""}" data-action="chapter" data-id="${c.id}"><span class="chapter-card-top"><span class="chapter-symbol" aria-hidden="true">${esc(c.symbol)}</span><span class="chapter-number">${c.supplement ? "真题专题" : `第 ${c.number} 章`}</span></span><h3>${esc(c.title)}</h3><p class="chapter-summary">${esc(c.summary)}</p><div class="chapter-meta"><span>${trainingCount(qs)} 个题型</span><span>${qs.length} 道题${qs.length !== all.length ? ` / 共${all.length}道` : ""}</span></div><div class="chapter-progress" role="progressbar" aria-label="${esc(c.title)}掌握进度" aria-valuemin="0" aria-valuemax="${qs.length || 1}" aria-valuenow="${completed}"><span style="width:${percent}%"></span></div><div class="chapter-card-footer"><span>已掌握 ${completed} / ${qs.length}</span><span class="chapter-enter">进入章节 <span aria-hidden="true">→</span></span></div></button>`;
      })
      .join(
        "",
      )}</div><div class="classification-footer">${action("classification-source", "分类依据", "", "text-button")}</div>`;
    const summary = learningSummary(
      catalog.questions.filter((q) => q.subject === filters.subject),
      records,
    );
    const resume = resumeQuestion(catalog, lastQuestion, filters.subject);
    root.insertAdjacentHTML(
      "afterbegin",
      `<section class="learning-overview" aria-label="学习概览"><div class="resume-block"><span class="section-kicker">${resume ? "上次练习" : "本地学习"}</span><h2>${resume ? esc(resume.year + " · " + resume.number) : "选择章节，开始练习"}</h2><p>${resume ? esc(resume.title) : "题目、个人答案与复习进度都保存在本机"}</p>${resume ? action("resume", "继续上次 →", "", "primary") : ""}</div><div class="learning-metrics">${action("status", `<strong>${summary.due}</strong><span>到期复习</span>`, 'data-value="due"')}${action("status", `<strong>${summary.wrong}</strong><span>待重做错题</span>`, 'data-value="wrong"')}${action("status", `<strong>${summary.done}<small> / ${summary.total}</small></strong><span>已标记掌握</span>`, 'data-value="done"')}</div></section>`,
    );
  } else {
    const qs = chapterQuestions(currentChapter, matching);
    root.innerHTML = `<div class="chapter-heading"><div>${action("modules", "← 全部章节", "", "back-link")}<p class="section-kicker">${currentChapter.supplement ? "真题专题" : `第 ${currentChapter.number} 章`}</p><p class="chapter-description">${esc(currentChapter.summary)}</p></div><div class="chapter-start">${action("chapter-practice", "本章顺序练习", qs.length ? "" : "disabled", "primary")}${action("chapter-random", "本章随机练习", qs.length ? "" : "disabled")}</div></div><div class="chapter-stats"><span><strong>${qs.length}</strong> 道题</span><span><strong>${trainingCount(qs)}</strong> 个题型</span><span><strong>${done(qs)}</strong> 已掌握</span></div>${currentChapter.sections
      .map((s, i) => {
        const types = s.types
          .map((t) => ({
            type: t,
            qs: qs.filter((q) => matchesTraining(q, t.id)),
          }))
          .filter((t) => t.qs.length);
        if (!types.length) return "";
        return `<section class="chapter-section"><div class="section-heading"><h2><span>${String(i + 1).padStart(2, "0")}</span>${esc(s.title)}</h2><span>${types.length} 个题型</span></div><div class="type-card-grid">${types.map(({ type, qs }) => `<button type="button" class="type-card" data-action="type" data-id="${esc(type.id)}"><div class="type-card-copy"><h3>${esc(type.title)}</h3><p>${qs.length} 道题 · ${Math.min(...qs.map((q) => q.year))}—${Math.max(...qs.map((q) => q.year))}年 <span>已掌握 ${done(qs)}</span></p></div><span class="type-card-arrow" aria-hidden="true">→</span></button>`).join("")}</div></section>`;
      })
      .join(
        "",
      )}${!qs.length ? '<div class="empty chapter-empty">当前年份或搜索条件下暂无题目。<br>可以清除筛选后查看本章全部内容。</div>' : ""}`;
    const back = root.querySelector(".back-link");
    if (catalog.curriculum) {
      const mode = `<div class="chapter-mode" aria-label="练习方式">${action("chapter-mode", "按解题任务", 'data-mode="training" aria-pressed="' + (chapterMode === "training") + '"')}${action("chapter-mode", "按具体知识点", 'data-mode="knowledge" aria-pressed="' + (chapterMode === "knowledge") + '"')}</div>`;
      root
        .querySelector(".chapter-stats")
        .insertAdjacentHTML(
          "afterend",
          mode + videosMarkup(catalog, "chapter", currentChapter.id),
        );
      if (chapterMode === "knowledge") {
        root.querySelectorAll(".chapter-section").forEach((s) => s.remove());
        const topics = currentChapter.knowledge || [];
        root.insertAdjacentHTML(
          "beforeend",
          `<section class="chapter-section"><h2>具体知识点</h2><p class="muted small">包含跨章节综合题的相关标注；同一道题可能出现在多个知识点下。</p><div class="knowledge-grid">${topics
            .map((t) => {
              const related = matching.filter((q) =>
                q.knowledgeIds?.includes(t.id),
              );
              return action(
                "knowledge",
                `${esc(t.title)}<small>${related.length}道相关题 · ${new Set(related.map((q) => q.year)).size}个年份</small>`,
                `data-id="${esc(t.id)}"`,
              );
            })
            .join("")}</div></section>`,
        );
      }
    }
    if (scope) {
      back.dataset.action = "scope-back";
      back.textContent = "← 返回" + scope;
    }
    root
      .querySelector(".chapter-start")
      .insertAdjacentHTML("afterbegin", action("chapter-picker", "切换章节"));
    if (!qs.length)
      root.querySelector(".chapter-empty").innerHTML =
        `<h3>${scope ? "本章暂无" + esc(scope) + "题目" : "本章暂无符合条件的题目"}</h3><p>${scope ? "当前保留“" + esc(scope) + "”范围，可重新选择其他章节。" : "可更换章节或清除年份、题源和搜索条件。"}</p><div>${action("chapter-picker", "重新选择章节", "", "primary")}${action("scope-back", scope ? "返回" + esc(scope) : "返回题目列表")}${action("scope-clear", "查看本章全部题目", "", "text-button")}</div>`;
  }
}
