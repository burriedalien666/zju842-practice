import test from "node:test";
import assert from "node:assert/strict";
import {
  paperStats,
  startPaperRound,
  validatePaperHistory,
  validatePaperRuns,
} from "../src/papers.js";
import { emptyStudy, validateStudy } from "../src/study.js";

const paper = {
  year: 2025,
  questions: [{ id: "q2" }, { id: "q1" }, { id: "q3" }],
};
const ids = new Set(paper.questions.map((q) => q.id));
const legacyRun = () => ({
  started: 100,
  finished: null,
  marks: { q2: "wrong", q1: "done" },
});
const roundTrip = (study) =>
  validateStudy(JSON.parse(JSON.stringify(study)), ids);

test("old paper runs round trip without invented duration or question IDs", () => {
  const study = { ...emptyStudy(), papers: { 2025: legacyRun() } };
  assert.deepEqual(roundTrip(study), study);
  assert.deepEqual(validatePaperRuns(study.papers), study.papers);
  assert.equal("elapsedMs" in roundTrip(study).papers[2025], false);
  assert.equal("timingPartial" in roundTrip(study).papers[2025], false);
  assert.equal("questionIds" in roundTrip(study).papers[2025], false);
  assert.equal("paperHistory" in roundTrip(study), false);
});

test("first round records ordered original IDs without creating a fake archive", () => {
  const study = emptyStudy();
  const run = startPaperRound(study, paper, 200);
  assert.equal(run, study.papers[2025]);
  assert.deepEqual(run, {
    started: 200,
    finished: null,
    marks: {},
    elapsedMs: 0,
    questionIds: ["q2", "q1", "q3"],
  });
  assert.equal("paperHistory" in study, false);
  assert.deepEqual(roundTrip(study), study);
});

test("new rounds deep-clone old marks and retain every preceding round", () => {
  const study = emptyStudy();
  const first = startPaperRound(study, paper, 200);
  first.marks.q2 = "hard";
  first.elapsedMs = 1200;
  const second = startPaperRound(study, paper, 300);
  assert.deepEqual(study.paperHistory[2025][0], {
    ...first,
    closedAt: 300,
  });
  first.marks.q2 = "good";
  first.questionIds.reverse();
  assert.equal(study.paperHistory[2025][0].marks.q2, "hard");
  assert.deepEqual(study.paperHistory[2025][0].questionIds, ["q2", "q1", "q3"]);
  assert.deepEqual(second.marks, {});
  assert.equal(second.elapsedMs, 0);
  second.marks.q1 = "good";
  startPaperRound(study, paper, 400);
  assert.equal(study.paperHistory[2025].length, 2);
  assert.equal(study.paperHistory[2025][1].marks.q1, "good");
  assert.deepEqual(roundTrip(study), study);
});

test("archiving an unfinished legacy round does not mark it finished or invent time", () => {
  const study = { ...emptyStudy(), papers: { 2025: legacyRun() } };
  startPaperRound(study, paper, 200);
  const archived = study.paperHistory[2025][0];
  assert.equal(archived.finished, null);
  assert.equal(archived.closedAt, 200);
  assert.equal("elapsedMs" in archived, false);
  assert.deepEqual(archived.questionIds, ["q2", "q1", "q3"]);
  assert.deepEqual(archived.marks, { q2: "wrong", q1: "done" });
  assert.deepEqual(roundTrip(study), study);
});

test("archiving a finished round preserves finish time and its own original order", () => {
  const run = {
    ...legacyRun(),
    finished: 150,
    elapsedMs: 123.5,
    questionIds: ["q1", "removed-question", "q2"],
  };
  const study = { ...emptyStudy(), papers: { 2025: run } };
  startPaperRound(study, paper, 200);
  assert.deepEqual(study.paperHistory[2025][0], { ...run, closedAt: 200 });
  assert.deepEqual(roundTrip(study), study);
  assert.deepEqual(study.papers[2025].questionIds, ["q2", "q1", "q3"]);
});

test("paper history validates and clones ordered IDs and marks independently", () => {
  const history = {
    2025: [
      {
        ...legacyRun(),
        elapsedMs: 0,
        questionIds: ["q2", "q1"],
        closedAt: 150,
      },
    ],
  };
  const clean = validatePaperHistory(history);
  assert.deepEqual(clean, history);
  history[2025][0].marks.q2 = "good";
  history[2025][0].questionIds.pop();
  assert.equal(clean[2025][0].marks.q2, "wrong");
  assert.deepEqual(clean[2025][0].questionIds, ["q2", "q1"]);
  const legacyHistory = { 2025: [{ ...legacyRun(), closedAt: 150 }] };
  assert.deepEqual(validatePaperHistory(legacyHistory), legacyHistory);
});

test("paper stats keep the existing completion and mastery shape", () => {
  assert.deepEqual(paperStats(paper, legacyRun()), {
    total: 3,
    completed: 2,
    wrong: 1,
    good: 0,
  });
});

test("partial timing flag round trips true and false and stays with the archived round", () => {
  for (const timingPartial of [true, false]) {
    const run = { ...legacyRun(), elapsedMs: 1234, timingPartial };
    const study = { ...emptyStudy(), papers: { 2025: run } };
    assert.deepEqual(roundTrip(study), study);
    const next = startPaperRound(study, paper, 200);
    assert.equal(study.paperHistory[2025][0].timingPartial, timingPartial);
    assert.equal("timingPartial" in next, false);
    assert.deepEqual(roundTrip(study), study);
  }
});

test("partial timing flag rejects non-boolean values in current and archived rounds", () => {
  for (const timingPartial of [null, 0, 1, "true", "false", [], {}]) {
    const run = { ...legacyRun(), timingPartial };
    assert.throws(() => validatePaperRuns({ 2025: run }));
    assert.throws(() =>
      validatePaperHistory({ 2025: [{ ...run, closedAt: 200 }] }),
    );
  }
});

test("starting rounds does not change global learning records, lists or photos", () => {
  const records = { q1: { state: "done", star: true } };
  const lists = [{ name: "我的题单", ids: ["q1", "q2"] }];
  const photos = { q1: ["original-photo"] };
  const study = { ...emptyStudy(), records, lists, photos };
  const before = structuredClone({ records, lists, photos });
  startPaperRound(study, paper, 100);
  study.papers[2025].marks.q1 = "wrong";
  startPaperRound(study, paper, 200);
  assert.equal(study.records, records);
  assert.equal(study.lists, lists);
  assert.equal(study.photos, photos);
  assert.deepEqual({ records, lists, photos }, before);
});

test("run validation rejects malformed records, durations, IDs and dangerous keys", () => {
  for (const value of [null, [], "runs", new Date(), new Map()])
    assert.throws(() => validatePaperRuns(value));
  for (const run of [
    null,
    [],
    { ...legacyRun(), started: -1 },
    { ...legacyRun(), started: Infinity },
    { ...legacyRun(), finished: 99 },
    { ...legacyRun(), marks: [] },
    { ...legacyRun(), marks: { q1: "fake" } },
    { ...legacyRun(), marks: JSON.parse('{"__proto__":"good"}') },
    { ...legacyRun(), marks: { constructor: "good" } },
    ...[-1, Infinity, NaN, "0", null].map((elapsedMs) => ({
      ...legacyRun(),
      elapsedMs,
    })),
    ...[
      null,
      "q1",
      {},
      ["q1", "q1"],
      [""],
      [123],
      ["a".repeat(161)],
      ["__proto__"],
      ["prototype"],
      ["constructor"],
      new Array(1),
    ].map((questionIds) => ({ ...legacyRun(), questionIds })),
  ])
    assert.throws(() => validatePaperRuns({ 2025: run }));
  assert.throws(() => validatePaperRuns({ badyear: legacyRun() }));
  assert.throws(() =>
    validatePaperRuns(JSON.parse('{"__proto__":{"started":100}}')),
  );
});

test("history validation rejects malformed archive arrays and closing times", () => {
  for (const value of [null, [], "history", new Map(), { badyear: [] }])
    assert.throws(() => validatePaperHistory(value));
  for (const runs of [null, {}, "history", new Array(1)])
    assert.throws(() => validatePaperHistory({ 2025: runs }));
  for (const closedAt of [undefined, null, 99, -1, Infinity, NaN, "200"])
    assert.throws(() =>
      validatePaperHistory({ 2025: [{ ...legacyRun(), closedAt }] }),
    );
  assert.throws(() =>
    validateStudy({ ...emptyStudy(), paperHistory: { 2025: [{}] } }, ids),
  );
  assert.throws(() => validatePaperHistory(JSON.parse('{"constructor":[]}')));
});

test("invalid start time or source IDs cannot partially change existing rounds", () => {
  const study = { ...emptyStudy(), papers: { 2025: legacyRun() } };
  const before = structuredClone(study);
  for (const now of [-1, 99, Infinity, NaN, "200"])
    assert.throws(() => startPaperRound(study, paper, now));
  assert.throws(() =>
    startPaperRound(
      study,
      { ...paper, questions: [{ id: "q1" }, { id: "q1" }] },
      200,
    ),
  );
  assert.throws(() =>
    startPaperRound(study, { ...paper, year: "__proto__" }, 200),
  );
  assert.deepEqual(study, before);
});
