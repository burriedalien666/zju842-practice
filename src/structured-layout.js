import { mathMarkup } from "./structured-question.js";

const observed = new Set();
function fit(e) {
  if (!e.isConnected || !e.clientWidth) return;
  e.innerHTML = mathMarkup(e.dataset.fullTex, true);
  e.dataset.layout = "single";
  const d = e.querySelector(".katex-display"),
    html = e.querySelector(".katex-html"),
    style = getComputedStyle(d);
  if (
    html.getBoundingClientRect().width >
    e.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) +
      1
  ) {
    e.innerHTML = mathMarkup(e.dataset.narrowTex, true);
    e.dataset.layout = "wrapped";
  }
}
const observer = new ResizeObserver((entries) =>
  entries.forEach(({ target }) => fit(target)),
);
export function prepareStructured(root) {
  for (const e of observed)
    if (!e.isConnected) {
      observer.unobserve(e);
      observed.delete(e);
    }
  root.querySelectorAll(".formula-block[data-full-tex]").forEach((e) => {
    fit(e);
    if (!observed.has(e)) {
      observed.add(e);
      observer.observe(e);
    }
  });
}
document.fonts.ready.then(() => observed.forEach(fit));
document.fonts.addEventListener("loadingdone", () => observed.forEach(fit));
