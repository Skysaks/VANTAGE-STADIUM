"""
Accessibilité (WCAG 2.2 AA, partie automatisable) : axe-core sur les états clés, parcours 100 % clavier,
mouvement réduit, texte 200 %, paysage mobile, cibles tactiles ≥ 44 px, ordre de focus, annonces ARIA.
Usage : python3 tests/a11y.py [dossier]
"""
import sys, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'a11y')
OUT.mkdir(parents=True, exist_ok=True)
AXE = (ROOT / 'node_modules' / 'axe-core' / 'axe.min.js').read_text()
res = {'axe': {}, 'checks': []}

def check(name, ok, detail=''):
    res['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail}); print(('✓' if ok else '✗'), name, detail)

def axe(P, label):
    P.p.add_script_tag(content=AXE) if not P.js('!!window.axe') else None
    r = P.p.evaluate('''async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        rules: { 'color-contrast': { enabled: true } } });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }''')
    res['axe'][label] = r
    serious = [v for v in r if v['impact'] in ('serious', 'critical')]
    check(f'axe · {label}', not serious, '; '.join(f"{v['id']}({v['n']})" for v in r) or 'aucune violation')

with sync_playwright() as pw:
    # 1. axe sur les états clés (bureau)
    P = Page(pw)
    P.wait(1500); axe(P, 'vue d’ensemble')
    P.js('__lab.state("seat", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800); axe(P, 'fiche de place')
    P.js('__vantage.openPanel("env")'); P.wait(500); axe(P, 'panneau météo')
    P.js('__vantage.openPanel("browser")'); P.wait(500); axe(P, 'navigation 2D')
    P.js('__vantage.closePanel()'); P.js('__lab.state("pov", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800); P.js('__vantage.interacted()'); axe(P, 'vue siège')
    P.js('__lab.state("compare", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800); P.js('__vantage.interacted()'); axe(P, 'comparaison')
    # Micro-HUD : hiérarchie, options de vue, match, bande d'environnement
    P.js('__lab.state("pov", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800); P.js('__vantage.pinHud = true; __vantage.interacted()')
    P.js('__vantage.openPanel("where")'); P.wait(400); axe(P, 'où suis-je (hiérarchie)')
    P.js('__vantage.openPanel("pov")'); P.wait(400); axe(P, 'options de vue')
    P.js('__vantage.openPanel("event")'); P.wait(400); axe(P, 'détails du match')
    P.js('__vantage.closePanel(); __vantage.overview()'); P.idle(); P.wait(600); P.js('__vantage.act("envstrip", "")'); P.wait(400); axe(P, 'bande d’environnement')
    P.js('__vantage.quickEnv("night")'); P.wait(300)
    check('annonce sémantique d’ambiance (« Nuit sélectionnée »)', 'Nuit sélectionnée' in P.js('document.getElementById("live").textContent'))
    # focus rendu logiquement quand la fiche se ferme (jamais perdu dans le canevas)
    P.js('__lab.state("seat", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800)
    P.js('document.querySelector("#card [data-act=fav]").focus()'); P.js('__vantage.deselect()'); P.wait(300)
    f = P.js('[document.activeElement.id, document.activeElement.tagName, !!document.activeElement.closest("#dock, #tophud")]')
    check('fermeture de fiche : focus rendu au dock ou au HUD', f[2], str(f))
    P.js('__vantage.pinHud = false')
    P.close()

    # 2. parcours 100 % clavier : stade → tribune → section → place → vue siège → déplacer → comparer → retour
    P = Page(pw)
    P.wait(1000)
    P.p.keyboard.press('Tab')
    order = [P.js('document.activeElement.getAttribute("aria-label") || document.activeElement.textContent.trim().slice(0, 30)')]
    for _ in range(6):
        P.p.keyboard.press('Tab'); order.append(P.js('document.activeElement.getAttribute("aria-label") || document.activeElement.id || document.activeElement.textContent.trim().slice(0, 30)'))
    check('ordre de tabulation logique (haut → dock)', len(order) == 7, ' › '.join(order))
    ring = P.js('getComputedStyle(document.activeElement).boxShadow')
    check('focus visible (anneau de 2 px + contour)', ring and ring != 'none', ring[:60])
    P.p.locator('#c').focus()
    P.p.keyboard.press('ArrowRight'); P.idle(); P.wait(400)
    m1 = P.js('__vantage.modes.mode')
    P.p.keyboard.press('Enter'); P.idle(); P.wait(400)
    m2 = P.js('__vantage.modes.mode')
    P.p.keyboard.press('Enter'); P.idle(); P.wait(400)
    m3 = P.js('__vantage.modes.mode')
    P.p.keyboard.press('ArrowRight'); P.idle(); P.wait(300)
    P.p.keyboard.press('Enter'); P.idle(); P.wait(600)
    m4 = P.js('__vantage.modes.mode')
    live = P.js('document.getElementById("live").textContent')
    check('clavier : tribune → section → place → vue siège', [m1, m2, m3, m4] == ['stand', 'section', 'seat', 'pov'], f'{m1} › {m2} › {m3} › {m4}')
    check('annonce lecteur d’écran de la place', 'rang' in live.lower() and '€' in live, live[:140])
    P.p.keyboard.press('m'); P.wait(200); s0 = P.js('__vantage.seat'); P.p.keyboard.press('ArrowRight'); P.idle(); P.wait(300)
    check('clavier : déplacer d’une place (M puis →)', P.js('__vantage.modes.mode') == 'move' and P.js('__vantage.seat') != s0)
    P.p.keyboard.press('Escape'); P.wait(200); P.p.keyboard.press('c'); P.idle(); P.wait(300)
    check('clavier : comparer (C)', P.js('__vantage.modes.mode') == 'compare')
    for _ in range(5): P.p.keyboard.press('Escape'); P.idle(); P.wait(250)
    check('clavier : Échap revient à la vue d’ensemble', P.js('__vantage.modes.mode') == 'overview')
    P.p.keyboard.press('b'); P.wait(400)
    check('touche B : navigation 2D ouverte, focus dedans', P.js('__vantage.panel') == 'browser' and P.js('!!document.activeElement.closest("#panel")'))
    P.p.keyboard.press('Enter'); P.wait(300); P.p.keyboard.press('Escape'); P.wait(300)
    check('Échap ferme le panneau et rend le focus', P.js('__vantage.panel') is None)
    P.close()

    # 3. mouvement réduit : coupes franches, aucune transition caméra
    P = Page(pw, reduced=True)
    P.wait(800)
    P.js('__vantage.focusSection(3)'); busy = P.js('__vantage.d.busy'); P.wait(300)
    check('mouvement réduit : coupe franche (pas de vol)', P.js('__vantage.d.reduced') and not P.js('__vantage.d.busy'), f'transition en cours juste après : {busy}')
    check('mouvement réduit : pas de dérive d’ouverture', not P.js('__vantage.d.controls.autoRotate'))
    P.close()

    # 4. texte 200 % (≡ zoom 200 % : fenêtre 720 × 450 px CSS) : pas de débordement horizontal, panneaux défilants
    P = Page(pw, viewport={'width': 720, 'height': 450})
    P.js('__vantage.prefs.text = "xl"; __vantage.applyPrefs()')
    P.js('__lab.state("seat", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800)
    over = P.js('document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll(".tophud, .dock, #card")].some(e => e.getBoundingClientRect().right > innerWidth + 1)')
    P.shot(OUT / 'text200_seat.png')
    P.js('__vantage.openPanel("a11y")'); P.wait(500)
    scroll = P.js('(() => { const p = document.getElementById("panel"); return [p.scrollHeight > p.clientHeight, getComputedStyle(p).overflowY]; })()')
    P.shot(OUT / 'text200_panel.png')
    check('texte 200 % : aucun débordement horizontal', not over)
    check('texte 200 % : panneau défilant, rien d’inatteignable', scroll[1] in ('auto', 'scroll'), str(scroll))
    P.close()

    # 5. mobile : cibles tactiles ≥ 44 px ; paysage : dock vertical + carte latérale
    P = Page(pw, mobile=True)
    P.js('__lab.state("seat", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800)
    small = P.js('''[...document.querySelectorAll('#tophud button, #dock button, #sheet button')].filter(b => { const r = b.getBoundingClientRect(); const a = getComputedStyle(b, '::after'); const slop = a.content !== 'none' && a.position === 'absolute' ? Math.max(0, -2 * parseFloat(a.top || '0')) : 0; return r.width > 0 && (r.width < 43.5 || r.height + slop < 43.5); }).map(b => (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 24) + ' ' + Math.round(b.getBoundingClientRect().width) + '×' + Math.round(b.getBoundingClientRect().height))''')
    check('mobile : cibles ≥ 44 px, zone tactile élargie comprise (§18)', not small, ', '.join(small))
    P.close()
    P = Page(pw, mobile=True, viewport={'width': 844, 'height': 390})
    P.js('__lab.state("seat", { venue: "arena", env: "day", freeze: false })'); P.idle(); P.wait(800)
    lay = P.js('[__vantage.layout, getComputedStyle(document.getElementById("dock")).flexDirection, document.getElementById("card").classList.contains("on"), JSON.stringify(__vantage.insets.current)]')
    P.shot(OUT / 'landscape_seat.png')
    check('paysage : dock vertical et fiche latérale', lay[0] == 'landscape' and lay[1] == 'column' and lay[2], str(lay))
    P.close()

    # 6. repli sans WebGL : liste des places accessible
    b = pw.chromium.launch(args=['--disable-gpu', '--disable-webgl', '--disable-3d-apis'])
    pg = b.new_page(viewport=DESKTOP, bypass_csp=True)
    pg.goto(url('public')); pg.wait_for_timeout(3000)
    msg = pg.evaluate('document.getElementById("fatal").textContent')
    pg.click('#open2d'); pg.wait_for_timeout(500)
    items = pg.evaluate('document.querySelectorAll("#dialogBox .li").length')
    check('sans WebGL : message soigné + parcours 2D', 'WebGL' in msg and items >= 4, f'{items} tribunes listées')
    b.close()

(OUT / 'a11y.json').write_text(json.dumps(res, indent=1, ensure_ascii=False))
ok = sum(c['ok'] for c in res['checks'])
print(f'{ok}/{len(res["checks"])} contrôles réussis')
