import type { App } from '../app/App';
import { envPreset } from '../app/App';
import { VENUES, VENUE_ORDER } from '../config/venues';
import { icon, esc } from '../ui/dom';
import { SCENARIOS, demoReset, runScenario } from './scenarios';
import type { TimePreset } from '../config/types';
import { REVEALS } from '../config/events';

/**
 * Mode présentation : une très petite surface de commande (Stade, Environnement, Scénario, Révélation, Réinitialiser),
 * des raccourcis clavier réservés à ce mode, la vitrine automatique, l'enregistrement déterministe et la capture propre.
 */
export class Presenter {
  private hidden = false;
  private showcase: { cancel: boolean } | null = null;
  private idleTimer = 0;
  private kiosk = false;

  constructor(private app: App, q: URLSearchParams) {
    app.onScenarioRequest = (id) => void runScenario(app, id);
    app.onPresenterKey = (e) => this.key(e);
    app.onRender.push(() => this.render());
    app.onInteract.push(() => this.bumpIdle());
    app.onCustomAct = (name, arg) => this.act(name, arg);
    app.setSound('off');
    // vitrine automatique : uniquement en mode borne (?showcase=1) — jamais pendant une démonstration animée par un présentateur
    this.kiosk = q.get('showcase') === '1';
    if (this.kiosk) window.setTimeout(() => void this.runShowcase(), 2500);
    if (q.get('sequence') === '1') window.setTimeout(() => void this.recordSequence(), 2500);
    this.bumpIdle();
    document.addEventListener('fullscreenchange', () => { app.detectLayout(); app.e.resize(); app.insets.schedule(); this.render(); });
  }

  private render() {
    const a = this.app;
    if (!a.e.venue) return;
    const env = a.e.env.spec, day = a.e.env.live.daylight;
    const envBtn = (k: string, label: string, ic: string, on: boolean) => `<button type="button" class="btn ${on ? 'on' : ''}" data-act="pr-env:${k}" aria-pressed="${on}" title="${label}">${icon(ic, 16)}<span class="lbl">${label}</span></button>`;
    a.el.presenter.innerHTML = `
      <button type="button" class="btn icon" data-act="pr-venue:-1" aria-label="Stade précédent">${icon('left', 16)}</button>
      <button type="button" class="btn" data-act="panel:venues" title="Changer de stade (V)">${esc(VENUES[a.venueId].name.replace('Vantage ', ''))}</button>
      <button type="button" class="btn icon" data-act="pr-venue:1" aria-label="Stade suivant">${icon('right', 16)}</button>
      <span class="sep"></span>
      ${envBtn('day', 'Jour', 'sun', day > 0.5 && env.rain === 'none')}${envBtn('sunset', 'Coucher', 'sun', false)}${envBtn('night', 'Nuit', 'moon', day < 0.35)}${envBtn('rain', 'Pluie', 'rain', env.rain !== 'none')}
      <span class="sep"></span>
      <div class="sc" role="group" aria-label="Scénarios">${SCENARIOS.map((s) => `<button type="button" class="btn" data-act="pr-sc:${s.id}" title="${s.n} — ${esc(s.title)} · ${esc(s.sub)}">${s.id}</button>`).join('')}</div>
      <span class="sep"></span>
      <button type="button" class="btn" data-act="pr-reveal" title="Révélation">${icon('sparkle', 16)}<span class="lbl">Révélation</span></button>
      <button type="button" class="btn" data-act="pr-reset" title="Réinitialiser la démonstration (X)">${icon('reset', 16)}<span class="lbl">Réinitialiser</span></button>`;
  }

  private act(name: string, arg: string) {
    const a = this.app;
    const pm = (p: TimePreset) => a.e.env.presetMinutes(p);
    this.stopShowcase();
    switch (name) {
      case 'pr-venue': {
        const k = VENUE_ORDER.indexOf(a.venueId);
        void a.loadVenue(VENUE_ORDER[(k + +arg + VENUE_ORDER.length) % VENUE_ORDER.length], { cinematic: true });
        break;
      }
      case 'pr-env':
        if (arg === 'day') a.setEnv({ ...envPreset('day', pm) });
        else if (arg === 'sunset') a.setEnv({ minutes: pm('sunset'), clouds: 'partly', rain: 'none' });
        else if (arg === 'night') a.setEnv({ minutes: pm('night') });
        else a.quickEnv('rain');
        window.setTimeout(() => this.render(), 50);
        break;
      case 'pr-sc': void runScenario(a, arg); break;
      // révélation dans le stade et l'environnement courants (le scénario 07 la joue dans le stade vitrine)
      case 'pr-reveal': void a.launchReveal({ ...REVEALS.surprise, style: 'cinematic' }); break;
      case 'pr-reset': void demoReset(a); break;
    }
  }

  /** Raccourcis réservés au mode présentation (aucun conflit avec les commandes ordinaires). */
  private key(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const a = this.app;
    const k = e.key.toLowerCase();
    if (/^[1-7]$/.test(k)) { this.stopShowcase(); void runScenario(a, k); return true; }
    const map: Record<string, () => void> = {
      d: () => this.act('pr-env', 'day'),
      n: () => this.act('pr-env', 'night'),
      r: () => this.act('pr-env', 'rain'),
      g: () => { this.stopShowcase(); a.goal(); },
      v: () => this.act('pr-venue', '1'),
      x: () => this.act('pr-reset', ''),
      f: () => this.fullscreen(),
      h: () => { this.hidden = !this.hidden; a.el.presenter.style.display = this.hidden ? 'none' : ''; a.insets.schedule(); },
      k: () => this.cleanCapture(),
      p: () => void this.recordSequence(),
      o: () => void this.runShowcase(),
    };
    const f = map[k];
    if (!f) return false;
    e.preventDefault();
    f();
    return true;
  }

  private fullscreen() {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || d.webkitFullscreenElement) (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
  }

  /** Capture propre : masque HUD, présentateur, curseur et infobulles ; l'environnement reste actif. */
  private cleanCapture() {
    const app = this.app.el.app;
    app.dataset.capture = app.dataset.capture === '1' ? '0' : '1';
    this.app.insets.schedule();
  }

  // ---------- vitrine automatique (45–90 s, toute saisie l'arrête) ----------

  private bumpIdle() {
    clearTimeout(this.idleTimer);
    this.stopShowcase();
    if (this.kiosk) this.idleTimer = window.setTimeout(() => void this.runShowcase(), 60000);
  }

  private stopShowcase() { if (this.showcase) { this.showcase.cancel = true; this.showcase = null; } }

  async runShowcase() {
    if (this.showcase || this.app.reveal.playing) return;
    const tok = { cancel: false };
    this.showcase = tok;
    const a = this.app;
    const w = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const steps: Array<() => Promise<void> | void> = [
      () => runScenario(a, '1'), () => w(6000),
      () => runScenario(a, '5'), () => w(7000),
      () => { a.setEnv({ minutes: a.e.env.presetMinutes('night') }); }, () => w(6000),
      () => runScenario(a, '3'), () => w(8000),
      () => runScenario(a, '6'), () => w(9000),
      () => runScenario(a, '4'), () => w(6000),
      () => runScenario(a, '7'), () => w(14000),
    ];
    // l'interaction ne doit pas être captée par nos propres appels : on suspend le suivi pendant chaque étape
    while (!tok.cancel) {
      for (const s of steps) { if (tok.cancel) return; await s(); }
    }
  }

  // ---------- séquence d'enregistrement déterministe (≈ 40 s, §97) ----------

  async recordSequence() {
    const a = this.app;
    const w = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    a.events.enabled = false;
    a.e.players?.seed(7);
    await runScenario(a, '1');                          // 0–5 s : vue d'ensemble de jour
    await w(5000);
    a.setEnv({ minutes: a.e.env.presetMinutes('night') }); // 5–9 s : la nuit tombe
    await w(4000);
    const v = a.e.venue!;
    const main = v.stands.find((s) => s.kind === 'main')!;
    const sec = main.tiers[0].sections[Math.floor(main.tiers[0].sections.length / 2)];
    a.focusSection(sec);                                // 9–13 s : section
    await w(4000);
    const s = v.sections[sec];
    const seat = s.rowStart[Math.round(s.rows * 0.4)] + Math.floor(s.rowCount[Math.round(s.rows * 0.4)] / 2);
    a.gotoSeat(seat);                                   // 13–17 s : vue siège
    await w(4000);
    for (let k = 0; k < 3; k++) { a.step('right'); await w(1300); } // 17–21 s : trois places
    for (let k = 0; k < 4; k++) { a.step('back'); await w(1000); }  // 21–25 s : quatre rangs
    a.quickEnv('rain');                                 // 25–29 s : pluie
    await w(4000);
    await a.loadVenue('classic', { cinematic: true });   // 29–34 s : changement de stade
    await w(4000);
    await runScenario(a, '7');                          // 34–45 s : révélation
  }
}
