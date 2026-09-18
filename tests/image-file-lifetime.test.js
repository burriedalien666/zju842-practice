import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import sharp from "sharp";

// A contract guard forwards the ORIGINAL bytes/options to the real sharp module.
// It never converts a path into a Buffer or changes decode/cache behaviour.
// Therefore a filename regression fails even on Linux, where unlink is permissive.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "sharp" && /\/(?:answer-packs|packs)\.js$/.test(context.parentURL || "")) {
      const result = nextResolve(specifier, context);
      return { url: "r1-sharp-buffer:" + encodeURIComponent(result.url), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("r1-sharp-buffer:")) return {
      format: "module", shortCircuit: true,
      source: `import realSharp from ${JSON.stringify(decodeURIComponent(url.slice("r1-sharp-buffer:".length)))};
        let metadataInput;
        export default function(input, options) {
          if (!Buffer.isBuffer(input)) throw Object.assign(new Error("R01: sharp must receive existing image bytes, not a filename"), {code:"R01_FILENAME_INPUT"});
          if (options?.limitInputPixels !== 60000000) throw new Error("R01: pixel bound was removed");
          if (options?.failOn === "warning") {
            if (input !== metadataInput) throw new Error("R01: strict decode must reuse the metadata Buffer");
          } else metadataInput = input;
          return realSharp(input, options);
        }`,
    };
    return nextLoad(url, context);
  },
});
const { writeZip, extractPack } = await import("../server/packs.js");
const { extractAnswers } = await import("../server/answer-packs.js");
test.after(() => hooks.deregister());

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "842-image-r1-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "out"); fs.mkdirSync(out);
  return { root, out, zip: path.join(root, "pack.zip") };
}
const image = format => sharp({ create: { width: 17, height: 13, channels: 3, background: "white" } }).toFormat(format).toBuffer();
const answer = { format: 1, kind: "answers", libraryId: "zju842", revision: 1, edition: "synthetic",
  requiresLibraryRevision: 0, answers: { q: ["answers/a.webp"] } };
const catalog = name => ({ version: 1, types: [{id:"t",title:"type",subject:"signals",group:"g",groupTitle:"group"}],
  questions: [{id:"q",typeId:"t",subject:"signals",sourceKind:"entrance",year:2025,number:"1",title:"synthetic",sourceTitle:"synthetic",tags:[],images:[{src:name,width:17,height:13}]}] });
async function pack(f, kind, name, bytes) {
  await writeZip(f.zip, [{ name: kind === "answers" ? "answers.json" : "catalog.json", bytes: Buffer.from(JSON.stringify(kind === "answers" ? answer : catalog(name))) }, { name, bytes }]);
}

test("R01 answer metadata and strict decode use Buffers; decoded WebP can immediately be renamed and deleted", async t => {
  const f = fixture(t); await pack(f, "answers", "answers/a.webp", await image("webp"));
  await extractAnswers(f.zip, f.out);
  const file = path.join(f.out, "answers/a.webp"); fs.renameSync(file, file + ".moved"); fs.unlinkSync(file + ".moved");
  fs.rmSync(f.out, { recursive: true }); assert.equal(fs.existsSync(f.out), false);
});
for (const format of ["webp", "png", "jpeg"]) test(`R01 library ${format} decode releases files for immediate deletion`, async t => {
  const f = fixture(t), name = "questions/q." + format; await pack(f, "library", name, await image(format));
  await extractPack(f.zip, f.out);
  const file = path.join(f.out, name); fs.renameSync(file, file + ".moved"); fs.unlinkSync(file + ".moved");
  fs.rmSync(f.out, { recursive: true }); assert.equal(fs.existsSync(f.out), false);
});
test("R01 same Buffer path retains format spoof rejection", async t => {
  const f = fixture(t); await pack(f, "answers", "answers/a.webp", await image("png"));
  await assert.rejects(extractAnswers(f.zip, f.out)); fs.rmSync(f.out, { recursive: true });
});
test("R01 payload with readable metadata but truncated pixels still fails strict decode", async t => {
  const f = fixture(t), valid = await sharp({ create: { width: 17, height: 13, channels: 3, background: "white" } })
    .png({ compressionLevel: 0 }).toBuffer();
  // PNG retains IHDR metadata but has an incomplete compressed pixel payload.
  const damaged = valid.subarray(0, Math.floor(valid.length / 2));
  const metadata = await sharp(damaged, { limitInputPixels: 60000000 }).metadata();
  assert.equal(metadata.format, "png");
  await pack(f, "library", "questions/q.png", damaged);
  await assert.rejects(extractPack(f.zip, f.out)); fs.rmSync(f.out, { recursive: true });
});
test("R01 excessive pixel dimensions remain rejected without allocating huge decoded output", async t => {
  const f = fixture(t);
  // Use a compact SVG only as a negative format fixture; it must never be accepted as WebP.
  const oversized = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="1" height="1"/></svg>');
  await pack(f, "answers", "answers/a.webp", oversized);
  await assert.rejects(extractAnswers(f.zip, f.out), /pixel limit/);
  fs.rmSync(f.out, { recursive: true });
});
