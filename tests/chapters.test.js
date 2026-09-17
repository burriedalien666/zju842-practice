import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildChapters,
  chapterForType,
  chapterForQuestion,
  filterQuestions,
  chapterQuestions,
} from "../src/chapters.js";
const catalog = JSON.parse(
  fs.readFileSync(new URL("../public/catalog.json", import.meta.url)),
);
test("all existing questions have exactly one chapter without renumbering", () => {
  const chapters = buildChapters(catalog);
  assert.equal(chapters.filter((c) => c.subject === "signals").length, 7);
  assert.equal(chapters.filter((c) => c.subject === "digital").length, 11);
  const mapped = chapters.flatMap((c) =>
    chapterQuestions(c, catalog.questions).map((q) => q.id),
  );
  assert.equal(mapped.length, catalog.questions.length);
  assert.equal(new Set(mapped).size, mapped.length);
  assert.equal(
    new Set(
      chapters.flatMap((c) =>
        c.sections.flatMap((s) => s.types.map((t) => t.id)),
      ),
    ).size,
    catalog.curriculum.trainingTypes.length,
  );
});
test("mixed legacy types are split by question and scoped filters stay consistent", () => {
  const chapters = buildChapters(catalog);
  const filters = { subject: "signals", chapter: "s4", type: "A9.4" };
  const selected = filterQuestions(
    catalog,
    filters,
    { records: {}, lists: [] },
    chapters,
  );
  assert.deepEqual(
    selected.map((q) => q.id),
    ["2015|二|(1)", "2024|四|(3)"],
  );
  assert.equal(
    chapterForQuestion(
      chapters,
      catalog.questions.find((q) => q.id === "2013|四|(c)"),
    ).id,
    "s6",
  );
  assert.equal(
    filterQuestions(
      catalog,
      { ...filters, year: "2024" },
      { records: {}, lists: [] },
      chapters,
    ).length,
    1,
  );
  assert.equal(
    filterQuestions(
      catalog,
      { ...filters, status: "star" },
      { records: { "2015|二|(1)": { star: true } }, lists: [] },
      chapters,
    ).length,
    1,
  );
});
test("frequency applications and hazards follow their chapters; 842 supplements retained", () => {
  const chapters = buildChapters(catalog);
  for (const [type, chapter] of [
    ["A9.1", "s3"],
    ["A9.2", "s4"],
    ["A7.1", "s5"],
    ["A5.1", "s6"],
    ["B3.2", "d4"],
    ["B10.5", "d12"],
    ["B11.1", "d8"],
    ["B12.1", "d9"],
  ])
    assert.equal(chapterForType(chapters, type).id, chapter);
  assert.notEqual(chapterForType(chapters, "B11.1").supplement, true);
});
test("new imported types remain available instead of disappearing", () => {
  const chapters = buildChapters({
    ...catalog,
    types: [
      ...catalog.types,
      { id: "new-type", subject: "signals", group: "new", title: "新增题型" },
    ],
  });
  assert.equal(chapterForType(chapters, "new-type").id, "signals-other");
});
