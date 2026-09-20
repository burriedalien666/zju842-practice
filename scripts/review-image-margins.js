import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const rows = JSON.parse(
  fs.readFileSync(".test-artifacts/image-margins/bounds.json", "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1500 },
  });
  for (let start = 0; start < rows.length; start += 20) {
    const file = path.resolve(
      `.test-artifacts/image-margins/sheet-${start}.html`,
    );
    const html =
      `<!doctype html><meta charset="utf-8"><style>body{margin:8px;font:12px sans-serif;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}figure{margin:0;border:1px solid #ddd;padding:6px;height:350px;overflow:hidden}.source{position:relative;margin:auto;width:max-content;height:300px}.source img{display:block;max-width:250px;max-height:300px;width:auto;height:auto}.box{position:absolute;border:2px solid red;box-sizing:border-box;pointer-events:none}</style>` +
      rows
        .slice(start, start + 20)
        .map(
          (r) =>
            `<figure><figcaption>${r.src.replace("questions/", "")} · -${Math.round(r.removed * 100)}%</figcaption><div class="source"><img src="${pathToFileURL(path.resolve("public", r.src))}"><span class="box" style="left:${(100 * r.x) / r.originalWidth}%;top:${(100 * r.y) / r.originalHeight}%;width:${(100 * r.width) / r.originalWidth}%;height:${(100 * r.height) / r.originalHeight}%"></span></div></figure>`,
        )
        .join("");
    fs.writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page
      .locator("img")
      .evaluateAll((imgs) => Promise.all(imgs.map((im) => im.decode())));
    await page.locator(".source").evaluateAll((els) =>
      els.forEach((el) => {
        el.style.width =
          el.querySelector("img").getBoundingClientRect().width + "px";
        el.style.height =
          el.querySelector("img").getBoundingClientRect().height + "px";
      }),
    );
    await page.screenshot({
      path: file.replace(".html", ".png"),
      fullPage: true,
    });
  }
} finally {
  await browser.close();
}
console.log(
  `Review sheets created for ${rows.length} cropped views; originals unchanged`,
);
