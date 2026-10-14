import * as THREE from 'three';
import type { VenueModel } from '../venue/model';

/**
 * Carte d'abri vue de dessus : hauteur (m) de la plus haute surface couvrante (toit ou dessous d'un niveau supérieur)
 * pour chaque point du plan. Sert à la pluie (aucune goutte sous un toit), à l'humidité et aux explications.
 */
export interface RoofMask {
  texture: THREE.DataTexture;
  /** Demi-étendue couverte (m), centrée sur le rond central. */
  ext: number;
  size: number;
  data: Float32Array;
  heightAt(x: number, z: number): number;
}

const MAXH = 100;

export function buildRoofMask(v: VenueModel, size = 512): RoofMask {
  const ext = Math.max(v.bounds.maxX, v.bounds.maxZ) + 20;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighten';
  const P = (x: number, z: number): [number, number] => [((x + ext) / (2 * ext)) * size, ((z + ext) / (2 * ext)) * size];
  const band = (st: VenueModel['stands'][number], dA: number, dB: number, h: number) => {
    const lv = Math.max(0, Math.min(255, Math.round((h / MAXH) * 255)));
    g.fillStyle = `rgb(${lv},${lv},${lv})`;
    const n = Math.max(1, Math.ceil((st.s1 - st.s0) / 2));
    for (let k = 0; k < n; k++) {
      const a = st.curve.at(st.s0 + ((st.s1 - st.s0) * k) / n), b = st.curve.at(st.s0 + ((st.s1 - st.s0) * (k + 1)) / n);
      const q = [P(a.x + a.nx * dA, a.z + a.nz * dA), P(b.x + b.nx * dA, b.z + b.nz * dA), P(b.x + b.nx * dB, b.z + b.nz * dB), P(a.x + a.nx * dB, a.z + a.nz * dB)];
      g.beginPath(); g.moveTo(q[0][0], q[0][1]);
      for (let j = 1; j < 4; j++) g.lineTo(q[j][0], q[j][1]);
      g.closePath(); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 1; g.stroke();
    }
  };
  for (const st of v.stands) {
    if (st.roof) band(st, st.roof.cover, st.roof.backD + 0.5, Math.min(st.roof.frontH, st.roof.backH));
    for (let t = 1; t < st.tiers.length; t++) {
      const up = st.tiers[t];
      band(st, up.d0, up.dEnd + 0.4, up.h0 - 1.2);
    }
  }
  const px = g.getImageData(0, 0, size, size).data;
  const data = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) data[i] = (px[i * 4] / 255) * MAXH;
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return {
    texture, ext, size, data,
    heightAt(x: number, z: number) {
      const u = Math.floor(((x + ext) / (2 * ext)) * size), w = Math.floor(((z + ext) / (2 * ext)) * size);
      if (u < 0 || w < 0 || u >= size || w >= size) return 0;
      return data[w * size + u];
    },
  };
}
