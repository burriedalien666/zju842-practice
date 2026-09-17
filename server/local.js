import fs from "node:fs";
import path from "node:path";
import packageInfo from "../package.json" with { type: "json" };
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DatabaseSync, backup } from "node:sqlite";
import { validateStudy, emptyStudy } from "../src/study.js";
import { packPaths, writeZip, extractPack } from "./packs.js";
import { loadCatalog } from "./catalog.js";
import { createUpdates } from "./updates.js";
import { atomicJson } from "./update-files.js";
import {
  readOfficialAnswers,
  extractAnswers,
  activateAnswers,
  answerFiles,
} from "./answer-packs.js";
import {
  ensureLocalStudySchema,
  readLocalStudy,
  writeLocalStudy,
  assertStudyRevision,
  replaceLocalStudy,
} from "./study-version.js";

export function currentLibrary(dataDir, baseDir) {
  const pointer = path.join(dataDir, "library.json");
  if (!fs.existsSync(pointer)) return baseDir;
  const { directory } = JSON.parse(fs.readFileSync(pointer, "utf8"));
  if (!/^edition-[a-f0-9]{16}$/.test(directory))
    throw new Error("题库位置不合法");
  return path.join(dataDir, "libraries", directory);
}

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
  let library = currentLibrary(dataDir, baseDir);
  await ensureLocalStudySchema(db);
  const official = () =>
    readOfficialAnswers(dataDir, catalog, library, baseDir);
  async function installLibrary(file, expected) {
    const name = "edition-" + randomBytes(8).toString("hex");
    const destination = path.join(dataDir, "libraries", name);
    fs.mkdirSync(destination, { recursive: true });
    try {
      const next = await extractPack(file, destination);
      if (expected || next.updateKind === "library") {
        if (
          next.libraryId !== "zju842" ||
          !Number.isSafeInteger(next.libraryRevision) ||
          next.libraryRevision < (catalog.libraryRevision || 0) ||
          (expected && next.libraryRevision !== expected.revision) ||
          Object.keys(next.officialAnswers || {}).length
        )
          throw new Error("题库包版本不匹配或混入了答案更新");
        const ids = new Set(next.questions.map((q) => q.id));
        if (catalog.questions.some((q) => !ids.has(q.id)))
          throw new Error("新版缺少已有题号，已停止更新以保留学习记录");
        if (!fs.existsSync(path.join(dataDir, "official-answers.json"))) {
          const old = official();
          const dir = path.join(
            dataDir,
            "libraries",
            "answers-" + randomBytes(8).toString("hex"),
          );
          fs.mkdirSync(dir, { recursive: true });
          atomicJson(path.join(dir, "answers.json"), old.value);
          for (const file of answerFiles(old.value))
            if (file !== "answers.json") {
              fs.mkdirSync(path.dirname(path.join(dir, file)), {
                recursive: true,
              });
              fs.copyFileSync(
                path.join(old.directory, file),
                path.join(dir, file),
              );
            }
          activateAnswers(dataDir, dir);
        }
      }
      atomicJson(path.join(dataDir, "library.json"), { directory: name });
      library = destination;
      Object.keys(catalog).forEach((k) => delete catalog[k]);
      Object.assign(catalog, next);
      return {
        ok: true,
        questions: catalog.questions.length,
        edition: catalog.edition,
      };
    } catch (e) {
      fs.rmSync(destination, { recursive: true, force: true });
      throw e;
    }
  }
  async function installAnswers(file, expected) {
    const dir = path.join(
      dataDir,
      "libraries",
      "answers-" + randomBytes(8).toString("hex"),
    );
    fs.mkdirSync(dir, { recursive: true });
    try {
      const next = await extractAnswers(file, dir);
      if (expected && next.revision !== expected.revision)
        throw new Error("答案包版本与发布信息不符");
      if (
        next.requiresLibraryRevision > (catalog.libraryRevision || 0) ||
        Object.keys(next.answers).some(
          (id) => !catalog.questions.some((q) => q.id === id),
        )
      )
        throw new Error("答案对应的题目尚未安装，请先更新题库");
      if (next.revision < official().value.revision)
        throw new Error("不能用旧答案包覆盖新版公共答案");
      activateAnswers(dataDir, dir);
      return { ok: true, edition: next.edition };
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }
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
  app.decorate("localActiveWrites", 0);
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (updates.pauseWrites)
      throw Object.assign(new Error("正在安装更新，请稍后操作"), {
        statusCode: 409,
      });
    if (
      updates.busy &&
      /\/local\/(import-pack|import-answers|restore|export-pack|export-answers)$/.test(
        req.url,
      )
    )
      throw Object.assign(new Error("请等待当前更新完成"), { statusCode: 409 });
    req.localWriteActive = true;
    app.localActiveWrites++;
  });
  app.addHook("onResponse", async (req) => {
    if (req.localWriteActive) {
      req.localWriteActive = false;
      app.localActiveWrites--;
    }
  });
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
  app.get("/catalog.json", async () => catalog);
  app.get("/questions/:file", async (req, reply) => {
    const name = "questions/" + req.params.file;
    if (!catalog.questions.some((q) => q.images.some((i) => i.src === name)))
      return reply.code(404).send();
    return reply.sendFile(req.params.file, path.join(library, "questions"));
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
      updates.start(req.body?.kind, req.body?.target, req.headers["if-match"]),
    ),
  );
  app.get("/api/local/study", { onRequest: requireLocal }, async () => {
    return readLocalStudy(db);
  });
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
        return await installLibrary(file);
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
        return await installAnswers(file);
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
      next.edition = edition;
      next.officialAnswers ||= {};
      const entries = new Map();
      for (const name of packPaths(next))
        if (name !== "catalog.json")
          entries.set(name, { name, file: path.join(library, name) });
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
