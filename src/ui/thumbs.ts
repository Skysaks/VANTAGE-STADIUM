import type { TierConfig, VenueConfig } from '../config/types';
import { FOOTBALL } from '../config/events';
import { superellipse, trackLoop } from '../venue/curve';

/** Profondeur totale des gradins (m) d'après la configuration (sans générer les sièges). */
function depthOf(tiers: TierConfig[]) {
  let d = 0;
  tiers.forEach((t, i) => { if (i > 0) d -= t.overhang ?? 2; d += t.rows * t.rowDepth; });
  return d;
}

/** Vignette vue de dessus d'un lieu (SVG), calculée depuis la seule configuration : sert au sélecteur de stade. */
export function venueThumb(cfg: VenueConfig, w = 168, h = 112, accent = 'currentColor') {
  const P = FOOTBALL.surface;
  const parts: string[] = [];
  let ext = 1;
  const shapes: Array<{ d: string; fill: string; roof: boolean }> = [];
  if (cfg.layout === 'bowl') {
    const b = cfg.bowl!;
    const loop = b.shape === 'track' ? trackLoop(b.trackStraight!, b.trackRadius!, 3) : superellipse(P.length / 2 + b.setbackEnd, P.width / 2 + b.setbackSide, Math.max(b.exponent ?? 3.2, 3.6), 180);
    const dep = depthOf(b.tiers);
    const c = loop.curve;
    const inner: string[] = [], outer: string[] = [];
    const n = 90;
    for (let k = 0; k <= n; k++) {
      const s = c.at((c.length * k) / n);
      inner.push(`${s.x.toFixed(1)},${s.z.toFixed(1)}`);
      outer.push(`${(s.x + s.nx * dep).toFixed(1)},${(s.z + s.nz * dep).toFixed(1)}`);
      ext = Math.max(ext, Math.abs(s.x + s.nx * dep) / (w / 2 - 4), Math.abs(s.z + s.nz * dep) / (h / 2 - 4));
    }
    shapes.push({ d: `M${outer.join('L')}Z M${inner.reverse().join('L')}Z`, fill: cfg.bowl!.stands[0].colors[0], roof: !!b.roof });
  } else {
    for (const st of cfg.stands!) {
      const along = st.side === 'N' || st.side === 'S';
      const dist = (along ? P.width : P.length) / 2 + st.setback;
      const len = st.length ?? (along ? P.length + 10 : P.width + 8);
      const dep = depthOf(st.tiers!);
      const sg = st.side === 'S' || st.side === 'E' ? 1 : -1;
      const [x0, x1, z0, z1] = along ? [-len / 2, len / 2, sg * dist, sg * (dist + dep)] : [sg * dist, sg * (dist + dep), -len / 2, len / 2];
      ext = Math.max(ext, Math.max(Math.abs(x0), Math.abs(x1)) / (w / 2 - 4), Math.max(Math.abs(z0), Math.abs(z1)) / (h / 2 - 4));
      shapes.push({ d: `M${x0},${z0}L${x1},${z0}L${x1},${z1}L${x0},${z1}Z`, fill: st.colors[0], roof: !!st.roof });
    }
  }
  const k = 1 / ext;
  parts.push(`<rect x="${(-P.length / 2) * k}" y="${(-P.width / 2) * k}" width="${P.length * k}" height="${P.width * k}" rx="1.5" fill="#2a6b35"/>`);
  parts.push(`<line x1="0" y1="${(-P.width / 2) * k}" x2="0" y2="${(P.width / 2) * k}" stroke="rgba(255,255,255,.4)" stroke-width=".6"/>`);
  if (cfg.track) parts.push(`<rect x="${(-42.2 - 46) * k}" y="${-46 * k}" width="${(84.4 + 92) * k}" height="${92 * k}" rx="${46 * k}" fill="none" stroke="#a8432c" stroke-width="${7 * k}" opacity=".9"/>`);
  for (const s of shapes) parts.push(`<path d="${s.d}" transform="scale(${k})" fill="${s.fill}" fill-rule="evenodd" opacity="${s.roof ? 0.95 : 0.7}" stroke="rgba(255,255,255,.25)" stroke-width="${0.8 / k}"/>`);
  return `<svg viewBox="${-w / 2} ${-h / 2} ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="color:${accent}">${parts.join('')}</svg>`;
}
