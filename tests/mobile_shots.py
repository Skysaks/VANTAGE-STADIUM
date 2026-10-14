"""
§112 — captures de référence mobiles : 390 × 844 et 430 × 932 (10 écrans), 844 × 390 (vue siège, comparaison, révélation).
États déterministes (`__lab.state`), interface visible (niveau complet), animations figées au moment de la capture.
Produit <dossier>/*.png, <dossier>/report.json et docs/mobile_reference.jpg (planche).
"""
import sys, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *
from PIL import Image, ImageDraw

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'mobile_ref')
OUT.mkdir(parents=True, exist_ok=True)
report = []
SCREENS = [('overview_day', 'overview', 'day'), ('overview_night', 'overview', 'night'), ('seat', 'seat', 'day'), ('pov_day', 'pov', 'day'),
           ('pov_night', 'pov', 'night'), ('pov_rain', 'exposed', 'rain', 'classic'), ('move', 'move', 'day'), ('compare', 'compare', 'day'), ('envctl', 'pov', 'golden'), ('reveal', 'reveal', 'night')]
LAND = [('pov', 'pov', 'day'), ('compare', 'compare', 'day'), ('reveal', 'reveal', 'night')]

def cap(P, tag, name, state, env, venue='arena'):
    P.js(f'__lab.state("{state}", {{ venue: "{venue}", env: "{env}", freeze: false }})')
    # la révélation occupe la caméra jusqu'à sa fin : on capture en plein vol, sans attendre le repos
    if state == 'reveal': P.p.wait_for_function('window.__vantage.reveal.playing', timeout=60000); P.wait(1200)
    else: P.wait(300); P.idle(90000); P.wait(900)
    P.js('__vantage.pinHud = true; __vantage.interacted()')
    if name == 'envctl': P.js('__vantage.act("envstrip", "")'); P.wait(400)
    if state != 'reveal': P.js('__vantage.e.timeScale = 0')
    path = OUT / f'{tag}_{name}.png'
    if state == 'reveal':
        # pendant le vol (horloge murale) : capture directe, sans attendre d'images supplémentaires
        P.p.wait_for_function("window.__vantage.modes.mode === 'reveal'", timeout=60000)
        P.p.screenshot(path=str(path), timeout=240000)
    else:
        P.shot(path)
    P.js('__vantage.e.timeScale = 1')
    r = {'shot': f'{tag}_{name}', 'mode': P.js('__vantage.modes.mode'), 'ui': P.js('__vantage.hud.level'), 'errors': P.errors[:2]}
    report.append(r); print(r)
    if state == 'reveal': P.p.wait_for_function('!window.__vantage.reveal.playing', timeout=120000)
    P.js('__vantage.pinHud = false; __vantage.closePanel(); __vantage.hud.closeEnvStrip(false)')

ONLY = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
if ONLY:
    SCREENS = [x for x in SCREENS if x[0] in ONLY]; LAND = [x for x in LAND if x[0] in ONLY]
with sync_playwright() as pw:
    for tag, vp in (('390', {'width': 390, 'height': 844}), ('430', {'width': 430, 'height': 932})):
        P = Page(pw, mobile=True, viewport=vp, nominal=True)
        P.js('__vantage.events.enabled = false')
        for x in SCREENS: cap(P, tag, *x)
        P.close()
    P = Page(pw, mobile=True, viewport={'width': 844, 'height': 390}, nominal=True)
    P.js('__vantage.events.enabled = false')
    for x in LAND: cap(P, '844', *x)
    P.close()

old = json.loads((OUT / 'report.json').read_text()) if ONLY and (OUT / 'report.json').exists() else []
report = [r for r in old if r['shot'] not in {x['shot'] for x in report}] + report
(OUT / 'report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False))
SCREENS = [('overview_day', 0, 0), ('overview_night', 0, 0), ('seat', 0, 0), ('pov_day', 0, 0), ('pov_night', 0, 0), ('pov_rain', 0, 0), ('move', 0, 0), ('compare', 0, 0), ('envctl', 0, 0), ('reveal', 0, 0)]
LAND = [('pov', 0, 0), ('compare', 0, 0), ('reveal', 0, 0)]
# planche : deux rangées portrait (390), une rangée paysage
th = 300
rows = []
for tag in ('390', '430'):
    ims = [Image.open(OUT / f'{tag}_{n}.png').convert('RGB') for n, _, _ in SCREENS]
    rows.append([im.resize((round(im.width * th * 2 / im.height), th * 2)) for im in ims])
land = [Image.open(OUT / f'844_{n}.png').convert('RGB') for n, _, _ in LAND]
land = [im.resize((round(im.width * th / im.height), th)) for im in land]
W = max(sum(i.width + 8 for i in r) for r in rows + [land]) + 8
H = sum(r[0].height + 34 for r in rows) + land[0].height + 34 + 8
sheet = Image.new('RGB', (W, H), (7, 9, 12)); d = ImageDraw.Draw(sheet)
y = 8
for r, tag in zip(rows + [land], ('390 × 844', '430 × 932', '844 × 390')):
    d.text((10, y), tag, fill=(220, 220, 220)); y += 22
    x = 8
    for im in r: sheet.paste(im, (x, y)); x += im.width + 8
    y += r[0].height + 12
sheet.save(ROOT / 'docs' / 'mobile_reference.jpg', quality=80, optimize=True)
print('docs/mobile_reference.jpg', len(report), 'captures')
