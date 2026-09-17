import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { writeZip } from "../server/packs.js";
import { extractAnswers } from "../server/answer-packs.js";
import { validateManifest, GitHubUpdates } from "../server/update-source.js";
import { newer, extractUpdateZip } from "../server/update-files.js";
import { stageProgram } from "../server/updates.js";

function manifest() {
  const asset = (name) => ({ name, release: "v0.5.0", size: 100 });
  return {
    format: 1,
    libraryId: "zju842",
    program: {
      version: "0.5.0",
      protocol: 1,
      assets: Object.fromEntries(
        ["windows-x64", "macos-x64", "macos-arm64"].map((p) => [
          p,
          asset(`zju842-0.5.0-${p}.zip`),
        ]),
      ),
    },
    library: {
      revision: 2,
      edition: "题库2",
      requiresProgram: "0.4.0",
      asset: asset("library.842pack"),
    },
    answers: {
      revision: 1,
      edition: "答案1",
      requiresProgram: "0.4.0",
      requiresLibraryRevision: 2,
      asset: asset("answers.842answers"),
    },
  };
}
async function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-updates-"));
  const baseDir = path.join(temp, "public"),
    dataDir = path.join(temp, "user");
  fs.mkdirSync(path.join(baseDir, "questions"), { recursive: true });
  const image = await sharp({
    create: { width: 12, height: 20, channels: 3, background: "white" },
  })
    .webp()
    .toBuffer();
  fs.writeFileSync(path.join(baseDir, "questions/q.webp"), image);
  const catalog = {
    version: 1,
    libraryId: "zju842",
    libraryRevision: 1,
    edition: "题库1",
    types: [
      {
        id: "t",
        title: "类型",
        subject: "signals",
        group: "g",
        groupTitle: "章节",
      },
    ],
    questions: [
      {
        id: "q",
        subject: "signals",
        typeId: "t",
        sourceKind: "entrance",
        year: 2025,
        number: "1",
        title: "题目",
        sourceTitle: "测试",
        tags: [],
        images: [{ src: "questions/q.webp", width: 12, height: 20 }],
      },
    ],
  };
  const source = {
    checks: 0,
    manifest: manifest(),
    files: {},
    async check() {
      this.checks++;
      return structuredClone(this.manifest);
    },
    async download(a, f, progress) {
      if (this.wait) await this.wait;
      if (this.error) throw new Error(this.error);
      fs.copyFileSync(this.files[a.name], f);
      progress(fs.statSync(f).size, fs.statSync(f).size);
    },
  };
  const origin = "http://127.0.0.1:18847",
    token = "fixture";
  const app = await createApp({
    dataDir,
    catalog,
    origin,
    local: { baseDir, launchToken: token, updateSource: source },
  });
  const request = (method, url, payload, extra = {}) =>
    app.inject({
      method,
      url,
      payload,
      headers: {
        host: "127.0.0.1:18847",
        origin,
        cookie: "local_session_18847=fixture",
        ...extra,
      },
    });
  t.after(async () => {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  async function makeLibrary(extra = {}) {
    const file = path.join(
      temp,
      "library-" + Object.keys(source.files).length + ".zip",
    );
    await writeZip(file, [
      {
        name: "catalog.json",
        bytes: Buffer.from(
          JSON.stringify({
            ...catalog,
            libraryRevision: 2,
            updateKind: "library",
            ...extra,
          }),
        ),
      },
      { name: "questions/q.webp", bytes: image },
    ]);
    source.files["library.842pack"] = file;
    return file;
  }
  async function makeAnswers(extra = {}) {
    const file = path.join(
      temp,
      "answers-" + Object.keys(source.files).length + ".zip",
    );
    await writeZip(file, [
      {
        name: "answers.json",
        bytes: Buffer.from(
          JSON.stringify({
            format: 1,
            kind: "answers",
            libraryId: "zju842",
            revision: 1,
            edition: "答案1",
            requiresLibraryRevision: 2,
            answers: { q: ["answers/a.webp"] },
            ...extra,
          }),
        ),
      },
      { name: "answers/a.webp", bytes: image },
    ]);
    source.files["answers.842answers"] = file;
    return file;
  }
  async function start(kind, extra = {}) {
    const revision = (await request("GET", "/api/local/study")).json().revision;
    return request(
      "POST",
      "/api/local/updates/install",
      { kind, target: kind === "library" ? 2 : 1 },
      { "if-match": revision, ...extra },
    );
  }
  async function completed() {
    for (let i = 0; i < 400; i++) {
      const value = (await request("GET", "/api/local/updates")).json();
      if (["done", "failed"].includes(value.job?.state)) return value;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("update did not finish");
  }
  return {
    temp,
    baseDir,
    dataDir,
    image,
    catalog,
    source,
    app,
    request,
    makeLibrary,
    makeAnswers,
    start,
    completed,
  };
}

test("update manifest validates platform assets and numeric versions, not arbitrary URLs", () => {
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("0.4.0", "0.4.0"), false);
  const m = manifest();
  assert.equal(validateManifest(m), m);
  m.library.asset.name = "../../.env";
  assert.throws(() => validateManifest(m));
  m.library.asset.name = "evil.842answers";
  assert.throws(() => validateManifest(m));
});
test("trusted downloads reject off-site redirects and incomplete bytes", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-network-"));
  const headerCheck = new GitHubUpdates(async (url, options) => {
    assert.equal(options.headers.Accept, "application/vnd.github+json");
    return new Response("{}");
  });
  await headerCheck.json("https://api.github.com/repos/test/releases/latest");
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const malicious = new GitHubUpdates(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
  );
  await assert.rejects(
    malicious.response("https://github.com/example"),
    /可信/,
  );
  const short = new GitHubUpdates(async () => new Response("abc"));
  await assert.rejects(
    short.download(
      { release: "v0.4.0", name: "test.zip", size: 5 },
      path.join(temp, "short"),
      () => {},
    ),
    /不完整/,
  );
  const large = new GitHubUpdates(async () => new Response("abcdef"));
  await assert.rejects(
    large.download(
      { release: "v0.4.0", name: "test.zip", size: 5 },
      path.join(temp, "large"),
      () => {},
    ),
    /大小/,
  );
});
test("update endpoints require local session and same-origin; disabling auto-check makes no network request", async (t) => {
  const { request, source } = await fixture(t);
  assert.equal(
    (await request("POST", "/api/local/updates/check", {}, { cookie: "" }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/local/updates/check",
        {},
        { origin: "https://evil.test" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("PUT", "/api/local/updates/settings", { autoCheck: false }))
      .statusCode,
    200,
  );
  await request("POST", "/api/local/updates/check", { automatic: true });
  assert.equal(source.checks, 0);
  await request("POST", "/api/local/updates/check", {});
  assert.equal(source.checks, 1);
  await request("PUT", "/api/local/updates/settings", { autoCheck: true });
  await request("POST", "/api/local/updates/check", { automatic: true });
  assert.equal(source.checks, 1, "startup reuses six-hour metadata cache");
  assert.equal(
    (await request("GET", "/api/local/updates")).json().job,
    null,
    "checks never download or install",
  );
});
test("library and answers install independently, preserve personal rows and enforce answer dependencies", async (t) => {
  const { request, app, makeLibrary, makeAnswers, start, completed } =
    await fixture(t);
  await makeLibrary();
  await makeAnswers();
  await app.db.run(
    "INSERT INTO answers(qid,draft,published,updated) VALUES(?,?,?,?)",
    "q",
    '["personal-draft"]',
    "[]",
    "now",
  );
  const personal = await app.db.all("SELECT * FROM answers");
  const study = (await request("GET", "/api/local/study")).json();
  let state = (await request("POST", "/api/local/updates/check", {})).json();
  assert.match(state.entries.answers.reason, /先更新题库/);
  assert.equal((await start("answers")).statusCode, 400);
  assert.equal((await start("library")).statusCode, 200);
  state = await completed();
  assert.equal(state.job.state, "done", state.job.message);
  assert.equal(state.entries.library.current, 2);
  assert.equal(state.entries.answers.current, 0);
  assert.equal((await start("answers")).statusCode, 200);
  state = await completed();
  assert.equal(state.job.state, "done", state.job.message);
  assert.equal(state.entries.answers.current, 1);
  const photo = (await request("GET", "/api/local/official/q")).json()
    .photos[0];
  assert.equal((await request("GET", photo)).statusCode, 200);
  assert.deepEqual(await app.db.all("SELECT * FROM answers"), personal);
  assert.deepEqual((await request("GET", "/api/local/study")).json(), study);
});
test("download failure and concurrent-tab edits leave the installed library unchanged", async (t) => {
  const { request, source, makeLibrary, start, completed } = await fixture(t);
  await makeLibrary();
  await request("POST", "/api/local/updates/check", {});
  source.error = "fixture network failure";
  await start("library");
  let state = await completed();
  assert.equal(state.job.state, "failed");
  assert.equal(state.entries.library.current, 1);
  source.error = null;
  let unblock;
  source.wait = new Promise((r) => {
    unblock = r;
  });
  await start("library");
  assert.equal((await start("library")).statusCode, 400);
  const before = (await request("GET", "/api/local/study")).json();
  await request(
    "PUT",
    "/api/local/study",
    { version: 2, records: { q: { star: true, state: "" } }, lists: [] },
    { "if-match": before.revision },
  );
  unblock();
  state = await completed();
  assert.equal(state.job.state, "failed");
  assert.equal(state.entries.library.current, 1);
  assert.equal(
    (await request("GET", "/api/local/study")).json().study.records.q.star,
    true,
  );
});
test("incompatible or mixed-content libraries are rejected without changing existing versions", async (t) => {
  const { request, makeLibrary, start, completed } = await fixture(t);
  await makeLibrary({ libraryId: "another-library" });
  await request("POST", "/api/local/updates/check", {});
  await start("library");
  const state = await completed();
  assert.equal(state.job.state, "failed");
  assert.equal(state.entries.library.current, 1);
});

test("public answer export excludes unselected private drafts and uses an independent revision", async (t) => {
  const { request, app, temp, image } = await fixture(t);
  const photo = "a".repeat(40), draft = "b".repeat(40);
  await app.db.run("INSERT INTO photos VALUES(?,?,?)", photo, "q", image);
  await app.db.run("INSERT INTO photos VALUES(?,?,?)", draft, "q", image);
  await app.db.run("INSERT INTO answers VALUES(?,?,?,?)", "q", JSON.stringify([draft]), JSON.stringify([photo]), "now");
  const excluded = await request("POST", "/api/local/export-answers", { ids: [], edition: "public", revision: 1 });
  assert.equal(excluded.statusCode, 200);
  const file1 = path.join(temp, "empty.842answers"), dir1 = path.join(temp, "empty");
  fs.writeFileSync(file1, excluded.rawPayload); fs.mkdirSync(dir1);
  assert.deepEqual((await extractAnswers(file1, dir1)).answers, {});
  const included = await request("POST", "/api/local/export-answers", { ids: ["q"], edition: "public", revision: 1 });
  assert.equal(included.statusCode, 200);
  const file2 = path.join(temp, "public.842answers"), dir2 = path.join(temp, "exported-public");
  fs.writeFileSync(file2, included.rawPayload); fs.mkdirSync(dir2);
  assert.deepEqual((await extractAnswers(file2, dir2)).answers, { q: ["answers/" + photo + ".webp"] });
  assert.equal(fs.existsSync(path.join(dir2, "answers/" + draft + ".webp")), false);
  assert.equal((await request("GET", "/api/local/updates")).json().entries.answers.current, 0, "export does not install or publish");
});

test("install rejects stale study versions, mismatched consent targets and program dependencies", async (t) => {
  const { request, source, makeLibrary } = await fixture(t);
  await makeLibrary(); await request("POST", "/api/local/updates/check", {});
  let response = await request("POST", "/api/local/updates/install", { kind: "library", target: 2 });
  assert.equal(response.statusCode, 428);
  response = await request("POST", "/api/local/updates/install", { kind: "library", target: 2 }, { "if-match": "999" });
  assert.equal(response.statusCode, 409);
  const revision = (await request("GET", "/api/local/study")).json().revision;
  response = await request("POST", "/api/local/updates/install", { kind: "library", target: 3 }, { "if-match": revision });
  assert.equal(response.statusCode, 400);
  source.manifest.library.requiresProgram = "99.0.0";
  await request("POST", "/api/local/updates/check", {});
  response = await request("POST", "/api/local/updates/install", { kind: "library", target: 2 }, { "if-match": revision });
  assert.match(response.json().error, /先更新程序/);
});
test("malformed answer packs and unreferenced files are rejected", async (t) => {
  const { temp, image } = await fixture(t);
  const file = path.join(temp, "bad-answers.zip"),
    out = path.join(temp, "bad-out");
  fs.mkdirSync(out);
  await writeZip(file, [
    {
      name: "answers.json",
      bytes: Buffer.from(
        JSON.stringify({
          format: 1,
          kind: "answers",
          libraryId: "zju842",
          revision: 1,
          requiresLibraryRevision: 1,
          edition: "a",
          answers: {},
        }),
      ),
    },
    { name: "answers/unreferenced.webp", bytes: image },
  ]);
  await assert.rejects(extractAnswers(file, out), /未引用/);
});
test("program staging validates versions and rejects private files before activation", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-program-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, ".app-versions"));
  const prefix = "zju842-0.5.0-windows-x64/";
  const make = (version) => [
    {
      name: prefix + "package.json",
      bytes: Buffer.from(
        JSON.stringify({
          name: "zju842-practice",
          version,
          desktopUpdateProtocol: 1,
        }),
      ),
    },
    ...[
      "server/desktop.js",
      "server/desktop-app.js",
      "runtime/node.exe",
      "dist/index.html",
    ].map((n) => ({ name: prefix + n, bytes: Buffer.from("fixture") })),
  ];
  await writeZip(path.join(temp, "wrong.zip"), make("0.4.9"));
  await assert.rejects(
    stageProgram(path.join(temp, "wrong.zip"), temp, "0.5.0", "windows-x64"),
    /不匹配/,
  );
  await writeZip(path.join(temp, "private.zip"), [
    ...make("0.5.0"),
    { name: prefix + ".env", bytes: Buffer.from("private") },
  ]);
  await assert.rejects(
    stageProgram(path.join(temp, "private.zip"), temp, "0.5.0", "windows-x64"),
    /路径/,
  );
  await writeZip(path.join(temp, "valid.zip"), make("0.5.0"));
  const directory = await stageProgram(
    path.join(temp, "valid.zip"),
    temp,
    "0.5.0",
    "windows-x64",
  );
  assert.ok(
    fs.existsSync(
      path.join(temp, ".app-versions", directory, "server/desktop-app.js"),
    ),
  );
  assert.equal(
    fs.existsSync(path.join(temp, ".app-current.json")),
    false,
    "extraction alone never activates code",
  );
});
