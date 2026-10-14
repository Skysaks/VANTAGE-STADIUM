import type { QualityProfile } from '../config/types';

export interface QualitySettings { dpr: number; shadows: number; crowdCap: number; bloom: boolean; antialias: boolean; rain: number; surroundings: 'full' | 'lite' }

export const PROFILES: Record<QualityProfile, QualitySettings> = {
  ultra: { dpr: 2, shadows: 2048, crowdCap: 1, bloom: true, antialias: true, rain: 1, surroundings: 'full' },
  high: { dpr: 1.75, shadows: 2048, crowdCap: 1, bloom: false, antialias: true, rain: 0.8, surroundings: 'full' },
  balanced: { dpr: 1.4, shadows: 1024, crowdCap: 0.75, bloom: false, antialias: true, rain: 0.55, surroundings: 'full' },
  low: { dpr: 1, shadows: 0, crowdCap: 0.45, bloom: false, antialias: false, rain: 0.3, surroundings: 'lite' },
  mobile: { dpr: 1.6, shadows: 1024, crowdCap: 0.6, bloom: false, antialias: true, rain: 0.45, surroundings: 'full' },
};
export const PROFILE_ORDER: QualityProfile[] = ['ultra', 'high', 'balanced', 'low'];

/** Palier d'appareil estimé (mémoire, cœurs, GPU déclaré) : fixe le plafond de densité de pixels (§77). */
export type DeviceTier = 'high' | 'mid' | 'low';
export const TIER_DPR: Record<DeviceTier, number> = { high: 2, mid: 1.5, low: 1.2 };

export function estimateTier(gpu: string, touch: boolean): DeviceTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? (touch ? 4 : 8), cores = navigator.hardwareConcurrency ?? 4;
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|mali-[gt][0-6]\d\b|mali-4|adreno \(tm\) [1-5]\d\d|powervr|sgx/.test(g)) return 'low';
  if (mem <= 3 || cores <= 4) return touch ? 'low' : 'mid';
  if (touch && (mem < 6 || cores < 8) && !/apple/.test(g)) return 'mid';
  return 'high';
}

/**
 * Qualité adaptative, graduelle (§78, §81) : on agit d'abord sur la résolution interne du rendu 3D (×1 → ×0,85 → ×0,72),
 * l'interface reste nette ; seulement ensuite on descend d'un profil. Fenêtres de mesure de 2 s, hystérésis :
 * une fenêtre lente suffit pour réduire la résolution, deux pour changer de profil, quatre rapides pour remonter.
 */
export class QualityManager {
  profile: QualityProfile;
  ceiling: QualityProfile;
  auto = true;
  tier: DeviceTier = 'mid';
  /** Échelle de résolution du rendu 3D (indépendante des px CSS de l'interface). */
  resScale = 1;
  /** Mode léger (§82) : choisi par l'utilisateur ou demandé par « économie de données ». */
  lite = false;
  private acc = 0; private frames = 0; private slow = 0; private fast = 0;
  frameMs = 16; fps = 60;
  /** Budget : au-delà, la fenêtre est lente ; en deçà de fastMs, rapide. Mobile : > 35–40 i/s stables. */
  slowMs = 19; fastMs = 12.5;
  onChange: (p: QualityProfile) => void = () => {};

  constructor() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.profile = this.ceiling = coarse ? 'mobile' : 'high';
    if (coarse) { this.slowMs = 25; this.fastMs = 15; }
  }

  setTier(t: DeviceTier, touch: boolean) {
    this.tier = t;
    if (touch && t === 'low' && this.auto) { this.profile = 'low'; }
  }

  get settings(): QualitySettings {
    const s = PROFILES[this.lite ? 'low' : this.profile];
    const cap = Math.min(s.dpr, TIER_DPR[this.tier], window.devicePixelRatio || 1);
    return { ...s, dpr: Math.max(0.6, cap * this.resScale) };
  }

  set(p: QualityProfile, manual = true) {
    if (manual) { this.auto = false; this.ceiling = p; this.resScale = 1; }
    if (p === this.profile) { if (manual) this.onChange(p); return; }
    this.profile = p;
    this.onChange(p);
  }

  setLite(on: boolean) { this.lite = on; this.resScale = 1; this.onChange(this.profile); }

  enableAuto() { this.auto = true; this.slow = this.fast = 0; }

  tick(dtMs: number) {
    this.acc += dtMs; this.frames++;
    if (this.acc < 2000) return;
    this.frameMs = this.acc / this.frames;
    this.fps = 1000 / this.frameMs;
    this.acc = 0; this.frames = 0;
    if (!this.auto || document.hidden) return;
    if (this.frameMs > this.slowMs) { this.slow++; this.fast = 0; } else if (this.frameMs < this.fastMs) { this.fast++; this.slow = 0; } else { this.slow = 0; this.fast = 0; }
    const order: QualityProfile[] = this.ceiling === 'mobile' ? ['mobile', 'low'] : PROFILE_ORDER.slice(PROFILE_ORDER.indexOf(this.ceiling));
    const i = order.indexOf(this.profile);
    // 1) résolution d'abord (dès la première fenêtre lente : on n'attend pas que ce soit inutilisable)
    if (this.slow >= 1 && this.resScale > 0.72) { this.resScale = this.resScale > 0.9 ? 0.85 : 0.72; this.onChange(this.profile); return; }
    // 2) puis le profil
    if (this.slow >= 2 && i < order.length - 1) { this.slow = 0; this.resScale = 0.85; this.set(order[i + 1], false); return; }
    // remontée : la résolution revient avant le profil
    if (this.fast >= 3 && this.resScale < 1) { this.fast = 0; this.resScale = this.resScale < 0.8 ? 0.85 : 1; this.onChange(this.profile); return; }
    if (this.fast >= 4 && i > 0) { this.fast = 0; this.set(order[i - 1], false); }
  }
}
