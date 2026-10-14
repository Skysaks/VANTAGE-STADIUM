import type { EventConfig } from '../config/types';
import type { EventMetrics, StaticMetrics } from '../venue/metrics';
import { viewLabel } from '../venue/metrics';
import type { VenueModel } from '../venue/model';
import { seatId } from '../venue/generate';

// Intelligence de sélection : qualité explicable par intention, « Mieux à proximité » (améliorations de Pareto),
// recommandations non dominées, comparaison en différences humaines, descriptions pour lecteur d'écran.

/** Conditions du moment (pluie 0..1, soleil fort 0..1) : elles pèsent légèrement sur le classement, toujours expliqué. */
export interface Cond { rain: number; sun: number; daylight: number; night: boolean }
export interface SeatCtx { v: VenueModel; sm: StaticMetrics; em: EventMetrics; ev: EventConfig; cond?: Cond }

/** Bonus borné (±6 points sur 100) : l'abri compte plus sous la pluie, l'ombre plus en plein soleil. Jamais un renversement silencieux. */
export function condBonus(c: SeatCtx, i: number) {
  const k = c.cond;
  if (!k) return 0;
  let b = 0;
  if (k.rain > 0) b += k.rain * (c.sm.rain[i] - 50) * 0.12;
  if (k.sun > 0) b += k.sun * (c.em.lit[i] ? (c.em.glare[i] > 0.3 ? -5 : -2) : 3);
  return Math.max(-6, Math.min(6, b));
}
/** Explication ajoutée quand les conditions ont compté dans le choix. */
export function condWhy(c: SeatCtx, i: number) {
  const k = c.cond;
  if (!k) return '';
  if (k.rain > 0 && c.sm.covered[i]) return 'Mieux protégée dans les conditions actuelles';
  if (k.sun > 0 && !c.em.lit[i]) return 'À l’ombre dans les conditions actuelles';
  return '';
}
export type Intent = 'view' | 'atmo' | 'tactical' | 'close' | 'family' | 'comfort' | 'value';

export const INTENTS: Array<{ id: Intent; label: string; hint: string }> = [
  { id: 'view', label: 'Meilleure vue', hint: 'Tout le terrain, bien centré' },
  { id: 'atmo', label: 'Ambiance', hint: 'Au cœur des supporters' },
  { id: 'tactical', label: 'Tactique', hint: 'En hauteur, pour lire le jeu' },
  { id: 'close', label: 'Au plus près', hint: 'Près de la pelouse' },
  { id: 'family', label: 'En famille', hint: 'Calme, abrité, accès facile' },
  { id: 'comfort', label: 'Confort', hint: 'À l’abri, près des accès' },
  { id: 'value', label: 'Rapport qualité-prix', hint: 'La meilleure vue pour le prix' },
];

export const eur = (x: number) => `${Math.round(x)} €`;
const sgn = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '±');

/** Préférences de session (sans compte) : les places regardées et comparées orientent légèrement le classement. */
export class SessionPreference {
  private tiers = new Map<number, number>();
  private kinds = new Map<string, number>();
  private n = 0;
  note(c: SeatCtx, i: number, w = 1) {
    this.n += w;
    this.tiers.set(c.v.tier[i], (this.tiers.get(c.v.tier[i]) ?? 0) + w);
    const k = c.v.stands[c.v.stand[i]].kind;
    this.kinds.set(k, (this.kinds.get(k) ?? 0) + w);
  }
  /** Bonus 0..6 pour une place qui ressemble à ce que l'utilisateur regarde. */
  bonus(c: SeatCtx, i: number) {
    if (this.n < 3) return 0;
    const t = (this.tiers.get(c.v.tier[i]) ?? 0) / this.n, k = (this.kinds.get(c.v.stands[c.v.stand[i]].kind) ?? 0) / this.n;
    return (t * 0.5 + k * 0.5) * 6;
  }
  reset() { this.tiers.clear(); this.kinds.clear(); this.n = 0; }
}

/** Qualité 0..100 d'une place pour une intention donnée (score continu, jamais affiché tel quel). */
export function quality(c: SeatCtx, i: number, intent: Intent): number {
  return baseQuality(c, i, intent) + condBonus(c, i);
}

function baseQuality(c: SeatCtx, i: number, intent: Intent): number {
  const { sm, em } = c;
  const view = sm.view[i];
  const cover = sm.rain[i];
  switch (intent) {
    case 'view': return view;
    case 'atmo': return 0.65 * em.atmo[i] + 0.35 * view;
    case 'tactical': return 0.45 * sm.parts.height[i] + 0.3 * sm.central[i] + 0.25 * sm.parts.clear[i];
    case 'close': return 0.7 * sm.parts.prox[i] + 0.3 * view;
    case 'family': return 0.45 * sm.family[i] + 0.25 * view + 0.15 * cover + 0.15 * sm.exit[i];
    case 'comfort': return 0.35 * cover + 0.25 * sm.exit[i] + 0.2 * em.sun[i] + 0.2 * view;
    default: return em.value[i];
  }
}

export interface SeatPick { seat: number; q: number; price: number; why: string; tag: string }

/** Recommandations : front de Pareto (qualité ↑, prix ↓) parmi les places libres, puis 3 choix distincts. */
export function recommend(c: SeatCtx, intent: Intent, opts: { stand?: number; section?: number; n?: number; pref?: SessionPreference } = {}): SeatPick[] {
  const { v, em } = c;
  const n = opts.n ?? 3;
  const cand: Array<{ i: number; q: number; p: number }> = [];
  for (let i = 0; i < v.count; i++) {
    if (!em.avail[i] || v.pmr[i]) continue;
    if (opts.stand !== undefined && v.stand[i] !== opts.stand) continue;
    if (opts.section !== undefined && v.section[i] !== opts.section) continue;
    cand.push({ i, q: quality(c, i, intent) + (opts.pref?.bonus(c, i) ?? 0), p: em.price[i] });
  }
  if (!cand.length) return [];
  // front de Pareto : trié par prix croissant, on ne garde que les places meilleures que toutes les moins chères
  cand.sort((a, b) => a.p - b.p || b.q - a.q);
  const front: typeof cand = [];
  let best = -1;
  for (const x of cand) if (x.q > best + 0.5) { front.push(x); best = x.q; }
  const picks: SeatPick[] = [];
  const used = new Set<number>();
  const add = (x: (typeof cand)[number] | undefined, tag: string, why: string) => {
    if (!x || used.has(v.section[x.i]) || picks.length >= n) return;
    used.add(v.section[x.i]);
    picks.push({ seat: x.i, q: x.q, price: x.p, tag, why });
  };
  const top = front[front.length - 1];
  add(top, 'La meilleure', explainTop(c, top.i, intent));
  // meilleur compromis : coude du front (gain de qualité par euro qui s'effondre)
  let knee = front[0], kneeScore = -1e9;
  for (const x of front) { const s = x.q - (x.p - front[0].p) * 0.35; if (s > kneeScore) { kneeScore = s; knee = x; } }
  add(knee, 'Meilleur compromis', `${eur(top.p - knee.p)} de moins que la meilleure, ${qualityGap(top.q - knee.q)}`);
  const cheap = front.find((x) => x.q >= top.q - 18) ?? front[0];
  add(cheap, 'Petit budget', `${eur(cheap.p)}, ${qualityGap(top.q - cheap.q)}`);
  // compléter si des sections se répètent
  for (let k = front.length - 2; k >= 0 && picks.length < n; k--) add(front[k], 'Alternative', explainTop(c, front[k].i, intent));
  return picks;
}

const qualityGap = (d: number) => (d < 3 ? 'pour une vue presque identique' : d < 8 ? 'pour une vue un peu moins bonne' : 'avec une vue nettement moins bonne');

function explainTop(c: SeatCtx, i: number, intent: Intent) {
  const cw = condWhy(c, i);
  const r = [...(cw ? [cw] : []), ...reasons(c, i)].slice(0, 2).join(' · ');
  return intent === 'value' ? `Vue bien meilleure que son prix ne le laisse attendre · ${r}` : r;
}

export interface Nearby { seat: number; kind: 'better' | 'cheaper' | 'upgrade'; dq: number; dp: number; why: string }

/**
 * « Mieux à proximité » : candidats réellement proches (coordonnées, ±6 rangs, sections voisines du même niveau),
 * libres, qui dominent la place actuelle au sens de Pareto (pas pire en qualité ni en prix, nettement mieux sur un axe).
 * Une « montée en gamme » (+qualité nette pour un petit supplément) est proposée à part, jamais mélangée.
 */
export function betterNearby(c: SeatCtx, i: number, intent: Intent, max = 3): Nearby[] {
  const { v, em } = c;
  const q0 = quality(c, i, intent), p0 = em.price[i];
  const x0 = v.px[i], z0 = v.pz[i], y0 = v.py[i];
  const sec = v.sections[v.section[i]];
  const near = v.sections.filter((s) => s.tier === sec.tier && s.stand === sec.stand && Math.abs(s.indexInStand - sec.indexInStand) <= 1).map((s) => s.idx);
  const dom: Array<{ i: number; dq: number; dp: number; d: number }> = [];
  const ups: Array<{ i: number; dq: number; dp: number; d: number }> = [];
  for (const sIdx of near) {
    const s = v.sections[sIdx];
    for (let r = Math.max(0, v.row[i] - 6); r <= Math.min(s.rows - 1, v.row[i] + 6); r++) {
      for (let j = s.rowStart[r]; j < s.rowStart[r] + s.rowCount[r]; j += 1) {
        if (j === i || !em.avail[j] || v.pmr[j]) continue;
        const d = Math.hypot(v.px[j] - x0, v.py[j] - y0, v.pz[j] - z0);
        if (d > 22) continue;
        const dq = quality(c, j, intent) - q0, dp = em.price[j] - p0;
        if (dq >= -0.5 && dp <= 0 && (dq >= 4 || dp <= -5)) dom.push({ i: j, dq, dp, d });
        else if (dq >= 8 && dp > 0 && dp <= Math.max(10, p0 * 0.2)) ups.push({ i: j, dq, dp, d });
      }
    }
  }
  // ne garder que les candidats non dominés entre eux, puis les plus proches
  const frontier = dom.filter((a) => !dom.some((b) => b !== a && b.dq >= a.dq && b.dp <= a.dp && (b.dq > a.dq + 0.5 || b.dp < a.dp - 0.5)));
  const out: Nearby[] = [];
  const better = frontier.filter((x) => x.dq >= 4).sort((a, b) => b.dq - a.dq || a.d - b.d)[0];
  const cheaper = frontier.filter((x) => x.dp <= -5).sort((a, b) => a.dp - b.dp || b.dq - a.dq)[0];
  if (better) out.push({ seat: better.i, kind: 'better', dq: better.dq, dp: better.dp, why: describeMove(c, i, better.i, better.dq, better.dp) });
  if (cheaper && cheaper.i !== better?.i) out.push({ seat: cheaper.i, kind: 'cheaper', dq: cheaper.dq, dp: cheaper.dp, why: describeMove(c, i, cheaper.i, cheaper.dq, cheaper.dp) });
  const up = ups.sort((a, b) => b.dq / Math.max(1, b.dp) - a.dq / Math.max(1, a.dp))[0];
  if (up && out.length < max) out.push({ seat: up.i, kind: 'upgrade', dq: up.dq, dp: up.dp, why: describeMove(c, i, up.i, up.dq, up.dp) });
  return out.slice(0, max);
}

/** « 3 rangs plus haut, 4 places à gauche » : déplacement en langage courant. */
export function relativePosition(c: SeatCtx, a: number, b: number) {
  const { v } = c;
  const parts: string[] = [];
  if (v.section[a] !== v.section[b]) parts.push(`section ${v.sections[v.section[b]].code}`);
  const dr = v.row[b] - v.row[a];
  if (dr) parts.push(`${Math.abs(dr)} rang${Math.abs(dr) > 1 ? 's' : ''} plus ${dr > 0 ? 'haut' : 'bas'}`);
  if (v.section[a] === v.section[b] && v.row[a] === v.row[b]) {
    const dn = v.num[b] - v.num[a];
    parts.push(`${Math.abs(dn)} place${Math.abs(dn) > 1 ? 's' : ''} à ${dn > 0 ? 'droite' : 'gauche'}`);
  }
  return parts.join(', ') || 'à côté';
}

function describeMove(c: SeatCtx, a: number, b: number, dq: number, dp: number) {
  const where = relativePosition(c, a, b);
  const price = dp === 0 ? 'même prix' : dp < 0 ? `${eur(-dp)} de moins` : `${eur(dp)} de plus`;
  const view = dq >= 8 ? 'vue nettement meilleure' : dq >= 4 ? 'vue meilleure' : dq > -1 ? 'vue équivalente' : 'vue un peu moins bonne';
  const cw = c.cond && c.cond.rain > 0 && c.sm.covered[b] && !c.sm.covered[a] ? ' · mieux protégée dans les conditions actuelles' : '';
  return `${where} · ${view}, ${price}${cw}`;
}

export interface Delta { key: string; label: string; text: string; good: boolean | null }

/** Comparaison A → B en différences signifiantes, puis une phrase qui conclut. */
export function compareSeats(c: SeatCtx, a: number, b: number, intent: Intent) {
  const { v, sm, em } = c;
  const deltas: Delta[] = [];
  const dp = em.price[b] - em.price[a];
  if (Math.abs(dp) >= 1) deltas.push({ key: 'price', label: 'Prix', text: `${sgn(dp)}${eur(Math.abs(dp))}`, good: dp < 0 });
  const dv = Math.round(sm.view[b] - sm.view[a]);
  if (Math.abs(dv) >= 2) deltas.push({ key: 'view', label: 'Vue', text: `${sgn(dv)}${Math.abs(dv)} vue`, good: dv > 0 });
  const de = Math.round(sm.edge[a] - sm.edge[b]);
  if (v.stand[a] === v.stand[b] && v.tier[a] === v.tier[b] && v.row[a] !== v.row[b]) {
    const dr = v.row[a] - v.row[b];
    deltas.push({ key: 'rows', label: 'Distance', text: `${Math.abs(dr)} rang${Math.abs(dr) > 1 ? 's' : ''} plus ${dr > 0 ? 'près' : 'loin'}`, good: null });
  } else if (Math.abs(de) >= 3) deltas.push({ key: 'dist', label: 'Distance', text: `${Math.abs(de)} m plus ${de > 0 ? 'près' : 'loin'}`, good: null });
  const dh = Math.round(sm.elev[b] - sm.elev[a]);
  if (Math.abs(dh) >= 4) deltas.push({ key: 'height', label: 'Hauteur', text: dh > 0 ? 'plus en hauteur' : 'plus bas', good: null });
  if (sm.covered[a] !== sm.covered[b]) deltas.push({ key: 'cover', label: 'Abri', text: sm.covered[b] ? 'abrité de la pluie' : 'exposé à la pluie', good: !!sm.covered[b] });
  const da = Math.round(em.atmo[b] - em.atmo[a]);
  if (Math.abs(da) >= 8) deltas.push({ key: 'atmo', label: 'Ambiance', text: da > 0 ? 'plus d’ambiance' : 'plus calme', good: null });
  if (sm.obstruct[b] < 85 && sm.obstruct[a] >= 85) deltas.push({ key: 'obst', label: 'Gêne', text: 'structure dans le champ', good: false });
  const qa = quality(c, a, intent), qb = quality(c, b, intent);
  const dq = qb - qa;
  let message: string;
  const pricePart = Math.abs(dp) < 1 ? 'au même prix' : dp > 0 ? `pour ${eur(dp)} de plus` : `pour ${eur(-dp)} de moins`;
  if (Math.abs(dq) < 2.5) message = Math.abs(dp) < 1 ? 'Les deux places se valent : choisissez selon l’emplacement.' : `Vue équivalente : ${dp > 0 ? 'A' : 'B'} est le meilleur choix, ${eur(Math.abs(dp))} de moins.`;
  else if (dq > 0) message = dp <= 0 ? `B est meilleure ${pricePart} : choisissez B.` : `B offre une ${dq >= 8 ? 'nettement ' : ''}meilleure expérience ${pricePart}.`;
  else message = dp >= 0 ? `A est meilleure et ${dp > 0 ? `${eur(dp)} moins chère` : 'au même prix'} : gardez A.` : `B économise ${eur(-dp)}, au prix d’une ${dq <= -8 ? 'nettement ' : ''}moins bonne expérience.`;
  const winner: 'a' | 'b' | null = Math.abs(dq) < 2.5 ? (Math.abs(dp) < 1 ? null : dp > 0 ? 'a' : 'b') : dq > 0 ? (dp <= 0 || dq / Math.max(1, dp) > 0.4 ? 'b' : null) : dp >= 0 ? 'a' : null;
  return { deltas: deltas.slice(0, 4), message, winner, dq, dp };
}

// ---------- descriptions ----------

/** Nombre de marches depuis l'accès (vomitoire au mur arrière du niveau). */
export function stepsFromAccess(c: SeatCtx, i: number) {
  const st = c.v.stands[c.v.stand[i]];
  const t = st.tiers[c.v.tier[i]];
  const vom = t.rows - 1; // accès (vomitoire) au mur arrière de chaque niveau
  return Math.max(1, Math.round(Math.abs(t.rowH[c.v.row[i]] - t.rowH[vom]) / 0.19));
}

export function coverLabel(c: SeatCtx, i: number) {
  return c.sm.covered[i] ? 'Abrité' : c.sm.rain[i] > 50 ? 'Partiellement abrité' : 'Exposé';
}

export function reasons(c: SeatCtx, i: number): string[] {
  const { v, sm, em } = c;
  const out: string[] = [];
  if (sm.central[i] > 82) out.push('Vue centrale');
  else if (sm.central[i] < 45) out.push('Vue depuis le virage');
  if (sm.elev[i] >= 18 && sm.elev[i] <= 32) out.push('Hauteur idéale pour lire le jeu');
  else if (sm.elev[i] < 10) out.push('Au ras de la pelouse');
  else if (sm.elev[i] > 34) out.push('Très en hauteur');
  if (sm.edge[i] < 16) out.push('Tout près du terrain');
  if (sm.obstruct[i] < 85) out.push('Une structure gêne une partie du champ');
  else if (sm.cval[i] >= 90) out.push('Vue dégagée au-dessus des têtes');
  if (sm.covered[i]) out.push('Abrité de la pluie');
  if (v.sections[v.section[i]].ultras) out.push('Tribune des supporters');
  if (em.value[i] > 72) out.push('Très bon rapport qualité-prix');
  return out;
}

export function seatTitle(c: SeatCtx, i: number) {
  const { v } = c;
  const sec = v.sections[v.section[i]];
  const st = v.stands[sec.stand];
  return {
    stand: st.name, tier: st.tiers[sec.tier].cfg.label, section: sec.code, row: v.row[i] + 1, num: v.num[i],
    id: seatId(v, i), short: `Rang ${v.row[i] + 1} · Place ${v.num[i]}`, block: `${st.name} · Section ${sec.code}`,
  };
}

/** Carte de place : hiérarchie UI v1.0 (tribune/bloc → rang/place → prix → vue → 3 mesures → conseil → action). */
export function seatSummary(c: SeatCtx, i: number) {
  const { sm, em } = c;
  const t = seatTitle(c, i);
  const view = sm.view[i];
  const quick = [
    { label: 'Vue', value: viewLabel(view).replace('Vue ', ''), tone: view >= 75 ? 'good' : view >= 55 ? 'mid' : 'low' },
    { label: 'Terrain', value: `${Math.round(sm.edge[i])} m`, tone: 'neutral' },
    { label: 'Pluie', value: coverLabel(c, i), tone: sm.covered[i] ? 'good' : 'neutral' },
  ];
  const r = reasons(c, i);
  return {
    ...t,
    available: !!em.avail[i],
    price: em.price[i],
    priceLabel: eur(em.price[i]),
    viewScore: view,
    viewLabel: viewLabel(view),
    viewLine: r.slice(0, 2).join(' · ') || 'Vue équilibrée',
    quick,
    steps: stepsFromAccess(c, i),
  };
}

/** Phrase complète pour lecteur d'écran. */
export function seatSpeech(c: SeatCtx, i: number) {
  const s = seatSummary(c, i);
  return `${s.stand}, section ${s.section}, rang ${s.row}, place ${s.num}. ${s.available ? 'Disponible' : 'Déjà vendue'}. ${s.priceLabel}. ${s.viewLabel}. ${coverLabel(c, i)}. ${s.steps} marches depuis l’accès.`;
}

/** Fiche détaillée (divulgation progressive). Chaque ligne porte sa provenance. */
export function seatDNA(c: SeatCtx, i: number) {
  const { sm, em } = c;
  const cv = Math.round(sm.cval[i]);
  return [
    { k: 'Distance au rond central', v: `${Math.round(sm.dist[i])} m`, src: 'calculé' },
    { k: 'Distance à la ligne la plus proche', v: `${Math.round(sm.edge[i])} m`, src: 'calculé' },
    { k: 'Angle de vue vers le centre', v: `${Math.round(sm.elev[i])}° de plongée`, src: 'calculé' },
    { k: 'Dégagement au-dessus des têtes (valeur C)', v: cv >= 90 ? `${cv} mm · excellent` : cv >= 60 ? `${cv} mm · bon` : cv >= 0 ? `${cv} mm · il faudra parfois se pencher` : 'la ligne de touche proche peut être masquée', src: 'calculé' },
    { k: 'Structures dans le champ', v: sm.obstruct[i] >= 95 ? 'aucune' : sm.obstruct[i] >= 80 ? 'légères' : 'oui, partielles', src: 'calculé' },
    { k: 'Protection pluie', v: coverLabel(c, i), src: 'calculé' },
    { k: 'Soleil au coup d’envoi', v: em.lit[i] ? (em.glare[i] > 0.3 ? 'en face, éblouissant' : 'au soleil') : 'à l’ombre', src: 'calculé' },
    { k: 'Ambiance attendue', v: em.atmo[i] > 80 ? 'très forte' : em.atmo[i] > 62 ? 'forte' : em.atmo[i] > 48 ? 'modérée' : 'calme', src: 'estimé' },
    { k: 'Accès', v: `${stepsFromAccess(c, i)} marches depuis l’accès`, src: 'estimé' },
    { k: 'Prix et disponibilité', v: `${eur(em.price[i])} · ${em.avail[i] ? 'disponible' : 'vendue'}`, src: 'simulé' },
  ];
}

/** Récit de l'heure : soleil, ombre, projecteurs (en clair, jamais en degrés d'abord). */
export function sunStory(c: SeatCtx, i: number, live: { sunAlt: number; lights: number; rain: number }) {
  if (live.sunAlt <= 0) return live.lights > 0.5 ? 'Nuit, sous les projecteurs.' : 'Nuit.';
  if (live.rain > 0.05) return c.sm.covered[i] ? 'Il pleut : vous êtes à l’abri.' : 'Il pleut : cette place est exposée.';
  if (!c.em.lit[i]) return 'À l’ombre de la tribune.';
  return c.em.glare[i] > 0.3 ? 'Soleil de face : prévoir des lunettes.' : 'Au soleil.';
}

// ---------- Micro-HUD : faits contextuels et badges ----------

export const OBS_LABEL = ['', 'avancée du niveau supérieur', 'bord du toit', 'poteau du toit', 'garde-corps'];

export interface Fact { key: string; text: string; tone: 'good' | 'warn' | 'neutral'; w: number; detail?: string }

/**
 * Faits utiles d'une place, déjà classés par importance dans les conditions du moment (pluie : l'abri monte ;
 * plein soleil : soleil / ombre monte). Une gêne matérielle n'est jamais masquée : elle passe en tête.
 */
export function seatFacts(c: SeatCtx, i: number, live?: { sunAlt: number; daylight: number }): Fact[] {
  const { v, sm, em } = c;
  const k = c.cond ?? { rain: 0, sun: 0, daylight: 1, night: false };
  const out: Fact[] = [];
  const src = sm.obsSrc[i];
  if (src && src !== 4) out.push({ key: 'obs', text: 'Gêne partielle', tone: 'warn', w: 100, detail: `Source : ${OBS_LABEL[src]}` });
  const view = sm.view[i];
  out.push({ key: 'view', text: viewLabel(view), tone: view >= 75 ? 'good' : view < 55 ? 'warn' : 'neutral', w: 60 });
  const edge = Math.round(sm.edge[i]);
  out.push(edge <= 30
    ? { key: 'dist', text: `${edge} m du terrain`, tone: 'neutral', w: 55 }
    : { key: 'dist', text: `${Math.round(sm.dist[i])} m du rond central`, tone: 'neutral', w: 55 });
  const covered = !!sm.covered[i];
  out.push({ key: 'cover', text: covered ? 'Abrité' : sm.rain[i] > 50 ? 'Partiellement abrité' : 'Exposé à la pluie', tone: covered ? 'good' : k.rain > 0 ? 'warn' : 'neutral', w: 28 + k.rain * 64 });
  if (live && live.daylight > 0.5 && live.sunAlt > 3) {
    const lit = !!em.lit[i], glare = em.glare[i] > 0.3;
    out.push({ key: 'sun', text: !lit ? 'À l’ombre' : glare ? 'Soleil de face' : 'Au soleil', tone: glare ? 'warn' : 'neutral', w: 26 + k.sun * 56 + (glare ? 20 : 0) });
  }
  if (src === 4 || sm.cval[i] < 0) out.push({ key: 'vis', text: 'Bord du terrain parfois masqué', tone: 'warn', w: 72, detail: src === 4 ? `Source : ${OBS_LABEL[4]}` : 'Têtes du rang de devant' });
  else if (sm.obstruct[i] >= 95 && sm.cval[i] >= 60) out.push({ key: 'vis', text: 'Tout le terrain visible', tone: 'good', w: 44 });
  const h = v.py[i];
  if (h > 14) out.push({ key: 'height', text: sm.elev[i] >= 18 && sm.elev[i] <= 34 ? 'Vue tactique en hauteur' : `${Math.round(h)} m au-dessus de la pelouse`, tone: 'neutral', w: 34 + (v.tier[i] > 0 ? 8 : 0) });
  const sec = v.sections[v.section[i]];
  const rc = sec.rowCount[v.row[i]];
  const kInRow = i - sec.rowStart[v.row[i]];
  const fromAisle = Math.min(kInRow, rc - 1 - kInRow);
  out.push({ key: 'aisle', text: fromAisle <= 0 ? 'Au bord de l’allée' : `${fromAisle} place${fromAisle > 1 ? 's' : ''} de l’allée`, tone: 'neutral', w: 18 });
  if (sec.ultras) out.push({ key: 'atmo', text: 'Au cœur des supporters', tone: 'neutral', w: 40 });
  else if (sec.family) out.push({ key: 'atmo', text: 'Tribune familiale', tone: 'neutral', w: 26 });
  out.push({ key: 'steps', text: `${stepsFromAccess(c, i)} marches depuis l’accès`, tone: 'neutral', w: 14 });
  return out.sort((a, b) => b.w - a.w);
}

/** Barre de faits de la vue siège : position, distance, puis l'abri ou le soleil selon les conditions (gêne en tête si présente). */
export function povFactBar(c: SeatCtx, i: number, live?: { sunAlt: number; daylight: number }) {
  const f = seatFacts(c, i, live);
  const pick = (k: string) => f.find((x) => x.key === k);
  const first = pick('obs') ?? pick('view')!;
  const third = [pick('cover'), pick('sun'), pick('vis')].filter(Boolean).sort((a, b) => b!.w - a!.w)[0];
  return [first, pick('dist')!, third].filter(Boolean) as Fact[];
}

export type Badge = 'MEILLEURE VUE' | 'MEILLEUR RAPPORT' | 'ABRITÉE' | 'AMBIANCE';
export const BADGE_TEXT: Record<Badge, string> = { 'MEILLEURE VUE': 'Meilleure vue', 'MEILLEUR RAPPORT': 'Meilleur rapport', 'ABRITÉE': 'Abritée', 'AMBIANCE': 'Ambiance' };

/** Au plus trois badges par section, un seul par place, en mots (jamais de note /100). */
export function sectionBadges(c: SeatCtx, sec: number): Map<number, Badge> {
  const out = new Map<number, Badge>();
  const add = (i: number | undefined, b: Badge) => { if (i !== undefined && i >= 0 && !out.has(i)) out.set(i, b); };
  add(recommend(c, 'view', { section: sec, n: 1 })[0]?.seat, 'MEILLEURE VUE');
  add(recommend(c, 'value', { section: sec, n: 1 })[0]?.seat, 'MEILLEUR RAPPORT');
  const s = c.v.sections[sec];
  if (c.cond && c.cond.rain > 0) {
    let best = -1, bq = -1;
    for (let i = s.start; i < s.start + s.count; i++) if (c.sm.covered[i] && c.em.avail[i] && !out.has(i)) { const q = c.sm.view[i]; if (q > bq) { bq = q; best = i; } }
    add(best, 'ABRITÉE');
  } else if (s.ultras || c.v.stands[s.stand].kind === 'home' || c.v.stands[s.stand].kind === 'away') {
    add(recommend(c, 'atmo', { section: sec, n: 1 })[0]?.seat, 'AMBIANCE');
  }
  return out;
}

/** Résumé d'une section : places libres et prix d'appel. */
export function sectionFact(c: SeatCtx, sec: number) {
  const s = c.v.sections[sec];
  let free = 0, minP = 1e9;
  for (let i = s.start; i < s.start + s.count; i++) if (c.em.avail[i]) { free++; minP = Math.min(minP, c.em.price[i]); }
  return { free, minP, text: free ? `${free} place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''} · dès ${eur(minP)}` : 'Complet' };
}
