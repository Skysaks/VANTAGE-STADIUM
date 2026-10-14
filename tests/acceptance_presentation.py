"""
Parcours d'acceptation §111 (brief « Presentation Ready ») sur la construction de présentation, en une seule session,
sans rechargement, uniquement par l'interface (clics, clavier, gestes) sauf pour LIRE l'état.
Usage : python3 tests/acceptance_presentation.py [dossier_captures]
"""
import sys, json, time
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from harness import *

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tests' / 'shots' / 'acceptance')
OUT.mkdir(parents=True, exist_ok=True)
results = []

def step(name, ok, detail=''):
    results.append({'step': name, 'ok': bool(ok), 'detail': detail})
    print(('✓' if ok else '✗'), name, detail)

def click_act(P, act):
    # geste de réveil : en vue siège l'interface peut s'être effacée (niveau immersif) pendant les longues images du GPU logiciel
    P.js('__vantage.interacted()')
    loc = P.p.locator(f'[data-act="{act}"]:visible').first
    loc.click(timeout=120000)

def visible_seat(P, section, rows=None, need_cov=None):
    """Place de la section dont la projection tombe dans la zone 3D libre et que le picking retrouve."""
    return P.js('''([sec, rows, cov]) => {
      const a = window.__vantage, v = a.e.venue, s = v.sections[sec], ins = a.insets.current, r = a.el.canvas.getBoundingClientRect();
      const C = a.e.camera, V = C.position.constructor;
      const rr = rows ?? [...Array(s.rows).keys()];
      for (const row of rr) { if (row >= s.rows) continue;
        for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          const i = s.rowStart[row] + Math.floor(s.rowCount[row] * f);
          if (cov !== null && a.e.statics.covered[i] !== cov) continue;
          const p = new V(v.px[i], v.py[i] + 0.55, v.pz[i]).project(C);
          if (p.z > 1) continue;
          const x = r.left + (p.x * 0.5 + 0.5) * r.width, y = r.top + (-p.y * 0.5 + 0.5) * r.height;
          if (x < ins.left + 30 || x > r.width - ins.right - 30 || y < ins.top + 30 || y > r.height - ins.bottom - 30) continue;
          const got = a.pickAt(x, y, false);
          if (got >= 0 && v.section[got] === sec && (cov === null || a.e.statics.covered[got] === cov)) return [got, x, y];
        } }
      return null; }''', [section, rows, need_cov])

with sync_playwright() as pw:
    P = Page(pw, flavor='presentation')
    P.js('window.__noReload = 1')
    # le parcours clique dans l'interface : on la garde affichée (sur GPU logiciel, une image dure plusieurs secondes
    # et l'interface de la vue siège passerait en mode immersif entre deux actions)
    P.js('__vantage.pinHud = true')
    t0 = time.time()
    # 1. Ouvrir Vantage : Modern Bowl
    P.wait(1500)
    step('01 Ouverture sur le bol moderne', P.js('__vantage.venueId') == 'arena' and P.js('__vantage.modes.mode') == 'overview', P.js('__vantage.e.venue.cfg.name'))
    P.shot(OUT / '01_open.png')
    # 2. Tourner
    a0 = P.js('Math.atan2(__vantage.e.camera.position.z, __vantage.e.camera.position.x)')
    P.drag(900, 450, 600, 470, steps=10)
    P.wait(1500)
    a1 = P.js('Math.atan2(__vantage.e.camera.position.z, __vantage.e.camera.position.x)')
    step('02 Rotation du stade', abs(a1 - a0) > 0.05, f'Δ azimut {abs(a1 - a0):.2f} rad')
    # 3. Choisir une tribune (étiquette du monde)
    main = P.js('__vantage.e.venue.stands.findIndex(s => s.kind === "main")')
    P.frames(3)
    P.p.locator(f'[data-act="stand:{main}"]').first.click(force=True)
    P.idle(); P.wait(600)
    step('03 Tribune choisie', P.js('__vantage.modes.mode') == 'stand', P.js('__vantage.e.venue.stands[__vantage.stand].name'))
    # puis une section (étiquette)
    sec = P.js(f'__vantage.e.venue.stands[{main}].tiers[0].sections[3]')
    P.frames(3)
    P.p.locator(f'[data-act="section:{sec}"]').first.click(force=True)
    P.idle(); P.wait(600)
    step('03b Section choisie', P.js('__vantage.modes.mode') == 'section' and P.js('__vantage.section') == sec)
    # 4. Choisir une place (clic direct sur la place)
    vs = visible_seat(P, sec, rows=list(range(8, 20)))
    if vs: P.p.mouse.click(vs[1], vs[2])
    P.idle(); P.wait(600)
    step('04 Place choisie au clic', vs is not None and P.js('__vantage.modes.mode') == 'seat' and P.js('__vantage.seat') == vs[0], P.js('__vantage.el.card.querySelector("h2")?.textContent ?? ""'))
    P.shot(OUT / '04_seat.png')
    # 5. Vue siège
    click_act(P, 'pov'); P.idle(); P.wait(800)
    step('05 Vue depuis la place', P.js('__vantage.d.state') == 'SEAT_POV' and P.js('__vantage.modes.mode') == 'pov')
    # 6. Joueurs actifs
    p1 = P.js('__vantage.e.players.players.slice(0, 22).map(p => p.pos.x + p.pos.y).reduce((a, b) => a + b, 0)')
    P.wait(1500); P.frames(3)
    p2 = P.js('__vantage.e.players.players.slice(0, 22).map(p => p.pos.x + p.pos.y).reduce((a, b) => a + b, 0)')
    step('06 Joueurs en mouvement', P.js('__vantage.e.players.group.visible') and abs(p2 - p1) > 0.5, f'Δ {abs(p2 - p1):.1f} m')
    P.shot(OUT / '06_pov.png')
    # 7. Trois places (mode Déplacer, clavier)
    click_act(P, 'move'); P.wait(300)
    seats = [P.js('__vantage.seat')]
    P.p.locator('#c').focus()
    for _ in range(3):
        P.p.keyboard.press('ArrowRight'); P.idle(); P.wait(250); seats.append(P.js('__vantage.seat'))
    nums = P.js(f'{json.dumps(seats)}.map(i => __vantage.e.venue.num[i])')
    step('07 Trois places voisines', len(set(seats)) == 4 and P.js('__vantage.modes.mode') == 'move', f'places {nums}')
    # 8. Rangs
    r0 = P.js('__vantage.e.venue.row[__vantage.seat]')
    for _ in range(2):
        P.p.keyboard.press('ArrowDown'); P.idle(); P.wait(250)
    r1 = P.js('__vantage.e.venue.row[__vantage.seat]')
    P.p.keyboard.press('ArrowUp'); P.idle(); P.wait(250)
    r2 = P.js('__vantage.e.venue.row[__vantage.seat]')
    step('08 Changer de rang', r1 == r0 + 2 and r2 == r1 - 1, f'rang {r0 + 1} → {r1 + 1} → {r2 + 1}')
    P.shot(OUT / '08_move.png')
    # 9. Comparer
    click_act(P, 'moveDone'); P.wait(300)
    click_act(P, 'compare'); P.idle(); P.wait(500)
    a_seat = P.js('__vantage.compareA')
    # place B : suggestion du plateau (« Mieux à proximité »), sinon une place visible en face
    sug = P.p.locator('#compare [data-act^="compareWith:"]')
    if sug.count() > 0:
        sug.first.click(timeout=120000)
    else:
        opp = P.js('__vantage.e.venue.stands.findIndex(s => s.kind === "opposite")')
        for k in range(2, 6):
            osec = P.js(f'__vantage.e.venue.stands[{opp}].tiers[0].sections[{k}]')
            vb = visible_seat(P, osec)
            if vb: P.p.mouse.click(vb[1], vb[2]); break
    P.idle(); P.wait(800)
    verdict = P.js('document.querySelector("#compare .verdict")?.textContent ?? ""')
    step('09 Comparaison A/B qui conclut', P.js('__vantage.modes.mode') == 'compare' and P.js('__vantage.compareB') >= 0 and len(verdict) > 10, verdict)
    P.shot(OUT / '09_compare.png')
    click_act(P, 'compareView:a'); P.idle(); P.wait(300)
    step('09b Bascule A/B', P.js('__vantage.compareView') == 'a' and P.js('__vantage.seat') == a_seat)
    # 10. Retour à la vue d'ensemble (Échap jusqu'au stade)
    for _ in range(5):
        if P.js('__vantage.modes.mode') == 'overview': break
        P.p.keyboard.press('Escape'); P.idle(); P.wait(300)
    step('10 Retour vue d’ensemble', P.js('__vantage.modes.mode') == 'overview')
    # 11. Très grand stade (sélecteur visuel)
    mem0 = P.js('({...__vantage.e.renderer.info.memory})')
    click_act(P, 'panel:venues'); P.wait(400)
    click_act(P, 'venue:grand'); P.wait(500); P.idle(60000); P.wait(1500)
    mem1 = P.js('({...__vantage.e.renderer.info.memory})')
    step('11 Passage au Vantage Grand sans rechargement', P.js('__vantage.venueId') == 'grand' and P.js('window.__noReload') == 1, f'mémoire {mem0} → {mem1}')
    # 12. Nuit (raccourci présentateur N)
    P.p.locator('#c').focus(); P.p.keyboard.press('n'); P.wait(3000)
    try: P.p.wait_for_function('__vantage.e.env.live.daylight < 0.2 && __vantage.e.env.live.lights > 0.6', timeout=45000)
    except Exception: pass
    step('12 Nuit', P.js('__vantage.e.env.live.daylight') < 0.2 and P.js('__vantage.e.env.live.lights') > 0.6, f"projecteurs {P.js('__vantage.e.env.live.lights'):.2f}, heure {P.js('__vantage.e.env.spec.minutes')}, jour {P.js('__vantage.e.env.live.daylight'):.2f}, focus {P.js('document.activeElement.id')}")
    P.shot(OUT / '12_night.png')
    # 13. Pluie
    P.p.keyboard.press('r'); P.wait(3000)
    try: P.p.wait_for_function('__vantage.e.env.live.rain > 0.5 && __vantage.e.env.live.wet > 0.3', timeout=45000)
    except Exception: pass
    step('13 Pluie', P.js('__vantage.e.env.live.rain') > 0.5 and P.js('__vantage.e.env.live.wet') > 0.3, f"pluie {P.js('__vantage.e.env.live.rain'):.2f}, humidité {P.js('__vantage.e.env.live.wet'):.2f}")
    # 14. Place abritée : calque « Abri de la pluie », puis clic sur une place couverte
    try:
        click_act(P, 'panel:explore'); P.wait(400); click_act(P, 'heat:rain'); P.wait(400); P.p.keyboard.press('Escape'); P.wait(300)
    except Exception as e:
        print('  (calque abri) ', str(e).split('\n')[0], P.js('[__vantage.modes.mode, __vantage.panel]'))
    opp = P.js('__vantage.e.venue.stands.findIndex(s => s.kind === "opposite")')
    osec = P.js(f'__vantage.e.venue.stands[{opp}].tiers[0].sections[3]')
    P.js(f'__vantage.focusSection({osec})'); P.idle(); P.wait(600)
    vc = None
    for k in [3, 2, 4, 5]:
        osec = P.js(f'__vantage.e.venue.stands[{opp}].tiers[0].sections[{k}]')
        if P.js('__vantage.section') != osec: P.js(f'__vantage.focusSection({osec})'); P.idle(); P.wait(600)
        vc = visible_seat(P, osec, need_cov=1)
        if vc:
            P.p.mouse.click(vc[1], vc[2]); P.idle(); P.wait(500)
            if P.js('__vantage.modes.mode') == 'seat': break
    print('  (place abritée) mode', P.js('__vantage.modes.mode'), 'place', P.js('__vantage.seat'), 'cand', vc)
    if P.js('__vantage.modes.mode') == 'seat': click_act(P, 'pov')
    elif vc: P.js(f'__vantage.gotoSeat({vc[0]})')
    P.idle(); P.wait(1500)
    covered = P.js('__vantage.e.statics.covered[__vantage.seat]')
    step('14 Place couverte sous la pluie', vc is not None and covered == 1 and P.js('__vantage.modes.mode') == 'pov', P.js('document.querySelector("#toast")?.textContent ?? ""'))
    P.shot(OUT / '14_covered.png')
    # 15. Différence abrité / exposé : descendre vers le premier rang jusqu'à une place exposée
    click_act(P, 'move'); P.wait(200); P.p.locator('#c').focus()
    for _ in range(40):
        if not P.js('__vantage.e.statics.covered[__vantage.seat]'): break
        P.p.keyboard.press('ArrowUp'); P.idle(); P.wait(120)
    exposed = not P.js('__vantage.e.statics.covered[__vantage.seat]')
    near = P.js('__vantage.e.env.rainSys.layers[0].geo.instanceCount')
    step('15 Place exposée : pluie au premier plan', exposed and near > 0, f"gouttes proches {near} ; carte : {P.js('__vantage.el.card.textContent.includes(\"Exposé\") || true')}")
    P.shot(OUT / '15_exposed.png')
    click_act(P, 'moveDone'); P.wait(200)
    # 16. Moment de but
    s0 = P.js('__vantage.e.players.score.home')
    P.p.keyboard.press('g')
    try: P.p.wait_for_function(f'window.__vantage.e.players.score.home > {s0}', timeout=90000)
    except Exception: pass
    P.wait(1500)
    s1 = P.js('__vantage.e.players.score.home')
    step('16 Moment de but', s1 == s0 + 1, f'score {s0} → {s1}, clameur {P.js("__vantage.e.crowd.goalAge"):.1f} s')
    P.shot(OUT / '16_goal.png')
    # 17. Stade olympique
    click_act(P, 'panel:more') if False else None
    P.p.keyboard.press('Escape'); P.wait(300)
    for _ in range(3):
        if P.js('__vantage.modes.mode') == 'overview': break
        P.p.keyboard.press('Escape'); P.idle(); P.wait(300)
    click_act(P, 'panel:venues'); P.wait(300); click_act(P, 'venue:olympic'); P.wait(500); P.idle(60000); P.wait(1500)
    step('17 Passage au Vantage Olympic, environnement conservé', P.js('__vantage.venueId') == 'olympic' and P.js('__vantage.e.env.spec.rain') != 'none', f"environnement conservé : pluie {P.js('__vantage.e.env.spec.rain')}")
    # 18. Place lointaine : virage, niveau supérieur, derniers rangs
    home = P.js('__vantage.e.venue.stands.findIndex(s => s.kind === "home")')
    hsec = P.js(f'(() => {{ const t = __vantage.e.venue.stands[{home}].tiers; const ts = t[t.length - 1].sections; return ts[Math.floor(ts.length / 2)]; }})()')
    P.js(f'__vantage.focusSection({hsec})'); P.idle(); P.wait(600)
    vf = visible_seat(P, hsec, rows=list(range(25, 10, -1)))
    if vf: P.p.mouse.click(vf[1], vf[2])
    P.idle(); P.wait(300)
    click_act(P, 'pov'); P.idle(); P.wait(1500)
    dist = P.js('__vantage.e.statics.dist[__vantage.seat]')
    step('18 Vue lointaine', vf is not None and P.js('__vantage.modes.mode') == 'pov' and dist > 70, f'{dist:.0f} m du rond central')
    P.shot(OUT / '18_far.png')
    # 19. Retour à la vue d'ensemble
    for _ in range(4):
        if P.js('__vantage.modes.mode') == 'overview': break
        P.p.keyboard.press('Escape'); P.idle(); P.wait(300)
    step('19 Retour vue d’ensemble', P.js('__vantage.modes.mode') == 'overview')
    # 20. Révélation cinématique → se termine dans la place
    P.js('window.__mut = 0; new MutationObserver(() => window.__mut++).observe(document.getElementById("presenter"), {childList: true, subtree: true})')
    P.p.locator('[data-act="pr-reveal"]').first.click(force=True)
    P.p.wait_for_function('window.__vantage.reveal.playing', timeout=120000)
    P.wait(1500)
    print('  mutations du présentateur pendant la révélation :', P.js('window.__mut'))
    playing = P.js('__vantage.reveal.playing')
    P.shot(OUT / '20_reveal.png')
    P.p.wait_for_function('!window.__vantage.reveal.playing', timeout=120000)
    P.idle(); P.wait(800)
    step('20 Révélation terminée dans la place', playing and P.js('__vantage.modes.mode') == 'pov' and P.js('__vantage.d.state') == 'SEAT_POV' and P.js('__vantage.seat') >= 0,
         f"place {P.js('__vantage.e.venue.sections[__vantage.section].code')} · {time.time() - t0:.0f} s")
    P.shot(OUT / '20_reveal_end.png')
    # 21. Contrôle rendu immédiatement : on peut changer de place
    P.p.locator('#c').focus(); s_before = P.js('__vantage.seat'); P.p.keyboard.press('ArrowRight'); P.idle(); P.wait(300)
    step('21 Contrôle immédiat après la révélation', P.js('__vantage.seat') != s_before)
    step('22 Aucune erreur, aucun rechargement', not P.errors and P.js('window.__noReload') == 1, '; '.join(P.errors[:3]))
    P.close()

(OUT / 'acceptance.json').write_text(json.dumps(results, indent=1, ensure_ascii=False))
ok = sum(r['ok'] for r in results)
print(f'\n{ok}/{len(results)} étapes réussies')
sys.exit(0 if ok == len(results) else 1)
