import * as THREE from 'three';
import { Engine } from '../engine/Engine';
import type { CameraDirector, AnchorId } from '../camera/CameraDirector';
import { VENUES, VENUE_ORDER, resolveVenue } from '../config/venues';
import { EVENTS, REVEALS } from '../config/events';
import { PRODUCT } from '../config/product';
import type { EnvironmentSpec, MatchState, RevealConfig, TimePreset } from '../config/types';
import { ModeMachine, BACK_OF, type ExperienceMode } from './modes';
import { Store } from './Store';
import { EventDirector } from './EventDirector';
import { RevealDirector } from '../reveal/RevealDirector';
import { Atmosphere } from '../engine/Atmosphere';
import { Input, type GestureMode } from '../interaction/Input';
import { pickCandidates } from '../engine/Picking';
import { neighbor, parseSeatId, seatId } from '../venue/generate';
import type { SeatColorMode } from '../engine/SeatLayer';
import type { CrowdDensity } from '../engine/CrowdLayer';
import { betterNearby, recommend, seatSpeech, seatSummary, seatTitle, eur, quality, sunStory, SessionPreference, sectionBadges, povFactBar, OBS_LABEL, BADGE_TEXT, type Intent, type SeatCtx, type Cond } from './intelligence';
import { Hud, envLabel } from './Hud';
import { ViewportInsets } from '../ui/ViewportInsets';
import { WorldOverlay, type WorldLabel } from '../ui/components/WorldOverlay';
import { MiniMap } from '../ui/components/MiniMap';
import { Sheet } from '../ui/components/Sheet';
import { announce, esc, icon } from '../ui/dom';
import * as V from '../ui/views';
import { PRESET_LABEL } from '../environment/EnvironmentEngine';

export type Layout = 'desktop' | 'mobile' | 'landscape';
export type Device = 'desktop' | 'tablet' | 'phone';
export type BuildFlavor = 'public' | 'presentation' | 'lab';

export interface Prefs { reduced: boolean; comfort: boolean; contrast: boolean; text: 'md' | 'lg' | 'xl'; captions: boolean; sound: 'off' | 'low' | 'full' }

/** Drapeaux de fonctionnalités : chaque fonction optionnelle peut être coupée sans casser l'expérience. */
export const FLAGS = { players: true, crowd: true, audio: true, rain: true, fog: true, postprocessing: true, scoreboards: true, reveal: true, heatmaps: true, advancedCameras: true };

const PANEL_ANCHOR: Record<string, string> = {
  venues: 'top-left', env: 'top', more: 'top', a11y: 'top', help: 'top', favs: 'top', reveal: 'top', where: 'top-left', event: 'top-center',
  explore: 'dock', find: 'dock', views: 'dock', pov: 'dock', browser: 'center',
};

/** Préférences de session (§73) : conservées au rechargement de l'onglet, jamais au-delà. */
function sessionGet<T>(k: string, d: T): T { try { const v = sessionStorage.getItem(`vantage.${k}`); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } }
function sessionSet(k: string, v: unknown) { try { sessionStorage.setItem(`vantage.${k}`, JSON.stringify(v)); } catch { /* stockage indisponible : mémoire seule */ } }

/** Environnement nommé (liens profonds, présentation). */
export function envPreset(name: string, presetMinutes: (p: TimePreset) => number): Partial<EnvironmentSpec> {
  const day = presetMinutes('afternoon');
  switch (name) {
    case 'morning': return { minutes: presetMinutes('morning'), clouds: 'clear', rain: 'none', fog: 0.15 };
    case 'midday': return { minutes: presetMinutes('midday'), clouds: 'clear', rain: 'none', fog: 0 };
    case 'golden': return { minutes: presetMinutes('golden'), clouds: 'partly', rain: 'none', fog: 0 };
    case 'sunset': return { minutes: presetMinutes('sunset'), clouds: 'partly', rain: 'none', fog: 0 };
    case 'blue': return { minutes: presetMinutes('blue'), clouds: 'clear', rain: 'none', fog: 0 };
    case 'night': return { minutes: presetMinutes('night'), clouds: 'clear', rain: 'none', fog: 0 };
    case 'cloud': case 'cloudy': case 'overcast': return { clouds: 'overcast', rain: 'none' };
    case 'rain': return { clouds: 'overcast', rain: 'rain' };
    case 'heavy': return { clouds: 'overcast', rain: 'heavy' };
    case 'nightrain': return { minutes: presetMinutes('night'), clouds: 'overcast', rain: 'rain' };
    case 'fog': return { clouds: 'overcast', rain: 'none', fog: 0.7 };
    default: return { minutes: day, clouds: 'clear', rain: 'none', fog: 0, wind: 0.3, lights: 'auto' };
  }
}

/**
 * Contrôleur de l'expérience : relie le moteur 3D, la machine d'états, l'intelligence de sélection et l'interface.
 * L'interface n'est redessinée que sur changement d'état ; seules les étiquettes du monde et la mini-carte suivent l'image.
 */
export class App {
  readonly e: Engine;
  readonly d: CameraDirector;
  readonly modes = new ModeMachine();
  readonly audio = new Atmosphere();
  readonly events: EventDirector;
  readonly reveal: RevealDirector;
  readonly pref = new SessionPreference();
  readonly store = new Store({ tick: 0 });
  readonly telemetry: Array<{ t: number; name: string; data?: string }> = [];
  readonly el: Record<string, HTMLElement>;
  readonly insets: ViewportInsets;
  readonly world: WorldOverlay;
  readonly mini: MiniMap;
  readonly sheet: Sheet;
  readonly input: Input;
  readonly hud: Hud;
  layout: Layout = 'desktop';
  device: Device = 'desktop';
  narrow = false; short = false;
  touch = false;
  /** Places récentes de la session (§70) et comparaison mise de côté (§72). */
  recent: number[] = [];
  parked: { a: number; b: number } | null = null;
  split = false;
  fullscreenPref = sessionGet('fullscreen', false);
  venueId = 'arena';
  eventId = 'night';
  seat = -1; section = -1; stand = -1;
  hoverSeat = -1; hoverSection = -1; ghostSeat = -1; candidate = -1;
  compareA = -1; compareB = -1; compareView: 'a' | 'b' = 'a';
  intent: Intent = 'view';
  heat: SeatColorMode = 'stand';
  crowd: CrowdDensity = 'real';
  panel: string | null = null;
  private panelReturn: HTMLElement | null = null;
  browser = { stand: -1, section: -1, row: -1 };
  expanded = false;
  infoOpen = false;
  anchorLabel = '';
  prefs: Prefs = { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, comfort: false, contrast: matchMedia('(prefers-contrast: more)').matches, text: 'md', captions: false, sound: 'off' };
  private hintsShown = new Set<string>();
  lastInputAt = performance.now();
  private opening = false;
  busy = false;
  private nearbyCache = new Map<string, ReturnType<typeof betterNearby>>();
  private marks = new Map<number, 'selected' | 'candidate' | 'compare'>();
  /** Crochets (présentation, lab) appelés après chaque rendu d'interface. */
  onRender: Array<() => void> = [];
  onModeChange: Array<(m: ExperienceMode) => void> = [];

  constructor(readonly build: BuildFlavor, readonly opts: { presentation: boolean; capture: boolean; record: boolean }) {
    // un élément absent d'une construction (présentateur, Lab dans la version publique) est remplacé par un nœud détaché
    const $ = (id: string) => document.getElementById(id) ?? document.createElement('div');
    this.el = {
      app: $('app'), canvas: $('c'), world: $('world'), top: $('tophud'), dock: $('dock'), mini: $('minimap'), card: $('card'), panel: $('panel'),
      sheet: $('sheet'), sheetBody: $('sheetBody'), sheetGrab: $('sheetGrab'), move: $('movehud'), compare: $('compare'), ghost: $('ghost'),
      hint: $('hint'), tip: $('tip'), toast: $('toast'), caption: $('caption'), veil: $('veil'), rvTitle: $('rvTitle'), rvSkip: $('rvSkip'),
      rvDone: $('rvDone'), presenter: $('presenter'), lab: $('lab'), loader: $('loader'), loaderMsg: $('loaderMsg'), recover: $('recover'), labBtn: $('labBtn'),
      evchip: $('evchip'), flash: $('flash'), facts: $('facts'), recenter: $('recenter'), undo: $('undo'), envstrip: $('envstrip'), cands: $('cands'),
      peek: $('peek'), zoomchip: $('zoomchip'), pip: $('pip'), splitlab: $('splitlab'),
    };
    const saved = sessionGet<Partial<Prefs>>('prefs', {});
    Object.assign(this.prefs, saved);
    document.documentElement.style.setProperty('--accent', PRODUCT.theme.accent);
    this.el.app.style.setProperty('--accent', PRODUCT.theme.accent);
    this.e = new Engine(this.el.canvas as HTMLCanvasElement);
    this.d = this.e.director;
    this.events = new EventDirector(this.e, this.audio);
    this.events.onScored = () => this.hud?.onGoal();
    this.events.onMoment = (m) => this.caption(m === 'goal' ? 'Clameur du public : but !' : m === 'chant' ? 'Chants et applaudissements' : m === 'chance' ? 'Le public se lève' : '');
    this.reveal = new RevealDirector(this.e, {
      veil: (o, ms) => { const v = this.el.veil; v.style.transitionDuration = `${this.prefs.reduced ? 1 : ms}ms`; v.style.opacity = String(o); },
      title: (m, s, kind) => { const t = this.el.rvTitle; t.className = `rv-title ${kind ?? ''}`; t.innerHTML = `<span class="m">${esc(m)}</span>${s ? `<span class="s">${esc(s)}</span>` : ''}`; void t.offsetWidth; t.classList.add('on'); announce(`${m}${s ? `, ${s}` : ''}`); },
      clearTitle: () => this.el.rvTitle.classList.remove('on'),
      skipVisible: (on) => this.el.rvSkip.classList.toggle('on', on),
      finale: (i) => this.revealFinale(i),
      haptic: (ms) => { if (this.touch) navigator.vibrate?.(ms); },
    });
    this.insets = new ViewportInsets(this.el.app);
    this.insets.onChange = (i) => this.d.setInsets(i);
    this.world = new WorldOverlay(this.el.world);
    // une étiquette n'est jamais montrée à travers une tribune ou un toit (§42) : on échantillonne le segment
    const P = new THREE.Vector3();
    this.world.occluded = (from, to) => {
      if (this.d.isPOV) return false;
      for (let k = 2; k < 15; k++) { P.lerpVectors(from, to, k / 16); if (this.d.blocked(P)) return true; }
      return false;
    };
    this.mini = new MiniMap(this.el.mini, $('miniCanvas') as HTMLCanvasElement);
    this.mini.onPick = (s) => this.focusSection(s);
    this.sheet = new Sheet(this.el.sheet, this.el.sheetGrab);
    this.sheet.onSnap = () => { this.insets.schedule(); this.renderCard(); };
    this.hud = new Hud(this);
    this.hud.showEvent = sessionGet('event', true);
    this.input = new Input(this.el.canvas, this.d, {
      tap: (x, y, t) => this.onTap(x, y, t),
      doubleTap: (x, y, t) => this.onDoubleTap(x, y, t),
      longPress: (x, y) => this.onLongPress(x, y),
      longPressEnd: () => this.hud.unpeek(),
      hover: (x, y) => this.onHover(x, y),
      hoverEnd: () => this.clearHover(),
      moveStep: (dir) => this.step(dir),
      swipe: (dir) => { if (this.modes.mode === 'compare' && this.compareB >= 0 && this.layout === 'mobile') this.viewCompare(dir === 'left' ? 'b' : 'a'); },
      interacted: () => this.interacted(),
    }, () => this.gestureMode());
    this.publishSurfaces();
    this.bindDom();
    this.modes.on((m, prev) => {
      this.el.app.dataset.mode = m;
      this.hideGhost();
      if (m !== 'compare') { this.split = false; this.e.setSecondary(null); this.el.splitlab.hidden = true; }
      this.render();
      this.hud.onMode(m, prev);
      this.onModeChange.forEach((f) => f(m));
    });
    this.d.onUserLook = () => { this.hud.flash('Suivi du jeu interrompu', 1200, 1); if (this.panel === 'pov') this.renderPanel(); };
    this.d.onZoom = () => this.hud.renderZoom();
    this.d.followTarget = (k) => (k === 'ball' && this.e.players?.ballVisible ? this.e.players.ballPosition.clone().setY(0.6) : this.e.players ? this.e.players.actionPoint() : null);
    this.e.onFrame((dt) => this.frame(dt));
    // l'icône météo du HUD suit l'ambiance interpolée (≤ 4 Hz, seulement si elle change)
    let lastIcon = '';
    this.e.env.onLive = (l) => {
      const amb = l.daylight < 0.35 ? 'night' : 'day';
      if (this.el.app.dataset.ambient !== amb) this.el.app.dataset.ambient = amb;
      const ic = `${V.envIcon(this.e.env.spec, l.daylight)}:${Math.round(l.minutes / 5)}`;
      if (ic !== lastIcon && !this.el.top.contains(document.activeElement)) { lastIcon = ic; if (!this.d.isPOV) this.renderTop(); }
    };
    this.d.onCut = () => this.flashVeil();
    this.detectLayout();
    addEventListener('resize', () => this.detectLayout());
    // barres d'outils mobiles, clavier, rotation : la zone visible change sans « resize » fiable partout
    window.visualViewport?.addEventListener('resize', () => this.detectLayout());
    addEventListener('orientationchange', () => window.setTimeout(() => this.detectLayout(), 120));
    document.addEventListener('fullscreenchange', () => { this.detectLayout(); this.e.resize(); if (this.panel) this.renderPanel(); });
    this.applyPrefs();
  }

  ctx(): SeatCtx { return { v: this.e.venue!, sm: this.e.statics!, em: this.e.metrics!, ev: this.e.event, cond: this.cond() }; }

  /** Conditions du moment, en paliers (la pluie à partir d'une averse réelle, le soleil seulement s'il est fort). */
  cond(): Cond {
    const L = this.e.env.live, s = this.e.env.spec;
    const rain = s.rain !== 'none' ? Math.min(1, Math.max(0.5, L.rain * 1.5)) : 0;
    const sun = s.rain === 'none' && s.clouds !== 'overcast' && L.daylight > 0.85 && L.sunAlt > 25 ? 1 : 0;
    return { rain, sun, daylight: L.daylight, night: L.daylight < 0.35 };
  }
  private condKey() { const c = this.cond(); return `${c.rain ? 'r' : ''}${c.sun ? 's' : ''}`; }

  sectionBadges(sec: number) { return sectionBadges(this.ctx(), sec); }

  /** Cible de « Recentrer sur le jeu » : l'action si le match se joue, sinon le centre du terrain. */
  playTarget() {
    const p = this.e.players;
    if (p && this.e.playersOn && p.ballVisible && p.state !== 'halftime') return p.actionPoint().clone().setY(1);
    return new THREE.Vector3(0, 1, 0);
  }

  haptic(ms: number) { if (this.touch) try { navigator.vibrate?.(ms); } catch { /* sans vibration */ } }
  get ready() { return !!this.e.venue && !this.busy; }

  track(name: string, data?: string) {
    this.telemetry.push({ t: Math.round(performance.now()), name, data });
    if (this.telemetry.length > 300) this.telemetry.shift();
  }

  // ------------------------------------------------------------------ démarrage

  async start(q: URLSearchParams) {
    const vid = resolveVenue(q.get('v') ?? q.get('venue')) ?? 'arena';
    const own = (o: object, k: string | null): k is string => k !== null && Object.prototype.hasOwnProperty.call(o, k);
    const ev = q.get('event');
    this.eventId = own(EVENTS, ev) ? ev : 'night';
    if (this.opts.record || this.opts.capture) { this.events.enabled = false; }
    this.loaderProgress('Préparation de votre vue…', 0.1);
    // ?t= is minutes after midnight: only finite values in 0–1439 are honoured.
    const tRaw = q.get('t');
    const tNum = tRaw !== null && /^\d{1,4}$/.test(tRaw) ? Number(tRaw) : NaN;
    await this.loadVenue(vid, { first: true, env: q.get('env') ?? undefined, minutes: tNum >= 0 && tNum < 1440 ? tNum : undefined });
    const seatParam = q.get('seat');
    const scenario = q.get('scenario');
    const rv = q.get('reveal');
    this.hideLoader();
    // préchargement des autres stades pendant les temps morts : les changements en démonstration sont immédiats
    window.setTimeout(() => this.e.prefetch(VENUE_ORDER.filter((id) => id !== this.venueId).map((id) => VENUES[id])), 4000);
    if (seatParam) {
      const i = parseSeatId(this.e.venue!, seatParam);
      if (i >= 0) {
        (q.get('mode') === 'seat') ? this.selectSeat(i, { instant: true }) : this.gotoSeat(i, { instant: true });
        const b = q.get('cmp') ? parseSeatId(this.e.venue!, q.get('cmp')!) : -1;
        if (b >= 0 && b !== i) this.startCompare(b);
        return;
      }
      this.toast('Cette place n’existe pas dans ce stade : vue d’ensemble.');
    }
    if (rv && FLAGS.reveal) {
      const key = rv === 'final' ? 'vip' : rv;
      const cfg = own(REVEALS, key) ? REVEALS[key] : REVEALS.surprise;
      const st = q.get('style');
      const style = st === 'quick' || st === 'cinematic' || st === 'epic' ? (st as RevealConfig['style']) : cfg.style;
      void this.launchReveal({ ...cfg, style });
      return;
    }
    if (scenario) { this.onScenarioRequest?.(scenario); return; }
    this.openingDrift();
  }

  /** Branché par le mode présentation (scénarios 01–07). */
  onScenarioRequest: ((id: string) => void) | null = null;

  private openingDrift() {
    if (this.opts.capture || this.opts.record) return;
    this.opening = true;
    const c = this.d.controls;
    c.autoRotate = !this.prefs.reduced; c.autoRotateSpeed = 0.35;
    window.setTimeout(() => { if (this.opening) this.hint('Choisissez votre vue.', 3600); }, 2500);
  }

  private stopOpening() {
    if (!this.opening) return;
    this.opening = false;
    this.d.controls.autoRotate = false;
  }

  loaderProgress(msg: string, k: number) {
    this.el.loaderMsg.textContent = msg;
    this.el.loader.style.setProperty('--p', String(k));
  }
  hideLoader() { this.el.loader.classList.add('done'); this.el.loader.setAttribute('aria-hidden', 'true'); }

  /** Chargement ou changement de stade sans recharger la page ; l'environnement est conservé. */
  async loadVenue(id: string, o: { first?: boolean; env?: string; minutes?: number; cinematic?: boolean } = {}) {
    if (this.busy) return;
    this.busy = true;
    this.track('venue', id);
    const cinematic = !!o.cinematic && !o.first && !this.prefs.reduced;
    try {
      if (cinematic) {
        // la caméra s'élève, le stade s'efface (≈ 0,6 s)
        const p = this.e.camera.position;
        this.d.path([p.clone().add(new THREE.Vector3(-p.x * 0.2, 60, -p.z * 0.2))], [new THREE.Vector3(0, 0, 0)], 600, { end: 'STADIUM_ORBIT' });
        this.el.veil.classList.add('switch');
        this.el.veil.style.transitionDuration = '450ms';
        this.el.veil.style.opacity = '0.92';
        await new Promise((r) => setTimeout(r, 520));
      }
      this.resetSelection(false);
      this.parked = null; this.recent = [];
      this.modes.reset('overview');
      this.venueId = id;
      const keepEnv = !o.first ? { ...this.e.env.spec } : null;
      this.e.loadProgress = (label, k) => { if (o.first) this.loaderProgress(label === 'Prêt' ? 'Prêt' : 'Préparation de votre vue…', 0.15 + k * 0.85); };
      await this.e.loadVenue(VENUES[id], EVENTS[this.eventId]);
      this.events.attach();
      if (this.e.players) this.e.players.onState = (st) => this.hud.onMatchState(st);
      if (this.opts.record || this.opts.capture) this.e.players?.seed(42);
      this.mini.setVenue(this.e.venue!);
      this.nearbyCache.clear();
      // environnement : conservé d'un stade à l'autre ; par défaut, après-midi dégagé
      const pm = (p: TimePreset) => this.e.env.presetMinutes(p);
      const spec = keepEnv ?? { ...envPreset(o.env ?? 'day', pm) };
      if (o.env && !keepEnv) Object.assign(spec, envPreset(o.env, pm));
      if (o.minutes !== undefined) spec.minutes = o.minutes;
      this.e.env.set(spec, true);
      this.e.setTime(this.e.env.spec.minutes, true, true);
      this.e.repaint(this.heat);
      this.e.setCrowd(this.crowd);
      this.e.camera.position.copy(this.d.homeView.pos).multiplyScalar(cinematic ? 1.35 : 1);
      this.e.camera.fov = this.d.homeView.fov; this.e.camera.updateProjectionMatrix();
      this.d.controls.target.copy(this.d.homeView.target);
      this.d.overview(cinematic ? 1100 : 0);
      this.e.screens?.show({ mode: 'welcome', brand: PRODUCT.name, venue: VENUES[id].name });
      window.setTimeout(() => this.events.scoreboard(), 6000);
      if (cinematic) {
        this.el.veil.style.transitionDuration = '700ms';
        this.el.veil.style.opacity = '0';
        window.setTimeout(() => this.el.veil.classList.remove('switch'), 750);
      }
      announce(`${VENUES[id].name}, ${VENUES[id].label}. ${this.e.venue!.count.toLocaleString('fr-FR')} places.`);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // ------------------------------------------------------------------ gabarit

  /** Simulation d'écran (Lab) : dimensions imposées au lieu de la fenêtre. */
  viewportOverride: { w: number; h: number } | null = null;

  private reframeTimer = 0;
  private lastAspect = 0;

  /**
   * Gabarit : la mise en page suit la taille (téléphone portrait / paysage / grand écran) ; l'interaction suit le
   * pointeur (tactile sans survol = logique mobile, même sur tablette, §37). Hauteur courte (< 700 px) et largeur
   * étroite (≤ 350 px) resserrent l'interface (§35–36).
   */
  detectLayout() {
    const w = this.viewportOverride?.w ?? innerWidth, h = this.viewportOverride?.h ?? innerHeight;
    const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches || matchMedia('(pointer: coarse)').matches;
    this.touch = coarse || (navigator.maxTouchPoints > 0 && Math.min(w, h) < 900);
    const phone = Math.min(w, h) < 600;
    const layout: Layout = phone ? (w > h ? 'landscape' : 'mobile') : 'desktop';
    const device: Device = !this.touch ? 'desktop' : phone ? 'phone' : 'tablet';
    const narrow = w <= 350, short = h < 700;
    const changed = layout !== this.layout || narrow !== this.narrow || short !== this.short;
    this.layout = layout; this.device = device; this.narrow = narrow; this.short = short;
    const A = this.el.app.dataset;
    A.layout = layout; A.device = device; A.touch = this.touch ? '1' : '0';
    A.narrow = narrow ? '1' : '0'; A.short = short ? '1' : '0';
    if (changed) this.render();
    this.sheet?.refresh();
    this.insets.schedule();
    // rotation, redimensionnement : on recadre seulement (stade, place, mode, ambiance et comparaison sont conservés, §30)
    const aspect = w / Math.max(1, h);
    if (this.lastAspect && Math.abs(aspect - this.lastAspect) > 0.05) {
      clearTimeout(this.reframeTimer);
      this.reframeTimer = window.setTimeout(() => this.reframe(), 260);
    }
    this.lastAspect = aspect;
  }

  private reframe() {
    if (!this.ready || this.d.busy || this.reveal.playing) return;
    const m = this.modes.mode;
    const fast = this.prefs.reduced ? 0 : 450;
    if (m === 'overview') this.d.overview(fast);
    else if (m === 'stand' && this.stand >= 0) this.d.focusStand(this.stand);
    else if ((m === 'section' || m === 'seat') && this.section >= 0) this.d.focusSection(this.section);
    this.track('reframe', m);
  }

  private publishSurfaces() {
    const I = this.insets;
    I.publish('top', this.el.top, 'top');
    I.publish('presenter', this.el.presenter, 'top');
    I.publish('dock', this.el.dock, () => (this.layout === 'landscape' ? 'right' : 'bottom'));
    I.publish('card', this.el.card, () => (this.layout === 'landscape' ? 'left' : 'right'));
    I.publish('sheet', this.el.sheet, 'bottom');
    I.publish('mini', this.el.mini, 'bottom');
    I.publish('move', this.el.move, 'bottom');
    I.publish('compare', this.el.compare, (r) => (this.layout === 'landscape' ? (r.width < innerWidth * 0.7 ? 'left' : 'bottom') : 'bottom'));
  }

  applyPrefs() {
    const p = this.prefs;
    sessionSet('prefs', { reduced: p.reduced, comfort: p.comfort, contrast: p.contrast, text: p.text, captions: p.captions });
    this.el.app.dataset.motion = p.reduced ? 'reduced' : 'full';
    this.el.app.dataset.contrast = p.contrast ? 'high' : 'normal';
    document.documentElement.dataset.text = p.text;
    this.d.reduced = p.reduced;
    this.e.env.reduced = p.reduced;
    this.d.comfort = p.comfort;
    this.audio.volume = p.sound === 'full' ? 1 : 0.5;
    this.insets.schedule();
  }

  // ------------------------------------------------------------------ rendu de l'interface

  render() {
    if (!this.e.venue) return;
    this.renderTop();
    this.renderDock();
    this.renderCard();
    this.renderMove();
    this.renderCompare();
    this.renderPanel();
    this.renderWorld();
    this.hud.render();
    const m = this.modes.mode;
    const miniOn = this.layout === 'desktop' && (m === 'stand' || m === 'section' || m === 'seat');
    this.el.mini.classList.toggle('off', !miniOn);
    this.mini.state = { section: this.section, seat: this.seat, compare: this.compareB, hover: this.hoverSection };
    this.insets.schedule();
    this.onRender.forEach((f) => f());
  }

  /** Identifiant compact de position (§45) : « Tribune Nord », « Section 104 », « 104 · R7 · P18 ». */
  private context(): { html: string; label: string } {
    const v = this.e.venue!;
    const m = this.modes.mode;
    if (m === 'overview' || m === 'reveal') return { html: '', label: '' };
    const shown = m === 'compare' ? (this.compareView === 'b' && this.compareB >= 0 ? this.compareB : this.compareA) : this.seat;
    if (this.seat < 0 && m === 'pov' && this.anchorLabel) return { html: `<span class="k">Vue</span> <strong>${esc(this.anchorLabel)}</strong>`, label: this.anchorLabel };
    if (shown >= 0 && m !== 'stand' && m !== 'section') {
      const ab = m === 'compare' ? `<span class="ab ${this.compareView}">${this.compareView.toUpperCase()}</span>` : '';
      const fav = this.isFav(shown) ? `<span class="bm" aria-hidden="true">${icon('bookmark', 12)}</span>` : '';
      return { html: `${ab}<strong>${v.sections[v.section[shown]].code}</strong><span class="sep">·</span>R${v.row[shown] + 1}<span class="sep">·</span>P${v.num[shown]}${fav}`, label: `Section ${v.sections[v.section[shown]].code}, rang ${v.row[shown] + 1}, place ${v.num[shown]}` };
    }
    if (this.section >= 0 && m !== 'stand') return { html: `<span class="k">Section</span> <strong>${v.sections[this.section].code}</strong>`, label: `Section ${v.sections[this.section].code}` };
    if (this.stand >= 0) return { html: `<strong>${esc(v.stands[this.stand].name)}</strong>`, label: v.stands[this.stand].name };
    return { html: '', label: '' };
  }

  renderTop() {
    if (!this.e.venue) return;
    const v = this.e.venue!;
    const m = this.modes.mode;
    const ctx = this.context();
    const focusAct = (document.activeElement as HTMLElement | null)?.closest?.('#tophud [data-act]')?.getAttribute('data-act');
    this.el.top.innerHTML = V.topHud({
      mode: m, layout: this.layout, device: this.device, venue: v.cfg.name, context: ctx.html, contextLabel: ctx.label,
      env: this.e.env.spec, daylight: this.e.env.live.daylight, sound: this.prefs.sound !== 'off',
      envTransition: this.e.env.remainingMs() > 0 ? envLabel(this) : undefined,
    });
    // le focus clavier survit au rafraîchissement du HUD
    if (focusAct) this.el.top.querySelector<HTMLElement>(`[data-act="${focusAct}"]`)?.focus({ preventScroll: true });
    this.hud?.renderEvent();
  }

  renderDock() {
    if (!this.e.venue) return;
    const m = this.modes.mode;
    const o = { hasSeat: this.seat >= 0, layout: this.layout, narrow: this.narrow, parked: !!this.parked && m !== 'compare' };
    let html = V.dock(m, o);
    if (this.seat < 0 && m === 'pov') html = html.replace(/data-act="(move|compare|info)"/g, 'data-act="$1" disabled');
    const focusAct = (document.activeElement as HTMLElement | null)?.closest?.('#dock [data-act]')?.getAttribute('data-act');
    this.el.dock.innerHTML = html;
    this.el.dock.toggleAttribute('hidden', html === '');
    if (focusAct) this.el.dock.querySelector<HTMLElement>(`[data-act="${focusAct}"]`)?.focus({ preventScroll: true });
  }

  private nearby(i: number) {
    const k = `${i}:${this.intent}:${this.eventId}:${this.condKey()}`;
    let r = this.nearbyCache.get(k);
    if (!r) { r = betterNearby(this.ctx(), i, this.intent); this.nearbyCache.set(k, r); }
    return r;
  }

  renderCard() {
    if (!this.e.venue) return;
    const m = this.modes.mode;
    const show = this.seat >= 0 && (m === 'seat' || ((m === 'pov') && this.infoOpen));
    const card = this.el.card, sheet = this.el.sheet;
    if (!show) {
      // le focus ne doit jamais tomber dans le canevas par accident (§102) : on le rend au dock ou au HUD
      const had = card.contains(document.activeElement) || sheet.contains(document.activeElement);
      card.classList.remove('on'); card.setAttribute('aria-hidden', 'true');
      sheet.classList.remove('on'); sheet.setAttribute('aria-hidden', 'true');
      if (had) (this.el.dock.querySelector<HTMLElement>('button:not([disabled])') ?? this.el.top.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
      return;
    }
    const c = this.ctx();
    const badge = this.hud.badges(c.v.section[this.seat]).get(this.seat);
    const src = c.sm.obsSrc[this.seat];
    const html = V.seatCard(c, this.seat, {
      nearby: this.nearby(this.seat), fav: this.isFav(this.seat), mode: m, expanded: this.expanded, layout: this.layout,
      story: sunStory(c, this.seat, this.e.env.live), badge: badge ? BADGE_TEXT[badge] : undefined, rain: (c.cond?.rain ?? 0) > 0,
      obstruction: src && src !== 4 ? `source : ${OBS_LABEL[src]}` : undefined,
    });
    if (this.layout === 'mobile') {
      this.el.sheetBody.innerHTML = html;
      sheet.classList.add('on'); sheet.setAttribute('aria-hidden', 'false');
      card.classList.remove('on'); card.setAttribute('aria-hidden', 'true');
      if (!sheet.dataset.snap) this.sheet.set(0);
    } else {
      card.innerHTML = html;
      card.classList.add('on'); card.setAttribute('aria-hidden', 'false');
      sheet.classList.remove('on');
    }
  }

  renderMove() {
    if (!this.e.venue) return;
    if (this.modes.mode !== 'move' || this.seat < 0) { this.el.move.innerHTML = ''; return; }
    this.el.move.innerHTML = V.moveHud(this.ctx(), this.seat, this.layout);
  }

  renderCompare() {
    if (!this.e.venue) return;
    if (this.modes.mode !== 'compare' || this.compareA < 0) { this.el.compare.innerHTML = ''; return; }
    this.el.compare.innerHTML = V.compareTray(this.ctx(), this.compareA, this.compareB, this.intent, this.compareView, this.layout, this.nearby(this.compareA),
      { saved: this.favList(), canSplit: this.layout === 'desktop' && !this.touch && this.compareB >= 0, split: this.split });
  }

  renderPanel() {
    if (!this.e.venue) return;
    const p = this.panel, el = this.el.panel;
    if (!p) { el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = ''; return; }
    const c = this.ctx();
    let html = '';
    switch (p) {
      case 'venues': html = V.panelVenues(this.venueId); break;
      case 'env': html = V.panelEnv(this.e.env.spec, this.e.env.presetOf(this.e.env.spec.minutes), this.e.env.live.daylight); break;
      case 'explore': html = V.panelExplore(this.heat, this.eventId, { explode: this.e.explode > 1 || this.explodeOn, xray: this.e.xray, players: this.e.playersOn }) + this.crowdChips(); break;
      case 'find': {
        const scope = this.section >= 0 && (this.modes.mode === 'section' || this.modes.mode === 'seat') ? { section: this.section } : this.stand >= 0 && this.modes.mode === 'stand' ? { stand: this.stand } : {};
        const label = 'section' in scope ? `Dans la section ${c.v.sections[this.section].code}` : 'stand' in scope ? `Dans la ${c.v.stands[this.stand].name}` : 'Dans tout le stade';
        html = V.panelFind(c, this.intent, recommend(c, this.intent, { ...scope, pref: this.pref }), `${label} · places libres uniquement`);
        break;
      }
      case 'views': html = V.panelViews(); break;
      case 'more': html = V.panelMore({ lab: this.build === 'lab', presentation: this.opts.presentation, sound: this.prefs.sound, fullscreen: this.fsSupported() ? this.isFullscreen() : null, lite: this.e.quality.lite, event: this.hud.showEvent, pov: this.d.isPOV && this.seat >= 0, narrow: this.narrow || this.layout !== 'desktop' }); break;
      case 'where': html = V.panelWhere(c, { venue: c.v.cfg.name, stand: this.stand, section: this.section, seat: this.modes.mode === 'compare' ? (this.compareView === 'b' ? this.compareB : this.compareA) : this.seat, facts: this.seat >= 0 ? povFactBar(c, this.seat, this.e.env.live) : [], recent: this.recent, saved: this.seat >= 0 && this.isFav(this.seat) }); break;
      case 'event': { const t = this.hud.eventText(); html = V.panelEvent(c.ev, { score: t.sc ?? '', minute: t.min === 'MT' ? 'Mi-temps' : `${this.e.players?.minute ?? 0}e minute`, pre: !!t.pre }, c.v.cfg.name, this.hud.showEvent); break; }
      case 'pov': {
        const persp = this.d.state === 'PITCH_VIEW' ? 'pitch' : this.d.state === 'AERIAL' ? 'aerial' : this.d.posture === 'standing' ? 'standing' : this.d.fovMode === 'wide' ? 'wide' : 'natural';
        const e = this.e.env.spec, day = this.e.env.live.daylight;
        const env = e.rain !== 'none' ? 'rain' : day < 0.35 ? 'night' : Math.abs(e.minutes - this.e.env.presetMinutes('sunset')) < 25 ? 'sunset' : 'sun';
        html = V.panelPov({ follow: this.d.followPlay, zoom: this.d.zoom, perspective: persp, env, players: !!this.e.players && this.e.playersOn, fullscreen: this.fsSupported() ? this.isFullscreen() : null });
        break;
      }
      case 'a11y': html = V.panelA11y({ reduced: this.prefs.reduced, comfort: this.prefs.comfort, contrast: this.prefs.contrast, text: this.prefs.text, captions: this.prefs.captions, viewer: this.d.viewer, posture: this.d.posture }); break;
      case 'help': html = V.panelHelp(); break;
      case 'browser': html = V.panelBrowser(c, this.browser); break;
      case 'favs': html = V.panelFavs(c, this.favList()); break;
      case 'reveal': html = V.panelReveal(); break;
    }
    el.innerHTML = html;
    el.dataset.anchor = PANEL_ANCHOR[p] ?? 'top';
    el.classList.add('on'); el.setAttribute('aria-hidden', 'false');
  }

  private explodeOn = false;
  private crowdChips() {
    const opts: Array<[string, string]> = [['real', 'Réelle'], ['0', 'Vide'], ['0.5', 'À moitié'], ['1', 'Complet']];
    return `<h3 class="h3">Affluence</h3><div class="chips">${opts.map(([k, l]) => `<button type="button" class="chip ${String(this.crowd) === k ? 'on' : ''}" data-act="crowd:${k}" aria-pressed="${String(this.crowd) === k}">${l}</button>`).join('')}</div>
      <h3 class="h3">Moment du match</h3><div class="chips">${([['warmup', 'Échauffement'], ['openplay', 'Jeu'], ['corner', 'Corner'], ['freekick', 'Coup franc'], ['penalty', 'Penalty']] as Array<[MatchState, string]>).map(([k, l]) => `<button type="button" class="chip" data-act="match:${k}">${l}</button>`).join('')}</div>`;
  }

  /** Étiquettes contextuelles : peu nombreuses, priorisées, occultées par les structures (§41–44). */
  renderWorld() {
    if (!this.e.venue) return;
    const v = this.e.venue!;
    const m = this.modes.mode;
    const L: WorldLabel[] = [];
    const big = this.prefs.text !== 'md';
    this.world.maxVisible = this.layout === 'desktop' ? (big ? 6 : 8) : big ? 3 : 4;
    const pin = (i: number, kind: 'pin' | 'pinB', text: string) => L.push({ id: `${kind}${i}`, pos: new THREE.Vector3(v.px[i], v.py[i] + 1.6, v.pz[i]), text: `${text}${this.isFav(i) ? ` ${icon('bookmark', 11)}` : ''}`, kind, minDist: 1.5, prio: 5, fixed: true });
    if (this.split) { this.world.set([]); return; }
    if (m === 'overview') {
      for (const st of v.stands) L.push({ id: `st${st.idx}`, pos: new THREE.Vector3(st.center.x * 1.02, (st.roof ? st.roof.frontH : st.topH) + 4, st.center.z * 1.02), text: esc(st.name), kind: 'stand', act: `stand:${st.idx}`, prio: 2 });
    } else if (m === 'stand' && this.stand >= 0) {
      for (const t of v.stands[this.stand].tiers) for (const si of t.sections) {
        const s = v.sections[si];
        L.push({ id: `sc${si}`, pos: new THREE.Vector3(s.center.x, s.center.y + 3, s.center.z), text: s.code, kind: 'section', act: `section:${si}`, maxDist: 260, prio: 2 });
      }
    } else if (m === 'section' || m === 'seat') {
      if (this.seat >= 0) pin(this.seat, 'pin', `R${v.row[this.seat] + 1} · P${v.num[this.seat]}`);
      if (this.section >= 0) {
        // badges en mots sur les places recommandées de la section (§11) : un seul par place, jamais de note /100
        for (const [i, b] of this.hud.badges(this.section)) {
          if (i === this.seat) continue;
          L.push({ id: `bd${i}`, pos: new THREE.Vector3(v.px[i], v.py[i] + 1.3, v.pz[i]), text: esc(BADGE_TEXT[b]), kind: 'badge', act: `select:${i}`, prio: 4, maxDist: 160 });
        }
      }
      if (m === 'section' && this.section >= 0) {
        const s = v.sections[this.section];
        const st = v.stands[s.stand];
        for (const si of st.tiers[s.tier].sections) {
          if (Math.abs(v.sections[si].indexInStand - s.indexInStand) !== 1) continue;
          const n = v.sections[si];
          L.push({ id: `sc${si}`, pos: new THREE.Vector3(n.center.x, n.center.y + 3, n.center.z), text: n.code, kind: 'section', act: `section:${si}`, maxDist: 200, prio: 2 });
        }
      }
    } else if (m === 'compare') {
      if (this.compareB >= 0) {
        const other = this.compareView === 'a' ? this.compareB : this.compareA;
        pin(other, this.compareView === 'a' ? 'pinB' : 'pin', this.compareView === 'a' ? 'B' : 'A');
      }
    }
    this.world.set(L);
  }

  // ------------------------------------------------------------------ boucle

  private frame(dt: number) {
    if (!this.e.venue) return;
    const W = this.el.canvas.clientWidth, H = this.el.canvas.clientHeight;
    this.world.update(this.e.camera, W, H);
    const tgt = this.d.def.orbit ? this.d.controls.target : this.e.camera.position.clone().add(new THREE.Vector3(0, 0, -30).applyQuaternion(this.e.camera.quaternion));
    this.mini.tick(dt, this.e.camera, tgt);
    this.events.update(dt);
    this.hud.frame();
    // seconde vue (comparaison) : même regard relatif depuis la place B
    const sec = this.e.secondary;
    if (sec) { const other = this.compareView === 'a' ? this.compareB : this.compareA; if (other >= 0) this.d.poseFor(other, sec.cam); }
    this.recoverCamera();
  }

  /** RecoveryController : position invalide (NaN, sous la pelouse, dans une structure) → ancre sémantique la plus proche. */
  private recoverCamera() {
    const p = this.e.camera.position;
    if (!Number.isFinite(p.x + p.y + p.z) || p.y < -1 || p.length() > 3000) {
      this.d.cancel();
      this.e.camera.position.copy(this.d.homeView.pos);
      this.d.overview(0);
      this.modes.reset('overview');
      this.track('recovery');
    }
  }

  interacted() {
    this.lastInputAt = performance.now();
    this.stopOpening();
    // la saisie qui fait réapparaître l'interface masquée ne sélectionne rien (indépendant du temps de traitement)
    this.wokeUi = this.hud.wake();
    this.onInteract.forEach((f) => f());
  }
  private wokeUi = false;
  onInteract: Array<() => void> = [];

  // ------------------------------------------------------------------ saisie

  gestureMode(): GestureMode {
    if (this.busy || this.reveal.playing) return 'locked';
    const m = this.modes.mode;
    if (m === 'move') return 'move';
    return this.d.isPOV ? 'look' : 'orbit';
  }

  private ndc(x: number, y: number) {
    const r = this.el.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  /**
   * Ciblage tactile (§19–21) : recherche dans un rayon de 18 à 28 px selon la densité apparente des places
   * (taille d'un siège à l'écran), la taille de l'écran et le type de saisie. Classement : proximité au doigt,
   * visibilité (première surface touchée), place libre, orientation vers la caméra, continuité (même section, même rang),
   * qualité. Le meilleur candidat est choisi (sélection « aimantée ») ; si plusieurs se valent, la bande de candidats
   * permet de corriger en un toucher, sans zoom forcé.
   */
  pickAt(x: number, y: number, touch: boolean): number { return this.pickDetailed(x, y, touch).best; }

  pickDetailed(x: number, y: number, touch: boolean): { best: number; alts: number[]; ambiguous: boolean } {
    const v = this.e.venue;
    const none = { best: -1, alts: [], ambiguous: false };
    if (!v) return none;
    const pov = this.d.isPOV;
    const cam = this.e.camera;
    const H = this.el.canvas.clientHeight;
    // taille apparente d'un siège (0,5 m) au point visé : densité locale
    const probe = pickCandidates(v, cam, this.ndc(x, y), 40, H, { skip: pov ? this.seat : undefined, minDist: pov ? 1.2 : 0.8 }, 1)[0];
    const focal = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const seatPx = probe ? (0.5 * focal) / Math.max(1, probe.dist) : 12;
    let tol = touch ? Math.max(18, Math.min(28, 18 + (14 - seatPx) * 0.9 + (this.device === 'phone' ? 2 : 0))) : pov ? 9 : 7;
    if (!touch && seatPx < 4) tol = 9;
    const c = pickCandidates(v, cam, this.ndc(x, y), tol, H, { skip: pov ? this.seat : undefined, minDist: pov ? 1.2 : 0.8 }, 12);
    if (!c.length) return none;
    const em = this.e.metrics!;
    const ref = this.seat;
    const ctx = this.ctx();
    const dir = new THREE.Vector3();
    const scored = c.map((k) => {
      let s = -k.ang * 3;
      if (em.avail[k.i]) s += 0.8;
      // orientation : une place qui tourne le dos à la caméra (vue de l'arrière d'une tribune) est moins probable
      dir.set(cam.position.x - v.px[k.i], 0, cam.position.z - v.pz[k.i]).normalize();
      s += (-(v.nx[k.i] * dir.x + v.nz[k.i] * dir.z)) * 0.35;
      if (ref >= 0 && v.section[k.i] === v.section[ref]) s += 0.4;
      if (ref >= 0 && v.row[k.i] === v.row[ref]) s += 0.3;
      if (this.section >= 0 && v.section[k.i] === this.section) s += 0.3;
      s += quality(ctx, k.i, this.intent) * 0.004;
      return { i: k.i, s };
    }).sort((a, b) => b.s - a.s);
    const best = scored[0].i;
    // ambiguïté : plusieurs places quasi équiprobables et petites à l'écran
    const close = scored.filter((x) => x.s > scored[0].s - 0.35);
    const ambiguous = touch && seatPx < 16 && close.length > 1;
    const alts = ambiguous ? close.slice(0, 3).map((x) => x.i).sort((a, b) => v.row[a] - v.row[b] || v.num[a] - v.num[b]) : [];
    return { best, alts, ambiguous };
  }

  onTap(x: number, y: number, touch: boolean) {
    // un toucher qui fait réapparaître l'interface masquée ne sélectionne rien (§13, §15)
    if (this.wokeUi) { this.wokeUi = false; return; }
    if (this.hud.stripOpen) { this.hud.closeEnvStrip(false); return; }
    if (this.panel && this.layout !== 'desktop') { this.closePanel(); return; }
    if (this.panel) this.closePanel();
    if (!this.ready || this.reveal.playing) return;
    const m = this.modes.mode;
    if (this.split) return;
    const pk = this.pickDetailed(x, y, touch);
    const i = pk.best;
    if (m === 'overview' || m === 'stand') {
      if (i >= 0) this.focusSection(this.e.venue!.section[i]);
      return;
    }
    if (m === 'section' || m === 'seat') {
      if (i >= 0) {
        this.selectSeat(i);
        if (pk.ambiguous) this.hud.showCandidates(pk.alts.includes(i) ? pk.alts : [i, ...pk.alts].slice(0, 3), i);
      } else if (m === 'seat') this.deselect();
      return;
    }
    if (m === 'move') { if (i >= 0) this.moveTo(i); return; }
    if (m === 'compare') {
      if (i >= 0 && i !== this.compareA) this.setCompareB(i);
      return;
    }
    if (m === 'pov') {
      if (i >= 0) this.showGhost(i, x, y); else this.hideGhost();
    }
  }

  /** Choix dans la bande de candidats (toucher ambigu). */
  onCandidate(i: number) {
    const m = this.modes.mode;
    if (m === 'section' || m === 'seat') this.selectSeat(i);
    else if (m === 'move') this.moveTo(i);
  }

  /**
   * Double toucher contextuel (§23) : vue d'ensemble → section ; section / place → entrer dans la place.
   * En vue siège, le double toucher ne déplace jamais (conflit avec le regard et le toucher de visée).
   */
  onDoubleTap(x: number, y: number, touch: boolean) {
    if (!this.ready || this.split) return;
    const m = this.modes.mode;
    if (m === 'section' || m === 'seat') {
      const i = this.pickAt(x, y, touch);
      if (i >= 0) { this.hideGhost(); this.gotoSeat(i); }
    }
  }

  /** Appui long sur une place (§24) : aperçu (place, prix, vue) ; relâcher le referme ; toucher sélectionne. */
  onLongPress(x: number, y: number) {
    if (!this.ready || this.split || this.wokeUi) return;
    const m = this.modes.mode;
    if (m === 'overview') return;
    const i = this.pickAt(x, y, true);
    if (i >= 0) this.hud.peek(i, x, y);
  }

  onHover(x: number, y: number) {
    if (!this.ready || this.layout !== 'desktop' || this.panel) return;
    const m = this.modes.mode;
    const i = this.pickAt(x, y, false);
    const v = this.e.venue!;
    const tip = this.el.tip;
    if (m === 'overview' || m === 'stand') {
      const sec = i >= 0 ? v.section[i] : -1;
      if (sec !== this.hoverSection) {
        this.hoverSection = sec;
        this.e.setFocusSection(sec);
        if (this.e.seats) this.e.seats.uniforms.uDim.value = 0.72;
        if (this.e.crowd) this.e.crowd.uniforms.uDim.value = 0.72;
        this.mini.state.hover = sec;
      }
      if (sec >= 0) {
        const s = v.sections[sec], em = this.e.metrics!;
        let free = 0, minP = 1e9;
        for (let k = s.start; k < s.start + s.count; k++) if (em.avail[k]) { free++; minP = Math.min(minP, em.price[k]); }
        tip.innerHTML = `<strong>Section ${s.code} · ${esc(v.stands[s.stand].name)}</strong><span>${free ? `${free} places libres · dès ${eur(minP)}` : 'Complet'}</span>`;
        this.placeTip(x, y);
      } else tip.classList.remove('on');
      this.el.canvas.style.cursor = sec >= 0 ? 'pointer' : '';
      return;
    }
    if (m === 'section' || m === 'seat' || m === 'pov' || m === 'move' || m === 'compare') {
      if (i !== this.hoverSeat) {
        if (this.hoverSeat >= 0 && !this.marks.has(this.hoverSeat)) this.e.seats?.mark(this.hoverSeat, null);
        this.hoverSeat = i;
        if (i >= 0 && !this.marks.has(i)) this.e.seats?.mark(i, 'candidate');
      }
      if (i >= 0) {
        const s = seatSummary(this.ctx(), i);
        const verb = m === 'pov' ? 'Double-clic pour y aller' : m === 'move' ? 'Clic pour y aller' : m === 'compare' ? 'Clic pour comparer' : s.viewLabel;
        tip.innerHTML = `<strong>Section ${s.section} · ${s.short}</strong><span>${s.priceLabel} · ${s.available ? verb : 'Vendue'}</span>`;
        this.placeTip(x, y);
      } else tip.classList.remove('on');
      this.el.canvas.style.cursor = i >= 0 ? 'pointer' : '';
    }
  }

  private placeTip(x: number, y: number) {
    const t = this.el.tip;
    t.classList.add('on');
    const w = t.offsetWidth, h = t.offsetHeight;
    const tx = Math.min(innerWidth - w - 8, x + 14), ty = y - h - 14 < 8 ? y + 18 : y - h - 14;
    t.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  clearHover() {
    this.el.tip.classList.remove('on');
    if (this.hoverSeat >= 0 && !this.marks.has(this.hoverSeat)) this.e.seats?.mark(this.hoverSeat, null);
    this.hoverSeat = -1;
    if (this.hoverSection >= 0 && (this.modes.mode === 'overview' || this.modes.mode === 'stand')) { this.hoverSection = -1; this.e.setFocusSection(-1); }
  }

  private showGhost(i: number, x: number, y: number) {
    const s = seatSummary(this.ctx(), i);
    this.ghostSeat = i;
    const g = this.el.ghost;
    g.innerHTML = `<div><div class="t">Section ${s.section} · ${s.short}</div><div class="s">${s.priceLabel} · ${s.viewLabel}</div></div>
      <button type="button" class="btn small primary" data-act="goto:${i}">Aller ici</button><button type="button" class="btn small ghost" data-act="compareWith:${i}">Comparer</button>`;
    g.classList.add('on');
    const w = g.offsetWidth, h = g.offsetHeight;
    g.style.transform = `translate(${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px, ${Math.max(60, Math.min(innerHeight - h - 90, y - h - 20))}px)`;
    this.setMark(i, 'candidate');
  }
  hideGhost() {
    if (this.ghostSeat >= 0) { this.setMark(this.ghostSeat, null); this.ghostSeat = -1; }
    this.el.ghost.classList.remove('on');
  }

  private setMark(i: number, kind: 'selected' | 'candidate' | 'compare' | null) {
    if (i < 0 || !this.e.seats) return;
    if (kind === null) {
      if (i === this.seat && this.modes.mode !== 'compare') kind = 'selected';
      else if (i === this.compareB || i === this.compareA) kind = 'compare';
    }
    if (kind) this.marks.set(i, kind); else this.marks.delete(i);
    this.e.seats.mark(i, kind);
  }

  private clearMarks() { for (const i of [...this.marks.keys()]) { this.marks.delete(i); this.e.seats?.mark(i, null); } }

  // ------------------------------------------------------------------ navigation

  focusStand(si: number) {
    if (!this.ready) return;
    this.stand = si; this.section = -1;
    this.e.setFocusSection(-1);
    this.d.focusStand(si);
    this.modes.go('stand');
    announce(`${this.e.venue!.stands[si].name}. Flèches : sections.`);
    this.track('stand', String(si));
  }

  focusSection(sec: number) {
    if (!this.ready) return;
    const v = this.e.venue!;
    this.hoverSection = -1;
    this.el.tip.classList.remove('on');
    this.section = sec; this.stand = v.sections[sec].stand;
    if (this.seat >= 0) { const s = this.seat; this.seat = -1; this.setMark(s, null); }
    this.e.setFocusSection(sec);
    if (this.e.seats) this.e.seats.uniforms.uDim.value = 0.42;
    if (this.e.crowd) this.e.crowd.uniforms.uDim.value = 0.5;
    this.d.focusSection(sec);
    if (this.modes.mode !== 'section') this.modes.go('section'); else this.render();
    const s = v.sections[sec];
    announce(`Section ${s.code}, ${v.stands[s.stand].name}. Touchez une place, ou Entrée pour la meilleure.`);
    this.firstHint('seat', this.touch ? 'Touchez une place.' : 'Choisissez une place.');
    this.track('section', s.code);
  }

  /** Sélection d'une place (carte / feuille), caméra recentrée si la place est dans une autre section. */
  selectSeat(i: number, o: { instant?: boolean } = {}) {
    if (!this.e.venue) return;
    const v = this.e.venue;
    this.closePanel();
    const prev = this.seat;
    this.seat = i;
    if (prev >= 0 && prev !== i) this.setMark(prev, null);
    this.setMark(i, 'selected');
    this.expanded = false;
    if (v.section[i] !== this.section || o.instant) {
      this.section = v.section[i]; this.stand = v.stand[i];
      this.e.setFocusSection(this.section);
      if (o.instant) { const r = this.d.reduced; this.d.reduced = true; this.d.focusSection(this.section); this.d.reduced = r; }
      else this.d.focusSection(this.section);
    }
    if (this.modes.mode !== 'seat') this.modes.go('seat'); else this.render();
    if (this.layout === 'mobile' && this.sheet.snap === 2) this.sheet.set(1);
    this.haptic(5);
    this.pref.note(this.ctx(), i, 0.5);
    announce(seatSpeech(this.ctx(), i));
    this.firstHint('view', 'Voyez votre vue depuis cette place.');
    this.syncUrl();
    this.track('seat', seatId(v, i));
  }

  deselect() {
    const s = this.seat;
    this.seat = -1;
    this.setMark(s, null);
    if (this.modes.mode === 'seat') this.modes.go('section'); else this.render();
  }

  /** Entrée en vue siège (depuis n'importe où). */
  gotoSeat(i: number, o: { instant?: boolean } = {}) {
    if (!this.e.venue) return;
    const v = this.e.venue;
    this.closePanel();
    this.hideGhost();
    this.clearHover();
    const prev = this.seat;
    const wasPOV = this.d.isPOV && prev >= 0;
    this.seat = i; this.section = v.section[i]; this.stand = v.stand[i];
    if (prev >= 0 && prev !== i) this.setMark(prev, null);
    this.setMark(i, this.modes.mode === 'compare' ? 'compare' : 'selected');
    this.e.setFocusSection(-1);
    this.e.hideCrowdAt(i);
    this.e.seatNumbers?.focus(i);
    this.infoOpen = false;
    this.anchorLabel = '';
    const arrive = () => this.haptic(12);
    if (o.instant) { this.d.cancel(); this.d.settleInSeat(i); }
    else if (wasPOV) { this.d.switchSeat(i, arrive); if (prev !== i) this.hud.offerUndo(prev); }
    else this.d.approachSeat(i, arrive);
    this.noteRecent(i);
    const m = this.modes.mode;
    if (m !== 'pov' && m !== 'move' && m !== 'compare') this.modes.go('pov'); else this.render();
    this.pref.note(this.ctx(), i, 1);
    announce(`Vue siège. ${seatSpeech(this.ctx(), i)}`);
    // une seule fois par session, sur téléphone en portrait : la vue est plus large en paysage (§32)
    if (this.layout === 'mobile' && !sessionGet('rotateHint', false) && !this.opts.capture && !this.opts.record) {
      sessionSet('rotateHint', true);
      window.setTimeout(() => this.hint('Tournez le téléphone pour une vue plus large.', 3200), 1600);
    }
    // plein écran : seulement si la personne l'a choisi pendant la session, et dans le geste qui l'autorise (§33)
    if (this.fullscreenPref && this.touch && !this.isFullscreen()) this.setFullscreen(true);
    this.syncUrl();
    this.track('pov', seatId(v, i));
  }

  /** Mode Déplacer : un pas vers une place ou un rang voisin. */
  step(dir: 'left' | 'right' | 'forward' | 'back') {
    if (this.seat < 0 || !this.e.venue) return;
    this.interacted();
    const n = neighbor(this.e.venue, this.seat, dir === 'forward' ? 'down' : dir === 'back' ? 'up' : dir);
    if (n < 0) { this.toast(dir === 'forward' ? 'Premier rang' : dir === 'back' ? 'Dernier rang' : 'Bout du rang'); return; }
    this.moveTo(n);
  }

  moveTo(i: number, o: { undoable?: boolean } = {}) {
    const prev = this.seat;
    if (i === prev) return;
    const v = this.e.venue!;
    this.seat = i; this.section = v.section[i]; this.stand = v.stand[i];
    this.setMark(prev, null);
    this.setMark(i, 'selected');
    this.e.hideCrowdAt(i);
    this.e.seatNumbers?.focus(i);
    this.d.switchSeat(i, () => this.haptic(8));
    if (o.undoable !== false) this.hud.offerUndo(prev);
    this.noteRecent(i);
    this.renderTop();
    this.renderMove();
    this.hud.renderFacts();
    if (this.panel === 'where') this.renderPanel();
    announce(`Déplacé : rang ${v.row[i] + 1}, place ${v.num[i]}. ${eur(this.e.metrics!.price[i])}.`);
    this.syncUrl();
    this.track('switch', seatId(v, i));
  }

  /** Historique de session : 5 dernières places visitées (§70). */
  private noteRecent(i: number) {
    this.recent = [i, ...this.recent.filter((x) => x !== i)].slice(0, 6);
  }

  back() {
    if (this.hud.level === 'immersive' || this.hud.forcedImmersive) { this.hud.wake(); return; }
    if (this.hud.stripOpen) { this.hud.closeEnvStrip(true); return; }
    if (this.panel) { this.closePanel(); return; }
    const m = this.modes.mode;
    if (m === 'reveal') { this.reveal.skip(); return; }
    if (m === 'move') { this.modes.go('pov'); return; }
    if (m === 'compare') { this.endCompare(); return; }
    if (m === 'pov') {
      if (this.seat >= 0) {
        this.e.setFocusSection(this.section);
        this.d.focusSection(this.section);
        this.modes.go('seat');
      } else this.overview();
      return;
    }
    if (m === 'seat') { this.deselect(); return; }
    if (m === 'section') {
      if (this.stand >= 0 && this.modes.prev === 'stand') { this.focusStand(this.stand); return; }
      this.overview(); return;
    }
    const to = BACK_OF[m];
    if (to === 'overview') this.overview();
  }

  overview() {
    // une comparaison en cours n'est jamais détruite par un retour à la vue d'ensemble (§72) : elle est mise de côté
    if (this.modes.mode === 'compare' && this.compareA >= 0 && this.compareB >= 0) this.parked = { a: this.compareA, b: this.compareB };
    this.resetSelection(true);
    this.e.seatNumbers?.focus(-1);
    this.d.overview();
    this.modes.go('overview');
    announce(this.parked ? 'Vue d’ensemble du stade. Votre comparaison est conservée.' : 'Vue d’ensemble du stade.');
  }

  resetSelection(keepMarks = false) {
    this.hideGhost();
    void keepMarks;
    this.clearMarks();
    this.seat = -1; this.section = -1; this.stand = -1; this.compareA = this.compareB = -1; this.compareView = 'a';
    this.infoOpen = false; this.expanded = false; this.anchorLabel = '';
    this.e.setFocusSection(-1);
    this.e.hideCrowdAt(-1);
    this.el.tip.classList.remove('on');
    this.closePanel();
  }

  // ------------------------------------------------------------------ comparaison

  /** Reprend la comparaison mise de côté (A et B inchangés). */
  resumeCompare() {
    const p = this.parked;
    if (!p) return;
    this.parked = null;
    this.gotoSeat(p.a);
    this.startCompare(p.b);
  }

  startCompare(b = -1) {
    if (this.seat < 0) return;
    this.parked = null;
    this.compareA = this.seat; this.compareB = -1; this.compareView = 'a';
    this.setMark(this.seat, 'selected');
    if (!this.d.isPOV) { this.d.approachSeat(this.seat); this.e.hideCrowdAt(this.seat); this.e.setFocusSection(-1); }
    this.modes.go('compare');
    if (b >= 0) this.setCompareB(b);
    else announce('Comparaison : touchez une autre place pour la comparer à la place A.');
    this.track('compare');
  }

  setCompareB(i: number) {
    if (this.compareB >= 0 && this.compareB !== i) this.setMark(this.compareB, null);
    this.compareB = i;
    this.setMark(i, 'compare');
    this.pref.note(this.ctx(), i, 1);
    this.viewCompare('b');
    this.updateSecondary();
  }

  /** Seconde vue : côte à côte sur demande (bureau), incrustation de l'autre place sur téléphone (§66–67). */
  updateSecondary() {
    const m = this.modes.mode;
    const other = this.compareView === 'a' ? this.compareB : this.compareA;
    if (m !== 'compare' || this.compareB < 0 || other < 0 || !this.d.isPOV && !this.d.busy) { this.e.setSecondary(null); this.el.splitlab.hidden = true; return; }
    if (this.split) {
      this.e.setSecondary({ mode: 'split', seat: other });
      const c = this.ctx(), ta = seatTitle(c, this.compareView === 'a' ? this.compareA : this.compareB), tb = seatTitle(c, other);
      const cur = this.compareView.toUpperCase(), oth = cur === 'A' ? 'B' : 'A';
      this.el.splitlab.innerHTML = `<span class="l"><span class="ab ${cur.toLowerCase()}">${cur}</span>${ta.section} · ${ta.short}</span><span class="r"><span class="ab ${oth.toLowerCase()}">${oth}</span>${tb.section} · ${tb.short}</span>`;
      this.el.splitlab.hidden = false;
    } else if (this.layout !== 'desktop' || this.touch) {
      this.e.setSecondary({ mode: 'pip', seat: other });
      this.el.splitlab.hidden = true;
    } else { this.e.setSecondary(null); this.el.splitlab.hidden = true; }
    this.hud.placePip();
  }

  setSplit(on: boolean) {
    if (on === this.split) return;
    this.split = on;
    this.updateSecondary();
    this.renderWorld();
    if (this.modes.mode === 'compare') this.renderCompare();
    if (on) { const cur = this.compareView.toUpperCase(); announce(`Vues côte à côte : ${cur} à gauche, ${cur === 'A' ? 'B' : 'A'} à droite. Le regard est synchronisé.`); }
  }

  viewCompare(k: 'a' | 'b') {
    const i = k === 'a' ? this.compareA : this.compareB;
    if (i < 0) return;
    this.compareView = k;
    this.seat = i;
    this.e.hideCrowdAt(i);
    this.e.seatNumbers?.focus(i);
    this.d.isPOV ? this.d.switchSeat(i) : this.d.approachSeat(i);
    this.render();
    this.updateSecondary();
    const r = this.compareB >= 0 ? V.relativePosition(this.ctx(), this.compareA, this.compareB) : '';
    announce(`Place ${k.toUpperCase()}. ${seatSpeech(this.ctx(), i)}${r ? ` B est ${r} par rapport à A.` : ''}`);
  }

  endCompare(keep: 'a' | 'b' | null = null) {
    this.e.setSecondary(null); this.split = false; this.el.splitlab.hidden = true;
    const keepSeat = keep === 'b' ? this.compareB : keep === 'a' ? this.compareA : this.seat;
    for (const i of [this.compareA, this.compareB]) if (i >= 0) { this.marks.delete(i); this.e.seats?.mark(i, null); }
    this.compareA = this.compareB = -1; this.compareView = 'a';
    this.seat = keepSeat;
    if (keepSeat >= 0) { this.setMark(keepSeat, 'selected'); if (this.seat !== keepSeat) this.d.switchSeat(keepSeat); }
    this.modes.go('pov');
  }

  // ------------------------------------------------------------------ environnement, match

  setEnv(s: Partial<EnvironmentSpec>, instant = false) {
    this.e.env.set(s, instant);
    if (s.minutes !== undefined && !instant) window.setTimeout(() => this.e.setTime(this.e.env.spec.minutes, true, true), 50);
    else if (s.minutes !== undefined) this.e.setTime(this.e.env.spec.minutes, true, true);
    this.track('env', JSON.stringify(s));
    this.nearbyCache.clear();
    this.renderTop();
    if (this.panel === 'env' || this.panel === 'pov') this.renderPanel();
    // la place et la caméra ne bougent pas : comparaison des conditions à place égale (§99–100)
    if (!instant) this.hud.envFlash(envLabel(this));
    window.setTimeout(() => { if (this.modes.mode === 'seat') this.renderCard(); this.hud.renderFacts(true); }, instant ? 0 : 120);
  }

  quickEnv(k: string) {
    const pm = (p: TimePreset) => this.e.env.presetMinutes(p);
    const sp = this.e.env.spec;
    const day = this.e.env.live.daylight > 0.5 && Math.abs(sp.minutes - pm('sunset')) > 25;
    if (k === 'sun') this.setEnv({ minutes: day ? sp.minutes : pm('afternoon'), clouds: 'clear', rain: 'none', fog: 0 });
    else if (k === 'cloud') this.setEnv({ clouds: 'overcast', rain: 'none' });
    else if (k === 'rain') this.setEnv({ clouds: 'overcast', rain: sp.rain === 'none' ? 'rain' : sp.rain });
    else if (k === 'night') this.setEnv({ minutes: pm('night'), rain: 'none', clouds: 'clear' });
    else if (k === 'sunset') this.setEnv({ minutes: pm('sunset'), clouds: 'partly', rain: 'none' });
    else if (k === 'reset') this.setEnv(envPreset('day', pm));
    const label = k === 'sun' ? 'Jour sélectionné' : k === 'cloud' ? 'Ciel couvert' : k === 'rain' ? 'Pluie activée' : k === 'night' ? 'Nuit sélectionnée' : k === 'sunset' ? 'Coucher de soleil sélectionné' : 'Environnement réinitialisé';
    announce(label);
    if (k === 'rain' && this.seat >= 0) window.setTimeout(() => this.toast(this.e.statics!.covered[this.seat] ? 'Votre place est abritée : vous restez au sec.' : 'Votre place est exposée à la pluie.'), 900);
  }

  setEvent(id: string) {
    this.eventId = id;
    this.e.setEvent(EVENTS[id]);
    this.e.repaint(this.heat);
    this.nearbyCache.clear();
    this.events.attach();
    this.render();
    announce(EVENTS[id].label);
  }

  setHeat(h: SeatColorMode) {
    this.heat = h;
    this.e.repaint(h);
    for (const [i, k] of this.marks) this.e.seats?.mark(i, k);
    if (this.panel === 'explore') this.renderPanel();
    this.hud.renderEvent();
  }

  goal() { this.events.goal(); this.track('goal'); }

  // ------------------------------------------------------------------ révélation

  /** Place de révélation : meilleure place libre de la zone configurée, pour tout stade (repli : tribune principale). */
  revealSeat(cfg: RevealConfig) {
    const c = this.ctx(), v = c.v;
    let stand = v.stands.findIndex((s) => s.id === cfg.seat.stand);
    if (stand < 0) stand = v.stands.findIndex((s) => s.kind === 'main');
    const picks = cfg.seat.hospitality
      ? (() => { const sec = v.sections.find((s) => s.hospitality); return sec ? recommend(c, 'view', { section: sec.idx, n: 1 }) : []; })()
      : recommend(c, 'view', { stand, n: 1 });
    return picks[0]?.seat ?? v.sections[0].start;
  }

  async launchReveal(cfg: RevealConfig = REVEALS.surprise) {
    if (!this.ready || this.reveal.playing || !FLAGS.reveal) return;
    this.closePanel();
    this.resetSelection();
    const seat = this.revealSeat(cfg);
    this.modes.reset('reveal');
    this.track('reveal', cfg.id);
    this.el.rvDone.classList.remove('on');
    await this.reveal.play(cfg, seat);
    this.seat = seat; this.section = this.e.venue!.section[seat]; this.stand = this.e.venue!.stand[seat];
    this.setMark(seat, 'selected');
    this.modes.reset('pov');
    // le HUD revient en douceur après l'arrivée
    this.hud.setLevel('immersive');
    window.setTimeout(() => { this.lastInputAt = performance.now(); this.hud.setLevel('full'); }, 1400);
    this.track('reveal-done');
  }

  private revealFinale(i: number) {
    const t = seatTitle(this.ctx(), i);
    const d = this.el.rvDone;
    d.innerHTML = `<div class="k">Votre place</div><div class="t">${t.short}</div><div class="s">${esc(t.block)}</div>`;
    d.classList.add('on');
    window.setTimeout(() => d.classList.remove('on'), 4200);
  }

  // ------------------------------------------------------------------ points de vue

  anchor(id: string) {
    if (!this.ready) return;
    this.resetSelection();
    const labels = Object.fromEntries(V.ANCHORS);
    this.anchorLabel = labels[id] ?? '';
    if (id === 'aerial') { this.d.aerial(); this.modes.go('overview'); return; }
    if (id === 'drone') { this.d.drone(); this.modes.go('overview'); this.toast('Drone libre : faites glisser pour tourner, molette ou pincement pour avancer.'); return; }
    if (id === 'player') {
      const p = this.e.players;
      if (!p) return;
      this.d.playerView(() => { const x = p.playerEye('mid'); return { pos: x.pos, look: x.look }; });
      this.modes.go('pov');
      return;
    }
    this.d.anchorView(id as AnchorId);
    this.modes.go('pov');
    announce(this.anchorLabel);
  }

  // ------------------------------------------------------------------ panneaux

  openPanel(p: string | null, from?: HTMLElement | null) {
    if (p === this.panel || p === 'none' || p === null) { this.closePanel(); return; }
    this.panelReturn = from ?? (document.activeElement as HTMLElement);
    this.panel = p;
    if (p === 'browser') this.browser = this.section >= 0 ? { stand: this.stand, section: this.section, row: -1 } : { stand: -1, section: -1, row: -1 };
    this.renderPanel();
    // focus immédiat (pas d'attente d'image : une image lente ne doit pas retarder le clavier)
    (this.el.panel.querySelector<HTMLElement>('.on[data-act], [aria-pressed="true"], .li, .venue, .qe, .chip') ?? this.el.panel.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    this.track('panel', p);
  }

  closePanel() {
    if (!this.panel) return;
    this.panel = null;
    this.renderPanel();
    this.panelReturn?.isConnected && this.panelReturn.focus({ preventScroll: true });
    this.panelReturn = null;
  }

  // ------------------------------------------------------------------ actions (délégation unique)

  private bindDom() {
    this.el.app.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || b.hasAttribute('disabled')) return;
      this.interacted();
      const [name, ...rest] = (b.dataset.act ?? '').split(':');
      void this.act(name, rest.join(':'), b);
    });
    this.el.app.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement;
      const k = t.dataset.input;
      if (!k) return;
      if (k === 'time') {
        const m = +t.value;
        this.e.env.set({ minutes: m }, true);
        const out = document.getElementById('timeOut'); if (out) out.textContent = V.fmtTime(m);
        t.setAttribute('aria-valuetext', V.fmtTime(m));
        this.renderTop();
      } else if (k === 'fog') this.e.env.set({ fog: +t.value });
      else if (k === 'wind') this.e.env.set({ wind: +t.value });
    });
    this.el.app.addEventListener('change', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.dataset.input === 'time') { this.e.setTime(+t.value, true, true); this.nearbyCache.clear(); }
    });
    this.el.rvSkip.addEventListener('click', () => this.reveal.skip());
    // « Jumelles » : maintenir pour zoomer ×3, relâcher pour revenir (§65) ; au clavier, Espace / Entrée maintenus
    let held = 0;
    const holdOn = (t: EventTarget | null) => { if ((t as HTMLElement)?.closest?.('[data-hold="binoculars"]') && !held) { held = this.d.zoom || 1; this.d.setZoom(3); this.interacted(); } };
    const holdOff = () => { if (held) { this.d.setZoom(held); held = 0; } };
    this.el.app.addEventListener('pointerdown', (e) => holdOn(e.target));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.el.app.addEventListener(ev, holdOff);
    this.el.app.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) holdOn(e.target); });
    this.el.app.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') holdOff(); });
    // retour long sur « Retour » : places récentes (§70)
    this.el.top.addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).closest('[data-act="back"]')) { e.preventDefault(); this.openPanel('where', e.target as HTMLElement); } });
    this.e.quality.lite ||= sessionGet('lite', false) || new URLSearchParams(location.search).get('lite') === '1';
    addEventListener('keydown', (e) => this.onKey(e));
    this.el.canvas.addEventListener('focus', () => announce('Stade en 3D. Flèches pour choisir, Entrée pour valider, B pour la liste des places.'));
  }

  async act(name: string, arg: string, src?: HTMLElement) {
    const n = +arg;
    switch (name) {
      case 'back': this.back(); break;
      case 'overview': if (this.modes.mode === 'compare') this.endCompare(); this.overview(); break;
      case 'panel': this.openPanel(arg, src); break;
      case 'venue': if (arg !== this.venueId) { this.closePanel(); await this.loadVenue(arg, { cinematic: true }); } else this.closePanel(); break;
      case 'stand': this.focusStand(n); break;
      case 'section': this.focusSection(n); break;
      case 'select': this.selectSeat(n); break;
      case 'goto': this.gotoSeat(n); break;
      case 'deselect': this.deselect(); break;
      case 'pov': if (this.seat >= 0) this.gotoSeat(this.seat); break;
      case 'bestHere': {
        const p = recommend(this.ctx(), this.intent, { section: this.section, n: 1, pref: this.pref })[0];
        if (p) this.selectSeat(p.seat); else this.toast('Aucune place libre dans cette section.');
        break;
      }
      case 'move': if (this.seat >= 0) { this.modes.go('move'); announce('Mode déplacement. Flèches gauche et droite : places. Haut et bas : rangs.'); } break;
      case 'moveDone': this.modes.go('pov'); break;
      case 'step': this.step(arg as 'left'); break;
      case 'info': this.closePanel(); this.infoOpen = !this.infoOpen; if (this.layout === 'mobile' && this.infoOpen) this.sheet.set(1); this.renderCard(); this.insets.schedule(); break;
      case 'compare': if (this.seat >= 0) this.startCompare(); break;
      case 'compareWith': {
        this.hideGhost();
        if (this.modes.mode === 'compare') this.setCompareB(n);
        else if (this.seat >= 0) this.startCompare(n);
        break;
      }
      case 'compareView': this.viewCompare(arg as 'a' | 'b'); break;
      case 'compareSwap': if (this.compareB >= 0) { [this.compareA, this.compareB] = [this.compareB, this.compareA]; this.compareView = this.compareView === 'a' ? 'b' : 'a'; this.render(); } break;
      case 'compareExit': this.endCompare(); break;
      case 'expand': this.expanded = !this.expanded; if (this.layout === 'mobile' && this.expanded) this.sheet.set(2); this.renderCard(); break;
      case 'fav': this.toggleFav(this.seat); if (this.panel === 'where') this.renderPanel(); this.renderTop(); this.renderWorld(); break;
      case 'share': await this.share(); break;
      case 'sound': this.setSound(this.prefs.sound === 'off' ? 'low' : 'off'); break;
      case 'soundLevel': this.setSound(arg as Prefs['sound']); this.renderPanel(); break;
      case 'env': { const [k, v] = arg.split(':'); this.setEnv({ [k]: v } as Partial<EnvironmentSpec>); break; }
      case 'envq': this.quickEnv(arg); break;
      case 'preset': this.setEnv({ minutes: this.e.env.presetMinutes(arg as TimePreset) }); announce(PRESET_LABEL[arg as TimePreset]); break;
      case 'heat': this.setHeat(arg as SeatColorMode); break;
      case 'event': this.setEvent(arg); break;
      case 'intent': this.intent = arg as Intent; this.nearbyCache.clear(); this.renderPanel(); this.renderCard(); break;
      case 'anchor': this.closePanel(); this.anchor(arg); break;
      case 'explode': this.explodeOn = !this.explodeOn; this.e.setExplode(this.explodeOn); this.renderPanel(); break;
      case 'xray': this.e.setXRay(!this.e.xray); this.renderPanel(); break;
      case 'players': this.e.playersOn = !this.e.playersOn; this.renderPanel(); break;
      case 'goal': this.closePanel(); this.goal(); break;
      case 'wave': this.events.wave(!this.e.crowd?.waveOn); break;
      case 'crowd': this.crowd = arg === 'real' ? 'real' : (+arg as CrowdDensity); this.e.setCrowd(this.crowd); this.renderPanel(); break;
      case 'match': this.e.players?.setState(arg as MatchState); this.toast(({ warmup: 'Échauffement', openplay: 'Jeu', corner: 'Corner', freekick: 'Coup franc', penalty: 'Penalty' } as Record<string, string>)[arg] ?? arg); break;
      case 'reveal': this.closePanel(); void this.launchReveal(REVEALS[arg]); break;
      case 'a11y': this.toggleA11y(arg); break;
      case 'viewer': { const [vw, ps] = arg.split(':'); this.d.setPosture(ps as 'seated', vw as 'adult'); this.renderPanel(); break; }
      case 'br': {
        const [k, x] = arg.split(':');
        if (k === 'root') this.browser = { stand: -1, section: -1, row: -1 };
        else if (k === 'stand') this.browser = { stand: +x, section: -1, row: -1 };
        else if (k === 'section') this.browser = { stand: this.e.venue!.sections[+x].stand, section: +x, row: -1 };
        else if (k === 'row') this.browser = { ...this.browser, row: +x };
        this.renderPanel();
        this.el.panel.querySelector<HTMLElement>('.browse button')?.focus();
        break;
      }
      case 'lab': this.onLabToggle?.(); break;
      case 'home': this.closePanel(); if (this.modes.mode === 'compare') this.overview(); else if (this.modes.mode !== 'overview') this.overview(); break;
      case 'envstrip': if (this.hud.stripOpen) this.hud.closeEnvStrip(true); else this.hud.openEnvStrip(src); break;
      case 'recenter': this.closePanel(); this.hud.recenter(); break;
      case 'resumeCompare': this.resumeCompare(); break;
      case 'compareSplit': this.setSplit(!this.split); break;
      case 'compareClear': {
        if (this.compareB >= 0) { this.setMark(this.compareB, null); this.compareB = -1; }
        this.compareView = 'a'; this.seat = this.compareA; this.e.setSecondary(null); this.split = false; this.el.splitlab.hidden = true;
        if (this.compareA >= 0) this.d.switchSeat(this.compareA);
        this.render(); announce('Place B effacée : touchez une autre place à comparer.');
        break;
      }
      case 'immersive': this.closePanel(); this.hud.immersive(true); break;
      case 'fullscreen': this.fullscreenPref = !this.isFullscreen(); sessionSet('fullscreen', this.fullscreenPref); this.setFullscreen(this.fullscreenPref); window.setTimeout(() => this.renderPanel(), 300); break;
      case 'lite': this.e.quality.setLite(!this.e.quality.lite); sessionSet('lite', this.e.quality.lite); this.renderPanel(); this.toast(this.e.quality.lite ? 'Mode léger : moins de détails, même expérience de choix.' : 'Mode léger désactivé'); break;
      case 'eventChip': this.hud.showEvent = !this.hud.showEvent; sessionSet('event', this.hud.showEvent); this.hud.renderEvent(); this.renderPanel(); break;
      case 'follow': this.d.followPlay = arg as 'off'; this.renderPanel(); announce(arg === 'off' ? 'Suivi du jeu désactivé.' : arg === 'ball' ? 'Le regard suit le ballon. Toute saisie l’interrompt.' : 'Le regard suit l’action. Toute saisie l’interrompt.'); break;
      case 'zoom': this.d.setZoom(+arg); this.renderPanel(); announce(+arg > 1 ? `Zoom ×${arg} : ce n’est plus la vision réelle.` : 'Vue réelle, sans zoom.'); break;
      case 'persp': this.setPerspective(arg); break;
      case 'scale': this.showScale(); break;
      default: this.onCustomAct?.(name, arg);
    }
  }
  onLabToggle: (() => void) | null = null;
  onCustomAct: ((name: string, arg: string) => void) | null = null;

  /** Perspective (§63) : la vue courante seule est montrée ; les autres sont dans « Vue ». */
  setPerspective(k: string) {
    if (k === 'pitch') { this.closePanel(); this.anchor('center'); return; }
    if (k === 'aerial') { this.closePanel(); this.anchor('aerial'); return; }
    if (this.seat < 0) return;
    if (!this.d.isPOV) this.gotoSeat(this.seat);
    this.d.setFov(k === 'wide' ? 'wide' : 'natural');
    if ((k === 'standing') !== (this.d.posture === 'standing')) this.d.setPosture(k === 'standing' ? 'standing' : 'seated');
    this.renderPanel();
    announce(k === 'wide' ? 'Champ large' : k === 'standing' ? 'Debout' : 'Vue naturelle, assis');
  }

  /** Échelle (§62) : distance au terrain et repères sur quelques joueurs, puis tout disparaît. */
  private scaleTimer = 0;
  showScale() {
    const p = this.e.players;
    if (!p) return;
    this.closePanel();
    p.showScale = true;
    clearTimeout(this.scaleTimer);
    this.scaleTimer = window.setTimeout(() => { p.showScale = false; }, 3500);
    if (this.seat >= 0) this.hud.flash(`≈ ${Math.round(this.e.statics!.edge[this.seat])} m jusqu’au terrain · ${Math.round(this.e.statics!.dist[this.seat])} m du rond central`, 3500, 2);
  }

  fsSupported() { return !!(document.fullscreenEnabled ?? (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled); }
  isFullscreen() { return !!(document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement); }
  setFullscreen(on: boolean) {
    const d = document as Document & { webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (on && !this.isFullscreen()) void (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
      else if (!on && this.isFullscreen()) void (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    } catch { /* refusé par le navigateur : aucune conséquence */ }
  }

  private toggleA11y(arg: string) {
    const p = this.prefs;
    if (arg === 'reduced') p.reduced = !p.reduced;
    else if (arg === 'comfort') p.comfort = !p.comfort;
    else if (arg === 'contrast') p.contrast = !p.contrast;
    else if (arg === 'captions') p.captions = !p.captions;
    else if (arg.startsWith('text:')) p.text = arg.slice(5) as Prefs['text'];
    this.applyPrefs();
    this.renderPanel();
    this.el.panel.querySelector<HTMLElement>(`[data-act="a11y:${arg}"]`)?.focus();
  }

  setSound(s: Prefs['sound']) {
    this.prefs.sound = s;
    try { this.audio.volume = s === 'full' ? 1 : 0.5; this.audio.setEnabled(s !== 'off'); this.audio.energy = this.e.event.energy; } catch { /* son optionnel : silence */ }
    this.renderTop();
    announce(s === 'off' ? 'Son coupé' : 'Son d’ambiance activé');
  }

  // ------------------------------------------------------------------ clavier

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.matches('input, textarea, select')) return;
    this.interacted();
    if (this.onPresenterKey?.(e)) return;
    const m = this.modes.mode;
    const onCanvas = t === this.el.canvas || t === document.body;
    if (e.key === 'Escape') { e.preventDefault(); this.back(); return; }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.hud.undo(); return; }
    if (e.key === 'Home' && !this.panel) { e.preventDefault(); this.hud.recenter(); return; }
    if (e.key === '?' ) { this.openPanel('help'); return; }
    if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) { this.openPanel('browser'); return; }
    if (this.panel || !this.ready) return;
    if (!onCanvas && e.key.startsWith('Arrow')) return;
    const v = this.e.venue!;
    if (e.key === 'm' || e.key === 'M') { if (m === 'pov') void this.act('move', ''); else if (m === 'move') this.modes.go('pov'); return; }
    if (e.key === 'c' || e.key === 'C') { if (this.seat >= 0 && m !== 'compare') this.startCompare(); return; }
    if (e.key === 'i' || e.key === 'I') { if (m === 'pov') void this.act('info', ''); return; }
    if (!e.key.startsWith('Arrow') && e.key !== 'Enter') return;
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (m === 'overview') {
      if (e.key === 'Enter') { this.focusStand(Math.max(0, this.stand)); return; }
      const order = v.stands.map((s) => s.idx);
      this.focusStand(order[(Math.max(0, order.indexOf(this.stand)) + (dir || 1) + order.length) % order.length]);
    } else if (m === 'stand') {
      const secs = v.stands[this.stand].tiers.flatMap((tt) => tt.sections);
      if (e.key === 'Enter' || !secs.length) { if (secs.length) this.focusSection(secs[0]); return; }
      const cur = secs.indexOf(this.section);
      const d2 = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : dir;
      if (cur < 0) { this.section = secs[0]; this.focusSection(secs[0]); }
      else this.focusSection(secs[(cur + d2 + secs.length) % secs.length]);
    } else if (m === 'section') {
      if (e.key === 'Enter') { void this.act('bestHere', ''); return; }
      const s = v.sections[this.section];
      const st = v.stands[s.stand].tiers[s.tier].sections;
      const k = st.indexOf(this.section);
      if (dir) this.focusSection(st[(k + dir + st.length) % st.length]);
      else { const all = v.stands[s.stand].tiers.map((tt) => tt.sections[Math.min(tt.sections.length - 1, s.indexInStand)]); const ti = s.tier + (e.key === 'ArrowUp' ? 1 : -1); if (ti >= 0 && ti < all.length) this.focusSection(all[ti]); }
    } else if (m === 'seat') {
      if (e.key === 'Enter') { this.gotoSeat(this.seat); return; }
      const n = neighbor(v, this.seat, e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down');
      if (n >= 0) this.selectSeat(n);
    } else if (m === 'pov' || m === 'move' || m === 'compare') {
      if (e.key === 'Enter') { if (m === 'pov') void this.act('info', ''); return; }
      if (e.shiftKey || m === 'compare') {
        this.d.userLook();
        const k = 0.12;
        this.d.applyLook(this.d.yaw + (e.key === 'ArrowLeft' ? k : e.key === 'ArrowRight' ? -k : 0), this.d.pitch + (e.key === 'ArrowUp' ? k * 0.7 : e.key === 'ArrowDown' ? -k * 0.7 : 0));
        return;
      }
      if (this.seat < 0) return;
      this.step(e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'forward' : 'back');
    }
  }
  onPresenterKey: ((e: KeyboardEvent) => boolean) | null = null;

  // ------------------------------------------------------------------ utilitaires

  private favKey() { return `vantage.fav.${this.venueId}`; }
  private favList(): number[] {
    try { return (JSON.parse(localStorage.getItem(this.favKey()) ?? '[]') as string[]).map((id) => parseSeatId(this.e.venue!, id)).filter((i) => i >= 0); } catch { return this.favMem; }
  }
  private favMem: number[] = [];
  isFav(i: number) { return this.favList().includes(i); }
  toggleFav(i: number) {
    if (i < 0) return;
    const list = this.favList();
    const on = !list.includes(i);
    const next = on ? [...list, i] : list.filter((x) => x !== i);
    this.favMem = next;
    try { localStorage.setItem(this.favKey(), JSON.stringify(next.map((x) => seatId(this.e.venue!, x)))); } catch { /* stockage indisponible : mémoire de session */ }
    this.renderCard();
    this.toast(on ? 'Place enregistrée' : 'Place retirée des enregistrées');
    this.haptic(on ? 8 : 0);
  }

  /** Lien partageable : stade, place, environnement, mode de caméra. */
  shareUrl() {
    const u = new URL(location.href);
    const q = new URLSearchParams();
    q.set('v', this.venueId);
    const seat = this.modes.mode === 'compare' && this.compareA >= 0 ? this.compareA : this.seat;
    if (seat >= 0) { q.set('seat', seatId(this.e.venue!, seat)); q.set('mode', this.d.isPOV ? 'pov' : 'seat'); }
    if (this.modes.mode === 'compare' && this.compareB >= 0) q.set('cmp', seatId(this.e.venue!, this.compareB));
    if (this.eventId !== 'night') q.set('event', this.eventId);
    const s = this.e.env.spec;
    q.set('t', String(Math.round(s.minutes)));
    if (s.rain !== 'none') q.set('env', s.rain === 'heavy' ? 'heavy' : 'rain');
    else if (s.clouds === 'overcast') q.set('env', 'cloud');
    if (this.opts.presentation) q.set('presentation', '1');
    u.search = q.toString(); u.hash = '';
    return u.toString();
  }
  private syncUrl() { try { history.replaceState(null, '', this.shareUrl()); } catch { /* file:// ou bac à sable */ } }
  async share() {
    const url = this.shareUrl();
    try { await navigator.clipboard.writeText(url); this.toast('Lien copié'); } catch { this.toast('Lien prêt dans la barre d’adresse'); this.syncUrl(); }
  }

  private toastTimer = 0;
  toast(text: string) {
    const t = this.el.toast;
    t.textContent = text; t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('on'), 2600);
    announce(text);
  }

  private hintTimer = 0;
  hint(text: string, ms = 3200) {
    if (this.opts.capture || this.opts.record) return;
    const h = this.el.hint;
    h.textContent = text; h.classList.add('on');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => h.classList.remove('on'), ms);
  }
  /** Trois indications progressives au plus, une seule fois chacune. */
  private firstHint(key: string, text: string) {
    if (this.hintsShown.has(key) || this.hintsShown.size >= 3) return;
    this.hintsShown.add(key);
    window.setTimeout(() => this.hint(text), 700);
  }

  private captionTimer = 0;
  caption(text: string) {
    if (!this.prefs.captions || !text) return;
    const c = this.el.caption;
    c.textContent = `[${text}]`; c.classList.add('on');
    clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => c.classList.remove('on'), 3500);
  }

  /** Coupe franche (mouvement réduit / confort) : bref fondu au noir (jamais en capture). */
  quietCuts = false;
  /** HUD toujours visible (captures de référence). */
  pinHud = false;
  private flashVeil() {
    if (this.quietCuts || this.opts.capture || this.opts.record) return;
    const v = this.el.veil;
    v.style.transitionDuration = '0ms'; v.style.opacity = '0.6';
    requestAnimationFrame(() => { v.style.transitionDuration = '220ms'; v.style.opacity = '0'; });
  }

}

export const ALL_VENUES = VENUE_ORDER;
