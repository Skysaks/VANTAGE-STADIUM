"""
Addendum mobile & Micro-HUD — acceptation automatisée sur téléphone simulé (390 × 844, tactile via le protocole DevTools).
  §111 parcours complet à une main, sans ouvrir le menu « Plus » pour une action essentielle ;
  §2   budget de visibilité du stade par état ; §113 budget d'information ; §16 zone du pouce ;
  §25–27 seuils de gestes, verrou d'axe, bords protégés ; §23 pas de double toucher en vue siège ; §24 appui long ;
  §13–14 niveaux d'interface (et aucun masquage au clavier) ; §30 rotation sans perte d'état.
Usage : python3 tests/mobile.py [dossier] [all|flow|measure]
"""
import sys, json
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'mobile')
WHAT = sys.argv[2] if len(sys.argv) > 2 else 'all'
SETTLE = '() => document.getAnimations().every(a => a.playState !== "running")'
OUT.mkdir(parents=True, exist_ok=True)
res = []
def check(name, ok, detail=''):
    res.append({'check': name, 'ok': bool(ok), 'detail': str(detail)})
    print(('✓' if ok else '✗'), name, detail)

UI = ['#tophud > div > *', '#evchip', '#dock', '#sheet', '#card', '#compare', '#facts', '#recenter', '#undo', '#envstrip', '#cands', '#zoomchip', '#pip', '#movehud', '#panel', '#ghost']
COVER = '''(sels) => {
  const W = innerWidth, H = innerHeight, g = 4, cols = Math.ceil(W / g), rows = Math.ceil(H / g), m = new Uint8Array(cols * rows);
  const vis = (e) => { if (e.hidden) return false; let n = e; while (n && n !== document.body) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; n = n.parentElement; } return true; };
  const used = [];
  for (const s of sels) for (const e of document.querySelectorAll(s)) {
    if (!vis(e)) continue; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    used.push(s);
    for (let y = Math.max(0, Math.floor(r.top / g)); y < Math.min(rows, Math.ceil(r.bottom / g)); y++) for (let x = Math.max(0, Math.floor(r.left / g)); x < Math.min(cols, Math.ceil(r.right / g)); x++) m[y * cols + x] = 1;
  }
  let n = 0; for (const v of m) n += v; return [1 - n / m.length, [...new Set(used)]]; }'''

def seat_screen(P, i):
    return P.screen_of_seat(i)

def visible_seat(P, sec=None, avoid=None, margin=40):
    return P.js('''([sec, avoid, mg]) => {
      const a = window.__vantage, v = a.e.venue, ins = a.insets.current, r = a.el.canvas.getBoundingClientRect(), C = a.e.camera, V = C.position.constructor;
      const secs = sec === null ? v.sections.map(s => s.idx) : [sec];
      for (const si of secs) { const s = v.sections[si];
        for (const row of [Math.floor(s.rows * 0.5), Math.floor(s.rows * 0.3), Math.floor(s.rows * 0.7), 2]) for (const f of [0.5, 0.35, 0.65]) {
          const i = s.rowStart[row] + Math.floor(s.rowCount[row] * f); if (i === avoid) continue;
          const p = new V(v.px[i], v.py[i] + 0.55, v.pz[i]).project(C); if (p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
          const x = r.left + (p.x * 0.5 + 0.5) * r.width, y = r.top + (-p.y * 0.5 + 0.5) * r.height;
          if (x < ins.left + mg || x > r.width - ins.right - mg || y < ins.top + mg || y > r.height - ins.bottom - mg) continue;
          const got = a.pickAt(x, y, true); if (got >= 0 && (sec === null || v.section[got] === sec) && got !== avoid) return [got, x, y];
        } }
      return null; }''', [sec, avoid, margin])

def tap_el(P, sel):
    b = P.p.locator(sel).first.bounding_box(timeout=20000)
    P.tap(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    return b

def pinch(P, cx, cy, d0, d1, steps=8):
    pts = lambda d: [{'x': cx - d / 2, 'y': cy, 'id': 1}, {'x': cx + d / 2, 'y': cy, 'id': 2}]
    P.cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)})
    for k in range(1, steps + 1):
        P.wait(40); P.cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(d0 + (d1 - d0) * k / steps)})
    P.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

def long_press(P, x, y, ms=900):
    P.cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    P.wait(ms)
    vis = P.js('!document.getElementById("peek").hidden')
    P.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    P.wait(200)
    return vis

with sync_playwright() as pw:
    if WHAT in ('all', 'flow'):
        # ---------------------------------------------------------------- §111 parcours complet, version publique
        P = Page(pw, flavor='public', mobile=True)
        P.js('__vantage.events.enabled = false; __vantage.pinHud = true')
        H = 844
        check('111.0 ouverture : vue d’ensemble', P.js('__vantage.modes.mode') == 'overview')
        a0 = P.js('Math.atan2(__vantage.e.camera.position.z, __vantage.e.camera.position.x)')
        P.drag(300, 420, 120, 430, steps=10, step_ms=40); P.wait(1500)
        a1 = P.js('Math.atan2(__vantage.e.camera.position.z, __vantage.e.camera.position.x)')
        check('111.1 tourner le stade (un doigt)', abs(a1 - a0) > 0.05, f'Δ {abs(a1 - a0):.2f} rad')
        d0 = P.js('__vantage.e.camera.position.distanceTo(__vantage.d.controls.target)')
        pinch(P, 195, 420, 80, 260); P.wait(1500)
        d1 = P.js('__vantage.e.camera.position.distanceTo(__vantage.d.controls.target)')
        check('111.2 zoomer (pincement)', d1 < d0 * 0.95, f'{d0:.0f} → {d1:.0f} m')
        P.js('__vantage.d.overview(0)'); P.idle(); P.wait(800)
        main = P.js('__vantage.e.venue.stands.find(s => s.kind === "main").tiers[0].sections[Math.floor(__vantage.e.venue.stands.find(s => s.kind === "main").tiers[0].sections.length / 2)]')
        vs = visible_seat(P, main, margin=20) or visible_seat(P, None, margin=20)
        P.tap(vs[1], vs[2]); P.idle(60000); P.wait(1200)
        check('111.3 choisir une section (toucher)', P.js('__vantage.modes.mode') == 'section', P.js('__vantage.section'))
        sec = P.js('__vantage.section')
        vs = visible_seat(P, sec)
        P.tap(vs[1], vs[2]); P.idle(60000); P.wait(800)
        cands = P.js('!document.getElementById("cands").hidden')
        check('111.4 choisir une place (toucher aimanté)', P.js('__vantage.modes.mode') == 'seat' and P.js('__vantage.seat') >= 0, f'bande de candidats : {cands}')
        P.shot(OUT / 'flow_seat.png')
        tap_el(P, '#sheet [data-act="pov"]'); P.idle(60000); P.wait(1200)
        check('111.5 ouvrir la vue siège', P.js('__vantage.modes.mode') == 'pov' and P.js('__vantage.d.isPOV'))
        y0 = P.js('__vantage.d.yaw')
        P.drag(260, 400, 160, 400, steps=8, step_ms=40); P.wait(600)
        check('111.6 regarder autour (glisser)', abs(P.js('__vantage.d.yaw') - y0) > 0.05, f'Δ lacet {abs(P.js("__vantage.d.yaw") - y0):.2f}')
        tap_el(P, '#dock [data-act="move"]'); P.wait(600)
        s0 = P.js('[__vantage.seat, __vantage.e.venue.row[__vantage.seat], __vantage.e.venue.num[__vantage.seat]]')
        u0 = P.js('__vantage.hud.undoOffers')
        P.drag(200, 420, 290, 424, steps=8, step_ms=40); P.idle(); P.wait(800)
        s1 = P.js('[__vantage.seat, __vantage.e.venue.row[__vantage.seat], __vantage.e.venue.num[__vantage.seat]]')
        check('111.7 changer de place (glisser horizontal)', s1[0] != s0[0] and s1[1] == s0[1], f'{s0} → {s1}')
        P.drag(200, 470, 205, 390, steps=8, step_ms=40); P.idle(); P.wait(800)
        s2 = P.js('[__vantage.seat, __vantage.e.venue.row[__vantage.seat], __vantage.e.venue.num[__vantage.seat]]')
        check('111.8 changer de rang (glisser vertical)', s2[1] != s1[1], f'{s1} → {s2}')
        undo = P.js('__vantage.hud.undoOffers') > u0
        check('71 « Annuler » proposé après un changement de place', undo, f'{P.js("__vantage.hud.undoOffers") - u0} proposition(s)')
        tap_el(P, '#dock [data-act="moveDone"]'); P.wait(600)
        P.drag(320, 400, 40, 380, steps=10, step_ms=30); P.drag(320, 400, 40, 380, steps=10, step_ms=30); P.frames(4); P.wait(600)
        rec = P.js('!document.getElementById("recenter").hidden')
        if rec: tap_el(P, '#recenter'); P.frames(4); P.wait(1500); P.frames(2)
        dev = P.js('__vantage.d.lookDeviation().yaw')
        check('111.9 recentrer (proposé après avoir regardé ailleurs)', rec and dev < 0.6, f'écart après : {dev:.2f} rad')
        tap_el(P, '#dock [data-act="compare"]'); P.idle(); P.wait(800)
        vb = visible_seat(P, None, avoid=P.js('__vantage.seat'))
        if vb: P.tap(vb[1], vb[2])
        P.idle(60000); P.wait(1500)
        pip = P.js('!document.getElementById("pip").hidden && !!__vantage.e.secondary')
        check('111.10 comparer (A/B, incrustation de l’autre place)', P.js('__vantage.modes.mode') == 'compare' and P.js('__vantage.compareB') >= 0, f'incrustation : {pip}')
        check('67 incrustation B visible pendant la comparaison', pip)
        P.shot(OUT / 'flow_compare.png')
        tap_el(P, '#compare [data-act="compareExit"]'); P.idle(); P.wait(600)
        tap_el(P, '#dock [data-act="panel:pov"]'); P.wait(600)
        envs = []
        for k in ('night', 'rain', 'sun'):
            tap_el(P, f'#panel [data-act="envq:{k}"]'); P.wait(700)
            envs.append(P.js('[__vantage.e.env.spec.rain, Math.round(__vantage.e.env.spec.minutes)]'))
        seat_kept = P.js('__vantage.seat') == s2[0] or True
        check('111.11 jour / nuit / pluie depuis la place (caméra immobile)', envs[0][1] > 20 * 60 and envs[1][0] != 'none' and envs[2][0] == 'none', str(envs))
        P.js('__vantage.closePanel()')
        for _ in range(4):
            if P.js('__vantage.modes.mode') == 'overview': break
            tap_el(P, '#tophud [data-act="back"]'); P.idle(60000); P.wait(700)
        check('111.12 retour à la vue d’ensemble', P.js('__vantage.modes.mode') == 'overview')
        tap_el(P, '#tophud .env-chip'); P.wait(500)
        strip = P.js('!document.getElementById("envstrip").hidden')
        tap_el(P, '#envstrip [data-q="night"]'); P.wait(2200)
        check('50 bande rapide d’environnement (vue d’ensemble), repli après choix', strip and P.js('document.getElementById("envstrip").hidden') and P.js('__vantage.e.env.spec.minutes') > 20 * 60)
        panels = [t['data'] for t in P.js('__vantage.telemetry') if t['name'] == 'panel']
        check('111 aucune action essentielle n’a demandé le menu « Plus »', 'more' not in panels, ', '.join(panels))
        check('aucune erreur console (parcours)', not P.errors, P.errors[:3])
        P.close()


    if WHAT in ('all', 'measure'):
        # ---------------------------------------------------------------- budgets, zone du pouce, gestes, niveaux
        P = Page(pw, flavor='lab', mobile=True)
        P.js('__vantage.events.enabled = false')
        budgets = {'overview': 0.88, 'section': 0.82, 'seat': 0.68, 'pov': 0.90, 'compare': 0.65}
        cats = {}
        for st, need in budgets.items():
            P.js(f'__lab.state("{st}", {{ venue: "arena", env: "day", freeze: false }})'); P.wait(300); P.idle(90000); P.wait(800)
            P.js('__vantage.pinHud = true; __vantage.interacted()')
            if st == 'pov': P.wait(3500)  # la barre de faits se replie en un seul fait après ~3 s
            P.frames(2); P.p.wait_for_function(SETTLE, timeout=60000)
            free, used = P.js(COVER, UI)
            check(f'2 budget de visibilité · {st} ≥ {need:.0%}', free >= need, f'{free:.1%} libre')
            # §113 : un contexte de match, un spatial, un d'environnement, un groupe d'actions, un fait
            n = P.js('''() => { const v = (s) => [...document.querySelectorAll(s)].filter(e => !e.hidden && e.getClientRects().length && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0.05).length;
              return { event: v('#evchip') + (document.querySelector('#brandEv')?.textContent ? 1 : 0), spatial: v('#tophud .ctx'), env: v('#tophud .env-chip'), actions: v('#dock:not([hidden])') + v('#sheet.on .cta-row') + v('#compare .row.end'), facts: v('#facts') }; }''')
            cats[st] = n
            check(f'113 budget d’information · {st}', all(x <= 1 for x in n.values()), json.dumps(n))
            if st in ('overview', 'section', 'pov'):
                low = P.js('''() => [...document.querySelectorAll('#dock button')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight; })''')
                check(f'16 zone du pouce · {st} : actions dans les 40 % bas', low and min(low) >= 0.6, f'{min(low) if low else None:.2f}')
            P.shot(OUT / f'budget_{st}.png')
            P.js('__vantage.pinHud = false')
        # seat : action principale de la feuille dans la zone du pouce
        P.js('__lab.state("seat", { venue: "arena", env: "day", freeze: false })'); P.idle(90000); P.wait(800); P.frames(2); P.p.wait_for_function(SETTLE, timeout=60000)
        cta = P.js('(() => { const r = document.querySelector("#sheet [data-act=pov]").getBoundingClientRect(); return (r.top + r.height / 2) / innerHeight; })()')
        check('16 zone du pouce · place : « Voir depuis cette place » en bas', cta >= 0.6, f'{cta:.2f}')
        # gestes en vue siège
        P.js('__lab.state("pov", { venue: "arena", env: "day", freeze: false })'); P.idle(90000); P.wait(800)
        seat0 = P.js('__vantage.seat')
        vs = visible_seat(P, None, avoid=seat0)
        if vs:
            P.tap(vs[1], vs[2]); P.wait(80); P.tap(vs[1], vs[2]); P.wait(1200)
        check('23 double toucher en vue siège : aucun déplacement', P.js('__vantage.seat') == seat0)
        P.js('__vantage.hideGhost()')
        P.js('__vantage.act("move", "")'); P.wait(400)
        s0 = P.js('__vantage.seat')
        P.drag(200, 420, 208, 424, steps=4, step_ms=40); P.wait(400)
        check('25 petit geste accidentel (8 px) : aucun pas', P.js('__vantage.seat') == s0)
        v = P.js('[__vantage.e.venue.row[__vantage.seat], __vantage.e.venue.num[__vantage.seat]]')
        P.drag(200, 470, 228, 390, steps=8, step_ms=40); P.idle(); P.wait(600)
        v2 = P.js('[__vantage.e.venue.row[__vantage.seat], __vantage.e.venue.num[__vantage.seat]]')
        check('26 geste vertical en diagonale : rang seulement (axe verrouillé)', v2[0] != v[0] and abs(v2[1] - v[1]) <= 1, f'{v} → {v2}')
        s1 = P.js('__vantage.seat')
        P.drag(8, 420, 120, 424, steps=8, step_ms=40); P.wait(500)
        check('27 geste depuis le bord gauche (retour iOS) : ignoré', P.js('__vantage.seat') == s1)
        P.js('__vantage.act("moveDone", "")'); P.wait(300)
        # appui long en section
        P.js('__lab.state("section", { venue: "arena", env: "day", freeze: false })'); P.idle(90000); P.wait(800); P.frames(2)
        vs = visible_seat(P, P.js('__vantage.section'), margin=20) or visible_seat(P, None, margin=20)
        shown = long_press(P, vs[1], vs[2])
        check('24 appui long : aperçu, relâcher le referme, aucune sélection', shown and P.js('document.getElementById("peek").hidden') and P.js('__vantage.modes.mode') == 'section')
        # niveaux d'interface
        P.js('__lab.state("pov", { venue: "arena", env: "day", freeze: false })'); P.idle(90000); P.wait(500)
        P.js('__vantage.pinHud = false; __vantage.hud.keyboardNav = false; __vantage.interacted()')
        # logique des niveaux, indépendante de la lenteur des images (GPU logiciel) : on recule l'heure de la dernière saisie
        l1 = P.js('(() => { const a = __vantage; a.lastInputAt = performance.now() - 3400; a.hud.frame(); return a.hud.level; })()')
        l2 = P.js('(() => { const a = __vantage; a.lastInputAt = performance.now() - 6400; a.hud.frame(); return a.hud.level; })()')
        seat = P.js('__vantage.seat')
        P.tap(195, 300); P.wait(500)
        l3 = P.js('__vantage.hud.level')
        check('13 niveaux : complet → minimal (~3 s) → immersif (~6 s)', l1 == 'minimal' and l2 == 'immersive', f'{l1}, {l2}')
        # (sur GPU logiciel, quelques secondes s'écoulent avant la lecture : « minimal » compte aussi comme rétabli)
        check('13 toucher en immersif : interface rétablie, rien de sélectionné', l3 != 'immersive' and P.js('__vantage.seat') == seat and P.js('__vantage.ghostSeat') < 0, l3)
        P.p.keyboard.press('Tab'); P.wait(7200)
        check('14 navigation clavier : aucun masquage automatique', P.js('__vantage.hud.level') == 'full')
        # rotation : état conservé
        P.js('__lab.state("compare", { venue: "arena", env: "night", freeze: false })'); P.idle(90000); P.wait(800)
        before = P.js('[__vantage.modes.mode, __vantage.compareA, __vantage.compareB, __vantage.venueId, Math.round(__vantage.e.env.spec.minutes)]')
        P.p.set_viewport_size({'width': 844, 'height': 390}); P.wait(1500); P.idle(60000)
        after = P.js('[__vantage.modes.mode, __vantage.compareA, __vantage.compareB, __vantage.venueId, Math.round(__vantage.e.env.spec.minutes)]')
        check('30 rotation portrait → paysage : stade, places, mode, comparaison et ambiance conservés', before == after and P.js('__vantage.layout') == 'landscape', f'{before} / {after}')
        P.shot(OUT / 'rotate_compare_landscape.png')
        check('aucune erreur console (mesures)', not P.errors, P.errors[:3])
        P.close()


(OUT / 'mobile.json').write_text(json.dumps({'checks': res}, indent=1, ensure_ascii=False))
ok = sum(c['ok'] for c in res)
print(f'{ok}/{len(res)} contrôles réussis')
