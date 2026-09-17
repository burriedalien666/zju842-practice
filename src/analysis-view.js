import { analyse, cellText } from "./exam-analysis.js";
import { escapeHtml as esc } from "./learning-content.js";
import "./analysis.css";

export function paintAnalysis({ catalog, state, change, openQuestion }) {
  const root = document.querySelector("#chapter-browser");
  document.querySelector(".workspace").hidden = true;
  document.querySelector(".course-toolbar").hidden = true;
  document.querySelector("#reading-tools").hidden = true;
  document.querySelector("#learning-scope").hidden = true;
  root.hidden = false;
  document.querySelector("#heading").textContent = "历年考点分析";
  document.querySelector("#breadcrumb").innerHTML =
    '<button data-action="modules">章节学习</button><span>/ 历年考点分析</span>';
  if (!catalog.curriculum) {
    root.innerHTML =
      '<div class="empty"><h2>请先更新题库</h2><p>考点分析需要包含知识点标注的新版题库；更新程序不会自动替换题库。</p><button data-action="local-updates">打开更新中心</button></div>';
    return;
  }
  const data = analyse(catalog, state);
  const allYears = [
    ...new Set(
      catalog.questions
        .filter((q) => q.sourceKind === "entrance")
        .map((q) => q.year),
    ),
  ].sort((a, b) => a - b);
  const chapterSet = catalog.curriculum.chapters.filter(
    (c) => c.subject === state.subject,
  );
  const shortcuts = document.querySelector("#chapter-shortcuts");
  shortcuts.innerHTML = `<details open><summary>本学科目录</summary><div>${chapterSet.map((c) => `<button data-action="chapter" data-id="${esc(c.id)}"><span class="shortcut-number">${esc(c.number)}</span><span>${esc(c.title)}</span></button>`).join("")}</div></details>`;
  const rows = data.rows.filter(
    (r) =>
      (!state.chapter ||
        r.id === state.chapter ||
        r.chapter === state.chapter) &&
      (!state.search ||
        r.title.toLowerCase().includes(state.search.toLowerCase())),
  );
  const selected = rows.find((r) => r.id === state.selected);
  const chosen = selected
    ? state.year
      ? selected.cells.find((c) => c.year === Number(state.year))
      : selected
    : null;
  const units =
    state.metric === "points"
      ? "分"
      : state.metric === "presence"
        ? "考察与否"
        : "题";
  const values = rows.flatMap((r) =>
    r.cells.map((c) => (state.metric === "points" ? c.points || 0 : c.count)),
  );
  const max = Math.max(1, ...values);
  const total = data.summary;
  const scoreLabel = (r) =>
    !r.count
      ? "无题目"
      : r.points == null
        ? "未标注"
        : `${r.points}分${r.scored < r.count ? "（部分）" : ""}`;
  const opts = (values, value) =>
    values
      .map(
        ([id, title]) =>
          `<option value="${esc(id)}" ${String(value) === String(id) ? "selected" : ""}>${esc(title)}</option>`,
      )
      .join("");
  root.innerHTML = `<div class="analysis-intro"><div><span class="section-kicker">${data.years.length ? data.years[0] + "—" + data.years.at(-1) : "暂无年份"} · 真题考查分布</span><h2>看清考点，再开始练习</h2><p>按章节或知识点回看历年题目；点击格子直接查看对应真题。</p></div><button data-action="classification-source">分类依据与统计说明</button></div>
    <div class="analysis-stats"><div><strong>${total.count}</strong><span>去重题目 / 小题</span></div><div><strong>${data.years.length}</strong><span>收录年份</span></div><div><strong>${data.coveredTopics}</strong><span>已涉及知识点</span></div><div><strong>${total.scored}/${total.count}</strong><span>分值已标注 · ${total.points ?? "—"}分</span></div></div>
    <section class="analysis-controls" aria-label="考点分析筛选"><label>科目<select data-analysis="subject">${opts(
      [
        ["signals", "信号与系统"],
        ["digital", "数字电路"],
      ],
      state.subject,
    )}</select></label>
    <label>维度<select data-analysis="level">${opts(
      [
        ["chapter", "章节"],
        ["topic", "具体知识点"],
      ],
      state.level,
    )}</select></label>
    <label>指标<select data-analysis="metric">${opts(
      [
        ["count", "涉及题量"],
        ["presence", "是否考察"],
        ["points", "已核实分值"],
      ],
      state.metric,
    )}</select></label>
    <label>起始年<select data-analysis="from">${opts(
      allYears.map((y) => [y, y]),
      state.from,
    )}</select></label><label>结束年<select data-analysis="to">${opts(
      allYears.map((y) => [y, y]),
      state.to,
    )}</select></label>
    <label>章节<select data-analysis="chapter">${opts([["", "全部章节"], ...chapterSet.map((c) => [c.id, c.title])], state.chapter)}</select></label>
    <label>查找考点<input data-analysis="search" value="${esc(state.search)}" placeholder="输入知识点名称"></label><button id="analysis-recent">近五年</button><button id="analysis-reset">重置</button></section>
    <p class="analysis-note">${state.level === "topic" ? "同一道题可涉及多个知识点，行间题量和分值不可相加；分值表示涉及题目的分值，不是该知识点的独立得分。" : "章节采用主章节归属，同一题号只计一次；综合题的其他知识点在“具体知识点”维度查看。"} 分值“—”表示未标注，“*”表示仅部分题有分值。缺失不按0分计。</p>
    <div class="analysis-table-wrap" tabindex="0" aria-label="可横向滚动的历年考点热力图"><table class="analysis-table"><caption>${state.level === "topic" ? "知识点" : "章节"} × 年份 · ${units}（浅色少，深色多）</caption><thead><tr><th scope="col">${state.level === "topic" ? "知识点" : "章节"}</th>${data.years.map((y) => `<th scope="col">${y}</th>`).join("")}<th scope="col">考察年数</th><th scope="col">累计题量</th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr><th scope="row"><button data-row="${esc(r.id)}">${esc(r.title)}</button></th>${r.cells
            .map((c) => {
              const value = state.metric === "points" ? c.points || 0 : c.count;
              const shade =
                c.count === 0
                  ? 0
                  : state.metric === "presence"
                    ? 4
                    : state.metric === "points" && c.points === null
                      ? "unknown"
                      : Math.max(1, Math.ceil((value / max) * 4));
              return `<td><button class="heat-cell heat-${shade}" data-row="${esc(r.id)}" data-year="${c.year}" aria-label="${esc(r.title)} ${c.year}年 ${c.count}题，${scoreLabel(c)}" title="${c.count}题，${scoreLabel(c)}">${cellText(c, state.metric)}</button></td>`;
            })
            .join(
              "",
            )}<td>${r.years}/${data.years.length}</td><td>${r.count}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table>${!rows.length ? '<p class="empty">没有符合筛选的知识点。请修改章节或搜索词。</p>' : ""}</div>
    <section class="analysis-detail" aria-live="polite"><h3>${selected ? esc(selected.title) + (state.year ? " · " + esc(state.year) + "年" : " · 所选年份") : "点选格子，查看对应真题"}</h3>${
      chosen
        ? `<p>${chosen.count}道题 · ${scoreLabel(chosen)}</p><div class="analysis-question-grid">${
            chosen.ids
              .map((id) => {
                const q = catalog.questions.find((q) => q.id === id);
                return `<button data-analysis-question="${esc(id)}"><strong>${q.year} · ${esc(q.number)}</strong><span>${esc(q.title)}</span><small>${q.score ? q.score.points + "分 · PDF第" + q.score.sourcePage + "页" : "分值未标注"}</small></button>`;
              })
              .join("") || "<p>该年份未收录此考点题目，不等同于未来不会考。</p>"
          }</div>`
        : '<p class="muted">可以点击行标题查看这个考点在所选时段的全部题目。</p>'
    }</section>
    <section class="analysis-ranking"><h3>所选范围考点排行 · 按${state.metric === "points" ? "已核实分值" : "涉及题量"}排序</h3>${
      [...rows]
        .filter(
          (r) => r.count > 0 && (state.metric !== "points" || r.points != null),
        )
        .sort((a, b) =>
          state.metric === "points" ? b.points - a.points : b.count - a.count,
        )
        .slice(0, 10)
        .map(
          (r, i) =>
            `<button data-row="${esc(r.id)}"><span>${i + 1}. ${esc(r.title)}</span><span>${r.count}题 · ${r.years}年 · ${scoreLabel(r)}</span></button>`,
        )
        .join("") || "<p>当前范围没有已标注数据。</p>"
    }</section>
    <p class="muted small">${esc(catalog.curriculum.scoreNote)} ${data.unclassified ? `另有${data.unclassified}道题待归类。` : ""}历史考频不代表未来命题概率。</p>`;
  const trend = selected?.cells || data.yearTotals;
  const trendMax = Math.max(
    1,
    ...trend.map((c) => (state.metric === "points" ? c.points || 0 : c.count)),
  );
  root.querySelector(".analysis-ranking").insertAdjacentHTML(
    "beforebegin",
    `<section class="analysis-trend"><h3>${esc(selected?.title || "本学科")} · 历年${state.metric === "points" ? "已核实分值" : "题量"}</h3><div class="trend-bars">${trend
      .map((c) => {
        const v = state.metric === "points" ? c.points : c.count;
        return `<div class="trend-column"><span>${state.metric === "points" ? cellText(c, "points") : c.count}</span><div class="trend-track"><i style="height:${v == null ? 0 : (v / trendMax) * 100}%"></i></div><small>${c.year}</small></div>`;
      })
      .join(
        "",
      )}</div><p class="muted small">${selected ? "点选其他行或格子可切换考点。" : "学科总量按题号去重，不是知识点行的相加结果。"} 未标注分值仅显示“—”，不据此作升降或命题概率判断。</p></section>`,
  );
  for (const el of root.querySelectorAll("[data-analysis]"))
    el.onchange = () => {
      const next = {
        ...state,
        [el.dataset.analysis]: el.value,
        selected: "",
        year: "",
      };
      if (el.dataset.analysis === "subject") next.chapter = "";
      if (Number(next.from) > Number(next.to)) {
        if (el.dataset.analysis === "from") next.to = next.from;
        else next.from = next.to;
      }
      change(next);
    };
  root.querySelector("#analysis-recent").onclick = () =>
    change({
      ...state,
      from: String(allYears.at(-5) || allYears[0]),
      to: String(allYears.at(-1)),
      selected: "",
      year: "",
    });
  root.querySelector("#analysis-reset").onclick = () =>
    change({
      subject: state.subject,
      from: String(allYears[0]),
      to: String(allYears.at(-1)),
      level: "chapter",
      metric: "count",
      chapter: "",
      search: "",
      selected: "",
      year: "",
    });
  for (const el of root.querySelectorAll("[data-row]"))
    el.onclick = () => {
      change({
        ...state,
        selected: el.dataset.row,
        year: el.dataset.year || "",
      });
      document
        .querySelector(".analysis-detail")
        .scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  for (const el of root.querySelectorAll("[data-analysis-question]"))
    el.onclick = () => openQuestion(el.dataset.analysisQuestion, chosen.ids);
}
