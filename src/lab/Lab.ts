import type { App } from '../app/App';
import { FLAGS } from '../app/App';
import { VENUES, VENUE_ORDER } from '../config/venues';
import { EVENTS, EVENT_ORDER, REVEALS, REVEAL_ORDER } from '../config/events';
import { applyState } from '../presentation/scenarios';
import { INTENTS, quality, betterNearby, recommend, seatTitle, eur } from '../app/intelligence';
import { seatId } from '../venue/generate';
import { esc, icon } from '../ui/dom';
import type { QualityProfile } from '../config/types';

type Tab = 'scene' | 'camera' | 'seats' | 'reveal' | 'performance' | 'accessibility';
const TABS: Array<[Tab, string]> = [['scene', 'Scène'], ['camera', 'Caméra'], ['seats', 'Places'], ['reveal', 'Révélation'], ['performance', 'Performance'], ['accessibility', 'Accessibilité']];
export const LAB_STATES = ['overview', 'stand', 'section', 'seat', 'pov', 'move', 'compare', 'covered', 'exposed', 'far', 'goal', 'reveal'];
export const LAB_VIEWPORTS: Array<[number, number, string]> = [[1440, 900, 'Bureau 1440'], [1280, 800, 'Bureau 1280'], [1024, 1366, 'Tablette'], [390, 844, 'iPhone'], [430, 932, 'Grand mobile'], [844, 390, 'Paysage'], [320, 568, 'Petit écran'], [360, 640, 'Android court'], [673, 841, 'Pliable ouvert']];
/** Zones sûres simulées (encoche, barre de gestes) : portrait et paysage d'un téléphone récent. */
const SAFE: Record<string, [number, number, number, number]> = { portrait: [47, 0, 34, 0], landscape: [0, 47, 21, 47] };
const CVD: Record<string, string> = {
  none: '', protanopia: '0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0',
  deuteranopia: '0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0', tritanopia: '0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0',
  achromatopsia: '0.299,0.587,0.114,0,0 0.299,0.587,0.114,0,0 0.299,0.587,0.114,0,0 0,0,0,1,0',
};

/**
 * Experience Lab (construction « lab » uniquement) : onglets Scène, Caméra, Places, Révélation, Performance,
 * Accessibilité ; états déterministes, simulation d'écrans, diagnostics, journal d'événements, informations de build.
 */
export class Lab {
  open = false;
  tab: Tab = 'scene';
  private timer = 0;
  private showInsets = false;
  private insetEl: HTMLElement;

  constructor(private app: App, private info: { flavor: string; version: string; commit: string; date: string }) {
    const btn = app.el.labBtn as HTMLButtonElement;
    btn.hidden = false;
    btn.addEventListener('click', () => this.toggle());
    app.onLabToggle = () => this.toggle();
    app.el.lab.addEventListener('click', (e) => this.click(e));
    app.el.lab.addEventListener('change', (e) => this.change(e));
    addEventListener('keydown', (e) => { if ((e.key === 'l' || e.key === 'L') && !(e.target as HTMLElement).matches('input, select')) this.toggle(); });
    this.insetEl = document.createElement('div');
    this.insetEl.style.cssText = 'position:absolute;z-index:15;pointer-events:none;border:2px dashed rgba(76,201,255,.9);display:none';
    app.el.app.append(this.insetEl);
    (window as unknown as { __lab: unknown }).__lab = this;
    if (new URLSearchParams(location.search).get('lab') === '1') this.toggle();
  }

  toggle() {
    this.open = !this.open;
    this.app.el.lab.classList.toggle('on', this.open);
    this.app.el.app.classList.toggle('lab-open', this.open);
    this.app.insets.schedule();
    if (this.open) { this.render(); this.timer = window.setInterval(() => this.live(), 500); }
    else clearInterval(this.timer);
  }

  /** État déterministe pour la régression visuelle : `await __lab.state('pov', { venue: 'grand', env: 'night', viewport: [390, 844] })`. */
  async state(name: string, o: { venue?: string; env?: string; viewport?: [number, number]; freeze?: boolean; safe?: boolean } = {}) {
    if (o.safe !== undefined) this.safe = o.safe;
    if (o.viewport) this.viewport(o.viewport[0], o.viewport[1]);
    await applyState(this.app, name, o);
    if (o.freeze !== false && name !== 'reveal') window.setTimeout(() => { this.app.e.timeScale = 0; }, 400);
  }

  /** Simulation des zones sûres (encoche, barre de gestes) sur l'écran simulé. */
  safe = false;

  viewport(w: number, h: number) {
    const a = this.app, root = a.el.app;
    if (!w) { root.style.cssText = ''; a.viewportOverride = null; }
    else {
      const k = Math.min(1, (innerWidth - (this.open ? 400 : 0)) / w, innerHeight / h);
      const sf = this.safe && Math.min(w, h) < 600 ? SAFE[w > h ? 'landscape' : 'portrait'] : null;
      const safe = sf ? `--safe-t:${sf[0]}px;--safe-r:${sf[1]}px;--safe-b:${sf[2]}px;--safe-l:${sf[3]}px;` : '';
      root.style.cssText = `width:${w}px;height:${h}px;inset:auto;left:0;top:0;transform-origin:0 0;transform:scale(${k});${safe}`;
      a.viewportOverride = { w, h };
    }
    a.detectLayout();
    a.e.resize();
    a.insets.schedule();
    a.render();
  }

  private click(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lab]');
    if (!b) return;
    const [k, v, w] = (b.dataset.lab ?? '').split(':');
    const a = this.app;
    switch (k) {
      case 'tab': this.tab = v as Tab; this.render(); break;
      case 'close': this.toggle(); break;
      case 'state': void this.state(v, { venue: a.venueId, env: (document.getElementById('labEnv') as HTMLSelectElement | null)?.value ?? 'day', freeze: false }); break;
      case 'vp': this.viewport(+v, +w); break;
      case 'safe': this.safe = !this.safe; this.viewport(this.app.viewportOverride?.w ?? 0, this.app.viewportOverride?.h ?? 0); this.render(); break;
      case 'q': if (v === 'auto') a.e.quality.enableAuto(); else a.e.quality.set(v as QualityProfile); this.render(); break;
      case 'freeze': a.e.timeScale = a.e.timeScale ? 0 : 1; this.render(); break;
      case 'insets': this.showInsets = !this.showInsets; this.render(); break;
      case 'reveal': void a.launchReveal({ ...REVEALS[v], style: (w as 'quick') || REVEALS[v].style }); break;
      case 'skip': a.reveal.skip(); break;
      case 'mem': void this.memoryTest(); break;
      case 'goto': a.gotoSeat(+v); break;
      case 'flag': (FLAGS as Record<string, boolean>)[v] = !(FLAGS as Record<string, boolean>)[v]; this.applyFlags(); this.render(); break;
      case 'cvd': (document.getElementById('c') as HTMLElement).style.filter = v === 'none' ? '' : `url(#cvd-${v})`; this.ensureCvd(); break;
      case 'a11y': void a.act('a11y', v); this.render(); break;
    }
  }

  private change(e: Event) {
    const t = e.target as HTMLSelectElement;
    const a = this.app;
    if (t.id === 'labVenue') void a.loadVenue(t.value, { cinematic: true });
    if (t.id === 'labEvent') a.setEvent(t.value);
  }

  private applyFlags() {
    const a = this.app, f = FLAGS;
    a.e.playersOn = f.players;
    if (a.e.crowd) a.e.crowd.mesh.visible = f.crowd;
    a.e.env.setRainBudget(f.rain ? a.e.quality.settings.rain : 0);
    a.e.setBloom(f.postprocessing && a.e.quality.settings.bloom);
    if (a.e.screens) a.e.screens.group.visible = f.scoreboards;
    if (!f.audio) a.setSound('off');
    if (!f.heatmaps) a.setHeat('stand');
  }

  private ensureCvd() {
    if (document.getElementById('cvdDefs')) return;
    const svg = `<svg id="cvdDefs" width="0" height="0" style="position:absolute">${Object.entries(CVD).filter(([k]) => k !== 'none').map(([k, m]) => `<filter id="cvd-${k}"><feColorMatrix type="matrix" values="${m}"/></filter>`).join('')}</svg>`;
    document.body.insertAdjacentHTML('beforeend', svg);
  }

  /** Bascule entre tous les stades puis revient : vérifie que la mémoire GPU ne s'accumule pas. */
  async memoryTest() {
    const a = this.app;
    const start = a.venueId;
    const m0 = { ...a.e.renderer.info.memory };
    const rows: string[] = [];
    for (const id of [...VENUE_ORDER, ...VENUE_ORDER, start]) {
      await a.loadVenue(id);
      await new Promise((r) => setTimeout(r, 300));
      const m = a.e.renderer.info.memory;
      rows.push(`${id}: ${m.geometries} géom., ${m.textures} tex.`);
    }
    const m1 = a.e.renderer.info.memory;
    a.toast(`Mémoire : ${m0.geometries}→${m1.geometries} géométries, ${m0.textures}→${m1.textures} textures`);
    (window as unknown as { __memRows: string[] }).__memRows = rows;
    return { before: m0, after: { ...m1 }, rows };
  }

  private live() {
    if (!this.open) return;
    const d = this.app.e.diag;
    const el = this.app.el.lab.querySelector('#labLive');
    if (el) el.innerHTML = this.diagHtml();
    if (this.showInsets) {
      const i = this.app.insets.current;
      Object.assign(this.insetEl.style, { display: 'block', left: `${i.left}px`, top: `${i.top}px`, right: `${i.right}px`, bottom: `${i.bottom}px` });
    } else this.insetEl.style.display = 'none';
    void d;
  }

  private diagHtml() {
    const a = this.app, d = a.e.diag, cam = a.e.camera;
    return `<dl class="kv">
      <dt>Images/s (logiciel ≠ réel)</dt><dd>${d.fps.toFixed(1)}</dd><dt>Temps d’image</dt><dd>${d.frameMs.toFixed(1)} ms</dd>
      <dt>Appels de dessin</dt><dd>${d.calls}</dd><dt>Triangles</dt><dd>${d.triangles.toLocaleString('fr-FR')}</dd>
      <dt>Places / visibles</dt><dd>${d.seats.toLocaleString('fr-FR')} / ${d.visibleSeats.toLocaleString('fr-FR')}</dd><dt>Spectateurs</dt><dd>${d.crowd.toLocaleString('fr-FR')}</dd>
      <dt>Géométries / textures</dt><dd>${d.geometries} / ${d.textures}</dd><dt>Buffers (estim.)</dt><dd>${d.memoryMB.toFixed(1)} Mo</dd>
      <dt>Profil</dt><dd>${d.profile}</dd><dt>État caméra</dt><dd>${d.camera}</dd><dt>Mode</dt><dd>${a.modes.mode}</dd>
      <dt>FOV</dt><dd>${cam.fov.toFixed(1)}°</dd><dt>Position</dt><dd>${cam.position.toArray().map((x) => x.toFixed(1)).join(', ')}</dd>
      <dt>Encarts</dt><dd>${Object.values(a.insets.current).map((x) => Math.round(x)).join(' / ')}</dd>
      <dt>Humidité / pluie</dt><dd>${a.e.env.live.wet.toFixed(2)} / ${a.e.env.live.rain.toFixed(2)}</dd><dt>Projecteurs</dt><dd>${a.e.env.live.lights.toFixed(2)}</dd>
    </dl>`;
  }

  render() {
    const a = this.app, L = a.el.lab;
    if (!a.e.venue) return;
    const tabs = TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === this.tab}" data-lab="tab:${k}">${l}</button>`).join('');
    let body = '';
    const stateBtns = `<h3>États déterministes</h3><div class="chips">${LAB_STATES.map((s) => `<button type="button" class="chip" data-lab="state:${s}">${s}</button>`).join('')}</div>
      <p class="note">Environnement : <select id="labEnv">${['day', 'morning', 'golden', 'sunset', 'night', 'rain', 'nightrain', 'heavy', 'fog', 'cloud'].map((e) => `<option>${e}</option>`).join('')}</select></p>`;
    switch (this.tab) {
      case 'scene':
        body = `<h3>Stade</h3><select id="labVenue">${VENUE_ORDER.map((id) => `<option value="${id}" ${id === a.venueId ? 'selected' : ''}>${esc(VENUES[id].name)} · ${esc(VENUES[id].label)}</option>`).join('')}</select>
          <h3>Événement</h3><select id="labEvent">${EVENT_ORDER.map((id) => `<option value="${id}" ${id === a.eventId ? 'selected' : ''}>${esc(EVENTS[id].label)}</option>`).join('')}</select>
          ${stateBtns}
          <h3>Drapeaux de fonctionnalités</h3><div class="chips">${Object.entries(FLAGS).map(([k, v]) => `<button type="button" class="chip ${v ? 'on' : ''}" data-lab="flag:${k}" aria-pressed="${v}">${k}</button>`).join('')}</div>
          <h3>Temps</h3><div class="chips"><button type="button" class="chip ${a.e.timeScale === 0 ? 'on' : ''}" data-lab="freeze">Figer les animations</button></div>
          <p class="note">DONNÉES DE DÉMONSTRATION : stades, clubs, prix et disponibilités fictifs.</p>`;
        break;
      case 'camera':
        body = `<h3>Simulation d'écran</h3><div class="chips">${LAB_VIEWPORTS.map(([w, h, l]) => `<button type="button" class="chip" data-lab="vp:${w}:${h}">${l} ${w}×${h}</button>`).join('')}<button type="button" class="chip" data-lab="vp:0:0">Fenêtre</button></div>
          <div class="chips" style="margin-top:6px"><button type="button" class="chip ${this.safe ? 'on' : ''}" data-lab="safe" aria-pressed="${this.safe}">Zones sûres (encoche, barre de gestes)</button></div>
          <h3>Zone libre (ViewportInsets)</h3><div class="chips"><button type="button" class="chip ${this.showInsets ? 'on' : ''}" data-lab="insets">Afficher la zone 3D libre</button></div>
          <h3>Diagnostic</h3><div id="labLive">${this.diagHtml()}</div>`;
        break;
      case 'seats': {
        const i = a.seat;
        if (i < 0) { body = `<p class="note">Sélectionnez une place pour voir ses scores.</p>${stateBtns}`; break; }
        const c = a.ctx();
        const t = seatTitle(c, i);
        const nb = betterNearby(c, i, a.intent);
        const rec = recommend(c, a.intent, { section: c.v.section[i] });
        body = `<h3>${esc(seatId(c.v, i))} · ${esc(t.block)}</h3><dl class="kv">
          <dt>Vue (calculée)</dt><dd>${c.sm.view[i].toFixed(1)}</dd><dt>Valeur C</dt><dd>${c.sm.cval[i].toFixed(0)} mm</dd><dt>Obstruction</dt><dd>${c.sm.obstruct[i].toFixed(0)}</dd>
          <dt>Distance centre / ligne</dt><dd>${c.sm.dist[i].toFixed(1)} / ${c.sm.edge[i].toFixed(1)} m</dd><dt>Plongée</dt><dd>${c.sm.elev[i].toFixed(1)}°</dd>
          <dt>Abri</dt><dd>${c.sm.covered[i] ? 'oui' : 'non'} (${c.sm.rain[i]})</dd><dt>Prix (simulé)</dt><dd>${eur(c.em.price[i])}</dd><dt>Valeur (résidu)</dt><dd>${c.em.value[i].toFixed(1)}</dd>
          <dt>Ambiance (estimée)</dt><dd>${c.em.atmo[i].toFixed(0)}</dd></dl>
          <h3>Qualité par intention</h3><dl class="kv">${INTENTS.map((it) => `<dt>${it.label}</dt><dd>${quality(c, i, it.id).toFixed(1)}</dd>`).join('')}</dl>
          <h3>Mieux à proximité (Pareto)</h3>${nb.map((n) => `<p><button type="button" class="chip" data-lab="goto:${n.seat}">${n.kind}</button> ${esc(n.why)} (Δq ${n.dq.toFixed(1)}, Δ€ ${n.dp})</p>`).join('') || '<p class="note">Aucune amélioration non dominée.</p>'}
          <h3>Front de Pareto (section)</h3>${rec.map((r) => `<p><button type="button" class="chip" data-lab="goto:${r.seat}">${esc(r.tag)}</button> ${eur(r.price)} · q ${r.q.toFixed(1)}</p>`).join('')}`;
        break;
      }
      case 'reveal':
        body = `<h3>Lancer</h3>${REVEAL_ORDER.map((id) => `<div class="chips" style="margin-bottom:6px">${(['quick', 'cinematic', 'epic'] as const).map((s) => `<button type="button" class="chip" data-lab="reveal:${id}:${s}">${esc(REVEALS[id].label)} · ${s}</button>`).join('')}</div>`).join('')}
          <div class="chips"><button type="button" class="chip" data-lab="skip">Passer</button></div>
          <p class="note">Ancres sémantiques calculées pour chaque stade ; la météo et l'heure courantes sont respectées.</p>`;
        break;
      case 'performance':
        body = `<h3>Profil de qualité</h3><div class="chips">${['auto', 'ultra', 'high', 'balanced', 'low', 'mobile'].map((p) => `<button type="button" class="chip ${(p === 'auto' ? a.e.quality.auto : !a.e.quality.auto && a.e.quality.profile === p) ? 'on' : ''}" data-lab="q:${p}">${p}</button>`).join('')}</div>
          <h3>Mémoire</h3><div class="chips"><button type="button" class="chip" data-lab="mem">Tester 11 changements de stade</button></div>
          <h3>Mesures</h3><div id="labLive">${this.diagHtml()}</div>
          <h3>Journal (session, sans donnée personnelle)</h3><ol style="font-size:11px;color:var(--text-secondary);padding-left:18px">${a.telemetry.slice(-14).reverse().map((t) => `<li>${(t.t / 1000).toFixed(1)} s · ${esc(t.name)}${t.data ? ` · ${esc(t.data.slice(0, 40))}` : ''}</li>`).join('')}</ol>
          <h3>Build</h3><dl class="kv"><dt>Version</dt><dd>${esc(this.info.version)}</dd><dt>Commit</dt><dd>${esc(this.info.commit)}</dd><dt>Date</dt><dd>${esc(this.info.date)}</dd><dt>Saveur</dt><dd>${esc(this.info.flavor)}</dd></dl>`;
        break;
      case 'accessibility':
        body = `<h3>Préférences</h3><div class="chips">
            <button type="button" class="chip ${a.prefs.reduced ? 'on' : ''}" data-lab="a11y:reduced">Mouvement réduit</button>
            <button type="button" class="chip ${a.prefs.comfort ? 'on' : ''}" data-lab="a11y:comfort">Confort</button>
            <button type="button" class="chip ${a.prefs.contrast ? 'on' : ''}" data-lab="a11y:contrast">Contraste élevé</button>
            <button type="button" class="chip" data-lab="a11y:text:xl">Texte 131 %</button><button type="button" class="chip" data-lab="a11y:text:md">Texte 100 %</button></div>
          <h3>Simulation de vision des couleurs</h3><div class="chips">${Object.keys(CVD).map((k) => `<button type="button" class="chip" data-lab="cvd:${k}">${k}</button>`).join('')}</div>
          <h3>Lecteur d'écran</h3><p class="note">Dernière annonce : « ${esc(document.getElementById('live')?.textContent ?? '')} »</p>
          <p class="note">Navigation 2D : touche B. Raccourcis : ?.</p>`;
        break;
    }
    L.innerHTML = `<div class="lh"><h2>${icon('lab', 16)} Experience Lab</h2><button type="button" class="btn icon ghost" data-lab="close" aria-label="Fermer le Lab">${icon('close')}</button></div>
      <div class="tabs" role="tablist">${tabs}</div><div class="lb" role="tabpanel">${body}</div>`;
  }
}
