# Mode présentation

Fichier : `dist/vantage-presentation.html` (ou `?presentation=1` dans la version lab). Différent du Lab : démonstration maîtrisée, aucun réglage de développeur, aucune donnée technique à l'écran.

## Surface du présentateur

Une barre unique, en haut au centre : **Stade** (◂ nom ▸, ou sélecteur visuel), **Environnement** (Jour, Coucher, Nuit, Pluie), **Scénarios** 1–7, **Révélation**, **Réinitialiser**. Rien d'autre. `H` la masque.

## Raccourcis (actifs uniquement dans ce mode)

| Touche | Action |
|---|---|
| `1`–`7` | scénarios 01–07 |
| `D` / `N` / `R` | jour / nuit / pluie |
| `G` | moment de but |
| `V` | stade suivant |
| `X` | réinitialiser la démonstration |
| `F` | plein écran (API Fullscreen ; l'interface recalcule zones sûres et encarts) |
| `H` | masquer / afficher la barre |
| `K` | capture propre (masque HUD, curseur, infobulles ; l'environnement reste actif) |
| `O` | vitrine automatique |
| `P` | séquence d'enregistrement (≈ 40 s) |

Aucun conflit avec les commandes ordinaires (flèches, Entrée, Échap, `M`, `C`, `I`, `B`, `?`).

## Scénarios

| # | Nom | Contenu |
|---|---|---|
| 01 | Jour, vue d'ensemble | Vantage Arena · après-midi dégagé · stade plein · dérive lente |
| 02 | Match de nuit | Vantage Grand · nuit · finale à guichets fermés · projecteurs |
| 03 | Pluie, place abritée | Vantage Classic · pluie · meilleure place couverte, vue siège |
| 04 | Distance olympique | Vantage Olympic · jour · place haute en virage |
| 05 | Changer de place | Vantage Arena · vue siège puis comparaison A/B directe |
| 06 | Moment de but | Vantage Compact · nuit · derby · but (attaque, frappe, filet, célébration, clameur en cascade, tableau, LED) |
| 07 | Révélation cinématique | Vantage Arena · nuit · ≈ 10 s, se termine dans la place |

**Réinitialiser** : Vantage Arena · jour · dégagé · vue d'ensemble · affluence réelle · jeu ouvert · calques et préférences par défaut.

## Vitrine automatique

Mode borne `?showcase=1` (relance après 60 s sans interaction) ou touche `O` : boucle 01 → 05 → nuit → 03 → 06 → 04 → 07. Toute saisie l'arrête immédiatement. Elle ne démarre **jamais** seule pendant une démonstration animée (un présentateur qui parle sans toucher l'écran ne doit pas être interrompu) : constat du test §111, où la vitrine s'était déclenchée pendant une attente.

## Enregistrement

`?record=1` : graine fixe pour les joueurs, événements automatiques coupés, curseur et présentateur masqués. `P` (ou `&sequence=1`) joue la séquence déterministe : jour (0–5 s) → nuit (5–9) → section (9–13) → vue siège (13–17) → trois places (17–21) → quatre rangs (21–25) → pluie (25–29) → changement de stade (29–34) → révélation (34–45).

## Liens profonds

| Lien | Effet |
|---|---|
| `?v=grand&env=night` | stade et environnement |
| `?v=classic&env=rain&seat=104-R12-S18` | vue depuis une place précise sous la pluie |
| `?seat=112-R13-S42&mode=seat` | fiche de la place, sans entrer dans la vue siège |
| `?scenario=goal` (ou `6`, `rain`, `reveal`…) | scénario |
| `?reveal=final&style=epic` | révélation (`ticket`, `surprise`, `final`/`vip` ; `quick`, `cinematic`, `epic`) |
| `?t=1290` | heure (minutes) |
| `?event=derby` | événement |

« Copier le lien » sérialise stade, place, mode de caméra et environnement ; ouvrir le lien reconstruit la vue.

## Parcours d'acceptation §111

Automatisé par `tests/acceptance_presentation.py` (voir `tests/README.md`) : ouverture → rotation → tribune → place → vue siège → joueurs → trois places → rangs → comparaison → vue d'ensemble → Vantage Grand → nuit → pluie → place couverte → place exposée → but → Vantage Olympic → place lointaine → vue d'ensemble → révélation → contrôle immédiat. Une seule session, sans rechargement.

## Sécurité du présentateur

Pas d'accès au Lab ni aux réglages de développement ; états caméra invalides impossibles (machine d'états) ; `RecoveryController` ; « Réinitialiser » toujours disponible ; aucune trace d'erreur à l'écran.
