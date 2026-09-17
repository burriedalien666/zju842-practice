import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { packPaths, writeZip } from "../server/packs.js";
import { buildChapters } from "../src/chapters.js";
import { validateStudy } from "../src/study.js";

test("r1 to actual r2 library upgrade preserves all study records and installs annotated catalog", async (t) => {
  const catalog = JSON.parse(fs.readFileSync("public/catalog.json"));
  const old = structuredClone(catalog);
  delete old.curriculum;
  delete old.videoLessons;
  old.libraryRevision = 1;
  for (const q of old.questions) {
    delete q.primaryChapter;
    delete q.knowledgeIds;
    delete q.trainingIds;
    delete q.score;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-analysis-upgrade-"));
  const app = await createApp({
    dataDir: dir,
    catalog: old,
    origin: "http://127.0.0.1:18992",
    local: { baseDir: path.resolve("public"), launchToken: "test-token" },
  });
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const headers = {
    host: "127.0.0.1:18992",
    origin: "http://127.0.0.1:18992",
    cookie: "local_session_18992=test-token",
  };
  const before = (
    await app.inject({ url: "/api/local/study", headers })
  ).json();
  const study = validateStudy(
    {
      version: 2,
      records: { [catalog.questions[0].id]: { star: true, state: "review" } },
      lists: [{ name: "保留题单", ids: [catalog.questions[10].id] }],
    },
    new Set(catalog.questions.map((q) => q.id)),
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/api/local/study",
        headers: { ...headers, "if-match": before.revision },
        payload: study,
      })
    ).statusCode,
    200,
  );
  const file = path.join(dir, "incoming.842pack"),
    next = { ...catalog, updateKind: "library" };
  await writeZip(file, [
    { name: "catalog.json", bytes: Buffer.from(JSON.stringify(next)) },
    ...[...packPaths(next)]
      .filter((n) => n !== "catalog.json")
      .map((name) => ({ name, file: path.resolve("public", name) })),
  ]);
  const payload = Buffer.concat([
    Buffer.from(
      '--fixture\r\nContent-Disposition: form-data; name="file"; filename="incoming.842pack"\r\nContent-Type: application/octet-stream\r\n\r\n',
    ),
    fs.readFileSync(file),
    Buffer.from("\r\n--fixture--\r\n"),
  ]);
  const response = await app.inject({
    method: "POST",
    url: "/api/local/import-pack",
    headers: {
      ...headers,
      "content-type": "multipart/form-data; boundary=fixture",
    },
    payload,
  });
  assert.equal(response.statusCode, 200, response.body);
  const installed = (
    await app.inject({ url: "/catalog.json", headers })
  ).json();
  assert.equal(installed.libraryRevision, 2);
  assert.equal(buildChapters(installed).length, 18);
  assert.deepEqual(
    (await app.inject({ url: "/api/local/study", headers })).json().study,
    study,
  );
  assert.deepEqual(
    installed.questions.map((q) => q.id),
    catalog.questions.map((q) => q.id),
  );
});
