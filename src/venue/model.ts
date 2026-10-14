import type { Compass, RoofConfig, StandKind, TierConfig, VenueConfig } from '../config/types';
import type { Curve } from './curve';

export interface TierModel {
  idx: number;
  cfg: TierConfig;
  d0: number; h0: number; dEnd: number; hEnd: number;
  rows: number; rowDepth: number;
  /** Contremarche minimale configurée. */
  riser: number;
  /** Hauteur du sol de chaque rang (rows + 1 valeurs ; la dernière = hEnd). */
  rowH: number[];
  /** Sections de ce niveau dans cette tribune (indices globaux). */
  sections: number[];
}

export interface RoofModel extends RoofConfig {
  frontH: number; backD: number; backH: number;
}

export interface StandModel {
  idx: number;
  id: string;
  name: string;
  side: Compass;
  kind: StandKind;
  colors: [string, string];
  curve: Curve;
  s0: number; s1: number;
  straight: boolean;
  tiers: TierModel[];
  roof: RoofModel | null;
  /** Poteaux de toit (obstructions). */
  columns: Array<{ x: number; z: number; y0: number; y1: number; r: number }>;
  /** Hauteur du sommet du mur arrière. */
  topH: number;
  backD: number;
  center: { x: number; y: number; z: number };
}

export interface SectionModel {
  idx: number;
  code: string;            // « 104 »
  stand: number;
  tier: number;
  indexInStand: number;
  sa: number; sb: number;  // bornes (abscisse de la courbe de base, allées exclues)
  rows: number;
  rowStart: Int32Array;    // index global du premier siège de chaque rang
  rowCount: Int32Array;
  start: number; count: number;
  away: boolean; family: boolean; ultras: boolean; hospitality: boolean;
  center: { x: number; y: number; z: number };
  front: { x: number; y: number; z: number; nx: number; nz: number };
  radius: number;
}

/** Données statiques d'un lieu : géométrie et identité des sièges. Indépendant de tout événement. */
export interface VenueModel {
  cfg: VenueConfig;
  stands: StandModel[];
  sections: SectionModel[];
  count: number;
  /** Position du sol du rang sous le siège. */
  px: Float32Array; py: Float32Array; pz: Float32Array;
  /** Normale extérieure (le siège regarde -n). */
  nx: Float32Array; nz: Float32Array;
  /** Profondeur dans la tribune (depuis l'avant du niveau 0). */
  depth: Float32Array;
  section: Uint16Array; row: Uint8Array; num: Uint16Array; tier: Uint8Array; stand: Uint8Array;
  /** Indicateurs : 1 fauteuil, 2 accompagnant. */
  pmr: Uint8Array;
  pitch: { length: number; width: number; runoff: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
  grid: SeatGrid;
}

export interface SeatGrid {
  cell: number;
  map: Map<number, Int32Array>;
}

export const gridKey = (cx: number, cy: number, cz: number) => ((cx + 512) * 1024 + (cy + 64)) * 1024 + (cz + 512);
