import fs from "node:fs";

// Model the pre-structured r2 schema for backward-compatibility tests, using today's original IDs/images.
export function legacyCatalog() {
  const catalog = JSON.parse(
    fs.readFileSync(
      new URL("../../public/catalog.json", import.meta.url),
      "utf8",
    ),
  );
  delete catalog.structured;
  delete catalog.updateKind;
  catalog.libraryRevision = 2;
  catalog.requiresProgram = "0.5.0";
  catalog.edition = "Legacy r2 test fixture";
  return catalog;
}
