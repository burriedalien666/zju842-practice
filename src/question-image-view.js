import { imageContentBounds } from "./image-content-bounds.js";
const cache = new Map();

function frameStyles(frame, image, crop, fit) {
  const { x, y, width, height, originalWidth, originalHeight } = crop;
  frame.className = "image-crop-frame" + (fit ? " crop-fit" : "");
  frame.style.aspectRatio = `${width} / ${height}`;
  frame.style.width = fit
    ? `min(100%, calc((90dvh - 160px) * ${width / height}))`
    : `${(100 * width) / originalWidth}%`;
  frame.style.maxWidth = `${width}px`;
  image.style.width = `${(100 * originalWidth) / width}%`;
  image.style.height = `${(100 * originalHeight) / height}%`;
  image.style.left = `${(-100 * x) / width}%`;
  image.style.top = `${(-100 * y) / height}%`;
}
export function cropImageView(image, crop, fit = false) {
  if (!crop || image.parentElement?.classList.contains("image-crop-frame"))
    return;
  const frame = document.createElement("span");
  image.before(frame);
  frame.append(image);
  frameStyles(frame, image, crop, fit);
  image.dataset.contentCrop = JSON.stringify(crop);
}
function inspectImage(image) {
  if (!image.isConnected || !image.naturalWidth || image.dataset.boundsChecked)
    return;
  image.dataset.boundsChecked = "true";
  const key =
    image.currentSrc + ":" + image.naturalWidth + ":" + image.naturalHeight;
  let crop;
  if (cache.has(key)) crop = cache.get(key);
  else {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      crop = imageContentBounds(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      );
      cache.set(key, crop);
    } catch {
      // A future cross-origin image may deny pixel reads; display the original.
      return;
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  cropImageView(image, crop);
}
export function prepareQuestionImages(root = document) {
  root.querySelectorAll(".question-images img").forEach((image) => {
    if (image.complete) inspectImage(image);
    else
      image.addEventListener("load", () => inspectImage(image), { once: true });
  });
}
