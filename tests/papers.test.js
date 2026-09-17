import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  examPapers,
  paperStats,
  countdown,
  validateExamDate,
} from "../src/papers.js";
import { validateStudy } from "../src/study.js";
const catalog = JSON.parse(
  fs.readFileSync(new URL("../public/catalog.json", import.meta.url)),
);
test("yearly papers include both subjects and keep original catalog order", () => {
  const papers = examPapers(catalog);
  assert.equal(papers.length, 17);
  assert.equal(papers[0].year, 2025);
  assert.equal(
    papers.reduce((n, p) => n + p.questions.length, 0),
    469,
  );
  for (const p of papers) {
    assert.equal(new Set(p.questions.map((q) => q.subject)).size, 2);
    assert.deepEqual(
      p.questions.map((q) => q.id),
      catalog.questions
        .filter((q) => q.year === p.year && q.sourceKind === "entrance")
        .map((q) => q.id),
    );
  }
  const extra = {
    ...catalog.questions[0],
    id: "final-one",
    sourceKind: "final",
  };
  assert.equal(
    examPapers({ ...catalog, questions: [...catalog.questions, extra] })[16]
      .questions.length,
    papers[16].questions.length,
  );
});
test("countdown handles unset, local calendar boundaries, today, passed and leap dates", () => {
  assert.equal(countdown("", new Date(2026, 8, 17)), null);
  assert.equal(countdown("2026-09-18", new Date(2026, 8, 17, 23, 59)), 1);
  assert.equal(countdown("2026-09-17", new Date(2026, 8, 17)), 0);
  assert.equal(countdown("2026-09-16", new Date(2026, 8, 17)), -1);
  assert.equal(validateExamDate("2028-02-29"), "2028-02-29");
  assert.throws(() => validateExamDate("2026-02-29"));
});
test("paper progress and countdown survive backup without confusing mastery with completion", () => {
  const p = examPapers(catalog)[0],
    id = p.questions[0].id;
  const run = { started: 1000, finished: null, marks: { [id]: "wrong" } };
  const data = {
    version: 1,
    records: {},
    lists: [],
    examDate: "2026-12-19",
    papers: { 2025: run },
  };
  assert.deepEqual(
    validateStudy(
      JSON.parse(JSON.stringify(data)),
      new Set(catalog.questions.map((q) => q.id)),
    ),
    data,
  );
  assert.deepEqual(paperStats(p, run), {
    total: 27,
    completed: 1,
    wrong: 1,
    good: 0,
  });
  assert.throws(() =>
    validateStudy(
      { ...data, papers: { 2025: { ...run, marks: { [id]: "fake" } } } },
      new Set(),
    ),
  );
});
