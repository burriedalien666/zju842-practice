import katex from "katex";

const tags = new Set([
  "svg",
  "title",
  "desc",
  "defs",
  "marker",
  "path",
  "g",
  "line",
  "text",
  "tspan",
  "rect",
  "circle",
  "ellipse",
  "polyline",
  "polygon",
]);
const attributes = new Set([
  "xmlns",
  "class",
  "viewBox",
  "role",
  "aria-labelledby",
  "id",
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "orient",
  "d",
  "x1",
  "y1",
  "x2",
  "y2",
  "marker-end",
  "marker-start",
  "x",
  "y",
  "text-anchor",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "dx",
  "dy",
  "baseline-shift",
  "font-size",
  "stroke-dasharray",
  "transform",
  "fill",
  "stroke",
  "dominant-baseline",
  "style",
  "stroke-width",
  "font-style",
]);
const fail = (message) => {
  throw new Error("结构化题面：" + message);
};
const object = (v) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  !["__proto__", "constructor", "prototype"].some((k) => Object.hasOwn(v, k));
const string = (v, max = 20000) => typeof v === "string" && v.length <= max;
const array = (v, max) => Array.isArray(v) && v.length <= max;
const name = (v) =>
  typeof v === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(v);

// Library packages may contain declarative SVG, never scripts, links, foreignObject, or arbitrary CSS.
export function validateSvg(root) {
  let count = 0;
  const ids = new Set(),
    references = [];
  function visit(n, depth) {
    if (++count > 20000 || depth > 30) fail("图形过大");
    if (typeof n === "string") {
      if (!string(n)) fail("图形文字过长");
      return;
    }
    if (
      !object(n) ||
      !tags.has(n.tag) ||
      !object(n.attrs) ||
      !array(n.children, 20000)
    )
      fail("图形节点不合法");
    for (const [k, v] of Object.entries(n.attrs)) {
      if (!attributes.has(k) || !string(v, 100000))
        fail("图形属性不支持：" + k);
      if (k === "xmlns" && v !== "http://www.w3.org/2000/svg")
        fail("SVG命名空间不合法");
      if (k === "id") {
        if (!name(v) || ids.has(v)) fail("图形ID重复或不合法");
        ids.add(v);
      }
      if (k === "aria-labelledby") {
        if (!v.split(/\s+/).every(name)) fail("图形标题引用不合法");
        references.push(...v.split(/\s+/));
      }
      if (k.startsWith("marker-")) {
        const m = v.match(/^url\(#([A-Za-z][A-Za-z0-9_-]{0,100})\)$/);
        if (!m) fail("仅允许图内标记引用");
        references.push(m[1]);
      }
      if (
        ["fill", "stroke"].includes(k) &&
        !/^(none|currentColor|transparent|white|black|#[a-fA-F0-9]{3,8}|var\(--(?:paper|ink)\))$/.test(
          v,
        )
      )
        fail("图形颜色不合法");
      if (k === "style")
        for (const declaration of v.split(";").filter((s) => s.trim())) {
          const [property, ...rest] = declaration.split(":");
          const value = rest.join(":").trim();
          if (
            ![
              "font-size",
              "font-family",
              "font-style",
              "font-weight",
              "stroke-width",
            ].includes(property.trim()) ||
            !value ||
            !/^[a-zA-Z0-9\s,%.'"-]+$/.test(value)
          )
            fail("图形样式不支持");
        }
    }
    n.children.forEach((c) => visit(c, depth + 1));
  }
  if (root?.tag !== "svg") fail("图形必须有SVG根节点");
  visit(root, 0);
  if (references.some((r) => !ids.has(r))) fail("图形引用不存在");
  if (
    !/^\s*-?[\d.]+\s+-?[\d.]+\s+[\d.]+\s+[\d.]+\s*$/.test(
      root.attrs.viewBox ?? "",
    )
  )
    fail("图形画布不合法");
  return root;
}

export function validateStructured(catalog) {
  const content = catalog.structured;
  if (content == null) return;
  if (
    !object(content) ||
    content.format !== 1 ||
    !array(content.groups, 2000) ||
    !object(content.figures) ||
    Object.keys(content.figures).length > 2000
  )
    fail("格式不支持");
  const version = String(catalog.requiresProgram ?? "")
    .split(".")
    .map(Number);
  if (
    version.length !== 3 ||
    version.some((v) => !Number.isSafeInteger(v) || v < 0) ||
    (version[0] === 0 &&
      (version[1] < 5 || (version[1] === 5 && version[2] < 8)))
  )
    fail("需要程序0.5.8或更新版本");
  const questions = new Map(catalog.questions.map((q) => [q.id, q])),
    used = new Set(),
    groupIds = new Set(),
    formulas = new Set();
  const text = (v) => {
    if (!string(v)) fail("文字过长或类型不正确");
  };
  const math = (v) => {
    text(v);
    if (formulas.has(v)) return;
    katex.renderToString(v, {
      throwOnError: true,
      strict: "error",
      trust: false,
      maxExpand: 1000,
    });
    formulas.add(v);
  };
  const parts = (items) => {
    if (!array(items, 200)) fail("段落不合法");
    for (const p of items) {
      if (!object(p) || Object.hasOwn(p, "text") === Object.hasOwn(p, "math"))
        fail("文字或公式片段不合法");
      p.math === undefined ? text(p.text) : math(p.math);
    }
  };
  const cell = (v) => {
    if (Array.isArray(v)) parts(v);
    else text(v);
  };
  for (const [name, svg] of Object.entries(content.figures)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(name)) fail("图名不合法");
    validateSvg(svg);
  }
  for (const g of content.groups) {
    if (
      !object(g) ||
      !string(g.id, 160) ||
      groupIds.has(g.id) ||
      !array(g.questionIds, 100) ||
      !g.questionIds.length ||
      !g.questionIds.includes(g.id) ||
      !array(g.originals, 20) ||
      !g.originals.length ||
      !array(g.blocks, 100) ||
      !g.blocks.length
    )
      fail("题组不合法");
    groupIds.add(g.id);
    for (const id of g.questionIds) {
      const q = questions.get(id);
      if (!q || used.has(id)) fail("原题编号缺失或重复：" + id);
      used.add(id);
      if (
        JSON.stringify(q.images.map((i) => i.src)) !==
        JSON.stringify(g.originals)
      )
        fail("题组原图映射不一致：" + id);
    }
    for (const k of ["shared", "sourceNote"])
      if (g[k] !== undefined) text(g[k]);
    if (g.sourcePending !== undefined && typeof g.sourcePending !== "boolean")
      fail("来源状态不合法");
    const taskBlocks = g.blocks.filter((b) => b.type === "tasks");
    for (const b of g.blocks) {
      if (!object(b)) fail("题面块不合法");
      if (b.caption !== undefined) text(b.caption);
      if (b.type === "paragraph") parts(b.parts);
      else if (b.type === "formula") {
        math(b.tex);
        if (b.narrowTex !== undefined) math(b.narrowTex);
        if (
          b.afterTask !== undefined &&
          (!Number.isInteger(b.afterTask) ||
            b.afterTask < 0 ||
            taskBlocks.length !== 1 ||
            b.afterTask >= taskBlocks[0].items.length)
        )
          fail("小问公式位置不合法");
      } else if (b.type === "figure") {
        if (!name(b.name) || !Object.hasOwn(content.figures, b.name))
          fail("缺少图形");
      } else if (b.type === "tasks") {
        if (!array(b.items, 100) || !b.items.length) fail("小问不合法");
        b.items.forEach(parts);
        if (b.labels !== undefined) {
          if (!array(b.labels, 100) || b.labels.length !== b.items.length)
            fail("小问标号不一致");
          b.labels.forEach(text);
        }
      } else if (
        ["table", "registerTable", "codeTable", "counter161Table"].includes(
          b.type,
        )
      ) {
        if (!array(b.rows, 500) || !b.rows.length) fail("表格不合法");
        for (const row of b.rows) {
          if (!array(row, 50)) fail("表格列过多");
          row.forEach(cell);
        }
        if (b.headers !== undefined) {
          if (!array(b.headers, 50)) fail("表头不合法");
          b.headers.forEach(cell);
        }
        if (b.codeHeader !== undefined) text(b.codeHeader);
        if (b.groups !== undefined) {
          if (!array(b.groups, 50)) fail("表头分组不合法");
          for (const t of b.groups) {
            if (
              !object(t) ||
              !Number.isInteger(t.columns) ||
              t.columns < 1 ||
              t.columns > 50
            )
              fail("表头跨列不合法");
            text(t.label);
          }
        }
      } else fail("不支持的题面块");
    }
  }
  return content;
}
