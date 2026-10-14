import * as THREE from 'three';
import type { VenueModel } from '../venue/model';

export type SeatColorMode = 'stand' | 'view' | 'price' | 'value' | 'avail' | 'sun' | 'atmo' | 'rain';

// Palette séquentielle lisible par les daltoniens (type viridis).
const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'].map((c) => new THREE.Color(c));
export const RAMP_CSS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
const LUT = Array.from({ length: 101 }, (_, k) => {
  const x = (k / 100) * (RAMP.length - 1), i = Math.min(Math.floor(x), RAMP.length - 2);
  return RAMP[i].clone().lerp(RAMP[i + 1], x - i);
});

/** Siège = 3 quadrilatères (assise, nez, dossier) : 6 triangles. Le spectateur regarde -Z local. */
function seatGeometry() {
  const q = (a: number[], b: number[], c: number[], d: number[], n: number[]) => [a, b, c, a, c, d].map((v) => [...v, ...n]);
  const v = [
    ...q([-0.22, 0.45, -0.2], [0.22, 0.45, -0.2], [0.22, 0.45, 0.18], [-0.22, 0.45, 0.18], [0, 1, 0]),
    ...q([-0.22, 0.38, -0.2], [0.22, 0.38, -0.2], [0.22, 0.45, -0.2], [-0.22, 0.45, -0.2], [0, 0, -1]),
    ...q([-0.22, 0.45, 0.19], [0.22, 0.45, 0.19], [0.22, 0.88, 0.25], [-0.22, 0.88, 0.25], [0, 0.14, -1]),
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((x) => x.slice(0, 3)), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(v.flatMap((x) => x.slice(3)), 3));
  return g;
}

export class SeatLayer {
  mesh: THREE.InstancedMesh;
  readonly uniforms = { uFocusSec: { value: -1 }, uDim: { value: 0.38 }, uExplode: { value: 0 }, uWet: { value: 0 } };
  private base: Float32Array;
  private colors: THREE.InstancedBufferAttribute;
  private marks = new Map<number, THREE.Color>();
  private accent = new THREE.Color('#FF5A36');

  constructor(private v: VenueModel) {
    const geo = seatGeometry();
    const N = v.count;
    const aSec = new Float32Array(N), aTier = new Float32Array(N);
    for (let i = 0; i < N; i++) { aSec[i] = v.section[i]; aTier[i] = v.tier[i]; }
    geo.setAttribute('aSec', new THREE.InstancedBufferAttribute(aSec, 1));
    geo.setAttribute('aTier', new THREE.InstancedBufferAttribute(aTier, 1));
    geo.setAttribute('aCovered', new THREE.InstancedBufferAttribute(new Float32Array(N), 1));
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSec; attribute float aTier; attribute float aCovered; uniform float uFocusSec; uniform float uDim; uniform float uExplode; uniform float uWet; varying float vDim;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += aTier * uExplode;\nvDim = ((uFocusSec >= 0.0 && abs(aSec - uFocusSec) > 0.5) ? uDim : 1.0) * (1.0 - uWet * 0.3 * (1.0 - aCovered));');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDim;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vDim;');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      q.setFromAxisAngle(up, Math.atan2(v.nx[i], v.nz[i]));
      m.compose(p.set(v.px[i], v.py[i], v.pz[i]), q, one);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.base = new Float32Array(N * 3);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.mesh.instanceColor = this.colors;
    this.mesh.frustumCulled = false;
  }

  setAccent(hex: string) { this.accent.set(hex); }

  /** Places abritées (toit ou niveau supérieur) : elles restent sèches sous la pluie. */
  setCovered(covered: Uint8Array) {
    const a = this.mesh.geometry.getAttribute('aCovered') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < covered.length; i++) (a.array as Float32Array)[i] = covered[i];
    a.needsUpdate = true;
  }

  /** Couleurs de base (palette de la tribune) ou carte de chaleur. */
  paint(mode: SeatColorMode, data: { metric?: Float32Array; avail?: Uint8Array; min?: number; max?: number }) {
    const v = this.v, N = v.count, c = new THREE.Color(), c2 = new THREE.Color();
    const pal = v.stands.map((s) => [new THREE.Color(s.colors[0]), new THREE.Color(s.colors[1])]);
    for (let i = 0; i < N; i++) {
      if (mode === 'stand') {
        const sec = v.sections[v.section[i]];
        const [a, b] = pal[v.stand[i]];
        // motif discret : rangées alternées dans les virages, sections alternées ailleurs
        const alt = sec.hospitality ? 1 : (v.stands[v.stand[i]].kind === 'home' ? (v.row[i] >> 2) % 2 : sec.indexInStand % 2) === 1;
        c.copy(alt ? b : a);
        if (sec.hospitality) c2.set('#2a2a2e'), c.lerp(c2, 0.55);
        if (v.pmr[i]) c.set('#2f7de1');
        const k = 0.9 + ((i * 2654435761) % 1000) / 1000 * 0.18;
        c.multiplyScalar(k);
      } else if (mode === 'avail') {
        c.set(data.avail![i] ? '#3fd6a2' : '#2b3038');
      } else {
        let x = data.metric![i];
        if (data.min !== undefined && data.max !== undefined) x = ((x - data.min) / (data.max - data.min || 1)) * 100;
        c.copy(LUT[Math.max(0, Math.min(100, Math.round(x)))]);
        if (data.avail && !data.avail[i]) c.multiplyScalar(0.32);
      }
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
    }
    this.colors.array.set(this.base);
    this.marks.forEach((col, i) => this.writeColor(i, col));
    this.colors.clearUpdateRanges();
    this.colors.needsUpdate = true;
  }

  private writeColor(i: number, col: THREE.Color) {
    const a = this.colors.array as Float32Array;
    a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b;
  }

  /** Marquage d'un siège (sélection, candidat, comparaison) avec mise à jour partielle du buffer. */
  mark(i: number, kind: 'selected' | 'candidate' | 'compare' | null) {
    if (i < 0) return;
    const a = this.colors.array as Float32Array;
    if (kind === null) {
      this.marks.delete(i);
      a[i * 3] = this.base[i * 3]; a[i * 3 + 1] = this.base[i * 3 + 1]; a[i * 3 + 2] = this.base[i * 3 + 2];
    } else {
      const col = kind === 'selected' ? this.accent.clone() : kind === 'compare' ? new THREE.Color('#38c6ff') : new THREE.Color('#ffffff');
      this.marks.set(i, col);
      this.writeColor(i, col);
    }
    this.colors.addUpdateRange(i * 3, 3);
    this.colors.needsUpdate = true;
  }

  clearMarks() { [...this.marks.keys()].forEach((i) => this.mark(i, null)); }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

export function rampColor(x: number) { return LUT[Math.max(0, Math.min(100, Math.round(x)))]; }
