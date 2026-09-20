import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateCatalog, loadCatalog } from "../server/catalog.js";
import { importQuestions } from "../scripts/import-questions.js";
import { curriculumChapters } from "../src/curriculum.js";

const live = loadCatalog(
  path.resolve("public/catalog.json"),
  path.resolve("public"),
);
test("catalog IDs, source kinds and cropped-image paths", () => {
  assert.ok(live.questions.length >= 469);
  assert.ok(
    new Set(live.questions.flatMap((q) => q.images.map((im) => im.src))).size >=
      287,
  );
  const altered = structuredClone(live);
  altered.questions[0].images[0].src = "questions/page-1.webp";
  assert.throws(() => validateCatalog(altered));
  altered.questions[0].images[0].src = "../private.pdf";
  assert.throws(() => validateCatalog(altered));
});
function finalExamFixture(t, { classified = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zju842-import-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, "base"),
    incoming = path.join(dir, "incoming");
  for (const d of [base, incoming])
    fs.mkdirSync(path.join(d, "questions"), { recursive: true });
  fs.copyFileSync("public/catalog.json", path.join(base, "catalog.json"));
  for (const src of new Set(
    live.questions.flatMap((q) => q.images.map((im) => im.src)),
  ))
    fs.copyFileSync(path.join("public", src), path.join(base, src));
  const final = {
    ...structuredClone(live.questions[0]),
    id: "final-example-2025-1",
    sourceKind: "final",
    sourceTitle: "课程期末考试",
  };
  if (!classified) {
    delete final.primaryChapter;
    delete final.knowledgeIds;
    delete final.trainingIds;
  }
  const type = live.types.find((t) => t.id === final.typeId);
  fs.writeFileSync(
    path.join(incoming, "catalog.json"),
    JSON.stringify({ version: 1, types: [type], questions: [final] }),
  );
  for (const im of final.images)
    fs.copyFileSync(path.join("public", im.src), path.join(incoming, im.src));
  return { base, incoming, final };
}

test("append final exam to the real r2 catalog without losing metadata or existing questions", (t) => {
  const { base, incoming, final } = finalExamFixture(t);
  assert.equal(importQuestions(incoming, base), 1);
  const merged = loadCatalog(path.join(base, "catalog.json"), base);
  const { types: oldTypes, questions: oldQuestions, ...oldMetadata } = live;
  const { types, questions, ...metadata } = merged;
  assert.ok(oldMetadata.libraryId);
  assert.ok(Number.isInteger(oldMetadata.libraryRevision));
  assert.ok(oldMetadata.curriculum);
  assert.deepEqual(metadata, oldMetadata);
  assert.deepEqual(types, oldTypes);
  assert.deepEqual(questions.slice(0, oldQuestions.length), oldQuestions);
  assert.deepEqual(
    merged.questions.map((q) => q.id),
    [...oldQuestions.map((q) => q.id), final.id],
  );
  assert.deepEqual(questions.at(-1), final);
  assert.ok(
    curriculumChapters(merged)
      .find((chapter) => chapter.id === final.primaryChapter)
      .questionIds.has(final.id),
  );
  const catalogBefore = fs.readFileSync(path.join(base, "catalog.json"));
  assert.throws(() => importQuestions(incoming, base), /重复/);
  assert.deepEqual(
    fs.readFileSync(path.join(base, "catalog.json")),
    catalogBefore,
  );
});

test("unclassified final-exam questions remain reachable in the existing curriculum fallback", (t) => {
  const { base, incoming, final } = finalExamFixture(t, { classified: false });
  assert.equal(importQuestions(incoming, base), 1);
  const merged = loadCatalog(path.join(base, "catalog.json"), base);
  assert.deepEqual(merged.curriculum, live.curriculum);
  assert.equal(merged.questions.at(-1).sourceKind, "final");
  const fallback = curriculumChapters(merged).find(
    (chapter) => chapter.id === final.subject + "-other",
  );
  assert.ok(fallback.questionIds.has(final.id));
  assert.equal(fallback.title, "待归类题目");
});

test("final-exam import rejects different image content under an existing asset name", (t) => {
  const { base, incoming, final } = finalExamFixture(t);
  const src = final.images[0].src;
  const catalogBefore = fs.readFileSync(path.join(base, "catalog.json"));
  const imageBefore = fs.readFileSync(path.join(base, src));
  fs.writeFileSync(path.join(incoming, src), "different-image-content");
  assert.throws(() => importQuestions(incoming, base), /题图名称已使用/);
  assert.deepEqual(
    fs.readFileSync(path.join(base, "catalog.json")),
    catalogBefore,
  );
  assert.deepEqual(fs.readFileSync(path.join(base, src)), imageBefore);
});
test("production build includes only catalog and referenced cropped assets", () => {
  const names = fs.readdirSync("dist", { recursive: true }).map(String);
  assert.equal(
    names.filter((n) => /questions[\\/].+\.(webp|png|jpe?g)$/.test(n)).length,
    new Set(live.questions.flatMap((q) => q.images.map((im) => im.src))).size,
  );
  assert.equal(
    names.filter((n) =>
      /\.pdf$|page[-_]|answers_draft|\.sqlite$|\.env$/i.test(n),
    ).length,
    0,
  );
});
