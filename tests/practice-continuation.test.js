import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildChapters } from "../src/chapters.js";
import { continuationTopics } from "../src/practice-continuation.js";
const catalog = JSON.parse(
    fs.readFileSync(new URL("../public/catalog.json", import.meta.url)),
  ),
  chapters = buildChapters(catalog);
test("topic continuation advances without including the current topic or changing study", () => {
  const study = { records: {}, lists: [] },
    filters = {
      subject: "digital",
      chapter: chapters.find((c) => c.subject === "digital").id,
      type: "",
    };
  const all = continuationTopics(catalog, chapters, filters, study);
  assert.ok(all.length > 1);
  filters.type = all[0].id;
  filters.chapter = all[0].chapter;
  const next = continuationTopics(catalog, chapters, filters, study);
  assert.equal(next[0].id, all[1].id);
  assert.ok(
    !next.some((n) => n.id === all[0].id && n.chapter === all[0].chapter),
  );
  assert.deepEqual(study, { records: {}, lists: [] });
});
test("knowledge navigation retains mode and year/status/list filters; does not reuse analysis question restriction", () => {
  const q = catalog.questions.find((q) => q.knowledgeIds?.length),
    study = {
      records: { [q.id]: { star: true } },
      lists: [{ name: "keep", ids: [q.id] }],
    };
  const filters = {
    subject: q.subject,
    type: "knowledge:missing",
    chapter: q.primaryChapter,
    status: "star",
    list: "keep",
    year: String(q.year),
    questionIds: ["unrelated"],
  };
  const choices = continuationTopics(catalog, chapters, filters, study);
  assert.ok(choices.length);
  assert.ok(
    choices.every(
      (c) =>
        c.id.startsWith("knowledge:") &&
        c.questionIds.every((id) => id === q.id),
    ),
  );
});
