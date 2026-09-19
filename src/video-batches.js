import { videoUrl } from "./curriculum.js";

// Import batches contain public link metadata only. Full catalog validation is
// performed by the author tool before replacing its state-owning catalog file.
export function normalizeVideoBatch(value) {
  if (
    !value ||
    value.format !== 1 ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > 5000
  )
    throw new Error("视频批次应为format=1及1—5000条items");
  const ids = new Set();
  const fields = [
    "id",
    "target",
    "targetId",
    "title",
    "url",
    "author",
    "collection",
    "segments",
  ];
  return value.items.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((k) => !fields.includes(k))
    )
      throw new Error("视频条目包含未知字段，只导入公开链接元数据");
    if (
      typeof row.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) ||
      ids.has(row.id)
    )
      throw new Error("视频批次编号为空、重复或不合法");
    if (row.target !== "question")
      throw new Error("只导入明确关联单题的视频，请填写原题号");
    ids.add(row.id);
    return { ...row, url: videoUrl(row.url) };
  });
}

export function mergeVideoBatch(catalog, batch) {
  const rows = normalizeVideoBatch(batch);
  const next = structuredClone(catalog);
  const existing = new Map((next.videoLessons || []).map((v) => [v.id, v]));
  const counts = { added: 0, updated: 0, unchanged: 0 };
  const key = (v) => JSON.stringify([v.target, v.targetId, videoUrl(v.url)]);
  for (const row of rows) {
    const previous = existing.get(row.id);
    // Changing a stable ID to refer to another target/video is usually a wrong
    // batch. Use a new ID for a new association instead of silently reassigning.
    if (previous && key(previous) !== key(row))
      throw new Error(`编号${row.id}已关联其他题目或视频，请使用新编号`);
    const duplicate = [...existing.values()].find(
      (v) => v.id !== row.id && key(v) === key(row),
    );
    if (duplicate)
      throw new Error(`同一目标和视频重复：${row.id}与${duplicate.id}`);
    if (!previous) counts.added++;
    else if (JSON.stringify(previous) === JSON.stringify(row))
      counts.unchanged++;
    else counts.updated++;
    existing.set(row.id, row);
  }
  next.videoLessons = [...existing.values()];
  return { catalog: next, counts };
}

export function prepareCollectionBatch(
  collection,
  { prefix, target, targetId, from = 1, to },
) {
  if (
    !collection ||
    collection.format !== 1 ||
    !Array.isArray(collection.items) ||
    collection.items.length < 1 ||
    collection.items.length > 5000
  )
    throw new Error("选集需含公开标题与链接的items数组");
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(prefix || ""))
    throw new Error("请提供1—50字符的批次编号前缀");
  if (target !== "question" || typeof targetId !== "string" || !targetId)
    throw new Error("请明确本批次关联的原题号，只支持question");
  to ??= collection.items.length;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from ||
    to > collection.items.length
  )
    throw new Error("分批范围超出选集，使用从1开始的包含区间");
  const seen = new Set();
  for (const item of collection.items) {
    if (
      !item ||
      typeof item.key !== "string" ||
      !/^[a-zA-Z0-9_-]{1,25}$/.test(item.key) ||
      seen.has(item.key)
    )
      throw new Error("选集条目需要稳定且不重复的key，例如BV编号加p编号");
    seen.add(item.key);
    videoUrl(item.url);
    if (
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 150
    )
      throw new Error("选集标题不合法");
  }
  return {
    format: 1,
    items: collection.items.slice(from - 1, to).map((item) => ({
      id: `${prefix}-${item.key}`,
      target,
      targetId,
      title: item.title,
      url: videoUrl(item.url),
      ...(collection.author ? { author: collection.author } : {}),
      ...(collection.title ? { collection: collection.title } : {}),
      ...(item.segments ? { segments: item.segments } : {}),
    })),
  };
}
