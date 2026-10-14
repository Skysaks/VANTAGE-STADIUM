import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CAMERA } from '../config/product';
import type { VenueModel } from '../venue/model';
import { seatsNear } from '../engine/Picking';

export type CamState =
  | 'STADIUM_ORBIT' | 'AERIAL' | 'STAND_FOCUS' | 'SECTION_FOCUS' | 'ROW_FOCUS' | 'SEAT_APPROACH' | 'SEAT_POV'
  | 'SEAT_SWITCH' | 'WALK_MODE' | 'PITCH_VIEW' | 'TUNNEL_VIEW' | 'PLAYER_VIEW' | 'REVEAL' | 'FREE_CAMERA';

export type FovMode = 'natural' | 'wide' | 'focus';
export type Posture = 'seated' | 'standing';
export type Viewer = 'adult' | 'child';
export type TransitionKind = 'slide' | 'hop' | 'glide' | 'tier' | 'pullback' | 'approach' | 'focus' | 'overview' | 'anchor' | 'cut';
export type AnchorId = 'center' | 'corner' | 'goalLine' | 'bench' | 'tunnel' | 'roof' | 'entrance';

/** Contrat de chaque état : contrôles orbitaux, regard libre, type de picking, contraintes. */
interface StateDef { orbit: boolean; look: boolean; pick: 'section' | 'seat' | 'pov' | 'none'; min?: number; max?: number; polar?: number; pan?: boolean }
export const STATES: Record<CamState, StateDef> = {
  STADIUM_ORBIT: { orbit: true, look: false, pick: 'section', min: 30, max: 520, polar: 1.42 },
  AERIAL: { orbit: true, look: false, pick: 'section', min: 60, max: 700, polar: 0.9 },
  STAND_FOCUS: { orbit: true, look: false, pick: 'section', min: 15, max: 220, polar: 1.48 },
  SECTION_FOCUS: { orbit: true, look: false, pick: 'seat', min: 8, max: 160, polar: 1.52 },
  ROW_FOCUS: { orbit: true, look: false, pick: 'seat', min: 4, max: 60, polar: 1.52 },
  SEAT_APPROACH: { orbit: false, look: false, pick: 'none' },
  SEAT_POV: { orbit: false, look: true, pick: 'pov' },
  SEAT_SWITCH: { orbit: false, look: false, pick: 'none' },
  WALK_MODE: { orbit: false, look: true, pick: 'pov' },
  PITCH_VIEW: { orbit: false, look: true, pick: 'pov' },
  TUNNEL_VIEW: { orbit: false, look: true, pick: 'pov' },
  PLAYER_VIEW: { orbit: false, look: false, pick: 'none' },
  REVEAL: { orbit: false, look: false, pick: 'none' },
  FREE_CAMERA: { orbit: true, look: false, pick: 'section', min: 4, max: 900, polar: 1.56, pan: true },
};

interface Transition {
  curve: THREE.CatmullRomCurve3 | null;
  from: THREE.Vector3; to: THREE.Vector3;
  look: THREE.CatmullRomCurve3 | null;
  q0: THREE.Quaternion; q1: THREE.Quaternion | null;
  fov0: number; fov1: number;
  t0: number; dur: number; kind: TransitionKind;
  end: CamState; onDone?: () => void;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

export interface Viewpoint { state: CamState; seat: number; section: number; pos: THREE.Vector3; target: THREE.Vector3; yaw: number; pitch: number; anchor?: AnchorId }

export class CameraDirector {
  state: CamState = 'STADIUM_ORBIT';
  controls: OrbitControls;
  seat = -1;
  section = -1;
  stand = -1;
  anchor: AnchorId | null = null;
  posture: Posture = 'seated';
  viewer: Viewer = 'adult';
  fovMode: FovMode = 'natural';
  freeLook = false;
  yaw = 0; pitch = 0; baseYaw = 0;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  transition: Transition | null = null;
  follow: (() => { pos: THREE.Vector3; look: THREE.Vector3 }) | null = null;
  listeners = new Set<(s: CamState, prev: CamState) => void>();
  onCut: () => void = () => {};
  private v: VenueModel | null = null;
  private vel = new THREE.Vector3();
  private lastPos = new THREE.Vector3();
  private lookVel = { yaw: 0, pitch: 0 };
  private shake = 0;
  private home = { pos: new THREE.Vector3(0, 170, 190), target: new THREE.Vector3(0, 0, 0) };
  /** Zones occupées par l'interface (px CSS) : le centre optique est décalé vers la zone libre. */
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private offCur = new THREE.Vector2(); private offTarget = new THREE.Vector2(); private zero2 = new THREE.Vector2();
  private viewW = 1; private viewH = 1;
  /** Hauteur de structure couvrante au point (toit, niveau supérieur) : fournie par le moteur d'environnement. */
  coverAt: (x: number, z: number) => number = () => 0;
  /** Mode confort : aucune secousse, traversées de stade en fondu. */
  comfort = false;
  private lookFling = { yaw: 0, pitch: 0 };
  /** Zoom de la vue siège (1 = vision naturelle, jusqu'à ×3 « jumelles »). Présenté comme un zoom, jamais comme la vue réelle. */
  zoom = 1;
  /** Préférence de session : garder le zoom en changeant de place. */
  keepZoom = false;
  setZoom(z: number) { this.zoom = Math.max(1, Math.min(3, z)); this.onZoom(this.zoom); }
  onZoom: (z: number) => void = () => {};
  /** Suivi automatique du regard en vue siège : ballon, jeu (centre de l'action, plus lent) ou aucun. Toute saisie l'interrompt. */
  followPlay: 'off' | 'ball' | 'play' = 'off';
  followTarget: ((kind: 'ball' | 'play') => THREE.Vector3 | null) | null = null;
  onUserLook: () => void = () => {};
  private lookTween: { y0: number; p0: number; y1: number; p1: number; t0: number; dur: number } | null = null;

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.075, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.8, zoomToCursor: true, screenSpacePanning: false });
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.lastPos.copy(camera.position);
  }

  setVenue(v: VenueModel) {
    this.v = v;
    this.updateHome();
    this.seat = -1; this.section = -1; this.stand = -1;
  }

  homeFov = 42;
  /** Vue d'ensemble cadrée pour l'écran courant (lecture seule). */
  get homeView() { return { pos: this.home.pos.clone(), target: this.home.target.clone(), fov: this.homeFov }; }

  setViewport(w: number, h: number) { this.viewW = Math.max(1, w); this.viewH = Math.max(1, h); }

  /** Publie les encarts d'interface ; le cadrage d'ensemble et le centre optique s'y adaptent en douceur. */
  setInsets(i: { top: number; right: number; bottom: number; left: number }) {
    this.insets = { ...i };
    this.offTarget.set((i.left - i.right) / 2, (i.top - i.bottom) / 2);
    if (this.reduced) this.offCur.copy(this.offTarget);
    this.updateHome();
  }

  private applyViewOffset() {
    const o = this.offCur, W = this.viewW, H = this.viewH;
    if (Math.abs(o.x) < 0.5 && Math.abs(o.y) < 0.5) { if (this.camera.view?.enabled) this.camera.clearViewOffset(); return; }
    this.camera.setViewOffset(W, H, -o.x, -o.y, W, H);
  }

  /** Point de vue d'ensemble adapté au format d'écran (portrait : plus haut et plus loin) et à la zone libre. */
  updateHome() {
    const v = this.v;
    if (!v) return;
    // Portrait : on regarde dans l'axe du terrain (la longueur occupe la hauteur de l'écran), FOV plus ouvert.
    // Distance calculée pour que la largeur visible tienne dans le champ réellement libre (hors HUD, dock, carte).
    const ins = this.insets;
    const fw = Math.max(0.4, (this.viewW - ins.left - ins.right) / this.viewW), fh = Math.max(0.4, (this.viewH - ins.top - ins.bottom) / this.viewH);
    const aspect = (this.camera.aspect * fw) / fh, portrait = aspect < 0.85;
    this.homeFov = portrait ? 58 : 42;
    const vfFull = (this.homeFov * Math.PI) / 180;
    const vf = 2 * Math.atan(Math.tan(vfFull / 2) * fh), hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const lat = (portrait ? v.bounds.maxZ * 1.22 : v.bounds.maxX * 0.94), dep = portrait ? v.bounds.maxX : v.bounds.maxZ;
    const el = portrait ? 0.98 : 0.64;
    const d = Math.max(lat / Math.tan(hf / 2), (dep * Math.sin(el) + 30 * Math.cos(el)) / Math.tan(vf / 2)) * 1.04 + dep * Math.cos(el) * (portrait ? 0.2 : 0.45);
    const dir = portrait ? new THREE.Vector3(Math.cos(el), Math.sin(el), 0.1) : new THREE.Vector3(0.08, Math.sin(el), Math.cos(el));
    this.home.pos.copy(dir.normalize().multiplyScalar(d));
    this.home.target.set(0, portrait ? 0 : -4, 0);
  }

  get def() { return STATES[this.state]; }
  get isPOV() { return this.state === 'SEAT_POV' || this.state === 'PITCH_VIEW' || this.state === 'TUNNEL_VIEW' || this.state === 'WALK_MODE'; }
  get busy() { return !!this.transition; }

  private setState(s: CamState) {
    const prev = this.state;
    this.state = s;
    const d = STATES[s];
    this.controls.enabled = d.orbit;
    if (d.orbit) {
      this.controls.minDistance = d.min ?? 10;
      this.controls.maxDistance = Math.max(d.max ?? 500, s === 'STADIUM_ORBIT' ? this.home.pos.length() * 1.2 : 0);
      this.controls.maxPolarAngle = d.polar ?? 1.45;
      this.controls.enablePan = !!d.pan || s === 'SECTION_FOCUS' || s === 'STAND_FOCUS';
    }
    if (prev !== s) this.listeners.forEach((f) => f(s, prev));
  }

  // ---------- géométrie de vue ----------

  eyeHeight() {
    const e = CAMERA.eye;
    return this.viewer === 'child' ? (this.posture === 'seated' ? e.childSeated : e.childStanding) : this.posture === 'seated' ? e.adultSeated : e.adultStanding;
  }

  eyeOf(i: number, h = this.eyeHeight()) {
    const v = this.v!;
    return new THREE.Vector3(v.px[i] + v.nx[i] * 0.1, v.py[i] + h, v.pz[i] + v.nz[i] * 0.1);
  }

  /** Point dans l'air, devant le niveau du siège (au-dessus des rangs inférieurs), à la hauteur de l'œil. */
  private front(i: number, extra: number, lift = 0.4) {
    const v = this.v!;
    const st = v.stands[v.stand[i]];
    const t = st.tiers[v.tier[i]];
    const dd = v.depth[i] - t.d0 + extra;
    return new THREE.Vector3(v.px[i] - v.nx[i] * dd, v.py[i] + this.eyeHeight() + lift, v.pz[i] - v.nz[i] * dd);
  }

  /** Point haut, devant la tribune et hors de la projection du toit. */
  private high(i: number) {
    const v = this.v!;
    const st = v.stands[v.stand[i]];
    const over = st.roof ? Math.max(0, -st.roof.cover) : 0;
    const t = st.tiers[v.tier[i]];
    const dd = v.depth[i] - t.d0 + over + 10;
    return new THREE.Vector3(v.px[i] - v.nx[i] * dd, v.bounds.maxY + 16, v.pz[i] - v.nz[i] * dd);
  }

  private inBowlAir(p: THREE.Vector3) {
    const v = this.v!;
    return Math.abs(p.x) < v.pitch.length / 2 + v.pitch.runoff + 1 && Math.abs(p.z) < v.pitch.width / 2 + v.pitch.runoff + 1;
  }

  baseLook(eye: THREE.Vector3) {
    const d = new THREE.Vector3(-eye.x * 0.92, -eye.y, -eye.z * 0.92);
    return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
  }

  private dirOf(yaw: number, pitch: number) {
    return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  }

  fovFor(mode: FovMode = this.fovMode) {
    const h = mode === 'natural' ? CAMERA.fov.natural : mode === 'wide' ? CAMERA.fov.wide : CAMERA.fov.focus;
    const v = (2 * Math.atan(Math.tan((h * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    const cap = mode === 'wide' ? 84 : CAMERA.fov.maxVertical;
    return Math.min(v, cap);
  }

  private quatLooking(from: THREE.Vector3, dir: THREE.Vector3) {
    const m = new THREE.Matrix4().lookAt(from, from.clone().add(dir), new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // ---------- moteur de transition ----------

  private run(pts: THREE.Vector3[], opts: { kind: TransitionKind; dur: number; end: CamState; looks?: THREE.Vector3[]; endDir?: THREE.Vector3; fov?: number; onDone?: () => void }) {
    const cam = this.camera;
    const from = cam.position.clone();
    const pts2 = [from, ...pts];
    // continuité de vitesse : si la caméra bougeait, on prolonge brièvement son mouvement
    if (this.vel.length() > 2 && opts.kind !== 'cut') pts2.splice(1, 0, from.clone().addScaledVector(this.vel, 0.12));
    let dedup = pts2.filter((p, k) => k === 0 || p.distanceTo(pts2[k - 1]) > 0.05);
    if (opts.kind !== 'cut' && opts.kind !== 'slide' && opts.kind !== 'hop' && dedup.length > 1) dedup = this.safePath(dedup);
    const end = dedup[dedup.length - 1];
    let dur = opts.dur;
    if (this.reduced || opts.kind === 'cut') dur = 0;
    const q1 = opts.endDir ? this.quatLooking(end, opts.endDir) : null;
    this.transition = {
      curve: dedup.length > 1 ? new THREE.CatmullRomCurve3(dedup, false, 'centripetal') : null,
      from, to: end.clone(),
      look: opts.looks && opts.looks.length > 1 ? new THREE.CatmullRomCurve3(opts.looks, false, 'centripetal') : null,
      q0: cam.quaternion.clone(), q1,
      fov0: cam.fov, fov1: opts.fov ?? cam.fov,
      t0: performance.now(), dur, kind: opts.kind, end: opts.end, onDone: opts.onDone,
    };
    this.controls.enabled = false;
    if (dur === 0 && opts.kind !== 'cut') this.onCut();
    if (this.state !== 'REVEAL') this.setState(opts.kind === 'slide' || opts.kind === 'hop' || opts.kind === 'glide' || opts.kind === 'tier' || opts.kind === 'pullback' ? 'SEAT_SWITCH' : opts.kind === 'approach' ? 'SEAT_APPROACH' : this.state);
    // coupe franche : appliquée immédiatement (aucune image intermédiaire, état final disponible tout de suite)
    if (dur === 0) this.update(0);
  }

  /** Point situé dans une structure (gradins, toit) ? */
  blocked(p: THREE.Vector3) {
    if (!this.v || this.inBowlAir(p)) return false;
    const top = seatsNear(this.v, p.x, p.z, 2);
    if (top >= 0 && p.y < top + 1.2) return true;
    const h = this.coverAt(p.x, p.z);
    return h > 0 && p.y > h - 1.5 && p.y < h + 2.5;
  }

  /**
   * Planification sans collision : on échantillonne la spline ; si elle traverse une structure,
   * on insère un point de passage au-dessus (hors toit) et on recommence (2 essais maximum).
   */
  private safePath(pts: THREE.Vector3[]): THREE.Vector3[] {
    let path = pts;
    for (let attempt = 0; attempt < 2; attempt++) {
      const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
      let hit = -1;
      for (let k = 2; k < 38; k++) {
        const t = k / 40, p = curve.getPointAt(t);
        if (this.blocked(p)) { hit = k; break; }
      }
      if (hit < 0) return path;
      const t = hit / 40, p = curve.getPointAt(t);
      const lift = Math.max(this.v!.bounds.maxY + 10, this.coverAt(p.x, p.z) + 6);
      const via = new THREE.Vector3(p.x * 0.75, lift, p.z * 0.75);
      const seg = Math.min(path.length - 2, Math.max(0, Math.floor(t * (path.length - 1))));
      path = [...path.slice(0, seg + 1), via, ...path.slice(seg + 1)];
    }
    return path;
  }

  cancel() { this.transition = null; }

  private finish() {
    const tr = this.transition!;
    this.transition = null;
    if (this.state !== 'REVEAL' || tr.end !== 'REVEAL') this.setState(tr.end);
    if (STATES[tr.end].orbit) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const dist = Math.max(10, this.controls.target.distanceTo(this.camera.position));
      if (tr.look) this.controls.target.copy(tr.look.getPoint(1));
      else this.controls.target.copy(this.camera.position).addScaledVector(dir, dist);
    }
    tr.onDone?.();
  }

  // ---------- commandes de haut niveau ----------

  overview(dur = 1100) {
    this.seat = -1; this.section = -1; this.stand = -1; this.anchor = null; this.follow = null;
    const p = this.camera.position;
    const pts: THREE.Vector3[] = [];
    if (this.isPOV || this.state === 'SEAT_SWITCH') pts.push(p.clone().add(new THREE.Vector3(-p.x * 0.15, 8, -p.z * 0.15)), new THREE.Vector3(p.x * 0.4, this.v!.bounds.maxY + 25, p.z * 0.4));
    pts.push(this.home.pos.clone());
    const look0 = this.camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(40));
    this.run(pts, { kind: 'overview', dur, end: 'STADIUM_ORBIT', looks: [look0, new THREE.Vector3(0, 0, 0), this.home.target.clone()], fov: this.homeFov });
  }

  aerial() {
    this.seat = -1; this.anchor = null; this.follow = null;
    const v = this.v!;
    const h = Math.max(v.bounds.maxX, v.bounds.maxZ) * 2.1;
    const look0 = this.camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(40));
    this.run([new THREE.Vector3(0, v.bounds.maxY + 30, 30), new THREE.Vector3(0.1, h, 8)], { kind: 'overview', dur: 1600, end: 'AERIAL', looks: [look0, new THREE.Vector3(0, 0, 0)], fov: 42 });
  }

  drone() {
    this.follow = null; this.anchor = null;
    this.setState('FREE_CAMERA');
  }

  focusStand(si: number) {
    const v = this.v!;
    const st = v.stands[si];
    this.stand = si; this.section = -1; this.seat = -1; this.anchor = null; this.follow = null;
    const mid = st.curve.at((st.s0 + st.s1) / 2);
    const c = new THREE.Vector3(st.center.x, st.center.y, st.center.z);
    const span = st.s1 - st.s0;
    const dist = Math.max(70, span * 0.8);
    let y = st.center.y + 22;
    if (st.roof) y = Math.min(y, st.roof.frontH - 2);
    const pos = new THREE.Vector3(c.x - mid.nx * dist, y, c.z - mid.nz * dist);
    const pts = this.inBowlAir(this.camera.position) || this.camera.position.y > v.bounds.maxY + 5 ? [pos] : [new THREE.Vector3(pos.x * 0.6, v.bounds.maxY + 20, pos.z * 0.6), pos];
    const look0 = this.camera.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(40));
    this.run(pts, { kind: 'focus', dur: 1000, end: 'STAND_FOCUS', looks: [look0, c], fov: 40 });
  }

  focusSection(sec: number, onDone?: () => void) {
    const v = this.v!;
    const s = v.sections[sec];
    const st = v.stands[s.stand];
    this.section = sec; this.stand = s.stand; this.seat = -1; this.anchor = null; this.follow = null;
    // vue de trois quarts légèrement plongeante (≈ 25°) : la section se lit avec son contexte, sans masque des panneaux.
    // En portrait, le champ horizontal est étroit : on recule et on ouvre le champ vertical.
    const portrait = this.camera.aspect < 0.85;
    const dist = (20 + s.radius * 1.1) * (portrait ? 1.55 : 1);
    let y = s.center.y + 5 + dist * 0.42;
    if (st.roof) y = Math.min(y, st.roof.frontH - 2.5);
    const side = (s.indexInStand % 2 ? 1 : -1) * dist * 0.18;
    const pos = new THREE.Vector3(s.front.x - s.front.nx * dist - s.front.nz * side, y, s.front.z - s.front.nz * dist + s.front.nx * side);
    const target = new THREE.Vector3(s.center.x, s.center.y + 0.8, s.center.z);
    const pts: THREE.Vector3[] = [];
    const p = this.camera.position;
    if (!this.inBowlAir(p) || p.y > st.topH + 4) {
      const hi = pos.clone().addScaledVector(new THREE.Vector3(-s.front.nx, 0, -s.front.nz), 12);
      hi.y = Math.max(v.bounds.maxY + 12, p.y * 0.7);
      pts.push(hi);
    }
    pts.push(pos);
    const look0 = p.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(40));
    const d = p.distanceTo(pos);
    this.run(pts, { kind: 'focus', dur: Math.max(700, Math.min(1100, 700 + d * 2)), end: 'SECTION_FOCUS', looks: [look0, target], fov: portrait ? 54 : 38, onDone });
  }

  /** Entrée dans un siège depuis n'importe quel point de vue extérieur. */
  approachSeat(i: number, onDone?: () => void): void {
    const v = this.v!;
    if (this.isPOV && this.seat >= 0) return this.switchSeat(i, onDone);
    const eye = this.eyeOf(i);
    const base = this.baseLook(eye);
    this.baseYaw = base.yaw; this.yaw = base.yaw; this.pitch = base.pitch;
    const dir = this.dirOf(this.yaw, this.pitch);
    const p = this.camera.position;
    const pts: THREE.Vector3[] = [];
    const inFront = this.inBowlAir(p) && p.y < v.bounds.maxY;
    if (!inFront) pts.push(this.high(i));
    pts.push(this.front(i, 7, 2.2), this.front(i, 1.6, 0.5), eye);
    const look0 = p.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(40));
    const sec = v.sections[v.section[i]];
    const secC = new THREE.Vector3(sec.center.x, sec.center.y, sec.center.z);
    const dist = p.distanceTo(eye);
    this.seat = i; this.section = v.section[i]; this.stand = v.stand[i]; this.anchor = null; this.follow = null;
    if (this.zoom !== 1) this.setZoom(1);
    this.lookTween = null;
    this.run(pts, {
      kind: 'approach', dur: Math.max(700, Math.min(1600, 700 + dist * 4)), end: 'SEAT_POV', endDir: dir,
      looks: [look0, secC, eye.clone().addScaledVector(dir, 60)], fov: this.fovFor(), onDone,
    });
  }

  /** Changement de siège depuis la vue siège : le style dépend de la distance parcourue. */
  switchSeat(i: number, onDone?: () => void): void {
    const v = this.v!;
    const a = this.seat;
    if (a < 0 || !this.isPOV) return this.approachSeat(i, onDone);
    if (a === i) return;
    const A = this.camera.position.clone();
    const B = this.eyeOf(i);
    const rel = this.freeLook ? 0 : this.yaw - this.baseYaw;
    const base = this.baseLook(B);
    const relClamped = Math.max(-CAMERA.lookLimits.yaw, Math.min(CAMERA.lookLimits.yaw, rel));
    const yaw = base.yaw + relClamped, pitch = this.pitch;
    const endDir = this.dirOf(yaw, pitch);
    const d = A.distanceTo(B);
    const sameStand = v.stand[a] === v.stand[i], sameTier = sameStand && v.tier[a] === v.tier[i];
    // Durées (UI/UX System v1.0) : même rang 350–500 ms, rang voisin 450–650, même bloc 600–850, autre bloc 800–1100.
    const cl = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
    const sameSec = v.section[a] === v.section[i], dRow = Math.abs(v.row[a] - v.row[i]);
    let kind: TransitionKind, pts: THREE.Vector3[], dur: number, looks: THREE.Vector3[] | undefined;
    if (sameSec && dRow === 0 && d < 9) {
      kind = 'slide'; pts = [A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, 0.06, 0)), B]; dur = cl(350 + d * 25, 350, 500);
    } else if (sameSec && dRow === 1 && d < 9) {
      kind = 'hop'; pts = [A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, 0.35, 0)), B]; dur = cl(450 + d * 30, 450, 650);
    } else if (sameSec || (sameTier && d < 14)) {
      kind = 'hop'; pts = [A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, 0.6 + d * 0.04, 0)), B]; dur = cl(600 + d * 12, 600, 850);
    } else if (sameTier) {
      kind = 'glide'; pts = [this.front(a, 2.5, 0.8), this.front(i, 2.5, 0.8), B]; dur = cl(800 + d * 4, 800, 1100);
    } else if (sameStand) {
      kind = 'tier'; pts = [this.front(a, 3.5, 1), this.front(i, 3.5, 1), B]; dur = cl(800 + d * 5, 800, 1100);
    } else {
      // changement de tribune : seul déplacement « majeur » hors révélation (recul, traversée haute, approche)
      const fa = this.front(a, 5, 2), fb = this.front(i, 5, 2);
      const mid = fa.clone().lerp(fb, 0.5); mid.y = Math.max(fa.y, fb.y) + 14;
      kind = 'pullback'; pts = [fa, mid, fb, B]; dur = cl(900 + d * 2.5, 900, 1100);
      if (this.comfort) { kind = 'cut'; pts = [B]; dur = 0; }
      const dirA = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      looks = [A.clone().addScaledVector(dirA, 40), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), B.clone().addScaledVector(endDir, 40)];
    }
    this.seat = i; this.section = v.section[i]; this.stand = v.stand[i];
    this.baseYaw = base.yaw; this.yaw = yaw; this.pitch = pitch;
    this.lookTween = null;
    if (!this.keepZoom && this.zoom !== 1) this.setZoom(1);
    this.run(pts, { kind, dur, end: 'SEAT_POV', endDir, looks, fov: this.fovFor(), onDone });
  }

  /** Suivi direct (curseurs de rang / siège) : la caméra glisse vers l'œil cible sans animation complète. */
  glideTo(i: number) {
    if (!this.isPOV) return this.approachSeat(i);
    const B = this.eyeOf(i);
    const base = this.baseLook(B);
    const rel = this.yaw - this.baseYaw;
    this.seat = i; this.section = this.v!.section[i]; this.stand = this.v!.stand[i];
    this.baseYaw = base.yaw; this.yaw = base.yaw + rel;
    this.glideTarget = B;
  }
  glideTarget: THREE.Vector3 | null = null;

  anchorView(id: AnchorId) {
    const v = this.v!;
    const L2 = v.pitch.length / 2, W2 = v.pitch.width / 2;
    const main = v.stands.find((s) => s.kind === 'main') ?? v.stands[0];
    const mz = main.side === 'N' ? -1 : 1;
    const frontZ = Math.abs(main.curve.at((main.s0 + main.s1) / 2).z);
    let pos: THREE.Vector3, look: THREE.Vector3, state: CamState = 'PITCH_VIEW';
    switch (id) {
      case 'center': pos = new THREE.Vector3(0, 1.72, 0.5); look = new THREE.Vector3(0, 8, mz * 80); break;
      case 'corner': pos = new THREE.Vector3(L2 - 0.7, 1.72, W2 - 0.7); look = new THREE.Vector3(0, 2, 0); break;
      case 'goalLine': pos = new THREE.Vector3(-L2 + 0.3, 1.72, 4.4); look = new THREE.Vector3(0, 3, -6); break;
      case 'bench': pos = new THREE.Vector3(-13, 1.2, mz * (W2 + 3.5)); look = new THREE.Vector3(5, 1.2, 0); state = 'TUNNEL_VIEW'; break;
      case 'tunnel': pos = new THREE.Vector3(0, 1.75, mz * (frontZ + 1.6)); look = new THREE.Vector3(0, 3, 0); state = 'TUNNEL_VIEW'; break;
      case 'roof': {
        const r = main.roof;
        pos = new THREE.Vector3(0, (r ? r.frontH : main.topH) + 2, mz * (frontZ + (r ? r.cover : 6) - 1.5));
        look = new THREE.Vector3(0, 0, -mz * 10); break;
      }
      default: {
        const back = frontZ + main.backD + 45;
        pos = new THREE.Vector3(0, 2, mz * back); look = new THREE.Vector3(0, 18, 0); state = 'TUNNEL_VIEW';
      }
    }
    const p = this.camera.position;
    const pts: THREE.Vector3[] = [];
    if (this.isPOV && this.seat >= 0) pts.push(this.front(this.seat, 5, 2));
    const needHigh = id !== 'entrance' && !(this.inBowlAir(p) && p.y < v.bounds.maxY);
    if (needHigh) pts.push(new THREE.Vector3(pos.x * 0.5, v.bounds.maxY + 18, pos.z * 0.5));
    if (id === 'entrance') pts.push(new THREE.Vector3(pos.x, v.bounds.maxY + 25, pos.z * 1.1));
    pts.push(pos.clone().add(new THREE.Vector3(0, id === 'roof' ? 6 : 9, 0)), pos);
    const dir = look.clone().sub(pos).normalize();
    this.yaw = this.baseYaw = Math.atan2(dir.x, dir.z); this.pitch = Math.asin(dir.y);
    this.seat = -1; this.anchor = id; this.follow = null;
    this.run(pts, { kind: 'anchor', dur: 1900, end: state, endDir: dir, fov: this.fovFor('natural') });
  }

  playerView(get: () => { pos: THREE.Vector3; look: THREE.Vector3 }) {
    const g = get();
    this.seat = -1; this.anchor = null;
    const pts = [new THREE.Vector3(g.pos.x * 0.5, 30, g.pos.z * 0.5), g.pos.clone().add(new THREE.Vector3(0, 6, 0)), g.pos];
    this.run(pts, { kind: 'anchor', dur: 1600, end: 'PLAYER_VIEW', endDir: g.look.clone().sub(g.pos).normalize(), fov: this.fovFor('natural'), onDone: () => { this.follow = get; } });
  }

  /** Choregraphie libre (révélation) : chemin + regard + durée. */
  path(pts: THREE.Vector3[], looks: THREE.Vector3[], dur: number, opts: { end?: CamState; endDir?: THREE.Vector3; fov?: number; onDone?: () => void } = {}) {
    this.run(pts, { kind: 'anchor', dur, end: opts.end ?? 'REVEAL', looks, endDir: opts.endDir, fov: opts.fov, onDone: opts.onDone });
  }
  enterReveal() { this.follow = null; this.setState('REVEAL'); }
  /** Termine une révélation directement dans un siège. */
  settleInSeat(i: number) {
    const eye = this.eyeOf(i);
    const b = this.baseLook(eye);
    this.seat = i; this.section = this.v!.section[i]; this.stand = this.v!.stand[i];
    this.baseYaw = this.yaw = b.yaw; this.pitch = b.pitch;
    this.camera.position.copy(eye);
    this.camera.quaternion.copy(this.quatLooking(eye, this.dirOf(this.yaw, this.pitch)));
    this.camera.fov = this.fovFor(); this.camera.updateProjectionMatrix();
    this.transition = null;
    this.setState('SEAT_POV');
  }

  // ---------- regard ----------

  lookBy(dxPx: number, dyPx: number, viewH: number) {
    this.userLook();
    const k = ((this.camera.fov * Math.PI) / 180) / viewH;
    this.lookVel.yaw = dxPx * k; this.lookVel.pitch = dyPx * k;
    this.applyLook(this.yaw + dxPx * k, this.pitch + dyPx * k);
  }
  applyLook(yaw: number, pitch: number) {
    const L = CAMERA.lookLimits;
    if (!this.freeLook && this.state === 'SEAT_POV') yaw = this.baseYaw + Math.max(-L.yaw, Math.min(L.yaw, yaw - this.baseYaw));
    this.yaw = yaw;
    this.pitch = Math.max(-L.pitchDown, Math.min(L.pitchUp, pitch));
  }
  /** Saisie de regard par l'utilisateur : la saisie manuelle l'emporte toujours sur l'automatisme. */
  userLook() {
    this.lookTween = null;
    if (this.followPlay !== 'off') { this.followPlay = 'off'; this.onUserLook(); }
  }

  /** Direction (lacet, tangage) depuis l'œil courant vers un point du monde. */
  anglesTo(p: THREE.Vector3) {
    const d = p.clone().sub(this.camera.position);
    return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
  }

  /** Oriente le regard en douceur vers un point (recentrer sur le jeu), dans les limites de rotation de la tête. */
  lookToward(p: THREE.Vector3, ms = 450) {
    const a = this.anglesTo(p);
    let dy = a.yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const L = CAMERA.lookLimits;
    let y1 = this.yaw + dy;
    if (!this.freeLook && this.state === 'SEAT_POV') y1 = this.baseYaw + Math.max(-L.yaw, Math.min(L.yaw, y1 - this.baseYaw));
    const p1 = Math.max(-L.pitchDown, Math.min(L.pitchUp, a.pitch));
    this.stopFling();
    if (this.reduced || ms <= 0) { this.yaw = y1; this.pitch = p1; this.lookTween = null; return; }
    this.lookTween = { y0: this.yaw, p0: this.pitch, y1, p1, t0: performance.now(), dur: ms };
  }

  /** Écart du regard par rapport à la direction naturelle de la place (rad) : sert à proposer « Recentrer ». */
  lookDeviation() { return { yaw: Math.abs(this.yaw - this.baseYaw), pitch: this.pitch, zoom: this.zoom }; }

  /** Pose d'une seconde caméra (comparaison côte à côte, incrustation) : même regard relatif depuis une autre place. */
  poseFor(i: number, cam: THREE.PerspectiveCamera) {
    const eye = this.eyeOf(i);
    const b = this.baseLook(eye);
    const yaw = b.yaw + (this.isPOV ? this.yaw - this.baseYaw : 0), pitch = this.isPOV ? this.pitch : b.pitch;
    cam.position.copy(eye);
    cam.quaternion.copy(this.quatLooking(eye, this.dirOf(yaw, pitch)));
    const f = this.isPOV ? this.camera.fov : this.fovFor();
    if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
  }

  /** Lancer du regard (rad/s) au relâchement d'un glisser rapide. */
  fling(vyaw: number, vpitch: number) { if (!this.reduced) { this.userLook(); this.lookFling.yaw = vyaw; this.lookFling.pitch = vpitch; } }
  stopFling() { this.lookFling.yaw = this.lookFling.pitch = 0; }
  setFov(mode: FovMode) { this.fovMode = mode; if (this.isPOV) { this.camera.fov = this.fovFor(); this.camera.updateProjectionMatrix(); } }
  setPosture(p: Posture, viewer: Viewer = this.viewer) {
    this.posture = p; this.viewer = viewer;
    if (this.state === 'SEAT_POV' && this.seat >= 0) {
      const B = this.eyeOf(this.seat);
      this.run([B], { kind: 'slide', dur: 450, end: 'SEAT_POV', endDir: this.dirOf(this.yaw, this.pitch), fov: this.fovFor() });
    }
  }
  kick(amount = 1) { if (!this.reduced) this.shake = Math.max(this.shake, amount); }

  viewpoint(): Viewpoint {
    return { state: this.state, seat: this.seat, section: this.section, pos: this.camera.position.clone(), target: this.controls.target.clone(), yaw: this.yaw, pitch: this.pitch, anchor: this.anchor ?? undefined };
  }

  resize() {
    this.updateHome();
    this.applyViewOffset();
    if (this.isPOV) { this.camera.fov = this.fovFor(); this.camera.updateProjectionMatrix(); }
  }

  // ---------- boucle ----------

  update(dt: number) {
    const cam = this.camera;
    const tr = this.transition;
    if (tr) {
      const raw = tr.dur ? Math.min(1, (performance.now() - tr.t0) / tr.dur) : 1;
      const e = tr.kind === 'slide' ? easeInOutSine(raw) : tr.kind === 'overview' ? easeInOutCubic(raw) : tr.kind === 'focus' ? easeOutQuart(raw) : easeInOutCubic(raw);
      if (tr.curve) cam.position.copy(tr.curve.getPointAt(e)); else cam.position.copy(tr.to);
      if (tr.look) {
        const lp = tr.look.getPointAt(e);
        if (tr.q1 && e > 0.75) {
          const qa = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, lp, new THREE.Vector3(0, 1, 0)));
          cam.quaternion.copy(qa.slerp(tr.q1, (e - 0.75) / 0.25));
        } else cam.lookAt(lp);
      } else if (tr.q1) cam.quaternion.slerpQuaternions(tr.q0, tr.q1, e);
      // champ légèrement plus large pendant le déplacement, naturel à l'arrivée
      const travel = tr.kind === 'slide' || tr.kind === 'hop' || tr.kind === 'glide' || tr.kind === 'tier' || tr.kind === 'pullback' ? 1 + 0.06 * Math.sin(Math.PI * e) : 1;
      cam.fov = (tr.fov0 + (tr.fov1 - tr.fov0) * e) * travel;
      cam.updateProjectionMatrix();
      if (raw >= 1) this.finish();
    } else if (this.follow && this.state === 'PLAYER_VIEW') {
      const f = this.follow();
      cam.position.lerp(f.pos, Math.min(1, dt * 6));
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, f.look, new THREE.Vector3(0, 1, 0)));
      cam.quaternion.slerp(q, Math.min(1, dt * 4));
    } else if (this.def.look) {
      if (this.glideTarget) {
        cam.position.lerp(this.glideTarget, Math.min(1, dt * 10));
        if (cam.position.distanceTo(this.glideTarget) < 0.01) this.glideTarget = null;
      }
      if (this.lookTween) {
        const t = this.lookTween, k = Math.min(1, (performance.now() - t.t0) / t.dur), e = easeInOutCubic(k);
        this.yaw = t.y0 + (t.y1 - t.y0) * e; this.pitch = t.p0 + (t.p1 - t.p0) * e;
        if (k >= 1) this.lookTween = null;
      } else if (this.followPlay !== 'off' && this.followTarget && this.state === 'SEAT_POV') {
        // suivi : mouvement de tête doux et borné ; le jeu plus lent que le ballon
        const p = this.followTarget(this.followPlay);
        if (p) {
          const a = this.anglesTo(p);
          let dy = a.yaw - this.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          const L = CAMERA.lookLimits;
          const gain = Math.min(1, dt * (this.followPlay === 'ball' ? 1.6 : 0.8));
          const yawGoal = this.baseYaw + Math.max(-L.yaw, Math.min(L.yaw, this.yaw + dy - this.baseYaw));
          this.yaw += (yawGoal - this.yaw) * gain;
          this.pitch += (Math.max(-L.pitchDown, Math.min(L.pitchUp, a.pitch)) - this.pitch) * gain * 0.6;
        }
      }
      // inertie du regard après un lancer (décroissance rapide, jamais de rotation infinie)
      if (Math.abs(this.lookFling.yaw) + Math.abs(this.lookFling.pitch) > 0.002) {
        this.applyLook(this.yaw + this.lookFling.yaw * dt, this.pitch + this.lookFling.pitch * dt);
        const k = Math.pow(0.02, dt);
        this.lookFling.yaw *= k; this.lookFling.pitch *= k;
      }
      cam.quaternion.copy(this.quatLooking(cam.position, this.dirOf(this.yaw, this.pitch)));
      const f = this.fovFor() / this.zoom;
      if (Math.abs(cam.fov - f) > 0.01) { cam.fov += (f - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
    } else if (this.def.orbit) {
      // pincement / molette non linéaires : précis de près, ample de loin
      const dist = this.camera.position.distanceTo(this.controls.target);
      this.controls.zoomSpeed = Math.max(0.45, Math.min(1.3, 0.35 + dist / 260));
      this.controls.update();
      this.avoidStructures();
    }
    // vision humaine : en vue siège, le centre optique reste au centre de l'écran (pas de décalage quand le HUD s'estompe)
    const offGoal = this.def.look || this.state === 'SEAT_SWITCH' || this.state === 'SEAT_APPROACH' || this.state === 'REVEAL' ? this.zero2 : this.offTarget;
    if (this.offCur.distanceToSquared(offGoal) > 0.25 || (this.camera.view?.enabled ?? false) !== (offGoal.lengthSq() > 0.25)) {
      this.offCur.lerp(offGoal, Math.min(1, dt * 7));
      if (this.offCur.distanceToSquared(offGoal) < 0.25) this.offCur.copy(offGoal);
      this.applyViewOffset();
    }
    if (this.shake > 0 && !this.comfort) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * 0.04;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    if (dt > 0) this.vel.copy(cam.position).sub(this.lastPos).divideScalar(dt);
    this.lastPos.copy(cam.position);
  }

  /** Empêche l'orbite de traverser les gradins ou les toits. */
  private avoidStructures() {
    if (!this.v) return;
    const p = this.camera.position;
    if (p.y < 0.8) p.y = 0.8;
    if (this.inBowlAir(p)) return;
    const top = seatsNear(this.v, p.x, p.z, 5);
    if (top >= 0 && p.y < top + 3) p.y = top + 3;
    for (const st of this.v.stands) {
      if (!st.roof) continue;
      const lo = st.roof.frontH - 1, hi = st.roof.frontH + 1.2;
      if (p.y > lo && p.y < hi && seatsNear(this.v, p.x, p.z, 3) >= 0) p.y = hi;
    }
  }
}
