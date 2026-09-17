import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../server/db.js";
import {
  ensureLocalStudySchema,
  readLocalStudy,
  writeLocalStudy,
  replaceLocalStudy,
  assertStudyRevision,
} from "../server/study-version.js";
async function database(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-version-"));
  const db = await openDatabase(dir);
  t.after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}
const state = (n) => ({
  version: 1,
  records: {},
  lists: [{ name: String(n), ids: [] }],
});
test("ordinary revision migrates existing data and increments even when values repeat", async (t) => {
  const db = await database(t);
  await db.run(
    "CREATE TABLE local_state(id INTEGER PRIMARY KEY,value TEXT NOT NULL)",
  );
  await db.run("INSERT INTO local_state VALUES(1,?)", JSON.stringify(state(1)));
  await ensureLocalStudySchema(db);
  assert.deepEqual((await readLocalStudy(db)).study, state(1));
  assert.equal((await readLocalStudy(db)).revision, "0");
  assert.equal((await writeLocalStudy(db, state(1), "0")).revision, "1");
  assert.equal((await writeLocalStudy(db, state(1), "1")).revision, "2");
});
test("stale and missing revisions cannot overwrite committed records", async (t) => {
  const db = await database(t);
  await ensureLocalStudySchema(db);
  await writeLocalStudy(db, state(1), "0");
  await assert.rejects(writeLocalStudy(db, state(2), "0"), { statusCode: 409 });
  await assert.rejects(writeLocalStudy(db, state(2)), { statusCode: 428 });
  assert.deepEqual((await readLocalStudy(db)).study, state(1));
});
test("two concurrent writers produce one commit; restored values invalidate old versions", async (t) => {
  const db = await database(t);
  await ensureLocalStudySchema(db);
  const results = await Promise.allSettled([
    writeLocalStudy(db, state(1), "0"),
    writeLocalStudy(db, state(2), "0"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      (r) => r.status === "rejected" && r.reason.statusCode === 409,
    ).length,
    1,
  );
  await db.transaction(async (tx) =>
    replaceLocalStudy(tx, state(3), await assertStudyRevision(tx, "1")),
  );
  await assert.rejects(writeLocalStudy(db, state(4), "1"), { statusCode: 409 });
  assert.equal((await readLocalStudy(db)).revision, "2");
});
