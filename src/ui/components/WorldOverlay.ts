import * as THREE from 'three';

/**
 * Étiquettes dans l'espace écran, ancrées à des points du monde (§41–44). Jamais des milliers : l'application ne déclare
 * que les étiquettes utiles au contexte. Chaque image : projection, mise à l'échelle bornée selon la distance,
 * occultation (rien n'est affiché à travers le béton), collisions résolues par priorité, plafond de densité.
 * Les positions sont écrites directement dans les transforms (aucun rendu de composant par image).
 */
export interface WorldLabel {
  id: string; pos: THREE.Vector3; text: string; kind: 'stand' | 'section' | 'pin' | 'pinB' | 'tag' | 'badge';
  sub?: string; minDist?: number; maxDist?: number; act?: string; data?: string;
  /** Priorité (§43) : 5 sélection, 4 recommandation, 3 survol, 2 section / tribune, 1 autre. */
  prio?: number;
  /** Étiquette en taille fixe (épingles) : pas de mise à l'échelle avec la distance. */
  fixed?: boolean;
}

interface Node { el: HTMLElement; l: WorldLabel; w: number; h: number; occluded: boolean; checked: number }

export class WorldOverlay {
  private nodes = new Map<string, Node>();
  private v = new THREE.Vector3();
  /** Nombre maximal d'étiquettes visibles en même temps (mobile 3–5, bureau 6–10 ; moins en texte agrandi). */
  maxVisible = 8;
  /** Test d'occultation (structure entre la caméra et le point) : fourni par l'application, évalué ≈ 4 fois par seconde. */
  occluded: ((from: THREE.Vector3, to: THREE.Vector3) => boolean) | null = null;
  /** Échelle de référence (DPR, taille d'écran). */
  baseScale = 1;
  constructor(private root: HTMLElement) {}

  set(labels: WorldLabel[]) {
    const keep = new Set(labels.map((l) => l.id));
    for (const [id, n] of this.nodes) if (!keep.has(id)) { n.el.remove(); this.nodes.delete(id); }
    for (const l of labels) {
      let n = this.nodes.get(l.id);
      if (!n) {
        const el = document.createElement(l.act ? 'button' : 'div');
        el.className = `wl wl-${l.kind}`;
        if (l.act) { el.setAttribute('data-act', l.act); if (l.data) el.setAttribute('data-arg', l.data); el.setAttribute('tabindex', '-1'); }
        this.root.append(el);
        n = { el, l, w: 0, h: 0, occluded: false, checked: 0 };
        this.nodes.set(l.id, n);
      }
      const html = `<span class="t">${l.text}</span>${l.sub ? `<span class="s">${l.sub}</span>` : ''}`;
      if (n.el.innerHTML !== html) { n.el.innerHTML = html; n.w = 0; }
      n.l = l;
    }
  }

  clear() { this.set([]); }

  private hide(n: Node) { if (n.el.style.opacity !== '0') { n.el.style.opacity = '0'; n.el.style.pointerEvents = 'none'; } }

  update(cam: THREE.PerspectiveCamera, W: number, H: number) {
    const now = performance.now();
    const cand: Array<{ n: Node; x: number; y: number; s: number; d: number }> = [];
    for (const n of this.nodes.values()) {
      const l = n.l;
      this.v.copy(l.pos).project(cam);
      const d = cam.position.distanceTo(l.pos);
      const onScreen = this.v.z < 1 && this.v.z > -1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05 && d >= (l.minDist ?? 0) && d <= (l.maxDist ?? 1e9);
      if (!onScreen) { this.hide(n); continue; }
      if (this.occluded && now - n.checked > 250 + (n.l.prio ?? 1) * 10) { n.checked = now; n.occluded = this.occluded(cam.position, l.pos); }
      if (n.occluded && !l.fixed) { this.hide(n); continue; }
      const x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      // échelle bornée : jamais d'étiquette géante en s'approchant, jamais illisible au loin
      const s = l.fixed ? 1 : Math.max(0.86, Math.min(1.12, (180 / Math.max(20, d)) * 0.9 + 0.6)) * this.baseScale;
      cand.push({ n, x, y, s, d });
    }
    // collisions : la priorité gagne, puis la proximité du centre de l'écran
    cand.sort((a, b) => (b.n.l.prio ?? 1) - (a.n.l.prio ?? 1) || Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2));
    const placed: Array<[number, number, number, number]> = [];
    let shown = 0;
    for (const c of cand) {
      const n = c.n;
      if (!n.w) { n.w = (n.el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 60; n.h = (n.el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 20; }
      const w = n.w * c.s, h = n.h * c.s;
      const r: [number, number, number, number] = [c.x - w / 2 - 3, c.y - h - 3, c.x + w / 2 + 3, c.y + 3];
      const hit = placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
      if ((hit && (n.l.prio ?? 1) < 5) || shown >= this.maxVisible) { this.hide(n); continue; }
      placed.push(r); shown++;
      n.el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) scale(${c.s.toFixed(3)})`;
      if (n.el.style.opacity !== '1') { n.el.style.opacity = '1'; n.el.style.pointerEvents = ''; }
    }
  }
}
