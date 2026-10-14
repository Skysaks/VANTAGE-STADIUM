"""Mesure de départ : moteur reconstruit (état v2), avant les trois briefs. Usage : python3 tests/baseline.py <html> <outdir>"""
import json, sys, time, pathlib
from playwright.sync_api import sync_playwright
html, out = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    pg.route('**/fonts.g*/**', lambda r: r.abort())
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(html.as_uri())
    pg.wait_for_function('window.__base')
    for vid in pg.evaluate('__base.order'):
        r = pg.evaluate(f'__base.load("{vid}")')
        pg.wait_for_timeout(2500)
        d = pg.evaluate('({...__base.engine.diag})')
        pg.screenshot(path=str(out / f'{vid}_overview.png'), timeout=180000)
        pg.evaluate('__base.pov(0.5)')
        pg.wait_for_timeout(2500)
        d2 = pg.evaluate('({...__base.engine.diag})')
        pg.screenshot(path=str(out / f'{vid}_pov.png'), timeout=180000)
        res[vid] = {'loadMs': round(r['ms']), 'seats': r['seats'], 'overview': d, 'pov': d2}
        print(vid, res[vid]['loadMs'], 'ms', r['seats'], 'seats', 'calls', d['calls'], 'tris', d['triangles'], 'pov calls', d2['calls'])
    res['errors'] = errs
    b.close()
(out / 'baseline.json').write_text(json.dumps(res, indent=1))
