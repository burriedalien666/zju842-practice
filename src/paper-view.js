import { completionProgress } from "./learning-progress.js";
import { examPapers, countdown } from "./papers.js";
import { escapeHtml as esc } from "./learning-content.js";
export function countdownMarkup(date) {
  const days = countdown(date);
  return `<button class="exam-countdown ${days !== null && days <= 30 ? "urgent" : ""}" data-action="exam-date" title="点击修改目标日期">${days === null ? "<span>考研倒计时</span><strong>设置目标日期 →</strong>" : `<span>${days > 0 ? "距离考研目标日" : days === 0 ? "今天是目标日" : "目标日已过去"}</span><strong>${Math.abs(days)}<small> 天</small></strong><span>${esc(date)} · 自定目标</span>`}</button>`;
}
export function paintPapers({ catalog, study }) {
  document.querySelector("#learning-scope").hidden = true;
  const root = document.querySelector("#chapter-browser");
  root.hidden = false;
  document.querySelector(".workspace").hidden = true;
  document.querySelector(".course-toolbar").hidden = true;
  document.querySelector("#reading-tools").hidden = true;
  const papers = examPapers(catalog);
  document.querySelector("#heading").textContent = "历年真题";
  document.querySelector("#progress").textContent = papers.length + " 份真题";
  document.querySelector("#breadcrumb").innerHTML = "<span>历年真题</span>";
  document
    .querySelectorAll('[data-action="modules"],[data-action="status"]')
    .forEach((b) => b.classList.remove("active"));
  document.querySelector('[data-action="papers"]').classList.add("active");
  root.innerHTML = `<div class="course-summary"><div><span class="section-kicker">整卷练习</span><h2>按原卷顺序，一题一题练</h2><p>每轮自评独立保存，可随时回看</p></div><button data-action="practice-history">查看练习记录</button></div><div class="paper-grid">${papers
    .map((p) => {
      const run = study.papers?.[p.id],
        stats = completionProgress(p.questions, run?.marks || {}),
        rounds = (study.paperHistory?.[p.id]?.length || 0) + (run ? 1 : 0);
      return `<article class="paper-card"><div class="paper-card-top"><strong>${p.year}</strong><span>浙江大学 842</span></div><h3>信号系统与数字电路</h3><p>信号 ${p.questions.filter((q) => q.subject === "signals").length} 项 · 数电 ${p.questions.filter((q) => q.subject === "digital").length} 项</p><div class="chapter-progress"><span style="width:${stats.percent}%"></span></div><div class="paper-card-footer"><span>${run ? `第 ${rounds} 轮 · ${run.finished ? "已结束" : "已做"} ${stats.completed}/${stats.total}` : "尚未开始"}</span><button class="primary" data-action="open-paper" data-year="${p.id}">${run ? (run.finished ? "回看本轮" : "继续练习") : "开始整卷"} →</button></div>${rounds ? `<button class="text-button" data-action="practice-history" data-year="${p.id}">练习记录 · ${rounds} 轮</button>` : ""}</article>`;
    })
    .join("")}</div>`;
}
