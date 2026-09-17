import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import sharp from "sharp";
import { writeZip } from "../server/packs.js";
import { platformKey } from "../server/update-source.js";

if (!process.argv[2])
  throw new Error(
    "请指定已打包的程序目录；测试会复制到临时目录，不修改传入目录",
  );
const original = path.resolve(process.argv[2]);
const candidateSource = process.argv[3] ? path.resolve(process.argv[3]) : null;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-upgrade-smoke-"));
const root = path.join(temp, "portable"),
  dataDir = path.join(temp, "personal");
const manifestFile = path.join(temp, "manifest.json");
const fixtureVersion = "0.5.91",
  brokenVersion = "0.5.92";
let child,
  output = "",
  base,
  cookie;
const runtimeName = process.platform === "win32" ? "node.exe" : "node";
try {
  assert.ok(fs.existsSync(path.join(original, "runtime", runtimeName)));
  fs.cpSync(original, root, {
    recursive: true,
    filter: (file) =>
      ![
        "userdata",
        ".app-versions",
        ".app-current.json",
        ".app-pending.json",
        ".app-lock",
      ].includes(path.basename(file)),
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  assert.ok(pkg.desktopUpdateProtocol === 1);
  const mock = path.join(temp, "mock-release.mjs");
  fs.writeFileSync(
    mock,
    `import fs from 'node:fs'; import path from 'node:path'; import {Readable} from 'node:stream';
const dir=${JSON.stringify(temp)};
globalThis.fetch=async (url)=>{
 const u=new URL(url);
 if(u.hostname==='api.github.com' && u.pathname.endsWith('/releases/latest')) return new Response(JSON.stringify({tag_name:'fixture',assets:[{name:'zju842-updates.json'}]}));
 if(u.hostname!=='github.com') throw new Error('Unexpected external test request');
 const name=decodeURIComponent(u.pathname.split('/').pop());
 if(name==='zju842-updates.json') return new Response(fs.readFileSync(path.join(dir,'manifest.json')));
 if(!/^zju842-[0-9.]+-(windows|macos)-(x64|arm64)\\.zip$/.test(name)) throw new Error('Unknown fixture asset');
 return new Response(Readable.toWeb(fs.createReadStream(path.join(dir,name))));
};`,
  );
  const entries = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file, name + "/");
      else if (entry.isFile()) entries.push({ name, file });
    }
  }
  walk(candidateSource || root);
  const candidatePackage = JSON.parse(
    fs.readFileSync(path.join(candidateSource || root, "package.json")),
  );
  async function release(version, broken = false) {
    const name = `zju842-${version}-${platformKey()}.zip`,
      file = path.join(temp, name);
    await writeZip(
      file,
      entries.map((e) => {
        const target = `zju842-${version}-${platformKey()}/` + e.name;
        if (e.name === "package.json")
          return {
            name: target,
            bytes: Buffer.from(
              JSON.stringify({ ...candidatePackage, version }),
            ),
          };
        if (broken && e.name === "server/desktop-app.js")
          return {
            name: target,
            bytes: Buffer.from(
              "throw new Error('Deliberately broken update fixture');",
            ),
          };
        return { name: target, file: e.file };
      }),
    );
    return { release: "fixture", name, size: fs.statSync(file).size };
  }
  const goodAsset = await release(fixtureVersion),
    badAsset = await release(brokenVersion, true);
  function setRelease(version, asset) {
    const dataAsset = { release: "fixture", name: "library.842pack", size: 1 };
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        format: 1,
        libraryId: "zju842",
        program: {
          protocol: 1,
          version,
          assets: Object.fromEntries(
            ["windows-x64", "macos-x64", "macos-arm64"].map((p) => [
              p,
              p === platformKey()
                ? asset
                : {
                    release: "fixture",
                    name: `zju842-${version}-${p}.zip`,
                    size: 1,
                  },
            ]),
          ),
        },
        library: {
          revision: 1,
          edition: "unchanged",
          requiresProgram: "0.4.0",
          asset: dataAsset,
        },
        answers: {
          revision: 0,
          edition: "unchanged",
          requiresProgram: "0.4.0",
          requiresLibraryRevision: 1,
          asset: { ...dataAsset, name: "answers.842answers" },
        },
      }),
    );
  }
  async function launch() {
    output = "";
    child = spawn(
      path.join(root, "runtime", runtimeName),
      [path.join(root, "server/desktop.js")],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(mock).href}`,
          ZJU842_DATA_DIR: dataDir,
          ZJU842_NO_BROWSER: "1",
          ZJU842_PORT: "18643",
        },
      },
    );
    child.stdout.on("data", (b) => {
      output += b;
    });
    child.stderr.on("data", (b) => {
      output += b;
    });
    const end = Date.now() + 30000;
    while (!output.match(/TEST_START_URL=(\S+)/)) {
      if (Date.now() > end || child.exitCode !== null)
        throw new Error("Launch failed: " + output);
      await new Promise((r) => setTimeout(r, 50));
    }
    const url = output.match(/TEST_START_URL=(\S+)/)[1];
    base = new URL(url).origin;
    const response = await fetch(url, { redirect: "manual" });
    cookie = response.headers.get("set-cookie").split(";")[0];
  }
  async function stop() {
    if (child?.exitCode === null) {
      const done = once(child, "close");
      child.kill();
      await done;
      child = null;
    }
  }
  async function api(route, body, headers = {}) {
    const response = await fetch(base + "/api" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        Origin: base,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  async function waitUntil(predicate) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch {
        /* service closes during restart */
      }
      if (child.exitCode !== null)
        throw new Error("Supervisor exited: " + output);
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("Upgrade timed out: " + output);
  }
  setRelease(fixtureVersion, goodAsset);
  await launch();
  const catalog = await (await fetch(base + "/catalog.json")).json();
  const qid = catalog.questions[0].id;
  const initial = await api("/local/study");
  const saved = {
    version: 2,
    records: { [qid]: { star: true, state: "review" } },
    lists: [],
  };
  const savedResponse = await fetch(base + "/api/local/study", {
    method: "PUT",
    headers: {
      cookie,
      Origin: base,
      "Content-Type": "application/json",
      "If-Match": initial.revision,
    },
    body: JSON.stringify(saved),
  });
  assert.equal(savedResponse.status, 200);
  const image = await sharp({
    create: { width: 3, height: 4, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([image], { type: "image/png" }), "fixture.png");
  const photoResponse = await fetch(
    base + "/api/admin/answers/" + encodeURIComponent(qid) + "/photos",
    { method: "POST", headers: { cookie, Origin: base }, body: form },
  );
  assert.equal(photoResponse.status, 200);
  const photo = (await photoResponse.json()).draft[0];
  const before = await api("/local/study");
  await api("/local/updates/check", {});
  await api(
    "/local/updates/install",
    { kind: "program", target: fixtureVersion },
    { "If-Match": before.revision },
  );
  await waitUntil(
    async () => (await api("/local/info")).version === fixtureVersion,
  );
  assert.deepEqual(await api("/local/study"), before);
  assert.equal(
    (await fetch(base + "/api/media/" + photo, { headers: { cookie } })).status,
    200,
  );
  assert.equal(
    (await api("/local/updates")).entries.library.current,
    catalog.libraryRevision,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
    pkg.version,
    "base launcher retained",
  );
  await stop();
  await launch();
  assert.equal(
    (await api("/local/info")).version,
    fixtureVersion,
    "original shortcut opens new version after restart",
  );
  setRelease(brokenVersion, badAsset);
  await api("/local/updates/check", {});
  await api(
    "/local/updates/install",
    { kind: "program", target: brokenVersion },
    { "If-Match": before.revision },
  );
  await waitUntil(
    async () => (await api("/local/updates")).lastResult?.ok === false,
  );
  assert.equal((await api("/local/info")).version, fixtureVersion);
  assert.deepEqual(await api("/local/study"), before);
  assert.equal(
    (await fetch(base + "/api/media/" + photo, { headers: { cookie } })).status,
    200,
  );
  assert.ok(fs.readdirSync(path.join(dataDir, "update-backups")).length >= 2);
  assert.equal(fs.existsSync(path.join(root, ".app-pending.json")), false);
  await stop();
  const committed = JSON.parse(
    fs.readFileSync(path.join(root, ".app-current.json")),
  );
  const brokenDirectory = fs
    .readdirSync(path.join(root, ".app-versions"))
    .find((n) => n.startsWith(brokenVersion + "-"));
  const backupFile = fs
    .readdirSync(path.join(dataDir, "update-backups"))
    .sort()
    .at(-1);
  fs.writeFileSync(
    path.join(root, ".app-pending.json"),
    JSON.stringify({
      directory: brokenDirectory,
      previous: committed.directory,
      backup: backupFile,
    }),
  );
  await launch();
  assert.equal((await api("/local/info")).version, fixtureVersion);
  assert.deepEqual(await api("/local/study"), before);
  await stop();
  console.log(
    "UPDATE DESKTOP PASS: real packaged activation, same shortcut restart, personal records/photos preserved, broken release rolled back (fixture release transport)",
  );
} finally {
  if (child?.exitCode === null) {
    const done = once(child, "close");
    child.kill();
    await done;
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
