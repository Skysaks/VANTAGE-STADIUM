import * as THREE from 'three';
import { gridKey, type VenueModel } from '../venue/model';

const ray = new THREE.Raycaster();
const o = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();

/**
 * Picking hiérarchique sans lecture GPU : on avance le long du rayon dans une grille spatiale (cellules de 4 m)
 * et on retient le siège le plus proche angulairement, avec une tolérance en pixels (tactile ≥ 14 px).
 */
export function pickSeat(v: VenueModel, cam: THREE.PerspectiveCamera, ndc: THREE.Vector2, tolPx: number, viewH: number, opts: { minDist?: number; maxDist?: number; skip?: number } = {}): number {
  const c = pickCandidates(v, cam, ndc, tolPx, viewH, opts, 1);
  return c.length ? c[0].i : -1;
}

export interface PickCandidate { i: number; ang: number; dist: number; score: number }

/** Tous les sièges sous le doigt (dans la tolérance), triés par proximité angulaire et profondeur. */
export function pickCandidates(v: VenueModel, cam: THREE.PerspectiveCamera, ndc: THREE.Vector2, tolPx: number, viewH: number, opts: { minDist?: number; maxDist?: number; skip?: number } = {}, max = 12): PickCandidate[] {
  ray.setFromCamera(ndc, cam);
  o.copy(ray.ray.origin); d.copy(ray.ray.direction);
  const tolAng = (tolPx * (cam.fov * Math.PI / 180)) / viewH;
  const cell = v.grid.cell;
  const seen = new Set<number>();
  const found: PickCandidate[] = [];
  let firstT = Infinity;
  const minD = opts.minDist ?? 0.8, maxD = opts.maxDist ?? 650;
  for (let t = 0; t < maxD; t += cell * 0.5) {
    if (t > firstT + 10) break;
    p.copy(o).addScaledVector(d, t);
    if (p.y < -2 || p.y > 140) { if (d.y > 0 && p.y > 140) break; continue; }
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const k = gridKey(cx + dx, cy + dy, cz + dz);
      if (seen.has(k)) continue;
      seen.add(k);
      const list = v.grid.map.get(k);
      if (!list) continue;
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        if (i === opts.skip) continue;
        const vx = v.px[i] - o.x, vy = v.py[i] + 0.55 - o.y, vz = v.pz[i] - o.z;
        const tt = vx * d.x + vy * d.y + vz * d.z;
        if (tt < minD) continue;
        const perp2 = vx * vx + vy * vy + vz * vz - tt * tt;
        const ang = Math.sqrt(Math.max(0, perp2)) / tt;
        if (ang > tolAng) continue;
        if (tt < firstT) firstT = tt;
        found.push({ i, ang: ang / tolAng, dist: tt, score: ang / tolAng + tt * 0.004 });
      }
    }
  }
  // seuls les sièges de la première surface touchée (pas ceux, derrière, d'une autre tribune)
  return found.filter((f) => f.dist < firstT + 10).sort((a, b) => a.score - b.score).slice(0, max);
}

/** Sièges proches d'un point (rayon horizontal), pour l'anti-collision caméra. */
export function seatsNear(v: VenueModel, x: number, z: number, r: number): number {
  const cell = v.grid.cell;
  let maxY = -1;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell), n = Math.ceil(r / cell);
  for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) for (let cy = 0; cy < 30; cy++) {
    const list = v.grid.map.get(gridKey(cx + dx, cy, cz + dz));
    if (!list) continue;
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      if ((v.px[i] - x) ** 2 + (v.pz[i] - z) ** 2 < r * r) maxY = Math.max(maxY, v.py[i]);
    }
  }
  return maxY;
}
