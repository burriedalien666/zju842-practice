import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./catalog.js";
import { createApp } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8843);
const app = await createApp({
  dataDir: path.resolve(root, process.env.DATA_DIR || "data"),
  catalog: loadCatalog(
    path.join(root, "public/catalog.json"),
    path.join(root, "public"),
  ),
  origin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`,
  production: process.env.NODE_ENV === "production",
  staticDir: path.join(root, "dist"),
  logger: true,
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.close().then(() => process.exit(0)));
await app.listen({ port, host: process.env.HOST || "127.0.0.1" });
