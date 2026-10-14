/**
 * État d'interface : petit magasin typé, notifié uniquement sur changement sémantique.
 * Le rendu 3D (60 i/s) ne passe jamais par ici : l'interface n'est jamais redessinée à chaque image.
 */
export class Store<S extends object> {
  private subs = new Set<(s: S, changed: Set<keyof S>) => void>();
  private pending = new Set<keyof S>();
  private scheduled = false;
  constructor(public state: S) {}

  get<K extends keyof S>(k: K): S[K] { return this.state[k]; }

  set(patch: Partial<S>) {
    for (const k in patch) {
      if (!Object.is(this.state[k], patch[k])) { (this.state as S)[k] = patch[k] as S[typeof k]; this.pending.add(k); }
    }
    if (this.pending.size && !this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  /** Force la diffusion immédiate (tests déterministes). */
  flush() {
    this.scheduled = false;
    if (!this.pending.size) return;
    const changed = new Set(this.pending);
    this.pending.clear();
    this.subs.forEach((f) => f(this.state, changed));
  }

  subscribe(f: (s: S, changed: Set<keyof S>) => void) { this.subs.add(f); return () => this.subs.delete(f); }
}
