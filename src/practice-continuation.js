import { filterQuestions } from "./chapters.js";

export function continuationTopics(catalog, chapters, filters, study) {
  const knowledge = filters.type?.startsWith("knowledge:");
  const currentIds = new Set(
    filterQuestions(catalog, filters, study, chapters).map((q) => q.id),
  );
  const choices = [];
  for (const chapter of chapters.filter((c) => c.subject === filters.subject)) {
    const topics = knowledge
      ? (chapter.knowledge || []).map((t) => ({
          ...t,
          id: "knowledge:" + t.id,
        }))
      : chapter.types;
    for (const topic of topics) {
      const nextFilters = { ...filters, chapter: chapter.id, type: topic.id };
      delete nextFilters.questionIds;
      const questions = filterQuestions(catalog, nextFilters, study, chapters);
      if (questions.length)
        choices.push({
          chapter: chapter.id,
          chapterTitle: chapter.title,
          id: topic.id,
          title: topic.title,
          count: questions.length,
          questionIds: questions.map((q) => q.id),
        });
    }
  }
  const index = choices.findIndex(
    (c) => c.chapter === filters.chapter && c.id === filters.type,
  );
  if (index >= 0)
    return [...choices.slice(index + 1), ...choices.slice(0, index)];
  return [
    ...choices.filter((c) => c.chapter === filters.chapter),
    ...choices.filter((c) => c.chapter !== filters.chapter),
  ].filter(
    (c) =>
      c.questionIds.length !== currentIds.size ||
      c.questionIds.some((id) => !currentIds.has(id)),
  );
}
