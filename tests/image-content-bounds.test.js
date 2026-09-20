import test from "node:test";
import assert from "node:assert/strict";
import { imageContentBounds } from "../src/image-content-bounds.js";

function image(width = 300, height = 600) {
  const pixels = new Uint8Array(width * height).fill(255);
  return {
    pixels,
    width,
    height,
    rect(x, y, w, h, gray = 30) {
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) pixels[j * width + i] = gray;
    },
  };
}
test("large bottom whitespace and isolated scanner dust are excluded with breathing room", () => {
  const im = image();
  im.rect(50, 20, 180, 120);
  im.rect(90, 250, 1, 1);
  const before = im.pixels.slice(),
    crop = imageContentBounds(im.pixels, im.width, im.height, 1);
  assert.ok(crop.height >= 154 && crop.height < 200);
  assert.deepEqual(im.pixels, before, "original pixels remain unchanged");
});
test("thin circuit wires and small punctuation near the question remain inside the viewport", () => {
  const im = image();
  im.rect(50, 30, 130, 100);
  im.rect(180, 125, 70, 1, 180);
  im.rect(245, 134, 2, 2);
  const crop = imageContentBounds(im.pixels, im.width, im.height, 1);
  assert.ok(crop.x + crop.width > 249);
  assert.ok(crop.y + crop.height > 135);
});
test("blank images and modest normal margins do not create an artificial crop", () => {
  const im = image(100, 100);
  assert.equal(imageContentBounds(im.pixels, 100, 100, 1), null);
  im.rect(12, 12, 77, 77);
  assert.equal(imageContentBounds(im.pixels, 100, 100, 1), null);
});
test("validates pixel dimensions and ignores transparent pixels", () => {
  assert.throws(() => imageContentBounds(new Uint8Array(2), 100, 100, 4));
  assert.equal(imageContentBounds(new Uint8Array(400), 10, 10, 4), null);
});
