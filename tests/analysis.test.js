import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyse, cellText } from "../src/exam-analysis.js";
import { videoUrl, matchesTraining } from "../src/curriculum.js";
import { validateCatalog } from "../server/catalog.js";
import { buildChapters, filterQuestions } from "../src/chapters.js";
import {
  videoEntryMarkup,
  videoDialogMarkup,
} from "../src/learning-content.js";
const c = JSON.parse(
  fs.readFileSync(new URL("../public/catalog.json", import.meta.url)),
);

test("all 469 original IDs retained with primary chapters and multiple concept assignments", () => {
  assert.equal(c.questions.length, 469);
  assert.equal(new Set(c.questions.map((q) => q.id)).size, 469);
  validateCatalog(c);
  assert.ok(
    c.questions.every((q) => q.knowledgeIds.length && q.trainingIds.length),
  );
  assert.ok(
    c.questions
      .find((q) => q.id === "2025|三|(1)")
      .knowledgeIds.includes("s6.realization"),
  );
  assert.ok(
    c.questions
      .find((q) => q.id === "2025|三|(1)")
      .knowledgeIds.includes("s6.inverse"),
  );
  assert.equal(
    c.questions.find((q) => q.id === "2013|九|—").primaryChapter,
    "d11",
  );
});
test("chapter totals are additive; multi-concept counts cannot be added; zero differs from unknown score", () => {
  const a = analyse(c, { subject: "signals" });
  assert.equal(a.summary.count, 260);
  assert.equal(
    a.rows.reduce((s, r) => s + r.count, 0),
    260,
  );
  const b = analyse(c, { subject: "signals", level: "topic" });
  assert.ok(b.rows.reduce((s, r) => s + r.count, 0) > 260);
  const early = analyse(c, { subject: "signals", from: 2009, to: 2009 });
  assert.equal(early.summary.points, null);
  assert.equal(cellText({ count: 1, points: null, scored: 0 }, "points"), "—");
  assert.equal(cellText({ count: 0, points: null, scored: 0 }, "points"), "0");
  assert.equal(cellText({ count: 2, points: 5, scored: 1 }, "points"), "5*");
});
test("2025 explicitly printed scores total 75 per subject and 150 overall without duplicated subquestions", () => {
  for (const subject of ["signals", "digital"]) {
    const a = analyse(c, { subject, from: 2025, to: 2025 });
    assert.equal(a.summary.points, 75);
    assert.equal(a.summary.scored, a.summary.count);
    assert.equal(
      a.rows.reduce((s, r) => s + (r.points || 0), 0),
      75,
    );
  }
  assert.ok(
    c.questions.filter((q) => q.year !== 2025).every((q) => q.score == null),
  );
});
test("exam analysis excludes finals and honours year/subject selection and distinct examination years", () => {
  const augmented = structuredClone(c);
  augmented.questions.push({
    ...c.questions[0],
    id: "final-example",
    sourceKind: "final",
    score: { points: 99, sourcePage: 1, note: "fixture" },
  });
  const a = analyse(augmented, { subject: "digital", from: 2025, to: 2025 });
  assert.equal(a.summary.years, 1);
  assert.equal(a.summary.points, 75);
  assert.deepEqual(
    analyse(c, { subject: "digital", from: 2200 }).rows.map((r) => r.count),
    Array(11).fill(0),
  );
});
test("new training and knowledge filters preserve personal scopes and analysis selection", () => {
  const chapters = buildChapters(c),
    q = c.questions.find((q) => q.id === "2025|三|(1)");
  assert.ok(matchesTraining(q, "training:s-function"));
  const filters = {
    subject: "signals",
    chapter: "s6",
    type: "knowledge:s6.inverse",
    status: "star",
    questionIds: [q.id],
  };
  const records = { records: { [q.id]: { star: true } }, lists: [] };
  assert.deepEqual(
    filterQuestions(c, filters, records, chapters).map((q) => q.id),
    [q.id],
  );
  assert.equal(
    filterQuestions(c, { ...filters, year: "2024" }, records, chapters).length,
    0,
  );
  assert.ok(
    filterQuestions(
      c,
      { subject: "signals", type: "training:s-initial" },
      records,
      chapters,
    ).length > 0,
  );
});
test("external catalog annotations reject invalid concepts, score evidence and video URLs", () => {
  const wrong = structuredClone(c);
  wrong.questions[0].knowledgeIds = ["d2.laws"];
  assert.throws(() => validateCatalog(wrong));
  const points = structuredClone(c);
  points.questions[0].score = { points: -5, sourcePage: 1, note: "bad" };
  assert.throws(() => validateCatalog(points));
  for (const url of [
    "javascript:alert(1)",
    "https://www.bilibili.com.evil.test/video/BV1234567890",
    "https://www.bilibili.com/video/BV1234567890?p=0",
    "https://evil.test",
  ])
    assert.throws(() => videoUrl(url));
  assert.equal(
    videoUrl(
      "https://bilibili.com/video/BV1234567890?p=2&t=60&spm_id_from=abc",
    ),
    "https://www.bilibili.com/video/BV1234567890?p=2&t=60",
  );
});
test("video links absent until author adds one; labels escaped and opener isolated", () => {
  assert.equal(videoEntryMarkup(c, c.questions[0].id), "");
  const fixture = structuredClone(c);
  fixture.videoLessons = [
    {
      id: "fixture",
      target: "question",
      targetId: c.questions[0].id,
      title: "<img onerror=evil>",
      url: "https://www.bilibili.com/video/BV1234567890?t=23",
    },
  ];
  validateCatalog(fixture);
  const html = videoDialogMarkup(fixture, c.questions[0].id);
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.equal(videoEntryMarkup(fixture, "s1"), "");
});
