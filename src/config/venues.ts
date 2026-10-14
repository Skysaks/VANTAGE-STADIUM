import type { VenueConfig } from './types';

// Cinq archétypes fictifs. Aucun ne reproduit un stade réel ; les villes ne servent qu'au calcul du soleil.
// Repère : x = longueur du terrain, z = largeur, nord = -z. Tribunes N/S = latérales, O/E = virages.
// Ajouter un lieu = ajouter un objet ici (voir docs/VENUE_CONFIG.md) : le moteur ne contient aucune donnée de stade.

const arena: VenueConfig = {
  id: 'arena',
  archetype: 'arena',
  label: 'Bol moderne',
  pitchLine: 'Bol continu, trois niveaux, toit membrane qui couvre toutes les places.',
  name: 'Vantage Arena',
  city: 'Toulouse',
  country: 'France',
  lat: 43.58,
  lon: 1.43,
  orientationDeg: 12,
  sport: 'football',
  layout: 'bowl',
  seatWidth: 0.5,
  aisle: 1.2,
  floodlights: 'roof',
  style: {
    concrete: '#767c86', concreteDark: '#4d535d', stair: '#a3a9b1', roofTop: '#e9edf2', roofUnder: '#4a505a',
    roof: 'membrane', facade: '#d9dee5', surroundings: 'urban',
  },
  bowl: {
    shape: 'superellipse',
    exponent: 4,
    setbackSide: 8,
    setbackEnd: 10,
    tiers: [
      { label: 'Niveau 1', rows: 24, rowDepth: 0.8, riser: 0.3, sections: 7, firstRowHeight: 1.0, cTarget: 90 },
      { label: 'Niveau 2', rows: 12, rowDepth: 0.82, riser: 0.48, sections: 7, overhang: 1.2, gap: 3.6, cTarget: 90 },
      { label: 'Niveau 3', rows: 22, rowDepth: 0.84, riser: 0.55, sections: 8, overhang: -1.5, gap: 3.8, cTarget: 90 },
    ],
    roof: { cover: -2, clearance: 6.5 },
    stands: [
      { id: 'S', name: 'Tribune Sud', side: 'S', kind: 'main', colors: ['#1F4FA0', '#2C63C2'] },
      { id: 'N', name: 'Tribune Nord', side: 'N', kind: 'opposite', colors: ['#1F4FA0', '#2C63C2'] },
      { id: 'W', name: 'Virage Ouest', side: 'W', kind: 'home', colors: ['#1A3F86', '#E8ECF2'] },
      { id: 'E', name: 'Virage Est', side: 'E', kind: 'away', colors: ['#1F4FA0', '#3A4A63'] },
    ],
  },
  away: { stand: 'E', sections: [2, 3] },
  family: { stand: 'S', tier: 1, sections: [0, 1] },
  ultras: { stand: 'W', tier: 0, sections: [2, 3, 4] },
  hospitality: { stand: 'S', tier: 1, sections: [3] },
};

const compact: VenueConfig = {
  id: 'compact',
  archetype: 'compact',
  label: 'Stade compact',
  pitchLine: 'Quatre tribunes serrées contre la pelouse, toit partiel : l’ambiance à 6 m du jeu.',
  name: 'Vantage Compact',
  city: 'Lille',
  country: 'France',
  lat: 50.63,
  lon: 3.06,
  orientationDeg: -8,
  sport: 'football',
  layout: 'stands',
  corners: 'filled',
  seatWidth: 0.5,
  aisle: 1.1,
  floodlights: 'pylons',
  style: {
    concrete: '#6e6560', concreteDark: '#47403c', stair: '#9c948e', roofTop: '#3b4048', roofUnder: '#2a2d33',
    roof: 'metal', facade: '#8a3a32', surroundings: 'urban',
  },
  stands: [
    {
      id: 'S', name: 'Tribune Principale', side: 'S', kind: 'main', setback: 6, length: 118,
      colors: ['#B3202A', '#D33B44'],
      tiers: [
        { label: 'Bas', rows: 20, rowDepth: 0.8, riser: 0.3, sections: 8, firstRowHeight: 1.1, cTarget: 80 },
        { label: 'Haut', rows: 18, rowDepth: 0.84, riser: 0.5, sections: 8, overhang: 1, gap: 3.6, cTarget: 80 },
      ],
      roof: { cover: -1, clearance: 5.5 },
    },
    {
      id: 'N', name: 'Tribune Face', side: 'N', kind: 'opposite', setback: 6, length: 118,
      colors: ['#B3202A', '#7E1A20'],
      tiers: [{ label: 'Unique', rows: 34, rowDepth: 0.8, riser: 0.3, sections: 9, firstRowHeight: 1.1, cTarget: 80 }],
      roof: { cover: 6, clearance: 5, columns: 2 },
    },
    {
      id: 'W', name: 'Kop Ouest', side: 'W', kind: 'home', setback: 7, length: 76,
      colors: ['#B3202A', '#F1F1F1'],
      tiers: [{ label: 'Unique', rows: 30, rowDepth: 0.75, riser: 0.3, sections: 5, firstRowHeight: 1.0, cTarget: 80 }],
      roof: { cover: 2, clearance: 4.5 },
    },
    {
      id: 'E', name: 'Tribune Est', side: 'E', kind: 'away', setback: 7, length: 76,
      colors: ['#7E1A20', '#B3202A'],
      tiers: [{ label: 'Unique', rows: 24, rowDepth: 0.8, riser: 0.3, sections: 5, firstRowHeight: 1.0, cTarget: 80 }],
      roof: null,
    },
  ],
  away: { stand: 'E', sections: [0, 1] },
  family: { stand: 'N', tier: 0, sections: [7, 8] },
  ultras: { stand: 'W', tier: 0, sections: [1, 2, 3] },
  hospitality: { stand: 'S', tier: 1, sections: [3, 4] },
};

const grand: VenueConfig = {
  id: 'grand',
  archetype: 'grand',
  label: 'Très grand stade',
  pitchLine: 'Trois niveaux profonds et un toit annulaire : l’échelle d’une finale.',
  name: 'Vantage Grand',
  city: 'Lyon',
  country: 'France',
  lat: 45.76,
  lon: 4.98,
  orientationDeg: 30,
  sport: 'football',
  layout: 'bowl',
  seatWidth: 0.5,
  aisle: 1.3,
  floodlights: 'roof',
  style: {
    concrete: '#5f6169', concreteDark: '#3b3d44', stair: '#8c8f97', roofTop: '#b9bec7', roofUnder: '#30333a',
    roof: 'cantilever', facade: '#2d2f36', surroundings: 'suburban',
  },
  bowl: {
    shape: 'superellipse',
    exponent: 3.6,
    setbackSide: 9,
    setbackEnd: 12,
    tiers: [
      { label: 'Niveau 1', rows: 30, rowDepth: 0.8, riser: 0.3, sections: 8, firstRowHeight: 1.2, cTarget: 90 },
      { label: 'Niveau 2', rows: 18, rowDepth: 0.85, riser: 0.48, sections: 8, overhang: 3.5, gap: 4.4, cTarget: 90 },
      { label: 'Niveau 3', rows: 32, rowDepth: 0.86, riser: 0.55, sections: 10, overhang: -2, gap: 4.2, cTarget: 90 },
    ],
    roof: { cover: -6, clearance: 7.5 },
    stands: [
      { id: 'S', name: 'Tribune Présidentielle', side: 'S', kind: 'main', colors: ['#2E2E36', '#C8102E'] },
      { id: 'N', name: 'Tribune Nord', side: 'N', kind: 'opposite', colors: ['#2E2E36', '#4A4A55'] },
      { id: 'W', name: 'Virage Ouest', side: 'W', kind: 'home', colors: ['#C8102E', '#2E2E36'] },
      { id: 'E', name: 'Virage Est', side: 'E', kind: 'away', colors: ['#2E2E36', '#5A5A66'] },
    ],
  },
  away: { stand: 'E', sections: [3, 4] },
  family: { stand: 'N', tier: 0, sections: [0, 1] },
  ultras: { stand: 'W', tier: 0, sections: [3, 4, 5] },
  hospitality: { stand: 'S', tier: 1, sections: [3, 4] },
};

const classic: VenueConfig = {
  id: 'classic',
  archetype: 'classic',
  label: 'Stade historique',
  pitchLine: 'Quatre tribunes différentes, coins ouverts, poteaux de toit : chaque place a son caractère.',
  name: 'Vantage Classic',
  city: 'Bordeaux',
  country: 'France',
  lat: 44.84,
  lon: -0.57,
  orientationDeg: 4,
  sport: 'football',
  layout: 'stands',
  corners: 'open',
  seatWidth: 0.48,
  aisle: 1.0,
  floodlights: 'pylons',
  style: {
    concrete: '#857c70', concreteDark: '#575047', stair: '#ada395', roofTop: '#7b8a86', roofUnder: '#33362f',
    roof: 'metal', facade: '#b9ab94', surroundings: 'park',
  },
  stands: [
    {
      id: 'S', name: 'Tribune d’Honneur', side: 'S', kind: 'main', setback: 8, length: 112,
      colors: ['#1F5C3F', '#2C7A55'],
      tiers: [
        { label: 'Parterre', rows: 26, rowDepth: 0.78, riser: 0.38, sections: 8, firstRowHeight: 1.2 },
        { label: 'Balcon', rows: 20, rowDepth: 0.82, riser: 0.56, sections: 8, overhang: 5.5, gap: 3.4 },
      ],
      roof: { cover: 3, clearance: 4.2, columns: 2 },
    },
    {
      id: 'N', name: 'Grande Tribune', side: 'N', kind: 'opposite', setback: 9, length: 122,
      colors: ['#1F5C3F', '#E6DCC4'],
      tiers: [{ label: 'Unique', rows: 46, rowDepth: 0.78, riser: 0.44, sections: 10, firstRowHeight: 1.3 }],
      roof: { cover: 12, clearance: 4.5, columns: 3 },
    },
    {
      id: 'W', name: 'Kop des Pins', side: 'W', kind: 'home', setback: 9, length: 82,
      colors: ['#1F5C3F', '#F1EEE6'],
      tiers: [{ label: 'Unique', rows: 40, rowDepth: 0.72, riser: 0.47, sections: 6, firstRowHeight: 1.0 }],
      roof: { cover: 14, clearance: 3.8, columns: 2 },
    },
    {
      id: 'E', name: 'Tribune du Parc', side: 'E', kind: 'away', setback: 11, length: 70,
      colors: ['#2C7A55', '#44515A'],
      tiers: [{ label: 'Unique', rows: 22, rowDepth: 0.8, riser: 0.4, sections: 5, firstRowHeight: 0.9 }],
      roof: null,
    },
  ],
  away: { stand: 'E', sections: [1, 2] },
  family: { stand: 'S', tier: 0, sections: [0, 1] },
  ultras: { stand: 'W', tier: 0, sections: [2, 3] },
  hospitality: { stand: 'S', tier: 1, sections: [3, 4] },
};

const olympic: VenueConfig = {
  id: 'olympic',
  archetype: 'olympic',
  label: 'Stade olympique',
  pitchLine: 'Piste d’athlétisme autour du terrain : plus de recul, plus de hauteur, toit partiel.',
  name: 'Vantage Olympic',
  city: 'Annecy',
  country: 'France',
  lat: 45.9,
  lon: 6.13,
  orientationDeg: 0,
  sport: 'football',
  layout: 'bowl',
  track: true,
  seatWidth: 0.5,
  aisle: 1.2,
  floodlights: 'pylons',
  style: {
    concrete: '#8a8f93', concreteDark: '#5a5f63', stair: '#b7bcc0', roofTop: '#f2f4f5', roofUnder: '#525a5f',
    roof: 'cantilever', facade: '#e6e9eb', surroundings: 'park',
  },
  bowl: {
    shape: 'track',
    trackStraight: 42.2,
    trackRadius: 49,
    setbackSide: 0,
    setbackEnd: 0,
    tiers: [
      { label: 'Bas', rows: 32, rowDepth: 0.8, riser: 0.3, sections: 9, firstRowHeight: 1.6, cTarget: 90 },
      { label: 'Haut', rows: 26, rowDepth: 0.84, riser: 0.5, sections: 9, overhang: 2.5, gap: 3.6, cTarget: 90 },
    ],
    roof: { cover: 12, clearance: 6 },
    stands: [
      { id: 'S', name: 'Tribune d’Honneur', side: 'S', kind: 'main', colors: ['#0F6B5C', '#19907B'] },
      { id: 'N', name: 'Tribune Lac', side: 'N', kind: 'opposite', colors: ['#0F6B5C', '#E2B33C'] },
      { id: 'W', name: 'Virage Ouest', side: 'W', kind: 'home', colors: ['#0F6B5C', '#E7EDEA'] },
      { id: 'E', name: 'Virage Est', side: 'E', kind: 'away', colors: ['#0F6B5C', '#2C4B45'] },
    ],
  },
  away: { stand: 'E', sections: [3, 4] },
  family: { stand: 'N', tier: 0, sections: [0, 1] },
  ultras: { stand: 'W', tier: 0, sections: [3, 4] },
  hospitality: { stand: 'S', tier: 1, sections: [3, 4] },
};

export const VENUES: Record<string, VenueConfig> = { arena, compact, grand, classic, olympic };
/** Ordre de présentation : le stade vitrine d'abord, puis du plus petit au plus atypique. */
export const VENUE_ORDER = ['arena', 'compact', 'grand', 'classic', 'olympic'];
/** Anciens identifiants (liens v2 : A–D). */
export const VENUE_ALIASES: Record<string, string> = { A: 'arena', B: 'compact', C: 'grand', D: 'olympic', modern: 'arena', mega: 'grand', bowl: 'arena' };
export const resolveVenue = (id: string | null | undefined) => {
  if (!id) return null;
  // Own keys only: a link such as ?v=constructor must not resolve to Object.prototype members.
  const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const k = own(VENUES, id) ? id : own(VENUE_ALIASES, id) ? VENUE_ALIASES[id] : own(VENUE_ALIASES, id.toUpperCase()) ? VENUE_ALIASES[id.toUpperCase()] : null;
  return k && own(VENUES, k) ? k : null;
};
