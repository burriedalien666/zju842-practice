import { examPapers, paperStats, countdown } from "./papers.js";
import { videosMarkup } from "./learning-content.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function countdownMarkup(date) {
  const days = countdown(date);
  return `<button class="exam-countdown ${days !== null && days <= 30 ? "urgent" : ""}" data-action="exam-date" title="点击修改目标日期">${days === null ? "<span>考研倒计时</span><strong>设置目标日期 →</strong>" : `<span>${days > 0 ? "距离考研目标日" : days === 0 ? "今天是目标日" : "目标日已过去"}</span><strong>${Math.abs(days)}<small> 天</small></strong><span>${esc(date)} · 自定目标</span>`}</button>`;
}
export function paintPapers({ catalog, study, year }) {
  document.querySelector("#learning-scope").hidden = true;
  const root = document.querySelector("#chapter-browser");
  root.hidden = false;
  document.querySelector(".workspace").hidden = true;
  document.querySelector(".course-toolbar").hidden = true;
  document.querySelector("#reading-tools").hidden = true;
  const papers = examPapers(catalog),
    paper = papers.find((p) => p.id === year);
  document.querySelector("#heading").textContent = paper
    ? `${paper.year} 年真题卷`
    : "历年真题卷";
  document.querySelector("#progress").textContent = paper
    ? "信号与系统 + 数字电路"
    : `${papers.length} 份真题`;
  document.querySelector("#breadcrumb").innerHTML =
    '<button data-action="papers">历年真题卷</button>' +
    (paper ? `<span>/</span><span>${paper.year}</span>` : "");
  document
    .querySelectorAll('[data-action="modules"],[data-action="status"]')
    .forEach((b) => b.classList.remove("active"));
  document.querySelector('[data-action="papers"]').classList.add("active");
  if (!paper) {
    root.innerHTML = `<div class="course-summary"><div><span class="section-kicker">整卷练习</span><h2>按原卷顺序，一次做一套</h2><p>合并两科题目 · 独立记录本轮进度 · 答案默认收起</p></div></div><div class="paper-grid">${papers
      .map((p) => {
        const run = study.papers?.[p.id],
          stats = paperStats(p, run);
        return `<article class="paper-card"><div class="paper-card-top"><strong>${p.year}</strong><span>浙江大学 842</span></div><h3>信号系统与数字电路</h3><p>信号 ${p.questions.filter((q) => q.subject === "signals").length} 项 · 数电 ${p.questions.filter((q) => q.subject === "digital").length} 项</p><div class="chapter-progress"><span style="width:${(stats.completed / stats.total) * 100}%"></span></div><div class="paper-card-footer"><span>${run ? `${run.finished ? "已结束" : "本轮已做"} ${stats.completed}/${stats.total}` : "尚未开始"}</span><button class="primary" data-action="open-paper" data-year="${p.id}">${run ? "继续 / 查看" : "开始整卷"} →</button></div></article>`;
      })
      .join("")}</div>`;
    return;
  }
  const run = study.papers?.[year],
    stats = paperStats(paper, run);
  root.innerHTML = `<section class="paper-workspace"><div class="paper-toolbar"><button data-action="papers">← 全部试卷</button><span id="paper-progress">本轮已做 ${stats.completed} / ${stats.total}</span><button data-action="paper-finish" class="primary">本轮总结</button><button data-action="paper-restart">重新做一轮</button></div><p class="muted small">按原卷编号排列，共 ${stats.total} 个作答条目；部分小问共用原题图。纸上作答后标记完成或自评，不自动评分。</p><nav class="paper-index" aria-label="整卷题号">${paper.questions.map((q) => `<a href="#paper-${encodeURIComponent(q.id)}" data-action="paper-jump" data-id="${esc(q.id)}" class="${run?.marks?.[q.id] ? "answered" : ""}" title="${esc(q.title)}">${esc(q.number)}</a>`).join("")}</nav>${paper.questions.map((q, i) => `<article class="paper-question" id="paper-${encodeURIComponent(q.id)}" data-qid="${esc(q.id)}"><header><h2>${esc(q.number)}</h2><span>${q.subject === "signals" ? "信号与系统" : "数字电路"} · ${i + 1}/${stats.total}</span><span class="paper-result">${ratingText(run?.marks?.[q.id])}</span></header><div class="question-images">${q.images.map((im) => `<button class="image-button" data-action="zoom" data-src="/${esc(im.src)}" aria-label="放大第${esc(q.number)}题"><img src="/${esc(im.src)}" width="${im.width}" height="${im.height}" alt="${pText(paper, q)}" loading="lazy"></button>`).join("")}</div>${q.note ? `<p class="source-note">${esc(q.note)}</p>` : ""}<div class="paper-answer" data-answer-for="${esc(q.id)}"></div><footer><button data-action="paper-answer" data-id="${esc(q.id)}">查看答案</button><button data-action="paper-grade" data-id="${esc(q.id)}" data-rating="done">标记已做</button><div class="paper-ratings"><button data-action="paper-grade" data-id="${esc(q.id)}" data-rating="wrong">做错了</button><button data-action="paper-grade" data-id="${esc(q.id)}" data-rating="hard">答对但吃力</button><button data-action="paper-grade" data-id="${esc(q.id)}" data-rating="good">独立答对</button></div></footer></article>`).join("")}</section>`;
  for (const article of root.querySelectorAll(".paper-question"))
    article
      .querySelector(".paper-answer")
      .insertAdjacentHTML(
        "beforebegin",
        videosMarkup(catalog, "question", article.dataset.qid),
      );
}
function pText(p, q) {
  return esc(`${p.year}年 ${q.number}原题`);
}
export function ratingText(r) {
  return (
    { done: "已做", wrong: "做错了", hard: "答对但吃力", good: "独立答对" }[
      r
    ] || "未标记"
  );
}
