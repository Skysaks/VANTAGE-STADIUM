import * as THREE from 'three';
import type { VenueModel } from '../venue/model';

/**
 * Micro-détails là où le regard se pose (addendum mobile §85–92) : signalétique de section, panneaux SORTIE au-dessus
 * des vomitoires, portes extérieures, éclairage d'allées la nuit. Tout est instancié (quelques appels de dessin),
 * le texte vient d'un unique atlas de petite taille (2 Mo au plus).
 */

/** Atlas de libellés : une cellule par texte, rendu une fois. */
export function textAtlas(labels: Array<{ text: string; bg: string; fg: string }>, cw: number, ch: number) {
  const cols = Math.max(1, Math.floor(2048 / cw));
  const rows = Math.ceil(labels.length / cols);
  const H = Math.min(2048, 2 ** Math.ceil(Math.log2(Math.max(1, rows * ch))));
  const W = Math.min(2048, 2 ** Math.ceil(Math.log2(Math.min(labels.length, cols) * cw)));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const rects: Array<[number, number, number, number]> = [];
  labels.forEach((l, k) => {
    const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
    c.fillStyle = l.bg; c.fillRect(x, y, cw, ch);
    c.fillStyle = l.fg;
    let fs = Math.round(ch * 0.62);
    c.font = `700 ${fs}px Inter, system-ui, sans-serif`;
    while (c.measureText(l.text).width > cw * 0.88 && fs > 8) { fs--; c.font = `700 ${fs}px Inter, system-ui, sans-serif`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(l.text, x + cw / 2, y + ch / 2 + 1);
    rects.push([x / W, 1 - (y + ch) / H, cw / W, ch / H]);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, rects };
}

/** Plans texturés instanciés : chaque instance lit sa cellule d'atlas (aCell = x, y, w, h). */
export function atlasPlanes(tex: THREE.Texture, count: number, opts: { lit?: boolean } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
  const uniforms = { uBright: { value: 1 } };
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide, toneMapped: !opts.lit, fog: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell.xy + uv * aCell.zw;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBright;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= uBright;');
  };
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  return { mesh, geo, mat, uniforms };
}

export interface DetailParts {
  group: THREE.Group;
  /** Lumière d'allée (0 = jour, 1 = nuit, projecteurs allumés). */
  setNight(k: number): void;
  portals: Array<{ x: number; y: number; z: number; stand: number; tier: number }>;
  dispose(): void;
}

export function buildDetails(v: VenueModel): DetailParts {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const up = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const facing = (nx: number, nz: number) => q.setFromAxisAngle(up, Math.atan2(nx, nz));

  // ---- libellés de l'atlas : codes de section, SORTIE, PORTE A…
  const labels: Array<{ text: string; bg: string; fg: string }> = v.sections.map((s) => ({ text: s.code, bg: '#151b24', fg: '#e9eef3' }));
  const EXIT = labels.length; labels.push({ text: 'SORTIE', bg: '#0d7a3e', fg: '#ffffff' });
  const GATE0 = labels.length; v.stands.forEach((_, k) => labels.push({ text: `PORTE ${String.fromCharCode(65 + k)}`, bg: '#1c2430', fg: '#ffffff' }));
  const atlas = textAtlas(labels, 64, 28);
  disposables.push(atlas.tex);

  type Inst = { pos: THREE.Vector3; nx: number; nz: number; w: number; h: number; cell: number; out?: boolean };
  const signs: Inst[] = [];
  const portals: DetailParts['portals'] = [];
  const portalInst: Array<{ pos: THREE.Vector3; nx: number; nz: number; w: number; h: number }> = [];
  const lights: THREE.Vector3[] = [];
  const noses: Array<{ pos: THREE.Vector3; nx: number; nz: number; w: number }> = [];

  for (const st of v.stands) {
    for (const t of st.tiers) {
      const secs = t.sections.map((i) => v.sections[i]).sort((a, b) => a.sa - b.sa);
      const next = st.tiers[t.idx + 1];
      const floor = t.rowH[t.rows - 1];
      const top = next ? next.h0 - 1.2 + 0.4 : st.topH;
      const wallH = top - floor;
      const dWall = t.dEnd - 0.03;
      // panneau de section, au mur arrière (ou sur un poteau bas si le mur est absent)
      for (const s of secs) {
        const c = st.curve.at((s.sa + s.sb) / 2, { x: 0, z: 0, nx: 0, nz: 0 });
        const y = floor + Math.min(2.5, Math.max(1.0, wallH * 0.62));
        signs.push({ pos: new THREE.Vector3(c.x + c.nx * dWall, y, c.z + c.nz * dWall), nx: -c.nx, nz: -c.nz, w: 1.25, h: 0.55, cell: s.idx });
      }
      // allées intérieures : vomitoires au mur arrière (une allée sur deux), éclairage de marches la nuit
      for (let k = 0; k < secs.length - 1; k++) {
        const sMid = (secs[k].sb + secs[k + 1].sa) / 2;
        const c = st.curve.at(sMid, { x: 0, z: 0, nx: 0, nz: 0 });
        const aisleW = Math.max(0.6, secs[k + 1].sa - secs[k].sb - 0.1);
        for (let r = 0; r < t.rows; r++) {
          const d = t.d0 + (r === 0 ? 0.18 : r * t.rowDepth) + 0.035;
          noses.push({ pos: new THREE.Vector3(c.x + c.nx * d, t.rowH[r] + 0.006, c.z + c.nz * d), nx: c.nx, nz: c.nz, w: aisleW });
          if (r % 2 === 1) lights.push(new THREE.Vector3(c.x + c.nx * (d + 0.045), t.rowH[r] + 0.03, c.z + c.nz * (d + 0.045)));
        }
        if (k % 2 === 0 && wallH >= 2.3) {
          const ph = Math.min(2.4, wallH - 0.35);
          portalInst.push({ pos: new THREE.Vector3(c.x + c.nx * (dWall - 0.01), floor + ph / 2, c.z + c.nz * (dWall - 0.01)), nx: -c.nx, nz: -c.nz, w: 1.9, h: ph });
          signs.push({ pos: new THREE.Vector3(c.x + c.nx * (dWall - 0.02), floor + ph + 0.22, c.z + c.nz * (dWall - 0.02)), nx: -c.nx, nz: -c.nz, w: 0.85, h: 0.3, cell: EXIT });
          portals.push({ x: c.x + c.nx * dWall, y: floor, z: c.z + c.nz * dWall, stand: st.idx, tier: t.idx });
        }
      }
    }
    // porte extérieure, sur la façade
    const mid = st.curve.at((st.s0 + st.s1) / 2, { x: 0, z: 0, nx: 0, nz: 0 });
    const dOut = st.backD + 0.08;
    signs.push({ pos: new THREE.Vector3(mid.x + mid.nx * dOut, 5.2, mid.z + mid.nz * dOut), nx: mid.nx, nz: mid.nz, w: 4.2, h: 1.6, cell: GATE0 + st.idx, out: true });
  }

  // panneaux (atlas)
  const P = atlasPlanes(atlas.tex, signs.length, { lit: true });
  const cell = P.geo.getAttribute('aCell') as THREE.InstancedBufferAttribute;
  signs.forEach((s, k) => {
    m4.compose(s.pos, facing(s.nx, s.nz), sc.set(s.w, s.h, 1));
    P.mesh.setMatrixAt(k, m4);
    const r = atlas.rects[s.cell];
    cell.setXYZW(k, r[0], r[1], r[2], r[3]);
  });
  P.mesh.instanceMatrix.needsUpdate = true; cell.needsUpdate = true;
  group.add(P.mesh);
  disposables.push(P.geo, P.mat);

  // vomitoires : ouvertures sombres (repères d'orientation)
  const pg = new THREE.PlaneGeometry(1, 1);
  const pm = new THREE.MeshBasicMaterial({ color: '#07090c', fog: true });
  const portalMesh = new THREE.InstancedMesh(pg, pm, Math.max(1, portalInst.length));
  portalMesh.count = portalInst.length;
  portalInst.forEach((s, k) => { m4.compose(s.pos, facing(s.nx, s.nz), sc.set(s.w, s.h, 1)); portalMesh.setMatrixAt(k, m4); });
  portalMesh.instanceMatrix.needsUpdate = true;
  portalMesh.frustumCulled = false;
  group.add(portalMesh);
  disposables.push(pg, pm);

  // nez de marche jaunes dans les allées (§85) : une bande par marche, 2 triangles, un seul appel de dessin
  const ng = new THREE.PlaneGeometry(1, 1); ng.rotateX(-Math.PI / 2);
  const nm = new THREE.MeshLambertMaterial({ color: '#b8952e' });
  const noseMesh = new THREE.InstancedMesh(ng, nm, Math.max(1, noses.length));
  noseMesh.count = noses.length;
  noses.forEach((n, k) => { m4.compose(n.pos, facing(n.nx, n.nz), sc.set(n.w, 1, 0.07)); noseMesh.setMatrixAt(k, m4); });
  noseMesh.instanceMatrix.needsUpdate = true;
  noseMesh.frustumCulled = false;
  noseMesh.receiveShadow = true;
  group.add(noseMesh);
  disposables.push(ng, nm);

  // éclairage d'allées : petits pavés lumineux au nez des marches, visibles seulement la nuit
  const lg = new THREE.BoxGeometry(0.22, 0.035, 0.06);
  const lm = new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false, transparent: true, opacity: 0, fog: true });
  const lightMesh = new THREE.InstancedMesh(lg, lm, Math.max(1, lights.length));
  lightMesh.count = lights.length;
  lights.forEach((l, k) => { m4.compose(l, q.identity(), sc.set(1, 1, 1)); lightMesh.setMatrixAt(k, m4); });
  lightMesh.instanceMatrix.needsUpdate = true;
  lightMesh.frustumCulled = false;
  lightMesh.visible = false;
  group.add(lightMesh);
  disposables.push(lg, lm);
  void p;

  return {
    group, portals,
    setNight(k: number) {
      lightMesh.visible = k > 0.05;
      lm.opacity = Math.min(1, k * 1.1);
      P.uniforms.uBright.value = 0.62 + 0.38 * k;
    },
    dispose() { disposables.forEach((d) => d.dispose()); },
  };
}

/**
 * Personnel au bord du terrain (§91–92) : caméras de télévision, photographes derrière les buts, stewards en gilet.
 * Silhouettes très simples (corps, tête, caméra) : elles donnent l'échelle, sans simuler une foule de personnel.
 */
export function buildStaff(v: VenueModel): { group: THREE.Group; dispose(): void } {
  const L = v.pitch.length, W = v.pitch.width;
  const main = v.stands.find((s) => s.kind === 'main') ?? v.stands[0];
  const mz = main.side === 'N' ? -1 : 1;
  type F = { x: number; z: number; face: number; kind: 'cam' | 'photo' | 'steward' };
  const fig: F[] = [];
  // caméras le long de la touche opposée à la tribune principale (derrière les panneaux)
  for (const x of [-34, -12, 12, 34]) fig.push({ x, z: -mz * (W / 2 + 5.4), face: mz > 0 ? 0 : Math.PI, kind: 'cam' });
  // photographes à genoux derrière chaque but, de part et d'autre du but
  for (const sx of [-1, 1]) for (const z of [-13, -10.5, -8, 8, 10.5, 13]) fig.push({ x: sx * (L / 2 + 3.2), z, face: sx > 0 ? -Math.PI / 2 : Math.PI / 2, kind: 'photo' });
  // stewards face au public, tous les ~25 m, et à la sortie du tunnel
  for (const x of [-45, -20, 20, 45]) for (const sz of [-1, 1]) fig.push({ x, z: sz * (W / 2 + 5.6), face: sz > 0 ? 0 : Math.PI, kind: 'steward' });
  for (const sx of [-1, 1]) for (const z of [-22, 22]) fig.push({ x: sx * (L / 2 + 5.8), z, face: sx > 0 ? Math.PI / 2 : -Math.PI / 2, kind: 'steward' });
  for (const sx of [-3.2, 3.2]) fig.push({ x: sx, z: mz * (W / 2 + 6.5), face: mz > 0 ? 0 : Math.PI, kind: 'steward' });
  const n = fig.length;
  const body = new THREE.BoxGeometry(0.46, 1, 0.28); body.translate(0, 0.5, 0);
  const head = new THREE.IcosahedronGeometry(0.12, 1);
  const camG = new THREE.BoxGeometry(0.28, 0.26, 0.55);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const bodies = new THREE.InstancedMesh(body, mat, n), heads = new THREE.InstancedMesh(head, mat, n);
  const cams = new THREE.InstancedMesh(camG, new THREE.MeshStandardMaterial({ color: '#202329', roughness: 0.5, metalness: 0.3 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  fig.forEach((f, k) => {
    const h = f.kind === 'photo' ? 0.82 : f.kind === 'cam' ? 1.42 : 1.48;
    q.setFromAxisAngle(up, f.face);
    bodies.setMatrixAt(k, m.compose(p.set(f.x, 0, f.z), q, s.set(1, h, 1)));
    heads.setMatrixAt(k, m.compose(p.set(f.x, h + 0.14, f.z), q, s.set(1, 1, 1)));
    bodies.setColorAt(k, c.set(f.kind === 'steward' ? '#d8e21f' : f.kind === 'photo' ? '#2a2f38' : '#1d2129'));
    heads.setColorAt(k, c.set(['#d9a782', '#b98563', '#8a5a3c'][k % 3]));
    if (f.kind === 'steward') cams.setMatrixAt(k, hide);
    else {
      const off = new THREE.Vector3(0, 0, 0.32).applyQuaternion(q);
      cams.setMatrixAt(k, m.compose(p.set(f.x + off.x, h * (f.kind === 'photo' ? 0.95 : 1.02), f.z + off.z), q, s.set(f.kind === 'photo' ? 0.6 : 1, f.kind === 'photo' ? 0.6 : 1, f.kind === 'photo' ? 0.7 : 1)));
    }
  });
  const group = new THREE.Group();
  for (const im of [bodies, heads, cams]) { im.castShadow = true; im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; group.add(im); }
  // trépieds des caméras (tubes fins)
  const legG = new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5);
  const legs = new THREE.InstancedMesh(legG, cams.material as THREE.Material, n * 3);
  let li = 0;
  fig.forEach((f) => {
    if (f.kind !== 'cam') return;
    for (let a = 0; a < 3; a++) {
      const ang = f.face + (a * Math.PI * 2) / 3;
      const e = new THREE.Euler(Math.sin(ang) * 0.25, 0, Math.cos(ang) * 0.25);
      const off = new THREE.Vector3(0, 0, 0.32).applyAxisAngle(up, f.face);
      legs.setMatrixAt(li++, m.compose(p.set(f.x + off.x + Math.sin(ang) * 0.18, 0.7, f.z + off.z + Math.cos(ang) * 0.18), new THREE.Quaternion().setFromEuler(e), s.set(1, 1, 1)));
    }
  });
  legs.count = li; legs.instanceMatrix.needsUpdate = true; legs.frustumCulled = false;
  group.add(legs);
  // table du quatrième arbitre, entre les deux bancs
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.75, 0.6), new THREE.MeshStandardMaterial({ color: '#2b3340', roughness: 0.6 }));
  desk.position.set(0, 0.375, mz * (W / 2 + 2.6));
  desk.castShadow = true;
  group.add(desk);
  return {
    group,
    dispose() { [body, head, camG, legG, mat, cams.material as THREE.Material, desk.geometry, desk.material as THREE.Material].forEach((d) => d.dispose()); [bodies, heads, cams, legs].forEach((x) => x.dispose()); },
  };
}
