import * as THREE from 'three';
import type { RevealConfig, RevealStyle } from '../config/types';
import type { Engine } from '../engine/Engine';
import { PRODUCT } from '../config/product';

/** Surface d'interface de la révélation : voile, typographie minimale, bouton Passer, carte finale. */
export interface RevealUI {
  veil(opacity: number, ms: number): void;
  title(main: string, sub?: string, kind?: 'place' | 'event' | 'seat'): void;
  clearTitle(): void;
  skipVisible(on: boolean): void;
  finale(seat: number): void;
  haptic(ms: number): void;
}

/** Ancres sémantiques calculées depuis n'importe quel lieu (aucune coordonnée propre à un stade). */
function anchors(e: Engine, seat: number) {
  const v = e.venue!;
  const R = Math.max(v.bounds.maxX, v.bounds.maxZ);
  const sec = v.sections[v.section[seat]];
  const st = v.stands[sec.stand];
  const mid = st.curve.at((st.s0 + st.s1) / 2);
  const opp = new THREE.Vector3(-mid.x * 0.2, 0, -mid.z * 0.2);
  return {
    R,
    aerial: (a: number, k = 1.45, hk = 1.15) => new THREE.Vector3(Math.cos(a) * R * k, v.bounds.maxY + R * hk * 0.6, Math.sin(a) * R * k),
    center: new THREE.Vector3(0, 0, 0),
    pitchHigh: new THREE.Vector3(0, v.bounds.maxY * 0.45, 0),
    standFront: new THREE.Vector3(st.center.x, st.center.y, st.center.z),
    sectionView: new THREE.Vector3(sec.front.x - sec.front.nx * (24 + sec.radius), Math.min(sec.center.y + 10, st.roof ? st.roof.frontH - 3 : sec.center.y + 10), sec.front.z - sec.front.nz * (24 + sec.radius)),
    sectionCenter: new THREE.Vector3(sec.center.x, sec.center.y, sec.center.z),
    opposite: opp,
    startAngle: Math.atan2(mid.z, mid.x) + Math.PI * 0.75,
  };
}

const DURATION: Record<RevealStyle, string> = { quick: '≈ 4 s', cinematic: '≈ 10 s', epic: '≈ 12 s' };
export const revealDuration = (s: RevealStyle) => DURATION[s];

/**
 * Révélation : le stade lui-même devient l'interface (lumières, écrans géants, panneaux LED, foule, caméra),
 * avec une typographie minimale. Fonctionne pour tout lieu via des ancres sémantiques ; respecte la météo et l'heure.
 * Se termine toujours dans la vue siège.
 */
export class RevealDirector {
  playing = false;
  private skipFlag = false;
  private timers: number[] = [];
  private wake: (() => void) | null = null;

  constructor(private e: Engine, private ui: RevealUI) {}

  private wait(ms: number) {
    return new Promise<void>((res) => {
      if (this.skipFlag) return res();
      const id = window.setTimeout(() => { this.wake = null; res(); }, ms);
      this.timers.push(id);
      this.wake = () => { clearTimeout(id); res(); };
    });
  }

  skip() { if (!this.playing) return; this.skipFlag = true; this.wake?.(); }

  async play(cfg: RevealConfig, seat: number, opts: { cityLabel?: string } = {}): Promise<void> {
    const e = this.e, d = e.director, v = e.venue!, ev = e.event;
    this.playing = true; this.skipFlag = false;
    const A = anchors(e, seat);
    const night = e.env.live.daylight < 0.5;
    const sec = v.sections[v.section[seat]];
    const st = v.stands[sec.stand];
    const row = v.row[seat] + 1, num = v.num[seat];
    const style = cfg.style;
    d.enterReveal();
    this.ui.skipVisible(true);
    e.hideCrowdAt(seat);
    const lit = () => { e.env.sequence = null; };
    const path = (pts: THREE.Vector3[], looks: THREE.Vector3[], ms: number, fov?: number) => new Promise<void>((res) => {
      if (this.skipFlag) return res();
      d.path(pts, looks, ms, { fov, onDone: () => res() });
      this.wake = () => { res(); };
    });
    try {
      // 0 — noir, stade éteint (la nuit), foule absente
      this.ui.veil(1, 0);
      if (night && style !== 'quick') e.env.sequence = 0;
      if (style !== 'quick' && e.crowd) e.crowd.mesh.visible = false;
      e.screens?.show({ mode: 'off' });
      const a0 = A.startAngle;
      d.path([A.aerial(a0, 1.7, 1.5)], [A.center], 0, { fov: 40 });
      await this.wait(style === 'quick' ? 150 : 350);

      if (style === 'quick') {
        this.ui.veil(0, 500);
        this.ui.title(ev.home.name + ' – ' + ev.away.name, ev.competition, 'event');
        await path([A.aerial(a0 + 0.4, 1.2, 0.9), A.sectionView], [A.center, A.sectionCenter], 1500, 40);
      } else {
        // 1 — le lieu : dérive aérienne, ville puis stade
        this.ui.veil(0, 900);
        this.ui.title((opts.cityLabel ?? v.cfg.city).toUpperCase(), v.cfg.country, 'place');
        const p1 = path([A.aerial(a0 + 0.35, 1.55, 1.3), A.aerial(a0 + 0.7, 1.4, 1.1)], [A.center, A.center], 2300, 40);
        await this.wait(1100);
        e.screens?.show({ mode: 'welcome', brand: PRODUCT.name, venue: v.cfg.name });
        this.ui.title(v.cfg.name.toUpperCase(), v.cfg.label, 'place');
        await p1;
        // 2 — lumière : rampes allumées l'une après l'autre (nuit) ou éclair (jour), la foule apparaît
        if (night) {
          const banks = e.stadium?.lampBanks.length ?? 4;
          for (let k = 1; k <= banks && !this.skipFlag; k++) { e.env.sequence = k; e.env.pulse(); this.ui.haptic(15); await this.wait(Math.max(160, 1400 / banks)); }
        } else e.env.pulse();
        lit();
        if (e.crowd) e.crowd.mesh.visible = true;
        e.crowd && (e.crowd.goalTarget = 0.6);
        // 3 — l'événement : écrans et panneaux LED
        const s1 = e.players?.score ?? { home: 0, away: 0 };
        e.screens?.show({ mode: 'score', home: ev.home.short, away: ev.away.short, hs: s1.home, as: s1.away, minute: ev.competition.toUpperCase(), homeColor: ev.home.kit, awayColor: ev.away.kit });
        e.pitch?.setLed([`${ev.home.name.toUpperCase()} – ${ev.away.name.toUpperCase()}`, ev.competition.toUpperCase()], ['#ffffff', PRODUCT.theme.accent]);
        this.ui.title(`${ev.home.name} – ${ev.away.name}`, ev.competition, 'event');
        await path([A.aerial(a0 + 1.0, 1.1, 0.75), A.pitchHigh.clone().add(new THREE.Vector3(A.R * 0.15, 6, 0))], [A.center, A.standFront], 2000, 44);
        if (e.crowd) e.crowd.goalTarget = 0;
        // 4 — la zone : tribune puis section
        this.ui.title(st.name.toUpperCase(), `Section ${sec.code}`, 'place');
        e.screens?.show({ mode: 'message', title: `SECTION ${sec.code}`, sub: st.name.toUpperCase() });
        await path([A.sectionView], [A.sectionCenter], 1700, 40);
        this.ui.title(`Rang ${row}`, `Section ${sec.code}`, 'seat');
        e.pitch?.setLed([`VOTRE PLACE · RANG ${row} · PLACE ${num}`], [PRODUCT.theme.accent]);
        await this.wait(500);
      }
      // 5 — la place : approche finale, arrivée dans la vue siège
      this.ui.clearTitle();
      if (!this.skipFlag) {
        await new Promise<void>((res) => { d.approachSeat(seat, () => res()); this.wake = () => res(); });
      }
    } finally {
      this.timers.forEach(clearTimeout); this.timers = [];
      lit();
      if (e.crowd) { e.crowd.mesh.visible = true; e.crowd.goalTarget = 0; }
      this.ui.veil(0, this.skipFlag ? 250 : 0);
      d.cancel();
      d.settleInSeat(seat);
      e.hideCrowdAt(seat);
      e.screens?.show({ mode: 'message', title: `RANG ${row} · PLACE ${num}`, sub: `SECTION ${sec.code}` });
      if (style === 'epic' && !this.skipFlag) { e.crowd && (e.crowd.goalTarget = 1); this.spawnConfetti(); window.setTimeout(() => { if (e.crowd) e.crowd.goalTarget = 0; }, 2600); }
      this.ui.skipVisible(false);
      this.ui.finale(seat);
      this.playing = false;
    }
  }

  /** Confettis (particules, 4 s) au-dessus de la tribune de la place. */
  private spawnConfetti() {
    const e = this.e;
    const N = 1400;
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const cam = e.camera.position;
    const palette = [new THREE.Color(PRODUCT.theme.accent), new THREE.Color('#ffffff'), new THREE.Color(e.event.home.kit), new THREE.Color('#ffd43b')];
    for (let i = 0; i < N; i++) {
      pos.set([cam.x + (Math.random() - 0.5) * 40, cam.y + 8 + Math.random() * 14, cam.z + (Math.random() - 0.5) * 40], i * 3);
      vel.set([(Math.random() - 0.5) * 1.5, -1.2 - Math.random() * 1.6, (Math.random() - 0.5) * 1.5], i * 3);
      const c = palette[i % palette.length]; col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    e.scene.add(pts);
    let life = 4;
    const off = e.onFrame((dt) => {
      life -= dt;
      for (let i = 0; i < N; i++) { pos[i * 3] += vel[i * 3] * dt + Math.sin(life * 3 + i) * 0.01; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt; }
      g.attributes.position.needsUpdate = true;
      m.opacity = Math.min(1, life);
      if (life <= 0) { e.scene.remove(pts); g.dispose(); m.dispose(); off(); }
    });
  }
}
