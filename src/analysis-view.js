import { analyse, cellText } from "./exam-analysis.js";
import { escapeHtml as esc } from "./learning-content.js";
import {
  examYears,
  initialAnalysisState,
  analysisRange,
  drillChapter,
  selectionFor,
} from "./analysis-state.js";
import "./analysis.css";

const button = (key, value, label, active = false) =>
  `<button type="button" data-${key}="${esc(value)}" aria-pressed="${active}">${esc(label)}</button>`;
const options = (rows, value) =>
  rows
    .map(
      ([id, label]) =>
        `<option value="${esc(id)}" ${String(id) === String(value) ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
export function analysisControls(catalog, state) {
  const years = examYears(catalog),
    recent = analysisRange(catalog, state, "recent"),
    all = analysisRange(catalog, state, "all");
  const isRecent = state.from === recent.from && state.to === recent.to,
    isAll = state.from === all.from && state.to === all.to;
  const chapters = (catalog.curriculum?.chapters || []).filter(
    (c) => c.subject === state.subject,
  );
  const active =
    Number(state.metric !== "count") +
    Number(!!state.chapter) +
    Number(!!state.search) +
    Number(!isRecent && !isAll);
  return `<section class="analysis-controls" aria-label="考点分析筛选"><div class="analysis-quick">
    <div class="analysis-segment" role="group" aria-label="科目">${button("analysis-subject", "signals", "信号与系统", state.subject === "signals")}${button("analysis-subject", "digital", "数字电路", state.subject === "digital")}</div>
    <div class="analysis-segment" role="group" aria-label="查看层级">${button("analysis-level", "chapter", "按章节", state.level === "chapter")}${button("analysis-level", "topic", "按知识点", state.level === "topic")}</div>
    <div class="analysis-segment" role="group" aria-label="年份范围">${button("analysis-range", "recent", "近五年", isRecent)}${button("analysis-range", "all", "全部年份", isAll)}</div>
    <button id="analysis-reset" type="button" class="text-button">重置</button></div>
    <details id="analysis-advanced" ${state.advanced ? "open" : ""}><summary>更多筛选${active ? ` · ${active}项已生效` : ""}</summary>
      <form id="analysis-filter-form" class="analysis-filter-form"><label>指标<select name="metric">${options(
        [
          ["count", "涉及题量"],
          ["presence", "是否考察"],
          ["points", "已核实分值"],
        ],
        state.metric,
      )}</select></label>
      <label>起始年<select name="from">${options(
        years.map((y) => [y, y]),
        state.from,
      )}</select></label><label>结束年<select name="to">${options(
        years.map((y) => [y, y]),
        state.to,
      )}</select></label>
      <label>章节<select name="chapter">${options([["", "全部章节"], ...chapters.map((c) => [c.id, c.title])], state.chapter)}</select></label>
      <label>查找名称<input name="search" maxlength="100" value="${esc(state.search)}" placeholder="搜索章节或知识点"></label><button class="primary">应用筛选</button></form>
    </details></section>`;
}

export function paintAnalysis({
  catalog,
  state,
  change,
  openQuestion,
  dialog,
  remember = () => {},
}) {
  const root = document.querySelector("#chapter-browser");
  for (const selector of [
    ".workspace",
    ".course-toolbar",
    "#reading-tools",
    "#learning-scope",
  ])
    document.querySelector(selector).hidden = true;
  root.hidden = false;
  document.querySelector("#heading").textContent = "历年考点分析";
  document.querySelector("#breadcrumb").innerHTML =
    '<button data-action="modules">章节学习</button><span>/ 历年考点分析</span>';
  if (!catalog.curriculum) {
    root.innerHTML =
      '<div class="empty"><h2>请先更新题库</h2><p>考点分析需要新版知识点标注；程序更新不会自动替换题库。</p><button data-action="local-updates">打开更新中心</button></div>';
    return;
  }
  const data = analyse(catalog, state),
    total = data.summary;
  const chapters = catalog.curriculum.chapters.filter(
    (c) => c.subject === state.subject,
  );
  const chapter = chapters.find((c) => c.id === state.chapter);
  document.querySelector("#chapter-shortcuts").innerHTML =
    `<details><summary>章节练习目录</summary><div>${chapters.map((c) => `<button data-action="chapter" data-id="${esc(c.id)}"><span class="shortcut-number">${esc(c.number)}</span><span>${esc(c.title)}</span></button>`).join("")}</div></details>`;
  const rows = data.rows.filter(
    (r) =>
      (!state.chapter ||
        r.id === state.chapter ||
        r.chapter === state.chapter) &&
      (!state.search ||
        r.title.toLowerCase().includes(state.search.toLowerCase())),
  );
  const selected = selectionFor(data, state.selected, state.year);
  const points = (cell) =>
    !cell.count
      ? "无题目"
      : cell.points == null
        ? "分值未标注"
        : `${cell.points}分${cell.scored < cell.count ? "（部分已知）" : ""}`;
  const maximum = Math.max(
    1,
    ...rows.flatMap((r) =>
      r.cells.map((c) => (state.metric === "points" ? c.points || 0 : c.count)),
    ),
  );
  const metricLabel = {
    count: "题量",
    presence: "是否考察",
    points: "已核实分值",
  }[state.metric];
  const filters = [
    chapter?.title,
    state.search ? `搜索：${state.search}` : "",
    state.metric !== "count" ? metricLabel : "",
  ].filter(Boolean);
  root.innerHTML = `<div class="analysis-summary"><span>${state.from}—${state.to} · 本学科${total.count}题</span><button data-action="classification-source" class="text-button">统计说明</button></div>
    ${analysisControls(catalog, state)}
    ${filters.length ? `<div class="analysis-filter-tags">${filters.map((f) => `<span>${esc(f)}</span>`).join("")}<button id="analysis-clear-extra" class="text-button">清除附加筛选</button></div>` : ""}
    <div class="analysis-breadcrumb">${chapter ? `<button id="analysis-back-chapters" class="text-button">← 全部章节</button><strong>${esc(chapter.title)}</strong>` : ""}<span>${state.level === "chapter" ? "点章节名展开知识点；点数字看题。" : "点知识点名称看全部相关题；点数字看当年题。"}</span></div>
    ${state.metric === "points" ? `<p class="analysis-score-note">本学科所选年份仅${total.scored}/${total.count}题有分值。“—”未标注，“*”部分已知；不能把缺失当作0分。</p>` : ""}
    ${state.level === "topic" ? '<p class="analysis-scope-note">综合题可涉及多个知识点，各行题量与分值不可直接相加。</p>' : ""}
    <div class="analysis-table-wrap" tabindex="0" aria-label="历年考点热力图"><table class="analysis-table"><caption>${state.level === "topic" ? "知识点" : "章节"} × 年份 · ${metricLabel}<span class="heat-legend">${state.metric === "presence" ? "● 考察过" : "浅 → 深：少 → 多"}</span></caption>
      <thead><tr><th scope="col">${state.level === "topic" ? "知识点" : "章节"}</th>${data.years.map((y) => `<th scope="col">${y}</th>`).join("")}<th scope="col">考察年数</th><th scope="col">总题量</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><th scope="row"><button data-analysis-row="${esc(r.id)}" title="${state.level === "chapter" ? "展开知识点" : "查看相关题目"}">${esc(r.title)} ${state.level === "chapter" ? "›" : ""}</button></th>${r.cells
              .map((c) => {
                const value =
                  state.metric === "points" ? c.points || 0 : c.count;
                const shade = !c.count
                  ? 0
                  : state.metric === "presence"
                    ? 4
                    : state.metric === "points" && c.points == null
                      ? "unknown"
                      : Math.max(1, Math.ceil((value / maximum) * 4));
                const chosen =
                  state.selected === r.id && state.year === String(c.year);
                return `<td><button class="heat-cell heat-${shade}${chosen ? " selected" : ""}" data-analysis-cell="${esc(r.id)}" data-year="${c.year}" ${c.count ? "" : "disabled"} aria-label="${esc(r.title)} ${c.year}年 ${c.count}题，${points(c)}" title="${c.count}题，${points(c)}">${cellText(c, state.metric)}</button></td>`;
              })
              .join(
                "",
              )}<td>${r.years}/${data.years.length}</td><td><button data-analysis-total="${esc(r.id)}" ${r.count ? "" : "disabled"} aria-label="查看${esc(r.title)}全部${r.count}题">${r.count}</button></td></tr>`,
        )
        .join("")}</tbody></table>
      ${!rows.length ? '<div class="empty"><p>没有匹配的考点。</p><button id="analysis-empty-reset">清除章节与搜索条件</button></div>' : ""}</div>
    ${selected?.cell.count ? `<div class="analysis-recent-selection"><span>上次查看：${esc(selected.row.title)}${state.year ? " · " + esc(state.year) + "年" : ""}</span><button id="analysis-open-selection">查看${selected.cell.count}题</button></div>` : ""}
    <details id="analysis-extras" class="analysis-extras" ${state.extras ? "open" : ""}><summary>排行与趋势</summary><div class="analysis-extras-body"></div></details>
    <p class="analysis-footnote">仅统计已收录真题；历史考频不预测未来命题。${data.unclassified ? ` ${data.unclassified}题待归类。` : ""}</p>`;

  const table = root.querySelector(".analysis-table-wrap");
  table.scrollLeft = state.scrollLeft || 0;
  table.scrollTop = state.scrollTop || 0;
  table.onscroll = () => {
    state.scrollLeft = table.scrollLeft;
    state.scrollTop = table.scrollTop;
  };
  const update = (next) =>
    change({
      ...next,
      selected: "",
      year: "",
      scrollLeft: 0,
      scrollTop: 0,
      scrollY: 0,
    });
  const finish = (ids, id) => {
    document.querySelector("#dialog")?.close();
    openQuestion(id, ids);
  };
  function showSelection(id, year = "") {
    const selection = selectionFor(data, id, year);
    if (!selection?.cell.count) return;
    const next = {
      ...state,
      selected: id,
      year,
      scrollLeft: table.scrollLeft,
      scrollTop: table.scrollTop,
      scrollY: window.scrollY,
    };
    change(next);
    const { row, cell } = selection;
    if (cell.ids.length === 1) {
      finish(cell.ids, cell.ids[0]);
      return;
    }
    dialog(
      `${row.title}${year ? " · " + year + "年" : ""}`,
      `<section class="analysis-picker"><div class="analysis-picker-head"><span>${cell.count}题 · ${points(cell)}</span><button id="analysis-start-set" class="primary">开始练这${cell.count}题</button></div><div class="analysis-question-grid">${cell.ids
        .map((id) => {
          const q = catalog.questions.find((q) => q.id === id);
          return `<button data-picker-question="${esc(id)}"><strong>${q.year} · ${esc(q.number)}</strong><span>${esc(q.title)}</span>${q.score ? `<small>${q.score.points}分</small>` : ""}</button>`;
        })
        .join("")}</div></section>`,
      true,
    );
    document.querySelector("#analysis-start-set").onclick = () =>
      finish(cell.ids, cell.ids[0]);
    for (const b of document.querySelectorAll("[data-picker-question]"))
      b.onclick = () => finish(cell.ids, b.dataset.pickerQuestion);
  }
  for (const b of root.querySelectorAll("[data-analysis-subject]"))
    b.onclick = () =>
      update({
        ...state,
        subject: b.dataset.analysisSubject,
        chapter: "",
        search: "",
      });
  for (const b of root.querySelectorAll("[data-analysis-level]"))
    b.onclick = () =>
      update({
        ...state,
        level: b.dataset.analysisLevel,
        chapter: "",
        search: "",
      });
  for (const b of root.querySelectorAll("[data-analysis-range]"))
    b.onclick = () =>
      update(analysisRange(catalog, state, b.dataset.analysisRange));
  root.querySelector("#analysis-reset").onclick = () =>
    change(initialAnalysisState(catalog, state.subject));
  root.querySelector("#analysis-advanced").ontoggle = (event) => {
    state.advanced = event.target.open;
    remember();
  };
  root.querySelector("#analysis-filter-form").onsubmit = (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.target));
    if (Number(fields.from) > Number(fields.to))
      [fields.from, fields.to] = [fields.to, fields.from];
    update({
      ...state,
      ...fields,
      search: fields.search.trim(),
      advanced: false,
    });
  };
  const resetExtra = () =>
    update({ ...state, metric: "count", chapter: "", search: "" });
  if (root.querySelector("#analysis-clear-extra"))
    root.querySelector("#analysis-clear-extra").onclick = resetExtra;
  if (root.querySelector("#analysis-empty-reset"))
    root.querySelector("#analysis-empty-reset").onclick = () =>
      update({ ...state, chapter: "", search: "" });
  if (root.querySelector("#analysis-back-chapters"))
    root.querySelector("#analysis-back-chapters").onclick = () =>
      update({ ...state, level: "chapter", chapter: "", search: "" });
  for (const b of root.querySelectorAll("[data-analysis-row]"))
    b.onclick = () =>
      state.level === "chapter"
        ? update(drillChapter(state, b.dataset.analysisRow))
        : showSelection(b.dataset.analysisRow);
  for (const b of root.querySelectorAll("[data-analysis-cell]"))
    b.onclick = () => showSelection(b.dataset.analysisCell, b.dataset.year);
  for (const b of root.querySelectorAll("[data-analysis-total]"))
    b.onclick = () => showSelection(b.dataset.analysisTotal);
  if (root.querySelector("#analysis-open-selection"))
    root.querySelector("#analysis-open-selection").onclick = () =>
      showSelection(state.selected, state.year);
  function renderExtras() {
    const target = root.querySelector(".analysis-extras-body");
    if (target.childElementCount) return;
    const trend = selected?.row.cells || data.yearTotals;
    const max = Math.max(
      1,
      ...trend.map((c) =>
        state.metric === "points" ? c.points || 0 : c.count,
      ),
    );
    target.innerHTML = `<section class="analysis-trend"><h3>${esc(selected?.row.title || "本学科")} · ${state.metric === "points" ? "已核实分值" : "历年题量"}</h3><div class="trend-bars">${trend
      .map((c) => {
        const v = state.metric === "points" ? c.points : c.count;
        return `<div class="trend-column"><span>${state.metric === "points" ? cellText(c, "points") : c.count}</span><div class="trend-track"><i style="height:${v == null ? 0 : (v / max) * 100}%"></i></div><small>${c.year}</small></div>`;
      })
      .join(
        "",
      )}</div></section><section class="analysis-ranking"><h3>考点排行 · 按${state.metric === "points" ? "已核实分值" : "题量"}</h3>${
      [...rows]
        .filter(
          (r) => r.count && (state.metric !== "points" || r.points != null),
        )
        .sort((a, b) =>
          state.metric === "points" ? b.points - a.points : b.count - a.count,
        )
        .slice(0, 10)
        .map(
          (r, i) =>
            `<button data-rank="${esc(r.id)}"><span>${i + 1}. ${esc(r.title)}</span><span>${r.count}题 · ${r.years}年${state.metric === "points" ? " · " + points(r) : ""}</span></button>`,
        )
        .join("") || "<p>当前范围没有已标注数据。</p>"
    }</section>`;
    for (const b of target.querySelectorAll("[data-rank]"))
      b.onclick = () => showSelection(b.dataset.rank);
  }
  root.querySelector("#analysis-extras").ontoggle = (event) => {
    state.extras = event.target.open;
    if (state.extras) renderExtras();
    remember();
  };
  if (state.extras) renderExtras();
}
