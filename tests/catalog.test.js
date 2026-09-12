import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateCatalog, loadCatalog } from "../server/catalog.js";
import { importQuestions } from "../scripts/import-questions.js";

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
test("append final-exam package without changing existing question IDs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zju842-import-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, "base"),
    incoming = path.join(dir, "incoming");
  for (const d of [base, incoming])
    fs.mkdirSync(path.join(d, "questions"), { recursive: true });
  const q = structuredClone(live.questions[0]);
  q.images[0].src = "questions/test.webp";
  const type = live.types.find((t) => t.id === q.typeId);
  fs.writeFileSync(
    path.join(base, "catalog.json"),
    JSON.stringify({ version: 1, types: [type], questions: [q] }),
  );
  fs.writeFileSync(path.join(base, "questions/test.webp"), "test-image");
  const final = {
    ...q,
    id: "final-example-2025-1",
    sourceKind: "final",
    sourceTitle: "课程期末考试",
  };
  fs.writeFileSync(
    path.join(incoming, "catalog.json"),
    JSON.stringify({ version: 1, types: [type], questions: [final] }),
  );
  fs.writeFileSync(path.join(incoming, "questions/test.webp"), "test-image");
  assert.equal(importQuestions(incoming, base), 1);
  const merged = loadCatalog(path.join(base, "catalog.json"), base);
  assert.deepEqual(
    merged.questions.map((q) => q.id),
    [q.id, final.id],
  );
  assert.equal(merged.questions[1].sourceKind, "final");
  assert.throws(() => importQuestions(incoming, base), /重复/);
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
