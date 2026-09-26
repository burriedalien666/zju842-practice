import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app.js";
import { loadCatalog } from "../server/catalog.js";
import { createContentStore, currentLibrary } from "../server/content-store.js";
import { buildStructuredLibrary } from "./build-structured-library.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  dataDir = path.join(root, ".test-artifacts/structured-preview"),
  origin = "http://127.0.0.1:8863";
const existing = await fetch(origin + "/__structured-preview")
  .then((r) => r.json())
  .catch(() => null);
function open(url) {
  spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    windowsHide: true,
    stdio: "ignore",
  }).on("error", (e) => console.error("浏览器未打开：" + e.message));
}
const linkFile = path.join(dataDir, "launch-url.txt");
if (existing?.workspace === root && fs.existsSync(linkFile)) {
  if (!process.argv.includes("--no-browser"))
    open(fs.readFileSync(linkFile, "utf8").trim());
  console.log("已复用8863隔离接入验证。");
  process.exit(0);
}
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, "update-settings.json"),
  JSON.stringify({ autoCheck: false }),
);
const baseDir = path.join(root, "public"),
  catalog = loadCatalog(
    path.join(currentLibrary(dataDir, baseDir), "catalog.json"),
    currentLibrary(dataDir, baseDir),
  );
if ((catalog.libraryRevision || 0) < 4) {
  const zip = path.join(dataDir, "candidate-" + Date.now() + ".842pack");
  await buildStructuredLibrary(zip);
  const store = createContentStore({
    dataDir,
    catalog,
    baseDir,
    version: "0.5.8",
  });
  await store.installLibrary(zip);
  fs.unlinkSync(zip);
}
const token = randomBytes(24).toString("hex");
const app = await createApp({
  dataDir,
  catalog,
  origin,
  staticDir: path.join(root, "dist"),
  local: {
    baseDir,
    launchToken: token,
    updateSource: {
      check: async () => {
        throw new Error(
          "本地候选不连接公开发布源，请继续在原版中使用正式更新。",
        );
      },
    },
  },
});
app.get("/__structured-preview", async () => ({
  workspace: root,
  isolated: true,
}));
await app.listen({ host: "127.0.0.1", port: 8863 });
const url = origin + "/__open/" + token;
fs.writeFileSync(linkFile, url);
console.log(
  "本地接入验证已启动：http://127.0.0.1:8863/（独立测试资料，不连接原站数据）",
);
if (!process.argv.includes("--no-browser")) open(url);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.close().then(() => process.exit(0)));
