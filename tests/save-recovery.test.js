import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createApp } from "../server/app.js";
import { StudySaver } from "../src/persistence.js";

test("real local-service shutdown and fresh launch session recover staged study without refreshing", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-reconnect-"));
  const reservation = net.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const origin = `http://127.0.0.1:${port}`;
  let app = null,
    cookie = "";
  async function start(token) {
    app = await createApp({
      dataDir: temp,
      catalog: { version: 1, types: [], questions: [] },
      origin,
      local: { baseDir: temp, launchToken: token },
    });
    await app.listen({ host: "127.0.0.1", port });
  }
  async function connect(token) {
    const r = await fetch(origin + "/__open/" + token, { redirect: "manual" });
    cookie = r.headers.get("set-cookie").split(";")[0];
  }
  async function read() {
    const r = await fetch(origin + "/api/local/study", { headers: { cookie } });
    const v = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(v.error), { statusCode: r.status });
    return v;
  }
  t.after(async () => {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await start("first");
  await connect("first");
  const initial = await read();
  const memory = new Map();
  let writes = 0;
  const saver = new StudySaver({
    revision: initial.revision,
    key: "staged",
    storage: {
      getItem: (k) => memory.get(k) || null,
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    },
    readCurrent: read,
    send: async (body, revision) => {
      writes++;
      const r = await fetch(origin + "/api/local/study", {
        method: "PUT",
        headers: {
          cookie,
          Origin: origin,
          "Content-Type": "application/json",
          "If-Match": revision,
        },
        body,
      });
      const value = await r.json();
      if (!r.ok)
        throw Object.assign(new Error(value.error), { statusCode: r.status });
      return value;
    },
  });
  await app.close();
  app = null;
  const pending = {
    version: 1,
    records: { q: { star: true, state: "review" } },
    lists: [],
  };
  await saver.queue(pending);
  assert.equal(saver.dirty, true);
  assert.ok(memory.has("staged"));
  await start("second");
  await saver.retry();
  assert.equal(saver.error.statusCode, 401);
  assert.equal(writes, 1);
  await connect("second");
  await saver.retry();
  assert.equal(saver.dirty, false);
  assert.equal(memory.has("staged"), false);
  assert.deepEqual((await read()).study, pending);
});
