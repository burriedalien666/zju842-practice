import path from "node:path";
import { isIP } from "node:net";

export function readConfig(env, root) {
  const render = env.RENDER === "true";
  const databaseUrl = env.TURSO_DATABASE_URL || undefined;
  const databaseToken = env.TURSO_AUTH_TOKEN || undefined;
  if (!!databaseUrl !== !!databaseToken)
    throw new Error("TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN 必须同时配置");
  if (render && !databaseUrl)
    throw new Error("Render 部署必须配置 Turso，不能将答案存入临时磁盘");
  const port = Number(env.PORT || 8843);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT 必须是有效端口");
  const trusted = (env.TRUST_PROXY_CIDRS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of trusted) {
    const [ip, prefix, extra] = value.split("/");
    const version = isIP(ip),
      bits = Number(prefix);
    if (
      !version ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          bits < 0 ||
          bits > (version === 4 ? 32 : 128)))
    )
      throw new Error(
        "TRUST_PROXY_CIDRS 只能包含可信代理的IP或CIDR，不能填写true或通配符",
      );
  }
  return {
    port,
    host: env.HOST || (render ? "0.0.0.0" : "127.0.0.1"),
    dataDir: path.resolve(root, env.DATA_DIR || "data"),
    databaseUrl,
    databaseToken,
    origin:
      env.PUBLIC_ORIGIN ||
      (render && env.RENDER_EXTERNAL_URL) ||
      "http://127.0.0.1:" + port,
    production: env.NODE_ENV === "production" || render,
    trustProxy: trusted.length ? trusted : false,
  };
}
