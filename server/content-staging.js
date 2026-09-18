import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const names = /^(?:edition|answers)-[a-f0-9]{16}$/;
const codes = /^(?:E[A-Z0-9_]{1,39}|CONTENT_CLEANUP_GUARD)$/;
// Keep diagnostics available even when the original Error is non-extensible.
const pending = new WeakMap();
const guard = () => Object.assign(new Error("Content cleanup ownership check failed"), {
  code: "CONTENT_CLEANUP_GUARD",
});
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

export function contentCleanupDetails(error) {
  const state = error && (typeof error === "object" || typeof error === "function")
    ? pending.get(error) : undefined;
  if (!state) return {};
  return { cleanupPending: true, cleanupErrors: state.map(item => ({ ...item })) };
}

export const contentCleanupNotice =
  "\uff1b\u672a\u6fc0\u6d3b\u7684\u5b89\u88c5\u4e34\u65f6\u6587\u4ef6\u672a\u6e05\u7406\u5b8c\u6210\uff0c\u8bf7\u4fdd\u7559\u5f53\u524d\u7248\u672c\u548c\u4e2a\u4eba\u8d44\u6599";

function recordFailure(error, name, cleanupError) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  const record = {
    directory: name,
    code: codes.test(cleanupError?.code || "") ? cleanupError.code : "CONTENT_CLEANUP_FAILED",
  };
  const records = [...(pending.get(error) || []), record];
  pending.set(error, records);
  // Preserve identity/code/message/cause/stack of the installation failure.
  // The WeakMap remains authoritative if the Error is frozen or has accessors.
  try { Object.assign(error, { cleanupPending: true, cleanupErrors: records.map(item => ({ ...item })) }); }
  catch { /* Diagnostics can still be retrieved via contentCleanupDetails. */ }
}

// A stage owns ONE exclusively-created direct child, never an existing tree.
export function createContentStage(dataDir, kind) {
  if (!["edition", "answers"].includes(kind)) throw guard();
  const root = path.resolve(dataDir, "libraries");
  fs.mkdirSync(root, { recursive: true });
  const rootReal = fs.realpathSync(root);
  const rootStat = fs.statSync(root);
  const name = kind + "-" + randomBytes(8).toString("hex");
  const directory = path.join(root, name);
  fs.mkdirSync(directory); // EEXIST must not confer ownership of a pre-existing directory.
  const identity = fs.lstatSync(directory);
  let committed = false;
  return {
    name,
    directory,
    commit() { committed = true; },
    cleanup(error) {
      if (committed) return;
      try {
        if (!names.test(name) || path.dirname(directory) !== root ||
            fs.realpathSync(root) !== rootReal || !sameFile(fs.statSync(root), rootStat))
          throw guard();
        let current;
        try { current = fs.lstatSync(directory); }
        catch (e) { if (e.code === "ENOENT") return; throw e; }
        if (current.isSymbolicLink() || !current.isDirectory() || !sameFile(current, identity))
          throw guard();
        // Defense in depth: never remove a directory referenced by either active pointer.
        // An unreadable/corrupt pointer fails closed rather than guessing ownership.
        for (const filename of ["library.json", "official-answers.json"]) {
          let pointer;
          try { pointer = JSON.parse(fs.readFileSync(path.join(dataDir, filename), "utf8")); }
          catch (e) { if (e.code === "ENOENT") continue; throw guard(); }
          if (pointer?.directory === name) return;
        }
        fs.rmSync(directory, { recursive: true, force: true });
      } catch (cleanupError) {
        recordFailure(error, name, cleanupError);
      }
    },
  };
}
