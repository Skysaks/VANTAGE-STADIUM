import type { SportConfig, StandConfig, TierConfig, VenueConfig } from '../config/types';
import { Curve, superellipse, trackLoop } from './curve';
import { gridKey, type RoofModel, type SectionModel, type StandModel, type TierModel, type VenueModel } from './model';

const SIDE_ORDER_LOOP = ['E', 'N', 'W', 'S'] as const;

function straightCurve(side: string, dist: number, len: number): Curve {
  const h = len / 2;
  switch (side) {
    case 'S': return new Curve([[-h, dist], [h, dist]]);
    case 'N': return new Curve([[h, -dist], [-h, -dist]]);
    case 'E': return new Curve([[dist, h], [dist, -h]]);
    default: return new Curve([[-dist, -h], [-dist, h]]);
  }
}

const EYE = 1.17;
const MAX_SLOPE = Math.tan((37 * Math.PI) / 180);

/**
 * Empile les niveaux. `focal` = distance horizontale entre l'avant du niveau 0 et la ligne de touche la plus proche.
 * Gradinage à valeur C : N = (C + R)(D + T) / D − R (R = hauteur de l'œil au-dessus du point focal, D = distance horizontale).
 */
function stackTiers(tiers: TierConfig[], focal: number): Omit<TierModel, 'idx' | 'sections'>[] {
  const out: Omit<TierModel, 'idx' | 'sections'>[] = [];
  tiers.forEach((t, i) => {
    let d0: number, h0: number;
    if (i === 0) { d0 = 0; h0 = t.firstRowHeight ?? 1; }
    else {
      const p = out[i - 1];
      d0 = p.dEnd - (t.overhang ?? 2);
      h0 = p.hEnd + (t.gap ?? 3.4);
    }
    const rowH = [h0];
    for (let r = 0; r < t.rows; r++) {
      let N = t.riser;
      if (t.cTarget) {
        const D = focal + d0 + r * t.rowDepth + t.rowDepth * 0.58, R = rowH[r] + EYE, C = t.cTarget / 1000, T = t.rowDepth;
        N = Math.min(Math.max(t.riser, ((C + R) * (D + T)) / D - R), T * MAX_SLOPE);
      }
      rowH.push(rowH[r] + N);
    }
    out.push({
      cfg: t, d0, h0, rows: t.rows, rowDepth: t.rowDepth, riser: t.riser, rowH,
      dEnd: d0 + t.rows * t.rowDepth, hEnd: rowH[t.rows],
    });
  });
  return out;
}

/** Exposant minimal pour que les coins du bol restent à ≥ 4 m des coins du terrain (+ dégagement). */
function safeExponent(P: SportConfig['surface'], se: number, ss: number, wanted: number) {
  const a = P.length / 2 + se, b = P.width / 2 + ss;
  const cx = P.length / 2 + 4, cz = P.width / 2 + 4;
  let n = wanted;
  while (n < 12 && Math.pow(cx / a, n) + Math.pow(cz / b, n) > 0.97) n += 0.25;
  return n;
}

/** Génère la géométrie et l'identité de tous les sièges d'un lieu. Déterministe. */
export function generateVenue(cfg: VenueConfig, sport: SportConfig, seatPitch = 1): VenueModel {
  const P = sport.surface;
  const stands: StandModel[] = [];

  type StandSpec = { sc: Omit<StandConfig, 'setback'>; curve: Curve; s0: number; s1: number; straight: boolean; tiers: TierConfig[]; roof: StandConfig['roof']; focal: number };
  const specs: StandSpec[] = [];

  if (cfg.layout === 'stands') {
    for (const sc of cfg.stands!) {
      const along = sc.side === 'N' || sc.side === 'S';
      const dist = (along ? P.width : P.length) / 2 + sc.setback;
      const len = sc.length ?? (along ? P.length + 10 : P.width + 8);
      const curve = straightCurve(sc.side, dist, len);
      specs.push({ sc, curve, s0: 0, s1: curve.length, straight: true, tiers: sc.tiers!, roof: sc.roof ?? null, focal: sc.setback });
    }
  } else {
    const b = cfg.bowl!;
    const loop = b.shape === 'track'
      ? trackLoop(b.trackStraight!, b.trackRadius!)
      : superellipse(P.length / 2 + b.setbackEnd, P.width / 2 + b.setbackSide, safeExponent(P, b.setbackEnd, b.setbackSide, b.exponent ?? 3.2));
    // Bol continu : un seul profil pour toutes les tribunes (sinon marches visibles aux jonctions),
    // calculé pour la distance focale la plus courte (milieu des tribunes latérales).
    const sideMid = loop.curve.at(loop.quarters[1] + (loop.quarters[2] - loop.quarters[1]) / 2);
    const focal = Math.max(2, Math.abs(sideMid.z) - P.width / 2);
    for (const st of b.stands) {
      const q = SIDE_ORDER_LOOP.indexOf(st.side as (typeof SIDE_ORDER_LOOP)[number]);
      specs.push({ sc: st, curve: loop.curve, s0: loop.quarters[q], s1: loop.quarters[q + 1], straight: false, tiers: b.tiers, roof: b.roof, focal });
    }
  }

  // Numérotation : tribune principale d'abord, puis sens de parcours.
  const mainFirst = [...specs].sort((a, b) => (a.sc.kind === 'main' ? -1 : b.sc.kind === 'main' ? 1 : 0));
  const loopOrder = ['S', 'E', 'N', 'W'];
  mainFirst.sort((a, b) => loopOrder.indexOf(a.sc.side) - loopOrder.indexOf(b.sc.side));

  const longLen = Math.max(...specs.filter((s) => s.sc.side === 'N' || s.sc.side === 'S').map((s) => s.s1 - s.s0), 1);

  const sections: SectionModel[] = [];
  const PX: number[] = [], PY: number[] = [], PZ: number[] = [], NX: number[] = [], NZ: number[] = [], DEP: number[] = [];
  const SEC: number[] = [], ROW: number[] = [], NUM: number[] = [], TIER: number[] = [], STAND: number[] = [], PMR: number[] = [];
  const counters: number[] = [];
  const seatW = cfg.seatWidth * seatPitch;
  const tmp = { x: 0, z: 0, nx: 0, nz: 0 };

  mainFirst.forEach((sp, standIdx) => {
    const tiersGeo = stackTiers(sp.tiers, sp.focal);
    const last = tiersGeo[tiersGeo.length - 1];
    let roof: RoofModel | null = null;
    if (sp.roof) {
      const frontH = last.hEnd + sp.roof.clearance;
      roof = { ...sp.roof, frontH, backD: last.dEnd + 1.2, backH: frontH - 1.6 };
    }
    const span = sp.s1 - sp.s0;
    const stand: StandModel = {
      idx: standIdx, id: sp.sc.id, name: sp.sc.name, side: sp.sc.side, kind: sp.sc.kind, colors: sp.sc.colors,
      curve: sp.curve, s0: sp.s0, s1: sp.s1, straight: sp.straight, tiers: [], roof, columns: [],
      topH: roof ? roof.backH : last.hEnd + 1.2, backD: last.dEnd + 0.4,
      center: { x: 0, y: 0, z: 0 },
    };
    const mid = sp.curve.at(sp.s0 + span / 2);
    const midD = (last.dEnd) / 2;
    stand.center = { x: mid.x + mid.nx * midD, y: last.hEnd / 2, z: mid.z + mid.nz * midD };

    tiersGeo.forEach((tg, ti) => {
      const tier: TierModel = { ...tg, idx: ti, sections: [] };
      const isLong = sp.sc.side === 'N' || sp.sc.side === 'S';
      const nSec = sp.straight || isLong ? tg.cfg.sections : Math.max(3, Math.round((tg.cfg.sections * span) / longLen));
      const endMargin = sp.straight ? 0.5 : cfg.aisle / 2;
      const secLen = (span - (nSec - 1) * cfg.aisle - 2 * endMargin) / nSec;
      if (counters[ti] === undefined) counters[ti] = 1;
      for (let k = 0; k < nSec; k++) {
        const sa = sp.s0 + endMargin + k * (secLen + cfg.aisle);
        const sb = sa + secLen;
        const secIdx = sections.length;
        const code = String((ti + 1) * 100 + counters[ti]++);
        const sec: SectionModel = {
          idx: secIdx, code, stand: standIdx, tier: ti, indexInStand: k, sa, sb, rows: tg.rows,
          rowStart: new Int32Array(tg.rows), rowCount: new Int32Array(tg.rows), start: PX.length, count: 0,
          away: false, family: false, ultras: false, hospitality: false,
          center: { x: 0, y: 0, z: 0 }, front: { x: 0, y: 0, z: 0, nx: 0, nz: 0 }, radius: 0,
        };
        const flag = (f?: { stand: string; tier?: number; sections: number[] }) =>
          !!f && f.stand === sp.sc.id && (f.tier ?? 0) === ti && f.sections.includes(k);
        sec.away = flag(cfg.away);
        sec.family = flag(cfg.family);
        sec.ultras = flag(cfg.ultras);
        sec.hospitality = flag(cfg.hospitality);

        const base = sp.curve.samples(sa, sb, sp.straight ? 1e9 : 1.5);
        const bx = base.map((s) => sp.curve.at(s, { ...tmp }));
        let cx = 0, cy = 0, cz = 0;
        for (let r = 0; r < tg.rows; r++) {
          const d = tg.d0 + r * tg.rowDepth + tg.rowDepth * 0.58;
          const y = tg.rowH[r];
          const ox = bx.map((p) => p.x + p.nx * d), oz = bx.map((p) => p.z + p.nz * d);
          const cum = [0];
          for (let i = 1; i < ox.length; i++) cum.push(cum[i - 1] + Math.hypot(ox[i] - ox[i - 1], oz[i] - oz[i - 1]));
          const len = cum[cum.length - 1];
          const n = Math.floor(len / seatW);
          sec.rowStart[r] = PX.length;
          sec.rowCount[r] = Math.max(0, n);
          let seg = 0;
          for (let j = 0; j < n; j++) {
            const target = ((j + 0.5) * len) / n;
            while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
            const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
            const x = ox[seg] + (ox[seg + 1] - ox[seg]) * t;
            const z = oz[seg] + (oz[seg + 1] - oz[seg]) * t;
            const nA = bx[seg], nB = bx[seg + 1];
            let nnx = nA.nx + (nB.nx - nA.nx) * t, nnz = nA.nz + (nB.nz - nA.nz) * t;
            const l = Math.hypot(nnx, nnz) || 1; nnx /= l; nnz /= l;
            PX.push(x); PY.push(y); PZ.push(z); NX.push(nnx); NZ.push(nnz); DEP.push(d);
            SEC.push(secIdx); ROW.push(r); NUM.push(j + 1); TIER.push(ti); STAND.push(standIdx);
            const pmrSec = ti === 0 && r === 0 && (sp.sc.kind === 'main' || sp.sc.kind === 'opposite') && (k === 1 || k === nSec - 2);
            PMR.push(pmrSec && j < 5 ? (j < 4 ? 1 : 2) : 0);
            cx += x; cy += y; cz += z;
          }
        }
        sec.count = PX.length - sec.start;
        if (sec.count > 0) sec.center = { x: cx / sec.count, y: cy / sec.count, z: cz / sec.count };
        const fm = sp.curve.at((sa + sb) / 2);
        sec.front = { x: fm.x + fm.nx * tg.d0, y: tg.h0, z: fm.z + fm.nz * tg.d0, nx: fm.nx, nz: fm.nz };
        let rad = 0;
        for (let i = sec.start; i < sec.start + sec.count; i++) {
          rad = Math.max(rad, Math.hypot(PX[i] - sec.center.x, PY[i] - sec.center.y, PZ[i] - sec.center.z));
        }
        sec.radius = rad + 1;
        sections.push(sec);
        tier.sections.push(secIdx);
      }
      stand.tiers.push(tier);
      // poteaux de toit dans les allées du dernier niveau
      if (roof?.columns && ti === tiersGeo.length - 1) {
        const secs = tier.sections.map((i) => sections[i]);
        for (let k = 0; k < secs.length - 1; k++) {
          if ((k + 1) % roof.columns !== 0) continue;
          const sMid = (secs[k].sb + secs[k + 1].sa) / 2;
          const c = sp.curve.at(sMid);
          const d = roof.cover + 0.3;
          const r = Math.max(0, Math.floor((d - tg.d0) / tg.rowDepth));
          stand.columns.push({ x: c.x + c.nx * d, z: c.z + c.nz * d, y0: tg.rowH[Math.min(r, tg.rows)], y1: roof.frontH, r: 0.2 });
        }
      }
    });
    stands.push(stand);
  });

  const count = PX.length;
  const f32 = (a: number[]) => Float32Array.from(a);
  const px = f32(PX), py = f32(PY), pz = f32(PZ);

  // Grille spatiale pour le picking (cellules de 4 m).
  const cell = 4;
  const buckets = new Map<number, number[]>();
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 0;
  for (let i = 0; i < count; i++) {
    const k = gridKey(Math.floor(px[i] / cell), Math.floor(py[i] / cell), Math.floor(pz[i] / cell));
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(i);
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]); maxY = Math.max(maxY, py[i]);
  }
  const map = new Map<number, Int32Array>();
  buckets.forEach((v, k) => map.set(k, Int32Array.from(v)));
  for (const st of stands) if (st.roof) maxY = Math.max(maxY, st.roof.frontH);

  return {
    cfg, stands, sections, count, px, py, pz, nx: f32(NX), nz: f32(NZ), depth: f32(DEP),
    section: Uint16Array.from(SEC), row: Uint8Array.from(ROW), num: Uint16Array.from(NUM),
    tier: Uint8Array.from(TIER), stand: Uint8Array.from(STAND), pmr: Uint8Array.from(PMR),
    pitch: { ...P }, bounds: { minX, maxX, minZ, maxZ, maxY }, grid: { cell, map },
  };
}

// ---------- identité des sièges ----------

export const seatId = (v: VenueModel, i: number) => `${v.sections[v.section[i]].code}-R${v.row[i] + 1}-S${v.num[i]}`;

export function parseSeatId(v: VenueModel, id: string): number {
  const m = /^(\d+)-R(\d+)-S(\d+)$/.exec(id);
  if (!m) return -1;
  const sec = v.sections.find((s) => s.code === m[1]);
  if (!sec) return -1;
  const r = +m[2] - 1, n = +m[3] - 1;
  if (r < 0 || r >= sec.rows || n < 0 || n >= sec.rowCount[r]) return -1;
  return sec.rowStart[r] + n;
}

/** Voisin direct : gauche/droite dans le rang (puis section voisine), haut/bas = rang suivant au plus proche. */
export function neighbor(v: VenueModel, i: number, dir: 'left' | 'right' | 'up' | 'down'): number {
  const sec = v.sections[v.section[i]];
  const r = v.row[i], k = v.num[i] - 1;
  if (dir === 'left' || dir === 'right') {
    const nk = k + (dir === 'right' ? 1 : -1);
    if (nk >= 0 && nk < sec.rowCount[r]) return sec.rowStart[r] + nk;
    // section voisine, même niveau, même tribune ou tribune adjacente (bol)
    const sameTier = v.sections.filter((s) => s.tier === sec.tier && s.idx !== sec.idx);
    let best = -1, bd = 1e9;
    for (const s of sameTier) {
      const rr = Math.min(r, s.rows - 1);
      for (const j of [s.rowStart[rr], s.rowStart[rr] + s.rowCount[rr] - 1]) {
        if (s.rowCount[rr] === 0) continue;
        const dx = v.px[j] - v.px[i], dz = v.pz[j] - v.pz[i];
        const d = Math.hypot(dx, dz);
        // spectateur tourné vers -n : sa droite est (nz, -nx)
        const dotRight = dx * v.nz[i] - dz * v.nx[i];
        const want = dir === 'right' ? 1 : -1;
        if (dotRight * want > 0 && d < bd && d < 6) { bd = d; best = j; }
      }
    }
    return best;
  }
  const nr = r + (dir === 'up' ? 1 : -1);
  if (nr < 0 || nr >= sec.rows || sec.rowCount[nr] === 0) return -1;
  let best = -1, bd = 1e9;
  for (let j = sec.rowStart[nr]; j < sec.rowStart[nr] + sec.rowCount[nr]; j++) {
    const d = (v.px[j] - v.px[i]) ** 2 + (v.pz[j] - v.pz[i]) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

/** Siège de la même section, au rang et à la position relative donnés (pour les curseurs). */
export function seatAt(v: VenueModel, secIdx: number, row: number, frac: number): number {
  const s = v.sections[secIdx];
  const r = Math.max(0, Math.min(s.rows - 1, row));
  const n = s.rowCount[r];
  if (n === 0) return -1;
  return s.rowStart[r] + Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
}
