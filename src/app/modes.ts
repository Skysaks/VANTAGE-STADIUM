/**
 * Machine d'états de l'expérience (UI/UX System v1.0). Un seul mode actif ; pas de booléens épars.
 * Chaque mode déclare ses sorties autorisées et son retour (« Retour »).
 */
export type ExperienceMode = 'overview' | 'stand' | 'section' | 'seat' | 'pov' | 'move' | 'compare' | 'reveal' | 'lab';

export const MODE_LABEL: Record<ExperienceMode, string> = {
  overview: 'Vue d’ensemble', stand: 'Tribune', section: 'Section', seat: 'Place', pov: 'Vue depuis la place',
  move: 'Se déplacer', compare: 'Comparer', reveal: 'Révélation', lab: 'Experience Lab',
};

const ALLOWED: Record<ExperienceMode, ExperienceMode[]> = {
  overview: ['stand', 'section', 'seat', 'pov', 'reveal', 'lab', 'overview'],
  stand: ['overview', 'section', 'seat', 'pov', 'stand', 'reveal', 'lab'],
  section: ['overview', 'stand', 'section', 'seat', 'pov', 'reveal', 'lab'],
  seat: ['overview', 'stand', 'section', 'seat', 'pov', 'compare', 'reveal', 'lab'],
  pov: ['overview', 'section', 'seat', 'pov', 'move', 'compare', 'reveal', 'lab'],
  move: ['pov', 'overview', 'seat', 'compare', 'reveal', 'lab', 'move'],
  compare: ['pov', 'overview', 'seat', 'move', 'reveal', 'lab', 'compare'],
  reveal: ['pov', 'overview', 'lab'],
  lab: ['overview', 'stand', 'section', 'seat', 'pov', 'move', 'compare', 'reveal'],
};

/** Mode atteint par « Retour » depuis chaque mode (si l'historique ne dit pas mieux). */
export const BACK_OF: Record<ExperienceMode, ExperienceMode> = {
  overview: 'overview', stand: 'overview', section: 'overview', seat: 'section', pov: 'seat',
  move: 'pov', compare: 'pov', reveal: 'pov', lab: 'overview',
};

export class ModeMachine {
  mode: ExperienceMode = 'overview';
  prev: ExperienceMode = 'overview';
  private listeners = new Set<(m: ExperienceMode, prev: ExperienceMode) => void>();

  can(to: ExperienceMode) { return ALLOWED[this.mode].includes(to); }

  go(to: ExperienceMode): boolean {
    if (!this.can(to)) { console.warn(`[modes] transition refusée ${this.mode} → ${to}`); return false; }
    if (to === this.mode) return true;
    this.prev = this.mode;
    this.mode = to;
    this.listeners.forEach((f) => f(to, this.prev));
    return true;
  }

  /** Remise à zéro sans validation (réinitialisation de démonstration, chargement d'un lieu). */
  reset(to: ExperienceMode = 'overview') { this.prev = this.mode; this.mode = to; this.listeners.forEach((f) => f(to, this.prev)); }

  on(f: (m: ExperienceMode, prev: ExperienceMode) => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
}
