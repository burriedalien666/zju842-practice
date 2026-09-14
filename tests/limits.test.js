import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { setPassword } from "../server/db.js";

test("upload count and byte limits; full draft can replace a photo; data survives reopening", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zju842-limits-"));
  const options = {
    dataDir: dir,
    catalog: { questions: [{ id: "q" }] },
    origin: "http://localhost",
  };
  let app = await createApp(options);
  try {
    await setPassword(app.db, "Isolated-password-842");
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: options.origin },
      payload: { password: "Isolated-password-842" },
    });
    const cookie = login.headers["set-cookie"].split(";")[0];
    const bytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const upload = (data = bytes, suffix = "") =>
      app.inject({
        method: "POST",
        url: "/api/admin/answers/q/photos" + suffix,
        headers: {
          origin: options.origin,
          cookie,
          "content-type": "multipart/form-data; boundary=limit-test",
        },
        payload: Buffer.concat([
          Buffer.from(
            '--limit-test\r\nContent-Disposition: form-data; name="photo"; filename="photo.png"\r\n\r\n',
          ),
          data,
          Buffer.from("\r\n--limit-test--\r\n"),
        ]),
      });
    assert.equal(
      (await upload(Buffer.alloc(12 * 1024 * 1024 + 1))).statusCode,
      413,
    );
    let last;
    for (let i = 0; i < 12; i++) {
      last = await upload();
      assert.equal(last.statusCode, 200);
    }
    assert.equal((await upload()).statusCode, 400);
    const replaced = await upload(bytes, "?replace=" + last.json().draft[0]);
    assert.equal(replaced.statusCode, 200);
    assert.equal(replaced.json().draft.length, 12);
    await app.close();
    app = await createApp(options);
    const saved = await app.inject({
      url: "/api/admin/answers/q",
      headers: { cookie },
    });
    assert.equal(saved.json().draft.length, 12);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("login attempts are rate limited", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zju842-login-"));
  const app = await createApp({
    dataDir: dir,
    catalog: { questions: [] },
    origin: "http://localhost",
  });
  try {
    await setPassword(app.db, "Isolated-password-842");
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/login",
            headers: { origin: "http://localhost" },
            payload: { password: "wrong" },
          })
        ).statusCode,
        401,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          headers: { origin: "http://localhost" },
          payload: { password: "wrong" },
        })
      ).statusCode,
      429,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
