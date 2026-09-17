const conflict = () =>
  Object.assign(new Error("记录已在其他页面更新，本页未覆盖新记录"), {
    statusCode: 409,
  });
export async function ensureLocalStudySchema(db) {
  await db.transaction(async (tx) => {
    await tx.run(
      "CREATE TABLE IF NOT EXISTS local_state(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0)",
    );
    const columns = await tx.all("PRAGMA table_info(local_state)");
    if (!columns.some((c) => c.name === "revision"))
      await tx.run(
        "ALTER TABLE local_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
      );
  });
}
export async function readLocalStudy(db) {
  const row = await db.get("SELECT value,revision FROM local_state WHERE id=1");
  return {
    study: row ? JSON.parse(row.value) : null,
    revision: String(row?.revision || 0),
  };
}
export async function assertStudyRevision(db, expected) {
  if (
    typeof expected !== "string" ||
    !/^(0|[1-9]\d*)$/.test(expected) ||
    !Number.isSafeInteger(Number(expected))
  )
    throw Object.assign(new Error("缺少有效的记录版本，请刷新页面后重试"), {
      statusCode: 428,
    });
  const previous = await readLocalStudy(db);
  if (previous.revision !== expected) throw conflict();
  return Number(previous.revision);
}
export async function replaceLocalStudy(tx, study, revision) {
  const next = revision + 1;
  if (!Number.isSafeInteger(next)) throw new Error("记录版本超出支持范围");
  await tx.run(
    "INSERT INTO local_state(id,value,revision) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision",
    JSON.stringify(study),
    next,
  );
  return { ok: true, revision: String(next) };
}
export async function writeLocalStudy(db, study, expected) {
  return db.transaction(async (tx) =>
    replaceLocalStudy(tx, study, await assertStudyRevision(tx, expected)),
  );
}
