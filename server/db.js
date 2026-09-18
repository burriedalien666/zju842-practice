import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const schema = [
  "CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS answers (qid TEXT PRIMARY KEY, draft TEXT NOT NULL DEFAULT '[]', published TEXT NOT NULL DEFAULT '[]', updated TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, qid TEXT NOT NULL, bytes BLOB NOT NULL)",
  "CREATE TABLE IF NOT EXISTS corrections (id INTEGER PRIMARY KEY, qid TEXT NOT NULL, message TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS photos_question ON photos(qid)",
];
function queries(execute) {
  return {
    async get(sql, ...args) {
      return (await execute({ sql, args })).rows[0];
    },
    async all(sql, ...args) {
      return (await execute({ sql, args })).rows;
    },
    async run(sql, ...args) {
      return execute({ sql, args });
    },
  };
}

function localClient(file) {
  const sqlite = new DatabaseSync(file);
  sqlite.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA user_version=1;",
  );
  const execute = async (statement) => {
    const { sql, args = [] } =
      typeof statement === "string" ? { sql: statement } : statement;
    const query = sqlite.prepare(sql);
    if (query.columns().length)
      return { rows: query.all(...args), rowsAffected: 0 };
    return { rows: [], rowsAffected: Number(query.run(...args).changes) };
  };
  return {
    execute,
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) await execute(sql);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async transaction() {
      sqlite.exec("BEGIN IMMEDIATE");
      let closed = false;
      return {
        execute,
        get closed() {
          return closed;
        },
        async commit() {
          sqlite.exec("COMMIT");
          closed = true;
        },
        async rollback() {
          sqlite.exec("ROLLBACK");
          closed = true;
        },
        close() {
          if (!closed) {
            sqlite.exec("ROLLBACK");
            closed = true;
          }
        },
      };
    },
    close() {
      sqlite.close();
    },
  };
}
export async function openDatabase(dir, { url, authToken } = {}) {
  if (!!url !== !!authToken)
    throw new Error("TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN 必须同时配置");
  if (url) {
    const parsed = new URL(url);
    if (
      !["https:", "libsql:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Turso 地址须为 HTTPS 或 libsql 地址");
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  const client = url
    ? (await import("@libsql/client/web")).createClient({ url, authToken })
    : localClient(path.resolve(dir, "site.sqlite"));
  try {
    // 云端不支持 journal_mode/user_version；现有表结构可以直接沿用。
    await client.batch(schema, "write");
  } catch (error) {
    client.close();
    throw error;
  }
  // 同一连接的读取不能插入尚未提交的写事务，尤其是草稿和公开答案检查。
  let pending = Promise.resolve();
  const exclusive = (fn) => {
    const result = pending.then(fn);
    pending = result.catch(() => {});
    return result;
  };
  return {
    ...queries((statement) => exclusive(() => client.execute(statement))),
    async transaction(fn) {
      return exclusive(async () => {
        const tx = await client.transaction("write");
        try {
          const result = await fn(
            queries((statement) => tx.execute(statement)),
          );
          await tx.commit();
          return result;
        } catch (error) {
          if (!tx.closed) await tx.rollback();
          throw error;
        } finally {
          tx.close();
        }
      });
    },
    async close() {
      await pending;
      client.close();
    },
  };
}
export async function setPassword(db, password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error("密码须为12—128个字符");
  const salt = randomBytes(24).toString("hex");
  const hash = (await deriveKey(password, salt, 64)).toString("hex");
  await db.transaction(async (tx) => {
    await tx.run("INSERT OR REPLACE INTO admin VALUES(1,?,?)", salt, hash);
    await tx.run("DELETE FROM sessions");
  });
}
export async function checkPassword(db, password) {
  if (typeof password !== "string" || password.length > 128) return false;
  const row = await db.get("SELECT * FROM admin WHERE id=1");
  if (!row) return false;
  const hash = await deriveKey(password, row.salt, 64);
  return timingSafeEqual(hash, Buffer.from(row.hash, "hex"));
}
