import * as THREE from 'three';
import type { CloudCover, EnvironmentSpec, EventConfig, RainLevel, TimePreset } from '../config/types';
import { sunVector } from '../venue/metrics';
import type { VenueModel } from '../venue/model';
import type { StadiumParts } from '../engine/StadiumView';
import { RainSystem } from './Rain';
import { buildRoofMask, type RoofMask } from './RoofMask';
import { SKY_FRAG, SKY_VERT } from './skyShader';

const C = (h: string) => new THREE.Color(h);
const lerpC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const CLOUD_VALUE: Record<CloudCover, number> = { clear: 0.04, partly: 0.45, overcast: 0.92 };
export const RAIN_VALUE: Record<RainLevel, number> = { none: 0, light: 0.3, rain: 0.65, heavy: 1 };
export const TIME_PRESETS: TimePreset[] = ['morning', 'midday', 'afternoon', 'golden', 'sunset', 'blue', 'night'];
export const PRESET_LABEL: Record<TimePreset, string> = {
  morning: 'Matin', midday: 'Midi', afternoon: 'Après-midi', golden: 'Heure dorée', sunset: 'Coucher', blue: 'Heure bleue', night: 'Nuit',
};
/** Bornes de l'horloge de l'interface. */
export const DAY_MIN = 8 * 60, DAY_MAX = 23 * 60;

/** État courant (interpolé) : ce que l'on voit à l'image près. */
export interface EnvironmentLive {
  minutes: number; cloud: number; rain: number; fog: number; wind: number; wet: number;
  lights: number; daylight: number; sunAlt: number;
}

/**
 * Moteur d'environnement : heure → soleil astronomique → ciel, nuages, pluie, brume, vent, humidité, projecteurs.
 * Toutes les combinaisons sont valides ; chaque changement est interpolé (3 à 6 s, instantané si mouvement réduit).
 */
export class EnvironmentEngine {
  readonly hemi = new THREE.HemisphereLight('#cfe0f0', '#3a3a32', 1);
  readonly sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  readonly flood = new THREE.DirectionalLight('#f3f6ff', 0);
  readonly floodFill = new THREE.DirectionalLight('#eef2ff', 0);
  spec: EnvironmentSpec = { minutes: 21 * 60, clouds: 'clear', rain: 'none', fog: 0, wind: 0.3, lights: 'auto' };
  live: EnvironmentLive = { minutes: 21 * 60, cloud: 0, rain: 0, fog: 0, wind: 0.3, wet: 0, lights: 0, daylight: 0, sunAlt: 0 };
  /** Durée d'une transition d'ambiance (s). */
  transitionSec = 4.5;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Allumage séquentiel (révélation) : nombre de rampes visibles, null = toutes. */
  sequence: number | null = null;
  crowdLight = 1;
  sunDir = new THREE.Vector3(0, 1, 0);
  /** Appelé (au plus 4 fois/s) quand l'état interpolé change : l'interface n'est jamais redessinée à chaque image. */
  onLive: (l: EnvironmentLive) => void = () => {};
  rainSys: RainSystem;
  roofMask: RoofMask | null = null;

  private sky: THREE.Mesh;
  private skyU: Record<string, THREE.IUniform>;
  private flares: THREE.Points | null = null;
  private flareU = { uOpacity: { value: 0 }, uScale: { value: 600 } };
  private beams: THREE.Mesh[] = [];
  private beamMat: THREE.ShaderMaterial;
  private parts: StadiumParts | null = null;
  private v: VenueModel | null = null;
  private ev: EventConfig | null = null;
  private from: EnvironmentLive = { ...this.live };
  private target: EnvironmentLive = { ...this.live };
  private tStart = 0; private tDur = 0;
  private flash = 0;
  private notify = 0;
  private lastNow = 0;
  private fog: THREE.FogExp2;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.skyU = {
      uTop: { value: C('#3d7cc4') }, uHorizon: { value: C('#cfe2f1') }, uGround: { value: C('#3a3d3a') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: C('#fff1d6') }, uCloud: { value: 0 }, uStars: { value: 0 },
      uCloudLit: { value: C('#ffffff') }, uCloudShade: { value: C('#9aa3ad') }, uTime: { value: 0 }, uWind: { value: 0.3 },
      uGlow: { value: 0 }, uGlowColor: { value: C('#e9eeff') }, uDay: { value: 1 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky, this.hemi, this.sun, this.sun.target, this.flood, this.flood.target, this.floodFill, this.floodFill.target);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    this.flood.position.set(30, 220, 60);
    this.floodFill.position.set(-60, 120, -90);
    this.fog = new THREE.FogExp2('#cfe2f1', 0.0004);
    scene.fog = this.fog;
    this.rainSys = new RainSystem();
    scene.add(this.rainSys.mesh);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: C('#f2f5ff') } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uOpacity; uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(abs(dot(vN, vV)), 1.5); float a = uOpacity * pow(vY, 1.6) * rim; gl_FragColor = vec4(uColor * a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.disposables.push(this.beamMat, this.sky.geometry, this.sky.material as THREE.Material);
  }

  // ---------- cycle de vie ----------

  attach(v: VenueModel, parts: StadiumParts, ev: EventConfig) {
    this.detach();
    this.v = v; this.parts = parts; this.ev = ev;
    const ext = Math.max(v.bounds.maxX, v.bounds.maxZ) + 25;
    const cam = this.sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = 10; cam.far = 900;
    cam.updateProjectionMatrix();
    this.roofMask = buildRoofMask(v);
    this.rainSys.setMask(this.roofMask);
    this.buildFlares(parts);
    this.buildBeams(v, parts);
    this.apply();
  }

  detach() {
    if (this.flares) { this.scene.remove(this.flares); this.flares.geometry.dispose(); (this.flares.material as THREE.Material).dispose(); this.flares = null; }
    for (const b of this.beams) { this.scene.remove(b); b.geometry.dispose(); }
    this.beams = [];
    this.rainSys.setMask(null);
    this.roofMask?.texture.dispose();
    this.roofMask = null;
    this.parts = null;
  }

  setEvent(ev: EventConfig) { this.ev = ev; this.apply(); }

  /** Change la cible. `instant` : saut immédiat (capture, chargement, mouvement réduit). */
  set(s: Partial<EnvironmentSpec>, instant = false) {
    Object.assign(this.spec, s);
    this.retarget(instant || this.reduced);
  }

  /** Heure correspondant à un préréglage, calculée depuis la hauteur réelle du soleil au lieu et à la date de l'événement. */
  presetMinutes(p: TimePreset): number {
    if (!this.v || !this.ev) return { morning: 600, midday: 780, afternoon: 960, golden: 1110, sunset: 1150, blue: 1180, night: 1290 }[p];
    const alt = (m: number) => sunVector(this.v!, this.ev!, m).alt * (180 / Math.PI);
    let noon = DAY_MIN, best = -99;
    for (let m = 9 * 60; m <= 16 * 60; m += 5) { const a = alt(m); if (a > best) { best = a; noon = m; } }
    const after = (deg: number, from: number) => { for (let m = from; m <= DAY_MAX; m += 2) if (alt(m) <= deg) return m; return DAY_MAX; };
    const clampD = (m: number) => Math.max(DAY_MIN, Math.min(DAY_MAX, Math.round(m / 5) * 5));
    switch (p) {
      case 'morning': return clampD(Math.max(DAY_MIN + 60, noon - 210));
      case 'midday': return clampD(noon);
      case 'afternoon': return clampD(Math.min(after(28, noon), noon + 210));
      case 'golden': return clampD(after(7, noon));
      case 'sunset': return clampD(after(0.5, noon));
      case 'blue': return clampD(after(-5, noon));
      default: return clampD(Math.max(21 * 60 + 15, after(-14, noon)));
    }
  }

  presetOf(minutes: number): TimePreset {
    let best: TimePreset = 'night', d = 1e9;
    for (const p of TIME_PRESETS) { const x = Math.abs(this.presetMinutes(p) - minutes); if (x < d) { d = x; best = p; } }
    return best;
  }

  pulse() { this.flash = 1; }

  /** Temps restant de la transition d'ambiance en cours (ms ; 0 si aucune). */
  remainingMs() { return this.tDur > 0 ? Math.max(0, this.tDur * 1000 - (performance.now() - this.tStart)) : 0; }

  setShadows(size: number) {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  /** Densité maximale de pluie (profil de qualité). */
  setRainBudget(k: number) { this.rainSys.budget = k; }

  // ---------- interpolation ----------

  private retarget(instant: boolean) {
    const s = this.spec;
    const rain = RAIN_VALUE[s.rain];
    this.from = { ...this.live };
    this.target = {
      ...this.live,
      minutes: s.minutes,
      cloud: Math.max(CLOUD_VALUE[s.clouds], rain > 0 ? 0.78 + rain * 0.18 : 0),
      rain, fog: s.fog, wind: s.wind,
    };
    // durée : 3 s pour un réglage, jusqu'à 6 s pour un grand saut d'heure
    const dm = Math.abs(this.target.minutes - this.from.minutes);
    this.tDur = instant ? 0 : Math.min(6, Math.max(3, this.transitionSec * (0.6 + dm / 600)));
    this.tStart = performance.now();
    if (instant) { this.live = { ...this.target, wet: rain > 0 ? Math.max(this.live.wet, rain * 0.9) : this.live.wet }; this.apply(); }
  }

  /** Recalcule ciel, soleil et lumières depuis l'état interpolé. */
  private apply() {
    if (!this.v || !this.ev) return;
    const L = this.live;
    const s = sunVector(this.v, this.ev, L.minutes);
    const alt = s.alt * (180 / Math.PI);
    L.sunAlt = alt;
    this.sunDir.set(s.x, s.y, s.z).normalize();
    const cloud = L.cloud;
    const day = smooth(-6, 14, alt);
    L.daylight = day;
    const golden = 1 - smooth(4, 22, alt);
    let top = lerpC(C('#02040a'), C('#13284a'), smooth(-12, 0, alt));
    top = lerpC(top, C('#2f5f99'), smooth(0, 8, alt));
    top = lerpC(top, C('#3a78c2'), smooth(8, 30, alt));
    let hor = lerpC(C('#070d18'), C('#4c3550'), smooth(-10, -1, alt));
    hor = lerpC(hor, C('#f0a25a'), smooth(-2, 3, alt));
    hor = lerpC(hor, C('#d3e3f0'), smooth(6, 28, alt));
    const grey = lerpC(C('#151a21'), C('#a2abb4'), day);
    top = lerpC(top, lerpC(C('#10151c'), C('#86909b'), day), cloud * 0.95);
    hor = lerpC(hor, grey, cloud * 0.9);
    const u = this.skyU;
    u.uTop.value.copy(top);
    u.uHorizon.value.copy(hor);
    u.uGround.value.copy(lerpC(C('#040507'), C('#4a4d48'), day));
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.copy(lerpC(C('#ff9a4a'), C('#fff3dc'), 1 - golden)).multiplyScalar(day);
    u.uCloud.value = cloud;
    u.uStars.value = (1 - day) * (1 - cloud);
    u.uDay.value = day;
    u.uCloudLit.value.copy(lerpC(lerpC(C('#1c212b'), C('#ffd2a6'), smooth(-4, 4, alt)), C('#f4f6f8'), smooth(6, 24, alt))).multiplyScalar(1 - cloud * 0.35);
    u.uCloudShade.value.copy(lerpC(C('#0b0e13'), lerpC(C('#7a6670'), C('#8d96a1'), smooth(4, 20, alt)), day)).multiplyScalar(1 - cloud * 0.3);
    u.uWind.value = L.wind;

    this.sun.color.copy(lerpC(C('#ff9f5a'), C('#fff5e6'), 1 - golden));
    this.sun.intensity = smooth(-1, 10, alt) * 2.7 * (1 - cloud * 0.8);
    this.sun.position.copy(this.sunDir).multiplyScalar(400);
    this.sun.castShadow = this.sun.intensity > 0.15 && this.sun.shadow.mapSize.x > 0;
    this.hemi.color.copy(lerpC(C('#18233a'), C('#d4e3f2'), day));
    this.hemi.groundColor.copy(lerpC(C('#0b0d10'), C('#4a4a3e'), day));
    // brume : légère par beau temps, épaisse par brouillard, plus dense sous la pluie
    this.fog.color.copy(hor).lerp(grey, 0.4);
    this.fog.density = 0.00025 + L.fog * 0.0075 + L.rain * 0.0035 + cloud * 0.0002;
    const sp = this.spec;
    const autoOn = alt < 12 || ((cloud > 0.7 || L.rain > 0 || L.fog > 0.4) && alt < 30);
    this.target.lights = sp.lights === 'on' ? 1 : sp.lights === 'off' ? 0 : autoOn ? 1 : 0;
    this.renderer.toneMappingExposure = 0.94 + (1 - day) * 0.16 - cloud * day * 0.04;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    // interpolation de l'ambiance
    if (this.tDur > 0) {
      const k = Math.min(1, (performance.now() - this.tStart) / (this.tDur * 1000));
      const e = k * k * (3 - 2 * k);
      const F = this.from, T = this.target, L = this.live;
      L.minutes = F.minutes + (T.minutes - F.minutes) * e;
      L.cloud = F.cloud + (T.cloud - F.cloud) * e;
      L.rain = F.rain + (T.rain - F.rain) * e;
      L.fog = F.fog + (T.fog - F.fog) * e;
      L.wind = F.wind + (T.wind - F.wind) * e;
      if (k >= 1) this.tDur = 0;
      this.apply();
    }
    const L = this.live;
    // horloge murale (bornée) : l'ambiance suit le temps réel même si les images sont lentes
    const now = performance.now();
    const dw = this.lastNow ? Math.min(0.5, (now - this.lastNow) / 1000) : dt;
    this.lastNow = now;
    dt = dw;
    // humidité : monte vite sous la pluie (lecture immédiate), sèche lentement
    const wetTarget = L.rain > 0.02 ? Math.min(1, 0.45 + L.rain * 0.55) : 0;
    L.wet += (wetTarget - L.wet) * Math.min(1, dt * (wetTarget > L.wet ? 0.5 : 0.04));
    // projecteurs (montée/descente ~2 s)
    L.lights += (this.target.lights - L.lights) * Math.min(1, dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    const lv = L.lights, night = 1 - L.daylight;
    this.flood.intensity = lv * (1.25 + night * 0.55) + this.flash * 1.2;
    this.floodFill.intensity = lv * night * 0.45;
    this.hemi.intensity = 0.32 + L.daylight * (0.72 + L.cloud * 0.6) + lv * night * 0.42;
    if (this.parts) {
      this.parts.lampMat.color.setScalar(0.25 + lv * 0.95 + this.flash * 0.6);
      this.parts.lampBanks.forEach((b, i) => { b.visible = this.sequence === null ? true : i < this.sequence; });
      // béton mouillé : plus sombre, plus brillant
      const cm = this.parts.concreteMat;
      cm.roughness = 0.92 - L.wet * 0.42;
      cm.color.setScalar(1 - L.wet * 0.18);
    }
    const seqK = this.sequence === null ? 1 : Math.min(1, this.sequence / Math.max(1, this.parts?.lampBanks.length ?? 1));
    this.flareU.uOpacity.value = lv * seqK * (0.25 + night * 0.75) * (1 - L.fog * 0.4);
    this.beamMat.uniforms.uOpacity.value = lv * seqK * night * (0.05 + L.fog * 0.3 + L.rain * 0.22);
    this.skyU.uGlow.value = lv * night * (0.25 + L.cloud * 0.5 + L.fog * 0.5 + L.rain * 0.3);
    this.skyU.uTime.value = t;
    this.crowdLight = Math.max(0.3, Math.min(1.1, L.daylight * (1 - L.cloud * 0.32) + lv * 0.82 * night + 0.14));
    this.rainSys.update(t, camera, L.rain, L.wind, lv * night);
    this.notify += dt;
    if (this.notify > 0.25) { this.notify = 0; this.onLive(L); }
  }

  // ---------- projecteurs : halos et faisceaux ----------

  private buildFlares(parts: StadiumParts) {
    const pts: number[] = [];
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (const b of parts.lampBanks) {
      for (let i = 0; i < b.count; i++) { b.getMatrixAt(i, m); p.setFromMatrixPosition(m); pts.push(p.x, p.y, p.z); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.flareU,
      vertexShader: 'uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(uScale * 2.2 / -mv.z, 2.0, 64.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uOpacity; void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q); float core = (1.0 - smoothstep(0.0, 0.5, r)); float star = max(0.0, 1.0 - abs(q.x) * 18.0) * (1.0 - smoothstep(0.1, 0.5, abs(q.y))) + max(0.0, 1.0 - abs(q.y) * 18.0) * (1.0 - smoothstep(0.1, 0.5, abs(q.x))); float a = (pow(core, 3.0) + star * 0.25) * uOpacity; gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flares = new THREE.Points(g, mat);
    this.flares.frustumCulled = false;
    this.flares.renderOrder = 5;
    this.scene.add(this.flares);
  }

  /** Faisceaux visibles (brume, pluie, nuit) depuis les pylônes ; rideau de lumière sous les rampes de toit. */
  private buildBeams(v: VenueModel, parts: StadiumParts) {
    for (const src of parts.floodSources) {
      const target = new THREE.Vector3(src.x * 0.15, 0, src.z * 0.15);
      const len = src.distanceTo(target);
      const geo = new THREE.CylinderGeometry(1.2, len * 0.32, len, 24, 1, true);
      geo.translate(0, -len / 2, 0);
      // uv.y = 1 près de la source
      const mesh = new THREE.Mesh(geo, this.beamMat);
      mesh.position.copy(src);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(src).normalize());
      mesh.renderOrder = 4;
      mesh.frustumCulled = false;
      if (v.cfg.floodlights === 'roof') mesh.scale.set(2.2, 1, 0.6);
      this.scene.add(mesh);
      this.beams.push(mesh);
    }
  }

  dispose() { this.detach(); this.disposables.forEach((d) => d.dispose()); this.rainSys.dispose(); }
}

export const envSummary = (s: EnvironmentSpec) => {
  const h = Math.floor(s.minutes / 60), m = Math.round(s.minutes % 60);
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const sky = s.rain !== 'none' ? { light: 'Pluie fine', rain: 'Pluie', heavy: 'Forte pluie' }[s.rain] : { clear: 'Ciel dégagé', partly: 'Éclaircies', overcast: 'Couvert' }[s.clouds];
  return `${time} · ${sky}${s.fog > 0.35 ? ' · brume' : ''}`;
};

export { clamp01 };
