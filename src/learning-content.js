import { videoUrl } from "./curriculum.js";
export const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function videosMarkup(catalog, target, id) {
  const rows = (catalog.videoLessons || []).filter(
    (v) => v.target === target && v.targetId === id,
  );
  return rows.length
    ? `<section class="lesson-links" aria-label="作者视频讲解"><h3>视频讲解</h3>${rows.map((v) => `<a href="${escapeHtml(videoUrl(v.url))}" target="_blank" rel="noopener noreferrer">▶ ${escapeHtml(v.title)} <small>B站 · 新标签页打开</small></a>`).join("")}</section>`
    : "";
}
export function questionConcepts(catalog, q) {
  const labels = (q.knowledgeIds || [])
    .map((id) => catalog.curriculum?.topics.find((t) => t.id === id))
    .filter(Boolean);
  return labels.length
    ? `<div class="question-concepts"><span>涉及知识点</span>${labels.map((t) => `<button type="button" data-action="knowledge" data-id="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>`).join("")}</div>`
    : "";
}
