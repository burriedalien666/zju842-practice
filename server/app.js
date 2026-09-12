import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { openDatabase, checkPassword } from "./db.js";

const fail = (code, message) =>
  Object.assign(new Error(message), { statusCode: code });
export async function createApp({
  dataDir,
  catalog,
  origin,
  staticDir,
  production = false,
  logger = false,
}) {
  if (production && !origin?.startsWith("https://"))
    throw new Error("线上站点必须配置HTTPS PUBLIC_ORIGIN");
  const allowedOrigin = new URL(origin).origin;
  const app = Fastify({ logger, bodyLimit: 32 * 1024, trustProxy: false });
  const db = openDatabase(dataDir);
  app.decorate("db", db);
  app.addHook("onClose", async () => db.close());
  const questions = new Set(catalog.questions.map((q) => q.id));
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: "1 minute",
  });
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    if (status >= 500) req.log.error(err);
    reply
      .code(status)
      .send({ error: status >= 500 ? "服务器暂时无法完成操作" : err.message });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (
      req.url.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== allowedOrigin
    )
      throw fail(403, "请求来源不匹配，请从网站页面操作");
  });
  function isAdmin(req) {
    const token = req.cookies.session;
    return (
      typeof token === "string" &&
      !!db
        .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
        .get(token, Date.now())
    );
  }
  async function admin(req) {
    if (!isAdmin(req)) throw fail(401, "请先登录管理员账号");
  }
  function qid(req) {
    const id = req.params.qid;
    if (!questions.has(id)) throw fail(404, "题目不存在");
    return id;
  }
  function answer(id) {
    const row = db.prepare("SELECT * FROM answers WHERE qid=?").get(id);
    return row
      ? {
          draft: JSON.parse(row.draft),
          published: JSON.parse(row.published),
          updated: row.updated,
        }
      : { draft: [], published: [], updated: null };
  }
  function save(id, draft, published) {
    db.prepare(
      "INSERT INTO answers VALUES(?,?,?,?) ON CONFLICT(qid) DO UPDATE SET draft=excluded.draft,published=excluded.published,updated=excluded.updated",
    ).run(
      id,
      JSON.stringify(draft),
      JSON.stringify(published),
      new Date().toISOString(),
    );
    const keep = new Set([...draft, ...published]);
    for (const p of db.prepare("SELECT id FROM photos WHERE qid=?").all(id))
      if (!keep.has(p.id))
        db.prepare("DELETE FROM photos WHERE id=?").run(p.id);
  }
  function transaction(fn) {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/session", async (req) => ({
    admin: isAdmin(req),
    configured: !!db.prepare("SELECT id FROM admin").get(),
  }));
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      if (!(await checkPassword(db, req.body?.password)))
        throw fail(401, "密码不正确或管理员尚未设置");
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(
        token,
        Date.now() + 7 * 86400_000,
      );
      reply.setCookie("session", token, {
        path: "/",
        httpOnly: true,
        secure: production,
        sameSite: "strict",
        maxAge: 7 * 86400,
      });
      return { admin: true };
    },
  );
  app.post("/api/logout", { onRequest: admin }, async (req, reply) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.cookies.session);
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/answers/:qid", async (req) => ({
    photos: answer(qid(req)).published,
  }));
  app.get("/api/admin/answers/:qid", { onRequest: admin }, async (req) =>
    answer(qid(req)),
  );
  app.post(
    "/api/admin/answers/:qid/photos",
    { onRequest: admin },
    async (req) => {
      const id = qid(req);
      const replacing = req.query.replace;
      if (replacing && !answer(id).draft.includes(replacing))
        throw fail(400, "被替换图片不在草稿中");
      if (!replacing && answer(id).draft.length >= 12)
        throw fail(400, "每题最多12张答案图片");
      const part = await req.file();
      if (!part) throw fail(400, "请选择一张照片");
      const input = await part.toBuffer();
      let bytes;
      try {
        const metadata = await sharp(input, {
          limitInputPixels: 60_000_000,
        }).metadata();
        if (
          !["jpeg", "png", "webp", "heif"].includes(metadata.format) ||
          (metadata.pages || 1) > 1
        )
          throw new Error("format");
        bytes = await sharp(input, { limitInputPixels: 60_000_000 })
          .rotate()
          .resize({
            width: 2400,
            height: 3200,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88 })
          .toBuffer();
      } catch {
        throw fail(400, "图片无法读取，请使用普通JPG、PNG或WebP照片");
      }
      return transaction(() => {
        const a = answer(id);
        if (replacing && !a.draft.includes(replacing))
          throw fail(409, "草稿已经变化，请刷新");
        if (!replacing && a.draft.length >= 12)
          throw fail(400, "每题最多12张答案图片");
        const photo = randomBytes(20).toString("hex");
        db.prepare("INSERT INTO photos VALUES(?,?,?)").run(photo, id, bytes);
        save(
          id,
          replacing
            ? a.draft.map((p) => (p === replacing ? photo : p))
            : [...a.draft, photo],
          a.published,
        );
        return answer(id);
      });
    },
  );
  app.put(
    "/api/admin/answers/:qid/draft",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        photos = req.body?.photos,
        a = answer(id);
      if (
        !Array.isArray(photos) ||
        photos.length > 12 ||
        new Set(photos).size !== photos.length ||
        photos.some(
          (p) =>
            typeof p !== "string" || ![...a.draft, ...a.published].includes(p),
        )
      )
        throw fail(400, "答案图片列表不合法");
      transaction(() => save(id, photos, a.published));
      return answer(id);
    },
  );
  app.post(
    "/api/admin/answers/:qid/rotate/:photo",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        old = req.params.photo;
      if (!answer(id).draft.includes(old)) throw fail(404, "草稿图片不存在");
      const row = db
        .prepare("SELECT bytes FROM photos WHERE id=? AND qid=?")
        .get(old, id);
      const bytes = await sharp(row.bytes)
        .rotate(90)
        .webp({ quality: 88 })
        .toBuffer();
      return transaction(() => {
        const a = answer(id);
        if (!a.draft.includes(old)) throw fail(409, "草稿已经变化，请刷新");
        const photo = randomBytes(20).toString("hex");
        db.prepare("INSERT INTO photos VALUES(?,?,?)").run(photo, id, bytes);
        save(
          id,
          a.draft.map((p) => (p === old ? photo : p)),
          a.published,
        );
        return answer(id);
      });
    },
  );
  app.post(
    "/api/admin/answers/:qid/publish",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        a = answer(id);
      if (!a.draft.length) throw fail(400, "请先上传答案照片");
      transaction(() => save(id, a.draft, a.draft));
      return answer(id);
    },
  );
  app.post(
    "/api/admin/answers/:qid/withdraw",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        a = answer(id);
      transaction(() => save(id, a.draft, []));
      return answer(id);
    },
  );
  app.get("/api/media/:photo", async (req, reply) => {
    const photo = db
      .prepare("SELECT * FROM photos WHERE id=?")
      .get(req.params.photo);
    if (
      !photo ||
      (!answer(photo.qid).published.includes(photo.id) && !isAdmin(req))
    )
      throw fail(404, "图片不存在");
    return reply.type("image/webp").send(Buffer.from(photo.bytes));
  });
  app.post(
    "/api/corrections",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { questionId, message } = req.body || {};
      if (
        !questions.has(questionId) ||
        typeof message !== "string" ||
        message.trim().length < 5 ||
        message.length > 2000
      )
        throw fail(400, "请填写5—2000字的纠错内容");
      db.prepare(
        "INSERT INTO corrections(qid,message,created) VALUES(?,?,?)",
      ).run(questionId, message.trim(), new Date().toISOString());
      return reply.code(201).send({ ok: true });
    },
  );
  app.get("/api/admin/corrections", { onRequest: admin }, async (req) => {
    const page = Number(req.query.page || 0);
    if (!Number.isInteger(page) || page < 0 || page > 100000)
      throw fail(400, "页码不合法");
    return {
      items: db
        .prepare(
          "SELECT * FROM corrections ORDER BY resolved ASC,id DESC LIMIT 50 OFFSET ?",
        )
        .all(page * 50),
      total: db.prepare("SELECT COUNT(*) AS n FROM corrections").get().n,
    };
  });
  app.patch("/api/admin/corrections/:id", { onRequest: admin }, async (req) => {
    if (typeof req.body?.resolved !== "boolean")
      throw fail(400, "处理状态不合法");
    const result = db
      .prepare("UPDATE corrections SET resolved=? WHERE id=?")
      .run(Number(req.body.resolved), req.params.id);
    if (!result.changes) throw fail(404, "纠错记录不存在");
    return { ok: true };
  });
  if (staticDir)
    await app.register(staticFiles, {
      root: staticDir,
      index: ["index.html"],
      list: false,
    });
  return app;
}
