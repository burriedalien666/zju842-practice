import test from "node:test";
import assert from "node:assert/strict";
import {
  completionProgress,
  recordProgress,
  questionRating,
} from "../src/learning-progress.js";

const questionsOf = (total) =>
  Array.from({ length: total }, (_, i) => ({ id: `q${i}` }));

test("three different self-ratings among twenty-three questions are 13 percent complete", () => {
  assert.deepEqual(
    completionProgress(questionsOf(23), {
      q0: "good",
      q1: "hard",
      q2: "wrong",
      outside: "good",
    }),
    {
      total: 23,
      good: 1,
      hard: 1,
      wrong: 1,
      done: 0,
      unmarked: 20,
      completed: 3,
      percent: 13,
    },
  );
});

test("all incorrect answers still complete the assigned scope", () => {
  const questions = questionsOf(4);
  const progress = completionProgress(
    questions,
    Object.fromEntries(questions.map((q) => [q.id, "wrong"])),
  );
  assert.equal(progress.completed, 4);
  assert.equal(progress.percent, 100);
  assert.equal(progress.good, 0);
  assert.equal(progress.wrong, 4);
});

test("legacy done marks count as completed but do not invent a good rating", () => {
  assert.deepEqual(completionProgress(questionsOf(2), { q0: "done" }), {
    total: 2,
    good: 0,
    hard: 0,
    wrong: 0,
    done: 1,
    unmarked: 1,
    completed: 1,
    percent: 50,
  });
});

test("changing a self-rating replaces its category without accumulating attempts", () => {
  const questions = questionsOf(3);
  const marks = {};
  for (const rating of ["wrong", "hard", "good", "good", "wrong"]) {
    marks.q0 = rating;
    const progress = completionProgress(questions, marks);
    assert.equal(progress.completed, 1);
    assert.equal(progress.percent, 33);
    assert.equal(progress[rating], 1);
    assert.equal(progress.good + progress.hard + progress.wrong, 1);
  }
  delete marks.q0;
  assert.equal(completionProgress(questions, marks).completed, 0);
});

test("empty scopes and unrelated marks have zero progress without invalid numbers", () => {
  assert.deepEqual(completionProgress([], { unrelated: "good" }), {
    total: 0,
    good: 0,
    hard: 0,
    wrong: 0,
    done: 0,
    unmarked: 0,
    completed: 0,
    percent: 0,
  });
  assert.deepEqual(
    completionProgress(questionsOf(2), { unrelated: "good", q0: "unknown" }),
    {
      total: 2,
      good: 0,
      hard: 0,
      wrong: 0,
      done: 0,
      unmarked: 2,
      completed: 0,
      percent: 0,
    },
  );
});

test("rounded completion never reaches 100 until all questions are complete", () => {
  const questions = questionsOf(469);
  const marks = Object.fromEntries(
    questions.slice(0, -1).map((q) => [q.id, "good"]),
  );
  assert.equal(completionProgress(questions, marks).percent, 99);
  assert.equal(completionProgress(questions, marks).completed, 468);
  marks.q468 = "done";
  assert.equal(completionProgress(questions, marks).percent, 100);
  assert.equal(completionProgress(questions, marks).completed, 469);
});

test("favorites and viewed or review-marked records do not count as completed", () => {
  const progress = recordProgress(questionsOf(4), {
    q0: { star: true },
    q1: { viewedAt: 123, updated: 123 },
    q2: { state: "review", star: true },
    q3: {},
  });
  assert.equal(progress.completed, 0);
  assert.equal(progress.unmarked, 4);
  assert.equal(progress.percent, 0);
});

test("record progress uses the supplied question scope rather than record count", () => {
  const questions = questionsOf(23);
  const records = {
    q0: { review: { rating: "good" } },
    q1: { review: { rating: "hard" } },
    q2: { review: { rating: "wrong" } },
    outside: { review: { rating: "good" } },
  };
  const progress = recordProgress(questions, records);
  assert.equal(progress.total, 23);
  assert.equal(progress.completed, 3);
  assert.equal(progress.percent, 13);
  const subset = recordProgress(questions.slice(0, 2), records);
  assert.equal(subset.total, 2);
  assert.equal(subset.completed, 2);
  assert.equal(subset.percent, 100);
});

test("record conversion preserves established mastery state and explicit rating precedence", () => {
  assert.equal(questionRating({ state: "done" }), "good");
  assert.equal(
    questionRating({ state: "done", review: { rating: "wrong" } }),
    "wrong",
  );
  const progress = recordProgress(questionsOf(3), {
    q0: { state: "done" },
    q1: { state: "done", review: { rating: "hard" } },
  });
  assert.equal(progress.good, 1);
  assert.equal(progress.hard, 1);
  assert.equal(progress.completed, 2);
  assert.equal(progress.percent, 67);
});
