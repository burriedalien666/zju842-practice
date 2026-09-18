import test from "node:test";
import assert from "node:assert/strict";
import { connectionFeedback } from "../src/local-connection.js";
import { GitHubUpdates } from "../server/update-source.js";

test("GitHub connection errors identify the remote network, not the local service", async () => {
  const source = new GitHubUpdates(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(source.check(), (e) => {
    assert.equal(e.stage, "github-api");
    assert.equal(e.code, "NETWORK_FAILURE");
    assert.notEqual(e.code, "LOCAL_CONNECTION");
    assert.match(e.message, /本机服务仍可使用已有题目/);
    assert.match(e.message, /GitHub/);
    assert.equal(connectionFeedback(e), null);
    return true;
  });
});
