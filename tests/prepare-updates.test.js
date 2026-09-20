import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import packageInfo from "../package.json" with { type: "json" };
import { validateCatalog } from "../server/catalog.js";
import { validateAnswers } from "../server/answer-schema.js";
import { extractAnswers } from "../server/answer-packs.js";

const script = path.resolve("scripts/prepare-updates.js");
const platforms = ["windows-x64", "macos-x64", "macos-arm64"];

function prepareFixture(t, { requiresProgram, revision }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-prepare-updates-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const publicDir = path.join(dir, "public");
  const assets = path.join(dir, "fixture-assets");
  const releases = path.join(dir, "docs", "releases");
  for (const target of [publicDir, assets, releases])
    fs.mkdirSync(target, { recursive: true });
  const catalog = validateCatalog({
    version: 1,
    libraryId: "zju842",
    libraryRevision: 2,
    requiresProgram: "0.5.0",
    edition: "Isolated library fixture",
    types: [],
    questions: [],
  });
  const answers = validateAnswers({
    format: 1,
    kind: "answers",
    libraryId: "zju842",
    revision,
    requiresLibraryRevision: 2,
    ...(requiresProgram ? { requiresProgram } : {}),
    edition: "Isolated answer fixture",
    answers: {},
  });
  const catalogFile = path.join(publicDir, "catalog.json");
  const answersFile = path.join(publicDir, "answers.json");
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
  fs.writeFileSync(answersFile, JSON.stringify(answers));
  fs.writeFileSync(
    path.join(releases, `v${packageInfo.version}.md`),
    "Isolated test release; not for publication.",
  );
  // The preparation script only reads desktop asset sizes; these are not packages.
  for (const platform of platforms)
    fs.writeFileSync(
      path.join(assets, `zju842-${packageInfo.version}-${platform}.zip`),
      "test-only size placeholder",
    );
  execFileSync(process.execPath, [script, assets], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(catalogFile, "utf8")), catalog);
  assert.deepEqual(JSON.parse(fs.readFileSync(answersFile, "utf8")), answers);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(assets, "zju842-updates.json"), "utf8"),
  );
  return { dir, assets, catalog, answers, manifest };
}

test("prepared answer manifest retains the declared minimum program version", async (t) => {
  const { dir, assets, catalog, answers, manifest } = prepareFixture(t, {
    requiresProgram: packageInfo.version,
    revision: 7,
  });
  assert.equal(manifest.answers.requiresProgram, answers.requiresProgram);
  assert.equal(manifest.answers.revision, answers.revision);
  assert.equal(manifest.program.version, packageInfo.version);
  assert.equal(manifest.library.revision, catalog.libraryRevision);
  assert.equal(manifest.library.requiresProgram, catalog.requiresProgram);
  const unpacked = path.join(dir, "unpacked-answers");
  fs.mkdirSync(unpacked);
  assert.deepEqual(
    await extractAnswers(
      path.join(assets, manifest.answers.asset.name),
      unpacked,
    ),
    answers,
  );
});

test("legacy answer metadata defaults to 0.4.0 without changing program or library versions", (t) => {
  const { catalog, answers, manifest } = prepareFixture(t, { revision: 99 });
  assert.equal(manifest.answers.requiresProgram, "0.4.0");
  assert.equal(manifest.answers.revision, answers.revision);
  assert.equal(
    manifest.answers.requiresLibraryRevision,
    answers.requiresLibraryRevision,
  );
  assert.equal(manifest.program.version, packageInfo.version);
  assert.equal(manifest.library.revision, catalog.libraryRevision);
  assert.equal(manifest.library.requiresProgram, catalog.requiresProgram);
  for (const platform of platforms)
    assert.equal(
      manifest.program.assets[platform].name,
      `zju842-${packageInfo.version}-${platform}.zip`,
    );
});
