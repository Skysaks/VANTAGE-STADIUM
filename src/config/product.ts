import type { CameraConfig, ProductConfig } from './types';

/** Nom de travail. Remplacer cet objet suffit à renommer ou passer en marque blanche. */
export const PRODUCT: ProductConfig = {
  name: 'Vantage',
  tagline: 'Ressentez votre place avant d’y être.',
  logoSvg:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 7h6l6 14 6-14h6L19 27h-6z" fill="currentColor"/></svg>',
  locale: 'fr',
  theme: {
    accent: '#FF5A36',
    accentInk: '#ffffff',
    bg: '#07090D',
    glass: 'rgba(12,16,22,0.78)',
    text: '#EEF2F6',
    muted: '#93A0AF',
  },
};

export const CAMERA: CameraConfig = {
  eye: { adultSeated: 1.17, adultStanding: 1.62, childSeated: 0.92, childStanding: 1.15 },
  fov: { natural: 68, wide: 96, focus: 26, maxVertical: 62 },
  lookLimits: { yaw: 1.75, pitchUp: 0.6, pitchDown: 0.85 },
};
