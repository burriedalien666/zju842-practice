import test from "node:test";
import assert from "node:assert/strict";
import {
  scheduleReview,
  isDue,
  dueIds,
  reviewSettings,
} from "../src/review.js";
import { validateStudy } from "../src/study.js";
test("wrong answer returns in ten minutes; success grows only after due time", () => {
  const now = 1789600000000;
  let r = scheduleReview(null, "wrong", {}, now);
  assert.equal(r.due, now + 600000);
  assert.equal(r.wrong, true);
  assert.equal(isDue({ review: r }, now), false);
  assert.equal(isDue({ review: r }, r.due), true);
  r = scheduleReview(r, "good", {}, r.due);
  assert.equal(r.stage, 1);
  assert.equal(r.wrong, false);
  const due = r.due;
  r = scheduleReview(r, "good", {}, r.last + 1000);
  assert.equal(r.stage, 1);
  assert.equal(r.due, due);
  r = scheduleReview(r, "good", {}, due);
  assert.equal(r.due, due + 3 * 86400000);
  r = scheduleReview(r, "wrong", {}, r.due);
  assert.equal(r.stage, 0);
  assert.equal(r.lapses, 2);
});
test("settings, backup and overdue order preserve review history", () => {
  assert.throws(() => reviewSettings({ intervals: [3, 1, 7] }));
  const a = scheduleReview(null, "good", { intervals: [2, 5, 10] }, 1000);
  assert.equal(a.due, 1000 + 2 * 86400000);
  const data = {
    version: 2,
    settings: { intervals: [2, 5, 10] },
    records: { a: { state: "review", star: true, review: a } },
    lists: [],
  };
  assert.deepEqual(
    validateStudy(JSON.parse(JSON.stringify(data)), new Set(["a"])),
    data,
  );
  assert.deepEqual(dueIds([{ id: "a" }], data.records, a.due), ["a"]);
  assert.equal(validateStudy(data, new Set()).records.a.review.due, a.due);
});
