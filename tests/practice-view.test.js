import test from "node:test";
import assert from "node:assert/strict";
import {
  questionRating,
  ratingCounts,
  progressMarkup,
  durationText,
  pickerMarkup,
  roundSummaryMarkup,
} from "../src/practice-view.js";
import { PracticeClock } from "../src/practice-clock.js";

test("question ratings preserve old mastery and prefer explicit review ratings", () => {
  for (const record of [undefined, null, {}, { star: true }, { state: "" }])
    assert.equal(questionRating(record), "");
  assert.equal(questionRating({ state: "done", star: false }), "good");
  assert.equal(questionRating({ state: "review", star: true }), "");
  for (const rating of ["hard", "wrong", "good"])
    assert.equal(questionRating({ state: "done", review: { rating } }), rating);
});

test("rating counts distinguish legacy completion, mastery and unmarked favorites", () => {
  const questions = ["good", "hard", "wrong", "done", "star", "empty"].map(
    (id) => ({ id }),
  );
  const records = { star: { state: "", star: true }, empty: {} };
  const marks = {
    good: "good",
    hard: "hard",
    wrong: "wrong",
    done: "done",
    star: questionRating(records.star),
    empty: questionRating(records.empty),
    outside: "good",
  };
  assert.deepEqual(ratingCounts(questions, marks), {
    total: 6,
    good: 1,
    hard: 1,
    wrong: 1,
    done: 1,
    unmarked: 2,
  });
  assert.deepEqual(ratingCounts([{ id: "new" }], {}), {
    total: 1,
    good: 0,
    hard: 0,
    wrong: 0,
    done: 0,
    unmarked: 1,
  });
});

test("directory progress shows completed questions out of the entire scope, with separate rating segments", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
  const html = progressMarkup(questions, {
    q0: "good",
    q1: "hard",
    q2: "wrong",
    q3: "wrong",
    q4: "done",
    outside: "good",
  });
  assert.match(html, /50% \(5\/10\)/);
  assert.match(html, /完成进度 50%（已做 5 \/ 总题数 10）/);
  assert.match(html, /掌握 1、不熟 1、不会 2、未做 5/);
  assert.match(html, /另有旧版已做但未自评 1 题/);
  assert.match(html, /data-completed="5" data-total="10"/);
  assert.match(html, /directory-status status-hard/);
  for (const [rating, width] of [
    ["good", 10],
    ["hard", 10],
    ["wrong", 20],
    ["done", 10],
    ["none", 50],
  ]) {
    assert.ok(
      html.includes(`class="segment-${rating}" style="width:${width}%"`),
    );
  }
});

test("empty and entirely unreviewed directories remain gray", () => {
  for (const [questions, marks, total] of [
    [[], {}, 0],
    [[{ id: "q1" }, { id: "q2" }], {}, 2],
  ]) {
    const html = progressMarkup(questions, marks);
    assert.ok(html.includes(`0% (0/${total})`));
    assert.match(html, /directory-status status-none/);
    assert.doesNotMatch(html, /segment-(?:good|hard|wrong)|NaN|Infinity/);
    if (total) assert.match(html, /class="segment-none" style="width:100%"/);
  }
});

test("directory status distinguishes unstarted, in progress and completed independently of mastery", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
  for (const [completed, rating, state] of [
    [0, "good", "none"],
    [1, "good", "hard"],
    [7, "good", "hard"],
    [9, "wrong", "hard"],
    [10, "wrong", "good"],
    [10, "hard", "good"],
    [10, "done", "good"],
  ]) {
    const marks = Object.fromEntries(
      questions.slice(0, completed).map((q) => [q.id, rating]),
    );
    const html = progressMarkup(questions, marks);
    assert.match(html, new RegExp(`directory-status status-${state}`));
    assert.ok(html.includes(`${completed * 10}% (${completed}/10)`));
  }
});

test("the reported three of twenty-three example shows 13 percent rather than mastery rate", () => {
  const questions = Array.from({ length: 23 }, (_, i) => ({ id: `q${i}` }));
  const html = progressMarkup(questions, {
    q0: "good",
    q1: "hard",
    q2: "wrong",
  });
  assert.match(html, /13% \(3\/23\)/);
  assert.match(html, /完成进度 13%（已做 3 \/ 总题数 23）/);
  assert.match(html, /掌握 1、不熟 1、不会 1、未做 20/);
  assert.doesNotMatch(html, /33%|掌握率/);
});

test("legacy done marks complete progress without being shown as mastered", () => {
  const html = progressMarkup([{ id: "q1" }, { id: "q2" }], {
    q1: "done",
    q2: "done",
  });
  assert.match(html, /100% \(2\/2\)/);
  assert.match(html, /directory-status status-good/);
  assert.match(html, /掌握 0、不熟 0、不会 0、未做 0/);
  assert.match(html, /另有旧版已做但未自评 2 题/);
  assert.match(html, /class="segment-done" style="width:100%"/);
  assert.doesNotMatch(html, /segment-(?:good|hard|wrong|none)/);
});

test("a directory with one unfinished question cannot display 100 percent", () => {
  const questions = Array.from({ length: 469 }, (_, i) => ({ id: `q${i}` }));
  const marks = Object.fromEntries(
    questions.slice(0, -1).map((q) => [q.id, "good"]),
  );
  assert.match(progressMarkup(questions, marks), /99% \(468\/469\)/);
  marks.q468 = "wrong";
  assert.match(progressMarkup(questions, marks), /100% \(469\/469\)/);
});

test("changing the same question rating replaces its progress contribution instead of counting another attempt", () => {
  const questions = [{ id: "q1" }, { id: "q2" }];
  const marks = { q1: "wrong" };
  assert.match(progressMarkup(questions, marks), /50% \(1\/2\)/);
  marks.q1 = "hard";
  assert.match(progressMarkup(questions, marks), /50% \(1\/2\)/);
  marks.q1 = "good";
  const html = progressMarkup(questions, marks);
  assert.match(html, /50% \(1\/2\)/);
  assert.match(html, /掌握 1、不熟 0、不会 0、未做 1/);
  assert.doesNotMatch(html, /segment-(?:hard|wrong)/);
  delete marks.q1;
  assert.match(progressMarkup(questions, marks), /0% \(0\/2\)/);
});

test("duration text distinguishes unrecorded time and keeps total minutes above sixty", () => {
  assert.equal(durationText(undefined), "未记录用时");
  assert.equal(durationText(0), "00:00");
  assert.equal(durationText(59999), "00:59");
  assert.equal(durationText(60000), "01:00");
  assert.equal(durationText(3600000), "60:00");
  assert.equal(durationText(5405999), "90:05");
});

test("picker escapes title, question number and ID while marking current favorite accessibly", () => {
  const dangerousId = 'q"><img src=x onerror="bad()">';
  const questions = [
    {
      id: dangerousId,
      year: 2025,
      number: "<script>number</script>",
      title: '"><svg onload="bad()">&title',
    },
    { id: "safe", year: 2024, number: "二（1）", title: "普通题目" },
  ];
  const html = pickerMarkup(
    questions,
    dangerousId,
    { [dangerousId]: { star: true } },
    { [dangerousId]: "hard" },
  );
  assert.equal((html.match(/data-action="select-question"/g) || []).length, 2);
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
  assert.match(html, /class="number-tile is-current mark-hard"/);
  assert.match(html, /aria-label="第1题，2025年 .*，不熟，已收藏"/);
  assert.match(html, /<small aria-hidden="true">★<\/small>/);
  assert.ok(
    html.includes(
      'data-id="q&quot;&gt;&lt;img src=x onerror=&quot;bad()&quot;&gt;"',
    ),
  );
  assert.ok(html.includes("&lt;script&gt;number&lt;/script&gt;"));
  assert.ok(
    html.includes("&quot;&gt;&lt;svg onload=&quot;bad()&quot;&gt;&amp;title"),
  );
  assert.doesNotMatch(html, /<(?:img|script|svg)\b/i);
  assert.doesNotMatch(html, /\son(?:error|load)="/i);
  assert.match(html, /min="1" max="2"/);
});

test("round summaries retain original question scope and never invent old timing or mastery", () => {
  const paper = { questions: [{ id: "now" }, { id: "extra" }] };
  const run = {
    started: 100,
    finished: null,
    questionIds: ["old", "good", "unmarked"],
    marks: { old: "done", good: "good" },
  };
  const html = roundSummaryMarkup(paper, run);
  assert.match(html, /<strong>2\/3<\/strong>已做/);
  assert.match(html, /<strong>1<\/strong>掌握/);
  assert.match(html, /<strong>1<\/strong>未做/);
  assert.match(html, /另有 1 题为旧版“已做”标记，未推断掌握程度/);
  assert.match(html, /未记录用时/);
  assert.doesNotMatch(html, /00:00|升级后累计用时/);
});

test("partially timed rounds explain that time before the upgrade is excluded", () => {
  const paper = { questions: [{ id: "q1" }] };
  const run = {
    started: 100,
    finished: null,
    marks: { q1: "wrong" },
    elapsedMs: 61000,
    timingPartial: true,
  };
  const html = roundSummaryMarkup(paper, run);
  assert.match(html, /升级后累计用时 01:01/);
  assert.match(html, /不包含升级前的练习时间/);
  const complete = roundSummaryMarkup(paper, { ...run, timingPartial: false });
  assert.match(complete, /用时 01:01/);
  assert.doesNotMatch(complete, /升级后累计用时|不包含升级前/);
});

test("practice clock accumulates ticks and excludes paused intervals on resume", () => {
  const clock = new PracticeClock(500, 1000);
  assert.equal(clock.tick(1500), 1000);
  clock.pause(1750);
  assert.equal(clock.elapsed, 1250);
  assert.equal(clock.paused, true);
  assert.equal(clock.tick(2500), 1250);
  clock.resume(3000);
  assert.equal(clock.paused, false);
  assert.equal(clock.tick(3300), 1550);
});

test("inactive clock ticks advance the reference without charging inactive time", () => {
  const clock = new PracticeClock(100, 1000);
  assert.equal(clock.tick(3000, false), 100);
  assert.equal(clock.last, 3000);
  assert.equal(clock.tick(3500), 600);
  assert.equal(clock.tick(4000, false), 600);
  assert.equal(clock.tick(4250), 850);
});

test("clock reset starts from zero and preserves paused or running status", () => {
  const running = new PracticeClock(500, 1000);
  running.reset(2000);
  assert.equal(running.elapsed, 0);
  assert.equal(running.paused, false);
  assert.equal(running.tick(2250), 250);
  const paused = new PracticeClock(500, 1000, true);
  paused.reset(2000);
  assert.equal(paused.elapsed, 0);
  assert.equal(paused.paused, true);
  assert.equal(paused.tick(2250), 0);
  paused.resume(2500);
  assert.equal(paused.tick(2750), 250);
});

test("a backward wall clock never subtracts elapsed practice time", () => {
  const clock = new PracticeClock(250, 1000);
  assert.equal(clock.tick(900), 250);
  assert.equal(clock.tick(800), 250);
  assert.equal(clock.tick(1000), 450);
  clock.pause(950);
  assert.equal(clock.elapsed, 450);
  clock.reset(900);
  assert.equal(clock.tick(800), 0);
});
