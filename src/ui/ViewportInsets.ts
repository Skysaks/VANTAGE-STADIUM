/**
 * ViewportInsets : chaque surface d'interface visible publie la zone qu'elle occupe (bord d'ancrage + rectangle).
 * On en déduit la zone 3D réellement libre ; la caméra décale son centre optique et son cadrage vers cette zone,
 * pour qu'une tribune, une section ou une place visée ne soit jamais cachée par la carte, la feuille, le dock ou la mini-carte.
 */
export type Edge = 'top' | 'bottom' | 'left' | 'right';
export interface Insets { top: number; right: number; bottom: number; left: number }

interface Surface { el: HTMLElement; edge: Edge | ((r: DOMRect) => Edge | null) }

export class ViewportInsets {
  private surfaces = new Map<string, Surface>();
  private ro: ResizeObserver;
  private raf = 0;
  current: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  onChange: (i: Insets) => void = () => {};

  constructor(private root: HTMLElement) {
    this.ro = new ResizeObserver(() => this.schedule());
    addEventListener('resize', () => this.schedule());
  }

  /** Déclare une surface. `edge` peut être calculé (feuille mobile = bas, carte de bureau = droite…). */
  publish(id: string, el: HTMLElement, edge: Surface['edge']) {
    this.surfaces.set(id, { el, edge });
    this.ro.observe(el);
    el.addEventListener('transitionend', () => this.schedule());
    this.schedule();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.measure(); });
  }

  measure() {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    // la racine peut être mise à l'échelle (simulation d'écran du Lab) : on revient en px CSS non transformés
    const rr = this.root.getBoundingClientRect();
    const k = rr.width / Math.max(1, W);
    const out: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const s of this.surfaces.values()) {
      const el = s.el;
      if (!el.isConnected) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || el.getAttribute('aria-hidden') === 'true' && !el.classList.contains('on')) continue;
      const b = el.getBoundingClientRect();
      const r = new DOMRect((b.left - rr.left) / k, (b.top - rr.top) / k, b.width / k, b.height / k);
      if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue;
      const edge = typeof s.edge === 'function' ? s.edge(r) : s.edge;
      if (!edge) continue;
      if (edge === 'top') out.top = Math.max(out.top, r.bottom);
      else if (edge === 'bottom') out.bottom = Math.max(out.bottom, H - r.top);
      else if (edge === 'left') out.left = Math.max(out.left, r.right);
      else out.right = Math.max(out.right, W - r.left);
    }
    // jamais plus de 70 % de l'écran retiré dans une direction (feuille plein écran : on ne recadre plus)
    out.bottom = Math.min(out.bottom, H * 0.62); out.top = Math.min(out.top, H * 0.3);
    out.left = Math.min(out.left, W * 0.45); out.right = Math.min(out.right, W * 0.45);
    const c = this.current;
    if (Math.abs(c.top - out.top) + Math.abs(c.bottom - out.bottom) + Math.abs(c.left - out.left) + Math.abs(c.right - out.right) < 2) return;
    this.current = out;
    this.onChange(out);
  }
}
