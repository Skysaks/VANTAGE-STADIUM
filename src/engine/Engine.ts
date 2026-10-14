import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { EventConfig, VenueConfig } from '../config/types';
import { FOOTBALL } from '../config/events';
import { PRODUCT } from '../config/product';
import { generateVenue } from '../venue/generate';
import { computeEvent, computeStatic, type EventMetrics, type StaticMetrics } from '../venue/metrics';
import type { VenueModel } from '../venue/model';
import { buildStadium, type StadiumParts } from './StadiumView';
import { SeatLayer, type SeatColorMode } from './SeatLayer';
import { CrowdLayer, type CrowdDensity, type StandMode } from './CrowdLayer';
import { PitchLayer } from './PitchLayer';
import { Players } from './Players';
import { ScreenLayer } from './Screens';
import { EnvironmentEngine } from '../environment/EnvironmentEngine';
import { Surroundings } from './Surroundings';
import { QualityManager, estimateTier } from './Quality';
import { buildDetails, buildStaff, type DetailParts } from './Details';
import { SeatNumbers } from './SeatNumbers';
import { CameraDirector } from '../camera/CameraDirector';

/** Libère tout ce qu'un sous-graphe a envoyé au GPU (géométries, matériaux, textures), y compris ce qu'un module aurait oublié. */
function disposeTree(root: THREE.Object3D) {
  const seen = new Set<object>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture && !seen.has(v) && !v.userData.persistent) { seen.add(v); v.dispose(); }
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const k in u) { const v = u[k]?.value; if (v instanceof THREE.Texture && !seen.has(v)) { seen.add(v); v.dispose(); } }
      mat.dispose();
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export interface Diagnostics {
  fps: number; frameMs: number; calls: number; triangles: number; seats: number; visibleSeats: number;
  crowd: number; memoryMB: number; geometries: number; textures: number; camera: string; profile: string;
}

/** Orchestration du rendu. Ne contient aucune règle métier : il affiche ce que les données décrivent. */
export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  director: CameraDirector;
  env: EnvironmentEngine;
  surroundings: Surroundings | null = null;
  quality = new QualityManager();
  venue: VenueModel | null = null;
  statics: StaticMetrics | null = null;
  event!: EventConfig;
  metrics: EventMetrics | null = null;
  stadium: StadiumParts | null = null;
  seats: SeatLayer | null = null;
  crowd: CrowdLayer | null = null;
  pitch: PitchLayer | null = null;
  players: Players | null = null;
  screens: ScreenLayer | null = null;
  details: DetailParts | null = null;
  staff: { group: THREE.Group; dispose(): void } | null = null;
  seatNumbers: SeatNumbers | null = null;
  /**
   * Seconde vue (comparaison) : « split » = deux vues siège synchronisées côte à côte (bureau, sur demande) ;
   * « pip » = incrustation de la place B (mobile), rendue dans une cible réduite une image sur deux.
   */
  secondary: { mode: 'split' | 'pip'; cam: THREE.PerspectiveCamera; rect: { x: number; y: number; w: number; h: number } } | null = null;
  private pipRT: THREE.WebGLRenderTarget | null = null;
  private pipScene = new THREE.Scene();
  private pipCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private pipQuad: THREE.Mesh | null = null;
  private pipTick = 0;
  crowdDensity: CrowdDensity = 'real';
  colorMode: SeatColorMode = 'stand';
  explode = 0; private explodeTarget = 0;
  playersOn = true;
  /** Échelle du temps des animations (0 = figé : captures déterministes). La caméra n'est pas concernée. */
  timeScale = 1;
  private composer: EffectComposer | null = null;
  private clock = new THREE.Clock();
  private t = 0;
  private frameHooks: Array<(dt: number, t: number) => void> = [];
  diag: Diagnostics = { fps: 0, frameMs: 0, calls: 0, triangles: 0, seats: 0, visibleSeats: 0, crowd: 0, memoryMB: 0, geometries: 0, textures: 0, camera: '', profile: '' };
  private diagTimer = 0;
  loadProgress: (label: string, k: number) => void = () => {};
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();

  constructor(private canvas: HTMLCanvasElement) {
    const q = this.quality.settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(q.dpr);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.3, 2600);
    this.camera.position.set(80, 160, 220);
    this.director = new CameraDirector(this.camera, canvas);
    this.director.setViewport(canvas.clientWidth, canvas.clientHeight);
    this.env = new EnvironmentEngine(this.scene, this.renderer);
    this.quality.onChange = () => this.applyQuality();
    // palier d'appareil : plafond de densité de pixels (jamais 3 sur mobile)
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      const touch = matchMedia('(pointer: coarse)').matches;
      this.quality.setTier(estimateTier(gpu, touch), touch);
      this.gpu = gpu;
    } catch { /* informations GPU indisponibles */ }
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) this.quality.lite = true;
    this.renderer.setPixelRatio(this.quality.settings.dpr);
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onFrame(f: (dt: number, t: number) => void) {
    this.frameHooks.push(f);
    return () => { const k = this.frameHooks.indexOf(f); if (k >= 0) this.frameHooks.splice(k, 1); };
  }

  gpu = '';

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    // côte à côte : chaque vue occupe une moitié
    const aw = this.secondary?.mode === 'split' ? Math.floor(w / 2) : w;
    this.camera.aspect = aw / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.director.setViewport(aw, h);
    this.director.resize();
    const b = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.env.rainSys.setViewport(b.x, b.y);
  }

  applyQuality() {
    const q = this.quality.settings;
    this.renderer.setPixelRatio(q.dpr);
    this.env.setShadows(q.shadows);
    this.env.setRainBudget(q.rain);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && 'needsUpdate' in m) m.needsUpdate = true; });
    this.setBloom(q.bloom);
    this.resize();
    if (this.venue && this.crowd && this.metrics) this.crowd.populate(this.event, this.crowdDensity, this.metrics.avail, q.crowdCap, this.statics?.covered);
  }

  get hasBloom() { return !!this.composer; }
  /** Halo réservé au profil Ultra : coûteux, et utile surtout de nuit. */
  setBloom(on: boolean) {
    if (on && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.canvas.clientWidth, this.canvas.clientHeight), 0.35, 0.6, 0.92));
      this.composer.addPass(new OutputPass());
      this.composer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    } else if (!on && this.composer) { this.composer.dispose(); this.composer = null; }
  }

  /** Modèles de lieux déjà calculés (géométrie des places + métriques statiques) : changement de stade quasi immédiat. */
  private modelCache = new Map<string, { v: VenueModel; s: StaticMetrics }>();

  /** Précalcul en tâche de fond (temps libre du navigateur) des autres lieux. */
  prefetch(cfgs: VenueConfig[]) {
    const queue = cfgs.filter((c) => !this.modelCache.has(c.id));
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 200));
    const next = () => {
      const c = queue.shift();
      if (!c) return;
      if (!this.modelCache.has(c.id)) { const v = generateVenue(c, FOOTBALL); this.modelCache.set(c.id, { v, s: computeStatic(v) }); }
      idle(next, { timeout: 4000 });
    };
    idle(next, { timeout: 4000 });
  }

  /** Chargement progressif : pelouse → bol → sièges → foule et joueurs. L'interaction est possible dès les sièges. */
  async loadVenue(cfg: VenueConfig, ev: EventConfig, seatPitch = 1) {
    this.unload();
    this.roofSeeThrough = false;
    this.event = ev;
    this.loadProgress('Génération du stade', 0.05);
    await nextFrame();
    const cached = seatPitch === 1 ? this.modelCache.get(cfg.id) : undefined;
    const v = cached?.v ?? generateVenue(cfg, FOOTBALL, seatPitch);
    this.venue = v;
    this.statics = cached?.s ?? computeStatic(v);
    if (seatPitch === 1) this.modelCache.set(cfg.id, { v, s: this.statics });
    this.metrics = computeEvent(v, this.statics, ev);
    this.director.setVenue(v);
    this.pitch = new PitchLayer(v, this.renderer);
    this.scene.add(this.pitch.group);
    this.loadProgress('Pelouse', 0.25);
    await nextFrame();
    this.stadium = buildStadium(v);
    this.scene.add(this.stadium.group);
    this.surroundings = new Surroundings(v, this.quality.settings.surroundings);
    this.scene.add(this.surroundings.group);
    this.env.attach(v, this.stadium, ev);
    this.director.coverAt = (x, z) => this.env.roofMask?.heightAt(x, z) ?? 0;
    this.loadProgress('Tribunes', 0.45);
    await nextFrame();
    this.seats = new SeatLayer(v);
    this.seats.setAccent(PRODUCT.theme.accent);
    this.seats.setCovered(this.statics.covered);
    this.scene.add(this.seats.mesh);
    this.repaint();
    this.loadProgress(`${v.count.toLocaleString('fr-FR')} places`, 0.65);
    await nextFrame();
    this.screens = new ScreenLayer(this.stadium, PRODUCT.theme.accent);
    this.scene.add(this.screens.group);
    // micro-détails : signalétique, vomitoires, éclairage d'allées, personnel, numéros de sièges proches
    this.details = buildDetails(v);
    this.scene.add(this.details.group);
    this.staff = buildStaff(v);
    this.scene.add(this.staff.group);
    this.seatNumbers = new SeatNumbers(v);
    this.scene.add(this.seatNumbers.group);
    const main = v.stands.find((s) => s.kind === 'main') ?? v.stands[0];
    const mz = main.side === 'N' ? -1 : 1;
    this.players = new Players(v.pitch, mz * (Math.abs(main.curve.at((main.s0 + main.s1) / 2).z) + 1));
    this.scene.add(this.players.group);
    this.crowd = new CrowdLayer(v);
    this.scene.add(this.crowd.mesh);
    this.setEvent(ev);
    this.applyQuality();
    this.loadProgress('Prêt', 1);
  }

  setEvent(ev: EventConfig) {
    this.event = ev;
    if (!this.venue || !this.statics) return;
    this.metrics = computeEvent(this.venue, this.statics, ev, this.env.spec.minutes);
    this.env.setEvent(ev);
    this.crowd?.populate(ev, this.crowdDensity, this.metrics.avail, this.quality.settings.crowdCap, this.statics.covered);
    if (this.crowd) this.crowd.uniforms.uEnergy.value = ev.energy;
    this.players?.setTeams(ev);
    this.players?.setState(ev.matchState);
    this.pitch?.setLed(
      [PRODUCT.name.toUpperCase(), `${ev.home.name.toUpperCase()} – ${ev.away.name.toUpperCase()}`, ev.competition.toUpperCase(), this.venue.cfg.name.toUpperCase()],
      ['#ffffff', PRODUCT.theme.accent, '#cfd6df', ev.home.kit],
    );
    this.repaint();
  }

  /** Heure de la journée (minutes) : soleil, ciel, ombres, projecteurs, ensoleillement des sièges. */
  setTime(minutes: number, recompute = true, instant = false) {
    this.env.set({ minutes }, instant);
    if (recompute && this.venue && this.statics) {
      const m = computeEvent(this.venue, this.statics, this.event, minutes);
      if (this.metrics) { this.metrics.sun = m.sun; this.metrics.lit = m.lit; this.metrics.glare = m.glare; }
      if (this.colorMode === 'sun') this.repaint();
    }
  }

  setCrowd(d: CrowdDensity) {
    this.crowdDensity = d;
    if (this.crowd && this.metrics) this.crowd.populate(this.event, d, this.metrics.avail, this.quality.settings.crowdCap, this.statics?.covered);
  }
  setStandMode(m: StandMode) { this.crowd?.setStandMode(m); }

  repaint(mode: SeatColorMode = this.colorMode) {
    this.colorMode = mode;
    if (!this.seats || !this.statics || !this.metrics) return;
    const s = this.statics, m = this.metrics;
    switch (mode) {
      case 'stand': this.seats.paint('stand', {}); break;
      case 'avail': this.seats.paint('avail', { avail: m.avail }); break;
      case 'price': this.seats.paint('price', { metric: m.price, min: m.minPrice, max: m.maxPrice, avail: m.avail }); break;
      case 'view': this.seats.paint('view', { metric: s.view, min: 40, max: 92, avail: m.avail }); break;
      case 'value': this.seats.paint('value', { metric: m.value, avail: m.avail }); break;
      case 'sun': this.seats.paint('sun', { metric: m.sun, min: 20, max: 90 }); break;
      case 'atmo': this.seats.paint('atmo', { metric: m.atmo, avail: m.avail }); break;
      case 'rain': this.seats.paint('rain', { metric: s.rain, min: 20, max: 96 }); break;
    }
  }

  setFocusSection(sec: number) {
    if (this.seats) this.seats.uniforms.uFocusSec.value = sec;
    if (this.crowd) this.crowd.uniforms.uFocusSec.value = sec;
  }
  setExplode(on: boolean) { this.explodeTarget = on ? 14 : 0; }
  private roofSeeThrough = false;
  xray = false;
  setXRay(on: boolean) {
    this.xray = on; this.roofSeeThrough = !on && this.roofSeeThrough;
    if (!this.stadium) return;
    const m = this.stadium.roofMat;
    m.transparent = on; m.opacity = on ? 0.12 : 1; m.depthWrite = !on; m.needsUpdate = true;
  }
  hideCrowdAt(seat: number) { if (this.crowd) this.crowd.uniforms.uHideSeat.value = seat; }

  /** Active / coupe la seconde vue. La caméra B est posée par l'application à chaque image. */
  setSecondary(s: { mode: 'split' | 'pip'; seat: number; rect?: { x: number; y: number; w: number; h: number } } | null) {
    const was = this.secondary?.mode;
    if (!s) {
      this.secondary = null;
      if (this.crowd) this.crowd.uniforms.uHideSeat2.value = -1;
      if (this.pipRT) { this.pipRT.dispose(); this.pipRT = null; }
      if (was === 'split') this.resize();
      return;
    }
    const cam = this.secondary?.cam ?? new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, this.camera.near, this.camera.far);
    this.secondary = { mode: s.mode, cam, rect: s.rect ?? { x: 0, y: 0, w: 1, h: 1 } };
    if (this.crowd) this.crowd.uniforms.uHideSeat2.value = s.seat;
    if (was !== s.mode && (was === 'split' || s.mode === 'split')) this.resize();
    if (s.mode !== 'pip' && this.pipRT) { this.pipRT.dispose(); this.pipRT = null; }
  }

  private renderScene() {
    const sec = this.secondary, r = this.renderer;
    if (!sec) { if (this.composer) this.composer.render(); else r.render(this.scene, this.camera); return; }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const au = r.shadowMap.autoUpdate;
    if (sec.mode === 'split') {
      const hw = Math.floor(w / 2);
      sec.cam.aspect = (w - hw) / Math.max(1, h); sec.cam.updateProjectionMatrix();
      r.setScissorTest(true);
      r.setViewport(0, 0, hw, h); r.setScissor(0, 0, hw, h); r.render(this.scene, this.camera);
      r.shadowMap.autoUpdate = false;
      r.setViewport(hw, 0, w - hw, h); r.setScissor(hw, 0, w - hw, h); r.render(this.scene, sec.cam);
      r.shadowMap.autoUpdate = au;
      r.setScissorTest(false); r.setViewport(0, 0, w, h);
      return;
    }
    // incrustation : cible réduite (demi-flottants, MSAA) rafraîchie une image sur deux, recopiée à chaque image
    const pr = r.getPixelRatio(), R = sec.rect;
    const tw = Math.max(16, Math.round(R.w * pr)), th = Math.max(16, Math.round(R.h * pr));
    if (!this.pipRT || this.pipRT.width !== tw || this.pipRT.height !== th) {
      this.pipRT?.dispose();
      this.pipRT = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, samples: 4 });
      if (!this.pipQuad) {
        const g = new THREE.PlaneGeometry(1, 1); g.translate(0.5, 0.5, 0);
        this.pipQuad = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
        this.pipScene.add(this.pipQuad);
      }
      (this.pipQuad.material as THREE.MeshBasicMaterial).map = this.pipRT.texture;
      (this.pipQuad.material as THREE.MeshBasicMaterial).needsUpdate = true;
      this.pipTick = 0;
    }
    sec.cam.aspect = R.w / Math.max(1, R.h); sec.cam.updateProjectionMatrix();
    if (this.pipTick++ % 2 === 0) {
      r.shadowMap.autoUpdate = false;
      r.setRenderTarget(this.pipRT); r.render(this.scene, sec.cam); r.setRenderTarget(null);
      r.shadowMap.autoUpdate = au;
    }
    r.render(this.scene, this.camera);
    r.autoClear = false;
    r.setViewport(R.x, h - R.y - R.h, R.w, R.h);
    r.render(this.pipScene, this.pipCam);
    r.setViewport(0, 0, w, h);
    r.autoClear = true;
  }

  unload() {
    this.setSecondary(null);
    for (const o of [this.stadium?.group, this.seats?.mesh, this.crowd?.mesh, this.pitch?.group, this.players?.group, this.screens?.group, this.surroundings?.group, this.details?.group, this.staff?.group, this.seatNumbers?.group]) if (o) { this.scene.remove(o); disposeTree(o); }
    this.stadium?.dispose(); this.seats?.dispose(); this.crowd?.dispose(); this.pitch?.dispose(); this.players?.dispose(); this.screens?.dispose(); this.surroundings?.dispose();
    this.details?.dispose(); this.staff?.dispose(); this.seatNumbers?.dispose();
    this.env.detach();
    this.stadium = this.seats = this.crowd = this.pitch = this.players = this.screens = null;
    this.details = null; this.staff = null; this.seatNumbers = null;
    this.surroundings = null;
    this.venue = null;
  }

  /** Volume mémoire approximatif des buffers principaux (Mo). */
  private memoryEstimate() {
    let b = 0;
    this.scene.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g) return;
      for (const k in g.attributes) b += (g.attributes[k].array as ArrayLike<number> & { byteLength: number }).byteLength;
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) b += im.instanceMatrix.array.byteLength + (im.instanceColor?.array.byteLength ?? 0);
    });
    return b / 1048576;
  }

  private frame() {
    const dtReal = Math.min(this.clock.getDelta(), 0.1);
    const dt = dtReal * this.timeScale;
    this.t += dt;
    this.quality.tick(dtReal * 1000);
    this.director.update(dtReal);
    if (this.venue) {
      if (this.players) { this.players.group.visible = this.playersOn; if (this.playersOn) this.players.update(dt, this.t); }
      this.pitch?.update(dt, this.t);
      if (this.crowd) { this.crowd.update(dt, this.t); this.crowd.uniforms.uLight.value = this.env.crowdLight; }
      this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 3);
      if (this.stadium) for (const [ti, ms] of this.stadium.tierMeshes.entries()) if (ms) for (const m of ms) m.position.y = ti * this.explode;
      if (this.stadium?.roof) this.stadium.roof.position.y = this.stadium.tierMeshes.length * this.explode + this.explode * 0.5;
      this.stadium?.lampBanks.forEach((b) => (b.position.y = this.explode * this.stadium!.tierMeshes.length));
      if (this.seats) this.seats.uniforms.uExplode.value = this.explode;
      if (this.crowd) this.crowd.uniforms.uExplode.value = this.explode;
    }
    // toit : translucide vu d'au-dessus (lecture du bol), opaque depuis les tribunes
    if (this.stadium?.roof && !this.xray) {
      const above = this.camera.position.y > (this.venue?.bounds.maxY ?? 50) + 4;
      if (above !== this.roofSeeThrough) {
        this.roofSeeThrough = above;
        const m = this.stadium.roofMat;
        m.transparent = above; m.opacity = above ? 0.2 : 1; m.depthWrite = !above; m.needsUpdate = true;
      }
    }
    this.env.update(dtReal, this.t, this.camera);
    const L = this.env.live;
    if (this.seats) this.seats.uniforms.uWet.value = L.wet;
    if (this.crowd) this.crowd.uniforms.uRain.value = Math.min(1, L.rain * 1.6);
    this.pitch?.setWet(L.wet);
    this.surroundings?.update(1 - L.daylight, L.wet);
    const nightK = L.lights * (1 - L.daylight);
    this.details?.setNight(nightK);
    // ballon lisible de loin (§93) : au plus ×1,7 au-delà de ~85 m, jamais caricatural
    if (this.players) {
      const d = this.camera.position.distanceTo(this.players.ballPosition);
      this.players.setBallAssist(Math.max(1, Math.min(1.7, d / 50)), nightK);
    }
    for (const f of [...this.frameHooks]) f(dtReal, this.t);
    this.renderer.info.reset();
    this.renderScene();
    // horloge murale : les diagnostics restent à jour même quand les images sont lentes
    const nowMs = performance.now();
    if (nowMs - this.diagTimer > 500) {
      this.diagTimer = nowMs;
      const inf = this.renderer.info;
      let visible = 0;
      if (this.venue) {
        this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projScreen);
        const sp = new THREE.Sphere();
        for (const s of this.venue.sections) { sp.center.set(s.center.x, s.center.y, s.center.z); sp.radius = s.radius; if (this.frustum.intersectsSphere(sp)) visible += s.count; }
      }
      Object.assign(this.diag, {
        fps: this.quality.fps, frameMs: this.quality.frameMs, calls: inf.render.calls, triangles: inf.render.triangles,
        seats: this.venue?.count ?? 0, visibleSeats: visible, crowd: this.crowd?.count ?? 0,
        geometries: inf.memory.geometries, textures: inf.memory.textures, camera: this.director.state, profile: this.quality.profile + (this.quality.auto ? ' (auto)' : ''),
      });
      if (Math.random() < 0.1) this.diag.memoryMB = this.memoryEstimate();
    }
  }
}
