import * as THREE from 'three';
import type { RoofMask } from './RoofMask';

// Pluie : traînées orientées selon la vitesse (gravité + vent), deux couches :
//  • proche, autour de la caméra (profondeur, grosses traînées qui passent devant l'œil) ;
//  • stade entier (lecture de la pluie depuis la vue d'ensemble, largeur minimale d'un pixel).
// Aucune goutte sous un toit ou un niveau supérieur : la carte d'abri est lue dans le vertex shader.

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uSpeed; uniform vec2 uWind;
uniform float uLen; uniform float uWidth; uniform vec2 uViewport; uniform float uFollow;
uniform sampler2D uMask; uniform float uMaskExt; uniform float uUseMask;
varying float vAlpha; varying vec2 vUv;
void main() {
  float sp = uSpeed * (0.85 + aSeed.w * 0.3);
  float fall = uTime * sp;
  vec3 vel = normalize(vec3(uWind.x, -1.0, uWind.y));
  vec3 p;
  p.y = mod(aSeed.y * uBox.y - fall, uBox.y);
  vec2 drift = uWind * (uBox.y - p.y);
  vec2 c = uCenter.xz * uFollow;
  p.xz = c + mod(aSeed.xz * uBox.xz + drift - c, uBox.xz) - uBox.xz * 0.5;
  p.y += uCenter.y * uFollow - uBox.y * 0.35 * uFollow;
  float hide = step(p.y, 0.05);
  if (uUseMask > 0.5) {
    vec2 muv = (p.xz + uMaskExt) / (2.0 * uMaskExt);
    if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) {
      float h = texture2D(uMask, muv).r;
      hide = max(hide, step(p.y, h + 0.2));
    }
  }
  vec3 a = p, b = p - vel * uLen;
  vec4 ca = projectionMatrix * viewMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(b, 1.0);
  vec2 sa = ca.xy / ca.w * uViewport * 0.5, sb = cb.xy / cb.w * uViewport * 0.5;
  vec2 dir = normalize(sa - sb + vec2(1e-5));
  vec2 side = vec2(-dir.y, dir.x);
  // largeur à l'écran : largeur réelle projetée, jamais moins de 0,8 px (l'opacité compense)
  float wpx = uWidth * uViewport.y / max(ca.w, 0.1);
  float w = max(wpx, 1.0);
  vec4 cp = mix(cb, ca, position.y);
  cp.xy += side * position.x * w / (uViewport * 0.5) * cp.w;
  gl_Position = cp;
  float near = smoothstep(0.4, 2.0, ca.w);
  vAlpha = (1.0 - hide) * clamp(wpx / 1.0, 0.3, 1.0) * near * step(0.0, min(ca.w, cb.w));
  vUv = vec2(position.x + 0.5, position.y);
  if (hide > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uOpacity; uniform float uLit;
varying float vAlpha; varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
  float a = vAlpha * uOpacity * across * along;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.62, 0.68, 0.76), vec3(0.95, 0.97, 1.0), uLit);
  gl_FragColor = vec4(col, a);
}`;

interface Layer { mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; max: number; u: Record<string, THREE.IUniform> }

export class RainSystem {
  mesh = new THREE.Group();
  /** Plafond imposé par le profil de qualité (0..1). */
  budget = 1;
  private layers: Layer[] = [];
  private mask: RoofMask | null = null;
  private vp = new THREE.Vector2(1280, 800);

  constructor() {
    // couche proche : 70 × 40 × 70 m autour de l'œil ; couche stade : 320 × 75 × 320 m centrée sur le terrain
    this.layers.push(this.layer(9000, new THREE.Vector3(60, 36, 60), 1, 1.2, 0.024, 0.55));
    this.layers.push(this.layer(26000, new THREE.Vector3(330, 75, 330), 0, 2.2, 0.05, 0.32));
    this.mesh.visible = false;
  }

  private layer(max: number, box: THREE.Vector3, follow: number, len: number, width: number, opacity: number): Layer {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    const seed = new Float32Array(max * 4);
    let s = 1234567;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < seed.length; i++) seed[i] = r();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = 0;
    const u: Record<string, THREE.IUniform> = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: box }, uSpeed: { value: 11 },
      uWind: { value: new THREE.Vector2(0.1, 0.05) }, uLen: { value: len }, uWidth: { value: width },
      uViewport: { value: this.vp }, uFollow: { value: follow }, uMask: { value: null }, uMaskExt: { value: 1 }, uUseMask: { value: 0 },
      uOpacity: { value: opacity }, uLit: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.mesh.add(mesh);
    return { mesh, geo, max, u };
  }

  setMask(m: RoofMask | null) {
    this.mask = m;
    for (const l of this.layers) { l.u.uMask.value = m?.texture ?? null; l.u.uMaskExt.value = m?.ext ?? 1; l.u.uUseMask.value = m ? 1 : 0; }
  }

  setViewport(w: number, h: number) { this.vp.set(w, h); }

  /** intensity 0..1 ; lit = éclairage des projecteurs la nuit (gouttes brillantes). */
  update(t: number, camera: THREE.Camera, intensity: number, wind: number, lit: number) {
    const on = intensity > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    const camHigh = camera.position.y > 90;
    for (const [k, l] of this.layers.entries()) {
      const near = k === 0;
      // de très haut, la couche proche n'apporte rien : on la coupe
      const n = near && camHigh ? 0 : Math.round(l.max * Math.min(1, intensity) * this.budget * (near ? 1 : 0.5 + intensity * 0.5));
      l.geo.instanceCount = n;
      l.u.uTime.value = t;
      l.u.uCenter.value.copy(camera.position);
      l.u.uSpeed.value = 8.5 + intensity * 5;
      l.u.uWind.value.set(0.05 + wind * 0.32, 0.03 + wind * 0.12);
      l.u.uLit.value = lit;
      l.u.uOpacity.value = (near ? 0.55 : 0.36) * (0.65 + intensity * 0.6) * (1 + lit * 0.8);
    }
    void this.mask;
  }

  dispose() { for (const l of this.layers) { l.geo.dispose(); (l.mesh.material as THREE.Material).dispose(); } }
}
