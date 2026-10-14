import type { EnvironmentSpec, TimePreset } from '../config/types';
import { icon, esc } from './dom';
import { INTENTS, type Intent, type Nearby, type SeatCtx, type SeatPick, seatSummary, seatDNA, compareSeats, eur, seatTitle, relativePosition } from '../app/intelligence';
import { PRESET_LABEL, TIME_PRESETS, DAY_MIN, DAY_MAX } from '../environment/EnvironmentEngine';
import type { ExperienceMode } from '../app/modes';
import { VENUES, VENUE_ORDER } from '../config/venues';
import { venueThumb } from './thumbs';
import { RAMP_CSS } from '../engine/SeatLayer';
import type { SeatColorMode } from '../engine/SeatLayer';
import { EVENTS, EVENT_ORDER, REVEALS, REVEAL_ORDER } from '../config/events';

// Gabarits HTML des surfaces d'interface. Fonctions pures : données en entrée, chaîne en sortie.
// Toute action passe par data-act (délégation unique dans App).

export const fmtTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const B = (act: string, label: string, ic?: string, cls = '', extra = '') =>
  `<button type="button" class="btn ${cls}" data-act="${act}" ${extra}>${ic ? icon(ic) : ''}<span class="lbl">${label}</span></button>`;
const IB = (act: string, label: string, ic: string, cls = '', extra = '') =>
  `<button type="button" class="btn icon ${cls}" data-act="${act}" aria-label="${label}" title="${label}" ${extra}>${icon(ic)}</button>`;

export function envIcon(e: EnvironmentSpec, daylight: number) {
  if (e.rain !== 'none') return 'rain';
  if (daylight < 0.35) return 'moon';
  if (e.fog > 0.4) return 'fog';
  return e.clouds === 'overcast' ? 'cloud' : 'sun';
}

export interface TopData {
  mode: ExperienceMode; layout: string; device: string; venue: string; context: string; contextLabel: string;
  env: EnvironmentSpec; daylight: number; sound: boolean; envTransition?: string;
}

/**
 * HUD haut, compressé (§45) : à gauche le stade (vue d'ensemble) ou le retour + une puce de position compacte qui
 * révèle la hiérarchie au toucher ; à droite l'heure et la météo (puce qui ouvre la bande rapide). La puce de match
 * est un élément séparé (#evchip). Sur téléphone, « Plus » est en bas, dans la zone du pouce.
 */
export function topHud(d: TopData) {
  const pov = d.mode === 'pov' || d.mode === 'move' || d.mode === 'compare';
  const phone = d.layout !== 'desktop';
  const envLbl = `${d.env.rain !== 'none' && !phone ? 'Pluie · ' : ''}${fmtTime(d.env.minutes)}`;
  // nom accessible = texte visible + complément (WCAG 2.5.3 : le libellé visible fait partie du nom)
  const envChip = `<button type="button" class="chip surface env-chip ui-full" data-act="envstrip" aria-haspopup="true">${icon(envIcon(d.env, d.daylight), 18)}<span class="lbl">${envLbl}</span><span class="sr-only">, heure et météo${d.envTransition ? `, passage à ${esc(d.envTransition)}` : ''}</span></button>`;
  const more = phone ? '' : IB('panel:more', 'Plus d’options', 'more', 'surface ui-full');
  const sound = phone ? '' : IB('sound', d.sound ? 'Couper le son' : 'Activer le son d’ambiance', d.sound ? 'soundOn' : 'soundOff', 'surface ui-full', `aria-pressed="${d.sound}"`);
  const ctx = d.context ? `<button type="button" class="ctx surface" data-act="panel:where" aria-haspopup="dialog">${d.context}<span class="sr-only"> : ${esc(d.contextLabel)}, afficher la position complète</span></button>` : '';
  if (d.mode === 'overview') {
    return `<div class="th-left">
        <button type="button" class="brand surface" data-act="panel:venues" aria-label="Changer de stade : ${esc(d.venue)}"><span class="mark">${icon('stadium', 18)}</span><span class="bt"><span class="lbl">${esc(d.venue)}</span><span class="sub" id="brandEv"></span></span>${icon('down', 14)}</button>
      </div>
      <div class="th-right">${envChip}${sound}${more}</div>`;
  }
  // logo = retour à la vue d'ensemble (§49) ; jamais un bouton « Accueil » de plus
  const home = !phone ? `<button type="button" class="brand mini surface" data-act="home" aria-label="Vue d’ensemble du stade"><span class="mark">${icon('stadium', 18)}</span></button>` : '';
  const back = IB('back', d.mode === 'move' ? 'Terminer le déplacement' : 'Retour', 'back', 'surface');
  return `<div class="th-left">${home}${back}${ctx}</div>
    <div class="th-right">${pov && phone ? '' : envChip}${pov ? '' : sound}${d.mode === 'compare' ? '' : more}</div>`;
}

/** Dock contextuel : il change selon le mode, jamais une barre de navigation permanente. Téléphone : 3 actions + Plus. */
export function dock(mode: ExperienceMode, o: { hasSeat: boolean; layout: string; narrow: boolean; parked: boolean }) {
  const phone = o.layout !== 'desktop';
  const plus = phone ? B('panel:more', 'Plus', 'more') : '';
  const resume = o.parked ? B('resumeCompare', 'Reprendre A/B', 'compare') : '';
  switch (mode) {
    case 'overview': return B('panel:explore', 'Explorer', 'layers') + B('panel:find', phone ? 'Trouver' : 'Trouver ma place', 'search', 'primary') + (o.narrow && o.parked ? '' : resume || B('panel:views', 'Points de vue', 'camera')) + plus;
    case 'stand': return B('back', 'Retour', 'back') + B('panel:explore', 'Calques', 'layers') + B('panel:find', phone ? 'Meilleures' : 'Meilleures places', 'search', 'primary') + plus;
    case 'section': return B('back', 'Retour', 'back') + (o.narrow ? '' : B('panel:explore', 'Calques', 'layers')) + B('bestHere', 'Meilleure place', 'search', 'primary') + plus;
    case 'seat': return phone ? '' : B('pov', 'Voir', 'eye', 'primary') + B('compare', 'Comparer', 'compare') + B('panel:views', 'Points de vue', 'camera');
    case 'pov': return B('move', phone ? 'Déplacer' : 'Se déplacer', 'move') + B('compare', 'Comparer', 'compare') + (o.narrow ? '' : B('panel:pov', 'Vue', 'eye')) + (phone ? plus : B('info', 'Infos', 'info'));
    case 'move': return B('moveDone', 'Terminé', 'check', 'primary');
    default: return '';
  }
}

export interface CardOpts { nearby: Nearby[]; fav: boolean; mode: ExperienceMode; expanded: boolean; layout: string; story: string; compareA?: number; badge?: string; rain?: boolean; obstruction?: string }

/** Carte de place : tribune/bloc → rang/place → prix → vue → 3 mesures → conseil → action principale. */
export function seatCard(c: SeatCtx, i: number, o: CardOpts) {
  const s = seatSummary(c, i);
  const insight = o.nearby[0];
  const pov = o.mode === 'pov' || o.mode === 'move';
  const head = `<header class="sheet-head">
      <p class="eyebrow">${esc(s.block)}${s.tier !== 'Unique' ? ` · ${esc(s.tier)}` : ''}</p>
      <h2 class="title" id="cardTitle">${s.short}</h2>
      <p class="price-row"><span class="price">${s.priceLabel}</span><span class="badge ${s.available ? 'ok' : 'sold'}">${s.available ? 'Disponible' : 'Vendue'}</span>${o.badge ? `<span class="rec">${esc(o.badge)}</span>` : ''}</p>
    </header>`;
  const cta = pov
    ? `<div class="cta-row">${B('compare', 'Comparer avec une autre place', 'compare', 'primary block')}</div>`
    : `<div class="cta-row">${B('pov', 'Voir depuis cette place', 'eye', 'primary block')}</div>`;
  // priorité contextuelle (§52) : sous la pluie, l'abri passe devant la distance
  const qs = o.rain ? [s.quick[2], s.quick[0], s.quick[1]] : s.quick;
  const quick = `<ul class="quick" aria-label="En bref">${qs.map((q) => `<li class="q ${q.tone}"><span class="k">${q.label}</span><span class="v">${esc(q.value)}</span></li>`).join('')}</ul>`;
  const obs = o.obstruction ? `<p class="obs">${icon('info', 14)}<span><strong>Gêne partielle</strong> · ${esc(o.obstruction)}</span></p>` : '';
  const view = `<p class="view"><strong>${s.viewLabel}</strong><span>${esc(s.viewLine)}</span></p>${obs}<p class="story">${esc(o.story)}</p>`;
  const ins = insight
    ? `<div class="insight ${insight.kind}"><p><span class="tag">${insight.kind === 'better' ? 'Mieux à proximité' : insight.kind === 'cheaper' ? 'Moins cher à côté' : 'Pour un peu plus'}</span>${esc(insight.why)}</p>
        <div class="row">${B(`goto:${insight.seat}`, 'Y aller', 'eye', 'small')}${B(`compareWith:${insight.seat}`, 'Comparer', 'compare', 'small ghost')}</div></div>`
    : `<div class="insight none"><p>${icon('check', 16)} Aucune place voisine n’offre mieux au même prix.</p></div>`;
  const sec = `<div class="secondary">${IB('fav', o.fav ? 'Retirer des places enregistrées' : 'Enregistrer cette place', 'bookmark', o.fav ? 'on' : '', `aria-pressed="${o.fav}"`)}${IB('share', 'Copier le lien de cette place', 'share')}${pov ? '' : IB('compare', 'Comparer', 'compare')}
      <button type="button" class="btn ghost small more" data-act="expand" aria-expanded="${o.expanded}">${o.expanded ? 'Moins de détails' : 'Tous les détails'}</button></div>`;
  const dna = o.expanded
    ? `<dl class="dna">${seatDNA(c, i).map((r) => `<div><dt>${r.k}</dt><dd>${esc(r.v)}<span class="src">${r.src}</span></dd></div>`).join('')}</dl>
       ${o.nearby.length > 1 ? `<h3 class="h3">Autres options proches</h3><ul class="near">${o.nearby.slice(1).map((n) => `<li><button type="button" class="btn ghost block" data-act="goto:${n.seat}">${esc(seatTitle(c, n.seat).short)} · ${eur(c.em.price[n.seat])}<span class="why">${esc(n.why)}</span></button></li>`).join('')}</ul>` : ''}`
    : '';
  const close = o.layout === 'desktop' || o.layout === 'landscape' ? IB(pov ? 'info' : 'deselect', 'Fermer la fiche', 'close', 'ghost close') : '';
  return `${close}${head}${cta}<div class="sheet-rest">${view}${quick}${ins}${sec}${dna}</div>`;
}

export function compareTray(c: SeatCtx, a: number, b: number, intent: Intent, view: 'a' | 'b', layout: string, nearby: Nearby[], x: { saved?: number[]; canSplit?: boolean; split?: boolean } = {}) {
  const ta = seatTitle(c, a);
  if (b < 0) {
    // places enregistrées d'abord (§69), puis suggestions voisines
    const saved = (x.saved ?? []).filter((i) => i !== a).slice(0, 2).map((i) => B(`compareWith:${i}`, `${icon('bookmark', 14)} ${seatTitle(c, i).section} · ${seatTitle(c, i).short.replace('Rang ', 'R').replace(' · Place ', '·')}`, '', 'small ghost'));
    const sug = nearby.slice(0, 2).map((n) => B(`compareWith:${n.seat}`, `${seatTitle(c, n.seat).short} · ${eur(c.em.price[n.seat])}`, 'compare', 'small ghost'));
    const all = [...saved, ...sug].slice(0, 3).join('');
    return `<div class="cmp-wait"><p class="lead"><span class="ab a">A</span> ${esc(ta.short)} · ${eur(c.em.price[a])}</p>
      <p class="hint">Touchez une autre place pour la comparer${all ? ', ou essayez :' : '.'}</p><div class="row">${all}</div>
      <div class="row end">${B('compareExit', 'Quitter', 'close', 'ghost small')}</div></div>`;
  }
  const tb = seatTitle(c, b);
  const r = compareSeats(c, a, b, intent);
  const side = (k: 'a' | 'b', t: ReturnType<typeof seatTitle>, i: number) =>
    `<button type="button" class="cmp-side ${view === k ? 'on' : ''} ${r.winner === k ? 'win' : ''}" data-act="compareView:${k}" aria-pressed="${view === k}" aria-label="Voir la place ${k.toUpperCase()} : ${esc(t.short)}">
      <span class="ab ${k}">${k.toUpperCase()}</span><span class="t">${esc(t.short)}</span><span class="s">Section ${t.section} · ${eur(c.em.price[i])}</span>${r.winner === k ? '<span class="crown">Meilleur choix</span>' : ''}</button>`;
  const deltas = `<ul class="deltas" aria-label="Différences de B par rapport à A">${r.deltas.map((d) => `<li class="${d.good === true ? 'good' : d.good === false ? 'bad' : ''}">${esc(d.text)}</li>`).join('') || '<li>Places très proches</li>'}</ul>`;
  const msg = `<p class="verdict">${esc(r.message)}</p>`;
  const split = x.canSplit ? B('compareSplit', x.split ? 'Vue unique' : 'Côte à côte', 'compare', `ghost small ${x.split ? 'on' : ''}`, `aria-pressed="${!!x.split}"`) : '';
  const actions = `<div class="row end">${split}${B('compareSwap', 'Échanger', 'swap', 'ghost small')}${B('compareClear', 'Effacer', 'close', 'ghost small')}${B('compareExit', 'Terminer', 'check', 'small')}</div>`;
  if (layout === 'mobile') {
    return `<div class="seg" role="tablist" aria-label="Place affichée">${side('a', ta, a)}${side('b', tb, b)}</div>${deltas}${msg}${actions}`;
  }
  return `<div class="cmp-grid">${side('a', ta, a)}<div class="mid">${deltas}${msg}</div>${side('b', tb, b)}</div>${actions}`;
}

export function moveHud(c: SeatCtx, i: number, layout: string) {
  const t = seatTitle(c, i);
  const pad = layout === 'mobile' ? '' : `<div class="pad" role="group" aria-label="Déplacer">
      ${IB('step:forward', 'Rang vers l’avant', 'up', 'surface')}
      <div class="mid">${IB('step:left', 'Place à gauche', 'left', 'surface')}${IB('step:right', 'Place à droite', 'right', 'surface')}</div>
      ${IB('step:back', 'Rang vers l’arrière', 'downArrow', 'surface')}</div>`;
  return `<div class="mv-info"><p class="mv-now" aria-live="polite">${esc(t.short)} <span>· ${eur(c.em.price[i])}</span></p>
      <p class="mv-hint">${layout === 'mobile' ? 'Glissez ← → pour changer de place, ↑ ↓ pour changer de rang. Touchez une place pour y aller.' : 'Glissez ou utilisez les flèches. Touchez une place visible pour y aller.'}</p></div>${pad}`;
}

// ---------- panneaux ----------

export function panelVenues(current: string) {
  return `<header class="ph"><h2 id="panelTitle">Choisir un stade</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="venues">${VENUE_ORDER.map((id) => {
      const v = VENUES[id];
      return `<button type="button" class="venue ${id === current ? 'on' : ''}" data-act="venue:${id}" aria-pressed="${id === current}">
        <span class="thumb">${venueThumb(v)}</span><span class="vn">${esc(v.name)}</span><span class="vl">${esc(v.label)}</span><span class="vd">${esc(v.pitchLine)}</span></button>`;
    }).join('')}</div>`;
}

export function panelEnv(e: EnvironmentSpec, preset: TimePreset, daylight: number) {
  const seg = (name: string, cur: string, opts: Array<[string, string]>) =>
    `<div class="seg" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-act="env:${name}:${v}">${l}</button>`).join('')}</div>`;
  const quickOn = (k: string) => (k === 'sun' ? e.rain === 'none' && e.clouds !== 'overcast' && daylight > 0.5 : k === 'cloud' ? e.clouds === 'overcast' && e.rain === 'none' : k === 'rain' ? e.rain !== 'none' : daylight < 0.35);
  return `<header class="ph"><h2 id="panelTitle">Heure et météo</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="quick-env">${[['sun', 'Soleil', 'sun'], ['cloud', 'Nuageux', 'cloud'], ['rain', 'Pluie', 'rain'], ['night', 'Nuit', 'moon']].map(([k, l, ic]) =>
      `<button type="button" class="qe ${quickOn(k) ? 'on' : ''}" data-act="envq:${k}" aria-pressed="${quickOn(k)}">${icon(ic, 22)}<span>${l}</span></button>`).join('')}</div>
    <div class="field"><label for="timeRange">Heure <output id="timeOut">${fmtTime(e.minutes)}</output></label>
      <input id="timeRange" type="range" min="${DAY_MIN}" max="${DAY_MAX}" step="5" value="${Math.round(e.minutes)}" data-input="time" aria-valuetext="${fmtTime(e.minutes)}"></div>
    <div class="chips" role="group" aria-label="Moments de la journée">${TIME_PRESETS.map((p) => `<button type="button" class="chip ${p === preset ? 'on' : ''}" data-act="preset:${p}" aria-pressed="${p === preset}">${PRESET_LABEL[p]}</button>`).join('')}</div>
    <details class="adv"><summary>Réglages avancés</summary>
      <div class="field"><span class="flabel">Ciel</span>${seg('clouds', e.clouds, [['clear', 'Dégagé'], ['partly', 'Éclaircies'], ['overcast', 'Couvert']])}</div>
      <div class="field"><span class="flabel">Pluie</span>${seg('rain', e.rain, [['none', 'Aucune'], ['light', 'Fine'], ['rain', 'Pluie'], ['heavy', 'Forte']])}</div>
      <div class="field"><label for="fogRange">Brume</label><input id="fogRange" type="range" min="0" max="1" step="0.05" value="${e.fog}" data-input="fog"></div>
      <div class="field"><label for="windRange">Vent</label><input id="windRange" type="range" min="0" max="1" step="0.05" value="${e.wind}" data-input="wind"></div>
      <div class="field"><span class="flabel">Projecteurs</span>${seg('lights', e.lights, [['auto', 'Auto'], ['on', 'Allumés'], ['off', 'Éteints']])}</div>
    </details>
    <p class="note">Soleil calculé pour le lieu et la date du match. Transitions en 3 à 6 s.</p>`;
}

const HEAT: Array<[SeatColorMode, string, string]> = [
  ['stand', 'Couleurs du stade', ''], ['avail', 'Disponibilité', 'Places libres en vert'], ['price', 'Prix', 'Du moins cher au plus cher'],
  ['view', 'Qualité de vue', 'De limitée à exceptionnelle'], ['value', 'Rapport qualité-prix', 'Vue au-delà de ce que le prix laisse attendre'],
  ['atmo', 'Ambiance', 'Du calme au plus chaud'], ['sun', 'Soleil et ombre', 'À l’heure choisie'], ['rain', 'Abri de la pluie', 'D’exposé à entièrement abrité'],
];

export function panelExplore(heat: SeatColorMode, eventId: string, x: { explode: boolean; xray: boolean; players: boolean }) {
  const legend = heat === 'stand' ? '' : heat === 'avail'
    ? '<p class="legend"><span class="sw" style="background:#3fd6a2"></span>Libre <span class="sw" style="background:#2b3038"></span>Vendue</p>'
    : `<div class="legend ramp" aria-hidden="true"><span style="background:linear-gradient(90deg,${RAMP_CSS.join(',')})"></span></div><p class="legend-l"><span>${heat === 'price' ? 'Moins cher' : heat === 'rain' ? 'Exposé' : 'Moins bien'}</span><span>${heat === 'price' ? 'Plus cher' : heat === 'rain' ? 'Abrité' : 'Meilleur'}</span></p>`;
  return `<header class="ph"><h2 id="panelTitle">Explorer</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <h3 class="h3">Colorer les places par</h3>
    <div class="list" role="radiogroup" aria-label="Calque">${HEAT.map(([k, l, d]) => `<button type="button" role="radio" class="li ${k === heat ? 'on' : ''}" aria-checked="${k === heat}" data-act="heat:${k}"><span class="t">${l}</span>${d ? `<span class="d">${d}</span>` : ''}</button>`).join('')}</div>
    ${legend}
    <h3 class="h3">Match</h3>
    <div class="chips">${EVENT_ORDER.map((id) => `<button type="button" class="chip ${id === eventId ? 'on' : ''}" data-act="event:${id}" aria-pressed="${id === eventId}">${esc(EVENTS[id].label)}</button>`).join('')}</div>
    <h3 class="h3">Structure</h3>
    <div class="chips">
      <button type="button" class="chip ${x.explode ? 'on' : ''}" data-act="explode" aria-pressed="${x.explode}">Vue éclatée des niveaux</button>
      <button type="button" class="chip ${x.xray ? 'on' : ''}" data-act="xray" aria-pressed="${x.xray}">Toit transparent</button>
      <button type="button" class="chip ${x.players ? 'on' : ''}" data-act="players" aria-pressed="${x.players}">Joueurs</button>
      <button type="button" class="chip" data-act="goal">Moment de but</button>
      <button type="button" class="chip" data-act="wave">Ola</button>
    </div>`;
}

export function panelFind(c: SeatCtx, intent: Intent, picks: SeatPick[], scope: string) {
  return `<header class="ph"><h2 id="panelTitle">Trouver ma place</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <p class="note">${esc(scope)}</p>
    <div class="chips" role="radiogroup" aria-label="Ce qui compte pour vous">${INTENTS.map((it) => `<button type="button" role="radio" class="chip ${it.id === intent ? 'on' : ''}" aria-checked="${it.id === intent}" data-act="intent:${it.id}" title="${it.hint}">${it.label}</button>`).join('')}</div>
    <ol class="picks">${picks.map((p) => {
      const t = seatTitle(c, p.seat);
      return `<li class="pick"><div class="pt"><span class="tag">${esc(p.tag)}</span><span class="t">${esc(t.block)}</span><span class="s">${esc(t.short)} · <strong>${eur(p.price)}</strong></span><span class="why">${esc(p.why)}</span></div>
        <div class="row">${B(`goto:${p.seat}`, 'Voir', 'eye', 'small primary')}${B(`select:${p.seat}`, 'Fiche', 'info', 'small ghost')}</div></li>`;
    }).join('') || '<li class="empty">Aucune place libre dans cette zone.</li>'}</ol>
    <p class="note">Seules des places non dominées sont proposées : aucune autre n’est à la fois meilleure et moins chère.</p>`;
}

export const ANCHORS: Array<[string, string]> = [
  ['center', 'Rond central'], ['corner', 'Poteau de corner'], ['goalLine', 'Ligne de but'], ['bench', 'Banc de touche'],
  ['tunnel', 'Sortie du tunnel'], ['roof', 'Sous le toit'], ['entrance', 'Parvis'], ['aerial', 'Vue aérienne'], ['drone', 'Drone libre'], ['player', 'Vue joueur'],
];

export function panelViews() {
  return `<header class="ph"><h2 id="panelTitle">Points de vue</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="grid2">${ANCHORS.map(([k, l]) => `<button type="button" class="tile" data-act="anchor:${k}">${l}</button>`).join('')}</div>`;
}

export function panelMore(o: { lab: boolean; presentation: boolean; sound: string; fullscreen: boolean | null; lite: boolean; event: boolean; pov: boolean; narrow: boolean }) {
  const tg = (act: string, on: boolean, ic: string, l: string) => `<button type="button" role="switch" class="li sw ${on ? 'on' : ''}" aria-checked="${on}" data-act="${act}">${icon(ic)}<span class="t">${l}</span><span class="knob" aria-hidden="true"></span></button>`;
  return `<header class="ph"><h2 id="panelTitle">Plus</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="list">
      ${o.pov && o.narrow ? `<button type="button" class="li" data-act="panel:pov">${icon('eye')}<span class="t">Vue, zoom et suivi du jeu</span></button>` : ''}
      ${o.pov ? `<button type="button" class="li" data-act="info">${icon('info')}<span class="t">Fiche de la place</span></button>` : ''}
      <button type="button" class="li" data-act="immersive">${icon('immersive')}<span class="t">Mode immersif</span><span class="d">Retire presque toute l’interface · touchez l’écran pour la retrouver</span></button>
      ${o.fullscreen !== null ? tg('fullscreen', o.fullscreen, 'fullscreen', 'Plein écran') : ''}
      ${tg('eventChip', o.event, 'ball', 'Afficher le match')}
      ${tg('lite', o.lite, 'lite', 'Mode léger (moins de détails, moins de données)')}
      <button type="button" class="li" data-act="panel:a11y">${icon('a11y')}<span class="t">Accessibilité et confort</span></button>
      <button type="button" class="li" data-act="panel:browser">${icon('list')}<span class="t">Parcourir les places sans 3D</span><kbd>B</kbd></button>
      <button type="button" class="li" data-act="panel:reveal">${icon('sparkle')}<span class="t">Révélation de billet</span></button>
      <button type="button" class="li" data-act="panel:favs">${icon('bookmark')}<span class="t">Places enregistrées</span></button>
      <button type="button" class="li" data-act="share">${icon('share')}<span class="t">Copier le lien de cette vue</span></button>
      <button type="button" class="li" data-act="panel:help">${icon('keyboard')}<span class="t">Raccourcis clavier</span><kbd>?</kbd></button>
      ${__BUILD__ === 'lab' && o.lab ? `<button type="button" class="li" data-act="lab">${icon('lab')}<span class="t">Experience Lab</span><kbd>L</kbd></button>` : ''}
    </div>
    <div class="field"><span class="flabel">Son d’ambiance</span><div class="seg" role="radiogroup" aria-label="Son d’ambiance">${[['off', 'Coupé'], ['low', 'Discret'], ['full', 'Plein']].map(([v, l]) => `<button type="button" role="radio" class="${o.sound === v ? 'on' : ''}" aria-checked="${o.sound === v}" data-act="soundLevel:${v}">${l}</button>`).join('')}</div></div>
    <p class="note">Stades, clubs, prix et disponibilités sont fictifs ; l’inventaire est simulé.</p>`;
}

export function panelReveal() {
  return `<header class="ph"><h2 id="panelTitle">Révélation de billet</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="list">${REVEAL_ORDER.map((id) => { const r = REVEALS[id]; return `<button type="button" class="li" data-act="reveal:${id}">${icon('sparkle')}<span class="t">${esc(r.label)}</span><span class="d">${r.style === 'quick' ? 'Rapide · ≈ 4 s' : r.style === 'cinematic' ? 'Cinématique · ≈ 10 s' : 'Épique · ≈ 12 s'}</span></button>`; }).join('')}</div>`;
}

export function panelA11y(o: { reduced: boolean; comfort: boolean; contrast: boolean; text: string; captions: boolean; viewer: string; posture: string }) {
  const tg = (act: string, on: boolean, l: string, d: string) => `<button type="button" role="switch" class="li sw ${on ? 'on' : ''}" aria-checked="${on}" data-act="${act}"><span class="t">${l}</span><span class="d">${d}</span><span class="knob" aria-hidden="true"></span></button>`;
  return `<header class="ph"><h2 id="panelTitle">Accessibilité et confort</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="list">
      ${tg('a11y:reduced', o.reduced, 'Réduire les animations', 'Coupes franches au lieu des vols de caméra')}
      ${tg('a11y:comfort', o.comfort, 'Mode confort', 'Aucun mouvement de tête, traversées en fondu')}
      ${tg('a11y:contrast', o.contrast, 'Contraste élevé', 'Surfaces opaques, textes renforcés')}
      ${tg('a11y:captions', o.captions, 'Sous-titres d’ambiance', 'Décrit le son (but, chants) à l’écran')}
    </div>
    <div class="field"><span class="flabel">Taille du texte</span><div class="seg" role="radiogroup" aria-label="Taille du texte">${[['md', 'Normale'], ['lg', 'Grande'], ['xl', 'Très grande']].map(([v, l]) => `<button type="button" role="radio" class="${o.text === v ? 'on' : ''}" aria-checked="${o.text === v}" data-act="a11y:text:${v}">${l}</button>`).join('')}</div></div>
    <div class="field"><span class="flabel">Hauteur des yeux</span><div class="seg" role="radiogroup" aria-label="Spectateur">${[['adult:seated', 'Adulte assis'], ['adult:standing', 'Debout'], ['child:seated', 'Enfant']].map(([v, l]) => `<button type="button" role="radio" class="${`${o.viewer}:${o.posture}` === v ? 'on' : ''}" aria-checked="${`${o.viewer}:${o.posture}` === v}" data-act="viewer:${v}">${l}</button>`).join('')}</div></div>
    <p class="note">Les cartes de chaleur utilisent une palette lisible par les daltoniens (type viridis), toujours accompagnée d’un texte.</p>`;
}

export function panelHelp() {
  const rows: Array<[string, string]> = [
    ['Tab / Maj+Tab', 'Parcourir les commandes'], ['Flèches', 'Tribune, section ou place suivante ; en vue siège : se déplacer'],
    ['Maj + flèches', 'Regarder autour (vue siège)'], ['Entrée', 'Valider'], ['Échap', 'Retour'], ['M', 'Se déplacer'], ['C', 'Comparer'],
    ['I', 'Infos de la place'], ['B', 'Parcourir sans 3D'], ['?', 'Cette aide'],
  ];
  return `<header class="ph"><h2 id="panelTitle">Raccourcis clavier</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <dl class="keys">${rows.map(([k, d]) => `<div><dt><kbd>${k}</kbd></dt><dd>${d}</dd></div>`).join('')}</dl>`;
}

/** Navigateur 2D : tribune → section → rang → place, entièrement au clavier, sans WebGL. */
export function panelBrowser(c: SeatCtx, path: { stand: number; section: number; row: number }) {
  const { v, em } = c;
  let body: string;
  const crumb: string[] = ['<button type="button" class="btn ghost small" data-act="br:root">Stade</button>'];
  if (path.stand < 0) {
    body = v.stands.map((st) => {
      let free = 0, n = 0;
      for (const t of st.tiers) for (const si of t.sections) { const s = v.sections[si]; n += s.count; for (let i = s.start; i < s.start + s.count; i++) free += em.avail[i]; }
      return `<li><button type="button" class="li" data-act="br:stand:${st.idx}"><span class="t">${esc(st.name)}</span><span class="d">${free.toLocaleString('fr-FR')} places libres sur ${n.toLocaleString('fr-FR')}</span></button></li>`;
    }).join('');
  } else if (path.section < 0) {
    const st = v.stands[path.stand];
    crumb.push(`<span>${esc(st.name)}</span>`);
    body = st.tiers.flatMap((t) => t.sections.map((si) => {
      const s = v.sections[si];
      let free = 0, minP = 1e9;
      for (let i = s.start; i < s.start + s.count; i++) if (em.avail[i]) { free++; minP = Math.min(minP, em.price[i]); }
      return `<li><button type="button" class="li" data-act="br:section:${si}"><span class="t">Section ${s.code} · ${esc(t.cfg.label)}</span><span class="d">${free} libres${free ? ` · dès ${eur(minP)}` : ''}${s.family ? ' · familles' : ''}${s.ultras ? ' · supporters' : ''}${s.away ? ' · visiteurs' : ''}</span></button></li>`;
    })).join('');
  } else if (path.row < 0) {
    const s = v.sections[path.section];
    crumb.push(`<button type="button" class="btn ghost small" data-act="br:stand:${s.stand}">${esc(v.stands[s.stand].name)}</button>`, `<span>Section ${s.code}</span>`);
    body = Array.from({ length: s.rows }, (_, r) => {
      let free = 0;
      for (let k = 0; k < s.rowCount[r]; k++) free += em.avail[s.rowStart[r] + k];
      return `<li><button type="button" class="li" data-act="br:row:${r}"><span class="t">Rang ${r + 1}</span><span class="d">${free} libres sur ${s.rowCount[r]}</span></button></li>`;
    }).join('');
  } else {
    const s = v.sections[path.section];
    crumb.push(`<button type="button" class="btn ghost small" data-act="br:stand:${s.stand}">${esc(v.stands[s.stand].name)}</button>`, `<button type="button" class="btn ghost small" data-act="br:section:${s.idx}">Section ${s.code}</button>`, `<span>Rang ${path.row + 1}</span>`);
    body = Array.from({ length: s.rowCount[path.row] }, (_, k) => {
      const i = s.rowStart[path.row] + k;
      const sm = seatSummary(c, i);
      return `<li><button type="button" class="li" data-act="select:${i}" ${em.avail[i] ? '' : 'aria-disabled="true"'}><span class="t">Place ${sm.num} · ${sm.priceLabel}</span><span class="d">${sm.available ? 'Disponible' : 'Vendue'} · ${sm.viewLabel} · ${esc(sm.quick[2].value)}</span></button></li>`;
    }).join('');
  }
  return `<header class="ph"><h2 id="panelTitle">Parcourir les places</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <nav class="bcrumb" aria-label="Chemin">${crumb.join('<span aria-hidden="true">›</span>')}</nav>
    <ul class="list browse">${body}</ul>`;
}

export function panelFavs(c: SeatCtx, favs: number[]) {
  return `<header class="ph"><h2 id="panelTitle">Places enregistrées</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <ul class="list">${favs.map((i) => `<li><button type="button" class="li" data-act="goto:${i}"><span class="t">${esc(seatTitle(c, i).block)}</span><span class="d">${esc(seatTitle(c, i).short)} · ${eur(c.em.price[i])}</span></button></li>`).join('') || '<li class="empty">Aucune place enregistrée pour ce stade. Enregistrez-en depuis la fiche d’une place.</li>'}</ul>`;
}

export { relativePosition };

/** Hiérarchie complète, révélée au toucher de la puce de position (§45) : chaque niveau est un raccourci. */
export function panelWhere(c: SeatCtx, o: { venue: string; stand: number; section: number; seat: number; facts: Array<{ text: string; tone: string }>; recent: number[]; saved: boolean }) {
  const { v } = c;
  const rows: string[] = [`<button type="button" class="li" data-act="home">${icon('stadium')}<span class="t">${esc(o.venue)}</span><span class="d">Vue d’ensemble</span></button>`];
  if (o.stand >= 0) rows.push(`<button type="button" class="li" data-act="stand:${o.stand}">${icon('layers')}<span class="t">${esc(v.stands[o.stand].name)}</span><span class="d">Tribune</span></button>`);
  if (o.section >= 0) {
    const s = v.sections[o.section];
    rows.push(`<button type="button" class="li" data-act="section:${o.section}">${icon('grid')}<span class="t">Section ${s.code}</span><span class="d">${esc(v.stands[s.stand].tiers[s.tier].cfg.label)}</span></button>`);
  }
  let seat = '';
  if (o.seat >= 0) {
    const t = seatTitle(c, o.seat);
    seat = `<div class="where-seat"><p class="ws">Rang ${t.row} · Place ${t.num}${o.saved ? ` <span class="bm" aria-label="enregistrée">${icon('bookmark', 14)}</span>` : ''}</p>
      <p class="wf">${o.facts.map((f) => `<span class="${f.tone}">${esc(f.text)}</span>`).join('<span aria-hidden="true"> · </span>')}</p>
      <div class="row">${B('info', 'Fiche complète', 'info', 'small')}${B('fav', o.saved ? 'Enregistrée' : 'Enregistrer', 'bookmark', `small ghost ${o.saved ? 'on' : ''}`, `aria-pressed="${o.saved}"`)}</div></div>`;
  }
  const recent = o.recent.filter((i) => i !== o.seat).slice(0, 5);
  const rec = recent.length ? `<h3 class="h3">Places récentes</h3><div class="list">${recent.map((i) => { const t = seatTitle(c, i); return `<button type="button" class="li" data-act="goto:${i}"><span class="t">Section ${t.section} · ${t.short}</span><span class="d">${eur(c.em.price[i])}</span></button>`; }).join('')}</div>` : '';
  return `<header class="ph"><h2 id="panelTitle">Où suis-je ?</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    ${seat}<nav class="list where" aria-label="Hiérarchie">${rows.join('')}</nav>${rec}`;
}

/** Détails du match (puce de match touchée) : jamais un habillage télévisé complet. */
export function panelEvent(ev: { label: string; competition: string; home: { name: string; kit: string }; away: { name: string; kit: string }; kickoff: number; date: string }, live: { score: string; minute: string; pre: boolean }, venue: string, shown: boolean) {
  const d = new Date(`${ev.date}T12:00:00`);
  const date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `<header class="ph"><h2 id="panelTitle">${esc(ev.competition)}</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="evbig"><span class="team"><span class="kit" style="background:${ev.home.kit}"></span>${esc(ev.home.name)}</span><span class="score">${live.pre ? fmtTime(ev.kickoff) : esc(live.score)}</span><span class="team">${esc(ev.away.name)}<span class="kit" style="background:${ev.away.kit}"></span></span></div>
    <p class="note" style="text-align:center;margin-top:6px">${live.pre ? 'Avant le coup d’envoi' : esc(live.minute)} · ${esc(date)} · ${esc(venue)}</p>
    <div class="list" style="margin-top:12px"><button type="button" role="switch" class="li sw ${shown ? 'on' : ''}" aria-checked="${shown}" data-act="eventChip"><span class="t">Afficher le match à l’écran</span><span class="d">Masquez-le pour explorer le stade ou faire des captures</span><span class="knob" aria-hidden="true"></span></button></div>
    <p class="note">Match, équipes et score fictifs (simulation).</p>`;
}

/** Options de la vue siège : regarder, zoom (présenté comme tel), perspective, conditions à place égale (§63–65, §95–99). */
export function panelPov(o: { follow: string; zoom: number; perspective: string; env: string; players: boolean; fullscreen: boolean | null }) {
  const seg = (name: string, cur: string, opts: Array<[string, string]>, act: string) =>
    `<div class="seg" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-act="${act}:${v}">${l}</button>`).join('')}</div>`;
  return `<header class="ph"><h2 id="panelTitle">Vue</h2>${IB('panel:none', 'Fermer', 'close', 'ghost')}</header>
    <div class="row">${B('recenter', 'Recentrer sur le jeu', 'recenter', 'small')}${o.players ? B('scale', 'Échelle', 'scale', 'small ghost') : ''}</div>
    ${o.players ? `<div class="field"><span class="flabel">Suivre le jeu <span class="d">toute saisie l’interrompt</span></span>${seg('Suivre', o.follow, [['off', 'Non'], ['ball', 'Le ballon'], ['play', 'L’action']], 'follow')}</div>` : ''}
    <div class="field"><span class="flabel">Zoom optique <span class="d">ce n’est plus la vision réelle</span></span>
      <div class="row">${seg('Zoom', String(o.zoom >= 1.9 ? 2 : 1), [['1', '×1'], ['2', '×2']], 'zoom')}<button type="button" class="btn small ghost hold" data-hold="binoculars" aria-label="Jumelles : maintenir pour zoomer ×3">${icon('binoculars', 18)}<span class="lbl">Jumelles</span></button></div></div>
    <div class="field"><span class="flabel">Perspective</span>${seg('Perspective', o.perspective, [['natural', 'Naturelle'], ['wide', 'Large'], ['standing', 'Debout'], ['pitch', 'Terrain'], ['aerial', 'Aérienne']], 'persp')}</div>
    <div class="field"><span class="flabel">Conditions, même place <span class="d">la caméra ne bouge pas</span></span>${seg('Conditions', o.env, [['sun', 'Jour'], ['sunset', 'Coucher'], ['night', 'Nuit'], ['rain', 'Pluie']], 'envq')}</div>
    <div class="row" style="margin-top:12px">${B('immersive', 'Immersif', 'immersive', 'small ghost')}${o.fullscreen !== null ? B('fullscreen', o.fullscreen ? 'Quitter le plein écran' : 'Plein écran', 'fullscreen', 'small ghost') : ''}</div>`;
}
