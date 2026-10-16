"""Sécurité des fichiers construits : CSP stricte respectée, liens hostiles sans effet.

python3 tests/csp.py   (après `npm run build`)
Charge les trois saveurs, avec et sans paramètres d'URL hostiles (clés du prototype d'objet, style et heure
invalides), et vérifie : aucune violation de CSP, aucune erreur de page, pas d'écran d'échec, la scène se charge.
"""
import sys
from playwright.sync_api import sync_playwright
from harness import ARGS, ROOT

FILES = ['vantage.html', 'vantage-presentation.html', 'vantage-lab.html', '../docs/demo/index.html', '../docs/demo/presentation.html']
QUERIES = [
    '',
    'v=constructor&event=__proto__&reveal=toString&style=x&t=99999',
    'v=hasOwnProperty&env=valueOf&seat=__proto__&cmp=constructor',
    'v=classic&env=rain&t=1200&seat=104-R12-S18',
]

failures = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    for f in FILES:
        html = (ROOT / 'dist' / f).read_text(encoding='utf-8')
        ok_meta = 'http-equiv="Content-Security-Policy"' in html and "default-src 'none'" in html
        print(('PASS ' if ok_meta else 'FAIL ') + f'{f} : CSP présente')
        failures += not ok_meta
        for q in QUERIES:
            pg = b.new_page(viewport={'width': 1280, 'height': 800})  # no CSP bypass: the page's own policy applies
            issues = []
            pg.on('console', lambda m: issues.append(m.text[:140]) if ('Content Security Policy' in m.text or 'Refused to' in m.text) else None)
            pg.on('pageerror', lambda e: issues.append(str(e)[:140]))
            pg.goto((ROOT / 'dist' / f).as_uri() + (('?' + q) if q else ''))
            pg.wait_for_timeout(9000)
            fatal = pg.evaluate("document.getElementById('fatal').classList.contains('on')")
            loaded = pg.evaluate("document.getElementById('loader').classList.contains('done')")
            ok = not issues and not fatal and loaded
            failures += not ok
            print(('PASS ' if ok else 'FAIL ') + f'{f} ?{q or "(aucun)"}' + ('' if ok else f' · fatal={fatal} loaded={loaded} {issues[:2]}'), flush=True)
            pg.close()
    b.close()
print(f'{"OK" if not failures else "ÉCHEC"} : {failures} échec(s)')
sys.exit(1 if failures else 0)
