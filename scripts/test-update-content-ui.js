import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { packPaths, writeZip } from "../server/packs.js";
import packageInfo from "../package.json" with { type: "json" };

// Real browser, HTTP API, ZIP installation and persistence. Only release transport
// is a local fixture; no test routes or download sources are added to production.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "842-content-ui-"));
const dataDir = path.join(temp, "user");
fs.mkdirSync(dataDir);
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const baseDir = path.resolve("public");
const catalog = loadCatalog(path.join(baseDir, "catalog.json"), baseDir);
const qid = catalog.questions[0].id;
const extraId = "test-content-ui-extra";
const next = structuredClone(catalog);
next.libraryRevision++;
next.edition = "人工更新验收夹具";
next.updateKind = "library";
delete next.officialAnswers;
next.questions.push({
  ...structuredClone(next.questions[0]),
  id: extraId,
  title: "人工更新测试题",
});
const libraryFile = path.join(temp, "library.842pack");
await writeZip(libraryFile, [
  { name: "catalog.json", bytes: Buffer.from(JSON.stringify(next)) },
  ...[...packPaths(next)]
    .filter((n) => n !== "catalog.json")
    .map((name) => ({ name, file: path.join(baseDir, name) })),
]);
const image = await sharp({
  create: { width: 60, height: 40, channels: 3, background: "#287a51" },
})
  .webp()
  .toBuffer();
const answerFile = path.join(temp, "answers.842answers");
await writeZip(answerFile, [
  {
    name: "answers.json",
    bytes: Buffer.from(
      JSON.stringify({
        format: 1,
        kind: "answers",
        libraryId: "zju842",
        revision: 1,
        requiresProgram: packageInfo.version,
        requiresLibraryRevision: next.libraryRevision,
        edition: "人工公共答案",
        answers: { [qid]: ["answers/a.webp"], [extraId]: ["answers/b.webp"] },
      }),
    ),
  },
  { name: "answers/a.webp", bytes: image },
  { name: "answers/b.webp", bytes: image },
]);
const reservation = net.createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
const files = {
  "library.842pack": libraryFile,
  "answers.842answers": answerFile,
};
const asset = (name) => ({
  release: "fixture",
  name,
  size: fs.statSync(files[name]).size,
});
const manifest = {
  format: 1,
  libraryId: "zju842",
  program: {
    protocol: 1,
    version: packageInfo.version,
    assets: Object.fromEntries(
      ["windows-x64", "macos-x64", "macos-arm64"].map((p) => [
        p,
        {
          release: "fixture",
          name: `zju842-${packageInfo.version}-${p}.zip`,
          size: 1,
        },
      ]),
    ),
  },
  library: {
    revision: next.libraryRevision,
    edition: next.edition,
    requiresProgram: next.requiresProgram || "0.4.0",
    asset: asset("library.842pack"),
  },
  answers: {
    revision: 1,
    edition: "人工公共答案",
    requiresProgram: packageInfo.version,
    requiresLibraryRevision: next.libraryRevision,
    asset: asset("answers.842answers"),
  },
};
let app, browser;
try {
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.resolve("dist"),
    local: {
      baseDir,
      launchToken: "content-ui-fixture",
      updateSource: {
        check: async () => structuredClone(manifest),
        download: async (a, file, progress) => {
          fs.copyFileSync(files[a.name], file);
          progress(a.size, a.size);
        },
      },
    },
  });
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/__open/content-ui-fixture");
  await page.locator('[data-action="local-updates"]').waitFor();
  await page.goto(origin + "/?q=" + encodeURIComponent(qid));
  await page.locator('[data-action="star"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status")?.textContent === "已保存到本机",
  );
  const upload = await context.request.post(
    origin + "/api/admin/answers/" + encodeURIComponent(qid) + "/photos",
    {
      headers: { Origin: origin },
      multipart: {
        file: { name: "private.webp", mimeType: "image/webp", buffer: image },
      },
    },
  );
  assert.equal(upload.status(), 200);
  const privateAnswer = await upload.json();
  const before = await (
    await context.request.get(origin + "/api/local/study")
  ).json();
  await page.locator('[data-action="local-updates"]').click();
  await page.locator("#update-check").click();
  await page.locator('[data-update-kind="library"]:enabled').waitFor();
  assert.equal(
    await page.locator('[data-update-kind="answers"]').isDisabled(),
    true,
    "answer depends on new library",
  );
  for (const kind of ["library", "answers"]) {
    await page.locator(`[data-update-kind="${kind}"]`).click();
    const reloaded = page.waitForEvent("domcontentloaded");
    await page.locator("#confirm-update").click();
    await reloaded;
    await page.locator('[data-action="local-updates"]').waitFor();
    await page.locator("#notice-dismiss").waitFor();
    assert.match(
      await page.locator("#update-complete").innerText(),
      new RegExp(kind === "library" ? "r3" : "r1"),
    );
    await page.locator("#notice-dismiss").click();
    assert.deepEqual(
      await (await context.request.get(origin + "/api/local/study")).json(),
      before,
    );
    const privateAfter = await (
      await context.request.get(
        origin + "/api/admin/answers/" + encodeURIComponent(qid),
      )
    ).json();
    assert.deepEqual(privateAfter, privateAnswer);
    assert.equal(
      (
        await context.request.get(
          origin + "/api/media/" + privateAnswer.draft[0],
        )
      ).status(),
      200,
    );
    await page.locator('[data-action="local-updates"]').click();
    await page.locator("#update-center").waitFor();
  }
  const status = await (
    await context.request.get(origin + "/api/local/updates")
  ).json();
  assert.equal(status.entries.library.current, next.libraryRevision);
  assert.equal(status.entries.answers.current, 1);
  assert.equal(
    (await (await context.request.get(origin + "/catalog.json")).json())
      .questions.length,
    next.questions.length,
  );
  const publicAnswers = await (
    await context.request.get(
      origin + "/api/local/official/" + encodeURIComponent(extraId),
    )
  ).json();
  assert.equal(publicAnswers.photos.length, 1);
  assert.equal(
    (await context.request.get(origin + publicAnswers.photos[0])).status(),
    200,
  );
  fs.mkdirSync(".test-artifacts/content-update-ui", { recursive: true });
  await page.screenshot({
    path: ".test-artifacts/content-update-ui/completed.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "CONTENT UPDATE UI PASS: real Chrome + HTTP library/answers installs and reloads; new question and nonempty public images readable; study and private photo preserved (fixture release transport)",
  );
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
