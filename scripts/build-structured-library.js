import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "../server/catalog.js";
import { packPaths, writeZip } from "../server/packs.js";

export function structuredLibrary(base) {
  const next = structuredClone(base);
  next.structured = JSON.parse(
    fs.readFileSync(
      new URL("../content/structured.json", import.meta.url),
      "utf8",
    ),
  );
  next.libraryRevision = 4;
  next.requiresProgram = "0.5.8";
  next.updateKind = "library";
  next.edition = "全题库结构化：250组，保留原图对照";
  delete next.officialAnswers;
  return validateCatalog(next);
}
export async function buildStructuredLibrary(file) {
  const baseDir = fileURLToPath(new URL("../public", import.meta.url));
  const catalog = structuredLibrary(
    JSON.parse(fs.readFileSync(path.join(baseDir, "catalog.json"), "utf8")),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeZip(
    file,
    [...packPaths(catalog)].map((name) =>
      name === "catalog.json"
        ? { name, bytes: Buffer.from(JSON.stringify(catalog)) }
        : { name, file: path.join(baseDir, name) },
    ),
  );
  return catalog;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const file = path.resolve(
    process.argv[2] || ".test-artifacts/structured/zju842-library-r4.842pack",
  );
  const c = await buildStructuredLibrary(file);
  console.log(
    JSON.stringify({
      file,
      revision: c.libraryRevision,
      requiresProgram: c.requiresProgram,
      groups: c.structured.groups.length,
      records: c.structured.groups.flatMap((g) => g.questionIds).length,
    }),
  );
}
