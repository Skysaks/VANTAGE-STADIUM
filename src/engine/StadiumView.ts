import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StandModel, TierModel, VenueModel } from '../venue/model';

type P2 = [number, number];
// Palette par défaut ; chaque archétype la remplace via VenueConfig.style (voir paletteOf).
let C_TREAD = new THREE.Color('#6a6f78');
let C_RISER = new THREE.Color('#4b5059');
let C_STAIR = new THREE.Color('#9aa0a8');
let C_WALL = new THREE.Color('#3c4048');
let C_SOFFIT = new THREE.Color('#2b2e35');
let C_ROOF_TOP = new THREE.Color('#c9ced6');
let C_ROOF_UNDER = new THREE.Color('#3a3f48');
let C_FACADE = new THREE.Color('#3c4048');

function paletteOf(v: VenueModel) {
  const s = v.cfg.style;
  C_TREAD = new THREE.Color(s.concrete);
  C_RISER = new THREE.Color(s.concreteDark);
  C_STAIR = new THREE.Color(s.stair);
  C_WALL = new THREE.Color(s.concreteDark).multiplyScalar(0.85);
  C_SOFFIT = new THREE.Color(s.concreteDark).multiplyScalar(0.6);
  C_ROOF_TOP = new THREE.Color(s.roofTop);
  C_ROOF_UNDER = new THREE.Color(s.roofUnder);
  C_FACADE = new THREE.Color(s.facade);
}

/** Profil fermé (d, h) d'un niveau de tribune, avec un type par arête pour la couleur. */
function tierProfile(st: StandModel, t: TierModel): { pts: P2[]; kind: string[] } {
  const pts: P2[] = [];
  const kind: string[] = [];
  const push = (d: number, h: number, k: string) => { pts.push([d, h]); kind.push(k); };
  const next = st.tiers[t.idx + 1];
  const last = !next;
  const upper = t.idx > 0;
  const base = upper ? t.h0 - 1.2 : -0.6;
  const parapet = upper ? 0.95 : 0.3;
  push(t.d0, base, 'wall');
  push(t.d0, t.h0 + parapet, 'wall');
  push(t.d0 + 0.18, t.h0 + parapet, 'wall');
  for (let r = 0; r < t.rows; r++) {
    const h = t.rowH[r];
    // (nez de marche jaunes des allées : quads instanciés dans Details, bien moins coûteux qu'un point de profil de plus)
    push(t.d0 + (r === 0 ? 0.18 : r * t.rowDepth), h, 'riser');
    push(t.d0 + (r + 1) * t.rowDepth, h, 'tread');
  }
  const top = last ? st.topH : next.h0 - 1.2 + 0.4;
  push(t.dEnd, top, 'wall');
  push(t.dEnd + 0.45, top, 'back');
  if (upper) {
    push(t.dEnd + 0.45, t.hEnd - 1.6, 'wall');
    push(t.d0, base, 'soffit');
  } else {
    push(t.dEnd + 0.45, -0.6, 'wall');
    push(t.d0, -0.6, 'soffit');
  }
  return { pts, kind };
}

/** Balaye un profil (d, h) le long de la courbe d'une tribune entre s0 et s1. */
function sweep(
  st: StandModel, prof: { pts: P2[]; kind: string[] }, ss: number[],
  color: (kind: string, sMid: number) => THREE.Color, caps: boolean,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const S = ss.map((s) => st.curve.at(s));
  const P = prof.pts;
  const n = P.length;
  const W = (k: number, d: number, h: number) => {
    const c = S[k];
    return [c.x + c.nx * d, h, c.z + c.nz * d];
  };
  for (let k = 0; k < S.length - 1; k++) {
    const sMid = (ss[k] + ss[k + 1]) / 2;
    for (let j = 0; j < n; j++) {
      const a = P[j], b = P[(j + 1) % n];
      const c = color(prof.kind[j], sMid);
      const a0 = W(k, a[0], a[1]), b0 = W(k, b[0], b[1]), a1 = W(k + 1, a[0], a[1]), b1 = W(k + 1, b[0], b[1]);
      pos.push(...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
      for (let q = 0; q < 6; q++) col.push(c.r, c.g, c.b);
    }
  }
  if (caps) {
    const tris = THREE.ShapeUtils.triangulateShape(P.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [k, flip] of [[0, true], [S.length - 1, false]] as Array<[number, boolean]>) {
      for (const t of tris) {
        const ids = flip ? [t[0], t[2], t[1]] : t;
        for (const id of ids) { pos.push(...W(k, P[id][0], P[id][1])); col.push(C_WALL.r, C_WALL.g, C_WALL.b); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export interface StadiumParts {
  group: THREE.Group;
  tierMeshes: THREE.Mesh[][];   // [niveau][…] pour la vue éclatée
  concreteMat: THREE.MeshStandardMaterial;
  roof: THREE.Mesh | null;
  roofMat: THREE.MeshStandardMaterial;
  lampMat: THREE.MeshBasicMaterial;
  lampBanks: THREE.InstancedMesh[];
  floodSources: THREE.Vector3[];
  screens: Array<{ pos: THREE.Vector3; look: THREE.Vector3; w: number; h: number }>;
  dispose(): void;
}

export function buildStadium(v: VenueModel): StadiumParts {
  paletteOf(v);
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide });
  const rs = v.cfg.style.roof;
  const roofMat = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, transparent: false, opacity: 1,
    roughness: rs === 'membrane' ? 0.75 : rs === 'metal' ? 0.45 : 0.5, metalness: rs === 'membrane' ? 0.0 : rs === 'metal' ? 0.6 : 0.4,
  });
  const disposables: Array<{ dispose(): void }> = [concrete, roofMat];
  const tierGeos: THREE.BufferGeometry[][] = [];
  const roofGeos: THREE.BufferGeometry[] = [];

  for (const st of v.stands) {
    const secs = st.tiers.flatMap((t) => t.sections.map((i) => v.sections[i]));
    const breaks = secs.flatMap((s) => [s.sa, s.sb]);
    const ss = st.curve.samples(st.s0, st.s1, st.straight ? 1e9 : 2, breaks);
    for (const t of st.tiers) {
      const tierSecs = t.sections.map((i) => v.sections[i]);
      const inAisle = (s: number) => !tierSecs.some((x) => s >= x.sa && s <= x.sb);
      const g = sweep(st, tierProfile(st, t), ss, (k, s) =>
        k === 'tread' ? (inAisle(s) ? C_STAIR : C_TREAD) : k === 'riser' ? C_RISER : k === 'soffit' ? C_SOFFIT : k === 'back' ? C_FACADE : C_WALL, st.straight);
      (tierGeos[t.idx] ??= []).push(g);
    }
    if (st.roof) {
      const r = st.roof;
      const prof = {
        pts: [[r.cover, r.frontH], [r.backD, r.backH], [r.backD, r.backH - 0.6], [r.cover, r.frontH - (rs === 'cantilever' ? 2.6 : rs === 'membrane' ? 0.5 : 0.9)]] as P2[],
        kind: ['top', 'wall', 'under', 'wall'],
      };
      roofGeos.push(sweep(st, prof, ss, (k) => (k === 'top' ? C_ROOF_TOP : k === 'under' ? C_ROOF_UNDER : C_WALL), st.straight));
    }
    // poteaux de toit
    for (const c of st.columns) {
      const h = c.y1 - c.y0;
      const cyl = new THREE.CylinderGeometry(c.r, c.r, h, 10).toNonIndexed();
      cyl.translate(c.x, c.y0 + h / 2, c.z);
      const cols = new Float32Array(cyl.attributes.position.count * 3).fill(0.55);
      cyl.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      cyl.deleteAttribute('uv');
      (tierGeos[st.tiers.length - 1] ??= []).push(cyl);
    }
  }

  // Coins remplis (tribunes séparées)
  if (v.cfg.layout === 'stands' && v.cfg.corners === 'filled') {
    const byS = Object.fromEntries(v.stands.map((s) => [s.side, s]));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      // tribunes choisies par leur position réelle (signe de x / z), pas par leur nom
      const lat = [byS.N, byS.S].find((t) => t && Math.sign(t.curve.at(0).z) === sz);
      const end = [byS.E, byS.W].find((t) => t && Math.sign(t.curve.at(0).x) === sx);
      if (!lat || !end) continue;
      const x0 = lat.curve.length / 2, z0 = end.curve.length / 2;
      const x1 = Math.abs(end.curve.at(0).x) + end.backD;
      const z1 = Math.abs(lat.curve.at(0).z) + lat.backD;
      // bloc de coin à pan coupé : relie les deux tribunes sans dépasser en diagonale
      const w = Math.max(2, x1 - x0), d = Math.max(2, z1 - z0), h = 6;
      const P = (x: number, z: number) => new THREE.Vector2(sx * x, -sz * z);
      const shape = new THREE.Shape([P(x0, z0), P(x0 + w, z0), P(x0 + w, z0 + d * 0.3), P(x0 + w * 0.3, z0 + d), P(x0, z0 + d)]);
      const box = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).toNonIndexed();
      box.rotateX(-Math.PI / 2);
      box.translate(0, -0.6, 0);
      box.setAttribute('color', new THREE.BufferAttribute(new Float32Array(box.attributes.position.count * 3).fill(0.19), 3));
      box.deleteAttribute('uv');
      box.clearGroups();
      (tierGeos[0] ??= []).push(box);
    }
  }

  const tierMeshes: THREE.Mesh[][] = [];
  tierGeos.forEach((geos, ti) => {
    if (!geos?.length) return;
    const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)))!;
    disposables.push(g);
    const m = new THREE.Mesh(g, concrete);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.tier = ti;
    group.add(m);
    tierMeshes[ti] = [m];
  });
  let roof: THREE.Mesh | null = null;
  if (roofGeos.length) {
    const g = mergeGeometries(roofGeos)!;
    disposables.push(g);
    roof = new THREE.Mesh(g, roofMat);
    roof.castShadow = true; roof.receiveShadow = true;
    roof.userData.tier = 99;
    group.add(roof);
  }

  // Projecteurs : rampe sous le bord du toit, ou pylônes d'angle.
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff4dc' });
  disposables.push(lampMat);
  const lampBanks: THREE.InstancedMesh[] = [];
  const floodSources: THREE.Vector3[] = [];
  const lampGeo = new THREE.BoxGeometry(1.4, 0.5, 0.25);
  disposables.push(lampGeo);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  if (v.cfg.floodlights === 'roof') {
    for (const st of v.stands) {
      if (!st.roof) continue;
      const n = Math.max(4, Math.floor((st.s1 - st.s0) / 4));
      const im = new THREE.InstancedMesh(lampGeo, lampMat, n);
      for (let k = 0; k < n; k++) {
        const c = st.curve.at(st.s0 + ((k + 0.5) * (st.s1 - st.s0)) / n);
        p.set(c.x + c.nx * (st.roof.cover + 0.4), st.roof.frontH - 0.9, c.z + c.nz * (st.roof.cover + 0.4));
        q.setFromRotationMatrix(new THREE.Matrix4().lookAt(p, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)));
        im.setMatrixAt(k, m4.compose(p, q, one));
      }
      im.userData.stand = st.idx;
      group.add(im); lampBanks.push(im);
      const mid = st.curve.at((st.s0 + st.s1) / 2);
      floodSources.push(new THREE.Vector3(mid.x + mid.nx * st.roof.cover, st.roof.frontH, mid.z + mid.nz * st.roof.cover));
    }
  } else {
    const ext = Math.max(v.bounds.maxX, v.bounds.maxZ) * 0.9;
    const mastGeo = new THREE.CylinderGeometry(0.55, 0.9, 1, 8);
    const mastMat = new THREE.MeshStandardMaterial({ color: '#8b9099', roughness: 0.5, metalness: 0.6 });
    disposables.push(mastGeo, mastMat);
    const ang = Math.atan2(v.bounds.maxZ, v.bounds.maxX);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * Math.cos(ang) * ext * 1.12, z = sz * Math.sin(ang) * ext * 1.12;
      const H = Math.max(v.bounds.maxY + 14, 42);
      const mast = new THREE.Mesh(mastGeo, mastMat);
      mast.scale.set(1, H, 1); mast.position.set(x, H / 2, z); mast.castShadow = true;
      group.add(mast);
      const im = new THREE.InstancedMesh(lampGeo, lampMat, 24);
      const head = new THREE.Vector3(x, H + 1.5, z);
      const look = new THREE.Matrix4().lookAt(head, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
      q.setFromRotationMatrix(look);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      let k = 0;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        p.copy(head).addScaledVector(right, (c - 2.5) * 1.6).addScaledVector(up, (r - 1.5) * 0.7);
        im.setMatrixAt(k++, m4.compose(p, q, one));
      }
      group.add(im); lampBanks.push(im);
      floodSources.push(head.clone());
    }
  }

  // Écrans géants : au-dessus du dernier rang des deux virages (ou des tribunes latérales s'il n'y en a pas).
  const screens: StadiumParts['screens'] = [];
  const ends = v.stands.filter((s) => s.side === 'E' || s.side === 'W');
  for (const st of (ends.length ? ends : v.stands.slice(0, 2))) {
    const mid = st.curve.at((st.s0 + st.s1) / 2);
    const lastT = st.tiers[st.tiers.length - 1];
    // écran posé sur le bord du toit (ou au sommet de la tribune) : visible d'en face, ne masque aucune place
    const d = st.roof ? st.roof.cover + 0.6 : lastT.dEnd + 0.6;
    const y = st.roof ? st.roof.frontH + 4.7 : st.topH + 5.5;
    const pos = new THREE.Vector3(mid.x + mid.nx * d, y, mid.z + mid.nz * d);
    screens.push({ pos, look: new THREE.Vector3(0, y * 0.5, 0), w: 20, h: 8.4 });
    if (!st.roof) {
      const legGeo = new THREE.BoxGeometry(0.5, y, 0.5);
      const legMat = new THREE.MeshStandardMaterial({ color: '#2e3138' });
      disposables.push(legGeo, legMat);
      for (const off of [-7, 7]) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(pos.x + -mid.nz * off, y / 2, pos.z + mid.nx * off);
        group.add(leg);
      }
    }
  }

  return {
    group, tierMeshes, concreteMat: concrete, roof, roofMat, lampMat, lampBanks, floodSources, screens,
    dispose() { disposables.forEach((d) => d.dispose()); },
  };
}
