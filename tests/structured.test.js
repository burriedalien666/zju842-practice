import { legacyCatalog } from "./fixtures/legacy-catalog.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  structuredLibrary,
  buildStructuredLibrary,
} from "../scripts/build-structured-library.js";
import { validateCatalog } from "../server/catalog.js";
import { validateLibraryTransition } from "../server/content-policy.js";
import { createContentStore, currentLibrary } from "../server/content-store.js";
import {
  questionBodyMarkup,
  structuredBody,
  svgMarkup,
} from "../src/structured-question.js";
import { validateSvg } from "../src/structured-schema.js";
import { openDatabase } from "../server/db.js";
import {
  ensureLocalStudySchema,
  writeLocalStudy,
  readLocalStudy,
} from "../server/study-version.js";
import { validateStudy } from "../src/study.js";
import { packPaths, writeZip } from "../server/packs.js";

const baseDir = path.resolve("public"),
  base = legacyCatalog(),
  candidate = structuredLibrary(base);
test("all 250 accepted groups cover every original ID; source notes do not block rendering", () => {
  assert.equal(candidate.structured.groups.length, 250);
  const ids = candidate.structured.groups.flatMap((g) => g.questionIds);
  assert.equal(ids.length, 469);
  assert.equal(new Set(ids).size, 469);
  assert.deepEqual(candidate.questions, base.questions);
  assert.equal(candidate.questions.length - ids.length, 0);
  assert.equal(packPaths(candidate).size, packPaths(base).size);
  assert.ok(candidate.structured.groups.some((g) => g.id === "2025|九|(1)"));
  assert.ok(ids.includes("2025|七|(1)"));
  assert.ok(ids.includes("2015|九|(2)"));
});
test("every migrated group renders; shared children retain current ID and original image controls", () => {
  for (const g of candidate.structured.groups) {
    assert.ok(structuredBody(g, candidate.structured.figures));
    for (const id of g.questionIds) {
      const q = candidate.questions.find((q) => q.id === id),
        html = questionBodyMarkup(candidate, q);
      assert.match(html, /data-structured-group=/);
      assert.ok(html.includes(q.images[0].src));
      assert.match(html, /查看原图/);
      assert.doesNotMatch(html, /question-source-details|<summary>原题说明/);
    }
  }
  assert.doesNotMatch(
    questionBodyMarkup(base, base.questions[0]),
    /structured-question/,
  );
  assert.match(
    questionBodyMarkup(
      candidate,
      candidate.questions.find((q) => q.id === "2025|七|(1)"),
    ),
    /structured-question/,
  );
});
test("distributed catalog contains the complete structured library without a second installation", () => {
  const distributed=validateCatalog(JSON.parse(fs.readFileSync(path.join(baseDir,'catalog.json'),'utf8')));
  assert.equal(distributed.libraryRevision,4);
  assert.equal(distributed.structured.groups.length,250);
  assert.equal(distributed.structured.groups.flatMap(g=>g.questionIds).length,469);
});
test("schema rejects unknown IDs, shared-image mismatches, bad math, missing figures, and insufficient program requirement", () => {
  for (const edit of [
    (c) => c.structured.groups[0].questionIds.push("missing"),
    (c) => (c.structured.groups[0].originals = ["questions/wrong.webp"]),
    (c) =>
      c.structured.groups[1].questionIds.push(
        c.structured.groups[0].questionIds[0],
      ),
    (c) =>
      c.structured.groups[0].blocks.push({
        type: "formula",
        tex: "\\notAnActualCommand",
      }),
    (c) =>
      c.structured.groups[0].blocks.push({ type: "figure", name: "notFound" }),
    (c) => (c.requiresProgram = "0.5.7"),
  ]) {
    const c = structuredClone(candidate);
    edit(c);
    assert.throws(() => validateCatalog(c));
  }
});
test("SVG data cannot introduce code, external references or arbitrary CSS", () => {
  const tree = Object.values(candidate.structured.figures)[0];
  for (const change of [
    (t) =>
      t.children.push({ tag: "script", attrs: {}, children: ["alert(1)"] }),
    (t) => (t.attrs.onload = "alert(1)"),
    (t) => (t.attrs.href = "https://example.com/x"),
    (t) => (t.attrs.style = "background:url(https://example.com)"),
    (t) => (t.attrs.fill = "url(https://example.com)"),
    (t) => (t.attrs["marker-end"] = "url(https://example.com)"),
    (t) => t.children.push({ tag: "foreignObject", attrs: {}, children: [] }),
  ]) {
    const t = structuredClone(tree);
    change(t);
    assert.throws(() => validateSvg(t));
  }
  const first = svgMarkup(tree),
    second = svgMarkup(tree);
  assert.notEqual(
    first,
    second,
    "SVG IDs are unique in history and shared questions",
  );
  assert.match(
    svgMarkup({ tag: "text", attrs: {}, children: ['<img onerror="x">'] }),
    /&lt;img/,
  );
});
test("rendering failure falls back to original image without altering catalog or study", () => {
  const c = structuredClone(candidate),
    g = c.structured.groups[0],
    q = c.questions.find((q) => q.id === g.id);
  g.blocks = [{ type: "formula", tex: "\\brokenCommand" }];
  const html = questionBodyMarkup(c, q);
  assert.match(html, /已切回原图/);
  assert.ok(html.includes(q.images[0].src));
});
test("r4 cannot be imported by an older program, and r2 still works in 0.5.8", () => {
  assert.throws(
    () => validateLibraryTransition(base, candidate, { version: "0.5.7" }),
    /先更新程序/,
  );
  assert.doesNotThrow(() => validateCatalog(base));
  assert.doesNotThrow(() =>
    validateLibraryTransition(base, candidate, { version: "0.5.8" }),
  );
});
test("real r2->r4 ZIP install, restart and per-group image rollback preserve SQLite study, private answers and public answers", async () => {
  const dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "842-structured-data-"),
    ),
    packDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-structured-pack-"));
  let db;
  try {
    const catalog = structuredClone(base),
      qid = candidate.structured.groups.find(
        (g) => g.questionIds.length > 1,
      ).id;
    db = await openDatabase(dataDir);
    await ensureLocalStudySchema(db);
    const study = validateStudy(
      {
        version: 2,
        records: { [qid]: { star: true, state: "done" } },
        lists: [{ name: "保留题单", ids: [qid] }],
        papers: {
          2009: {
            started: 100,
            finished: null,
            elapsedMs: 12345,
            questionIds: [qid],
            marks: { [qid]: "hard" },
          },
        },
        paperHistory: {
          2009: [
            {
              started: 10,
              finished: 90,
              closedAt: 95,
              elapsedMs: 80,
              questionIds: [qid],
              marks: { [qid]: "good" },
            },
          ],
        },
        lastQuestion: qid,
        examDate: "2026-12-20",
      },
      new Set(base.questions.map((q) => q.id)),
    );
    await writeLocalStudy(db, study, "0");
    await db.run(
      "INSERT INTO photos VALUES(?,?,?)",
      "fixture-private",
      qid,
      Buffer.from("private answer bytes"),
    );
    await db.run(
      "INSERT INTO answers VALUES(?,?,?,?)",
      qid,
      '["fixture-private"]',
      '["fixture-private"]',
      "fixture",
    );
    const snapshot = async () => ({
      study: await readLocalStudy(db),
      photos: await db.all("SELECT * FROM photos"),
      answers: await db.all("SELECT * FROM answers"),
    });
    const before = await snapshot(),
      store = createContentStore({
        dataDir,
        catalog,
        baseDir,
        version: "0.5.8",
      }),
      official = store.official().value;
    const zip = path.join(packDir, "r3.842pack");
    await buildStructuredLibrary(zip);
    await store.installLibrary(zip);
    assert.equal(catalog.libraryRevision, 4);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(store.official().value, official);
    const restart = JSON.parse(
      fs.readFileSync(
        path.join(currentLibrary(dataDir, baseDir), "catalog.json"),
      ),
    );
    assert.equal(restart.structured.groups.length, 250);
    assert.deepEqual(restart.questions, base.questions);
    const rollback = structuredClone(restart);
    rollback.libraryRevision = 5;
    rollback.structured.groups = rollback.structured.groups.filter(
      (g) => g.id !== qid,
    );
    const r4 = path.join(packDir, "r4.842pack");
    await writeZip(
      r4,
      [...packPaths(rollback)].map((name) =>
        name === "catalog.json"
          ? { name, bytes: Buffer.from(JSON.stringify(rollback)) }
          : { name, file: path.join(baseDir, name) },
      ),
    );
    await store.installLibrary(r4);
    assert.doesNotMatch(
      questionBodyMarkup(
        catalog,
        catalog.questions.find((q) => q.id === qid),
      ),
      /structured-question/,
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(store.official().value, official);
  } finally {
    await db?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(packDir, { recursive: true, force: true });
  }
});
