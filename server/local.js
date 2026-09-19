import fs from "node:fs";
import path from "node:path";
import packageInfo from "../package.json" with { type: "json" };
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DatabaseSync, backup } from "node:sqlite";
import { validateStudy, emptyStudy } from "../src/study.js";
import { packPaths, writeZip } from "./packs.js";
import { createContentStore } from "./content-store.js";
export { currentLibrary } from "./content-store.js";
import { createUpdates } from "./updates.js";
import { atomicJson } from "./update-files.js";
import { registerLocalWriteGate } from "./local-write-gate.js";
import {
  answerFiles,
} from "./answer-packs.js";
import {
  ensureLocalStudySchema,
  readLocalStudy,
  writeLocalStudy,
  assertStudyRevision,
  replaceLocalStudy,
} from "./study-version.js";

export async function registerLocal(
  app,
  {
    dataDir,
    catalog,
    baseDir,
    launchToken,
    origin,
    installRoot,
    activateProgram,
    updateSource,
  },
) {
  const db = app.db;
  const cookieName = "local_session_" + new URL(origin).port;
  await ensureLocalStudySchema(db);
  const store = createContentStore({ dataDir, catalog, baseDir, version: packageInfo.version });
  const { official, installLibrary, installAnswers } = store;
  const updates = createUpdates({
    app,
    dataDir,
    catalog,
    answers: official,
    installLibrary,
    installAnswers,
    installRoot,
    activateProgram,
    ...(updateSource ? { source: updateSource } : {}),
  });
  registerLocalWriteGate(app, updates);
  async function requireLocal(req) {
    if (req.cookies[cookieName] !== launchToken)
      throw Object.assign(new Error("请通过本地启动器打开题库"), {
        statusCode: 401,
      });
  }
  app.get("/__open/:token", async (req, reply) => {
    if (req.params.token !== launchToken)
      return reply.code(403).send("启动链接无效");
    reply.setCookie(cookieName, launchToken, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
    });
    return reply.redirect("/");
  });
  app.get("/catalog.json", async (req, reply) => { reply.header("Cache-Control", "no-store"); return catalog; });
  app.get("/questions/:file", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const name = "questions/" + req.params.file;
    if (!catalog.questions.some((q) => q.images.some((i) => i.src === name)))
      return reply.code(404).send();
    return reply.sendFile(req.params.file, path.join(store.library, "questions"));
  });
  app.get("/api/local/official/:qid", async (req) => ({
    photos: (official().value.answers[req.params.qid] || []).map(
      (p) => "/api/local/official-media/" + path.basename(p),
    ),
  }));
  app.get("/api/local/official-media/:file", async (req, reply) => {
    const currentAnswers = official();
    const name = "answers/" + req.params.file;
    if (
      !Object.values(currentAnswers.value.answers).some((a) => a.includes(name))
    )
      return reply.code(404).send();
    return reply
      .type("image/webp")
      .send(fs.createReadStream(path.join(currentAnswers.directory, name)));
  });
  app.get("/api/local/info", { onRequest: requireLocal }, async () => ({
    edition: catalog.edition || "初始题库",
    dataDir,
    version: packageInfo.version,
    updates: "https://github.com/burriedalien666/zju842-practice/releases",
    qa: "https://github.com/burriedalien666/zju842-practice/discussions/categories/q-a",
  }));
  app.get("/api/local/updates", { onRequest: requireLocal }, async () =>
    updates.status(),
  );
  app.get("/api/local/updates/diagnostics", { onRequest: requireLocal }, async (req, reply) => {
    reply.header("Content-Disposition", 'attachment; filename="842-update-diagnostics.json"');
    return updates.diagnostic();
  });
  const updateCall = (fn) => async (req, reply) => {
    try {
      return await fn(req, reply);
    } catch (e) {
      throw Object.assign(e, { statusCode: e.statusCode || 400 });
    }
  };
  app.post(
    "/api/local/updates/check",
    { onRequest: requireLocal },
    updateCall((req) => updates.check(req.body?.automatic === true)),
  );
  app.put(
    "/api/local/updates/settings",
    { onRequest: requireLocal },
    updateCall((req) => updates.changeSettings(req.body?.autoCheck)),
  );
  app.post(
    "/api/local/updates/install",
    { onRequest: requireLocal },
    updateCall((req) =>
      updates.start(req.body?.kind, req.body?.target, req.headers["if-match"], req.body?.requestId),
    ),
  );
  app.get("/api/local/study", { onRequest: requireLocal }, async () => {
    return readLocalStudy(db);
  });
  app.post("/api/local/updates/ack", { onRequest: requireLocal }, updateCall(req => updates.acknowledge(req.body?.id)));
  app.put(
    "/api/local/study",
    { onRequest: requireLocal, bodyLimit: 4 * 1024 * 1024 },
    async (req) => {
      const study = validateStudy(
        req.body,
        new Set(catalog.questions.map((q) => q.id)),
      );
      return writeLocalStudy(db, study, req.headers["if-match"]);
    },
  );
  app.get(
    "/api/local/backup",
    { onRequest: requireLocal },
    async (req, reply) => {
      const temp = path.join(
        dataDir,
        "backup-" + randomBytes(8).toString("hex") + ".sqlite",
      );
      const connection = new DatabaseSync(path.join(dataDir, "site.sqlite"));
      try {
        await backup(connection, temp);
      } finally {
        connection.close();
      }
      reply.header(
        "Content-Disposition",
        'attachment; filename="842-personal-backup.sqlite"',
      );
      const stream = fs.createReadStream(temp);
      stream.on("close", () => fs.unlinkSync(temp));
      return reply.send(stream);
    },
  );
  async function receive(req, prefix, max) {
    const file = await req.file({
      limits: { fileSize: max, files: 1, fields: 0, parts: 1 },
    });
    if (!file) throw new Error("请选择文件");
    const target = path.join(
      dataDir,
      prefix + "-" + randomBytes(8).toString("hex"),
    );
    try {
      await pipeline(file.file, fs.createWriteStream(target, { flags: "wx" }));
      if (file.file.truncated) throw new Error("文件过大");
      return target;
    } catch (error) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      throw error;
    }
  }
  app.post("/api/local/restore", { onRequest: requireLocal }, async (req) => {
    const file = await receive(req, "restore", 2 * 1024 ** 3);
    let source;
    try {
      source = new DatabaseSync(file, { readOnly: true });
      const state = source
        .prepare("SELECT value FROM local_state WHERE id=1")
        .get();
      const study = validateStudy(
        state ? JSON.parse(state.value) : emptyStudy(),
        new Set(catalog.questions.map((q) => q.id)),
      );
      const answers = source.prepare("SELECT * FROM answers").all();
      const photoRows = source
        .prepare("SELECT id,qid,length(bytes) AS size FROM photos")
        .all();
      const photoIds = new Set(photoRows.map((p) => p.id));
      for (const p of photoRows)
        if (
          !/^[a-f0-9]{40}$/.test(p.id) ||
          p.size > 12 * 1024 * 1024 ||
          typeof p.qid !== "string"
        )
          throw new Error("备份图片不合法");
      for (const a of answers)
        for (const photos of [JSON.parse(a.draft), JSON.parse(a.published)])
          if (
            !Array.isArray(photos) ||
            photos.length > 12 ||
            photos.some(
              (p) =>
                !photoIds.has(p) ||
                !photoRows.some((row) => row.id === p && row.qid === a.qid),
            )
          )
            throw new Error("备份答案不完整");
      await db.transaction(async (tx) => {
        const revision = await assertStudyRevision(tx, req.headers["if-match"]);
        await tx.run("DELETE FROM answers");
        await tx.run("DELETE FROM photos");
        for (const p of photoRows) {
          const row = source
            .prepare("SELECT bytes FROM photos WHERE id=?")
            .get(p.id);
          await tx.run(
            "INSERT INTO photos VALUES(?,?,?)",
            p.id,
            p.qid,
            row.bytes,
          );
        }
        for (const a of answers)
          await tx.run(
            "INSERT INTO answers VALUES(?,?,?,?)",
            a.qid,
            a.draft,
            a.published,
            a.updated,
          );
        await replaceLocalStudy(tx, study, revision);
      });
      return { ok: true };
    } finally {
      source?.close();
      fs.unlinkSync(file);
    }
  });
  app.post(
    "/api/local/import-pack",
    { onRequest: requireLocal },
    async (req) => {
      const file = await receive(req, "pack", 2 * 1024 ** 3);
      try {
        const result = await installLibrary(file);
        updates.recordContent("library", catalog.libraryRevision || 0, result.edition);
        return result;
      } catch (error) {
        throw Object.assign(error, { statusCode: 400 });
      } finally {
        fs.unlinkSync(file);
      }
    },
  );
  app.post(
    "/api/local/import-answers",
    { onRequest: requireLocal },
    updateCall(async (req) => {
      const file = await receive(req, "answer-pack", 1024 ** 3);
      try {
        const result = await installAnswers(file);
        updates.recordContent("answers", official().value.revision, result.edition);
        return result;
      } finally {
        fs.unlinkSync(file);
      }
    }),
  );
  app.post(
    "/api/local/export-answers",
    { onRequest: requireLocal },
    updateCall(async (req, reply) => {
      const { ids = [], edition, revision } = req.body || {};
      if (
        !Array.isArray(ids) ||
        ids.some((id) => !catalog.questions.some((q) => q.id === id)) ||
        typeof edition !== "string" ||
        !edition.trim() ||
        edition.length > 100 ||
        !Number.isSafeInteger(revision) ||
        revision <= official().value.revision
      )
        throw new Error("请填写递增的答案版本号、版本说明并选择公开的定稿答案");
      const old = official(),
        next = structuredClone(old.value);
      Object.assign(next, {
        revision,
        edition,
        requiresLibraryRevision: catalog.libraryRevision || 0,
      });
      const entries = new Map();
      for (const file of answerFiles(next))
        if (file !== "answers.json")
          entries.set(file, {
            name: file,
            file: path.join(old.directory, file),
          });
      for (const id of ids) {
        const row = await db.get(
          "SELECT published FROM answers WHERE qid=?",
          id,
        );
        const photos = JSON.parse(row?.published || "[]");
        if (!photos.length) throw new Error("选中的定稿答案已变化，请重新选择");
        next.answers[id] = [];
        for (const photo of photos) {
          const record = await db.get(
            "SELECT bytes FROM photos WHERE id=? AND qid=?",
            photo,
            id,
          );
          if (!record) throw new Error("答案图片不存在");
          const name = "answers/" + photo + ".webp";
          next.answers[id].push(name);
          entries.set(name, { name, bytes: Buffer.from(record.bytes) });
        }
      }
      const selected = answerFiles(next),
        file = path.join(
          dataDir,
          "answers-export-" + randomBytes(8).toString("hex") + ".842answers",
        );
      await writeZip(file, [
        { name: "answers.json", bytes: Buffer.from(JSON.stringify(next)) },
        ...[...entries.values()].filter((e) => selected.has(e.name)),
      ]);
      reply.header(
        "Content-Disposition",
        'attachment; filename="842-answers.842answers"',
      );
      const stream = fs.createReadStream(file);
      stream.on("close", () => fs.unlinkSync(file));
      return reply.send(stream);
    }),
  );
  app.get("/api/local/exportable", { onRequest: requireLocal }, async () => ({
    items: (
      await db.all("SELECT qid,published FROM answers WHERE published!='[]'")
    ).map((r) => ({ id: r.qid, count: JSON.parse(r.published).length })),
  }));
  app.post(
    "/api/local/export-pack",
    { onRequest: requireLocal },
    async (req, reply) => {
      const { ids = [], edition } = req.body || {};
      if (
        !Array.isArray(ids) ||
        ids.some((id) => !catalog.questions.some((q) => q.id === id)) ||
        typeof edition !== "string" ||
        !edition.trim() ||
        edition.length > 100
      )
        throw Object.assign(new Error("请填写版本并选择需要导出的答案"), {
          statusCode: 400,
        });
      const next = structuredClone(catalog);
      delete next.updateKind; // A legacy mixed export is not a standalone library update.
      next.edition = edition;
      next.officialAnswers ||= {};
      const entries = new Map();
      for (const name of packPaths(next))
        if (name !== "catalog.json")
          entries.set(name, { name, file: path.join(store.library, name) });
      for (const id of ids) {
        const row = await db.get(
          "SELECT published FROM answers WHERE qid=?",
          id,
        );
        const photos = JSON.parse(row?.published || "[]");
        next.officialAnswers[id] = [];
        for (const photo of photos) {
          const name = "answers/" + photo + ".webp";
          const p = await db.get(
            "SELECT bytes FROM photos WHERE id=? AND qid=?",
            photo,
            id,
          );
          if (!p) throw new Error("答案已变化，请重新导出");
          entries.set(name, { name, bytes: Buffer.from(p.bytes) });
          next.officialAnswers[id].push(name);
        }
      }
      const selected = packPaths(next);
      const file = path.join(
        dataDir,
        "export-" + randomBytes(8).toString("hex") + ".842pack",
      );
      await writeZip(file, [
        { name: "catalog.json", bytes: Buffer.from(JSON.stringify(next)) },
        ...[...entries.values()].filter((e) => selected.has(e.name)),
      ]);
      reply.header(
        "Content-Disposition",
        'attachment; filename="842-library.842pack"',
      );
      const stream = fs.createReadStream(file);
      stream.on("close", () => fs.unlinkSync(file));
      return reply.send(stream);
    },
  );
}
