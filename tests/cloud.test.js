import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { openDatabase, setPassword } from "../server/db.js";
import { readConfig } from "../server/config.js";
import { createApp } from "../server/app.js";

test("Render uses HTTPS origin and refuses ephemeral storage", () => {
  const root = path.resolve(".");
  assert.throws(() => readConfig({ RENDER: "true" }, root), /Turso/);
  assert.throws(
    () => readConfig({ TURSO_DATABASE_URL: "libsql://example.turso.io" }, root),
    /同时配置/,
  );
  assert.throws(
    () => readConfig({ TURSO_AUTH_TOKEN: "test" }, root),
    /同时配置/,
  );
  const c = readConfig(
    {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://example.onrender.com",
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "fixture-token",
      PORT: "10000",
    },
    root,
  );
  assert.equal(c.origin, "https://example.onrender.com");
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.production, true);
  assert.equal(c.port, 10000);
  assert.equal(c.trustProxy, false);
  assert.throws(
    () => readConfig({ TRUST_PROXY_CIDRS: "true" }, root),
    /可信代理/,
  );
  assert.deepEqual(
    readConfig({ TRUST_PROXY_CIDRS: "127.0.0.1,10.0.0.0/8" }, root).trustProxy,
    ["127.0.0.1", "10.0.0.0/8"],
  );
});

test("invalid remote settings rejected before file or network access", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-cloud-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = path.join(dir, "must-not-exist");
  await assert.rejects(
    openDatabase(missing, { url: "https://example.turso.io" }),
    /同时配置/,
  );
  for (const url of [
    "file:///private.sqlite",
    "http://example.turso.io",
    "libsql://example.turso.io?tls=0",
    "https://user:pass@example.turso.io",
  ])
    await assert.rejects(openDatabase(missing, { url, authToken: "fixture" }));
  assert.equal(fs.existsSync(missing), false);
});

test("failed cloud connection never creates a local database", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-cloud-fail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let attempted = false;
  t.mock.method(globalThis, "fetch", async () => {
    attempted = true;
    throw new Error("isolated network failure");
  });
  await assert.rejects(
    openDatabase(path.join(dir, "local"), {
      url: "https://database.invalid",
      authToken: "fixture-token",
    }),
  );
  assert.equal(attempted, true);
  assert.equal(fs.existsSync(path.join(dir, "local")), false);
});

test("async transactions preserve concurrent writes and roll back failed photo inserts", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-cloud-tx-"));
  const db = await openDatabase(dir);
  t.after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.run(
        "INSERT INTO photos VALUES(?,?,?)",
        "orphan",
        "q",
        Buffer.from("bytes"),
      );
      throw new Error("simulated failure");
    }),
    /simulated failure/,
  );
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM photos")).n, 0);
  await db.run(
    "INSERT INTO answers VALUES(?,?,?,?)",
    "q",
    "[]",
    "[]",
    "initial",
  );
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      db.transaction(async (tx) => {
        const row = await tx.get("SELECT draft FROM answers WHERE qid=?", "q");
        await Promise.resolve();
        await tx.run(
          "UPDATE answers SET draft=? WHERE qid=?",
          JSON.stringify([...JSON.parse(row.draft), String(i)]),
          "q",
        );
      }),
    ),
  );
  assert.equal(
    JSON.parse(
      (await db.get("SELECT draft FROM answers WHERE qid=?", "q")).draft,
    ).length,
    8,
  );
  const bytes = randomBytes(3 * 1024 * 1024);
  await db.run("INSERT INTO photos VALUES(?,?,?)", "large", "q", bytes);
  assert.deepEqual(
    Buffer.from(
      (await db.get("SELECT bytes FROM photos WHERE id=?", "large")).bytes,
    ),
    bytes,
  );
});

test("existing SQLite answers survive the async migration", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-old-db-"));
  const old = new DatabaseSync(path.join(dir, "site.sqlite"));
  old.exec(
    "CREATE TABLE answers(qid TEXT PRIMARY KEY,draft TEXT NOT NULL,published TEXT NOT NULL,updated TEXT NOT NULL)",
  );
  old
    .prepare("INSERT INTO answers VALUES(?,?,?,?)")
    .run("q", '["a"]', '["a"]', "old");
  old.close();
  const db = await openDatabase(dir);
  t.after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(
    (await db.get("SELECT published FROM answers WHERE qid=?", "q")).published,
    '["a"]',
  );
});

test("async authentication never treats an unresolved Promise as permission", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-auth-async-"));
  const app = await createApp({
    dataDir: dir,
    catalog: { questions: [{ id: "q" }] },
    origin: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await setPassword(app.db, "test-password-only-842");
  assert.equal((await app.inject("/api/session")).json().admin, false);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => app.inject("/api/admin/answers/q")),
  );
  assert.ok(results.every((r) => r.statusCode === 401));
  const address = await app.listen({host:"127.0.0.1",port:0});
  const health = await fetch(address + "/api/health");
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{ok:true});
  assert.equal((await fetch(address + "/api/admin/corrections")).status,401);
});
