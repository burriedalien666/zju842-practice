import katex from "katex";
import { escapeHtml as esc } from "./learning-content.js";

export const mathMarkup = (tex, display = false) =>
  katex.renderToString(tex, {
    displayMode: display,
    throwOnError: true,
    trust: false,
    output: "htmlAndMathml",
    strict: "error",
    maxExpand: 1000,
  });
const parts = (items) =>
  items
    .map((v) => (v.math !== undefined ? mathMarkup(v.math) : esc(v.text)))
    .join("");
const formula = (b) =>
  `<div class="formula-block"${b.narrowTex ? ` data-full-tex="${esc(b.tex)}" data-narrow-tex="${esc(b.narrowTex)}"` : ""}>${mathMarkup(b.tex, true)}</div>`;
let serial = 0;
export function svgMarkup(tree, prefix = "figure-" + ++serial + "-") {
  if (typeof tree === "string") return esc(tree);
  const attrs = Object.entries(tree.attrs)
    .map(([k, v]) => {
      if (k === "id") v = prefix + v;
      if (k === "aria-labelledby")
        v = v
          .split(/\s+/)
          .map((id) => prefix + id)
          .join(" ");
      if (k === "marker-end" || k === "marker-start")
        v = v.replace("url(#", "url(#" + prefix);
      return ` ${k}="${esc(v)}"`;
    })
    .join("");
  return `<${tree.tag}${attrs}>${tree.children.map((c) => svgMarkup(c, prefix)).join("")}</${tree.tag}>`;
}
function table(b) {
  const cell = (v) => (Array.isArray(v) ? parts(v) : esc(v ?? ""));
  let header = "",
    caption = b.caption ?? "",
    cls = "";
  if (b.type === "registerTable") {
    caption ||= "表二　74LS194逻辑功能";
    header =
      '<tr><th colspan="4" scope="colgroup">输入</th><th rowspan="3" scope="col">功能</th><th colspan="4" scope="colgroup">输出</th></tr><tr><th rowspan="2" scope="col">CR</th><th colspan="2" scope="colgroup">方式控制</th><th rowspan="2" scope="col">CP</th><th rowspan="2" scope="col">Q₀</th><th rowspan="2" scope="col">Q₁</th><th rowspan="2" scope="col">Q₂</th><th rowspan="2" scope="col">Q₃</th></tr><tr><th scope="col">M₁</th><th scope="col">M₀</th></tr>';
  } else if (b.type === "codeTable") {
    caption ||= "表一　2421码";
    cls = " code-table";
    header = `<tr><th>十进制</th><th>${esc(b.codeHeader ?? "Q₃Q₂Q₁Q₀")}</th></tr>`;
  } else if (b.type === "counter161Table") {
    caption = "表一　74LS161功能表";
    header =
      '<tr><th>CP</th><th><span class="overline">R<sub>D</sub></span></th><th><span class="overline">LD</span></th><th>EP</th><th>ET</th><th>工作状态</th></tr>';
  } else if (b.headers) {
    header =
      (b.groups
        ? "<tr>" +
          b.groups
            .map(
              (g) =>
                `<th colspan="${g.columns}" scope="colgroup">${esc(g.label)}</th>`,
            )
            .join("") +
          "</tr>"
        : "") +
      "<tr>" +
      b.headers.map((v) => "<th>" + cell(v) + "</th>").join("") +
      "</tr>";
  }
  return `<div class="table-wrap"><table class="function-table${cls}">${caption ? "<caption>" + esc(caption) + "</caption>" : ""}${header ? "<thead>" + header + "</thead>" : ""}<tbody>${b.rows.map((row) => "<tr>" + row.map((v, i) => "<td" + (b.type === "codeTable" && i === 1 ? ' class="code-bits"' : "") + ">" + cell(v) + "</td>").join("") + "</tr>").join("")}</tbody></table></div>`;
}
const captions = {
  oc: "图1",
  register: "图2",
  rectangle2010: "图2",
  sampledSystem2010: "图3(a)",
  spectra2010: "图3(b)",
  edgeTiming2010: "图5",
  state: "图6",
  schmittCounter2012: "图(a)",
  hysteresis2012: "图(b)",
  feedback2010: "图7",
};
export function structuredBody(group, figures) {
  return group.blocks
    .map((b) => {
      if (b.type === "paragraph") return "<p>" + parts(b.parts) + "</p>";
      if (b.type === "formula")
        return b.afterTask === undefined ? formula(b) : "";
      if (b.type === "figure") {
        const caption = b.caption ?? captions[b.name];
        return `<figure data-figure="${esc(b.name)}">${svgMarkup(figures[b.name])}${caption ? "<figcaption>" + esc(caption) + "</figcaption>" : ""}</figure>`;
      }
      if (b.type === "tasks")
        return `<ol class="tasks${b.labels ? " source-labels" : ""}">${b.items
          .map(
            (item, i) =>
              `<li${b.labels ? ` data-label="${esc(b.labels[i])}"` : ""}>${parts(item)}${group.blocks
                .filter((f) => f.type === "formula" && f.afterTask === i)
                .map(formula)
                .join("")}</li>`,
          )
          .join("")}</ol>`;
      return table(b);
    })
    .join("");
}
export function originalQuestionMarkup(q) {
  return `<div class="question-images">${q.images.map((im) => `<button type="button" class="image-button" data-action="zoom" data-src="/${esc(im.src)}" aria-label="查看完整题图"><img src="/${esc(im.src)}" width="${im.width}" height="${im.height}" alt="${esc(q.year + "年 " + q.number + " 原题")}" loading="lazy"></button>${im.caption ? '<p class="muted small">' + esc(im.caption) + "</p>" : ""}`).join("")}</div>`;
}
export function questionBodyMarkup(catalog, q) {
  const group = catalog.structured?.groups.find((g) =>
    g.questionIds.includes(q.id),
  );
  if (!group) return originalQuestionMarkup(q);
  try {
    return `<section class="structured-question" data-structured-group="${esc(group.id)}"><div class="structured-body">${structuredBody(group, catalog.structured.figures)}</div><details class="structured-original"><summary>查看原图</summary>${originalQuestionMarkup(q)}${group.questionIds.length > 1 ? '<p class="shared-note">共用题面完整保留；收藏、自评、答案和视频对应页面顶部的当前题号。</p>' : ""}</details></section>`;
  } catch {
    return (
      '<p class="source-note">结构化题面暂时无法显示，已切回原图。</p>' +
      originalQuestionMarkup(q)
    );
  }
}
