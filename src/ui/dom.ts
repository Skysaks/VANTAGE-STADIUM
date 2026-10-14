// Petits utilitaires DOM sans framework : création d'éléments, icônes vectorielles maison, annonces ARIA.

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const P: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  compare: '<rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  cloud: '<path d="M7 18h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.5 4.3 4.3 0 0 0 7 18z"/>',
  rain: '<path d="M7 14.5h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 6 4.3 4.3 0 0 0 7 14.5z"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  fog: '<path d="M4 9h16M3 13h14M6 17h15"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  soundOn: '<path d="M4 10h3l5-4v12l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 10h3l5-4v12l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  a11y: '<circle cx="12" cy="4.5" r="1.6"/><path d="M5 8.5l7 1.5 7-1.5M12 10v5M12 15l-3.5 6M12 15l3.5 6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v8h14v-8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/>',
  lab: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  left: '<path d="M14 6l-6 6 6 6"/>', right: '<path d="M10 6l6 6-6 6"/>', up: '<path d="M6 14l6-6 6 6"/>', downArrow: '<path d="M6 10l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 0 4 0"/>',
  stadium: '<ellipse cx="12" cy="12" rx="9.5" ry="6.5"/><rect x="7.5" y="9.5" width="9" height="5" rx="1"/>',
  goal: '<path d="M3 18V7h18v11"/><path d="M3 11h18M3 14.5h18M8 7v11M13 7v11M18 7v11" opacity=".5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  pin: '<path d="M12 21s6.5-6.1 6.5-11A6.5 6.5 0 0 0 5.5 10c0 4.9 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  child: '<circle cx="12" cy="9" r="2.8"/><path d="M7.5 19.5a4.5 4.5 0 0 1 9 0"/>',
  stand: '<circle cx="12" cy="5" r="2"/><path d="M12 7.5v7M12 14.5l-3 6.5M12 14.5l3 6.5M8 10.5h8"/>',
  wave: '<path d="M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3"/><path d="M5 9l1-3M12 9l1-3M19 9l1-3"/>',
  record: '<circle cx="12" cy="12" r="6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  bookmark: '<path d="M7 3.5h10v17l-5-3.6-5 3.6z"/>',
  recenter: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5.5 5.5 0 0 1 0 11h-2"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  binoculars: '<circle cx="7" cy="15" r="3.6"/><circle cx="17" cy="15" r="3.6"/><path d="M10.6 15h2.8M5 11.5l1.5-6h3l.5 6M19 11.5l-1.5-6h-3l-.5 6"/>',
  follow: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9M3 12a9 9 0 0 1 9-9M12 21a9 9 0 0 1-9-9M21 12a9 9 0 0 1-9 9" opacity=".6"/>',
  scale: '<path d="M4 20L20 4M7 17l2 2M10 14l2 2M13 11l2 2M16 8l2 2"/>',
  immersive: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8" opacity=".5"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5M11 8v6M8 11h6"/>',
  lite: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.5M9.5 10h.5M13 10h.5M16.5 10h.5M7 14h10"/>',
};

export function icon(name: string, size = 20) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] ?? ''}</svg>`;
}

/** Bouton icône + libellé (libellé toujours présent pour l'accessibilité, éventuellement visuellement masqué). */
export function btn(o: { icon?: string; label: string; act?: string; cls?: string; hideLabel?: boolean; pressed?: boolean; disabled?: boolean; title?: string; data?: Record<string, string> }) {
  const b = h('button', {
    class: `btn ${o.cls ?? ''}`.trim(), type: 'button', 'data-act': o.act, 'aria-label': o.hideLabel ? o.label : null,
    'aria-pressed': o.pressed === undefined ? null : String(o.pressed), disabled: o.disabled, title: o.title ?? (o.hideLabel ? o.label : null),
  });
  if (o.data) for (const [k, v] of Object.entries(o.data)) b.dataset[k] = v;
  b.innerHTML = `${o.icon ? icon(o.icon) : ''}${o.hideLabel ? '' : `<span class="lbl">${o.label}</span>`}`;
  return b;
}

let liveEl: HTMLElement | null = null;
let liveTimer = 0;
/** Annonce polie au lecteur d'écran (région aria-live unique). */
export function announce(text: string) {
  liveEl ??= document.getElementById('live');
  if (!liveEl) return;
  clearTimeout(liveTimer);
  liveEl.textContent = '';
  liveTimer = window.setTimeout(() => { liveEl!.textContent = text; }, 60);
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
