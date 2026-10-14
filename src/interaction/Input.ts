import type { CameraDirector } from '../camera/CameraDirector';

export type GestureMode = 'orbit' | 'look' | 'move' | 'locked';

export interface InputHandlers {
  tap(x: number, y: number, touch: boolean): void;
  doubleTap(x: number, y: number, touch: boolean): void;
  /** Appui long immobile (≈ 0,45 s) : aperçu ; relâcher le referme. */
  longPress(x: number, y: number): void;
  longPressEnd(): void;
  hover(x: number, y: number): void;
  hoverEnd(): void;
  /** Mode Déplacer : un pas de place (gauche/droite) ou de rang (avant/arrière). */
  moveStep(dir: 'left' | 'right' | 'forward' | 'back'): void;
  /** Balayage rapide horizontal (comparaison mobile A/B). */
  swipe(dir: 'left' | 'right'): void;
  /** Toute interaction : réveille le HUD, interrompt la dérive d'ouverture. */
  interacted(): void;
}

interface Down {
  id: number; x: number; y: number; t: number; lx: number; ly: number; lt: number; touch: boolean; moved: boolean;
  vx: number; vy: number; accX: number; accY: number; axis: 'x' | 'y' | null; edge: boolean; long: boolean; timer: number;
}

/** Marge des bords réservée aux gestes du système (retour iOS, barre de gestes) : aucun geste personnalisé n'y commence (§27). */
const EDGE = 22;
/** Distance minimale avant de décider d'un axe, et confiance exigée (rapport axe dominant / axe secondaire) (§25). */
const AXIS_MIN = 14, AXIS_CONF = 1.6;

/**
 * Saisie : les gestes changent de sens selon le mode (UI/UX v1.0, addendum mobile).
 *  • orbit : OrbitControls (vitesse adaptée par la caméra), tap = sélection, survol = anticipation, appui long = aperçu.
 *  • look  : glisser = regarder (avec lancer et inertie), tap = viser une place visible. Pas de double toucher pour se déplacer.
 *  • move  : axe verrouillé dès qu'il est clair (horizontal = places, vertical = rangs) ; un pas tous les ~36 px ;
 *            un petit geste accidentel ne déplace rien ; tap sur une place = s'y rendre.
 * Les temps viennent de l'horodatage des événements (robuste aux images lentes).
 */
export class Input {
  private downs = new Map<number, Down>();
  private lastTap = { t: 0, x: 0, y: 0 };
  private hoverPos: { x: number; y: number } | null = null;
  private hoverRaf = 0;
  private pinch: { d: number; zoom: number } | null = null;
  enabled = true;

  constructor(private el: HTMLElement, private dir: CameraDirector, private h: InputHandlers, private mode: () => GestureMode) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => { this.end(e.pointerId); this.pinch = null; });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { this.hoverPos = null; this.h.hoverEnd(); } });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private end(id: number) {
    const d = this.downs.get(id);
    if (d) { clearTimeout(d.timer); if (d.long) this.h.longPressEnd(); }
    this.downs.delete(id);
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    this.h.interacted();
    this.dir.stopFling();
    const touch = e.pointerType !== 'mouse';
    const r = this.el.getBoundingClientRect();
    const edge = touch && (e.clientX - r.left < EDGE || r.right - e.clientX < EDGE || r.bottom - e.clientY < EDGE);
    const d: Down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, touch, moved: false, vx: 0, vy: 0, accX: 0, accY: 0, axis: null, edge, long: false, timer: 0 };
    this.downs.set(e.pointerId, d);
    const m = this.mode();
    if (touch && this.downs.size === 1 && m !== 'locked') {
      d.timer = window.setTimeout(() => { if (!d.moved && this.downs.get(d.id) === d && this.downs.size === 1) { d.long = true; this.h.longPress(d.x, d.y); } }, 460);
    } else for (const o of this.downs.values()) clearTimeout(o.timer);
    if (m === 'look' || m === 'move') {
      try { this.el.setPointerCapture(e.pointerId); } catch { /* ignoré */ }
      if (this.downs.size === 2) {
        const [a, b] = [...this.downs.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.dir.zoom };
      }
    }
  }

  private move(e: PointerEvent) {
    const d = this.downs.get(e.pointerId);
    const m = this.mode();
    if (!d) {
      if (e.pointerType === 'mouse' && this.enabled) {
        this.hoverPos = { x: e.clientX, y: e.clientY };
        if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(() => { this.hoverRaf = 0; if (this.hoverPos) this.h.hover(this.hoverPos.x, this.hoverPos.y); });
      }
      return;
    }
    const dx = e.clientX - d.lx, dy = e.clientY - d.ly, dtm = Math.max(1, e.timeStamp - d.lt);
    d.vx = d.vx * 0.6 + (dx / dtm) * 0.4; d.vy = d.vy * 0.6 + (dy / dtm) * 0.4;
    d.lx = e.clientX; d.ly = e.clientY; d.lt = e.timeStamp;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (d.touch ? 10 : 5)) { d.moved = true; clearTimeout(d.timer); }
    // minuterie déclenchée en retard (image lente) alors que le doigt bougeait déjà : ce n'était pas un appui long
    if (d.long && d.moved && e.timeStamp - d.t < 420) { d.long = false; this.h.longPressEnd(); }
    if (d.long) return;
    if (this.pinch && this.downs.size === 2) {
      const [a, b] = [...this.downs.values()];
      const nd = Math.hypot(a.lx - b.lx, a.ly - b.ly);
      // pincement non linéaire : précis près de ×1, plus ample ensuite
      const k = nd / Math.max(20, this.pinch.d);
      this.dir.setZoom(this.pinch.zoom * Math.pow(k, this.pinch.zoom < 1.3 ? 0.8 : 1.1));
      return;
    }
    if (m === 'look') {
      // sensibilité progressive : précis lentement, plus ample quand le geste est rapide
      const speed = Math.hypot(d.vx, d.vy);
      const gain = (1 + Math.min(0.6, speed * 0.25)) / this.dir.zoom;
      this.dir.lookBy(-dx * gain, dy * gain * 0.85, this.el.clientHeight);
    } else if (m === 'move' && d.moved && !d.edge) {
      const tx = e.clientX - d.x, ty = e.clientY - d.y;
      // axe décidé seulement quand il est net, puis verrouillé pour tout le geste (§25–26)
      if (!d.axis) {
        const ax = Math.abs(tx), ay = Math.abs(ty);
        if (Math.max(ax, ay) < AXIS_MIN) return;
        if (ax > ay * AXIS_CONF) d.axis = 'x'; else if (ay > ax * AXIS_CONF) d.axis = 'y'; else return;
        d.accX = tx; d.accY = ty;
      } else { d.accX += dx; d.accY += dy; }
      const step = d.touch ? 36 : 44;
      while (d.axis === 'x' && Math.abs(d.accX) >= step) { this.h.moveStep(d.accX > 0 ? 'right' : 'left'); d.accX -= Math.sign(d.accX) * step; }
      while (d.axis === 'y' && Math.abs(d.accY) >= step) { this.h.moveStep(d.accY < 0 ? 'forward' : 'back'); d.accY -= Math.sign(d.accY) * step; }
    }
  }

  private up(e: PointerEvent) {
    const d = this.downs.get(e.pointerId);
    this.end(e.pointerId);
    if (this.downs.size < 2) this.pinch = null;
    if (!d || !this.enabled) return;
    const dt = e.timeStamp - d.t;
    // l'appui long n'est jamais un toucher ; mais si la minuterie s'est déclenchée en retard (image lente),
    // l'horodatage matériel fait foi : un toucher bref reste un toucher
    if (d.long && dt >= 420) return;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const m = this.mode();
    if (!d.moved && dist < (d.touch ? 10 : 6) && dt < 450) {
      const now = e.timeStamp;
      if (now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 36) {
        this.lastTap.t = 0;
        this.h.doubleTap(e.clientX, e.clientY, d.touch);
      } else {
        this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        this.h.tap(e.clientX, e.clientY, d.touch);
      }
      return;
    }
    // balayage rapide (comparaison mobile) : distance, vitesse et direction franches, jamais depuis un bord
    const vx = (e.clientX - d.x) / Math.max(1, dt);
    if (!d.edge && dt < 320 && Math.abs(vx) > 0.45 && Math.abs(e.clientX - d.x) > 60 && Math.abs(e.clientX - d.x) > Math.abs(e.clientY - d.y) * 1.8) this.h.swipe(vx > 0 ? 'right' : 'left');
    if (m === 'look' && e.timeStamp - d.lt < 60) {
      const k = ((this.dir.camera.fov * Math.PI) / 180) / this.el.clientHeight / this.dir.zoom;
      this.dir.fling(-d.vx * 1000 * k * 0.5, d.vy * 1000 * k * 0.4);
    }
  }

  private wheel(e: WheelEvent) {
    const m = this.mode();
    if (m === 'look' || m === 'move') {
      e.preventDefault();
      this.h.interacted();
      this.dir.setZoom(this.dir.zoom * Math.exp(-e.deltaY * 0.0015));
    }
  }
}
