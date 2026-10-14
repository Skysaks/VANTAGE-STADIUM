"""
§109 — endurance : exploration continue des places pendant N minutes (15 par défaut) sur téléphone simulé.
Suit : images/s mesurées, échelle de résolution et profil de qualité choisis par le gestionnaire adaptatif,
géométries et textures GPU, tas JavaScript. Sur GPU logiciel, seuls la mémoire et la stabilité ont un sens ;
la thermique et les images/s réelles exigent un vrai téléphone (protocole dans docs/MOBILE_MICROHUD.md).
Usage : python3 tests/soak.py [minutes] [dossier]
"""
import sys, json, time, random
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *

MIN = float(sys.argv[1]) if len(sys.argv) > 1 else 15
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'tests' / 'shots' / 'soak')
OUT.mkdir(parents=True, exist_ok=True)
random.seed(7)
samples = []
with sync_playwright() as pw:
    P = Page(pw, flavor='lab', mobile=True)
    # gestionnaire adaptatif actif, comme sur un vrai téléphone
    P.js("(() => { const q = __vantage.e.quality; q.set('mobile'); q.enableAuto(); })()")
    P.js('__vantage.events.enabled = true')
    t0 = time.time(); k = 0
    venues = ['arena', 'compact', 'grand', 'classic', 'olympic']
    while time.time() - t0 < MIN * 60:
        k += 1
        op = k % 9
        try:
            if op == 0: P.js(f'__vantage.loadVenue("{venues[(k // 9) % 5]}", {{ cinematic: true }})'); P.idle(120000)
            elif op in (1, 4, 7):
                P.js('(() => { const a = __vantage, v = a.e.venue; const i = Math.floor(Math.random() * v.count); a.gotoSeat(i); })()'); P.idle(60000)
            elif op in (2, 5): P.js('(() => { const a = __vantage; for (let j = 0; j < 3; j++) a.step(["left","right","back","forward"][Math.floor(Math.random()*4)]); })()')
            elif op == 3: P.js(f'__vantage.quickEnv("{random.choice(["night", "rain", "sun", "sunset"])}")')
            elif op == 6: P.js('(() => { const a = __vantage; if (a.seat >= 0) { a.startCompare(); const v = a.e.venue; a.setCompareB(Math.floor(Math.random() * v.count)); } })()'); P.idle(60000)
            elif op == 8: P.js('__vantage.overview()'); P.idle(60000)
        except Exception as e:
            print('op', op, 'erreur', str(e)[:120])
        P.wait(1500)
        d = P.js('''(() => { const a = __vantage, q = a.e.quality, m = performance.memory; return { t: 0, fps: +a.e.diag.fps.toFixed(2), profile: q.profile, res: q.resScale, dpr: +a.e.renderer.getPixelRatio().toFixed(2),
          geo: a.e.renderer.info.memory.geometries, tex: a.e.renderer.info.memory.textures, heap: m ? Math.round(m.usedJSHeapSize / 1048576) : null, venue: a.venueId, mode: a.modes.mode }; })()''')
        d['t'] = round(time.time() - t0)
        samples.append(d)
        if k % 6 == 0: print(d)
    errs = P.errors[:5]
    P.close()
geo = [s['geo'] for s in samples]; tex = [s['tex'] for s in samples]; heap = [s['heap'] for s in samples if s['heap']]
summary = {'minutes': MIN, 'operations': k, 'geometries': [min(geo), max(geo), geo[-1]], 'textures': [min(tex), max(tex), tex[-1]],
           'heapMB': [min(heap), max(heap), heap[-1]] if heap else None, 'profiles': sorted({s['profile'] for s in samples}), 'resScales': sorted({s['res'] for s in samples}), 'errors': errs}
(OUT / 'soak.json').write_text(json.dumps({'summary': summary, 'samples': samples}, indent=1))
print(json.dumps(summary, ensure_ascii=False))
