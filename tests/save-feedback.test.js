import test from "node:test";
import assert from "node:assert/strict";
import { saveFeedback } from "../src/save-feedback.js";
test("connection errors explain launcher recovery without claiming data saved or asking to refresh", () => {
  const message = saveFeedback({
    dirty: true,
    durable: true,
    error: new TypeError("Failed to fetch"),
  });
  assert.match(message.title, /连接已断开/);
  assert.match(message.detail, /启动器/);
  assert.match(message.detail, /回到本页/);
  assert.match(message.detail, /暂存/);
  assert.equal(message.retry, true);
  assert.ok(!message.detail.includes("刷新可恢复"));
});
test("expired session, conflicts and disk errors are distinct; blocked staging does not promise recovery", () => {
  const auth = saveFeedback({
    dirty: true,
    durable: true,
    error: { statusCode: 401, message: "unauthorized" },
  });
  assert.match(auth.title, /会话已失效/);
  const conflict = saveFeedback({
    dirty: true,
    durable: true,
    error: { statusCode: 409, message: "conflict" },
  });
  assert.equal(conflict.retry, false);
  assert.match(conflict.detail, /导出/);
  const disk = saveFeedback({
    dirty: true,
    durable: false,
    error: new Error("磁盘写入失败"),
  });
  assert.match(disk.detail, /立即导出/);
  assert.ok(!disk.detail.includes("仍暂存"));
});

test("local 503 lifecycle errors retain staged changes and provide a save retry", () => {
  const message = saveFeedback({
    dirty: true,
    durable: true,
    error: { code: "LOCAL_UNAVAILABLE", statusCode: 503 },
  });
  assert.match(message.title, /尚未保存/);
  assert.match(message.detail, /不要先刷新或关闭/);
  assert.match(message.detail, /暂存/);
  assert.equal(message.retry, true);
});
