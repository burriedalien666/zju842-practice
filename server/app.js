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
  databaseUrl,
  databaseToken,
  catalog,
  origin,
  staticDir,
  production = false,
  logger = false,
  trustProxy = false,
}) {
  if (production && !origin?.startsWith("https://"))
    throw new Error("线上站点必须配置HTTPS PUBLIC_ORIGIN");
  const allowedOrigin = new URL(origin).origin;
  const app = Fastify({ logger, bodyLimit: 32 * 1024, trustProxy });
  const db = await openDatabase(dataDir, {
    url: databaseUrl,
    authToken: databaseToken,
  });
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
    // 驱动错误可能携带连接信息，不向访客或日志输出数据库凭据。
    if (status >= 500)
      req.log.error(
        { requestId: req.id, errorType: err.name },
        "Request failed",
      );
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
  async function isAdmin(req) {
    const token = req.cookies.session;
    return (
      typeof token === "string" &&
      !!(await db.get(
        "SELECT token FROM sessions WHERE token=? AND expires>?",
        token,
        Date.now(),
      ))
    );
  }
  async function admin(req) {
    if (!(await isAdmin(req))) throw fail(401, "请先登录管理员账号");
  }
  function qid(req) {
    const id = req.params.qid;
    if (!questions.has(id)) throw fail(404, "题目不存在");
    return id;
  }
  async function answer(id, connection = db) {
    const row = await connection.get("SELECT * FROM answers WHERE qid=?", id);
    return row
      ? {
          draft: JSON.parse(row.draft),
          published: JSON.parse(row.published),
          updated: row.updated,
        }
      : { draft: [], published: [], updated: null };
  }
  async function save(tx, id, draft, published) {
    await tx.run(
      "INSERT INTO answers(qid,draft,published,updated) VALUES(?,?,?,?) ON CONFLICT(qid) DO UPDATE SET draft=excluded.draft,published=excluded.published,updated=excluded.updated",
      id,
      JSON.stringify(draft),
      JSON.stringify(published),
      new Date().toISOString(),
    );
    const keep = [...new Set([...draft, ...published])];
    if (keep.length)
      await tx.run(
        "DELETE FROM photos WHERE qid=? AND id NOT IN (" +
          keep.map(() => "?").join(",") +
          ")",
        id,
        ...keep,
      );
    else await tx.run("DELETE FROM photos WHERE qid=?", id);
    return answer(id, tx);
  }
  app.get("/api/health", async () => {
    await db.get("SELECT 1");
    return { ok: true };
  });
  app.get("/api/session", async (req) => ({
    admin: await isAdmin(req),
    configured: !!(await db.get("SELECT id FROM admin")),
  }));
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const token = randomBytes(32).toString("hex");
      await db.transaction(async (tx) => {
        if (!(await checkPassword(tx, req.body?.password)))
          throw fail(401, "密码不正确或管理员尚未设置");
        await tx.run("DELETE FROM sessions WHERE expires<?", Date.now());
        await tx.run(
          "INSERT INTO sessions VALUES(?,?)",
          token,
          Date.now() + 7 * 86400_000,
        );
      });
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
    await db.run("DELETE FROM sessions WHERE token=?", req.cookies.session);
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/answers/:qid", async (req) => ({
    photos: (await answer(qid(req))).published,
  }));
  app.get("/api/admin/answers/:qid", { onRequest: admin }, async (req) =>
    answer(qid(req)),
  );
  app.post(
    "/api/admin/answers/:qid/photos",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        replacing = req.query.replace,
        before = await answer(id);
      if (replacing && !before.draft.includes(replacing))
        throw fail(400, "被替换图片不在草稿中");
      if (!replacing && before.draft.length >= 12)
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
      return db.transaction(async (tx) => {
        const a = await answer(id, tx);
        if (replacing && !a.draft.includes(replacing))
          throw fail(409, "草稿已经变化，请刷新");
        if (!replacing && a.draft.length >= 12)
          throw fail(400, "每题最多12张答案图片");
        const photo = randomBytes(20).toString("hex");
        await tx.run("INSERT INTO photos VALUES(?,?,?)", photo, id, bytes);
        return save(
          tx,
          id,
          replacing
            ? a.draft.map((p) => (p === replacing ? photo : p))
            : [...a.draft, photo],
          a.published,
        );
      });
    },
  );
  app.put(
    "/api/admin/answers/:qid/draft",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        photos = req.body?.photos;
      return db.transaction(async (tx) => {
        const a = await answer(id, tx);
        if (
          !Array.isArray(photos) ||
          photos.length > 12 ||
          new Set(photos).size !== photos.length ||
          photos.some(
            (p) =>
              typeof p !== "string" ||
              ![...a.draft, ...a.published].includes(p),
          )
        )
          throw fail(400, "答案图片列表不合法");
        return save(tx, id, photos, a.published);
      });
    },
  );
  app.post(
    "/api/admin/answers/:qid/rotate/:photo",
    { onRequest: admin },
    async (req) => {
      const id = qid(req),
        old = req.params.photo;
      if (!(await answer(id)).draft.includes(old))
        throw fail(404, "草稿图片不存在");
      const row = await db.get(
        "SELECT bytes FROM photos WHERE id=? AND qid=?",
        old,
        id,
      );
      if (!row) throw fail(409, "草稿已经变化，请刷新");
      const bytes = await sharp(Buffer.from(row.bytes))
        .rotate(90)
        .webp({ quality: 88 })
        .toBuffer();
      return db.transaction(async (tx) => {
        const a = await answer(id, tx);
        if (!a.draft.includes(old)) throw fail(409, "草稿已经变化，请刷新");
        const photo = randomBytes(20).toString("hex");
        await tx.run("INSERT INTO photos VALUES(?,?,?)", photo, id, bytes);
        return save(
          tx,
          id,
          a.draft.map((p) => (p === old ? photo : p)),
          a.published,
        );
      });
    },
  );
  app.post(
    "/api/admin/answers/:qid/publish",
    { onRequest: admin },
    async (req) => {
      const id = qid(req);
      return db.transaction(async (tx) => {
        const a = await answer(id, tx);
        if (!a.draft.length) throw fail(400, "请先上传答案照片");
        return save(tx, id, a.draft, a.draft);
      });
    },
  );
  app.post(
    "/api/admin/answers/:qid/withdraw",
    { onRequest: admin },
    async (req) => {
      const id = qid(req);
      return db.transaction(async (tx) => {
        const a = await answer(id, tx);
        return save(tx, id, a.draft, []);
      });
    },
  );
  app.get("/api/media/:photo", async (req, reply) => {
    // 同一条查询同时校验公开状态，避免检查与读取跨事务发生变化。
    const allowed = await isAdmin(req);
    const photo = allowed
      ? await db.get("SELECT bytes FROM photos WHERE id=?", req.params.photo)
      : await db.get(
          "SELECT p.bytes FROM photos p JOIN answers a ON a.qid=p.qid WHERE p.id=? AND EXISTS (SELECT 1 FROM json_each(a.published) WHERE value=p.id)",
          req.params.photo,
        );
    if (!photo) throw fail(404, "图片不存在");
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
      await db.run(
        "INSERT INTO corrections(qid,message,created) VALUES(?,?,?)",
        questionId,
        message.trim(),
        new Date().toISOString(),
      );
      return reply.code(201).send({ ok: true });
    },
  );
  app.get("/api/admin/corrections", { onRequest: admin }, async (req) => {
    const page = Number(req.query.page || 0);
    if (!Number.isInteger(page) || page < 0 || page > 100000)
      throw fail(400, "页码不合法");
    return {
      items: await db.all(
        "SELECT * FROM corrections ORDER BY resolved ASC,id DESC LIMIT 50 OFFSET ?",
        page * 50,
      ),
      total: (await db.get("SELECT COUNT(*) AS n FROM corrections")).n,
    };
  });
  app.patch("/api/admin/corrections/:id", { onRequest: admin }, async (req) => {
    if (typeof req.body?.resolved !== "boolean")
      throw fail(400, "处理状态不合法");
    const result = await db.run(
      "UPDATE corrections SET resolved=? WHERE id=?",
      Number(req.body.resolved),
      req.params.id,
    );
    if (!result.rowsAffected) throw fail(404, "纠错记录不存在");
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
