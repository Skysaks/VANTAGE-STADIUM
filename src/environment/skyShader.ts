// Ciel procédural : dégradé physique simplifié, soleil, nuages (fbm projeté sur un plafond), étoiles,
// halo des projecteurs sur les nuages et la brume la nuit.

export const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform float uCloud; uniform float uStars; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uTime; uniform float uWind;
uniform float uGlow; uniform vec3 uGlowColor; uniform float uDay;
varying vec3 vDir;
#include <common>
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, (1.0 - smoothstep(-0.12, 0.0, h)));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float sunVis = 1.0 - uCloud * 0.9;
  col += uSunColor * (pow(sd, 1400.0) * 9.0 * sunVis + pow(sd, 10.0) * 0.28 * (1.0 - uCloud * 0.6));
  float st = step(0.9985, hash3(floor(d * 420.0))) * uStars * smoothstep(0.05, 0.4, h);
  col += vec3(st);
  // nuages : couvercle à « hauteur » constante, densité réglée par la couverture
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * (0.004 + uWind * 0.02), uTime * 0.002);
    float n = fbm(uv);
    float detail = fbm(uv * 3.1 + 4.0);
    float cover = mix(0.78, 0.18, uCloud);
    float dens = smoothstep(cover, cover + 0.22 + uCloud * 0.25, n * 0.8 + detail * 0.35);
    dens = max(dens, smoothstep(0.55, 1.0, uCloud) * 0.85);
    float lit = clamp(0.55 + (n - detail) * 1.4 + pow(sd, 6.0) * 0.6, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    float fade = smoothstep(0.0, 0.18, h);
    col = mix(col, cc, dens * fade * 0.94);
  }
  // halo des projecteurs (nuit) : réfléchi par les nuages bas et la brume au-dessus du stade
  float up = smoothstep(-0.05, 0.5, h) * (1.0 - smoothstep(0.5, 1.0, h) * 0.5);
  col += uGlowColor * uGlow * 0.16 * up;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
