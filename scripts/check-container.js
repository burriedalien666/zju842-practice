import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const name = "zju842-test-" + randomUUID();
const volume = name + "-data";
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const node = (code) =>
  docker("exec", name, "node", "--input-type=module", "-e", code);
async function ready() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      node(
        "const r=await fetch('http://127.0.0.1:8843/api/health'); if(!r.ok)process.exit(1)",
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Container did not become ready");
}
try {
  docker("volume", "create", volume);
  docker(
    "run",
    "--detach",
    "--name",
    name,
    "--env",
    "NODE_ENV=development",
    "--env",
    "PUBLIC_ORIGIN=http://127.0.0.1:8843",
    "--mount",
    `source=${volume},target=/app/data`,
    "zju842-test",
  );
  await ready();
  node(
    "const r=await fetch('http://127.0.0.1:8843/catalog.json'); const c=await r.json(); if(c.questions.length<469)process.exit(1)",
  );
  node(
    "import {openDatabase} from './server/db.js'; const db=await openDatabase('/app/data'); await db.run('INSERT INTO corrections(qid,message,created) VALUES(?,?,?)','2009|一|1','container persistence test',new Date().toISOString()); await db.close()",
  );
  docker("restart", name);
  await ready();
  assert.equal(
    node(
      "import {openDatabase} from './server/db.js'; const db=await openDatabase('/app/data'); console.log((await db.get('SELECT COUNT(*) AS n FROM corrections')).n); await db.close()",
    ),
    "1",
  );
  assert.equal(node("console.log(process.getuid())"), "1000");
  console.log(
    "Container starts, serves the catalog, runs without root, and retains its database across restart.",
  );
} catch (error) {
  try {
    console.error(docker("logs", name));
  } catch {
    /* 容器创建失败时没有日志。 */
  }
  throw error;
} finally {
  // 仅清理由本次测试唯一命名的临时容器和卷。
  try {
    docker("rm", "--force", name);
  } catch {
    /* 尚未创建。 */
  }
  try {
    docker("volume", "rm", volume);
  } catch {
    /* 尚未创建。 */
  }
}
