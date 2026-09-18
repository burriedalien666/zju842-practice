import fs from "node:fs";
import path from "node:path";
import { createContentStage } from "./content-staging.js";
import { extractPack } from "./packs.js";
import { atomicJson } from "./update-files.js";
import { validateLibraryTransition, validateAnswerTransition } from "./content-policy.js";
import { readOfficialAnswers, extractAnswers, activateAnswers, answerFiles } from "./answer-packs.js";

export function currentLibrary(dataDir, baseDir) {
  const pointer = path.join(dataDir, "library.json");
  if (!fs.existsSync(pointer)) return baseDir;
  const { directory } = JSON.parse(fs.readFileSync(pointer, "utf8"));
  if (!/^edition-[a-f0-9]{16}$/.test(directory))
    throw new Error("题库位置不合法");
  return path.join(dataDir, "libraries", directory);
}

export function createContentStore({ dataDir, catalog, baseDir, version }) {
  let library = currentLibrary(dataDir, baseDir);
  const official = () =>
    readOfficialAnswers(dataDir, catalog, library, baseDir);
  async function installLibrary(file, expected) {
    const stage = createContentStage(dataDir, "edition");
    const { name, directory: destination } = stage;
    const stages = [stage];
    try {
      const next = await extractPack(file, destination);
      const { standalone } = validateLibraryTransition(catalog, next, {
        expected, version,
        independentAnswers: fs.existsSync(path.join(dataDir, "official-answers.json")),
      });
      if (standalone) {
        if (!fs.existsSync(path.join(dataDir, "official-answers.json"))) {
          const old = official();
          const answerStage = createContentStage(dataDir, "answers");
          stages.push(answerStage);
          const dir = answerStage.directory;
          atomicJson(path.join(dir, "answers.json"), old.value);
          for (const file of answerFiles(old.value))
            if (file !== "answers.json") {
              fs.mkdirSync(path.dirname(path.join(dir, file)), {
                recursive: true,
              });
              fs.copyFileSync(
                path.join(old.directory, file),
                path.join(dir, file),
              );
            }
          activateAnswers(dataDir, dir);
          answerStage.commit();
        }
      }
      atomicJson(path.join(dataDir, "library.json"), { directory: name });
      stage.commit();
      library = destination;
      Object.keys(catalog).forEach((k) => delete catalog[k]);
      Object.assign(catalog, next);
      return {
        ok: true,
        questions: catalog.questions.length,
        edition: catalog.edition,
      };
    } catch (e) {
      for (const owned of stages.reverse()) owned.cleanup(e);
      throw e;
    }
  }
  async function installAnswers(file, expected) {
    const stage = createContentStage(dataDir, "answers");
    const dir = stage.directory;
    try {
      const next = await extractAnswers(file, dir);
      validateAnswerTransition(catalog, official().value, next, {
        expected, version,
      });
      activateAnswers(dataDir, dir);
      stage.commit();
      return { ok: true, edition: next.edition };
    } catch (e) {
      stage.cleanup(e);
      throw e;
    }
  }
  return { get library() { return library; }, official, installLibrary, installAnswers };
}
