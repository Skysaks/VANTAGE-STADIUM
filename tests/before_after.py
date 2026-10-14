"""
Avant / après : mêmes stades, mêmes places, même heure que la mesure de départ (docs/baseline), rendus par la version actuelle.
Produit docs/before_after.png (gauche : départ, droite : actuel) et docs/before_after.json.
"""
import sys, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *
from PIL import Image, ImageDraw

BASE = ROOT / 'docs' / 'baseline'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'after')
OUT.mkdir(parents=True, exist_ok=True)
MAP = {'A': 'arena', 'B': 'compact', 'C': 'grand', 'D': 'olympic'}
data = {}
with sync_playwright() as pw:
    P = Page(pw, viewport={'width': 1280, 'height': 800})
    P.js("document.getElementById('app').dataset.capture = '1'")
    P.js('__vantage.events.enabled = false')
    for k, vid in MAP.items():
        P.js(f'__lab.state("overview", {{ venue: "{vid}", env: "night", freeze: false }})'); P.idle(90000); P.wait(1200)
        P.js('__vantage.e.timeScale = 0'); P.shot(OUT / f'{k}_overview.png'); P.js('__vantage.e.timeScale = 1')
        ov = P.js('({...__vantage.e.diag})')
        P.js('''(() => { const a = __vantage, v = a.e.venue; const sec = v.sections.find((s) => s.tier === 0 && v.stands[s.stand].kind === 'main' && s.indexInStand === 2);
          const i = sec.rowStart[Math.floor(sec.rows * 0.5)] + 5; a.gotoSeat(i, { instant: true }); })()''')
        P.idle(); P.wait(1200); P.js('__vantage.e.timeScale = 0'); P.shot(OUT / f'{k}_pov.png'); P.js('__vantage.e.timeScale = 1')
        pv = P.js('({...__vantage.e.diag})')
        data[k] = {'venue': vid, 'overview': ov, 'pov': pv}
        print(k, vid, ov['calls'], ov['triangles'], pv['calls'])
    P.close()
base = json.loads((BASE / 'baseline.json').read_text())
(ROOT / 'docs' / 'before_after.json').write_text(json.dumps({'before': {k: base[k] for k in MAP}, 'after': data}, indent=1))

W, H = 640, 400
sheet = Image.new('RGB', (W * 2 + 30, (H * 2 + 20) * 4 + 60), (7, 9, 12))
d = ImageDraw.Draw(sheet)
d.text((W // 2 - 40, 15), 'AVANT (moteur v2)', fill=(200, 200, 200)); d.text((W + 30 + W // 2 - 40, 15), 'APRES (v3)', fill=(255, 120, 90))
y = 50
for k in MAP:
    for view in ('overview', 'pov'):
        a = Image.open(BASE / f'{k}_{view}.png').convert('RGB').resize((W, H))
        b = Image.open(OUT / f'{k}_{view}.png').convert('RGB').resize((W, H))
        sheet.paste(a, (0, y)); sheet.paste(b, (W + 30, y))
        d.text((8, y + 6), f'{MAP[k]} · {view}', fill=(255, 255, 255))
        y += H + 10
    y += 0
sheet.convert('RGB').save(ROOT / 'docs' / 'before_after.jpg', quality=82, optimize=True)
print('docs/before_after.jpg')
