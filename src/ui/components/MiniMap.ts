import type { VenueModel } from '../../venue/model';
import type * as THREE from 'three';

/**
 * Mini-carte : plan du stade vu de dessus, section courante, place, place comparée et cône de vision.
 * Redessinée au plus 8 fois par seconde, uniquement si la caméra a bougé.
 */
export class MiniMap {
  private ctx: CanvasRenderingContext2D;
  private polys: Array<{ sec: number; pts: Array<[number, number]> }> = [];
  private v: VenueModel | null = null;
  private scale = 1;
  private last = '';
  private timer = 0;
  state = { section: -1, seat: -1, compare: -1, hover: -1 };
  onPick: (section: number) => void = () => {};

  constructor(readonly root: HTMLElement, private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('click', (e) => {
      if (!this.v) return;
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) - r.width / 2) / this.scale, z = ((e.clientY - r.top) - r.height / 2) / this.scale;
      let best = -1, bd = 1e9;
      for (const p of this.polys) {
        const s = this.v.sections[p.sec];
        const d = Math.hypot(s.center.x - x, s.center.z - z);
        if (d < bd) { bd = d; best = p.sec; }
      }
      if (best >= 0 && bd < 30) this.onPick(best);
    });
  }

  setVenue(v: VenueModel) {
    this.v = v;
    this.polys = v.sections.map((s) => {
      const st = v.stands[s.stand], t = st.tiers[s.tier];
      const pts: Array<[number, number]> = [];
      const n = st.straight ? 1 : 4;
      for (let k = 0; k <= n; k++) { const c = st.curve.at(s.sa + ((s.sb - s.sa) * k) / n); pts.push([c.x + c.nx * t.d0, c.z + c.nz * t.d0]); }
      for (let k = n; k >= 0; k--) { const c = st.curve.at(s.sa + ((s.sb - s.sa) * k) / n); pts.push([c.x + c.nx * t.dEnd, c.z + c.nz * t.dEnd]); }
      return { sec: s.idx, pts };
    });
    this.last = '';
  }

  /** Appelé à chaque image ; ne redessine que si nécessaire. */
  tick(dt: number, cam: THREE.PerspectiveCamera, target: THREE.Vector3) {
    this.timer += dt;
    if (this.timer < 0.12 || !this.v || this.root.classList.contains('off')) return;
    this.timer = 0;
    const key = `${cam.position.x.toFixed(0)},${cam.position.z.toFixed(0)},${target.x.toFixed(0)},${target.z.toFixed(0)},${JSON.stringify(this.state)},${this.canvas.clientWidth}`;
    if (key === this.last) return;
    this.last = key;
    this.draw(cam, target);
  }

  draw(cam: THREE.PerspectiveCamera, target: THREE.Vector3) {
    const v = this.v!, c = this.ctx;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(W * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const ext = Math.max(v.bounds.maxX / (W / 2 - 6), v.bounds.maxZ / (H / 2 - 6));
    this.scale = 1 / ext;
    const P = (x: number, z: number): [number, number] => [W / 2 + x / ext, H / 2 + z / ext];
    // pelouse
    const [px0, pz0] = P(-v.pitch.length / 2, -v.pitch.width / 2), [px1, pz1] = P(v.pitch.length / 2, v.pitch.width / 2);
    c.fillStyle = '#1f5a2c'; c.fillRect(px0, pz0, px1 - px0, pz1 - pz0);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.75; c.strokeRect(px0, pz0, px1 - px0, pz1 - pz0);
    c.beginPath(); c.moveTo((px0 + px1) / 2, pz0); c.lineTo((px0 + px1) / 2, pz1); c.stroke();
    const S = this.state;
    for (const p of this.polys) {
      const s = v.sections[p.sec];
      c.beginPath();
      p.pts.forEach(([x, z], k) => { const [a, b] = P(x, z); if (k) c.lineTo(a, b); else c.moveTo(a, b); });
      c.closePath();
      const sel = p.sec === S.section, hov = p.sec === S.hover;
      c.fillStyle = sel ? 'rgba(255,255,255,0.9)' : hov ? 'rgba(255,255,255,0.45)' : s.away ? 'rgba(160,170,185,0.32)' : 'rgba(170,185,205,0.22)';
      c.fill();
    }
    const dot = (i: number, color: string, r: number) => {
      if (i < 0) return;
      const [a, b] = P(v.px[i], v.pz[i]);
      c.beginPath(); c.arc(a, b, r + 1.5, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill();
      c.beginPath(); c.arc(a, b, r, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    };
    const accent = getComputedStyle(this.root).getPropertyValue('--accent').trim() || '#ff5a36';
    dot(S.compare, '#4cc9ff', 3);
    dot(S.seat, accent, 3.5);
    // cône de vision
    const [cx, cz] = P(cam.position.x, cam.position.z);
    const dir = Math.atan2(target.z - cam.position.z, target.x - cam.position.x);
    const half = ((cam.fov * cam.aspect) / 2) * (Math.PI / 180) * 0.75;
    const inside = Math.abs(cam.position.x) < v.bounds.maxX * 1.2 && Math.abs(cam.position.z) < v.bounds.maxZ * 1.2;
    if (inside) {
      const g = c.createRadialGradient(cx, cz, 0, cx, cz, 46);
      g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(cx, cz); c.arc(cx, cz, 46, dir - half, dir + half); c.closePath(); c.fill();
      c.beginPath(); c.arc(cx, cz, 2.5, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
    }
    // nord géographique (orientation réelle du terrain)
    const o = (v.cfg.orientationDeg * Math.PI) / 180, nx = -Math.sin(o), nz = -Math.cos(o);
    const ax = W - 11, az = 12;
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(ax - nx * 6, az - nz * 6); c.lineTo(ax + nx * 6, az + nz * 6); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.font = '600 8px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', ax + nx * 10.5, az + nz * 10.5);
  }
}
