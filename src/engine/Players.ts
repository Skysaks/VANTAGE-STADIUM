import * as THREE from 'three';
import type { EventConfig, MatchState } from '../config/types';

// Simulation légère et crédible, au service de la perception d'échelle. Pas un moteur de football.

type Role = 'gk' | 'def' | 'mid' | 'fwd' | 'ref';
interface Player {
  team: 0 | 1 | 2;
  role: Role;
  slot: THREE.Vector2;
  pos: THREE.Vector2;
  vel: THREE.Vector2;
  target: THREE.Vector2;
  heading: number;
  phase: number;
  celebrate: number;
  dive: number;
  visible: boolean;
}

const F442: Array<[Role, number, number]> = [
  ['gk', -0.95, 0],
  ['def', -0.62, -0.62], ['def', -0.66, -0.22], ['def', -0.66, 0.22], ['def', -0.62, 0.62],
  ['mid', -0.3, -0.66], ['mid', -0.34, -0.2], ['mid', -0.34, 0.2], ['mid', -0.3, 0.66],
  ['fwd', -0.05, -0.2], ['fwd', -0.07, 0.22],
];

interface Flight { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; arc: number; onLand?: () => void }

/**
 * Texture du ballon : unique pour toute la session (jamais libérée). Recréée à chaque stade, elle laissait une
 * texture GPU orpheline par changement de stade (constaté par traçage des appels WebGL dans le test mémoire).
 */
let BALL_TEX: THREE.CanvasTexture | null = null;
function ballTexture() {
  if (BALL_TEX) return BALL_TEX;
  const bt = document.createElement('canvas'); bt.width = 128; bt.height = 64;
  const bc = bt.getContext('2d')!; bc.fillStyle = '#f4f4f4'; bc.fillRect(0, 0, 128, 64);
  bc.fillStyle = '#20232a'; for (let i = 0; i < 8; i++) { bc.beginPath(); bc.arc(8 + i * 16, 16 + (i % 2) * 30, 6, 0, 7); bc.fill(); }
  BALL_TEX = new THREE.CanvasTexture(bt); BALL_TEX.colorSpace = THREE.SRGBColorSpace;
  BALL_TEX.userData.persistent = true;
  return BALL_TEX;
}

export class Players {
  group = new THREE.Group();
  players: Player[] = [];
  state: MatchState = 'openplay';
  score = { home: 0, away: 0 };
  minute = 12;
  ballVisible = true;
  showScale = false;
  onGoal: (() => void) | null = null;
  /** Changement d'état du jeu (corner, coup franc, penalty…) : alimente les micro-notifications. */
  onState: ((s: MatchState) => void) | null = null;
  private ballMat!: THREE.MeshStandardMaterial;
  private L: number; private W: number;
  private parts: Record<string, THREE.InstancedMesh> = {};
  private ball: THREE.Mesh;
  private ballPos = new THREE.Vector3();
  private holder = 9;
  private flight: Flight | null = null;
  private timer = 0;
  private possession: 0 | 1 = 0;
  private script = 0;
  private shadows: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private disposables: Array<{ dispose(): void }> = [];
  private tunnel = new THREE.Vector2(0, 40);
  private R = Math.random;
  /** Graine fixe (enregistrement, captures) : mêmes trajectoires à chaque exécution. */
  seed(n: number) { let x = n % 2147483647 || 1; this.R = () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }

  constructor(pitch: { length: number; width: number }, tunnelZ: number) {
    this.L = pitch.length; this.W = pitch.width;
    this.tunnel.set(0, tunnelZ);
    const box = (w: number, h: number, d: number, top = false) => { const g = new THREE.BoxGeometry(w, h, d); if (top) g.translate(0, -h / 2, 0); return g; };
    const geos: Record<string, THREE.BufferGeometry> = {
      torso: box(0.44, 0.62, 0.26), shorts: box(0.42, 0.3, 0.27), head: new THREE.IcosahedronGeometry(0.12, 1),
      legL: box(0.15, 0.86, 0.15, true), legR: box(0.15, 0.86, 0.15, true), armL: box(0.11, 0.62, 0.11, true), armR: box(0.11, 0.62, 0.11, true),
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    this.disposables.push(mat, ...Object.values(geos));
    for (const [k, g] of Object.entries(geos)) {
      const im = new THREE.InstancedMesh(g, mat, 23);
      im.castShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.parts[k] = im;
      this.group.add(im);
    }
    const bmat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
    this.ballMat = bmat;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), bmat);
    this.ball.castShadow = true;
    this.group.add(this.ball);
    this.disposables.push(bmat, this.ball.geometry);
    // Ombres de contact (disques sombres) : ancrent les joueurs sur la pelouse.
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sx = sc.getContext('2d')!; const gr = sx.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    const stex = new THREE.CanvasTexture(sc);
    const sg = new THREE.PlaneGeometry(1.1, 1.1); sg.rotateX(-Math.PI / 2);
    const smat = new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false });
    this.shadows = new THREE.InstancedMesh(sg, smat, 24);
    this.shadows.frustumCulled = false;
    const rg = new THREE.RingGeometry(0.9, 1.05, 32); rg.rotateX(-Math.PI / 2);
    const rmat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
    this.rings = new THREE.InstancedMesh(rg, rmat, 23);
    this.rings.visible = false; this.rings.frustumCulled = false;
    this.group.add(this.shadows, this.rings);
    this.disposables.push(stex, sg, smat, rg, rmat);

    for (let t = 0; t < 2; t++) for (const [role, x, z] of F442) {
      const slot = new THREE.Vector2(t === 0 ? x : -x, t === 0 ? z : -z);
      this.players.push({ team: t as 0 | 1, role, slot, pos: new THREE.Vector2(slot.x * this.L / 2, slot.y * this.W / 2), vel: new THREE.Vector2(), target: new THREE.Vector2(), heading: 0, phase: Math.random() * 6, celebrate: 0, dive: 0, visible: true });
    }
    this.players.push({ team: 2, role: 'ref', slot: new THREE.Vector2(0, 0), pos: new THREE.Vector2(-5, 8), vel: new THREE.Vector2(), target: new THREE.Vector2(), heading: 0, phase: 0, celebrate: 0, dive: 0, visible: true });
    this.ballPos.set(0, 0.11, 0);
  }

  /** Maillots lisibles : un maillot trop proche de la pelouse (ou du maillot adverse) passe à la tenue alternative. */
  static kitFor(ev: EventConfig) {
    const grass = new THREE.Color('#3d7c36');
    const dist = (a: string, b: THREE.Color) => {
      const x = new THREE.Color(a), hx = { h: 0, s: 0, l: 0 }, hb = { h: 0, s: 0, l: 0 };
      x.getHSL(hx); b.getHSL(hb);
      const dh = Math.min(Math.abs(hx.h - hb.h), 1 - Math.abs(hx.h - hb.h));
      return dh * 2.4 * Math.min(hx.s, hb.s) + Math.abs(hx.l - hb.l) * 1.6;
    };
    const home = dist(ev.home.kit, grass) < 0.32 ? ev.home.kitAlt : ev.home.kit;
    let away = dist(ev.away.kit, grass) < 0.32 ? ev.away.kitAlt : ev.away.kit;
    if (dist(away, new THREE.Color(home)) < 0.3) away = away === ev.away.kit ? ev.away.kitAlt : ev.away.kit;
    return { home, away };
  }

  setTeams(ev: EventConfig) {
    const c = new THREE.Color();
    const set = (part: string, i: number, hex: string) => this.parts[part].setColorAt(i, c.set(hex));
    const kits = Players.kitFor(ev);
    this.players.forEach((p, i) => {
      const team = p.team === 0 ? ev.home : p.team === 1 ? ev.away : null;
      const kit = !team ? '#16181d' : p.role === 'gk' ? team.gk : p.team === 0 ? kits.home : kits.away;
      const shorts = !team ? '#16181d' : p.role === 'gk' ? '#1b1d22' : team.shorts;
      const skin = ['#d9a782', '#b98563', '#8a5a3c', '#5e3b26'][i % 4];
      set('torso', i, kit); set('shorts', i, shorts); set('head', i, skin);
      set('legL', i, kit); set('legR', i, kit); set('armL', i, skin); set('armR', i, skin);
    });
    Object.values(this.parts).forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }

  // ---------- états ----------

  setState(s: MatchState) {
    const changed = s !== this.state;
    this.state = s;
    if (changed) this.onState?.(s);
    this.timer = 0; this.script = 0; this.flight = null;
    this.ballVisible = s !== 'halftime';
    this.players.forEach((p) => { p.visible = true; p.celebrate = 0; p.dive = 0; });
    const L2 = this.L / 2, W2 = this.W / 2;
    const home = this.players.filter((p) => p.team === 0), away = this.players.filter((p) => p.team === 1);
    const ref = this.players[22];
    if (s === 'kickoff') {
      this.players.forEach((p) => { if (p.team < 2) p.target.set(p.slot.x * L2 * (p.role === 'fwd' ? 0.1 : 1), p.slot.y * W2 * 0.92); });
      home[9].target.set(-0.4, -0.5); home[10].target.set(-0.4, 9);
      ref.target.set(-6, 12);
      this.setBall(0, 0); this.holder = 9;
    } else if (s === 'corner') {
      const gx = L2;
      const spots: Array<[number, number]> = [[gx - 6, -3], [gx - 6.5, 3], [gx - 11, 0], [gx - 9, -7], [gx - 13, 6]];
      home.forEach((p, i) => p.target.set(i === 0 ? -L2 + 1.5 : i < 3 ? -2 : -18, i === 0 ? 0 : (i - 5) * 6));
      [5, 6, 9, 10, 7].forEach((h, k) => home[h].target.set(...spots[k]));
      home[8].target.set(gx + 0.6, W2 + 0.6);
      away[0].target.set(gx - 0.4, 1);
      [1, 2, 3, 4, 6].forEach((a, k) => away[a].target.set(spots[k][0] + 0.9, spots[k][1] + (k % 2 ? 0.6 : -0.6)));
      [5, 7, 8].forEach((a, k) => away[a].target.set(gx - 18, -12 + k * 12));
      away[9].target.set(-2, -10); away[10].target.set(4, 12);
      ref.target.set(gx - 18, -16);
      this.setBall(gx - 0.3, W2 - 0.3); this.holder = 8;
    } else if (s === 'freekick') {
      const b = new THREE.Vector2(L2 - 24, 8);
      const g = new THREE.Vector2(L2, 0);
      const dir = g.clone().sub(b).normalize();
      const perp = new THREE.Vector2(-dir.y, dir.x);
      const wall = b.clone().addScaledVector(dir, 9.15);
      [2, 3, 6, 7].forEach((a, k) => away[a].target.copy(wall).addScaledVector(perp, (k - 1.5) * 0.62));
      away[0].target.set(L2 - 0.4, -1.5);
      [1, 4, 5, 8].forEach((a, k) => away[a].target.set(L2 - 12, -14 + k * 9));
      away[9].target.set(-5, 6); away[10].target.set(2, -8);
      home.forEach((p, i) => p.target.set(i === 0 ? -L2 + 2 : i < 4 ? -10 + i * 3 : L2 - 15, (i - 5) * 4));
      home[8].target.copy(b).addScaledVector(dir, -2.2);
      home[7].target.copy(b).addScaledVector(perp, 2.5).addScaledVector(dir, -1.5);
      ref.target.copy(wall).addScaledVector(perp, 6);
      this.setBall(b.x, b.y); this.holder = 8;
    } else if (s === 'penalty') {
      const spot = new THREE.Vector2(L2 - 11, 0);
      away[0].target.set(L2 - 0.2, 0);
      home[9].target.set(spot.x - 4, 0.5);
      home[0].target.set(-L2 + 1.5, 0);
      const others = this.players.filter((p) => p !== away[0] && p !== home[9] && p.team < 2 && p.role !== 'gk');
      others.forEach((p, k) => p.target.set(L2 - 20.5 - (k % 3) * 2.5, -22 + Math.floor(k / 3) * 7 + (k % 2)));
      ref.target.set(L2 - 12.5, -4);
      this.setBall(spot.x, spot.y); this.holder = 9;
    } else if (s === 'warmup') {
      this.players.forEach((p) => { if (p.team < 2) this.warmTarget(p); });
      ref.target.set(0, W2 + 1);
      this.setBall(-20, 0); this.holder = 6;
    } else if (s === 'halftime') {
      this.players.forEach((p) => p.target.copy(this.tunnel).add(new THREE.Vector2((this.R() - 0.5) * 4, 0)));
    } else if (s === 'openplay') {
      this.possession = 0; this.holder = 6;
      this.setBall(this.players[6].pos.x, this.players[6].pos.y);
    }
  }

  /** Moment de but : attaque, frappe, filet, célébration. */
  triggerGoal() {
    this.setState('openplay');
    this.state = 'goal';
    this.script = 1; this.timer = 0;
    const L2 = this.L / 2;
    const striker = this.players[9];
    striker.pos.set(L2 - 20, -4);
    this.players[5].pos.set(L2 - 28, 10);
    this.holder = 5;
    this.setBall(this.players[5].pos.x, this.players[5].pos.y);
    this.players.forEach((p) => { if (p.team === 0 && p.role !== 'gk') p.target.set(p.slot.x * L2 + 30, p.slot.y * this.W / 2 * 0.8); if (p.team === 1 && p.role !== 'gk') p.target.set(L2 - 16 + (this.R() - 0.5) * 8, (this.R() - 0.5) * 30); });
    this.pass(5, new THREE.Vector3(L2 - 13, 0.11, -2.5), 0.6, 0.9, () => {
      this.holder = 9;
      striker.target.set(L2 - 12, -2.5);
      this.timer = 0; this.script = 2;
    });
  }

  private warmTarget(p: Player) {
    const side = p.team === 0 ? -1 : 1;
    p.target.set(side * (8 + this.R() * (this.L / 2 - 14)), (this.R() - 0.5) * this.W * 0.85);
  }

  private setBall(x: number, z: number) { this.ballPos.set(x, 0.11, z); this.flight = null; }

  private pass(from: number, to: THREE.Vector3, arc: number, durScale = 1, onLand?: () => void) {
    const start = this.ballPos.clone();
    const d = start.distanceTo(to);
    this.flight = { from: start, to, t: 0, dur: Math.max(0.35, (d / 19) * durScale), arc, onLand };
    this.holder = -1;
    void from;
  }

  // ---------- simulation ----------

  private steer(p: Player, dt: number, run: number) {
    const to = p.target.clone().sub(p.pos);
    const d = to.length();
    const want = d > 9 ? 6.8 * run : d > 3 ? 4.2 * run : d > 0.4 ? 1.6 : 0;
    const desired = d > 0.01 ? to.multiplyScalar(want / d) : new THREE.Vector2();
    const dv = desired.sub(p.vel);
    const maxA = 7 * dt;
    if (dv.length() > maxA) dv.setLength(maxA);
    p.vel.add(dv);
    p.pos.addScaledVector(p.vel, dt);
    const sp = p.vel.length();
    const face = sp > 0.6 ? Math.atan2(p.vel.x, p.vel.y) : Math.atan2(this.ballPos.x - p.pos.x, this.ballPos.z - p.pos.y);
    let dh = face - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    p.heading += dh * Math.min(1, dt * 6);
    p.phase += sp * dt * 2.3;
  }

  private nearest(team: 0 | 1, x: number, z: number, exclude = -1) {
    let best = -1, bd = 1e9;
    this.players.forEach((p, i) => {
      if (p.team !== team || i === exclude || p.role === 'gk') return;
      const d = (p.pos.x - x) ** 2 + (p.pos.y - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  private openPlay(dt: number) {
    const L2 = this.L / 2, W2 = this.W / 2;
    const bx = this.ballPos.x, bz = this.ballPos.z;
    const att = this.possession;
    this.players.forEach((p, i) => {
      if (p.team === 2) { p.target.set(bx - 10 * Math.sign(bx || 1), Math.max(-W2 + 4, Math.min(W2 - 4, bz + 9))); return; }
      const dir = p.team === 0 ? 1 : -1;
      if (p.role === 'gk') { p.target.set(-dir * (L2 - 1.5), Math.max(-3, Math.min(3, bz * 0.12))); return; }
      if (i === this.holder) return;
      const shift = (bx / L2) * 0.42 * dir + (att === p.team ? 0.16 : -0.06);
      const x = (p.slot.x * dir + shift) * dir * L2;
      p.target.set(Math.max(-L2 + 3, Math.min(L2 - 3, x)), Math.max(-W2 + 2, Math.min(W2 - 2, p.slot.y * W2 * 0.88 + bz * 0.22)));
    });
    // pressing
    if (this.holder >= 0) {
      const h = this.players[this.holder];
      const presser = this.nearest(h.team === 0 ? 1 : 0, h.pos.x, h.pos.y);
      if (presser >= 0) this.players[presser].target.set(h.pos.x - (h.team === 0 ? -1.5 : 1.5), h.pos.y);
      const dir = h.team === 0 ? 1 : -1;
      h.target.set(h.pos.x + dir * 2.5, h.pos.y + Math.sin(this.timer * 1.7) * 1.5);
      this.timer += dt;
      if (this.timer > 1.3 + this.R() * 1.6) {
        this.timer = 0;
        const attacking = (h.pos.x * dir) > L2 - 32;
        if (attacking && this.R() < 0.3) {
          // frappe : arrêt du gardien adverse
          const keeper = this.players.findIndex((p) => p.team !== h.team && p.role === 'gk');
          const kp = this.players[keeper];
          const tz = (this.R() - 0.5) * 5;
          kp.target.set(kp.pos.x, tz);
          kp.dive = Math.sign(tz - kp.pos.y) || 1;
          this.pass(this.holder, new THREE.Vector3(dir * (L2 - 0.6), 0.9, tz), 1.2, 0.7, () => {
            this.holder = keeper; kp.dive = 0;
            this.possession = kp.team as 0 | 1;
          });
          return;
        }
        const mates = this.players.map((p, i) => ({ p, i })).filter(({ p, i }) => p.team === h.team && i !== this.holder && p.role !== 'gk' || (h.role === 'gk' && p.team === h.team && p.role === 'def'));
        mates.sort((a, b) => {
          const fa = (a.p.pos.x - h.pos.x) * dir, fb = (b.p.pos.x - h.pos.x) * dir;
          const da = a.p.pos.distanceTo(h.pos), db = b.p.pos.distanceTo(h.pos);
          return (db > 6 && db < 34 ? fb : -50) + this.R() * 14 - ((da > 6 && da < 34 ? fa : -50) + this.R() * 14);
        });
        const recv = mates[0]?.i ?? this.holder;
        const rp = this.players[recv];
        const lead = rp.vel.clone().multiplyScalar(0.6);
        const to = new THREE.Vector3(rp.pos.x + lead.x, 0.11, rp.pos.y + lead.y);
        const d = to.distanceTo(this.ballPos);
        const intercept = this.R() < 0.17;
        const rec = intercept ? this.nearest(h.team === 0 ? 1 : 0, (to.x + bx) / 2, (to.z + bz) / 2) : recv;
        const dest = intercept && rec >= 0 ? new THREE.Vector3(this.players[rec].pos.x, 0.11, this.players[rec].pos.y) : to;
        this.players[rec >= 0 ? rec : recv].target.set(dest.x, dest.z);
        this.pass(this.holder, dest, d > 26 ? 5 + this.R() * 4 : 0.25, 1, () => {
          this.holder = rec >= 0 ? rec : recv;
          this.possession = this.players[this.holder].team as 0 | 1;
        });
      }
    }
  }

  private scripted(dt: number) {
    const L2 = this.L / 2, W2 = this.W / 2;
    this.timer += dt;
    const s = this.state;
    if (s === 'goal') {
      const striker = this.players[9];
      if (this.script === 2 && this.timer > 0.55) {
        this.script = 3;
        const keeper = this.players[11];
        keeper.target.set(L2 - 0.5, 2.5); keeper.dive = 1;
        this.pass(9, new THREE.Vector3(L2 + 1.2, 1.1, -2.8), 0.9, 0.55, () => {
          this.script = 4; this.timer = 0;
          this.score.home += 1;
          this.onGoal?.();
        });
      }
      if (this.script === 4) {
        const corner = new THREE.Vector2(L2 - 2, W2 - 2);
        this.players.forEach((p, i) => {
          if (p.team === 0 && p.role !== 'gk') {
            p.target.copy(corner).add(new THREE.Vector2(-((i * 0.37) % 1) * 4, -((i * 0.71) % 1) * 4));
            p.celebrate = Math.min(1, p.celebrate + dt * 2);
          } else if (p.team === 1) p.target.set(Math.max(p.pos.x - 6, 0), p.pos.y * 0.9);
        });
        striker.target.copy(corner).add(new THREE.Vector2(0.5, 0.5));
        this.players[11].dive = 0;
      }
      return;
    }
    if (s === 'corner' && this.timer > 4.5) {
      this.timer = 0;
      const tgt = [5, 6, 9, 10, 7][Math.floor(this.R() * 5)];
      const tp = this.players[tgt];
      this.pass(8, new THREE.Vector3(tp.pos.x, 1.8, tp.pos.y), 7, 1.3, () => {
        this.setBall(L2 - 0.3, W2 - 0.3); this.holder = 8;
      });
    }
    if (s === 'freekick' && this.timer > 5) {
      this.timer = 0;
      const keeper = this.players[11];
      keeper.dive = 1;
      this.pass(8, new THREE.Vector3(L2 + 0.4, 2.1, 2.9), 3.2, 1.6, () => {
        keeper.dive = 0;
        this.setBall(L2 - 24, 8); this.holder = 8;
      });
    }
    if (s === 'penalty') {
      const taker = this.players[9];
      const spot = new THREE.Vector2(L2 - 11, 0);
      if (this.timer > 2 && this.script === 0) { this.script = 1; taker.target.set(spot.x - 0.3, 0.3); }
      if (this.script === 1 && taker.pos.distanceTo(spot) < 0.9) {
        this.script = 2;
        const side = this.R() < 0.5 ? -1 : 1;
        const keeper = this.players[11];
        keeper.dive = -side; keeper.target.set(L2 - 0.3, -side * 2.5);
        this.pass(9, new THREE.Vector3(L2 + 0.6, 0.6, side * 2.8), 0.4, 0.5, () => { this.timer = 0; this.script = 3; });
      }
      if (this.script === 3 && this.timer > 2.5) {
        this.script = 0; this.timer = 0;
        this.players[11].dive = 0;
        this.setState('penalty');
      }
    }
    if (s === 'warmup') {
      this.players.forEach((p) => { if (p.team < 2 && p.pos.distanceTo(p.target) < 1) this.warmTarget(p); });
      if (this.timer > 2.4) {
        this.timer = 0;
        const a = Math.floor(this.R() * 10) + 1, b = (a % 10) + 1;
        const pb = this.players[b];
        this.pass(a, new THREE.Vector3(pb.pos.x, 0.11, pb.pos.y), 0.3, 1.4, () => { this.holder = b; });
      }
    }
    if (s === 'halftime') {
      this.players.forEach((p) => { if (p.pos.distanceTo(this.tunnel) < 2.5) p.visible = false; });
    }
  }

  /** Pas fixes (≤ 50 ms) : la simulation reste stable même si une image est lente. */
  update(dt: number, t: number) {
    let rest = Math.min(dt, 0.25);
    while (rest > 1e-4) { const h = Math.min(0.05, rest); this.step(h); rest -= h; }
    this.minute = this.state === 'halftime' ? 45 : Math.min(90, 12 + Math.floor(t / 20));
    this.render(t);
  }

  private step(dt: number) {
    if (this.state === 'openplay') this.openPlay(dt);
    else this.scripted(dt);
    const run = this.state === 'warmup' || this.state === 'halftime' ? 0.55 : this.state === 'kickoff' ? 0.4 : 1;
    this.players.forEach((p) => this.steer(p, dt, p.celebrate > 0 ? 1.1 : run));
    // ballon
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.dur;
      const k = Math.min(1, f.t);
      this.ballPos.lerpVectors(f.from, f.to, k);
      this.ballPos.y = f.from.y + (f.to.y - f.from.y) * k + Math.sin(k * Math.PI) * f.arc;
      this.ball.rotation.x += dt * 14;
      if (k >= 1) { this.flight = null; f.onLand?.(); }
    } else if (this.holder >= 0) {
      const h = this.players[this.holder];
      const fx = Math.sin(h.heading), fz = Math.cos(h.heading);
      this.ballPos.set(h.pos.x + fx * 0.45, 0.11, h.pos.y + fz * 0.45);
      this.ball.rotation.x += h.vel.length() * dt * 9;
    }
    this.ball.position.copy(this.ballPos);
    this.ball.visible = this.ballVisible;
  }

  private render(t: number) {
    const m = new THREE.Matrix4(), base = new THREE.Matrix4(), tmp = new THREE.Matrix4(), rx = new THREE.Matrix4();
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    this.players.forEach((p, i) => {
      if (!p.visible) {
        for (const k in this.parts) this.parts[k].setMatrixAt(i, hide);
        this.shadows.setMatrixAt(i, hide); this.rings.setMatrixAt(i, hide);
        return;
      }
      const sp = p.vel.length();
      const amp = Math.min(0.85, sp * 0.14);
      const swing = Math.sin(p.phase) * amp;
      const jump = p.celebrate * Math.abs(Math.sin(t * 6 + i)) * 0.35;
      const bob = Math.abs(Math.sin(p.phase)) * 0.05 * Math.min(1, sp / 4) + jump;
      e.set(0, p.heading, p.dive * 0.9);
      q.setFromEuler(e);
      base.compose(v.set(p.pos.x, bob + (p.dive ? 0.25 : 0), p.pos.y), q, one);
      const place = (part: string, ox: number, oy: number, oz: number, ang: number) => {
        tmp.makeTranslation(ox, oy, oz);
        rx.makeRotationX(ang);
        m.copy(base).multiply(tmp).multiply(rx);
        this.parts[part].setMatrixAt(i, m);
      };
      const armUp = p.celebrate > 0 ? -2.7 * p.celebrate : 0;
      place('torso', 0, 1.2, 0, 0);
      place('shorts', 0, 0.84, 0, 0);
      place('head', 0, 1.66, 0, 0);
      place('legL', -0.1, 0.88, 0, swing);
      place('legR', 0.1, 0.88, 0, -swing);
      place('armL', -0.29, 1.47, 0, armUp || -swing * 0.8);
      place('armR', 0.29, 1.47, 0, armUp || swing * 0.8);
      this.shadows.setMatrixAt(i, m.makeTranslation(p.pos.x, 0.02, p.pos.y));
      this.rings.setMatrixAt(i, m.makeTranslation(p.pos.x, 0.03, p.pos.y));
    });
    this.shadows.setMatrixAt(23, this.ballVisible ? m.compose(v.set(this.ballPos.x, 0.021, this.ballPos.z), q.identity(), v.clone().set(0.35, 1, 0.35)) : hide);
    for (const k in this.parts) this.parts[k].instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.visible = this.showScale;
  }

  /** Point de vue d'un joueur (œil à 1,72 m) et direction regardée. */
  playerEye(role: 'gk' | 'def' | 'mid' | 'fwd') {
    const idx = this.players.findIndex((p) => p.team === 0 && p.role === role && p.visible);
    const p = this.players[Math.max(0, idx)];
    const pos = new THREE.Vector3(p.pos.x, 1.72, p.pos.y);
    const look = role === 'gk' ? new THREE.Vector3(0, 1.2, 0) : this.ballPos.clone().setY(1);
    return { pos, look, index: idx };
  }
  ballState() { return { pos: this.ballPos.clone(), flying: !!this.flight }; }

  /** Ballon lisible de loin : légère mise à l'échelle avec la distance (jamais caricaturale) et un peu de clarté la nuit. */
  setBallAssist(scale: number, night: number) {
    this.ball.scale.setScalar(scale);
    this.ballMat.emissiveIntensity = 0.08 * night;
  }

  private act = new THREE.Vector3();
  /** Centre de l'action : ballon et joueurs les plus proches, lissé (suivi du jeu). */
  actionPoint() {
    const b = this.ballPos;
    const near = this.players.filter((p) => p.visible && p.team < 2).map((p) => ({ p, d: (p.pos.x - b.x) ** 2 + (p.pos.y - b.z) ** 2 })).sort((a, z) => a.d - z.d).slice(0, 6);
    let x = b.x * 0.5, z = b.z * 0.5;
    for (const n of near) { x += (n.p.pos.x * 0.5) / near.length; z += (n.p.pos.y * 0.5) / near.length; }
    this.act.lerp(new THREE.Vector3(x, 1, z), 0.04);
    return this.act;
  }
  get ballPosition() { return this.ballPos; }

  dispose() { this.disposables.forEach((d) => d.dispose()); Object.values(this.parts).forEach((m) => m.dispose()); }
}
