// Bounds for a display viewport only. Original question pixels are never rewritten.
export function imageContentBounds(pixels, width, height, channels = 4) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    ![1, 3, 4].includes(channels) ||
    pixels.length !== width * height * channels
  )
    throw new Error("Invalid image pixels");
  const size = width * height,
    ink = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const p = i * channels;
    const gray =
      channels === 1
        ? pixels[p]
        : (pixels[p] * 299 + pixels[p + 1] * 587 + pixels[p + 2] * 114) / 1000;
    ink[i] = gray < 235 && (channels !== 4 || pixels[p + 3] > 16) ? 1 : 0;
  }
  const queue = new Uint32Array(size);
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let first = 0; first < size; first++) {
    if (!ink[first]) continue;
    let head = 0,
      tail = 1,
      x0 = width,
      x1 = 0,
      y0 = height,
      y1 = 0;
    queue[0] = first;
    ink[first] = 0;
    while (head < tail) {
      const index = queue[head++],
        y = Math.floor(index / width),
        x = index - y * width;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        if (y + dy < 0 || y + dy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width) continue;
          const neighbor = index + dy * width + dx;
          if (ink[neighbor]) {
            ink[neighbor] = 0;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    // Ignore isolated scan dust, but retain thin wires and small character strokes.
    if (tail < 14 && x1 - x0 < 9 && y1 - y0 < 9) continue;
    left = Math.min(left, x0);
    right = Math.max(right, x1);
    top = Math.min(top, y0);
    bottom = Math.max(bottom, y1);
  }
  if (right < left) return null;
  const padding = Math.max(14, Math.round(Math.min(width, height) * 0.025));
  left = Math.max(0, left - padding);
  right = Math.min(width, right + padding + 1);
  top = Math.max(0, top - padding);
  bottom = Math.min(height, bottom + padding + 1);
  // Leave ordinary margins alone. Only collapse conspicuously empty edge strips.
  if (left < Math.max(40, width * 0.05)) left = 0;
  if (width - right < Math.max(40, width * 0.05)) right = width;
  if (top < Math.max(40, height * 0.05)) top = 0;
  if (height - bottom < Math.max(40, height * 0.05)) bottom = height;
  if (!left && !top && right === width && bottom === height) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    originalWidth: width,
    originalHeight: height,
  };
}
