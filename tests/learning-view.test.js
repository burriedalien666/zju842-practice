import test from "node:test";
import assert from "node:assert/strict";
import { learningSummary, resumeQuestion } from "../src/learning-view.js";
import { validateStudy } from "../src/study.js";
test("learning summary counts actual due and unresolved wrong records", () => {
  const q = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const records = {
    a: { state: "done" },
    b: { review: { due: 10, wrong: true } },
    c: { review: { due: 200, wrong: false } },
  };
  assert.deepEqual(learningSummary(q, records, 100), {
    total: 3,
    done: 1,
    due: 1,
    wrong: 1,
  });
});
test("resume stays within the selected subject and survives record validation", () => {
  const q = { id: "a", subject: "signals" },
    catalog = { questions: [q] };
  assert.equal(resumeQuestion(catalog, "a", "signals"), q);
  assert.equal(resumeQuestion(catalog, "a", "digital"), null);
  assert.equal(resumeQuestion(catalog, "missing", "signals"), null);
  const data = { version: 1, records: {}, lists: [], lastQuestion: "a" };
  assert.deepEqual(validateStudy(data, new Set(["a"])), data);
  assert.throws(() =>
    validateStudy({ ...data, lastQuestion: {} }, new Set(["a"])),
  );
});
