"""
12 écrans canoniques (UI/UX System v1.0) + matrice d'environnements (5 stades × 5 ambiances) + QA vue siège (5 états)
+ captures de présentation. États déterministes construits par le Lab (`__lab.state`), animations figées.
Usage : python3 tests/canonical.py <dossier> [canonical|matrix|pov|deck|all]
Régression visuelle : si <dossier>/../reference/<nom>.png existe, l'écart moyen par pixel est mesuré (seuil 6 %).
"""
import sys, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'canonical')
WHAT = sys.argv[2] if len(sys.argv) > 2 else 'all'
OUT.mkdir(parents=True, exist_ok=True)
REF = OUT.parent / 'reference'
report = []

def diff(a, b):
    try:
        from PIL import Image, ImageChops, ImageStat
        A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB').resize(Image.open(a).size)
        st = ImageStat.Stat(ImageChops.difference(A, B))
        return sum(st.mean) / 3 / 255
    except Exception:
        return None

def capture(P, name, state, venue='arena', env='day', settle=1500):
    P.js(f'__lab.state("{state}", {{ venue: "{venue}", env: "{env}", freeze: false }})')
    P.wait(300); P.idle(90000); P.wait(settle)
    P.js('__vantage.pinHud = true; __vantage.interacted()')
    if state != 'reveal': P.js('__vantage.e.timeScale = 0')
    path = OUT / f'{name}.png'
    P.shot(path)
    P.js('__vantage.e.timeScale = 1')
    d = P.js('({...__vantage.e.diag})')
    r = {'name': name, 'state': state, 'venue': venue, 'env': env, 'mode': P.js('__vantage.modes.mode'), 'camera': d['camera'], 'calls': d['calls'],
         'triangles': d['triangles'], 'insets': P.js('__vantage.insets.current'), 'errors': P.errors[:3]}
    ref = REF / f'{name}.png'
    if ref.exists(): r['diff'] = diff(path, ref)
    report.append(r)
    print(name, r['mode'], r['camera'], f"Δ={r.get('diff')}" if 'diff' in r else '', r['errors'] or '')

with sync_playwright() as pw:
    if WHAT in ('canonical', 'all'):
        P = Page(pw, nominal=True)         # bureau 1440 × 900
        for n, s in [('D1_overview', 'overview'), ('D2_section', 'section'), ('D3_seat', 'seat'), ('D4_pov', 'pov'), ('D5_compare', 'compare')]:
            capture(P, n, s)
        capture(P, 'D6_reveal', 'reveal', env='night', settle=5500)
        P.p.wait_for_function('!window.__vantage.reveal.playing', timeout=120000)
        P.close()
        P = Page(pw, mobile=True, nominal=True)  # 390 × 844 tactile
        for n, s in [('M1_overview', 'overview'), ('M2_section', 'section'), ('M3_seat', 'seat'), ('M4_pov', 'pov'), ('M5_move', 'move')]:
            capture(P, n, s)
        capture(P, 'M6_reveal', 'reveal', env='night', settle=5500)
        P.p.wait_for_function('!window.__vantage.reveal.playing', timeout=120000)
        P.close()
        P = Page(pw, mobile=True, viewport={'width': 844, 'height': 390}, nominal=True)   # paysage
        for n, s in [('L1_overview', 'overview'), ('L2_seat', 'seat'), ('L3_pov', 'pov')]:
            capture(P, n, s)
        P.close()
        P = Page(pw, viewport={'width': 1024, 'height': 1366}, nominal=True)              # tablette
        for n, s in [('T1_overview', 'overview'), ('T2_seat', 'seat')]:
            capture(P, n, s)
        P.close()
    if WHAT in ('matrix', 'all'):
        P = Page(pw, viewport={'width': 1280, 'height': 800}, nominal=True)
        for v in ['arena', 'compact', 'grand', 'classic', 'olympic']:
            for e in ['day', 'sunset', 'night', 'rain', 'nightrain']:
                capture(P, f'X_{v}_{e}', 'overview', v, e, settle=900)
        P.close()
    if WHAT in ('pov', 'all'):
        P = Page(pw, viewport={'width': 1280, 'height': 800}, nominal=True)
        capture(P, 'P1_sun', 'pov', 'olympic', 'day')
        capture(P, 'P2_roof_shadow', 'covered', 'classic', 'afternoon' if False else 'day')
        capture(P, 'P3_night', 'pov', 'grand', 'night')
        capture(P, 'P4_rain_exposed', 'exposed', 'classic', 'rain')
        capture(P, 'P5_rain_covered', 'covered', 'classic', 'rain')
        P.close()
    if WHAT in ('deck', 'all'):
        P = Page(pw, flavor='lab', viewport={'width': 1600, 'height': 900})
        P.js("document.getElementById('app').dataset.capture = '1'")
        for n, s, v, e in [('01_hero_day', 'overview', 'arena', 'golden'), ('02_hero_night', 'overview', 'arena', 'night'), ('03_rain', 'covered', 'classic', 'rain'),
                           ('04_compact', 'overview', 'compact', 'sunset'), ('05_mega', 'overview', 'grand', 'night'), ('06_olympic_pov', 'far', 'olympic', 'day'),
                           ('07_seat_selection', 'seat', 'arena', 'day'), ('08_seat_pov', 'pov', 'arena', 'golden'), ('09_compare', 'compare', 'arena', 'day')]:
            capture(P, f'DECK_{n}', s, v, e)
        P.close()

(OUT / 'report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False))
bad = [r for r in report if r['errors'] or (r.get('diff') is not None and r['diff'] > 0.06)]
print(f'{len(report)} captures, {len(bad)} en écart ou en erreur')
