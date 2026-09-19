import { videoUrl } from "./curriculum.js";
export const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Only an explicit per-question association is a lesson for the current question.
// Chapter/concept metadata is not expanded into recommendations.
export function questionVideos(catalog, id) {
  if (!catalog.questions.some((q) => q.id === id)) return [];
  return (catalog.videoLessons || []).filter(
    (v) => v.target === "question" && v.targetId === id,
  );
}

export function videoEntryMarkup(catalog, id) {
  return questionVideos(catalog, id).length
    ? `<div class="question-video-action"><button type="button" data-action="open-videos" data-id="${escapeHtml(id)}" aria-label="查看本题视频">▶ 视频</button></div>`
    : "";
}

export function videoDialogMarkup(catalog, id) {
  const esc = escapeHtml;
  const time = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const rows = questionVideos(catalog, id);
  return `<section class="question-video-list">${
    rows
      .map((v) => {
        const url = videoUrl(v.url);
        return `<article class="question-video-row"><div><strong>${esc(v.title)}</strong>${v.author ? `<small>${esc(v.author)}</small>` : ""}</div><a class="video-jump" href="${esc(url)}" target="_blank" rel="noopener noreferrer">跳转播放</a>${
          v.segments?.length
            ? `<details class="video-segments"><summary>分段导航</summary>${v.segments
                .map((s) => {
                  const u = new URL(url);
                  u.searchParams.set("t", s.seconds);
                  return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${time(s.seconds)} · ${esc(s.title)}</a>`;
                })
                .join("")}</details>`
            : ""
        }</article>`;
      })
      .join("") || "<p>本题暂无视频。</p>"
  }<p class="muted small">在B站新标签页播放，当前题目保留。</p></section>`;
}

export function questionConcepts(catalog, q) {
  const labels = (q.knowledgeIds || [])
    .map((id) => catalog.curriculum?.topics.find((t) => t.id === id))
    .filter(Boolean);
  return labels.length
    ? `<div class="question-concepts"><span>涉及知识点</span>${labels.map((t) => `<button type="button" data-action="knowledge" data-id="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>`).join("")}</div>`
    : "";
}
