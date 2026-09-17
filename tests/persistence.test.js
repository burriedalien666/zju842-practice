import test from "node:test";
import assert from "node:assert/strict";
import { StudySaver } from "../src/persistence.js";
const state = (n) => ({ version: 1, records: {}, lists: [], n });
function storage() {
  const items = new Map();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, v),
    removeItem: (k) => items.delete(k),
  };
}
function setup(send, extra = {}) {
  return new StudySaver({
    send,
    storage: storage(),
    key: "test-tab",
    revision: "rev0",
    ...extra,
  });
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("outbox is durable before the first request; success removes it", async () => {
  let saver;
  saver = setup(async (payload, revision) => {
    assert.equal(saver.readPending().payload, payload);
    assert.equal(revision, "rev0");
    return { revision: "rev1" };
  });
  await saver.queue(state(1));
  assert.equal(saver.dirty, false);
  assert.equal(saver.readPending(), null);
  assert.equal(saver.revision, "rev1");
});
test("failure stays dirty, survives reload and retries using the original revision", async () => {
  const disk = storage();
  const first = setup(
    async () => {
      throw new Error("disk unavailable");
    },
    { storage: disk },
  );
  await first.queue(state(1));
  assert.equal(first.dirty, true);
  assert.match(first.error.message, /disk/);
  const second = setup(
    async (payload, revision) => {
      assert.deepEqual(JSON.parse(payload), state(1));
      assert.equal(revision, "rev0");
      return { revision: "rev1" };
    },
    { storage: disk },
  );
  assert.equal(second.restore(second.readPending(), state(0)), true);
  assert.equal(second.dirty, true);
  await second.retry();
  assert.equal(second.dirty, false);
  assert.equal(second.error, null);
});
test("rapid changes serialize and coalesce without dropping the newest state", async () => {
  const gate = deferred();
  const sent = [];
  const saver = setup(async (payload, revision) => {
    sent.push([JSON.parse(payload).n, revision]);
    if (sent.length === 1) await gate.promise;
    return { revision: "rev" + sent.length };
  });
  const running = saver.queue(state(1));
  await Promise.resolve();
  saver.queue(state(2));
  saver.queue(state(3));
  assert.equal(JSON.parse(saver.readPending().payload).n, 3);
  gate.resolve();
  await running;
  assert.deepEqual(sent, [
    [1, "rev0"],
    [3, "rev1"],
  ]);
  assert.equal(saver.dirty, false);
});
test("a conflict does not retry automatically or overwrite another tab", async () => {
  let calls = 0;
  const saver = setup(async () => {
    calls++;
    throw Object.assign(new Error("conflict"), { statusCode: 409 });
  });
  await saver.queue(state(1));
  await saver.queue(state(2));
  await saver.retry();
  assert.equal(calls, 1);
  assert.equal(JSON.parse(saver.readPending().payload).n, 2);
  assert.equal(saver.dirty, true);
});
test("lost acknowledgement does not create a false conflict on reload", async () => {
  const saver = setup(async () => ({ revision: "rev1" }));
  assert.equal(
    saver.restore(
      { revision: "rev0", payload: JSON.stringify(state(1)) },
      state(1),
    ),
    false,
  );
  assert.equal(saver.dirty, false);
});
test("recovery marks a changed server revision as a conflict", () => {
  const saver = setup(async () => ({ revision: "rev2" }), { revision: "rev1" });
  saver.restore(
    { revision: "rev0", payload: JSON.stringify(state(1)) },
    state(2),
  );
  assert.equal(saver.error.statusCode, 409);
  assert.equal(saver.dirty, true);
});
test("unavailable browser storage still permits a successful disk save", async () => {
  const saver = setup(async () => ({ revision: "rev1" }), {
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    },
  });
  await saver.queue(state(1));
  assert.equal(saver.dirty, false);
  assert.equal(saver.durable, false);
});
test("malformed outbox is rejected rather than silently overwritten", () => {
  const disk = storage();
  disk.setItem("test-tab", "{invalid");
  const saver = setup(async () => ({}), { storage: disk });
  assert.throws(() => saver.readPending());
  assert.equal(disk.getItem("test-tab"), "{invalid");
});
test("separate tab keys cannot clear each others unsaved work", async () => {
  const disk = storage();
  const first = setup(
    async () => {
      throw new Error("offline");
    },
    { storage: disk, key: "a" },
  );
  const second = setup(async () => ({ revision: "rev1" }), {
    storage: disk,
    key: "b",
  });
  await first.queue(state(1));
  await second.queue(state(2));
  assert.ok(disk.getItem("a"));
  assert.equal(disk.getItem("b"), null);
});
test("reset clears a resolved/discarded outbox and sets the latest revision", async () => {
  const saver = setup(async () => {
    throw new Error("offline");
  });
  await saver.queue(state(1));
  saver.reset("new");
  assert.equal(saver.error, null);
  assert.equal(saver.dirty, false);
  assert.equal(saver.revision, "new");
});

test("lost acknowledgement recognizes server-normalized object key order", () => {
  const saver = setup(async () => ({ revision: "rev1" }), { revision: "rev1" });
  const client = {
    version: 1,
    records: { q: { star: true, state: "" } },
    lists: [],
  };
  const server = {
    version: 1,
    records: { q: { state: "", star: true } },
    lists: [],
  };
  assert.equal(
    saver.restore(
      { revision: "rev0", payload: JSON.stringify(client) },
      server,
    ),
    false,
  );
  assert.equal(saver.dirty, false);
});

test("blocked staging storage does not prevent loading or saving disk data", async () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  const saver = setup(async () => ({ revision: "rev1" }), { storage: blocked });
  assert.equal(saver.readPending(), null);
  assert.equal(saver.durable, false);
  await saver.queue(state(1));
  assert.equal(saver.dirty, false);
  assert.equal(
    saver.restore(
      { revision: "rev0", payload: JSON.stringify(state(1)) },
      state(1),
    ),
    false,
  );
});

test("tab-isolated stores cannot remove each others staged data even with the same key", async () => {
  const first = setup(
    async () => {
      throw new Error("offline");
    },
    { storage: storage(), key: "same-directory" },
  );
  const second = setup(async () => ({ revision: "next" }), {
    storage: storage(),
    key: "same-directory",
  });
  await first.queue(state(1));
  await second.queue(state(2));
  assert.equal(JSON.parse(first.readPending().payload).n, 1);
  assert.equal(second.readPending(), null);
});

test("old server acknowledgement without revision stays dirty instead of claiming success", async () => {
  const saver = setup(async () => ({ ok: true }));
  await saver.queue(state(1));
  assert.equal(saver.dirty, true);
  assert.match(saver.error.message, /版本/);
});
