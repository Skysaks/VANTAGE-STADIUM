import type { Engine } from '../engine/Engine';
import type { Atmosphere } from '../engine/Atmosphere';
import type { MatchState } from '../config/types';

export type Moment = 'goal' | 'chance' | 'corner' | 'freekick' | 'chant' | 'wave';

/**
 * Directeur d'événements : rythme le match (occasions, coups de pied arrêtés, chants, ola, buts) et synchronise
 * joueurs, foule (réaction en cascade depuis l'action), écrans géants, panneaux LED, lumière et son.
 * Déterministe en mode capture (désactivé) ; jamais de but automatique pendant une sélection.
 */
export class EventDirector {
  enabled = true;
  /** Probabilité relative d'un but parmi les moments automatiques (vitrine : plus élevée). */
  goalBias = 0.12;
  private next = 18;
  private seed = 7;
  private chantT = 0;
  onMoment: (m: Moment) => void = () => {};
  /** But marqué (après le filet) : le stade l'affiche d'abord (écrans, LED), l'interface ensuite. */
  onScored: () => void = () => {};

  constructor(private e: Engine, private audio: Atmosphere) {}

  attach() {
    if (this.e.players) this.e.players.onGoal = () => this.scored();
    this.next = 18;
  }

  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  update(dt: number) {
    const e = this.e;
    if (this.chantT > 0) { this.chantT -= dt; if (this.chantT <= 0 && e.crowd) e.crowd.uniforms.uClap.value = 0; }
    if (!this.enabled || !e.players || e.director.state === 'REVEAL') return;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = 22 + this.rnd() * 30;
    const r = this.rnd();
    if (r < this.goalBias) this.goal();
    else if (r < 0.4) this.setPiece(this.rnd() < 0.6 ? 'corner' : 'freekick');
    else if (r < 0.7) this.chant();
    else this.chance();
  }

  /** But de l'équipe à domicile : action construite, frappe, filet, puis réaction en cascade. */
  goal() {
    const p = this.e.players;
    if (!p) return;
    p.triggerGoal();
    this.onMoment('goal');
  }

  private scored() {
    const e = this.e, p = e.players!, ev = e.event;
    const gx = e.venue!.pitch.length / 2;
    this.onScored();
    e.crowd?.goalAt(gx, 0, 0);
    if (e.crowd) { e.crowd.goalTarget = 1; window.setTimeout(() => { if (e.crowd) e.crowd.goalTarget = 0; }, 5200); }
    e.pitch && (e.pitch.netKick = 1);
    e.env.pulse();
    e.director.kick(0.6);
    this.audio.roar();
    e.screens?.show({ mode: 'message', title: 'BUT !', sub: ev.home.name.toUpperCase() });
    e.pitch?.setLed(['BUT ! ' + ev.home.name.toUpperCase(), `${p.score.home} – ${p.score.away}`], ['#ffffff', ev.home.kit]);
    window.setTimeout(() => this.scoreboard(), 4500);
    window.setTimeout(() => p.setState('kickoff'), 7000);
    window.setTimeout(() => p.setState('openplay'), 11000);
  }

  scoreboard() {
    const e = this.e, p = e.players, ev = e.event;
    if (!p) return;
    e.screens?.show({ mode: 'score', home: ev.home.short, away: ev.away.short, hs: p.score.home, as: p.score.away, minute: `${p.minute}'`, homeColor: ev.home.kit, awayColor: ev.away.kit });
  }

  setPiece(s: MatchState) {
    const p = this.e.players;
    if (!p) return;
    p.setState(s);
    this.onMoment(s === 'corner' ? 'corner' : 'freekick');
    window.setTimeout(() => p.state === s && p.setState('openplay'), 9000);
  }

  /** Occasion manquée : la foule se lève par vagues puis se rassoit. */
  chance() {
    const e = this.e;
    if (!e.crowd || !e.venue) return;
    const gx = e.venue.pitch.length / 2 * (this.rnd() < 0.5 ? 1 : -1);
    e.crowd.goalAt(gx, 0, 0);
    e.crowd.goalTarget = 0.35;
    window.setTimeout(() => { if (e.crowd) e.crowd.goalTarget = 0; }, 1600);
    this.onMoment('chance');
  }

  /** Chant rythmé (applaudissements) des tribunes populaires. */
  chant() {
    const e = this.e;
    if (!e.crowd) return;
    e.crowd.uniforms.uClap.value = 1;
    this.chantT = 7;
    this.onMoment('chant');
  }

  wave(on: boolean) { if (this.e.crowd) this.e.crowd.waveOn = on; if (on) this.onMoment('wave'); }
}
