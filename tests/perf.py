"""
Matrice de performance : 5 stades × (jour, nuit, pluie) × profils (low, balanced, high) en vue d'ensemble et en vue siège.
Relevés : appels de dessin, triangles, géométries, textures, spectateurs, temps de chargement, temps d'image (médiane, P95),
tas JS. GPU logiciel (SwiftShader, 2 cœurs) : les temps n'ont qu'une valeur RELATIVE ; volumes et mémoire sont exacts.
Puis test de fuite : 11 changements de stade.
Usage : python3 tests/perf.py [dossier]
"""
import sys, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'perf')
OUT.mkdir(parents=True, exist_ok=True)
rows = []
FRAMES = '''(ms) => new Promise((res) => { const t = []; let last = performance.now(); const end = last + ms;
  const f = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b);
    res({ n: t.length, med: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)] }); } }; requestAnimationFrame(f); })'''

with sync_playwright() as pw:
    P = Page(pw, viewport={'width': 1280, 'height': 800})
    P.js('__vantage.events.enabled = false')
    for v in ['arena', 'compact', 'grand', 'classic', 'olympic']:
        t0 = P.js('performance.now()')
        P.js(f'__vantage.loadVenue("{v}")'); P.idle(120000)
        load = P.js('performance.now()') - t0
        combos = [('balanced', e, w) for e in ['day', 'night', 'rain'] for w in ['overview', 'pov']] + [(p, 'day', w) for p in ['low', 'high'] for w in ['overview', 'pov']]
        for prof, env, view in combos:
                P.js(f'__vantage.e.quality.set("{prof}")')
                if True:
                    P.js(f'__lab.state("{view}", {{ venue: "{v}", env: "{env}", freeze: false }})'); P.idle(60000); P.wait(600)
                    fr = P.js(FRAMES, 3000)
                    P.wait(600); P.frames(2)
                    d = P.js('({...__vantage.e.diag})')
                    heap = P.js('performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null')
                    r = {'venue': v, 'profile': prof, 'env': env, 'view': view, 'loadMs': round(load), 'calls': d['calls'], 'triangles': d['triangles'],
                         'geometries': d['geometries'], 'textures': d['textures'], 'crowd': d['crowd'], 'seats': d['seats'], 'buffersMB': round(d['memoryMB'], 1),
                         'frameMed': round(fr['med'], 1), 'frameP95': round(fr['p95'], 1), 'heapMB': heap}
                    rows.append(r)
                    print(v, prof, env, view, r['calls'], r['triangles'], r['frameMed'], r['frameP95'])
    # fuite mémoire : 11 changements de stade puis retour au premier
    P.js('__vantage.e.quality.set("balanced")')
    P.js('__vantage.loadVenue("arena")'); P.idle(120000); P.wait(800)
    m0 = P.js('({...__vantage.e.renderer.info.memory, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null})')
    seq = ['compact', 'grand', 'classic', 'olympic', 'arena', 'grand', 'compact', 'olympic', 'classic', 'grand', 'arena']
    for v in seq:
        P.js(f'__vantage.loadVenue("{v}")'); P.idle(120000); P.wait(300)
    P.wait(1500)
    P.js('window.gc && window.gc()')
    m1 = P.js('({...__vantage.e.renderer.info.memory, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null})')
    leak = {'before': m0, 'after': m1, 'switches': len(seq)}
    print('fuite', leak)
    P.close()

(OUT / 'perf.json').write_text(json.dumps({'rows': rows, 'leak': leak}, indent=1))
