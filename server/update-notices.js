import fs from "node:fs";
import path from "node:path";
import { atomicJson, readJson } from "./update-files.js";
import { releaseInfo } from "./release-info.js";

export function createUpdateNotices({ dataDir, installRoot, version }) {
  const file = path.join(dataDir, "update-notices.json");
  function state() {
    try {
      const s = readJson(file, {});
      return s && typeof s === "object" && !Array.isArray(s) ? s : {};
    } catch (e) {
      if (e instanceof SyntaxError) return {};
      throw e;
    }
  }
  function list(lastResult) {
    const s = state(),
      result = [];
    for (const kind of ["library", "answers"]) {
      const n = s[kind];
      if (
        n &&
        n.kind === kind &&
        typeof n.id === "string" &&
        typeof n.notes === "string" &&
        Number.isFinite(n.at)
      )
        result.push({ ...n, seen: s.seen?.[kind] === n.id });
    }
    // Only report activation when the original launcher committed this version.
    // Copying userdata into a fresh directory is not an automatic upgrade.
    let active;
    try {
      active =
        installRoot &&
        readJson(path.join(installRoot, ".app-current.json"), null)?.directory;
    } catch {
      active = null;
    }
    if (
      lastResult?.ok &&
      Number.isFinite(lastResult.at) &&
      typeof active === "string" &&
      active.startsWith(version + "-") &&
      !fs.existsSync(path.join(installRoot, ".app-pending.json"))
    ) {
      const id = `program:${version}:${lastResult.at}`;
      result.push({
        id,
        kind: "program",
        target: version,
        at: lastResult.at,
        notes: releaseInfo.notes,
        seen: s.seen?.program === id,
      });
    }
    return result.sort((a, b) => b.at - a.at);
  }
  return {
    list,
    record(kind, target, notes) {
      if (!["library", "answers"].includes(kind))
        throw new Error("未知资料更新类型");
      const s = state(),
        at = Date.now();
      s[kind] = {
        id: `${kind}:${target}:${at}`,
        kind,
        target,
        at,
        notes: String(notes || "本次资料版本已更新，个人记录保留。").slice(
          0,
          12000,
        ),
      };
      atomicJson(file, s);
    },
    acknowledge(id, lastResult) {
      const n = list(lastResult).find((n) => n.id === id);
      if (!n) throw new Error("更新提示已变化，请重新打开更新中心");
      const s = state();
      s.seen = { ...s.seen, [n.kind]: id };
      atomicJson(file, s);
    },
  };
}
