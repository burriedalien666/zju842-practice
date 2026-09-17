export const STORAGE_KEY = "zju842-study-v3";
export function emptyStudy() {
  return { version: 1, records: {}, lists: [] };
}
export function validateStudy(input, ids) {
  if (
    !input ||
    ![1, 2].includes(input.version) ||
    !input.records ||
    typeof input.records !== "object" ||
    Array.isArray(input.records) ||
    !Array.isArray(input.lists) ||
    input.lists.length > 100
  )
    throw new Error("学习记录格式不正确");
  const clean = emptyStudy();
  if (input.version === 2 || input.settings) {
    clean.version = 2;
    clean.settings = reviewSettings(input.settings);
  }
  for (const [id, r] of Object.entries(input.records)) {
    if (
      !id ||
      id.length > 160 ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new Error("题目编号不合法");
    if (
      !r ||
      !["", "done", "review"].includes(r.state) ||
      typeof r.star !== "boolean"
    )
      throw new Error("学习标记格式不正确");
    clean.records[id] = { state: r.state, star: r.star };
    if (r.review) clean.records[id].review = validateReview(r.review);
  }
  const names = new Set();
  for (const list of input.lists) {
    if (
      !list ||
      typeof list.name !== "string" ||
      !list.name.trim() ||
      list.name.length > 40 ||
      names.has(list.name) ||
      !Array.isArray(list.ids) ||
      list.ids.some((id) => typeof id !== "string")
    )
      throw new Error("题单格式不正确");
    names.add(list.name);
    clean.lists.push({
      name: list.name,
      ids: [...new Set(list.ids.filter((id) => ids.has(id)))],
    });
  }
  return clean;
}
export function loadStudy(storage, ids) {
  const value = storage.getItem(STORAGE_KEY);
  if (value) return validateStudy(JSON.parse(value), ids);
  const old = JSON.parse(storage.getItem("zju842-study-v2") || "null");
  if (!old) return emptyStudy();
  const records = {};
  for (const [id, row] of Object.entries(old))
    if (ids.has(id) && row && typeof row === "object")
      records[id] = {
        state: ["done", "review"].includes(row.state) ? row.state : "",
        star: !!row.star,
      };
  return { version: 1, records, lists: [] };
}
export function shuffled(ids, random = Math.random) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
import { reviewSettings, validateReview } from "./review.js";
