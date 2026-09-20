const paths = {
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" rx=".6"/><rect x="14" y="4" width="4" height="16" rx=".6"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  reset: '<path d="M20 4v6h-6"/><path d="M20 10a8 8 0 1 0 .1 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M20.8 13.2A9 9 0 0 1 10.8 3.2 9 9 0 1 0 20.8 13.2Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  alert: '<path d="M12 5v9m0 4h.01"/>',
  unsure: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  cross: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="M20 12H4m7-7-7 7 7 7"/>',
};
export function uiIcon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ""}</svg>`;
}
