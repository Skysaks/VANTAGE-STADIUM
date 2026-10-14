// Courbe 2D (plan XZ) échantillonnée, paramétrée par abscisse curviligne.
// Sens de parcours : de la gauche vers la droite d'un spectateur assis face au terrain.
// Normale = vers l'extérieur du stade.

export interface CurveSample { x: number; z: number; nx: number; nz: number }

export class Curve {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly nxs: Float64Array;
  readonly nzs: Float64Array;
  readonly s: Float64Array;
  readonly length: number;

  constructor(points: Array<[number, number]>) {
    const n = points.length;
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.nxs = new Float64Array(n);
    this.nzs = new Float64Array(n);
    this.s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = points[i][0];
      this.zs[i] = points[i][1];
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = this.xs[b] - this.xs[a], tz = this.zs[b] - this.zs[a];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      this.nxs[i] = -tz;
      this.nzs[i] = tx;
      if (i > 0) this.s[i] = this.s[i - 1] + Math.hypot(this.xs[i] - this.xs[i - 1], this.zs[i] - this.zs[i - 1]);
    }
    this.length = this.s[n - 1];
  }

  /** Point et normale à l'abscisse s (interpolation linéaire, normale renormalisée). */
  at(s: number, out: CurveSample = { x: 0, z: 0, nx: 0, nz: 0 }): CurveSample {
    const S = this.s;
    const n = S.length;
    if (s <= 0) { out.x = this.xs[0]; out.z = this.zs[0]; out.nx = this.nxs[0]; out.nz = this.nzs[0]; return out; }
    if (s >= this.length) { out.x = this.xs[n - 1]; out.z = this.zs[n - 1]; out.nx = this.nxs[n - 1]; out.nz = this.nzs[n - 1]; return out; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const t = (s - S[lo]) / (S[hi] - S[lo] || 1);
    out.x = this.xs[lo] + (this.xs[hi] - this.xs[lo]) * t;
    out.z = this.zs[lo] + (this.zs[hi] - this.zs[lo]) * t;
    const nx = this.nxs[lo] + (this.nxs[hi] - this.nxs[lo]) * t;
    const nz = this.nzs[lo] + (this.nzs[hi] - this.nzs[lo]) * t;
    const l = Math.hypot(nx, nz) || 1;
    out.nx = nx / l; out.nz = nz / l;
    return out;
  }

  /** Abscisses régulièrement espacées entre s0 et s1, en incluant les ruptures demandées. */
  samples(s0: number, s1: number, step: number, breaks: number[] = []): number[] {
    const out = new Set<number>([s0, s1]);
    const k = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 1; i < k; i++) out.add(s0 + ((s1 - s0) * i) / k);
    for (const b of breaks) if (b > s0 && b < s1) out.add(b);
    return [...out].sort((a, b) => a - b);
  }
}

/** Superellipse |x/a|^n + |z/b|^n = 1, parcourue E → N → O → S en commençant à -45°. */
export function superellipse(a: number, b: number, exp: number, samples = 1440): { curve: Curve; quarters: number[] } {
  const pts: Array<[number, number]> = [];
  const sp = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / exp);
  for (let i = 0; i <= samples; i++) {
    const phi = (-45 + (360 * i) / samples) * (Math.PI / 180);
    pts.push([a * sp(Math.cos(phi)), -b * sp(Math.sin(phi))]);
  }
  const curve = new Curve(pts);
  const q = (k: number) => curve.s[Math.round((samples * k) / 4)];
  return { curve, quarters: [0, q(1), q(2), q(3), curve.length] };
}

/** Forme de piste (lignes droites + demi-cercles), parcourue E → N → O → S. */
export function trackLoop(straight: number, radius: number, step = 0.5): { curve: Curve; quarters: number[] } {
  const pts: Array<[number, number]> = [];
  const marks: number[] = [];
  const arc = (cx: number, a0: number, a1: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * Math.PI / 180 * radius) / step));
    for (let i = 0; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * (Math.PI / 180);
      pts.push([cx + radius * Math.cos(a), -radius * Math.sin(a)]);
    }
  };
  const line = (x0: number, x1: number, z: number) => {
    const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / step));
    for (let i = 1; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, z]);
  };
  arc(straight, -45, 45); marks.push(pts.length - 1);
  arc(straight, 46, 90);
  line(straight, -straight, -radius);
  arc(-straight, 90, 135); marks.push(pts.length - 1);
  arc(-straight, 136, 225); marks.push(pts.length - 1);
  arc(-straight, 226, 270);
  line(-straight, straight, radius);
  arc(straight, -90, -45);
  const curve = new Curve(pts);
  return { curve, quarters: [0, ...marks.map((i) => curve.s[i]), curve.length] };
}
