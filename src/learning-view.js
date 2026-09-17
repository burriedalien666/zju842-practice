import { isDue } from "./review.js";
export function learningSummary(questions, records, now = Date.now()) {
  return {
    total: questions.length,
    done: questions.filter((q) => records[q.id]?.state === "done").length,
    due: questions.filter((q) => isDue(records[q.id], now)).length,
    wrong: questions.filter((q) => records[q.id]?.review?.wrong).length,
  };
}
export function resumeQuestion(catalog, id, subject) {
  return (
    catalog.questions.find((q) => q.id === id && q.subject === subject) || null
  );
}
