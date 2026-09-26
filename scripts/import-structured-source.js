import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Author-only conversion of the reviewed labs. No lab JavaScript is shipped in a library pack.
const oldRoot = path.resolve(
  process.argv[2] || "../结构化样题-20260920/source/sample-lab",
);
const newRoot = path.resolve(
  process.argv[3] || "../结构化并行推进-20260924/汇总预览/sample-lab",
);
const load = async (root, file) => import(pathToFileURL(path.join(root, file)));
const { samples: old } = await load(oldRoot, "samples.js"),
  { samples: recent } = await load(newRoot, "samples.js");
const basic = await load(oldRoot, "diagrams-basic.js"),
  complex = await load(oldRoot, "diagrams-complex.js");
const oldNames = {
  convolution: "drawConvolution",
  rectangle2010: "drawRectangle2010",
  triangle: "drawTriangle",
  sineBursts: "drawSineBursts",
  discreteSystem: "drawDiscreteSystem",
  samplingSystem: "drawSamplingSystem",
  sampledSystem2010: "drawSampledSystem2010",
  spectra2010: "drawSpectra2010",
  edgeTiming2010: "drawEdgeTiming2010",
  responsePair2011: "drawResponsePair2011",
  complexBand2011: "drawComplexBand2011",
  gatedSystem2012: "drawGatedSystem2012",
  sampledDifferentiator2012: "drawSampledDifferentiator2012",
  oc: "drawOC",
  register: "drawRegister",
  register2011: "drawRegister",
  state: "drawState",
  circuit: "drawCircuit",
  controller2012: "drawController2012",
  counter161: "drawCounter161",
  schmittCounter2012: "drawSchmittCounter2012",
  hysteresis2012: "drawHysteresis2012",
  clockStorage2012: "drawClockStorage2012",
  cascade2013: "drawCascade2013",
  evenSequence2013: "drawEvenSequence2013",
  multipath2013: "drawMultipath2013",
  interface2013: "drawInterface2013",
  jk2013: "drawJK2013",
  decoder1382013: "drawDecoder1382013",
  states2013: "drawStates2013",
  timer5552013: "drawTimer5552013",
  register2013: "drawRegister",
};
const drawings = {
  ...Object.fromEntries(
    Object.entries(oldNames).map(([k, v]) => [k, basic[v] ?? complex[v]]),
  ),
  ...(await load(newRoot, "drawings.js")).drawings,
};
const catalog = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
const imageKey = (a) => [...a].sort().join("|");
const summary = JSON.parse(
  fs.readFileSync(path.join(newRoot, "../汇总情况.json"), "utf8"),
);
const pendingIds = new Set(
  [...summary.pending, ...summary.complex.pending].flatMap((s) => s.sourceIds),
);
const oldPending = new Set([9, 16, 17, 25, 40, 60, 69, 70, 72, 75, 76]);
old.forEach((s, i) => {
  if (oldPending.has(i + 1)) pendingIds.add(s.id);
});
pendingIds.add("2014|六|(1)"); // T04's source-layout question remains open.
const all = [...old, ...recent];
const groups = [],
  deferred = [];
for (const s of all) {
  const ids =
    s.sourceIds ??
    catalog.questions
      .filter(
        (q) =>
          imageKey(q.images.map((i) => path.basename(i.src))) ===
          imageKey(s.originals),
      )
      .map((q) => q.id);
  assert.ok(ids.includes(s.id));
  if (ids.some((id) => pendingIds.has(id))) {
    deferred.push({ id: s.id, questionIds: ids, reason: s.sourceNote });
  }
  groups.push({
    id: s.id,
    questionIds: ids,
    originals: s.originals.map((n) => "questions/" + n),
    blocks: s.blocks,
    ...(s.shared ? { shared: s.shared } : {}),
    ...(s.sourceNote ? { sourceNote: s.sourceNote } : {}),
    ...(ids.some((id) => pendingIds.has(id)) ? { sourcePending: true } : {}),
  });
}
assert.equal(groups.length, 250);
assert.equal(groups.flatMap((g) => g.questionIds).length, 469);
assert.equal(deferred.length, 43);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const figures = {},
  css = [];
try {
  const page = await browser.newPage();
  await page.setContent(
    "<style>" +
      fs.readFileSync(path.join(oldRoot, "style.css"), "utf8") +
      "\n" +
      fs.readFileSync(path.join(newRoot, "style.css"), "utf8") +
      "</style>",
  );
  for (const name of new Set(
    groups.flatMap((g) =>
      g.blocks.filter((b) => b.type === "figure").map((b) => b.name),
    ),
  )) {
    assert.equal(typeof drawings[name], "function", name);
    figures[name] = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      if (doc.querySelector("parsererror")) throw Error("Invalid SVG");
      const node = (e) =>
        e.nodeType === 3
          ? e.textContent
          : {
              tag: e.localName,
              attrs: Object.fromEntries(
                [...e.attributes]
                  .filter((a) => !a.name.startsWith("data-"))
                  .map((a) => [a.name, a.value]),
              ),
              children: [...e.childNodes]
                .filter(
                  (n) =>
                    n.nodeType === 1 ||
                    (n.nodeType === 3 && n.textContent.trim()),
                )
                .map(node),
            };
      return node(doc.documentElement);
    }, drawings[name]());
    if (name === "controller2012") {
      // The top source label needs a little font-metric headroom in the production reader.
      figures[name].attrs.viewBox = "0 0 700 430";
      const drawing = figures[name].children.find(
        (n) => n.tag === "g" && n.attrs.class === "drawing",
      );
      drawing.children = [
        {
          tag: "g",
          attrs: { transform: "translate(0 10)" },
          children: drawing.children,
        },
      ];
    }
  }
  // Keep only figure-specific layout rules; lab navigation and global theme rules must not leak into the app.
  css.push(
    await page.evaluate(() => {
      function keep(rules) {
        return [...rules]
          .map((r) => {
            if (r.type === CSSRule.MEDIA_RULE) {
              const children = keep(r.cssRules);
              return children
                ? "@media " + r.conditionText + "{" + children + "}"
                : "";
            }
            if (r.type !== CSSRule.STYLE_RULE) return "";
            const selectors = r.selectorText
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.startsWith(".structured-body figure["));
            return selectors.length
              ? selectors.map((s) => ".structured-question " + s).join(",") +
                  "{" +
                  r.style.cssText +
                  "}"
              : "";
          })
          .filter(Boolean)
          .join("\n");
      }
      return [...document.styleSheets].map((s) => keep(s.cssRules)).join("\n");
    }),
  );
} finally {
  await browser.close();
}
fs.mkdirSync("content", { recursive: true });
fs.writeFileSync(
  "content/structured.json",
  JSON.stringify({ format: 1, groups, figures }) + "\n",
);
fs.writeFileSync(
  "src/structured-figures.css",
  "/* Reviewed figure layouts, generated by import-structured-source.js. */\n" +
    css.join("\n") +
    "\n",
);
fs.mkdirSync(".test-artifacts/structured", { recursive: true });
fs.writeFileSync(
  ".test-artifacts/structured/deferred.json",
  JSON.stringify(deferred, null, 2),
);
const tags = new Set(),
  attrs = new Set(),
  styles = new Set();
function visit(n) {
  if (typeof n === "string") return;
  tags.add(n.tag);
  Object.keys(n.attrs).forEach((a) => attrs.add(a));
  if (n.attrs.style) styles.add(n.attrs.style);
  n.children.forEach(visit);
}
Object.values(figures).forEach(visit);
console.log(
  JSON.stringify(
    {
      groups: groups.length,
      records: 469,
      sourcePendingGroups: deferred.length,
      sourcePendingRecords: 96,
      figures: Object.keys(figures).length,
      bytes: fs.statSync("content/structured.json").size,
      tags: [...tags],
      attrs: [...attrs],
      styles: [...styles],
    },
    null,
    2,
  ),
);
