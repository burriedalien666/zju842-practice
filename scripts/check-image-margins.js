import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { imageContentBounds } from "../src/image-content-bounds.js";

const catalog = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
const images = [
  ...new Map(
    catalog.questions.flatMap((q) => q.images).map((im) => [im.src, im]),
  ).values(),
];
const results = [];
for (const im of images) {
  const { data, info } = await sharp(path.join("public", im.src))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const crop = imageContentBounds(data, info.width, info.height, info.channels);
  if (crop)
    results.push({
      src: im.src,
      ...crop,
      removed: 1 - (crop.width * crop.height) / (info.width * info.height),
    });
}
results.sort((a, b) => b.removed - a.removed);
fs.mkdirSync(".test-artifacts/image-margins", { recursive: true });
fs.writeFileSync(
  ".test-artifacts/image-margins/bounds.json",
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify(
    {
      checked: images.length,
      trimmed: results.length,
      large: results.filter((r) => r.removed > 0.2).length,
      results: results.slice(0, 16),
    },
    null,
    2,
  ),
);
