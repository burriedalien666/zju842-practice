import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createApp } from "../server/app.js";
import {
  requestApi,
  createLocalConnection,
  connectionFeedback,
} from "../src/local-connection.js";

test("real stopped service, expired launch session and recovery use the frontend request path", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "842-connection-"));
  const reservation = net.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const realFetch = globalThis.fetch;
  let app,
    cookie = "";
  globalThis.fetch = (url, options = {}) =>
    realFetch(new URL(url, origin), {
      ...options,
      headers: { ...options.headers, cookie },
    });
  t.after(async () => {
    globalThis.fetch = realFetch;
    if (app) await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  async function start(token) {
    app = await createApp({
      dataDir,
      catalog: { version: 1, types: [], questions: [] },
      origin,
      local: { baseDir: dataDir, launchToken: token },
    });
    await app.listen({ host: "127.0.0.1", port });
  }
  async function connect(token) {
    const r = await realFetch(origin + "/__open/" + token, {
      redirect: "manual",
    });
    cookie = r.headers.get("set-cookie").split(";")[0];
  }
  const observed = [];
  const connection = createLocalConnection({
    dataDir,
    onChange: (e) => observed.push(e),
    readInfo: () => requestApi("/local/info", {}, { local: true }),
  });
  await start("first");
  await connect("first");
  assert.equal(await connection.check(), true);
  assert.ok((await requestApi("/local/updates", {}, { local: true })).entries);
  await app.close();
  app = null;
  await assert.rejects(
    requestApi("/local/updates", {}, { local: true }),
    (e) => {
      assert.equal(e.code, "LOCAL_CONNECTION");
      assert.match(connectionFeedback(e).detail, /不要先刷新或关闭/);
      return true;
    },
  );
  assert.equal(await connection.check(), false);
  assert.equal(connection.error.code, "LOCAL_CONNECTION");
  await start("second");
  assert.equal(await connection.check(), false);
  assert.equal(connection.error.statusCode, 401);
  assert.match(connectionFeedback(connection.error).title, /会话已失效/);
  await connect("second");
  assert.equal(await connection.check(), true);
  assert.equal(connection.error, null);
  assert.ok((await requestApi("/local/updates", {}, { local: true })).entries);
  assert.equal(observed.at(-1), null);
});

test("connection probes are single-flight and never accept a different personal directory", async () => {
  let resolve,
    calls = 0;
  const connection = createLocalConnection({
    dataDir: "original",
    onChange() {},
    readInfo: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const a = connection.check(),
    b = connection.check();
  assert.equal(a, b);
  await Promise.resolve();
  resolve({ dataDir: "different" });
  assert.equal(await a, false);
  assert.equal(calls, 1);
  assert.equal(connection.error.code, "LOCAL_DIRECTORY");
  assert.match(connectionFeedback(connection.error).detail, /原程序/);
});
