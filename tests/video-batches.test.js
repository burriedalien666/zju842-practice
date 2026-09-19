import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mergeVideoBatch,
  prepareCollectionBatch,
} from "../src/video-batches.js";
import { validateCatalog } from "../server/catalog.js";
import {
  questionVideos,
  videoEntryMarkup,
  videoDialogMarkup,
} from "../src/learning-content.js";
import { parsePublicCollection } from "../server/video-collection.js";
const base = JSON.parse(fs.readFileSync("public/catalog.json"));
const collection = {
  format: 1,
  title: "测试选集",
  author: "作者",
  items: [1, 2, 3].map((p) => ({
    key: `BV1qM411a7N2-p${p}`,
    title: `课时${p}`,
    url: `https://www.bilibili.com/video/BV1qM411a7N2?p=${p}`,
  })),
};
const batch = (from, to) =>
  prepareCollectionBatch(collection, {
    prefix: "course",
    target: "question",
    targetId: base.questions[0].id,
    from,
    to,
  });

test("separate batches append; repeated import is unchanged; conflicts cannot remap IDs or duplicate links", () => {
  const a = mergeVideoBatch(base, batch(1, 2));
  const b = mergeVideoBatch(a.catalog, batch(3, 3));
  assert.equal(b.catalog.videoLessons.length, 3);
  assert.deepEqual(mergeVideoBatch(b.catalog, batch(1, 2)).counts, {
    added: 0,
    updated: 0,
    unchanged: 2,
  });
  const conflict = batch(1, 1);
  conflict.items[0].targetId = "s2";
  assert.throws(() => mergeVideoBatch(b.catalog, conflict), /其他题目或视频/);
  const duplicate = batch(1, 1);
  duplicate.items[0].id = "another";
  assert.throws(() => mergeVideoBatch(b.catalog, duplicate), /重复/);
  const revision = batch(1, 1);
  revision.items[0].title = "修订标题";
  assert.equal(mergeVideoBatch(b.catalog, revision).counts.updated, 1);
  assert.deepEqual(base.videoLessons || [], []);
});

test("only explicit question links are shown; related chapter and knowledge lists never leak into the dialog", () => {
  const c = structuredClone(base);
  const q = c.questions.find((q) => q.knowledgeIds?.includes("s2.ctconv"));
  const row = {
    id: "topic",
    target: "question",
    targetId: q.id,
    title: "<video>",
    author: "<作者>",
    url: collection.items[0].url,
    segments: [
      { seconds: 0, title: "开头" },
      { seconds: 60, title: "<段落>" },
    ],
  };
  c.videoLessons = [
    row,
    {
      ...row,
      id: "chapter",
      target: "chapter",
      targetId: q.primaryChapter,
      title: "整章课程不应出现",
    },
    {
      ...row,
      id: "knowledge",
      target: "knowledge",
      targetId: "s2.ctconv",
      title: "知识点课程不应出现",
    },
  ];
  validateCatalog(c);
  assert.equal(questionVideos(c, q.id).length, 1);
  const markup = videoDialogMarkup(c, q.id);
  assert.doesNotMatch(
    markup,
    /整章课程|知识点课程|知识点学习|章节课程|展开更多/,
  );
  assert.match(markup, /&lt;作者&gt;/);
  assert.match(markup, /p=1&amp;t=60/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(videoEntryMarkup(c, q.id), /▶ 视频/);
  assert.equal(videoEntryMarkup(base, q.id), "");
  assert.equal(videoEntryMarkup(c, base.questions[0].id), "");
  assert.throws(
    () => mergeVideoBatch(base, { format: 1, items: [c.videoLessons[1]] }),
    /只导入/,
  );
  for (const change of [
    (r) => (r.targetId = "missing"),
    (r) => (r.url = "https://evil.test/"),
    (r) => (r.segments[1].seconds = 0),
    (r) => (r.author = {}),
  ]) {
    const invalid = structuredClone(c);
    change(invalid.videoLessons[0]);
    assert.throws(() => validateCatalog(invalid));
  }
});

test("collection page parser reads JSON without executing scripts and rejects missing/incomplete metadata", () => {
  const state = {
    videoData: {
      title: '含大括号}和引号"的标题',
      owner: { name: "作者" },
      pages: [
        { page: 1, part: "第1课" },
        { page: 2, part: "第2课" },
      ],
    },
  };
  const result = parsePublicCollection(
    `<script>window.__INITIAL_STATE__=${JSON.stringify(state)};throw new Error('must not run')</script>`,
    collection.items[0].url,
  );
  assert.equal(result.items.length, 2);
  assert.match(result.items[1].url, /p=2$/);
  const season = {
    videoData: {
      title: "集",
      pages: [{ page: 1, part: "a" }],
      ugc_season: {
        title: "系列",
        ep_count: 2,
        sections: [{ episodes: [{ bvid: "BV1qM411a7N2", title: "a" }] }],
      },
    },
  };
  assert.throws(
    () =>
      parsePublicCollection(
        `__INITIAL_STATE__=${JSON.stringify(season)};`,
        collection.items[0].url,
      ),
    /部分合集/,
  );
  assert.throws(
    () =>
      parsePublicCollection("verification required", collection.items[0].url),
    /没有公开/,
  );
  assert.throws(() =>
    prepareCollectionBatch(collection, {
      prefix: "c",
      target: "question",
      targetId: base.questions[0].id,
      from: 0,
      to: 2,
    }),
  );
});

test("CLI dry-run does not write; all-or-nothing invalid batch; repeated batch preserves previous records", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-video-batch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "catalog.json"),
    input = path.join(dir, "batch.json");
  fs.writeFileSync(file, JSON.stringify(base));
  fs.writeFileSync(input, JSON.stringify(batch(1, 2)));
  const before = fs.readFileSync(file);
  const run = (...args) =>
    execFileSync(
      process.execPath,
      [
        "scripts/manage-videos.js",
        "--catalog",
        file,
        "--import",
        input,
        ...args,
      ],
      { encoding: "utf8" },
    );
  run();
  assert.deepEqual(fs.readFileSync(file), before);
  run("--apply");
  const installed = fs.readFileSync(file);
  run("--apply");
  assert.deepEqual(fs.readFileSync(file), installed);
  const invalid = batch(3, 3);
  invalid.items.push({
    ...invalid.items[0],
    id: "invalid",
    targetId: "absent",
  });
  fs.writeFileSync(input, JSON.stringify(invalid));
  assert.notEqual(
    spawnSync(process.execPath, [
      "scripts/manage-videos.js",
      "--catalog",
      file,
      "--import",
      input,
      "--apply",
    ]).status,
    0,
  );
  assert.deepEqual(fs.readFileSync(file), installed);
});

test("repeat import repairs a missing program dependency without duplicating an existing segmented video", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "842-video-dependency-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = batch(1, 1);
  input.items[0].segments = [{ title: "开始", seconds: 0 }];
  const previous = mergeVideoBatch(base, input).catalog;
  previous.requiresProgram = "0.4.0";
  const file = path.join(dir, "catalog.json"),
    source = path.join(dir, "batch.json");
  fs.writeFileSync(file, JSON.stringify(previous));
  fs.writeFileSync(source, JSON.stringify(input));
  execFileSync(process.execPath, [
    "scripts/manage-videos.js",
    "--catalog",
    file,
    "--import",
    source,
    "--apply",
  ]);
  const next = JSON.parse(fs.readFileSync(file));
  assert.equal(next.requiresProgram, "0.5.5");
  assert.equal(next.videoLessons.length, 1);
});

test("public collection parser rejects mismatched video and incomplete or reordered parts", () => {
  const good = {
    title: "fixture",
    bvid: "BV1qM411a7N2",
    videos: 2,
    pages: [
      { page: 1, part: "a" },
      { page: 2, part: "b" },
    ],
  };
  for (const patch of [
    { bvid: "BV1234567890" },
    { videos: 3 },
    { pages: [] },
    {
      pages: [
        { page: 1, part: "a" },
        { page: 3, part: "b" },
      ],
    },
  ]) {
    assert.throws(() =>
      parsePublicCollection(
        `__INITIAL_STATE__=${JSON.stringify({ videoData: { ...good, ...patch } })};`,
        collection.items[0].url,
      ),
    );
  }
});
