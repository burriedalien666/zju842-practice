import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initialAnalysisState,
  normaliseAnalysisState,
  analysisRange,
  drillChapter,
  selectionFor,
} from "../src/analysis-state.js";
import { analyse } from "../src/exam-analysis.js";
// The view module includes CSS; controls are verified in the browser, pure transitions here.
const catalog = JSON.parse(
  fs.readFileSync(new URL("../public/catalog.json", import.meta.url)),
);
test("analysis starts with five recent years; all-years toggle and reset retain subject", () => {
  const initial = initialAnalysisState(catalog, "digital");
  assert.equal(initial.from, "2021");
  assert.equal(initial.to, "2025");
  assert.equal(initial.advanced, false);
  assert.equal(initial.extras, false);
  const all = analysisRange(catalog, initial, "all");
  assert.equal(all.from, "2009");
  assert.equal(all.subject, "digital");
  const recent = analysisRange(catalog, all, "recent");
  assert.equal(recent.from, "2021");
});
test("chapter drilldown preserves metric and years, removes hidden search and old selection", () => {
  const initial = {
    ...initialAnalysisState(catalog),
    metric: "points",
    search: "different",
    selected: "s1",
    year: "2021",
  };
  const next = drillChapter(initial, "s6");
  assert.equal(next.level, "topic");
  assert.equal(next.chapter, "s6");
  assert.equal(next.metric, "points");
  assert.equal(next.from, "2021");
  assert.equal(next.search, "");
  assert.equal(next.selected, "");
});
test("selection resolves single, multiple and zero-question cells without changing statistics", () => {
  const data = analyse(catalog, { subject: "signals" });
  assert.equal(selectionFor(data, "s1", "2025").cell.ids.length, 1);
  assert.ok(selectionFor(data, "s2", "2025").cell.ids.length > 1);
  assert.equal(selectionFor(data, "s1", "2016").cell.count, 0);
  assert.equal(selectionFor(data, "absent"), null);
  assert.equal(data.summary.count, 260);
});
test("restored old filters stay usable; invalid state cannot produce inconsistent scope", () => {
  const state = normaliseAnalysisState(catalog, {
    subject: "digital",
    from: "2025",
    to: "2021",
    chapter: "s6",
    metric: "invalid",
    level: "invalid",
    search: 34,
    scrollLeft: -8,
  });
  assert.equal(state.from, "2021");
  assert.equal(state.to, "2025");
  assert.equal(state.chapter, "");
  assert.equal(state.metric, "count");
  assert.equal(state.level, "chapter");
  assert.equal(state.search, "");
  assert.equal(state.scrollLeft, 0);
  const old = normaliseAnalysisState(catalog, {
    subject: "signals",
    from: "2009",
    to: "2025",
  });
  assert.equal(old.from, "2009");
});
