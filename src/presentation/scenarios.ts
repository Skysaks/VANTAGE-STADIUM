import type { App } from '../app/App';
import { envPreset } from '../app/App';
import { REVEALS } from '../config/events';
import type { TimePreset } from '../config/types';
import { quality } from '../app/intelligence';

// Scénarios de présentation 01–07, réinitialisation de démonstration et états déterministes (Lab, tests, captures).

export interface Scenario { id: string; n: string; key: string; title: string; sub: string }
export const SCENARIOS: Scenario[] = [
  { id: '1', n: '01', key: 'day', title: 'Jour, vue d’ensemble', sub: 'Vantage Arena · après-midi dégagé · stade plein' },
  { id: '2', n: '02', key: 'night', title: 'Match de nuit', sub: 'Vantage Grand · nuit · guichets fermés · projecteurs' },
  { id: '3', n: '03', key: 'rain', title: 'Pluie, place abritée', sub: 'Vantage Classic · pluie · vue depuis une place couverte' },
  { id: '4', n: '04', key: 'olympic', title: 'Distance olympique', sub: 'Vantage Olympic · jour · place haute en virage' },
  { id: '5', n: '05', key: 'switch', title: 'Changer de place', sub: 'Vantage Arena · comparaison directe A/B' },
  { id: '6', n: '06', key: 'goal', title: 'Moment de but', sub: 'Vantage Compact · nuit · ambiance de derby' },
  { id: '7', n: '07', key: 'reveal', title: 'Révélation cinématique', sub: 'Vantage Arena · nuit · de l’aérien à la place' },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pm = (app: App) => (p: TimePreset) => app.e.env.presetMinutes(p);

async function ensureVenue(app: App, id: string, instant: boolean) {
  if (app.venueId !== id || !app.e.venue) await app.loadVenue(id, { cinematic: !instant });
}

/** Place centrale d'une tribune, à une fraction de la hauteur du niveau. */
export function standSeat(app: App, kind: string, tier = 0, rowFrac = 0.45, secOffset = 0) {
  const v = app.e.venue!;
  const st = v.stands.find((s) => s.kind === kind) ?? v.stands[0];
  const t = st.tiers[Math.min(tier, st.tiers.length - 1)];
  const secs = t.sections;
  const sec = v.sections[secs[Math.max(0, Math.min(secs.length - 1, Math.floor(secs.length / 2) + secOffset))]];
  const r = Math.min(sec.rows - 1, Math.round(sec.rows * rowFrac));
  return sec.rowStart[r] + Math.floor(sec.rowCount[r] / 2);
}

/** Meilleure place abritée (latérales d'abord), pour montrer la protection du toit sous la pluie. */
export function coveredSeat(app: App) {
  const c = app.ctx(), v = c.v;
  let best = -1, bq = -1;
  for (let i = 0; i < v.count; i++) {
    if (!c.sm.covered[i] || !c.em.avail[i]) continue;
    const k = v.stands[v.stand[i]].kind;
    if (k !== 'main' && k !== 'opposite') continue;
    const q = quality(c, i, 'view');
    if (q > bq) { bq = q; best = i; }
  }
  return best >= 0 ? best : standSeat(app, 'opposite', 0, 0.85);
}

/** Place exposée voisine (même tribune, rangs de devant) : pour le contraste couvert / exposé. */
export function exposedNeighbor(app: App, i: number) {
  const c = app.ctx(), v = c.v;
  const sec = v.sections[v.section[i]];
  for (let r = 0; r < sec.rows; r++) {
    const j = sec.rowStart[r] + Math.floor(sec.rowCount[r] / 2);
    if (!c.sm.covered[j]) return j;
  }
  return sec.rowStart[0];
}

export async function demoReset(app: App) {
  app.closePanel();
  if (app.reveal.playing) app.reveal.skip();
  app.intent = 'view';
  app.crowd = 'real';
  app.setHeat('stand');
  app.e.setExplode(false); app.e.setXRay(false); app.e.playersOn = true;
  if (app.eventId !== 'night') app.setEvent('night');
  await ensureVenue(app, 'arena', false);
  app.e.setCrowd('real');
  app.e.players?.setState('openplay');
  app.setEnv(envPreset('day', pm(app)));
  app.overview();
  app.toast('Démonstration réinitialisée');
}

export async function runScenario(app: App, id: string, o: { instant?: boolean } = {}) {
  const sc = SCENARIOS.find((s) => s.id === id || s.key === id || s.n === id);
  if (!sc) { app.toast('Scénario inconnu'); return; }
  const inst = !!o.instant;
  app.closePanel();
  if (app.reveal.playing) app.reveal.skip();
  app.track('scenario', sc.key);
  const P = pm(app);
  switch (sc.key) {
    case 'day': {
      if (app.eventId !== 'night') app.setEvent('night');
      await ensureVenue(app, 'arena', inst);
      app.crowd = 1; app.e.setCrowd(1);
      app.setEnv(envPreset('day', P), inst);
      app.overview();
      break;
    }
    case 'night': {
      await ensureVenue(app, 'grand', inst);
      app.setEvent('final');
      app.crowd = 1; app.e.setCrowd(1);
      app.setEnv({ ...envPreset('night', P), lights: 'on' }, inst);
      app.overview();
      break;
    }
    case 'rain': {
      await ensureVenue(app, 'classic', inst);
      app.setEnv({ minutes: P('afternoon'), clouds: 'overcast', rain: 'rain', fog: 0.15 }, inst);
      const i = coveredSeat(app);
      app.gotoSeat(i, { instant: inst });
      if (!inst) { await wait(1500); app.toast('Place abritée : la pluie tombe devant vous, pas sur vous.'); }
      break;
    }
    case 'olympic': {
      await ensureVenue(app, 'olympic', inst);
      app.setEnv(envPreset('day', P), inst);
      app.gotoSeat(standSeat(app, 'home', 1, 0.85), { instant: inst });
      if (!inst) { await wait(1800); app.toast(`Place haute en virage : ${Math.round(app.e.statics!.dist[app.seat])} m du rond central.`); }
      break;
    }
    case 'switch': {
      await ensureVenue(app, 'arena', inst);
      app.setEnv(envPreset('day', P), inst);
      const a = standSeat(app, 'main', 0, 0.3, -1);
      app.gotoSeat(a, { instant: inst });
      if (!inst) await wait(1700);
      const b = standSeat(app, 'main', 1, 0.5, 0);
      app.startCompare(b);
      break;
    }
    case 'goal': {
      await ensureVenue(app, 'compact', inst);
      app.setEvent('derby');
      app.crowd = 1; app.e.setCrowd(1);
      app.setEnv({ ...envPreset('night', P) }, inst);
      const v = app.e.venue!;
      const main = v.stands.find((s) => s.kind === 'main')!;
      const secs = main.tiers[0].sections;
      const sec = v.sections[secs[secs.length - 2]];
      const r = Math.round(sec.rows * 0.4);
      app.gotoSeat(sec.rowStart[r] + Math.floor(sec.rowCount[r] * 0.6), { instant: inst });
      await wait(inst ? 50 : 1600);
      app.goal();
      break;
    }
    case 'reveal': {
      await ensureVenue(app, 'arena', inst);
      app.setEnv({ ...envPreset('night', P) }, true);
      await wait(200);
      void app.launchReveal({ ...REVEALS.surprise, style: 'cinematic' });
      break;
    }
  }
}

/**
 * États déterministes (Lab, régression visuelle) : chaque état est construit sans transition,
 * graines fixes, temps figé. Le nom correspond aux 12 écrans canoniques et à la matrice d'environnements.
 */
export async function applyState(app: App, name: string, o: { venue?: string; env?: string } = {}) {
  const r = app.d.reduced;
  app.d.reduced = true; app.e.env.reduced = true; app.quietCuts = true;
  app.events.enabled = false;
  app.e.timeScale = 1;
  app.closePanel();
  if (app.reveal.playing) app.reveal.skip();
  await ensureVenue(app, o.venue ?? 'arena', true);
  app.e.players?.seed(42);
  app.e.players?.setState('openplay');
  if (app.modes.mode !== 'overview') app.overview();
  app.setEnv({ ...envPreset('day', pm(app)), ...envPreset(o.env ?? 'day', pm(app)) }, true);
  app.e.setTime(app.e.env.spec.minutes, true, true);
  const main = () => standSeat(app, 'main', 0, 0.45);
  switch (name) {
    case 'overview': app.overview(); break;
    case 'stand': app.focusStand(app.e.venue!.stands.findIndex((s) => s.kind === 'main')); break;
    case 'section': app.focusSection(app.e.venue!.section[main()]); break;
    case 'seat': app.selectSeat(main(), { instant: true }); break;
    case 'pov': app.gotoSeat(main(), { instant: true }); break;
    case 'move': app.gotoSeat(main(), { instant: true }); await app.act('move', ''); break;
    case 'compare': app.gotoSeat(main(), { instant: true }); app.startCompare(standSeat(app, 'main', 1, 0.5, 1)); break;
    case 'covered': app.gotoSeat(coveredSeat(app), { instant: true }); break;
    case 'exposed': { const c = coveredSeat(app); app.gotoSeat(exposedNeighbor(app, c), { instant: true }); break; }
    case 'far': app.gotoSeat(standSeat(app, 'home', 1, 0.85), { instant: true }); break;
    case 'goal': app.gotoSeat(main(), { instant: true }); app.goal(); break;
    case 'reveal': {
      app.d.reduced = r; app.e.env.reduced = false;
      void app.launchReveal({ ...REVEALS.surprise, style: 'cinematic' });
      return;
    }
  }
  app.d.reduced = r; app.e.env.reduced = app.prefs.reduced;
  app.interacted();
  window.setTimeout(() => { app.quietCuts = false; }, 300);
}
