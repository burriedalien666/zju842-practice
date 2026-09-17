import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { writeZip, extractPack } from "../server/packs.js";
import { scheduleReview } from "../src/review.js";
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
  const request = (method, url, payload, extra = {}) =>
    app.inject({
      method,
      url,
      payload,
      headers: { host: "127.0.0.1:18843", origin, cookie, ...extra },
    });
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
