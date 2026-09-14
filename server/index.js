import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./catalog.js";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = readConfig(process.env, root);
let app;
try {
  app = await createApp({
    ...config,
    catalog: loadCatalog(
      path.join(root, "public/catalog.json"),
      path.join(root, "public"),
    ),
    staticDir: path.join(root, "dist"),
    logger: true,
  });
} catch {
  console.error(
    "网站启动失败，请检查数据库地址、密钥、网络及 PUBLIC_ORIGIN。不要在公开日志中粘贴密钥。",
  );
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.close().then(() => process.exit(0)));
await app.listen({ port: config.port, host: config.host });
