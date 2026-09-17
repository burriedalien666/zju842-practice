import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  toggleMark,
  removeScopeMark,
  reconcileSelection,
  clearSearchFilters,
  scopeName,
} from "../src/interactions.js";
import { buildChapters, filterQuestions } from "../src/chapters.js";
import { scheduleReview, isDue, validateReview } from "../src/review.js";
const catalog = JSON.parse(
    fs.readFileSync(new URL("../public/catalog.json", import.meta.url)),
  ),
  chapters = buildChapters(catalog);
test("mark toggles remove only the requested mark and are reversible", () => {
  const row = {
    star: true,
    state: "review",
    review: scheduleReview(null, "wrong", {}, 1000),
  };
  assert.equal(toggleMark(row, "review").state, "");
  assert.equal(row.state, "review");
  assert.deepEqual(toggleMark(toggleMark(row, "review"), "review"), row);
  assert.equal(toggleMark(row, "star").star, false);
  assert.equal(toggleMark(row, "star").state, "review");
});
test("each personal view supports explicit removal without deleting history or answers", () => {
  for (const status of ["star", "review", "done", "due", "wrong"]) {
    const state = status === "done" ? "done" : "review";
    const row = {
      star: true,
      state,
      review: scheduleReview(null, "wrong", {}, 1000),
    };
    const data = {
      records: { q: structuredClone(row) },
      lists: [{ name: "练习", ids: ["q", "b"] }],
    };
    removeScopeMark(data, "q", { status });
    const after = data.records.q;
    if (status === "star") assert.equal(after.star, false);
    if (status === "review" || status === "done") assert.equal(after.state, "");
    if (status === "wrong") assert.equal(after.review.wrong, false);
    if (status === "due") {
      assert.equal(isDue(after, 999999999), false);
      assert.equal(validateReview(after.review).suspended, true);
      assert.equal(
        scheduleReview(after.review, "good", {}, 999999999).suspended,
        undefined,
      );
    }
    assert.equal(after.review.lapses, 1);
    assert.equal(after.review.attempts, 1);
    assert.equal(after.review.due, row.review.due);
  }
  const data = {
    records: {},
    lists: [
      { name: "练习", ids: ["q", "b"] },
      { name: "保留", ids: ["q"] },
    ],
  };
  removeScopeMark(data, "q", { list: "练习" });
  assert.deepEqual(
    data.lists.map((l) => l.ids),
    [["b"], ["q"]],
  );
});
test("removed item never stays in reader or random queue and last removal yields empty state", () => {
  assert.deepEqual(
    reconcileSelection(["a", "b", "c"], ["b", "c"], "a", ["c", "a", "b"]),
    { current: "b", queue: ["c", "b"] },
  );
  assert.deepEqual(reconcileSelection(["a"], [], "a", ["a"]), {
    current: null,
    queue: [],
  });
  assert.deepEqual(reconcileSelection(["a", "b"], ["a"], "b", []), {
    current: "a",
    queue: [],
  });
});
test("chapter selection and search reset preserve personal scope across all views", () => {
  const q = catalog.questions.find((q) => q.typeId === "A2.2");
  for (const status of ["star", "review", "done", "due", "wrong"]) {
    const records = {
      records: {
        [q.id]: {
          state: status === "done" ? "done" : "review",
          star: true,
          review: scheduleReview(null, "wrong", {}, 1000),
        },
      },
      lists: [],
    };
    const filters = {
      subject: "signals",
      chapter: "s5",
      status,
      year: "2025",
      source: "entrance",
      search: "none",
    };
    const reset = clearSearchFilters(filters);
    assert.equal(reset.status, status);
    assert.equal(reset.chapter, "s5");
    assert.equal(filterQuestions(catalog, reset, records, chapters).length, 0);
    assert.equal(
      filterQuestions(catalog, { ...reset, chapter: "s2" }, records, chapters)
        .length,
      1,
    );
    assert.ok(scopeName(filters));
  }
});
