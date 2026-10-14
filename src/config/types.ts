// Types de configuration — tout ce qui décrit un lieu, un sport, un événement ou une mise en scène
// est déclaratif. Le moteur ne contient aucune donnée propre à un stade, un club ou une marque.

export type Compass = 'N' | 'S' | 'E' | 'W';
export type StandKind = 'main' | 'opposite' | 'home' | 'away' | 'family' | 'standard';
export type SportId = 'football';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog';
export type Archetype = 'compact' | 'arena' | 'grand' | 'classic' | 'olympic';
export type CloudCover = 'clear' | 'partly' | 'overcast';
export type RainLevel = 'none' | 'light' | 'rain' | 'heavy';
export type TimePreset = 'morning' | 'midday' | 'afternoon' | 'golden' | 'sunset' | 'blue' | 'night';

/** État d'environnement demandé (cible). Le moteur interpole vers cette cible en 3 à 6 s. */
export interface EnvironmentSpec {
  /** Minutes depuis minuit, heure locale du lieu (08:00–23:00 dans l'interface). */
  minutes: number;
  clouds: CloudCover;
  rain: RainLevel;
  /** Brume / brouillard 0..1. */
  fog: number;
  /** Vent 0..1 (inclinaison de la pluie, nuages, drapeaux). */
  wind: number;
  lights: 'auto' | 'on' | 'off';
}

/** Identité visuelle d'un archétype : matériaux, toit, abords. Purement déclaratif. */
export interface VenueStyle {
  concrete: string;
  concreteDark: string;
  stair: string;
  roofTop: string;
  roofUnder: string;
  roof: 'membrane' | 'metal' | 'cantilever';
  /** Bandeau de façade extérieure (couleur), visible en vue d'ensemble. */
  facade: string;
  surroundings: 'urban' | 'park' | 'suburban';
}
export type MatchState =
  | 'warmup' | 'kickoff' | 'openplay' | 'corner' | 'freekick' | 'penalty' | 'goal' | 'halftime';
export type QualityProfile = 'ultra' | 'high' | 'balanced' | 'low' | 'mobile';
export type Provenance = 'official' | 'live' | 'calculated' | 'estimated' | 'simulated' | 'community';

/** Marque blanche : le nom, le logo et les couleurs viennent d'ici, jamais du moteur. */
export interface ProductConfig {
  name: string;
  tagline: string;
  logoSvg: string;
  locale: 'fr' | 'en';
  theme: { accent: string; accentInk: string; bg: string; glass: string; text: string; muted: string };
}

export interface TierConfig {
  label: string;
  rows: number;
  rowDepth: number;
  riser: number;
  /** Nombre de sections par tribune (ou par quart de bol). */
  sections: number;
  /** Avancée de ce niveau au-dessus du niveau inférieur (m). Crée une obstruction réaliste. */
  overhang?: number;
  /** Hauteur libre entre le dernier rang du niveau inférieur et le premier de celui-ci. */
  gap?: number;
  /** Hauteur du premier rang au-dessus de la pelouse (niveau 0 uniquement). */
  firstRowHeight?: number;
  /**
   * Gradinage à valeur C constante (mm). Absent : contremarche constante (tribunes anciennes).
   * Présent : chaque contremarche est calculée pour garantir ce dégagement au-dessus de la tête du rang devant,
   * sans descendre sous `riser` ni dépasser la pente maximale (37°).
   */
  cTarget?: number;
}

export interface RoofConfig {
  /** Profondeur, depuis l'avant de la tribune, du bord avant du toit. Négatif : le toit avance au-dessus du terrain. */
  cover: number;
  /** Hauteur du bord avant du toit au-dessus du dernier rang. */
  clearance: number;
  /** Poteaux de soutien placés dans une allée sur N (vieux stades) : source d'obstruction. */
  columns?: number;
}

export interface StandConfig {
  id: string;
  name: string;
  side: Compass;
  kind: StandKind;
  /** Distance entre la ligne du terrain et l'avant du premier rang. */
  setback: number;
  /** Longueur d'une tribune droite (layout 'stands'). */
  length?: number;
  tiers?: TierConfig[];
  roof?: RoofConfig | null;
  /** Couleurs des sièges [principale, motif]. */
  colors: [string, string];
}

export interface BowlConfig {
  shape: 'superellipse' | 'track';
  setbackSide: number;
  setbackEnd: number;
  exponent?: number;
  /** Piste : demi-longueur des lignes droites et rayon des virages. */
  trackStraight?: number;
  trackRadius?: number;
  tiers: TierConfig[];
  roof: RoofConfig | null;
  stands: Omit<StandConfig, 'setback' | 'length' | 'tiers'>[];
}

export interface VenueConfig {
  /** Identifiant stable, utilisé dans les liens profonds (?v=arena). */
  id: string;
  archetype: Archetype;
  label: string;
  /** Une phrase : ce qui distingue ce lieu (sélecteur de stade). */
  pitchLine: string;
  style: VenueStyle;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  /** Orientation du terrain : angle (deg) entre le nord géographique et l'axe -Z du monde. */
  orientationDeg: number;
  sport: SportId;
  layout: 'stands' | 'bowl';
  stands?: StandConfig[];
  bowl?: BowlConfig;
  corners?: 'open' | 'filled';
  track?: boolean;
  seatWidth: number;
  aisle: number;
  floodlights: 'pylons' | 'roof';
  /** Tribune et sections (indices dans la tribune, niveau 0) réservées aux visiteurs. */
  away: { stand: string; sections: number[] };
  /** Sections familiales (tribune, niveau, indices). */
  family?: { stand: string; tier: number; sections: number[] };
  /** Sections « ultras » (debout permanent, drapeaux). */
  ultras?: { stand: string; tier: number; sections: number[] };
  hospitality?: { stand: string; tier: number; sections: number[] };
}

export interface SportConfig {
  id: SportId;
  surface: { length: number; width: number; runoff: number };
  playersPerTeam: number;
  states: MatchState[];
}

export interface TeamConfig {
  name: string;
  short: string;
  kit: string;
  kitAlt: string;
  shorts: string;
  gk: string;
}

export interface EventConfig {
  id: string;
  label: string;
  competition: string;
  home: TeamConfig;
  away: TeamConfig;
  /** Date locale AAAA-MM-JJ. */
  date: string;
  /** Coup d'envoi en minutes depuis minuit (heure locale). */
  kickoff: number;
  tzOffset: number;
  weather: Weather;
  /** Intensité de l'événement : 0 stade calme, 1 match normal, 2 derby, 3 finale. */
  energy: 0 | 1 | 2 | 3;
  occupancy: number;
  priceFactor: number;
  matchState: MatchState;
}

export type RevealStage = 'country' | 'city' | 'stadium' | 'event' | 'zone' | 'block' | 'row' | 'seat';
export type RevealStyle = 'quick' | 'cinematic' | 'epic';

export interface RevealConfig {
  id: string;
  label: string;
  style: RevealStyle;
  eventId: string;
  stages: RevealStage[];
  mystery: { stadium?: boolean; opponent?: boolean; seat?: boolean };
  /** Choix du siège : meilleur rapport qualité-prix dans une tribune donnée, ou hospitalité. */
  seat: { stand?: string; tier?: number; hospitality?: boolean };
  /** Révéler le siège exact ou seulement la zone. */
  exactSeat: boolean;
}

export interface CameraConfig {
  /** Hauteurs d'œil au-dessus du sol du rang (m). */
  eye: { adultSeated: number; adultStanding: number; childSeated: number; childStanding: number };
  /** Champ horizontal visé (deg) ; le champ vertical est plafonné pour éviter l'effet fish-eye. */
  fov: { natural: number; wide: number; focus: number; maxVertical: number };
  lookLimits: { yaw: number; pitchUp: number; pitchDown: number };
}
