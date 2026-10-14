import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VenueModel } from '../venue/model';

// Abords du stade : parvis, routes ou parc, arbres et bâtiments. Tout est procédural et déterministe :
// la vue d'ensemble se lit comme un lieu réel, sans aucun actif externe.

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

export class Surroundings {
  group = new THREE.Group();
  groundMat: THREE.MeshStandardMaterial;
  private windowMat: THREE.MeshStandardMaterial | null = null;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(v: VenueModel, quality: 'full' | 'lite' = 'full') {
    const kind = v.cfg.style.surroundings;
    const ext = Math.max(v.bounds.maxX, v.bounds.maxZ);
    const R = rng(v.cfg.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483646 + 1);
    const SIZE = 1400, PX = 2048;
    const cv = document.createElement('canvas');
    cv.width = cv.height = PX;
    const g = cv.getContext('2d')!;
    const k = PX / SIZE;
    const W = (x: number) => (x + SIZE / 2) * k;
    const base = kind === 'urban' ? '#3a3d40' : kind === 'suburban' ? '#4a5a3a' : '#3f5f35';
    g.fillStyle = base; g.fillRect(0, 0, PX, PX);
    // texture d'herbe ou d'asphalte
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = kind === 'urban' ? `rgba(255,255,255,${R() * 0.025})` : `rgba(${20 + R() * 40},${50 + R() * 40},${20 + R() * 20},0.25)`;
      g.fillRect(R() * PX, R() * PX, 2 + R() * 6, 2 + R() * 6);
    }
    // routes
    g.strokeStyle = '#2a2c2f'; g.lineCap = 'round';
    const roads = kind === 'urban' ? [-420, -250, 250, 420] : [-380, 380];
    for (const r of roads) {
      g.lineWidth = 14 * k;
      g.beginPath(); g.moveTo(W(r), 0); g.lineTo(W(r), PX); g.stroke();
      g.beginPath(); g.moveTo(0, W(r)); g.lineTo(PX, W(r)); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.4 * k; g.setLineDash([3 * k, 4 * k]);
      g.beginPath(); g.moveTo(W(r), 0); g.lineTo(W(r), PX); g.stroke();
      g.beginPath(); g.moveTo(0, W(r)); g.lineTo(PX, W(r)); g.stroke();
      g.setLineDash([]); g.strokeStyle = '#2a2c2f';
    }
    // parkings (rangées de places)
    if (kind !== 'park') {
      for (const [cx, cz] of [[-ext - 110, 0], [ext + 110, 0], [0, ext + 120]]) {
        g.fillStyle = '#2f3134'; g.fillRect(W(cx - 55), W(cz - 45), 110 * k, 90 * k);
        g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 0.25 * k;
        for (let x = -50; x < 50; x += 2.6) for (const row of [-38, -14, 10, 34]) { g.beginPath(); g.moveTo(W(cx + x), W(cz + row)); g.lineTo(W(cx + x), W(cz + row + 5)); g.stroke(); }
      }
    } else {
      // allées du parc
      g.strokeStyle = '#a49a83'; g.lineWidth = 3.5 * k;
      for (let i = 0; i < 6; i++) {
        const a = R() * Math.PI * 2;
        g.beginPath(); g.moveTo(W(Math.cos(a) * (ext + 60)), W(Math.sin(a) * (ext + 60)));
        g.quadraticCurveTo(W(Math.cos(a + 0.5) * 300), W(Math.sin(a + 0.5) * 300), W(Math.cos(a + 0.2) * 640), W(Math.sin(a + 0.2) * 640));
        g.stroke();
      }
      g.fillStyle = '#35576a';
      g.beginPath(); g.ellipse(W(-ext - 240), W(160), 90 * k, 55 * k, 0.4, 0, Math.PI * 2); g.fill();
    }
    // parvis : anneau clair autour du stade
    const plazaOut = ext + 42;
    const grd = g.createRadialGradient(W(0), W(0), ext * 0.9 * k, W(0), W(0), plazaOut * k);
    grd.addColorStop(0, '#5d6062'); grd.addColorStop(0.85, '#55585a'); grd.addColorStop(1, 'rgba(85,88,90,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(W(0), W(0), plazaOut * k * 1.05, plazaOut * k * 0.95, 0, 0, Math.PI * 2); g.fill();

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.62; ground.receiveShadow = true;
    const outerMat = new THREE.MeshStandardMaterial({ color: base, roughness: 1 });
    const outer = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.7, 6000, 32, 1), outerMat);
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.7;
    this.group.add(ground, outer);
    this.disposables.push(tex, this.groundMat, ground.geometry, outerMat, outer.geometry);

    // arbres
    const nTrees = quality === 'lite' ? 0 : kind === 'park' ? 420 : kind === 'suburban' ? 180 : 70;
    if (nTrees) {
      const crown = new THREE.IcosahedronGeometry(1, 0); crown.scale(3.2, 4.2, 3.2); crown.translate(0, 6.5, 0);
      const trunk = new THREE.CylinderGeometry(0.25, 0.35, 3.2, 5); trunk.translate(0, 1.6, 0);
      const cc = new Float32Array(crown.toNonIndexed().attributes.position.count * 3);
      const crownN = crown.toNonIndexed(); const trunkN = trunk.toNonIndexed();
      for (let i = 0; i < cc.length; i += 3) { cc[i] = 0.18; cc[i + 1] = 0.3; cc[i + 2] = 0.14; }
      crownN.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      const tc = new Float32Array(trunkN.attributes.position.count * 3).fill(0.22);
      trunkN.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      crownN.deleteAttribute('uv'); trunkN.deleteAttribute('uv');
      const tg = mergeGeometries([crownN, trunkN])!;
      const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
      this.treeMat = tm;
      const trees = new THREE.InstancedMesh(tg, tm, nTrees);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
      let placed = 0;
      for (let tries = 0; placed < nTrees && tries < nTrees * 8; tries++) {
        const a = R() * Math.PI * 2, r = plazaOut + 8 + Math.pow(R(), 0.8) * 480;
        p.set(Math.cos(a) * r * 1.05, -0.62, Math.sin(a) * r * 0.95);
        if (roads.some((rd) => Math.abs(p.x - rd) < 12 || Math.abs(p.z - rd) < 12)) continue;
        if (kind !== 'park' && [[-ext - 110, 0], [ext + 110, 0], [0, ext + 120]].some(([cx, cz]) => Math.abs(p.x - cx) < 60 && Math.abs(p.z - cz) < 50)) continue;
        const sc = 0.7 + R() * 0.8;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
        trees.setMatrixAt(placed, m.compose(p, q, s.set(sc, sc * (0.85 + R() * 0.4), sc)));
        trees.setColorAt(placed, col.setHSL(0.24 + R() * 0.08, 0.35, 0.6 + R() * 0.5));
        placed++;
      }
      trees.count = placed;
      trees.castShadow = true;
      this.group.add(trees);
      this.disposables.push(tg, tm, crown, trunk);
    }

    // bâtiments (ville, banlieue) avec fenêtres éclairées la nuit
    const nB = quality === 'lite' ? 0 : kind === 'urban' ? 110 : kind === 'suburban' ? 50 : 0;
    if (nB) {
      const wc = document.createElement('canvas'); wc.width = 64; wc.height = 128;
      const wg = wc.getContext('2d')!;
      wg.fillStyle = '#000'; wg.fillRect(0, 0, 64, 128);
      for (let y = 4; y < 128; y += 8) for (let x = 4; x < 64; x += 8) if (R() < 0.45) { wg.fillStyle = `rgb(255,${200 + R() * 40},${130 + R() * 60})`; wg.fillRect(x, y, 4, 4); }
      const wt = new THREE.CanvasTexture(wc); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(2, 3); wt.colorSpace = THREE.SRGBColorSpace;
      this.windowMat = new THREE.MeshStandardMaterial({ color: '#8f949b', roughness: 0.8, emissive: '#ffffff', emissiveMap: wt, emissiveIntensity: 0 });
      const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
      const bm = new THREE.InstancedMesh(bg, this.windowMat, nB);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
      let placed = 0;
      for (let tries = 0; placed < nB && tries < nB * 10; tries++) {
        const a = R() * Math.PI * 2, r = 300 + R() * 360;
        p.set(Math.cos(a) * r, -0.62, Math.sin(a) * r);
        if (roads.some((rd) => Math.abs(p.x - rd) < 30 || Math.abs(p.z - rd) < 30)) continue;
        const h = kind === 'urban' ? 12 + Math.pow(R(), 2) * 60 : 6 + R() * 12;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(R() * 4) * (Math.PI / 2) + (R() - 0.5) * 0.1);
        bm.setMatrixAt(placed, m.compose(p, q, s.set(18 + R() * 30, h, 14 + R() * 26)));
        bm.setColorAt(placed, col.setHSL(0.08 + R() * 0.5, 0.06, 0.45 + R() * 0.35));
        placed++;
      }
      bm.count = placed;
      bm.castShadow = true; bm.receiveShadow = true;
      this.group.add(bm);
      this.disposables.push(wt, this.windowMat, bg);
    }
  }

  /** Nuit : fenêtres allumées ; pluie : sol plus sombre et plus brillant. */
  update(night: number, wet: number) {
    if (this.windowMat) { this.windowMat.emissiveIntensity = night * 0.85; this.windowMat.color.setScalar(1 - night * 0.7); }
    this.groundMat.roughness = 0.95 - wet * 0.45;
    // la nuit, les projecteurs n'éclairent que l'intérieur du stade : les abords restent sombres
    this.groundMat.color.setScalar((1 - wet * 0.25) * (1 - night * 0.72));
    if (this.treeMat) this.treeMat.color.setScalar(1 - night * 0.75);
  }
  private treeMat: THREE.MeshStandardMaterial | null = null;

  dispose() { this.disposables.forEach((d) => d.dispose()); }
}
