import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUpdateNotices } from "../server/update-notices.js";

test("completed content notices survive reload; acknowledgement does not remove readback notes", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-notices-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = createUpdateNotices({ dataDir: dir, version: "0.5.6" });
  store.record("library", 3, "新增视频链接");
  store.record("answers", 1, "新增两道题答案");
  store = createUpdateNotices({ dataDir: dir, version: "0.5.6" });
  const all = store.list(null);
  assert.equal(all.length, 2);
  assert.ok(all.every((n) => !n.seen));
  store.acknowledge(all[0].id, null);
  assert.equal(store.list(null).find((n) => n.id === all[0].id).seen, true);
  assert.equal(
    store.list(null).find((n) => n.id === all[0].id).notes,
    all[0].notes,
  );
  assert.throws(() => store.acknowledge("unknown", null));
});

test("legacy launcher success only prompts for the actually committed current program; rollback does not prompt", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-notice-program-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createUpdateNotices({
      dataDir: dir,
      installRoot: dir,
      version: "0.5.6",
    }),
    result = { ok: true, at: 123 };
  assert.equal(store.list(result).length, 0);
  fs.writeFileSync(
    path.join(dir, ".app-current.json"),
    JSON.stringify({ directory: "0.5.6-1234567890abcdef" }),
  );
  assert.equal(store.list({ ...result, ok: false }).length, 0);
  const n = store.list(result)[0];
  assert.equal(n.kind, "program");
  assert.match(n.notes, /视频/);
  store.acknowledge(n.id, result);
  assert.equal(store.list(result)[0].seen, true);
  fs.writeFileSync(path.join(dir, ".app-pending.json"), "{}");
  assert.equal(store.list(result).length, 0);
});
