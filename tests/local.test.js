import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { writeZip, extractPack } from "../server/packs.js";
import { scheduleReview } from "../src/review.js";

test("two local previews have independent browser session cookies", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-port-cookies-"));
  const apps = [];
  const cookies = new Map();
  t.after(async () => {
    for (const app of apps) await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  for (const port of [18845, 18846]) {
    const app = await createApp({
      dataDir: path.join(temp, String(port)),
      catalog: { questions: [], types: [] },
      origin: "http://127.0.0.1:" + port,
      local: { baseDir: temp, launchToken: "launch-" + port },
    });
    apps.push(app);
    const response = await app.inject({
      url: "/__open/launch-" + port,
      headers: { host: "127.0.0.1:" + port },
    });
    assert.equal(response.statusCode, 302);
    const pair = response.headers["set-cookie"].split(";")[0],
      separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  assert.equal(cookies.size, 2);
  const cookie = [...cookies]
    .map(([key, value]) => key + "=" + value)
    .join("; ");
  for (const [i, port] of [18845, 18846].entries()) {
    const response = await apps[i].inject({
      url: "/api/local/study",
      headers: { host: "127.0.0.1:" + port, cookie },
    });
    assert.equal(response.statusCode, 200);
  }
});
async function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-local-test-")),
    baseDir = path.join(temp, "base"),
    dataDir = path.join(temp, "user");
  fs.mkdirSync(path.join(baseDir, "questions"), { recursive: true });
  const image = await sharp({
    create: { width: 12, height: 20, channels: 3, background: "white" },
  })
    .webp()
    .toBuffer();
  fs.writeFileSync(path.join(baseDir, "questions/test.webp"), image);
  const catalog = {
    version: 1,
    types: [
      {
        id: "t",
        subject: "signals",
        group: "g",
        groupTitle: "测试",
        title: "测试",
      },
    ],
    questions: [
      {
        id: "q",
        subject: "signals",
        sourceKind: "entrance",
        year: 2025,
        number: "1",
        title: "题目",
        typeId: "t",
        sourceTitle: "测试卷",
        tags: [],
        images: [{ src: "questions/test.webp", width: 12, height: 20 }],
      },
    ],
  };
  fs.writeFileSync(path.join(baseDir, "catalog.json"), JSON.stringify(catalog));
  const origin = "http://127.0.0.1:18843",
    token = "test-private-launch-token";
  const app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: { baseDir, launchToken: token },
  });
  t.after(async () => {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const auth = await app.inject({
    url: "/__open/" + token,
    headers: { host: "127.0.0.1:18843" },
  });
  assert.equal(auth.statusCode, 302);
  const cookie = auth.headers["set-cookie"].split(";")[0];
  const request = async (method, url, payload, extra = {}) => {
    let version = {};
    if (
      ((method === "PUT" && url === "/api/local/study") ||
        (method === "POST" && url === "/api/local/restore")) &&
      !Object.hasOwn(extra, "if-match") &&
      extra.cookie !== ""
    ) {
      const read = await app.inject({
        url: "/api/local/study",
        headers: { host: "127.0.0.1:18843", origin, cookie },
      });
      version = { "if-match": read.json().revision };
    }
    return app.inject({
      method,
      url,
      payload,
      headers: {
        host: "127.0.0.1:18843",
        origin,
        cookie,
        ...version,
        ...extra,
      },
    });
  };
  const upload = (url, bytes) =>
    request(
      "POST",
      url,
      Buffer.concat([
        Buffer.from(
          '--test842\r\nContent-Disposition: form-data; name="file"; filename="file.bin"\r\nContent-Type: application/octet-stream\r\n\r\n',
        ),
        bytes,
        Buffer.from("\r\n--test842--\r\n"),
      ]),
      { "content-type": "multipart/form-data; boundary=test842" },
    );
  return { app, temp, baseDir, dataDir, catalog, image, request, upload };
}
test("local session blocks cross-site and rebinding requests", async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request("GET", "/api/local/study", undefined, { cookie: "" }))
      .statusCode,
    401,
  );
  assert.equal(
    (await request("GET", "/api/admin/answers/q", undefined, { cookie: "" }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await request(
        "PUT",
        "/api/local/study",
        {},
        { origin: "https://evil.test" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request("GET", "/api/local/study", undefined, {
        host: "evil.test:18843",
      })
    ).statusCode,
    403,
  );
  assert.equal((await request("GET", "/api/session")).json().local, true);
});
test("pack updates preserve personal photos and review; private backup restores both", async (t) => {
  const { request, upload, image, temp } = await fixture(t);
  const study = {
    version: 2,
    records: {
      q: {
        state: "review",
        star: true,
        review: scheduleReview(null, "wrong", {}, Date.now()),
      },
    },
    settings: { intervals: [1, 3, 7] },
    examDate: "2026-12-19",
    papers: { 2025: { started: 1000, finished: null, marks: { q: "wrong" } } },
    lists: [],
  };
  assert.equal(
    (await request("PUT", "/api/local/study", study)).statusCode,
    200,
  );
  const uploaded = await upload("/api/admin/answers/q/photos", image);
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const photo = uploaded.json().draft[0];
  const personalOnly = await request("POST", "/api/local/export-pack", {
    ids: [],
    edition: "without-private",
  });
  const check1 = path.join(temp, "private-check.842pack");
  fs.writeFileSync(check1, personalOnly.rawPayload);
  fs.mkdirSync(path.join(temp, "unpack1"));
  assert.deepEqual(
    (await extractPack(check1, path.join(temp, "unpack1"))).officialAnswers,
    {},
  );
  await request("POST", "/api/admin/answers/q/publish");
  const pack = await request("POST", "/api/local/export-pack", {
    ids: ["q"],
    edition: "v2",
  });
  assert.equal(pack.statusCode, 200);
  const installed = await upload("/api/local/import-pack", pack.rawPayload);
  assert.equal(installed.statusCode, 200, installed.body);
  assert.equal((await request("GET", "/catalog.json")).json().edition, "v2");
  assert.deepEqual(
    (await request("GET", "/api/local/study")).json().study,
    study,
  );
  assert.deepEqual(
    (await request("GET", "/api/admin/answers/q")).json().draft,
    [photo],
  );
  const official = (await request("GET", "/api/local/official/q")).json();
  assert.equal(official.photos.length, 1);
  assert.equal((await request("GET", official.photos[0])).statusCode, 200);
  const snapshot = await request("GET", "/api/local/backup");
  assert.equal(snapshot.statusCode, 200);
  await request("PUT", "/api/local/study", {
    version: 1,
    records: {},
    lists: [],
  });
  await request("POST", "/api/admin/answers/q/withdraw");
  await request("PUT", "/api/admin/answers/q/draft", { photos: [] });
  const restored = await upload("/api/local/restore", snapshot.rawPayload);
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(
    (await request("GET", "/api/local/study")).json().study,
    study,
  );
  assert.equal((await request("GET", "/api/media/" + photo)).statusCode, 200);
});
test("untrusted pack rejected without changing installed library", async (t) => {
  const { request, upload, temp, catalog } = await fixture(t);
  const file = path.join(temp, "bad.zip");
  await writeZip(file, [
    { name: "catalog.json", bytes: Buffer.from(JSON.stringify(catalog)) },
    { name: "server/evil.js", bytes: Buffer.from("bad") },
  ]);
  const result = await upload("/api/local/import-pack", fs.readFileSync(file));
  assert.equal(result.statusCode, 400);
  assert.equal(
    (await request("GET", "/catalog.json")).json().questions[0].id,
    "q",
  );
});

test("HTTP rejects stale and missing study versions without replacing the first tab data", async (t) => {
  const { app, request } = await fixture(t);
  const revision = (await request("GET", "/api/local/study")).json().revision;
  const first = {
    version: 1,
    records: { q: { state: "", star: true } },
    lists: [],
  };
  const second = {
    version: 1,
    records: { q: { state: "review", star: false } },
    lists: [],
  };
  assert.equal(
    (await request("PUT", "/api/local/study", first, { "if-match": revision }))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("PUT", "/api/local/study", second, { "if-match": revision }))
      .statusCode,
    409,
  );
  assert.equal(
    (await request("PUT", "/api/local/study", second, { "if-match": "" }))
      .statusCode,
    428,
  );
  const latest = (await request("GET", "/api/local/study")).json();
  assert.deepEqual(latest.study, first);
  assert.equal(latest.revision, "1");
});

test("backup restore increments revision; stale restore is refused before changing photos", async (t) => {
  const { request, upload } = await fixture(t);
  const study = {
    version: 1,
    records: { q: { state: "review", star: true } },
    lists: [],
  };
  await request("PUT", "/api/local/study", study);
  const snapshot = await request("GET", "/api/local/backup");
  const before = (await request("GET", "/api/local/study")).json().revision;
  await request("PUT", "/api/local/study", {
    version: 1,
    records: {},
    lists: [],
  });
  const boundary = "restore-test";
  const payload = Buffer.concat([
    Buffer.from(
      "--" +
        boundary +
        '\r\nContent-Disposition: form-data; name="file"; filename="backup.sqlite"\r\n\r\n',
    ),
    snapshot.rawPayload,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  const stale = await request("POST", "/api/local/restore", payload, {
    "if-match": before,
    "content-type": "multipart/form-data; boundary=" + boundary,
  });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(
    (await request("GET", "/api/local/study")).json().study.records,
    {},
  );
  assert.equal(
    (await upload("/api/local/restore", snapshot.rawPayload)).statusCode,
    200,
  );
  const restored = (await request("GET", "/api/local/study")).json();
  assert.deepEqual(restored.study, study);
  assert.equal(restored.revision, "3");
});
