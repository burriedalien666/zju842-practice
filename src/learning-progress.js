export function questionRating(record) {
  return record?.review?.rating || (record?.state === "done" ? "good" : "");
}

export function ratingCounts(questions, marks) {
  const counts = {
    total: questions.length,
    good: 0,
    hard: 0,
    wrong: 0,
    done: 0,
    unmarked: 0,
  };
  for (const q of questions) {
    const rating = marks[q.id];
    counts[
      ["good", "hard", "wrong", "done"].includes(rating) ? rating : "unmarked"
    ]++;
  }
  return counts;
}

export function completionProgress(questions, marks) {
  const counts = ratingCounts(questions, marks);
  const completed = counts.total - counts.unmarked;
  // Rounded percentages must not say 100% while any question remains unfinished.
  const percent =
    counts.total === 0
      ? 0
      : completed === counts.total
        ? 100
        : Math.min(99, Math.round((100 * completed) / counts.total));
  return { ...counts, completed, percent };
}

export function recordProgress(questions, records) {
  return completionProgress(
    questions,
    Object.fromEntries(
      questions.map((q) => [q.id, questionRating(records[q.id])]),
    ),
  );
}
