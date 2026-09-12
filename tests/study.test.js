import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyStudy,
  validateStudy,
  loadStudy,
  shuffled,
  STORAGE_KEY,
} from "../src/study.js";
const ids = new Set(["a", "b"]);
test("backup round trip and import validation", () => {
  const data = {
    version: 1,
    records: { a: { state: "review", star: true } },
    lists: [{ name: "复习", ids: ["a", "b"] }],
  };
  assert.deepEqual(validateStudy(JSON.parse(JSON.stringify(data)), ids), data);
  assert.throws(() =>
    validateStudy(
      {
        ...data,
        lists: [
          { name: "x", ids: [] },
          { name: "x", ids: [] },
        ],
      },
      ids,
    ),
  );
  assert.throws(() =>
    validateStudy(
      { ...data, records: { a: { state: "invalid", star: true } } },
      ids,
    ),
  );
  assert.deepEqual(
    validateStudy(
      { ...data, lists: [{ name: "x", ids: ["gone", "a", "a"] }] },
      ids,
    ).lists[0].ids,
    ["a"],
  );
});
test("old favorites and mastery migrate without changing question IDs", () => {
  const storage = {
    getItem: (key) =>
      key === STORAGE_KEY
        ? null
        : JSON.stringify({ a: { state: "done", star: true }, last: "a" }),
  };
  assert.deepEqual(loadStudy(storage, ids).records.a, {
    state: "done",
    star: true,
  });
  assert.deepEqual(loadStudy({ getItem: () => null }, ids), emptyStudy());
});
test("random practice preserves each question once", () => {
  const input = ["a", "b", "c", "d"];
  assert.deepEqual(shuffled(input, () => 0).sort(), [...input].sort());
  assert.deepEqual(input, ["a", "b", "c", "d"]);
});
