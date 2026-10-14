/**
 * Feuille mobile à crans proportionnels à la hauteur utile (§34) : téléphones hauts 15 / 38 / 72 %,
 * plus courts 18 / 44 / 78 % ; en texte agrandi, crans plus hauts (le prix et l'action ne sont jamais coupés). Glisser la poignée ou l'en-tête ; un geste rapide passe au cran suivant.
 * Accessible : la poignée est un bouton (Entrée / Espace = cran suivant, Échap = réduire).
 */
export class Sheet {
  snap = 0;
  private drag: { y: number; t: number; base: number; moved: boolean } | null = null;
  private justDragged = 0;
  onSnap: (k: number) => void = () => {};

  constructor(readonly el: HTMLElement, private grab: HTMLElement) {
    const start = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.sheet-head, .grab') || t.closest('button:not(.grab), a, input, select')) return;
      this.drag = { y: e.clientY, t: e.timeStamp, base: this.height(this.snap), moved: false };
      this.el.classList.add('dragging');
      this.el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.drag) return;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dy) > 4) this.drag.moved = true;
      const h = Math.max(this.height(0) * 0.6, Math.min(this.height(2), this.drag.base - dy));
      this.el.style.setProperty('--sheet-h', `${h}px`);
    };
    const end = (e: PointerEvent) => {
      if (!this.drag) return;
      const dy = e.clientY - this.drag.y, v = dy / Math.max(1, e.timeStamp - this.drag.t);
      const moved = this.drag.moved;
      this.drag = null;
      this.el.classList.remove('dragging');
      if (!moved) return;
      this.justDragged = performance.now();
      const h = parseFloat(this.el.style.getPropertyValue('--sheet-h'));
      let k = [0, 1, 2].reduce((b, i) => (Math.abs(this.height(i) - h) < Math.abs(this.height(b) - h) ? i : b), 0);
      if (v < -0.5) k = Math.min(2, this.snap + 1);
      else if (v > 0.5) k = Math.max(0, this.snap - 1);
      this.set(k);
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    grab.addEventListener('click', () => { if (performance.now() - this.justDragged > 300) this.set(this.snap === 2 ? 0 : this.snap + 1); });
    grab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.set(this.snap === 2 ? 0 : this.snap + 1); }
      if (e.key === 'Escape' && this.snap > 0) { e.stopPropagation(); this.set(0); }
    });
  }

  height(k: number) {
    const H = this.el.parentElement?.clientHeight || innerHeight;
    const tall = H >= 760;
    const big = document.documentElement.dataset.text === 'lg' ? 1.15 : document.documentElement.dataset.text === 'xl' ? 1.32 : 1;
    const f = tall ? [0.15, 0.38, 0.72] : [0.18, 0.44, 0.78];
    const min = [118 * big, 260 * big, 0][k];
    return Math.round(Math.min(H * 0.86, Math.max(min, H * f[k] * (k < 2 ? big : 1))));
  }

  /** Recalcule le cran courant (rotation, barre d'outils, taille du texte). */
  refresh() { if (this.el.dataset.snap) this.el.style.setProperty('--sheet-h', `${this.height(this.snap)}px`); }

  set(k: number) {
    this.snap = k;
    this.el.style.setProperty('--sheet-h', `${this.height(k)}px`);
    this.el.parentElement?.style.setProperty('--sheet-cur', `${this.height(k)}px`);
    this.el.dataset.snap = String(k);
    this.grab.setAttribute('aria-label', k === 2 ? 'Réduire la fiche' : 'Agrandir la fiche');
    this.grab.setAttribute('aria-expanded', String(k > 0));
    this.onSnap(k);
  }
}
