# Tests

Tous les tests pilotent un vrai Chromium (Playwright) sur les fichiers construits (`npm run build`). L'environnement de test utilise un **GPU logiciel** (SwiftShader, 2 cœurs) : une image peut prendre plus d'une seconde. Les volumes (appels de dessin, triangles, mémoire) sont exacts ; les temps d'image n'ont qu'une valeur relative.

Prérequis : `pip install playwright pillow`, Chromium disponible pour Playwright, `npm install` (axe-core).

| Commande | Contenu | Résultat attendu |
|---|---|---|
| `node scripts/build.mjs` | 3 saveurs + licences + **contrôle de séparation** public/présentation/lab | échec si une chaîne de Lab ou de présentateur fuit |
| `python3 tests/csp.py` | sécurité : CSP stricte présente dans les 3 fichiers, aucune violation, liens hostiles (clés du prototype, style ou heure invalides) sans erreur ni écran d'échec | contrôles ✓ |
| `python3 tests/acceptance_presentation.py` | parcours §111 complet sur la version de présentation, une session, sans rechargement, par l'interface | 23 étapes ✓ |
| `python3 tests/canonical.py <dossier> canonical` | 12 écrans canoniques (bureau : vue d'ensemble, section, place, vue siège, comparaison, révélation ; mobile : vue d'ensemble, section, place, vue siège, déplacer, révélation) + paysage + tablette | captures + `report.json` |
| `python3 tests/canonical.py <dossier> matrix` | matrice 5 stades × 5 ambiances (jour, coucher, nuit, pluie, nuit + pluie) | 25 captures |
| `python3 tests/canonical.py <dossier> pov` | vue siège : soleil direct, ombre du toit, projecteurs, pluie exposée, pluie abritée | 5 captures |
| `python3 tests/canonical.py <dossier> deck` | 9 captures de présentation (HUD masqué) | captures |
| `python3 tests/a11y.py` | axe-core (WCAG 2.2 AA) sur 6 états, clavier seul, lecteur d'écran, mouvement réduit, texte 200 %, cibles 44 px, paysage, repli sans WebGL | contrôles ✓ |
| `python3 tests/perf.py` | 5 stades × environnements × profils : appels, triangles, mémoire, temps d'image ; fuite mémoire sur 11 changements | `perf.json` |
| `python3 tests/mobile.py` | addendum mobile : parcours §111 tactile (version publique, sans menu « Plus »), budgets de visibilité §2 et d'information §113, zone du pouce §16, gestes §23–27, appui long §24, niveaux d'interface §13–14, rotation §30 | contrôles ✓ |
| `python3 tests/mobile_shots.py` | §112 : 10 écrans en 390 × 844 et 430 × 932, 3 en 844 × 390 | `docs/mobile_reference.jpg` |
| `python3 tests/soak.py [minutes]` | §109 : exploration continue (15 min par défaut), gestionnaire adaptatif actif ; mémoire GPU, tas JS, profils et échelles de résolution | `soak.json` |
| `python3 tests/baseline.py <html> <dossier>` | mesure de départ (moteur reconstruit avant les briefs) | `docs/baseline/baseline.json` |

## Régression visuelle

`canonical.py` compare chaque capture à `<dossier>/../reference/<nom>.png` s'il existe (écart moyen absolu par pixel, seuil 6 %). Pour figer une référence : copier les captures validées dans `reference/`. Les états sont **déterministes** : construits par `__lab.state(nom, { venue, env, viewport })`, joueurs à graine fixe, événements automatiques coupés, animations figées (`timeScale = 0`) au moment de la capture.

## Gestes mobiles

Les gestes tactiles passent par le protocole DevTools (`Input.dispatchTouchEvent`) avec **horodatages explicites** : le GPU logiciel retarde le traitement des événements (parfois plusieurs secondes), pas leur heure matérielle ; sans horodatage, un toucher de 60 ms serait vu comme un appui long. L'application elle-même se fie à l'horodatage matériel (`event.timeStamp`) pour la même raison. Les événements de pointeur synthétiques ne reproduisent pas fidèlement Safari / Chrome mobile. Non couvert : Safari iOS réel, Android réel, lecteurs d'écran réels.

Les fichiers construits portent une CSP stricte. Le pilote de test évalue lui-même du code (attentes, injection d'axe-core) : `harness.py` ouvre donc ses contextes avec `bypass_csp=True`. Le respect de la politique par la page est vérifié séparément par `tests/csp.py`, sans contournement.
