import * as THREE from 'three';
import type { EventConfig } from '../config/types';
import type { VenueModel } from '../venue/model';

// Foule : un quad par spectateur, toujours tourné vers la caméra (billboard cylindrique),
// silhouette dessinée dans le fragment shader. 2 triangles par personne, animation 100 % GPU.

const VERT = /* glsl */ `
attribute vec3 aPos; attribute vec2 aN; attribute vec3 aColor;
attribute float aSeed; attribute float aKind; attribute float aSeat; attribute float aTier; attribute float aSec; attribute float aCovered;
uniform float uTime; uniform float uStand; uniform float uGoal; uniform float uEnergy;
uniform float uHideSeat; uniform float uHideSeat2; uniform float uExplode; uniform float uFocusSec; uniform float uDim; uniform float uClap;
uniform float uGoalAge; uniform vec2 uGoalPos; uniform float uGoalTeam; uniform float uWave; uniform float uRain;
varying vec2 vLocal; varying vec3 vColor; varying float vSeed; varying float vH; varying float vArms; varying float vShade;
varying float vFront; varying float vPoncho; varying float vHat;
#include <fog_pars_vertex>
void main() {
  float ultras = step(0.5, aKind) * step(aKind, 1.5);
  float away = step(1.5, aKind) * step(aKind, 2.5);
  float stand = smoothstep(aSeed - 0.04, aSeed + 0.04, uStand);
  stand = max(stand, ultras * step(0.5, uEnergy));
  // but : la clameur se propage depuis le but marqué (≈ 45 m/s), les supporters adverses restent assis
  float dGoal = length(aPos.xz - uGoalPos);
  float fan = mix(1.0 - away, away, uGoalTeam);
  float wave = smoothstep(0.0, 0.25, uGoalAge - dGoal / 45.0) * (1.0 - smoothstep(6.0, 9.0, uGoalAge));
  float cheer = max(uGoal * fan, wave * fan * step(0.0, uGoalAge));
  stand = max(stand, cheer);
  // ola : une vague qui fait le tour du stade
  float ang = atan(aPos.z, aPos.x);
  float ola = uWave * (1.0 - smoothstep(0.0, 0.35, abs(mod(ang - uTime * 0.9 + 3.14159, 6.28318) - 3.14159)));
  stand = max(stand, ola);
  float H = mix(1.30, 1.76, stand);
  float jump = cheer * abs(sin(uTime * 7.0 + aSeed * 40.0)) * 0.2;
  float arms = max(max(cheer, ola), ultras * step(1.5, uEnergy) * step(0.55, fract(aSeed * 7.3)) * (0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 9.0)));
  arms = max(arms, uClap * step(0.7, fract(aSeed * 3.1)) * 0.6);
  float QH = H + 0.45 * step(0.01, arms);
  vec3 toCam = cameraPosition - aPos; toCam.y = 0.0;
  vFront = dot(normalize(toCam + vec3(1e-4, 0.0, 0.0)), vec3(-aN.x, 0.0, -aN.y));
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  float W = 0.72;
  vec3 p = aPos + right * position.x * W;
  p.y += position.y * QH + jump + sin(uTime * 1.3 + aSeed * 20.0) * 0.012 + aTier * uExplode;
  p.xz -= aN * mix(0.04, 0.22, stand);
  if (abs(aSeat - uHideSeat) < 0.5 || abs(aSeat - uHideSeat2) < 0.5) p = vec3(0.0, -2000.0, 0.0);
  vLocal = vec2(position.x * W, position.y * QH);
  vH = H; vArms = arms; vColor = aColor; vSeed = aSeed;
  // pluie : une partie des spectateurs non abrités sort capuches et ponchos
  vPoncho = uRain * (1.0 - aCovered) * step(fract(aSeed * 17.3), 0.25 + uRain * 0.45);
  vHat = step(0.9, fract(aSeed * 23.1));
  vShade = (uFocusSec >= 0.0 && abs(aSec - uFocusSec) > 0.5) ? uDim : 1.0;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uLight;
varying vec2 vLocal; varying vec3 vColor; varying float vSeed; varying float vH; varying float vArms; varying float vShade;
varying float vFront; varying float vPoncho; varying float vHat;
#include <common>
#include <fog_pars_fragment>
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec3 hairOf(float s) {
  float k = fract(s * 5.1);
  vec3 h = k < 0.34 ? vec3(0.018, 0.016, 0.014) : k < 0.62 ? vec3(0.055, 0.035, 0.022) : k < 0.8 ? vec3(0.12, 0.075, 0.04) : k < 0.92 ? vec3(0.32, 0.24, 0.12) : vec3(0.3, 0.3, 0.3);
  return h;
}
void main() {
  vec2 p = vLocal; float H = vH;
  vec2 hq = (p - vec2(0.0, H - 0.12)) / vec2(1.0, 1.1);
  float dHead = length(hq) - 0.1;
  float dEar = length(vec2(abs(p.x) - 0.098, p.y - (H - 0.135))) - 0.022;
  float tTop = H - 0.24, tBot = H - 0.86;
  float dTorso = box(p - vec2(0.0, (tTop + tBot) * 0.5), vec2(0.2 - clamp(tTop - p.y, 0.0, 1.0) * 0.05 + vPoncho * 0.03, (tTop - tBot) * 0.5), 0.08);
  float dNeck = box(p - vec2(0.0, H - 0.22), vec2(0.045, 0.05), 0.02);
  float dLegs = 1.0;
  if (H > 1.5) dLegs = box(vec2(abs(p.x) - 0.09, p.y - tBot * 0.5), vec2(0.065, tBot * 0.5), 0.03);
  float dArms = 1.0;
  if (vArms > 0.01) {
    float lift = vArms * 0.32;
    dArms = box(vec2(abs(p.x) - (0.22 + (p.y - (H - 0.3)) * 0.1), p.y - (H - 0.3 + lift)), vec2(0.04, lift + 0.02), 0.035);
  }
  float d = min(min(min(dHead, dEar), dTorso), min(dNeck, min(dLegs, dArms)));
  if (d > 0.0) discard;
  vec3 skin = mix(vec3(0.72, 0.5, 0.38), vec3(0.25, 0.16, 0.11), fract(vSeed * 13.7));
  vec3 hair = hairOf(vSeed);
  vec3 c = vColor;
  vec3 poncho = fract(vSeed * 31.7) < 0.45 ? vec3(0.2, 0.23, 0.27) : (fract(vSeed * 41.3) < 0.4 ? vec3(0.5, 0.38, 0.05) : vColor * 0.6);
  if (vPoncho > 0.5) c = poncho;
  if (dHead >= 0.0 && dEar < 0.0) c = skin * 0.8;
  else if (dHead < 0.0) {
    float y = (p.y - (H - 0.12)) / 0.11;           // -1 bas, 1 haut
    float face = smoothstep(0.1, 0.6, vFront);      // vu de face (depuis le terrain) ou de dos (depuis les gradins)
    // de dos : cheveux avec mèches, reflet, nuque visible pour les cheveux courts
    float strands = 0.9 + 0.1 * sin(p.x * 210.0 + sin(p.y * 38.0 + vSeed * 20.0) * 2.5 + vSeed * 50.0);
    float sheen = smoothstep(0.55, 0.95, y - p.x * 3.0) * 0.5;
    vec3 back = hair * strands * (0.75 + 0.45 * smoothstep(-0.2, 0.9, y)) + vec3(sheen * 0.06);
    float shortHair = step(0.45, fract(vSeed * 7.7));
    back = mix(back, skin * 0.85, shortHair * (1.0 - smoothstep(-0.95, -0.55, y)));
    vec3 front = mix(skin, hair, smoothstep(0.35, 0.6, y));
    c = mix(back, front, face);
    if (vHat > 0.5) c = mix(c, vColor * 0.55, smoothstep(0.15, 0.3, y));
    if (vPoncho > 0.5) c = mix(c, poncho * 0.9, smoothstep(-0.2, 0.1, y + abs(p.x) * 3.0 - face * 1.2));
    c *= 0.7 + 0.3 * clamp(-dHead * 9.0, 0.0, 1.0);
  }
  else if (dTorso >= 0.0 && dLegs < 0.0) c = vec3(0.06, 0.07, 0.09);
  else if (dTorso >= 0.0 && dArms < 0.0) {
    // bras levés : manches de la couleur du maillot, main en haut
    float top = H - 0.28 + 2.0 * vArms * 0.32;
    c = p.y > top - 0.1 ? skin : c * 0.92;
  }
  float edge = clamp(-d * 14.0, 0.0, 1.0);
  c *= mix(0.65, 1.0, edge) * (0.8 + 0.2 * clamp(p.y / H, 0.0, 1.0));
  gl_FragColor = vec4(c * uLight * vShade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export type CrowdDensity = 'real' | 0 | 0.25 | 0.5 | 0.75 | 1;
export type StandMode = 'seated' | 'mixed' | 'standing';

export class CrowdLayer {
  mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private geo: THREE.InstancedBufferGeometry;
  count = 0;
  standTarget = 0;
  goalTarget = 0;

  constructor(private v: VenueModel) {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.attributes.position);
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 }, uStand: { value: 0 }, uGoal: { value: 0 }, uEnergy: { value: 1 }, uClap: { value: 0 },
        uHideSeat: { value: -1 }, uHideSeat2: { value: -1 }, uExplode: { value: 0 }, uFocusSec: { value: -1 }, uDim: { value: 0.4 }, uLight: { value: 1 },
        uGoalAge: { value: 99 }, uGoalPos: { value: new THREE.Vector2() }, uGoalTeam: { value: 0 }, uWave: { value: 0 }, uRain: { value: 0 },
      },
    ]);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, fog: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** Remplit les sièges occupés : réels (vendus) ou fraction déterministe. */
  populate(ev: EventConfig, density: CrowdDensity, avail: Uint8Array, cap = 1, covered?: Uint8Array) {
    const v = this.v;
    const idx: number[] = [];
    const frac = density === 'real' ? -1 : density;
    for (let i = 0; i < v.count; i++) {
      const h = ((i * 2654435761) >>> 0) / 4294967296;
      const occupied = frac < 0 ? !avail[i] : h < frac;
      if (occupied) idx.push(i);
    }
    // plafond de qualité : on retire uniformément
    const keep = cap >= 1 ? idx : idx.filter((_, k) => ((k * 40503) % 1000) / 1000 < cap);
    const n = keep.length;
    const aPos = new Float32Array(n * 3), aN = new Float32Array(n * 2), aColor = new Float32Array(n * 3);
    const aCov = new Float32Array(n), aSeed = new Float32Array(n), aKind = new Float32Array(n), aSeat = new Float32Array(n), aTier = new Float32Array(n), aSec = new Float32Array(n);
    const home = [new THREE.Color(ev.home.kit), new THREE.Color(ev.home.kitAlt)];
    const away = [new THREE.Color(ev.away.kit), new THREE.Color(ev.away.kitAlt)];
    const neutral = ['#2b2f36', '#3b4049', '#596069', '#6b4f3a', '#8a8f96', '#1d2128', '#41566e', '#7a2e2e'].map((c) => new THREE.Color(c));
    const c = new THREE.Color();
    keep.forEach((i, k) => {
      const sec = v.sections[v.section[i]];
      aPos[k * 3] = v.px[i]; aPos[k * 3 + 1] = v.py[i]; aPos[k * 3 + 2] = v.pz[i];
      aN[k * 2] = v.nx[i]; aN[k * 2 + 1] = v.nz[i];
      const s = (((i + 7) * 2246822519) >>> 0) / 4294967296;
      aSeed[k] = s; aSeat[k] = i; aCov[k] = covered ? covered[i] : 0; aTier[k] = v.tier[i]; aSec[k] = v.section[i];
      aKind[k] = sec.ultras ? 1 : sec.away ? 2 : sec.family ? 3 : 0;
      if (sec.away) c.copy(away[s < 0.75 ? 0 : 1]);
      else if (sec.ultras) c.copy(home[s < 0.8 ? 0 : 1]);
      else if (s < 0.38) c.copy(home[s < 0.3 ? 0 : 1]);
      else c.copy(neutral[Math.floor(s * 997) % neutral.length]);
      aColor[k * 3] = c.r; aColor[k * 3 + 1] = c.g; aColor[k * 3 + 2] = c.b;
    });
    // libère les anciens tampons GPU avant de remplacer les attributs (sinon fuite à chaque repeuplement)
    this.geo.dispose();
    const set = (name: string, arr: Float32Array, size: number) => this.geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
    set('aPos', aPos, 3); set('aN', aN, 2); set('aColor', aColor, 3); set('aSeed', aSeed, 1);
    set('aKind', aKind, 1); set('aSeat', aSeat, 1); set('aTier', aTier, 1); set('aSec', aSec, 1); set('aCovered', aCov, 1);
    this.geo.instanceCount = n;
    this.count = n;
  }

  setStandMode(m: StandMode) { this.standTarget = m === 'seated' ? 0 : m === 'mixed' ? 0.45 : 1; }

  /** Clameur en cascade depuis le but (x, z) ; team 0 = domicile, 1 = visiteurs. */
  goalAt(x: number, z: number, team: 0 | 1) {
    this.uniforms.uGoalPos.value.set(x, z); this.uniforms.uGoalTeam.value = team; this.goalAge = 0;
  }
  goalAge = 99;
  waveOn = false;

  update(dt: number, t: number) {
    const u = this.uniforms;
    u.uTime.value = t;
    this.goalAge = Math.min(99, this.goalAge + dt);
    u.uGoalAge.value = this.goalAge;
    u.uWave.value += ((this.waveOn ? 1 : 0) - u.uWave.value) * Math.min(1, dt * 1.5);
    u.uStand.value += (this.standTarget - u.uStand.value) * Math.min(1, dt * 2.5);
    u.uGoal.value += (this.goalTarget - u.uGoal.value) * Math.min(1, dt * (this.goalTarget > u.uGoal.value ? 6 : 0.8));
  }

  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
