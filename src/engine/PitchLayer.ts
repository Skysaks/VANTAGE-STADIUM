import * as THREE from 'three';
import type { VenueModel } from '../venue/model';

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pelouse, tracés, buts, drapeaux de coin, zones techniques, tunnel, piste éventuelle, panneaux LED. */
export class PitchLayer {
  group = new THREE.Group();
  grassMat: THREE.MeshStandardMaterial;
  private flags: THREE.Mesh[] = [];
  private nets: THREE.Mesh[] = [];
  private ledTex: THREE.CanvasTexture;
  private ledCanvas: HTMLCanvasElement;
  private disposables: Array<{ dispose(): void }> = [];
  netKick = 0;

  constructor(v: VenueModel, renderer: THREE.WebGLRenderer) {
    const L = v.pitch.length, W = v.pitch.width, R = v.pitch.runoff;
    const TL = L + 2 * R, TW = W + 2 * R;
    const sc = 2048 / TL;
    const grass = canvasTex(2048, Math.round(TW * sc), (c) => {
      const H = Math.round(TW * sc);
      c.fillStyle = '#2f6a2c'; c.fillRect(0, 0, 2048, H);
      const bands = 18, bx = (L * sc) / bands, x0 = R * sc;
      for (let b = -2; b < bands + 2; b++) { c.fillStyle = b % 2 ? '#356f30' : '#3d7c36'; c.fillRect(x0 + b * bx, 0, bx + 1, H); }
      for (let k = 0; k < 9000; k++) {
        c.fillStyle = `rgba(${20 + Math.random() * 40},${60 + Math.random() * 50},${20 + Math.random() * 20},0.08)`;
        c.fillRect(Math.random() * 2048, Math.random() * H, 2, 2);
      }
      const X = (m: number) => (m + TL / 2) * sc, Y = (m: number) => (m + TW / 2) * sc;
      c.strokeStyle = 'rgba(255,255,255,0.93)'; c.fillStyle = 'rgba(255,255,255,0.93)';
      c.lineWidth = 0.12 * sc;
      c.strokeRect(X(-L / 2), Y(-W / 2), L * sc, W * sc);
      c.beginPath(); c.moveTo(X(0), Y(-W / 2)); c.lineTo(X(0), Y(W / 2)); c.stroke();
      c.beginPath(); c.arc(X(0), Y(0), 9.15 * sc, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(X(0), Y(0), 0.25 * sc, 0, Math.PI * 2); c.fill();
      for (const sg of [-1, 1]) {
        const gx = (L / 2) * sg;
        const rect = (dx: number, hw: number) => c.strokeRect(X(Math.min(gx, gx - dx * sg)), Y(-hw), dx * sc, 2 * hw * sc);
        rect(16.5, 20.16); rect(5.5, 9.16);
        c.beginPath(); c.arc(X(gx - 11 * sg), Y(0), 0.25 * sc, 0, Math.PI * 2); c.fill();
        const a = Math.acos(5.5 / 9.15);
        c.beginPath(); c.arc(X(gx - 11 * sg), Y(0), 9.15 * sc, sg > 0 ? Math.PI - a : -a, sg > 0 ? Math.PI + a : a); c.stroke();
        for (const sz of [-1, 1]) {
          c.beginPath();
          const a0 = sg > 0 ? (sz > 0 ? Math.PI : Math.PI / 2) : sz > 0 ? 1.5 * Math.PI : 0;
          c.arc(X(gx), Y((W / 2) * sz), 1 * sc, a0, a0 + Math.PI / 2); c.stroke();
        }
      }
      // zones techniques (§90) : rectangles en pointillés devant les bancs, côté tribune principale
      const main = v.stands.find((st) => st.kind === 'main') ?? v.stands[0];
      const mzz = main.side === 'N' ? -1 : 1;
      c.setLineDash([0.5 * sc, 0.35 * sc]);
      c.lineWidth = 0.1 * sc;
      for (const sx of [-1, 1]) {
        const x0 = sx * 13 - 5.2, z0 = mzz > 0 ? W / 2 + 1 : -(W / 2 + 4.6);
        c.strokeRect(X(x0), Y(z0), 10.4 * sc, 3.6 * sc);
      }
      c.setLineDash([]);
    });
    grass.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.grassMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.92, metalness: 0 });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(TL, TW), this.grassMat);
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true;
    this.group.add(pitch);
    this.disposables.push(grass, this.grassMat, pitch.geometry);

    // Sol entre la pelouse et les tribunes, puis extérieur.
    const apronMat = new THREE.MeshStandardMaterial({ color: '#27452b', roughness: 1 });
    // contour = bord intérieur réel des tribunes (+2 m sous les gradins) : pas de débord sous la façade
    const ring: THREE.Vector2[] = [];
    for (const st of v.stands) {
      const d = st.tiers[0].d0 + 2;
      for (let k = 0; k <= 24; k++) { const c = st.curve.at(st.s0 + ((st.s1 - st.s0) * k) / 24); ring.push(new THREE.Vector2(c.x + c.nx * d, -(c.z + c.nz * d))); }
    }
    const apron = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(ring)), apronMat);
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.03; apron.receiveShadow = true;
    this.group.add(apron);
    // l'extérieur (parvis, abords) est dessiné par Surroundings : pas de second plan coplanaire (z-fighting)
    this.disposables.push(apronMat, apron.geometry);

    if (v.cfg.track) {
      const st = 42.2, r0 = 36.5, r1 = 36.5 + 9.76;
      const loop = (r: number) => {
        const s = new THREE.Shape();
        s.moveTo(st, r); s.lineTo(-st, r);
        s.absarc(-st, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
        s.lineTo(st, -r);
        s.absarc(st, 0, r, -Math.PI / 2, Math.PI / 2, false);
        return s;
      };
      const outer = loop(r1); outer.holes.push(loop(r0));
      const tg = new THREE.ShapeGeometry(outer, 48);
      tg.rotateX(Math.PI / 2);
      const tm = new THREE.MeshStandardMaterial({ color: '#a8432c', roughness: 0.9 });
      const track = new THREE.Mesh(tg, tm);
      track.position.y = 0.01; track.receiveShadow = true;
      this.group.add(track);
      const lines = new THREE.Group();
      const lm = new THREE.LineBasicMaterial({ color: '#f0e6dc', transparent: true, opacity: 0.6 });
      for (let k = 1; k < 8; k++) {
        const pts = loop(r0 + k * 1.22).getPoints(64).map((p) => new THREE.Vector3(p.x, 0.02, p.y));
        lines.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lm));
      }
      this.group.add(lines);
      this.disposables.push(tg, tm, lm);
    }

    // Buts et filets
    const white = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4 });
    const netTex = canvasTex(128, 128, (c) => {
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2;
      for (let i = 0; i <= 128; i += 12) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(128, i); c.stroke(); }
    });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.repeat.set(6, 3);
    const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    this.disposables.push(white, netTex, netMat);
    for (const sg of [-1, 1]) {
      const g = new THREE.Group();
      const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 10);
      for (const z of [-3.66, 3.66]) { const m = new THREE.Mesh(post, white); m.position.set(0, 1.22, z); m.castShadow = true; g.add(m); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.44, 10), white);
      bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; bar.castShadow = true; g.add(bar);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44, 8, 4), netMat);
      back.rotation.y = Math.PI / 2; back.position.set(sg * 2, 1.22, 0);
      back.userData = { base: sg * 2, sg };
      const top = new THREE.Mesh(new THREE.PlaneGeometry(2, 7.32), netMat);
      top.rotation.x = -Math.PI / 2; top.position.set(sg * 1, 2.44, 0);
      const sideA = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.44), netMat);
      sideA.position.set(sg * 1, 1.22, -3.66);
      const sideB = sideA.clone(); sideB.position.z = 3.66;
      g.add(back, top, sideA, sideB);
      this.nets.push(back);
      g.position.x = sg * (L / 2);
      this.group.add(g);
    }

    // Drapeaux de coin
    const flagMat = new THREE.MeshStandardMaterial({ color: '#ffd43b', side: THREE.DoubleSide, roughness: 0.7 });
    const poleMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2' });
    this.disposables.push(flagMat, poleMat);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), poleMat);
      pole.position.set(sx * L / 2, 0.75, sz * W / 2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3, 4, 1), flagMat);
      flag.geometry.translate(0.21, 0, 0);
      flag.position.set(sx * L / 2, 1.35, sz * W / 2);
      this.flags.push(flag);
      this.group.add(pole, flag);
    }

    // Zones techniques et tunnel, côté tribune principale
    const main = v.stands.find((s) => s.kind === 'main') ?? v.stands[0];
    const mz = main.side === 'N' ? -1 : 1;
    const benchMat = new THREE.MeshStandardMaterial({ color: '#1d2633', roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: '#9fb6c9', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 });
    this.disposables.push(benchMat, glass);
    for (const sx of [-1, 1]) {
      const b = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 1), benchMat); seat.position.y = 0.45;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.1, 2.2), glass); roof.position.set(0, 2.1, -0.3 * mz);
      const backG = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.9, 0.08), glass); backG.position.set(0, 1.15, 0.8 * mz);
      b.add(seat, roof, backG);
      b.position.set(sx * 13, 0, mz * (W / 2 + 3.6));
      this.group.add(b);
    }
    // auvent bas (1,3 m) : visible, mais ne coupe pas la ligne de touche depuis les rangs centraux
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.3, 3.4), new THREE.MeshStandardMaterial({ color: '#4a525d', roughness: 0.55, metalness: 0.2 }));
    tunnel.position.set(0, 0.65, mz * (Math.abs(main.curve.at((main.s0 + main.s1) / 2).z) - 1.9));
    this.group.add(tunnel);
    this.disposables.push(tunnel.geometry, tunnel.material as THREE.Material);

    // Panneaux LED (texture défilante, contenu configurable)
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 2048; this.ledCanvas.height = 64;
    this.ledTex = new THREE.CanvasTexture(this.ledCanvas);
    this.ledTex.colorSpace = THREE.SRGBColorSpace;
    this.ledTex.wrapS = THREE.RepeatWrapping;
    const ledMat = new THREE.MeshBasicMaterial({ map: this.ledTex, toneMapped: false });
    this.disposables.push(this.ledTex, ledMat);
    const boards: Array<[number, number, number, number]> = [
      [0, W / 2 + 4.2, L - 6, Math.PI], [0, -(W / 2 + 4.2), L - 6, 0],
      [L / 2 + 4.5, 0, W - 4, -Math.PI / 2], [-(L / 2 + 4.5), 0, W - 4, Math.PI / 2],
    ];
    for (const [x, z, len, ry] of boards) {
      const geo = new THREE.PlaneGeometry(len, 0.95);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / 24));
      const m = new THREE.Mesh(geo, ledMat);
      m.position.set(x, 0.5, z); m.rotation.y = ry;
      this.group.add(m);
      this.disposables.push(geo);
    }
  }

  setLed(messages: string[], colors: string[]) {
    const c = this.ledCanvas.getContext('2d')!;
    c.fillStyle = '#05070b'; c.fillRect(0, 0, 2048, 64);
    c.font = '800 34px Inter, system-ui, sans-serif'; c.textBaseline = 'middle';
    let x = 30, k = 0;
    while (x < 2048) {
      const t = messages[k % messages.length];
      c.fillStyle = colors[k % colors.length];
      c.fillText(t, x, 34);
      x += c.measureText(t).width + 80; k++;
    }
    this.ledTex.needsUpdate = true;
  }

  setWet(w: number) {
    this.grassMat.roughness = 0.92 - w * 0.55;
    this.grassMat.color.setScalar(1 - w * 0.22);
  }

  update(dt: number, t: number) {
    this.ledTex.offset.x = (t * 0.035) % 1;
    for (let k = 0; k < this.flags.length; k++) this.flags[k].rotation.y = Math.sin(t * 2.1 + k) * 0.35 + 0.4;
    if (this.netKick > 0) {
      this.netKick = Math.max(0, this.netKick - dt);
      const k = Math.sin(this.netKick * 20) * this.netKick * 0.5;
      for (const n of this.nets) n.position.x = n.userData.base + n.userData.sg * k;
    }
  }

  dispose() { this.disposables.forEach((d) => d.dispose()); }
}
