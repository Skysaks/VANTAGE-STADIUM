import type { EventConfig, RevealConfig, SportConfig, TeamConfig } from './types';

export const FOOTBALL: SportConfig = {
  id: 'football',
  surface: { length: 105, width: 68, runoff: 6 },
  playersPerTeam: 11,
  states: ['warmup', 'kickoff', 'openplay', 'corner', 'freekick', 'penalty', 'goal', 'halftime'],
};

// Équipes fictives.
const HORIZON: TeamConfig = { name: 'Horizon FC', short: 'HFC', kit: '#1F4FA0', kitAlt: '#FFFFFF', shorts: '#F2F4F7', gk: '#2BB673' };
const RIVIERE: TeamConfig = { name: 'Rivière AC', short: 'RAC', kit: '#E0A526', kitAlt: '#151515', shorts: '#151515', gk: '#8E44AD' };
const ATLAS: TeamConfig = { name: 'Atlas Sporting', short: 'ATS', kit: '#C8102E', kitAlt: '#FFFFFF', shorts: '#FFFFFF', gk: '#F1C40F' };
const NORDVIK: TeamConfig = { name: 'Nordvik United', short: 'NVK', kit: '#1E7F4F', kitAlt: '#FFFFFF', shorts: '#0E3B26', gk: '#E67E22' };

export const EVENTS: Record<string, EventConfig> = {
  night: {
    id: 'night', label: 'Soirée de championnat', competition: 'Championnat · J9',
    home: HORIZON, away: RIVIERE, date: '2026-10-24', kickoff: 21 * 60, tzOffset: 2,
    weather: 'clear', energy: 1, occupancy: 0.82, priceFactor: 1, matchState: 'openplay',
  },
  family: {
    id: 'family', label: 'Match en famille', competition: 'Championnat · J10',
    home: HORIZON, away: NORDVIK, date: '2026-11-01', kickoff: 15 * 60, tzOffset: 1,
    weather: 'clear', energy: 1, occupancy: 0.6, priceFactor: 0.8, matchState: 'openplay',
  },
  derby: {
    id: 'derby', label: 'Derby sous la pluie', competition: 'Derby · J12',
    home: HORIZON, away: ATLAS, date: '2026-11-21', kickoff: 20 * 60 + 45, tzOffset: 1,
    weather: 'rain', energy: 2, occupancy: 0.96, priceFactor: 1.35, matchState: 'openplay',
  },
  final: {
    id: 'final', label: 'Finale de coupe', competition: 'Coupe · Finale',
    home: ATLAS, away: NORDVIK, date: '2027-05-29', kickoff: 21 * 60, tzOffset: 2,
    weather: 'clear', energy: 3, occupancy: 1, priceFactor: 2.2, matchState: 'openplay',
  },
};
export const EVENT_ORDER = ['night', 'family', 'derby', 'final'];

export const REVEALS: Record<string, RevealConfig> = {
  ticket: {
    id: 'ticket', label: 'Billet classique', style: 'quick', eventId: 'night',
    stages: ['event', 'zone', 'seat'], mystery: {}, seat: { stand: 'S', tier: 0 }, exactSeat: true,
  },
  surprise: {
    id: 'surprise', label: 'Match surprise', style: 'cinematic', eventId: 'derby',
    stages: ['country', 'city', 'stadium', 'event', 'zone', 'block', 'row', 'seat'],
    mystery: { stadium: true, opponent: true, seat: true }, seat: { stand: 'N', tier: 0 }, exactSeat: true,
  },
  vip: {
    id: 'vip', label: 'Expérience VIP', style: 'epic', eventId: 'final',
    stages: ['stadium', 'event', 'zone', 'seat'], mystery: { opponent: true },
    seat: { hospitality: true }, exactSeat: true,
  },
};
export const REVEAL_ORDER = ['ticket', 'surprise', 'vip'];
