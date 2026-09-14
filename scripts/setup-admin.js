import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, setPassword } from "../server/db.js";

function hiddenPassword(prompt) {
  if (!process.stdin.isTTY) throw new Error("请在交互终端设置密码");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    function read(chunk) {
      for (const char of chunk) {
        if (char === "\u0003" || char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", read);
          process.stdout.write("\n");
          if (char === "\u0003") reject(new Error("已取消"));
          else resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    process.stdin.on("data", read);
  });
}
const password = await hiddenPassword(
  "设置管理员密码（至少12个字符，不显示输入）：",
);
const confirm = await hiddenPassword("再次输入：");
if (password !== confirm) throw new Error("两次密码不一致");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = await openDatabase(
  path.resolve(root, process.env.DATA_DIR || "data"),
  {
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
);
try {
  await setPassword(db, password);
  console.log("管理员密码已设置，旧登录已退出。");
} finally {
  await db.close();
}
