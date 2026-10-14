import * as THREE from 'three';
import type { App } from './App';
import type { ExperienceMode } from './modes';
import type { MatchState } from '../config/types';
import { BADGE_TEXT, povFactBar, sectionFact, seatFacts, seatTitle, eur, type Badge, type Fact } from './intelligence';
import { esc, icon, announce } from '../ui/dom';
import { fmtTime, envIcon } from '../ui/views';
import { viewLabel } from '../venue/metrics';

/** Niveaux d'interface (§13) : FULL après une interaction, MINIMAL après ~3 s, IMMERSIVE après ~6 s en vue siège. */
export type UiLevel = 'full' | 'minimal' | 'immersive';

const MATCH_FLASH: Partial<Record<MatchState, string>> = { corner: 'Corner', freekick: 'Coup franc', penalty: 'Penalty', kickoff: 'Coup d’envoi', halftime: 'Mi-temps' };

/**
 * Micro-HUD : quelques puces contextuelles, jamais un tableau de bord (§3, §113).
 *  • une puce de match (optionnelle, repliée en vue siège après inactivité) ;
 *  • une puce d'environnement (heure, météo) qui ouvre une bande rapide Soleil / Coucher / Nuit / Pluie ;
 *  • une puce de position compacte (« 104 · R7 · P18 ») qui révèle la hiérarchie au toucher ;
 *  • un seul fait contextuel à la fois, remplacé après 5 s d'inactivité, jamais en carrousel ;
 *  • des signaux temporaires (vue courante, moment de match, ambiance en cours) qui s'effacent seuls.
 */
export class Hud {
  level: UiLevel = 'full';
  forcedImmersive = false;
  /** Dernière saisie au clavier : on ne masque alors rien automatiquement (§14). */
  keyboardNav = false;
  showEvent = true;
  private flashUntil = 0; private flashPrio = 0; private flashTimer = 0;
  private envFlashOn = false;
  private facts: Fact[] = [];
  private factIdx = 0; private factShownAt = 0; private factBarUntil = 0; private factSeat = -1;
  private factDetail = false;
  private undoSeat = -1;
  private candTimer = 0;
  private evKey = '';
  private lastCheck = 0;
  private recenterOn = false;
  private framed: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private wasBusy = false;
  private pipCorner = -1;
  private badgeCache = new Map<string, Map<number, Badge>>();

  constructor(private app: App) {
    const el = app.el;
    el.evchip.addEventListener('click', () => this.toggleEventInfo());
    el.recenter.addEventListener('click', () => { app.interacted(); this.recenter(); });
    el.undo.addEventListener('click', () => { app.interacted(); this.undo(); });
    el.facts.addEventListener('click', () => { app.interacted(); this.factTap(); });
    el.facts.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && el.facts.classList.contains('tap')) { e.preventDefault(); this.factTap(); } });
    el.zoomchip.addEventListener('click', () => { app.interacted(); app.d.setZoom(1); announce('Retour à la vue réelle, sans zoom.'); });
    el.pip.addEventListener('click', () => { app.interacted(); if (app.compareB >= 0) app.viewCompare(app.compareView === 'a' ? 'b' : 'a'); });
    el.envstrip.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-q]');
      if (!b) return;
      ev.stopPropagation();
      app.interacted();
      const k = b.dataset.q!;
      if (k === 'more') { this.closeEnvStrip(false); app.openPanel('env', el.top.querySelector<HTMLElement>('.env-chip')); return; }
      app.quickEnv(k);
      this.renderEnvStrip();
      // l'état est appliqué, les commandes restent ~1,5 s puis se replient (§101)
      clearTimeout(this.stripTimer);
      this.stripTimer = window.setTimeout(() => this.closeEnvStrip(true), 1500);
    });
    el.envstrip.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.closeEnvStrip(true); } });
    el.cands.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-seat]');
      if (!b) return;
      app.interacted();
      const i = +b.dataset.seat!;
      this.hideCandidates();
      app.onCandidate(i);
    });
    addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter') this.keyboardNav = true; }, true);
    addEventListener('pointerdown', () => { this.keyboardNav = false; }, true);
  }

  // ------------------------------------------------------------------ niveaux d'interface

  /** Masquage automatique permis : saisie tactile ou souris, réglages d'accessibilité standards, aucune tâche en cours. */
  private autoHideAllowed() {
    const a = this.app, p = a.prefs;
    return !this.keyboardNav && !p.contrast && p.text === 'md' && !a.panel && !a.infoOpen && !a.d.busy && !a.opts.capture && !a.pinHud && !this.stripOpen;
  }

  setLevel(l: UiLevel) {
    if (l === this.level) return;
    this.level = l;
    this.app.el.app.dataset.ui = l;
    if (l === 'full') this.app.insets.schedule();
  }

  immersive(on: boolean) {
    this.forcedImmersive = on;
    this.setLevel(on ? 'immersive' : 'full');
    if (on) announce('Mode immersif : touchez l’écran ou appuyez sur Échap pour retrouver les commandes.');
  }

  /** Toute interaction significative : retour au niveau complet. Renvoie vrai si l'interface était masquée. */
  wake(): boolean {
    const hidden = this.level === 'immersive';
    if (this.forcedImmersive) this.forcedImmersive = false;
    this.setLevel('full');
    return hidden;
  }

  // ------------------------------------------------------------------ rendu (sur changement d'état)

  render() {
    const a = this.app;
    if (!a.e.venue) return;
    this.renderEvent();
    this.renderFacts(true);
    this.renderZoom();
    if (this.stripOpen) this.renderEnvStrip();
  }

  onMode(m: ExperienceMode, prev: ExperienceMode) {
    const a = this.app;
    if (m !== 'pov' && m !== 'move') this.hideUndo();
    this.hideCandidates();
    this.framed = null;
    if (m === 'reveal' || a.opts.capture || a.opts.record) return;
    const v = a.e.venue;
    if (!v) return;
    const label = m === 'overview' ? 'Vue d’ensemble' : m === 'stand' && a.stand >= 0 ? v.stands[a.stand].name
      : m === 'section' && a.section >= 0 ? `Section ${v.sections[a.section].code}` : m === 'pov' ? (a.anchorLabel ? a.anchorLabel : prev === 'move' || prev === 'compare' ? '' : 'Vue siège')
      : m === 'move' ? 'Se déplacer' : m === 'compare' ? 'Comparaison' : '';
    if (label) this.flash(label, 1200, 1);
  }

  // ------------------------------------------------------------------ puce de match

  private eventVisible() {
    const a = this.app, m = a.modes.mode;
    if (!this.showEvent || a.opts.capture || m === 'reveal' || !a.e.players) return false;
    // exploration du lieu (calques de couleur, vue éclatée) : le match n'est pas le sujet (§5)
    if (a.heat !== 'stand' || a.e.explode > 0.5) return false;
    return m === 'overview' || m === 'pov' || m === 'move' || m === 'compare';
  }

  eventText() {
    const a = this.app, p = a.e.players, ev = a.e.event;
    if (!p) return { compact: '', full: '' };
    const pre = p.state === 'warmup';
    const sc = `${p.score.home}–${p.score.away}`;
    const min = p.state === 'halftime' ? 'MT' : `${p.minute}’`;
    return {
      pre, sc, min,
      compact: pre ? `${ev.home.short} · ${ev.away.short}` : `${sc} · ${min}`,
      full: pre ? `${ev.home.short} · ${ev.away.short} ${fmtTime(ev.kickoff)}` : `${ev.home.short} ${sc} ${ev.away.short} ${min}`,
    };
  }

  renderEvent() {
    const a = this.app, el = a.el.evchip;
    const on = this.eventVisible();
    el.hidden = !on;
    // sous-titre du nom de stade (mobile, vue d'ensemble)
    const sub = a.el.top.querySelector<HTMLElement>('#brandEv');
    const t = this.eventText();
    if (sub) sub.textContent = this.showEvent && a.e.players ? (t.pre ? t.full : `${a.e.event.home.short} ${t.sc} ${a.e.event.away.short} · ${t.min}`) : '';
    if (!on) return;
    const ev = a.e.event;
    const key = `${t.full}|${ev.id}`;
    if (key === this.evKey) return;
    this.evKey = key;
    const p = a.e.players!;
    el.removeAttribute('aria-label');
    const sr = `<span class="sr-only"> : ${t.pre ? `match ${esc(ev.home.name)} contre ${esc(ev.away.name)}, coup d’envoi ${fmtTime(ev.kickoff)}` : `${esc(ev.home.name)} ${p.score.home}, ${esc(ev.away.name)} ${p.score.away}, ${t.min === 'MT' ? 'mi-temps' : `${p.minute}e minute`}`}. Détails du match</span>`;
    el.innerHTML = t.pre
      ? `<span class="bar" style="background:${ev.home.kit}"></span><span class="tm">${esc(ev.home.short)}</span><span class="vs">·</span><span class="tm">${esc(ev.away.short)}</span><span class="mn">${fmtTime(ev.kickoff)}</span>${sr}`
      : `<span class="bar" style="background:${ev.home.kit}"></span><span class="tm">${esc(ev.home.short)}</span><span class="sc">${t.sc}</span><span class="tm">${esc(ev.away.short)}</span><span class="bar" style="background:${ev.away.kit}"></span><span class="mn">${t.min}</span>${sr}`;
  }

  private toggleEventInfo() {
    const a = this.app;
    a.interacted();
    a.openPanel(a.panel === 'event' ? null : 'event', a.el.evchip);
  }

  /** Changement d'état du jeu : petite notification (§56). Le but s'affiche d'abord sur les écrans du stade (§57). */
  onMatchState(s: MatchState) {
    const t = MATCH_FLASH[s];
    if (t && this.app.modes.mode !== 'reveal') this.flash(t, 1500, 3);
    this.evKey = '';
    this.renderEvent();
  }
  onGoal() {
    const a = this.app;
    window.setTimeout(() => { this.flash(`But · ${a.e.event.home.short}`, 1600, 3); this.evKey = ''; this.renderEvent(); }, 1300);
  }

  // ------------------------------------------------------------------ signal temporaire

  flash(text: string, ms: number, prio = 1) {
    const a = this.app;
    if (a.opts.capture || a.opts.record || a.modes.mode === 'reveal') return;
    const now = performance.now();
    if (now < this.flashUntil && prio < this.flashPrio) return;
    this.flashUntil = now + ms; this.flashPrio = prio;
    const f = a.el.flash;
    f.textContent = text;
    f.classList.add('on');
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { f.classList.remove('on'); this.flashPrio = 0; }, ms);
  }

  /** Ambiance en cours de transition (§51) : « Coucher de soleil », « Pluie »… jusqu'à la fin, puis effacement. */
  envFlash(label: string) {
    const env = this.app.e.env;
    this.envFlashOn = true;
    this.flash(label, Math.max(1200, env.remainingMs() + 300), 2);
  }

  // ------------------------------------------------------------------ fait contextuel

  private factCtx() { const a = this.app; return { sunAlt: a.e.env.live.sunAlt, daylight: a.e.env.live.daylight }; }

  renderFacts(reset = false) {
    const a = this.app, el = a.el.facts, m = a.modes.mode;
    const v = a.e.venue;
    let html = '';
    let clickable = false;
    if (v && (m === 'pov' || m === 'move') && a.seat >= 0 && !a.anchorLabel) {
      const c = a.ctx();
      if (reset || this.factSeat !== a.seat) {
        if (this.factSeat !== a.seat) { this.factBarUntil = performance.now() + 3000; this.factDetail = false; }
        this.factSeat = a.seat;
        this.facts = seatFacts(c, a.seat, this.factCtx());
        this.factIdx = 0; this.factShownAt = performance.now();
      }
      if (m === 'move') {
        html = '';
      } else if (performance.now() < this.factBarUntil) {
        const bar = povFactBar(c, a.seat, this.factCtx());
        html = bar.map((f) => `<span class="f ${f.tone}">${esc(f.text)}</span>`).join('<span class="dot" aria-hidden="true">·</span>');
        el.dataset.kind = 'bar';
      } else {
        const f = this.facts[this.factIdx % Math.max(1, this.facts.length)];
        if (f) {
          html = `<span class="f ${f.tone}">${f.tone === 'warn' ? icon('info', 14) : ''}${esc(f.text)}${this.factDetail && f.detail ? `<span class="det"> · ${esc(f.detail)}</span>` : ''}</span>`;
          clickable = !!f.detail;
        }
        el.dataset.kind = 'one';
      }
    } else if (v && m === 'section' && a.section >= 0) {
      html = `<span class="f">${esc(sectionFact(a.ctx(), a.section).text)}</span>`;
      el.dataset.kind = 'one';
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = !html;
    el.classList.toggle('tap', clickable);
    el.setAttribute('tabindex', clickable ? '0' : '-1');
    el.setAttribute('role', clickable ? 'button' : 'note');
  }

  private factTap() {
    const a = this.app;
    const f = this.facts[this.factIdx % Math.max(1, this.facts.length)];
    if (!f?.detail) return;
    this.factDetail = !this.factDetail;
    this.renderFacts();
    announce(`${f.text}. ${f.detail}`);
    // poteau : on montre la source en tournant la tête vers lui (§61)
    if (this.factDetail && a.seat >= 0 && a.e.statics!.obsSrc[a.seat] === 3) {
      const v = a.e.venue!, st = v.stands[v.stand[a.seat]];
      let best: { x: number; z: number; y1: number } | null = null, bd = 1e9;
      for (const c of st.columns) { const d = (c.x - v.px[a.seat]) ** 2 + (c.z - v.pz[a.seat]) ** 2; if (d < bd) { bd = d; best = c; } }
      if (best) a.d.lookToward(new THREE.Vector3(best.x, Math.min(best.y1, v.py[a.seat] + 4), best.z), 500);
    }
  }

  // ------------------------------------------------------------------ zoom

  renderZoom() {
    const a = this.app, z = a.d.zoom;
    const on = z > 1.05 && a.d.isPOV;
    a.el.zoomchip.hidden = !on;
    if (on) a.el.zoomchip.innerHTML = `<span>Zoom ×${z.toFixed(z % 1 < 0.05 ? 0 : 1)}</span><span class="r">Vue réelle</span>`;
  }

  // ------------------------------------------------------------------ recentrer, annuler

  recenter() {
    const a = this.app, m = a.modes.mode;
    if (a.d.isPOV) {
      a.d.setZoom(1);
      a.d.lookToward(a.playTarget(), 480);
      announce('Regard recentré sur le jeu.');
    } else if (m === 'overview') { a.d.overview(700); announce('Vue d’ensemble recentrée.'); }
    else if (m === 'stand' && a.stand >= 0) a.d.focusStand(a.stand);
    else if (a.section >= 0) a.d.focusSection(a.section);
    this.recenterOn = false;
    a.el.recenter.hidden = true;
  }

  /** « Annuler » reste ~2,6 s après l'arrivée dans la nouvelle place (pas pendant le trajet de la caméra). */
  offerUndo(prev: number) {
    if (prev < 0) return;
    this.undoSeat = prev;
    this.undoUntil = 0;
    this.undoOffers++;
    this.app.el.undo.hidden = false;
  }
  undoOffers = 0;
  private undoUntil = 0;
  hideUndo() { this.undoSeat = -1; this.undoUntil = 0; this.app.el.undo.hidden = true; }
  undo() {
    const i = this.undoSeat;
    this.hideUndo();
    if (i < 0) return;
    this.app.moveTo(i, { undoable: false });
    announce('Retour à la place précédente.');
  }

  // ------------------------------------------------------------------ bande rapide d'environnement

  stripOpen = false;
  private stripTimer = 0;
  private stripReturn: HTMLElement | null = null;

  openEnvStrip(from?: HTMLElement | null) {
    const a = this.app;
    a.closePanel();
    this.stripOpen = true;
    this.stripReturn = from ?? null;
    this.renderEnvStrip();
    a.el.envstrip.hidden = false;
    a.el.envstrip.querySelector<HTMLElement>('[aria-pressed="true"], button')?.focus({ preventScroll: true });
    this.setLevel('full');
  }

  closeEnvStrip(returnFocus: boolean) {
    if (!this.stripOpen) return;
    this.stripOpen = false;
    clearTimeout(this.stripTimer);
    const s = this.app.el.envstrip;
    const had = s.contains(document.activeElement);
    s.hidden = true;
    if (returnFocus && had) (this.stripReturn?.isConnected ? this.stripReturn : this.app.el.top.querySelector<HTMLElement>('.env-chip'))?.focus({ preventScroll: true });
  }

  renderEnvStrip() {
    const a = this.app, e = a.e.env.spec, day = a.e.env.live.daylight;
    const sunset = Math.abs(e.minutes - a.e.env.presetMinutes('sunset')) < 25;
    const on = (k: string) => k === 'rain' ? e.rain !== 'none' : k === 'night' ? day < 0.35 && e.rain === 'none' : k === 'sunset' ? sunset && e.rain === 'none' : day > 0.5 && !sunset && e.rain === 'none';
    const B = (k: string, l: string, ic: string) => `<button type="button" class="qs ${on(k) ? 'on' : ''}" data-q="${k}" aria-pressed="${on(k)}">${icon(ic, 18)}<span>${l}</span></button>`;
    a.el.envstrip.innerHTML = `${B('sun', 'Jour', 'sun')}${B('sunset', 'Coucher', 'sun')}${B('night', 'Nuit', 'moon')}${B('rain', 'Pluie', 'rain')}
      <button type="button" class="qs more" data-q="more" aria-label="Tous les réglages d’heure et de météo">${icon('more', 18)}</button>`;
  }

  // ------------------------------------------------------------------ cibles tactiles ambiguës

  showCandidates(list: number[], chosen: number) {
    const a = this.app, c = a.ctx(), el = a.el.cands;
    el.innerHTML = `<span class="k">Ou</span>${list.map((i) => {
      const t = seatTitle(c, i);
      return `<button type="button" class="cand ${i === chosen ? 'on' : ''}" data-seat="${i}" aria-pressed="${i === chosen}" aria-label="Rang ${t.row}, place ${t.num}">R${t.row}·${t.num}</button>`;
    }).join('')}`;
    el.hidden = false;
    clearTimeout(this.candTimer);
    this.candTimer = window.setTimeout(() => this.hideCandidates(), 2200);
  }
  hideCandidates() { this.app.el.cands.hidden = true; clearTimeout(this.candTimer); }

  // ------------------------------------------------------------------ aperçu par appui long

  peek(i: number, x: number, y: number) {
    const a = this.app, c = a.ctx(), el = a.el.peek;
    const t = seatTitle(c, i);
    el.innerHTML = `<strong>R${t.row} · P${t.num}</strong><span>${eur(c.em.price[i])} · ${esc(viewLabel(c.sm.view[i]))}</span><span class="s">${c.em.avail[i] ? 'Touchez pour choisir' : 'Vendue'}</span>`;
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.transform = `translate(${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px, ${Math.max(60, y - h - 46)}px)`;
    a.haptic(6);
  }
  unpeek() { this.app.el.peek.hidden = true; }

  // ------------------------------------------------------------------ badges

  badges(sec: number): Map<number, Badge> {
    const a = this.app, c = a.ctx();
    const k = `${a.venueId}:${a.eventId}:${sec}:${c.cond?.rain ? 'r' : ''}${c.cond?.sun ? 's' : ''}`;
    let m = this.badgeCache.get(k);
    if (!m) { m = sectionBadgesSafe(a, sec); this.badgeCache.set(k, m); if (this.badgeCache.size > 40) this.badgeCache.clear(); }
    return m;
  }
  badgeText(b: Badge) { return BADGE_TEXT[b]; }

  // ------------------------------------------------------------------ boucle (≈ 4 Hz pour les décisions)

  frame() {
    const a = this.app;
    const now = performance.now();
    const m = a.modes.mode;
    // niveaux d'interface en vue siège
    if (!this.forcedImmersive) {
      const idle = now - a.lastInputAt;
      let want: UiLevel = 'full';
      if ((m === 'pov') && this.autoHideAllowed() && !a.reveal.playing) want = idle > 6000 ? 'immersive' : idle > 3000 ? 'minimal' : 'full';
      this.setLevel(want);
    }
    if (now - this.lastCheck < 250) return;
    this.lastCheck = now;
    // puce de match : minute et score
    this.renderEvent();
    // fait : la barre se replie, puis un autre fait remplace le premier après 5 s sans interaction (jamais de carrousel actif)
    if ((m === 'pov') && a.seat >= 0) {
      if (this.factBarUntil && now > this.factBarUntil) { this.factBarUntil = 0; this.renderFacts(); }
      if (now - a.lastInputAt > 5000 && now - this.factShownAt > 5000 && this.facts.length > 1 && !this.factDetail) {
        this.factIdx = (this.factIdx + 1) % Math.min(4, this.facts.length);
        this.factShownAt = now;
        this.renderFacts();
      }
    }
    if (this.envFlashOn && a.e.env.remainingMs() <= 0) this.envFlashOn = false;
    if (this.undoSeat >= 0 && !a.d.busy) {
      if (!this.undoUntil) this.undoUntil = now + 2600;
      else if (now > this.undoUntil) this.hideUndo();
    }
    this.renderZoom();
    this.checkRecenter();
    this.placePip();
  }

  /** « Recentrer » n'apparaît que lorsqu'on s'est écarté du cadrage naturel (§48). */
  private checkRecenter() {
    const a = this.app, d = a.d, m = a.modes.mode;
    let show = false;
    if (!d.busy && a.ready && !a.reveal.playing) {
      if (d.isPOV && a.seat >= 0) {
        const dev = d.lookDeviation();
        show = d.followPlay === 'off' && (dev.yaw > 0.75 || dev.pitch > 0.38 || dev.pitch < -0.5 || dev.zoom > 1.05);
      } else if (d.def.orbit && (m === 'overview' || m === 'stand' || m === 'section' || m === 'seat')) {
        if (this.wasBusy || !this.framed) this.framed = { pos: a.e.camera.position.clone(), target: d.controls.target.clone() };
        const f = this.framed;
        const v0 = f.pos.clone().sub(f.target), v1 = a.e.camera.position.clone().sub(d.controls.target);
        const ang = v0.angleTo(v1), ratio = v1.length() / Math.max(1, v0.length()), off = d.controls.target.distanceTo(f.target);
        show = ang > (m === 'overview' ? 1.1 : 0.8) || ratio > 1.7 || ratio < 0.5 || off > (m === 'overview' ? 30 : 16);
      }
    }
    this.wasBusy = d.busy;
    if (show !== this.recenterOn) {
      this.recenterOn = show;
      a.el.recenter.hidden = !show;
    }
  }

  // ------------------------------------------------------------------ incrustation (comparaison mobile)

  /** Place l'incrustation B dans le coin qui ne masque ni le ballon, ni le centre du terrain, ni les commandes (§68). */
  placePip() {
    const a = this.app, e = a.e, sec = e.secondary, el = a.el.pip;
    if (!sec || sec.mode !== 'pip') { el.hidden = true; this.pipCorner = -1; return; }
    const W = a.el.app.clientWidth, H = a.el.app.clientHeight, ins = a.insets.current;
    const w = Math.round(Math.max(120, Math.min(200, W * 0.32))), h = Math.round(w * 0.66);
    const top = Math.max(ins.top, 60) + 8, bottom = H - Math.max(ins.bottom, 80) - 8 - h;
    const corners = [[W - w - 12, top], [12, top], [W - w - 12, bottom], [12, bottom]];
    const proj = (p: THREE.Vector3) => { const q = p.clone().project(e.camera); return q.z < 1 ? [(q.x * 0.5 + 0.5) * W, (-q.y * 0.5 + 0.5) * H] : null; };
    const ball = e.players ? proj(e.players.ballPosition) : null, centre = proj(new THREE.Vector3(0, 0, 0));
    const score = (k: number) => {
      const [x, y] = corners[k], cx = x + w / 2, cy = y + h / 2;
      let s = 0;
      for (const p of [ball, centre]) if (p) s += Math.min(400, Math.hypot(p[0] - cx, p[1] - cy));
      return s + (k === this.pipCorner ? 60 : 0);
    };
    let best = 0, bs = -1;
    for (let k = 0; k < 4; k++) { const s = score(k); if (s > bs) { bs = s; best = k; } }
    this.pipCorner = best;
    const [x, y] = corners[best];
    sec.rect = { x, y, w, h };
    el.hidden = false;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.width = `${w}px`; el.style.height = `${h}px`;
    const other = a.compareView === 'a' ? 'B' : 'A';
    el.querySelector('.ab')!.textContent = other;
    el.setAttribute('aria-label', `Aperçu de la place ${other} : toucher pour l’afficher en grand`);
  }
}

function sectionBadgesSafe(a: App, sec: number) {
  try { return a.sectionBadges(sec); } catch { return new Map<number, Badge>(); }
}

export function envLabel(a: App) {
  const e = a.e.env.spec;
  if (e.rain !== 'none') return 'Pluie';
  const p = a.e.env.presetOf(e.minutes);
  return p === 'night' || p === 'blue' ? 'Nuit' : p === 'sunset' || p === 'golden' ? 'Coucher de soleil' : 'Jour';
}

export { envIcon };
