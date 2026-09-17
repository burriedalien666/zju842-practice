import fs from "node:fs";
import path from "node:path";
import packageInfo from "../package.json" with { type: "json" };
import { writeZip, packPaths } from "../server/packs.js";
import { answerFiles } from "../server/answer-packs.js";
import { validateManifest } from "../server/update-source.js";

const assets = path.resolve(process.argv[2] || "release-assets");
fs.mkdirSync(assets, { recursive: true });
const catalog = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
const answers = JSON.parse(fs.readFileSync("public/answers.json", "utf8"));
if (
  !Number.isSafeInteger(catalog.libraryRevision) ||
  catalog.libraryRevision < 1 ||
  catalog.libraryId !== "zju842"
)
  throw new Error("请先填写题库版本号");
if (
  answers.requiresLibraryRevision > catalog.libraryRevision ||
  Object.keys(answers.answers).some(
    (id) => !catalog.questions.some((q) => q.id === id),
  )
)
  throw new Error("公共答案与题库不匹配");
const library = structuredClone(catalog);
delete library.officialAnswers;
library.updateKind = "library";
const libraryName = `zju842-library-r${catalog.libraryRevision}.842pack`;
await writeZip(path.join(assets, libraryName), [
  { name: "catalog.json", bytes: Buffer.from(JSON.stringify(library)) },
  ...[...packPaths(library)]
    .filter((n) => n !== "catalog.json")
    .map((name) => ({ name, file: path.resolve("public", name) })),
]);
const answersName = `zju842-answers-r${answers.revision}.842answers`;
await writeZip(
  path.join(assets, answersName),
  [...answerFiles(answers)].map((name) => ({
    name,
    file: path.resolve("public", name),
  })),
);
const release = "v" + packageInfo.version;
const asset = (name) => ({
  release,
  name,
  size: fs.statSync(path.join(assets, name)).size,
});
const manifest = validateManifest({
  format: 1,
  libraryId: "zju842",
  program: {
    version: packageInfo.version,
    notes: fs
      .readFileSync(`docs/releases/v${packageInfo.version}.md`, "utf8")
      .slice(0, 12000),
    protocol: 1,
    assets: Object.fromEntries(
      ["windows-x64", "macos-x64", "macos-arm64"].map((p) => [
        p,
        asset(`zju842-${packageInfo.version}-${p}.zip`),
      ]),
    ),
  },
  library: {
    revision: catalog.libraryRevision,
    edition: catalog.edition,
    requiresProgram: catalog.requiresProgram || "0.4.0",
    asset: asset(libraryName),
  },
  answers: {
    revision: answers.revision,
    edition: answers.edition,
    requiresLibraryRevision: answers.requiresLibraryRevision,
    requiresProgram: "0.4.0",
    asset: asset(answersName),
  },
});
fs.writeFileSync(
  path.join(assets, "zju842-updates.json"),
  JSON.stringify(manifest, null, 2),
  { flag: "wx" },
);
console.log("Prepared independent program, library and public-answer updates");
