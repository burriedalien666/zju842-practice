import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, scrypt } from "node:crypto";
import { promisify } from "node:util";

export function openDatabase(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "site.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS answers (qid TEXT PRIMARY KEY, draft TEXT NOT NULL DEFAULT '[]', published TEXT NOT NULL DEFAULT '[]', updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, qid TEXT NOT NULL, bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS corrections (id INTEGER PRIMARY KEY, qid TEXT NOT NULL, message TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    PRAGMA user_version=1;`);
  return db;
}
export function setPassword(db, password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error("密码须为12—128个字符");
  const salt = randomBytes(24).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  db.exec("BEGIN");
  try {
    db.prepare("INSERT OR REPLACE INTO admin VALUES(1,?,?)").run(salt, hash);
    db.exec("DELETE FROM sessions; COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export async function checkPassword(db, password) {
  const row = db.prepare("SELECT * FROM admin WHERE id=1").get();
  if (!row || typeof password !== "string" || password.length > 128)
    return false;
  const hash = await promisify(scrypt)(password, row.salt, 64);
  return timingSafeEqual(hash, Buffer.from(row.hash, "hex"));
}
