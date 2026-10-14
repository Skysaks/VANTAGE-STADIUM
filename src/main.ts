import './ui/tokens.css';
import './ui/app.css';
import { loadFonts } from './ui/fonts';
import { App, type BuildFlavor } from './app/App';
import { VENUES, resolveVenue } from './config/venues';
import { EVENTS, FOOTBALL } from './config/events';
import { generateVenue } from './venue/generate';
import { computeEvent, computeStatic } from './venue/metrics';
import { panelBrowser } from './ui/views';
import { runScenario } from './presentation/scenarios';

export const BUILD_INFO = { flavor: __BUILD__ as BuildFlavor, version: __VERSION__, commit: __COMMIT__, date: __DATE__ };

const q = new URLSearchParams(location.search);
const presentation = __BUILD__ === 'presentation' || (__BUILD__ === 'lab' && q.get('presentation') === '1');
const record = q.get('record') === '1';
const capture = q.get('capture') === '1';
const $ = (id: string) => document.getElementById(id)!;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch { return false; }
}

/** Message d'échec soigné : jamais de trace technique à l'écran. */
function fatal(title: string, text: string, actions = '') {
  const f = $('fatal');
  f.innerHTML = `<div><div class="loader-mark" aria-hidden="true"></div><h1>${title}</h1><p>${text}</p><div class="row" style="justify-content:center">${actions}</div></div>`;
  f.classList.add('on');
  $('loader').classList.add('done');
}

/** Repli sans 3D : la liste accessible des places reste utilisable (stade → section → rang → place). */
function fallback2D() {
  const vid = resolveVenue(q.get('v')) ?? 'arena';
  const v = generateVenue(VENUES[vid], FOOTBALL);
  const sm = computeStatic(v);
  const ev = EVENTS.night;
  const em = computeEvent(v, sm, ev);
  const c = { v, sm, em, ev };
  const path = { stand: -1, section: -1, row: -1 };
  const box = $('dialogBox');
  const draw = () => { box.innerHTML = panelBrowser(c, path).replace(/data-act="panel:none"[^>]*>/, 'hidden>'); };
  fatal('La 3D n’est pas disponible sur cet appareil', 'Votre navigateur ne permet pas l’affichage 3D (WebGL). Vous pouvez tout de même parcourir les places, leurs prix et la qualité de vue calculée.',
    '<button type="button" class="btn primary" id="open2d">Parcourir les places</button>');
  $('open2d').addEventListener('click', () => { $('fatal').classList.remove('on'); $('dialog').classList.add('on'); draw(); });
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const [, k, x] = (b.dataset.act ?? '').split(':');
    if (b.dataset.act === 'br:root') Object.assign(path, { stand: -1, section: -1, row: -1 });
    else if (k === 'stand') Object.assign(path, { stand: +x, section: -1, row: -1 });
    else if (k === 'section') Object.assign(path, { stand: v.sections[+x].stand, section: +x, row: -1 });
    else if (k === 'row') path.row = +x;
    draw();
  });
}

async function boot() {
  void loadFonts();
  if (!webglAvailable()) { fallback2D(); return; }
  let app: App;
  try {
    app = new App(__BUILD__, { presentation, capture, record });
  } catch {
    fallback2D();
    return;
  }
  (window as unknown as { __vantage: unknown }).__vantage = app;
  if (presentation) app.el.app.dataset.presentation = '1';
  if (record) app.el.app.dataset.record = '1';
  if (capture) app.el.app.dataset.capture = '1';

  // erreurs : jamais de trace à l'écran ; l'expérience continue si une fonction optionnelle échoue
  addEventListener('error', (e) => { app.track('error', String(e.message).slice(0, 120)); });
  addEventListener('unhandledrejection', (e) => { app.track('error', String((e as PromiseRejectionEvent).reason).slice(0, 120)); });

  // perte de contexte WebGL : tentative de reprise sans recharger la page
  const canvas = app.el.canvas as HTMLCanvasElement;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('recover').classList.add('on'); app.track('context-lost'); });
  canvas.addEventListener('webglcontextrestored', () => {
    $('recover').classList.remove('on');
    app.track('context-restored');
    void app.loadVenue(app.venueId);
  });
  $('recoverBtn').addEventListener('click', () => location.reload());

  if (__BUILD__ !== 'public' && presentation) {
    const { Presenter } = await import('./presentation/Presenter');
    new Presenter(app, q);
  }
  if (__BUILD__ === 'lab') {
    const { Lab } = await import('./lab/Lab');
    new Lab(app, BUILD_INFO);
  }
  app.onScenarioRequest ??= (id) => void runScenario(app, id);
  try {
    await app.start(q);
  } catch {
    fatal('Impossible de préparer le stade', 'Un problème est survenu pendant le chargement. Rechargez la page ; si le problème persiste, essayez un autre navigateur.',
      '<button type="button" class="btn primary" onclick="location.reload()">Recharger</button>');
  }
}

void boot();
