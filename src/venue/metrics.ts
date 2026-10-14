import type { EventConfig, Provenance } from '../config/types';
import { CAMERA } from '../config/product';
import type { VenueModel } from './model';

const DEG = Math.PI / 180;
const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/** Métriques géométriques d'un siège : calculées une fois par lieu, sans événement. */
export interface StaticMetrics {
  ex: Float32Array; ey: Float32Array; ez: Float32Array;
  dist: Float32Array;      // œil → rond central (m)
  edge: Float32Array;      // œil → ligne la plus proche (m, horizontal)
  elev: Float32Array;      // angle de plongée vers le rond central (deg)
  central: Float32Array;   // 0..100
  cval: Float32Array;      // dégagement (mm) ; rang 0 : marge au-dessus du garde-corps
  obstruct: Float32Array;  // 0..100 (100 = aucune structure dans le champ)
  /** Source principale de gêne : 0 aucune, 1 avancée du niveau supérieur, 2 bord du toit, 3 poteau, 4 garde-corps. */
  obsSrc: Uint8Array;
  rain: Float32Array;      // 0..100
  covered: Uint8Array;
  view: Float32Array;      // 0..100
  atmoBase: Float32Array;  // 0..100 avant intensité de l'événement
  exit: Float32Array;
  family: Float32Array;
  parts: { prox: Float32Array; height: Float32Array; clear: Float32Array };
}

export interface EventMetrics {
  price: Float32Array;
  avail: Uint8Array;
  value: Float32Array;
  atmo: Float32Array;
  sun: Float32Array;
  lit: Uint8Array;
  glare: Float32Array;
  minPrice: number; maxPrice: number;
  sold: number;
}

export const PROVENANCE: Record<string, Provenance> = {
  view: 'calculated', dist: 'calculated', elev: 'calculated', cval: 'calculated', obstruct: 'calculated',
  rain: 'calculated', sun: 'calculated', price: 'simulated', avail: 'simulated', value: 'calculated',
  atmo: 'estimated', exit: 'estimated', family: 'estimated',
};

/** Paramètres de profil (coordonnées locales de la tribune : d = profondeur, h = hauteur). */
function tierGeo(v: VenueModel, i: number) {
  const st = v.stands[v.stand[i]];
  const t = st.tiers[v.tier[i]];
  const next = st.tiers[v.tier[i] + 1];
  return { st, t, next };
}

export function computeStatic(v: VenueModel): StaticMetrics {
  const N = v.count;
  const F = () => new Float32Array(N);
  const m: StaticMetrics = {
    ex: F(), ey: F(), ez: F(), dist: F(), edge: F(), elev: F(), central: F(), cval: F(), obstruct: F(), obsSrc: new Uint8Array(N),
    rain: F(), covered: new Uint8Array(N), view: F(), atmoBase: F(), exit: F(), family: F(),
    parts: { prox: F(), height: F(), clear: F() },
  };
  const L2 = v.pitch.length / 2, W2 = v.pitch.width / 2;
  const eyeH = CAMERA.eye.adultSeated;
  for (let i = 0; i < N; i++) {
    const { st, t, next } = tierGeo(v, i);
    const sec = v.sections[v.section[i]];
    const ex = v.px[i] + v.nx[i] * 0.1, ez = v.pz[i] + v.nz[i] * 0.1, ey = v.py[i] + eyeH;
    m.ex[i] = ex; m.ey[i] = ey; m.ez[i] = ez;
    const hc = Math.hypot(ex, ez);
    const dist = Math.hypot(hc, ey);
    const edge = Math.hypot(Math.max(Math.abs(ex) - L2, 0), Math.max(Math.abs(ez) - W2, 0)) || 0.5;
    const elev = Math.atan2(ey, hc) / DEG;
    const ang = Math.atan2(Math.abs(ex), Math.abs(ez)) / DEG;
    const central = clamp(100 - (ang / 90) * 62);
    m.dist[i] = dist; m.edge[i] = edge; m.elev[i] = elev; m.central[i] = central;

    const depth = v.depth[i] + 0.1;
    // Dégagement (valeur C) : tête du rang devant, ou garde-corps au premier rang.
    let cval: number;
    if (v.row[i] === 0) {
      const parapetTop = t.h0 + (t.idx === 0 ? 0.25 : 0.9);
      const dPar = depth - (t.d0 + 0.15);
      const lineAtPar = ey - ey * (dPar / (edge + dPar));
      cval = (lineAtPar - parapetTop) * 1000;
    } else {
      const D = edge, R = ey, Nr = t.rowH[v.row[i]] - t.rowH[v.row[i] - 1], T = t.rowDepth;
      cval = (D * (Nr + R) / (D + T) - R) * 1000;
    }
    m.cval[i] = cval;
    const clear = cval >= 90 ? 100 : cval >= 60 ? 75 + ((cval - 60) / 30) * 25 : cval >= 0 ? 35 + (cval / 60) * 40 : 18;

    // Obstruction par l'avancée du niveau supérieur ou par le toit (ballon à 20 m au-dessus du rond central).
    const target = Math.atan2(20 - ey, hc) / DEG;
    let obstruct = 100, src = 0;
    const edges: Array<[number, number, number]> = [];
    if (next) edges.push([next.d0, next.h0 - 1.2, 1]);
    if (!next && st.roof) edges.push([st.roof.cover, st.roof.frontH - 0.5, 2]);
    for (const [dE, hE, k] of edges) {
      if (depth <= dE + 0.3) continue;
      const up = Math.atan2(hE - ey, depth - dE) / DEG;
      const deficit = target - up;
      if (deficit > -2) { const o = clamp(100 - (deficit + 2) * 7, 25, 100); if (o < obstruct) { obstruct = o; if (o < 95) src = k; } }
    }
    // Poteaux : largeur angulaire pondérée par leur position dans le champ central.
    let colPenalty = 0;
    for (const c of st.columns) {
      const dx = c.x - ex, dz = c.z - ez;
      const r = Math.hypot(dx, dz);
      const fwd = (-dx * v.nx[i] - dz * v.nz[i]) / (r || 1);
      if (fwd <= 0.2 || r > 60 || c.y1 < ey) continue;
      const theta = Math.acos(Math.min(1, fwd)) / DEG;
      if (theta > 40) continue;
      const w = (2 * Math.atan(c.r / r)) / DEG;
      colPenalty += w * (1 - theta / 40) * 9;
    }
    if (colPenalty > 0) { const o = clamp(100 - colPenalty, 20, 100); if (o < obstruct) { obstruct = o; if (o < 95) src = 3; } }
    if (!src && v.row[i] === 0 && cval < 0) src = 4;
    m.obstruct[i] = obstruct; m.obsSrc[i] = src;

    let covered = 0, rain = 20;
    if (next && depth >= next.d0 + 1) { covered = 1; rain = 96; }
    else if (!next && st.roof) {
      if (depth >= st.roof.cover + 1.5) { covered = 1; rain = 94; }
      else if (depth >= st.roof.cover - 2.5) rain = 62;
    }
    m.covered[i] = covered; m.rain[i] = rain;

    const prox = clamp(100 - (dist - 38) * 1.25, 8, 100);
    const height = clamp(100 - Math.max(0, 16 - elev) * 4.5 - Math.max(0, elev - 31) * 3, 10, 100);
    m.parts.prox[i] = prox; m.parts.height[i] = height; m.parts.clear[i] = clear;
    m.view[i] = 0.27 * prox + 0.18 * height + 0.25 * central + 0.18 * clear + 0.12 * obstruct;

    let atmo = st.kind === 'home' ? 86 : st.kind === 'away' ? 80 : st.kind === 'opposite' ? 68 : st.kind === 'family' ? 50 : 56;
    if (sec.ultras) atmo = 97;
    if (sec.away) atmo = 90;
    if (sec.family) atmo = 50;
    if (sec.hospitality) atmo = 44;
    atmo -= v.tier[i] * 10;
    atmo += (1 - v.row[i] / Math.max(1, t.rows)) * 5;
    m.atmoBase[i] = clamp(atmo);

    const vom = t.rows - 1;
    m.exit[i] = clamp(100 - Math.abs(v.row[i] - vom) * 2.6 - v.tier[i] * 7);
    m.family[i] = sec.family ? 95 : sec.ultras ? 22 : sec.away ? 40 : clamp(84 - v.tier[i] * 6 - (rain < 50 ? 8 : 0));
  }
  return m;
}

// ---------- soleil ----------

/** Position solaire (algorithme simplifié, précision ~1°) : altitude et azimut depuis le nord, sens horaire. */
export function sunPosition(utcMs: number, lat: number, lon: number) {
  const d = (utcMs - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * DEG, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG, e = (23.439 - 3.6e-7 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * DEG - ra, phi = lat * DEG;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI) % (2 * Math.PI);
  return { alt, az };
}

/** Direction du soleil dans le repère du stade (vers le soleil). */
export function sunVector(v: VenueModel, ev: EventConfig, minutes: number) {
  const [Y, M, D] = ev.date.split('-').map(Number);
  const utc = Date.UTC(Y, M - 1, D, 0, 0) + (minutes - ev.tzOffset * 60) * 60000;
  const { alt, az } = sunPosition(utc, v.cfg.lat, v.cfg.lon);
  // Monde : nord = -z tourné de orientationDeg.
  const a = az - v.cfg.orientationDeg * DEG;
  return { x: Math.sin(a) * Math.cos(alt), y: Math.sin(alt), z: -Math.cos(a) * Math.cos(alt), alt, az };
}

function segHit(ox: number, oy: number, dx: number, dy: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  return t > 0.05 && u >= 0 && u <= 1;
}

/** Ensoleillement d'un siège pour une direction solaire donnée (approximation 2D par profil de tribune). */
export function seatSun(v: VenueModel, sm: StaticMetrics, i: number, sun: { x: number; y: number; z: number; alt: number }, oppTop: number) {
  if (sun.alt <= 0.01) return { lit: false, glare: 0 };
  const { st, next } = tierGeo(v, i);
  const ch = Math.cos(sun.alt);
  const sd = (sun.x * v.nx[i] + sun.z * v.nz[i]); // composante vers l'extérieur (horizontale, déjà ×cos)
  const sh = sun.y;
  const d0 = v.depth[i] + 0.1, h0 = sm.ey[i];
  const segs: Array<[number, number, number, number]> = [];
  if (st.roof) segs.push([st.roof.cover, st.roof.frontH, st.roof.backD, st.roof.backH]);
  if (next) segs.push([next.d0, next.h0 - 1.2, next.dEnd, next.hEnd - 2.5]);
  segs.push([st.backD, -1, st.backD, st.topH]);
  for (const s of segs) if (segHit(d0, h0, sd, sh, s[0], s[1], s[2], s[3])) return { lit: false, glare: 0 };
  if (sd < 0) {
    // soleil devant : la tribune d'en face peut masquer un soleil bas
    const hc = Math.hypot(sm.ex[i], sm.ez[i]);
    const D = hc * 2;
    if (h0 + Math.tan(sun.alt) * D < oppTop) return { lit: false, glare: 0 };
  }
  const front = -sd / Math.max(ch, 1e-3); // 1 = soleil pile en face
  const glare = front > 0.3 && sun.alt < 40 * DEG ? front * (1 - sun.alt / (40 * DEG)) : 0;
  return { lit: true, glare };
}

// ---------- inventaire simulé (déterministe) ----------

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h; };

export function computeEvent(v: VenueModel, sm: StaticMetrics, ev: EventConfig, minutes = ev.kickoff): EventMetrics {
  const N = v.count;
  const R = rng(hashStr(v.cfg.id + ev.id));
  const price = new Float32Array(N), avail = new Uint8Array(N), value = new Float32Array(N), atmo = new Float32Array(N);
  const sun = new Float32Array(N), lit = new Uint8Array(N), glare = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const st = v.stands[v.stand[i]];
    const sec = v.sections[v.section[i]];
    const kindF = st.kind === 'main' ? 1.25 : st.kind === 'opposite' ? 1 : st.kind === 'home' ? 0.6 : st.kind === 'away' ? 0.7 : 0.85;
    const tierF = [1, 1.18, 0.78][v.tier[i]] ?? 0.75;
    let p = 38 * ev.priceFactor * kindF * tierF * (0.62 + (0.48 * sm.central[i]) / 100);
    if (v.tier[i] === 0 && v.row[i] < 3) p *= 0.9;
    if (sec.hospitality) p *= 3.2;
    if (sec.family) p *= 0.75;
    if (sec.away) p = 32 * ev.priceFactor;
    price[i] = Math.max(10, Math.round(p / 5) * 5);
    atmo[i] = clamp(sm.atmoBase[i] * (0.62 + 0.14 * ev.energy) + (sec.ultras ? ev.energy * 2 : 0));
  }
  // disponibilités : blocs vendus réalistes (chaîne de Markov par rang)
  let sold = 0;
  for (const sec of v.sections) {
    let occ = ev.occupancy + (sec.ultras ? 0.12 : 0) - (sec.hospitality ? 0.25 : 0) - (sec.family ? 0.08 : 0) + (R() - 0.5) * 0.18;
    if (sec.away) occ = Math.min(occ, 0.85);
    occ = Math.max(0.05, Math.min(0.995, occ));
    const pSA = 0.12, pAS = (pSA * occ) / (1 - occ);
    for (let r = 0; r < sec.rows; r++) {
      let s = R() < occ;
      for (let k = 0; k < sec.rowCount[r]; k++) {
        const i = sec.rowStart[r] + k;
        avail[i] = s ? 0 : 1;
        if (s) sold++;
        if (s ? R() < pSA : R() < pAS) s = !s;
      }
    }
  }
  // valeur = qualité de vue au-delà de ce que le prix laisse attendre (résidu d'une régression vue ~ log(prix))
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < N; i++) { const x = Math.log(price[i]), y = sm.view[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const b = (N * sxy - sx * sy) / (N * sxx - sx * sx || 1), a = (sy - b * sx) / N;
  for (let i = 0; i < N; i++) value[i] = clamp(60 + (sm.view[i] - (a + b * Math.log(price[i]))) * 2.4);

  const sunV = sunVector(v, ev, minutes);
  const oppTop = Math.max(...v.stands.map((s) => (s.roof ? s.roof.frontH : s.topH)));
  for (let i = 0; i < N; i++) {
    const r = seatSun(v, sm, i, sunV, oppTop);
    lit[i] = r.lit ? 1 : 0; glare[i] = r.glare;
    sun[i] = sunV.alt <= 0 ? 90 : r.lit ? clamp(80 - r.glare * 70) : 86;
  }
  let minPrice = 1e9, maxPrice = 0;
  for (let i = 0; i < N; i++) { minPrice = Math.min(minPrice, price[i]); maxPrice = Math.max(maxPrice, price[i]); }
  return { price, avail, value, atmo, sun, lit, glare, minPrice, maxPrice, sold };
}

/** Explication en langage courant (jamais de jargon en premier). */
export function viewLabel(score: number) {
  return score >= 85 ? 'Vue exceptionnelle' : score >= 75 ? 'Très bonne vue' : score >= 62 ? 'Bonne vue' : score >= 50 ? 'Vue correcte' : 'Vue limitée';
}
