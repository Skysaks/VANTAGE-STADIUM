import * as THREE from 'three';
import type { VenueModel } from '../venue/model';
import { textAtlas, atlasPlanes } from './Details';

/**
 * Numéros de sièges lisibles et marquages de rang, uniquement autour de la place occupée (§86) :
 * jamais 50 000 textures, au plus ~120 plaques instanciées, mises à jour quand la place change.
 */
export class SeatNumbers {
  readonly group = new THREE.Group();
  private planes: ReturnType<typeof atlasPlanes>;
  private atlas: ReturnType<typeof textAtlas>;
  private readonly MAX = 140;
  private seat = -1;

  constructor(private v: VenueModel) {
    // cellules 0..99 : numéros de siège ; 100..159 : « R1 » … « R60 »
    const labels = [
      ...Array.from({ length: 100 }, (_, k) => ({ text: String(k + 1), bg: '#2a2f37', fg: '#f4f6f8' })),
      ...Array.from({ length: 60 }, (_, k) => ({ text: `R${k + 1}`, bg: '#d9b23a', fg: '#14161a' })),
    ];
    this.atlas = textAtlas(labels, 48, 24);
    this.planes = atlasPlanes(this.atlas.tex, this.MAX);
    this.planes.mesh.count = 0;
    this.group.add(this.planes.mesh);
    this.group.visible = false;
  }

  /** Affiche les numéros des places voisines (rangs devant et derrière) et les marquages de rang aux allées. */
  focus(i: number) {
    if (i === this.seat) { this.group.visible = i >= 0; return; }
    this.seat = i;
    const mesh = this.planes.mesh;
    if (i < 0) { this.group.visible = false; return; }
    const v = this.v;
    const sec = v.sections[v.section[i]];
    const r0 = v.row[i];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const cell = this.planes.geo.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    let k = 0;
    const put = (pos: THREE.Vector3, quat: THREE.Quaternion, w: number, h: number, c: number) => {
      if (k >= this.MAX) return;
      m.compose(pos, quat, s.set(w, h, 1));
      mesh.setMatrixAt(k, m);
      const r = this.atlas.rects[c];
      cell.setXYZW(k, r[0], r[1], r[2], r[3]);
      k++;
    };
    // numéros au dos des sièges (lus depuis le rang de derrière), places proches seulement
    for (let r = Math.max(0, r0 - 3); r <= Math.min(sec.rows - 1, r0 + 1); r++) {
      for (let j = sec.rowStart[r]; j < sec.rowStart[r] + sec.rowCount[r]; j++) {
        if (Math.abs(v.num[j] - v.num[i]) > 9 || v.num[j] > 100) continue;
        const yaw = Math.atan2(v.nx[j], v.nz[j]);
        q.setFromAxisAngle(up, yaw);
        // dos du dossier : local (0, 0.79, 0.262), face +Z local (vers l'arrière)
        const off = new THREE.Vector3(0, 0.79, 0.262).applyQuaternion(q);
        put(p.set(v.px[j] + off.x, v.py[j] + off.y, v.pz[j] + off.z).clone(), q.clone(), 0.17, 0.085, v.num[j] - 1);
      }
    }
    // marquage de rang peint sur la marche, côté allée (deux bouts de rang)
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    for (let r = Math.max(0, r0 - 4); r <= Math.min(sec.rows - 1, r0 + 1); r++) {
      if (r >= 60) continue;
      for (const j of [sec.rowStart[r], sec.rowStart[r] + sec.rowCount[r] - 1]) {
        const yaw = Math.atan2(v.nx[j], v.nz[j]);
        q.setFromAxisAngle(up, yaw);
        const side = j === sec.rowStart[r] ? -1 : 1;
        const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        // le rang croissant va de gauche à droite vu du terrain ; on teste le côté réellement extérieur
        const other = j === sec.rowStart[r] ? j + 1 : j - 1;
        const outward = other >= 0 && Math.sign((v.px[j] - v.px[other]) * dir.x + (v.pz[j] - v.pz[other]) * dir.z) || side;
        const off = dir.multiplyScalar(outward * 0.52);
        const quat = q.clone().multiply(flat);
        put(new THREE.Vector3(v.px[j] + off.x, v.py[j] + 0.012, v.pz[j] + off.z - 0), quat, 0.36, 0.18, 100 + r);
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    cell.needsUpdate = true;
    this.group.visible = k > 0;
  }

  dispose() { this.planes.geo.dispose(); this.planes.mat.dispose(); this.atlas.tex.dispose(); this.planes.mesh.dispose(); }
}
