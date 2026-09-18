import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createContentStage, contentCleanupDetails } from "../server/content-staging.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "842-stage-r1-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const failure = () => Object.assign(new Error("original disk failure"), { code: "ENOSPC", stage: "installation" });

test("R02 cleanup removes only its owned inactive directory; existing data survives", t => {
  const root = fixture(t), stage = createContentStage(root, "answers");
  const sibling = path.join(root, "libraries", "answers-" + "f".repeat(16));
  fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, "keep"), "old answers");
  fs.writeFileSync(path.join(root, "personal.sqlite"), "synthetic personal data");
  fs.writeFileSync(path.join(stage.directory, "temp"), "staged");
  const original = failure(); stage.cleanup(original); stage.cleanup(original);
  assert.equal(fs.existsSync(stage.directory), false);
  assert.equal(fs.readFileSync(path.join(sibling, "keep"), "utf8"), "old answers");
  assert.equal(fs.readFileSync(path.join(root, "personal.sqlite"), "utf8"), "synthetic personal data");
  assert.deepEqual(contentCleanupDetails(original), {});
});

test("R02 EBUSY/EPERM cleanup preserves the original Error identity, code, message and stack", t => {
  const root = fixture(t), stage = createContentStage(root, "edition"), original = failure();
  const stack = original.stack, cause = new Error("underlying cause"); original.cause = cause;
  const rm = fs.rmSync, attempts = [];
  fs.rmSync = (target, options) => {
    attempts.push(target);
    if (target === stage.directory) throw Object.assign(new Error("private path or proxy secret"), { code: "EPERM" });
    return rm(target, options);
  };
  try { assert.doesNotThrow(() => stage.cleanup(original)); }
  finally { fs.rmSync = rm; }
  assert.equal(original.code, "ENOSPC"); assert.equal(original.message, "original disk failure");
  assert.equal(original.stack, stack); assert.equal(original.cause, cause);
  assert.deepEqual(attempts, [stage.directory]);
  assert.deepEqual(contentCleanupDetails(original), {
    cleanupPending: true, cleanupErrors: [{ directory: stage.name, code: "EPERM" }],
  });
  const report = JSON.stringify(contentCleanupDetails(original));
  assert.equal(report.includes(root), false); assert.equal(report.includes("secret"), false);
  const copy = contentCleanupDetails(original); copy.cleanupErrors[0].code = "tampered";
  assert.equal(contentCleanupDetails(original).cleanupErrors[0].code, "EPERM");
});

test("R02 a frozen original error still retains independent cleanup diagnostics", t => {
  const root = fixture(t), stage = createContentStage(root, "answers"), original = Object.freeze(failure());
  const rm = fs.rmSync;
  fs.rmSync = () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); };
  try { assert.doesNotThrow(() => stage.cleanup(original)); }
  finally { fs.rmSync = rm; }
  assert.equal(original.code, "ENOSPC"); assert.equal(contentCleanupDetails(original).cleanupErrors[0].code, "EBUSY");
});

test("R02 committed stages and stages referenced by either active pointer are never removed", t => {
  const root = fixture(t), committed = createContentStage(root, "edition");
  committed.commit(); committed.cleanup(failure()); assert.ok(fs.existsSync(committed.directory));
  for (const filename of ["library.json", "official-answers.json"]) {
    const stage = createContentStage(root, "answers"), original = failure();
    fs.writeFileSync(path.join(root, filename), JSON.stringify({ directory: stage.name }));
    stage.cleanup(original); assert.ok(fs.existsSync(stage.directory));
    assert.deepEqual(contentCleanupDetails(original), {});
  }
});

test("R02 replaced directory identity fails closed instead of deleting someone else's files", t => {
  const root = fixture(t), stage = createContentStage(root, "answers"), original = failure();
  fs.renameSync(stage.directory, stage.directory + "-moved"); fs.mkdirSync(stage.directory);
  fs.writeFileSync(path.join(stage.directory, "keep"), "replacement");
  stage.cleanup(original);
  assert.equal(fs.readFileSync(path.join(stage.directory, "keep"), "utf8"), "replacement");
  assert.equal(contentCleanupDetails(original).cleanupErrors[0].code, "CONTENT_CLEANUP_GUARD");
});

test("R02 a directory replaced with a junction/symlink does not delete its target", t => {
  const root = fixture(t), stage = createContentStage(root, "answers"), original = failure();
  const outside = path.join(root, "unrelated"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "keep"), "keep");
  fs.rmdirSync(stage.directory); fs.symlinkSync(outside, stage.directory, "junction");
  stage.cleanup(original);
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "keep");
  assert.ok(fs.lstatSync(stage.directory).isSymbolicLink());
  assert.equal(contentCleanupDetails(original).cleanupErrors[0].code, "CONTENT_CLEANUP_GUARD");
});

test("R02 replacement of the libraries parent and corrupt active pointers fail closed", t => {
  const root = fixture(t), stage = createContentStage(root, "edition"), original = failure();
  const libraries = path.join(root, "libraries"); fs.renameSync(libraries, libraries + "-old");
  fs.mkdirSync(libraries); fs.mkdirSync(stage.directory);
  stage.cleanup(original); assert.ok(fs.existsSync(stage.directory));
  assert.equal(contentCleanupDetails(original).cleanupErrors[0].code, "CONTENT_CLEANUP_GUARD");
  const second = createContentStage(root, "answers"), otherError = failure();
  fs.writeFileSync(path.join(root, "library.json"), "{");
  second.cleanup(otherError); assert.ok(fs.existsSync(second.directory));
  assert.equal(contentCleanupDetails(otherError).cleanupErrors[0].code, "CONTENT_CLEANUP_GUARD");
});

test("R02 an existing-directory collision or invalid stage kind never grants cleanup ownership", t => {
  const root = fixture(t), mkdir = fs.mkdirSync; let target;
  fs.mkdirSync = (dir, options) => {
    if (!options && /(?:edition|answers)-[a-f0-9]{16}$/.test(dir)) {
      target = dir; mkdir(dir); fs.writeFileSync(path.join(dir, "keep"), "pre-existing");
      throw Object.assign(new Error("already exists"), { code: "EEXIST" });
    }
    return mkdir(dir, options);
  };
  try { assert.throws(() => createContentStage(root, "answers"), { code: "EEXIST" }); }
  finally { fs.mkdirSync = mkdir; }
  assert.equal(fs.readFileSync(path.join(target, "keep"), "utf8"), "pre-existing");
  assert.throws(() => createContentStage(root, "../../outside"), { code: "CONTENT_CLEANUP_GUARD" });
});
