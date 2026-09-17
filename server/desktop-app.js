import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createApp } from "./app.js";
import { loadCatalog } from "./catalog.js";
import { currentLibrary } from "./local.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 启动器不读取.env。分发版从不使用作者的云端密钥或管理员账号。
const dataDir = path.resolve(root, process.env.ZJU842_DATA_DIR || "userdata");
fs.mkdirSync(dataDir, { recursive: true });
const baseDir = path.join(process.env.ZJU842_INSTALL_ROOT || root, "public"),
  library = currentLibrary(dataDir, baseDir);
const catalog = loadCatalog(path.join(library, "catalog.json"), library);
let app, origin, launchToken;
let committed = !process.send;
const initial = Number(process.env.ZJU842_PORT || 8843);
for (let port = initial; port < initial + 10; port++) {
  origin = "http://127.0.0.1:" + port;
  launchToken =
    process.env.ZJU842_LAUNCH_TOKEN || randomBytes(24).toString("hex");
  app = await createApp({
    dataDir,
    catalog,
    origin,
    staticDir: path.join(root, "dist"),
    local: {
      baseDir,
      launchToken,
      installRoot: process.env.ZJU842_INSTALL_ROOT,
      activateProgram: process.send
        ? async (update) => {
            setTimeout(async () => {
              try {
                await app.close();
                process.send({ type: "activate", ...update }, () =>
                  process.exit(75),
                );
              } catch (e) {
                console.error("重启失败：" + e.message);
                process.exit(1);
              }
            }, 400);
          }
        : undefined,
    },
  });
  app.addHook("onRequest", async () => {
    if (!committed)
      throw Object.assign(new Error("正在确认程序启动"), { statusCode: 503 });
  });
  try {
    await app.listen({ host: "127.0.0.1", port });
    break;
  } catch (error) {
    await app.close();
    if (error.code !== "EADDRINUSE" || port === initial + 9) throw error;
  }
}
process.on("disconnect", () => app.close().then(() => process.exit(0)));
const url = origin + "/__open/" + launchToken;
if (process.send) {
  await new Promise((resolve) => {
    process.once("message", (m) => {
      if (m.type === "committed") resolve();
    });
    process.send({ type: "ready", port: new URL(origin).port });
  });
  committed = true;
}
console.log("842题库已启动。关闭此窗口即可结束。");
console.log("个人数据目录：" + dataDir);
if (process.env.ZJU842_NO_BROWSER === "1") console.log("TEST_START_URL=" + url);
else if (process.env.ZJU842_RESTARTING === "1")
  console.log("程序更新已完成，请回到原页面。");
else if (process.platform === "win32")
  spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    windowsHide: true,
    stdio: "ignore",
  }).on("error", () => console.log("请在浏览器打开：" + url));
else
  spawn("open", [url], { stdio: "ignore" }).on("error", () =>
    console.log("请在浏览器打开：" + url),
  );
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.close().then(() => process.exit(0)));
