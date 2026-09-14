import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { setPassword } from "../server/db.js";

const origin = "http://127.0.0.1:8843";
const catalog = { questions: [{ id: "2009|一|1" }, { id: "second" }] };
const q = encodeURIComponent(catalog.questions[0].id);
async function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zju842-test-"));
  const app = await createApp({ dataDir: dir, catalog, origin, ...extra });
  await setPassword(app.db, "Test-only-password-842!");
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const requestOrigin = extra.origin || origin;
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: requestOrigin },
    payload: { password: "Test-only-password-842!" },
  });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers["set-cookie"], /HttpOnly/);
  if (extra.production) assert.match(login.headers["set-cookie"], /Secure/);
  const cookie = login.headers["set-cookie"].split(";")[0];
  const request = (method, url, payload, auth = true) =>
    app.inject({
      method,
      url,
      payload,
      headers: { origin: requestOrigin, ...(auth ? { cookie } : {}) },
    });
  const upload = async (id = q, content, suffix = "") => {
    const bytes =
      content ||
      (await sharp({
        create: { width: 24, height: 40, channels: 3, background: "#ffffff" },
      })
        .png()
        .toBuffer());
    const boundary = "test-boundary-842";
    return app.inject({
      method: "POST",
      url: `/api/admin/answers/${id}/photos${suffix}`,
      headers: {
        origin,
        cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="answer.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  };
  return { app, cookie, request, upload };
}
test("session is HttpOnly; unauthorized and cross-origin writes are blocked", async (t) => {
  const { app, request, cookie } = await fixture(t);
  for (const [method, url, payload] of [
    ["GET", `/api/admin/answers/${q}`],
    ["POST", `/api/admin/answers/${q}/photos`],
    ["PUT", `/api/admin/answers/${q}/draft`, { photos: [] }],
    ["POST", `/api/admin/answers/${q}/publish`],
    ["POST", `/api/admin/answers/${q}/withdraw`],
    ["POST", `/api/admin/answers/${q}/rotate/abc`],
    ["GET", "/api/admin/corrections"],
    ["PATCH", "/api/admin/corrections/1", { resolved: true }],
  ])
    assert.equal(
      (await request(method, url, payload, false)).statusCode,
      401,
      url,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/logout",
        headers: { cookie, origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/logout",
        headers: { cookie },
      })
    ).statusCode,
    403,
  );
  assert.equal((await request("GET", "/api/session")).json().admin, true);
  await request("POST", "/api/logout");
  assert.equal((await request("GET", "/api/session")).json().admin, false);
});
test("draft, publication, replacement, rotation, withdrawal, and media isolation", async (t) => {
  const { app, request, upload, cookie } = await fixture(t);
  const uploaded = await upload();
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const first = uploaded.json().draft[0];
  assert.deepEqual(
    (await request("GET", `/api/answers/${q}`, undefined, false)).json().photos,
    [],
  );
  assert.equal(
    (await request("GET", "/api/media/" + first, undefined, false)).statusCode,
    404,
  );
  const media = await app.inject({
    url: "/api/media/" + first,
    headers: { cookie },
  });
  assert.equal(media.statusCode, 200);
  assert.equal(media.headers["cache-control"], "no-store");
  const meta = await sharp(media.rawPayload).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  await request("POST", `/api/admin/answers/${q}/publish`);
  assert.equal(
    (await request("GET", "/api/media/" + first, undefined, false)).statusCode,
    200,
  );
  const rotated = await request(
    "POST",
    `/api/admin/answers/${q}/rotate/${first}`,
  );
  const second = rotated.json().draft[0];
  assert.notEqual(first, second);
  assert.deepEqual(rotated.json().published, [first]);
  assert.equal(
    (await request("GET", "/api/media/" + second, undefined, false)).statusCode,
    404,
  );
  assert.equal(
    (
      await sharp(
        (await request("GET", "/api/media/" + second)).rawPayload,
      ).metadata()
    ).width,
    40,
  );
  const third = (await upload(q, undefined, "?replace=" + second)).json()
    .draft[0];
  assert.equal((await request("GET", "/api/media/" + second)).statusCode, 404);
  await request("POST", `/api/admin/answers/${q}/publish`);
  assert.equal(
    (await request("GET", "/api/media/" + first, undefined, false)).statusCode,
    404,
  );
  assert.equal(
    (await request("GET", "/api/media/" + third, undefined, false)).statusCode,
    200,
  );
  await request("POST", `/api/admin/answers/${q}/withdraw`);
  assert.equal(
    (await request("GET", "/api/media/" + third, undefined, false)).statusCode,
    404,
  );
  assert.equal((await request("GET", "/api/media/" + third)).statusCode, 200);
  await request("PUT", `/api/admin/answers/${q}/draft`, { photos: [] });
  assert.equal((await request("GET", "/api/media/" + third)).statusCode, 404);
});
test("invalid content, order, duplicates and cross-question photo use", async (t) => {
  const { request, upload } = await fixture(t);
  assert.equal(
    (await upload(q, Buffer.from('<svg onload="alert(1)"></svg>'))).statusCode,
    400,
  );
  assert.equal((await upload("missing")).statusCode, 404);
  const first = (await upload()).json().draft[0];
  const both = (await upload()).json().draft;
  assert.equal(
    (
      await request("PUT", `/api/admin/answers/${q}/draft`, {
        photos: [first, first],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("PUT", "/api/admin/answers/second/draft", {
        photos: [first],
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(
    (
      await request("PUT", `/api/admin/answers/${q}/draft`, {
        photos: [...both].reverse(),
      })
    ).json().draft,
    [...both].reverse(),
  );
  assert.equal(
    (await request("POST", "/api/admin/answers/second/publish")).statusCode,
    400,
  );
});
test("anonymous corrections are validated, private, rate limited and resolvable", async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (
      await request(
        "POST",
        "/api/corrections",
        { questionId: "missing", message: "这里的图片不完整" },
        false,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/corrections",
        { questionId: catalog.questions[0].id, message: "短" },
        false,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/corrections",
        {
          questionId: catalog.questions[0].id,
          message: "这里的图片不完整<script>alert(1)</script>",
        },
        false,
      )
    ).statusCode,
    201,
  );
  const items = (await request("GET", "/api/admin/corrections")).json().items;
  assert.equal(items.length, 1);
  await request("PATCH", "/api/admin/corrections/" + items[0].id, {
    resolved: true,
  });
  assert.equal(
    (await request("GET", "/api/admin/corrections")).json().items[0].resolved,
    1,
  );
  for (let i = 0; i < 2; i++)
    await request("POST", "/api/corrections", {}, false);
  assert.equal(
    (await request("POST", "/api/corrections", {}, false)).statusCode,
    429,
  );
});
test("password reset invalidates sessions; production cookie uses Secure", async (t) => {
  const { app, request } = await fixture(t);
  await setPassword(app.db, "Different-test-password!");
  assert.equal((await request("GET", "/api/session")).json().admin, false);
  const p = await fixture(t, {
    origin: "https://study.example",
    production: true,
  });
  assert.equal((await p.request("GET", "/api/session")).json().admin, true);
  assert.equal(
    (
      await p.app.inject({
        method: "POST",
        url: "/api/logout",
        headers: { origin, cookie: p.cookie },
      })
    ).statusCode,
    403,
  );
});
test("actual build serves questions but no private files", async (t) => {
  const { app } = await fixture(t, { staticDir: path.resolve("dist") });
  for (const url of ["/", "/catalog.json", "/questions/q-2009-01-02.webp"])
    assert.equal((await app.inject(url)).statusCode, 200, url);
  for (const url of [
    "/data/site.sqlite",
    "/.env",
    "/server/app.js",
    "/api/admin%2fanswers/test",
    "/questions/../data/site.sqlite",
  ])
    assert.notEqual((await app.inject(url)).statusCode, 200, url);
});
