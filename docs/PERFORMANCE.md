# Performance

## Budgets (cibles du brief)

| Cible | Images/s | Règle |
|---|---|---|
| Portable de présentation | 60 stables | profil High, Ultra seulement à la main |
| Mobile récent | 50–60 | profil Mobile (DPR ≤ 1,6, ombres 1024, foule 60 %) |
| Mobile milieu de gamme | > 35–40 stables | descente automatique jusqu'à Low |

Priorité de rendu quand le budget manque (ordre de sacrifice inverse) : caméra stable > géométrie du stade > sièges > joueurs > réactivité de saisie > foule proche > ombres > post-traitement > particules (pluie). Concrètement, le gestionnaire baisse d'abord la résolution, puis les ombres, la foule, la densité de pluie et les abords — jamais la caméra ni la saisie.

## Gestionnaire adaptatif

`engine/Quality.ts` : temps d'image mesuré sur des fenêtres de 2 s, avec deux étages de réglage (addendum mobile §78, §81) :

1. **D'abord la résolution interne de la 3D** : ×1, puis ×0,85, puis ×0,72, dès la **première** fenêtre lente. Les pixels CSS de l'interface ne changent pas : le texte et les commandes restent nets.
2. **Ensuite le profil** : descente d'un cran après **deux** fenêtres lentes, quand la résolution est déjà au minimum.

La remontée se fait dans l'ordre inverse (la résolution d'abord, puis le profil) après 3 ou 4 fenêtres rapides : hystérésis, pas d'oscillation visible. Une fenêtre est lente au-delà de 19 ms sur bureau et de 25 ms sur tactile (> 40 images/s visées), rapide en deçà de 12,5 ms ou 15 ms. On n'attend donc pas que l'image soit inutilisable : la dégradation est graduelle, ce qui couvre la chauffe progressive d'un téléphone.

Le plafond est le profil de départ (High sur bureau, Mobile sur écran tactile). Un choix manuel (Lab) désactive l'automatique. Ultra (bloom, DPR 2) n'est jamais activé automatiquement.

**Palier d'appareil (§77).** Il est estimé au démarrage d'après la mémoire déclarée, le nombre de cœurs et le GPU (`WEBGL_debug_renderer_info`). Il plafonne la densité de pixels : 2 (haut de gamme), 1,5 (milieu de gamme), 1,2 (entrée de gamme). Jamais 3. Un téléphone d'entrée de gamme démarre directement au profil Low.

**Mode léger (§82).** Choisi dans « Plus », ou par `?lite=1`, ou automatiquement si le système demande l'économie de données (`navigator.connection.saveData`) : profil Low (pas d'ombres, foule 45 %, pluie 30 %, abords simplifiés, DPR ≤ 1). Le choix de place reste identique.

| Profil | DPR max | Ombres | Foule | Pluie | Abords | Bloom |
|---|---|---|---|---|---|---|
| ultra | 2 | 2048 | 100 % | 100 % | complets | oui |
| high | 1,75 | 2048 | 100 % | 80 % | complets | non |
| balanced | 1,4 | 1024 | 75 % | 55 % | complets | non |
| low | 1 | — | 45 % | 30 % | sol seul | non |
| mobile | 1,6 | 1024 | 60 % | 45 % | complets | non |

Le DPR effectif est toujours plafonné par le profil (jamais 3 sur mobile).

## Architecture de rendu

- Sièges : **un seul** `InstancedMesh` par lieu (6 triangles par siège), couleurs par instance, mises à jour partielles (`addUpdateRange`) pour la sélection.
- Foule : un quad par spectateur, silhouette en shader (SDF), animation 100 % GPU (debout, but en cascade, ola, chants, ponchos) : aucune mise à jour CPU par image.
- Tribunes : profils balayés, fusionnés par niveau (une géométrie par niveau + toit).
- Interface : jamais redessinée par image (voir ARCHITECTURE.md).
- Modèles de lieux (places + métriques statiques) mis en cache et **précalculés en temps libre** : un changement de stade ne recalcule plus la géométrie des places.

## Mesures

Environnement de test : Chromium + **SwiftShader** (GPU logiciel), 2 cœurs, 1280 × 800. Les volumes sont exacts ; les temps d'image (0,5–11 s par image) ne disent **rien** d'un vrai GPU, seulement des écarts relatifs.

| Stade | Ambiance | Vue | Appels | Triangles |
|---|---|---|---|---|
| Arena 56 k | jour / nuit / pluie | ensemble | 109 / 86 / 110 | 607 k / 520 k / 622 k |
| Arena | jour / nuit / pluie | siège | 79 / 56 / 81 | 604 k / 517 k / 626 k |
| Compact 23 k | jour / nuit / pluie | ensemble | 117 / 91 / 118 | 216 k / 199 k / 231 k |
| Compact | jour / nuit / pluie | siège | 74 / 48 / 76 | 214 k / 197 k / 236 k |
| Grand 84 k | jour / nuit / pluie | ensemble | 109 / 86 / 110 | 881 k / 762 k / 896 k |
| Grand | jour / nuit / pluie | siège | 76 / 53 / 78 | 878 k / 759 k / 900 k |
| Classic 30 k | jour / nuit / pluie | ensemble | 115 / 90 / 116 | 295 k / 264 k / 310 k |
| Classic | jour / nuit / pluie | siège | 72 / 47 / 74 | 293 k / 262 k / 315 k |
| Olympic 66 k | jour / nuit / pluie | ensemble | 121 / 94 / 120 | 691 k / 596 k / 706 k |
| Olympic | jour / nuit / pluie | siège | 85 / 60 / 87 | 687 k / 593 k / 709 k |

Après l'addendum mobile : +11 à +13 appels de dessin et +1,5 à +3 % de triangles selon le stade (détail plus bas). Profil Balanced, 1280 × 800.

Profils (jour, ensemble) : Low 77–85 appels / −20 % de triangles (pas d'ombres, foule 45 %) ; High ≈ Balanced + 4 % de triangles (foule complète).

Lecture :
- Le jour coûte ~20 appels de plus que la nuit : passe d'ombres du soleil (coupée quand le soleil est couché).
- La pluie ajoute 1–2 appels et ~15 k triangles (traînées instanciées).
- **Constat** : en vue siège, presque tous les triangles restent dessinés (les sièges et la foule sont des instances uniques non découpées) : 600–890 k triangles pour les grands stades. Sans effet sur un GPU de bureau, c'est le premier levier pour le mobile milieu de gamme (voir ci-dessous).

## Mémoire

Test : 11 changements de stade successifs (Arena → Compact → Grand → Classic → Olympic ×2 → Arena), mêmes réglages.

| | Géométries GPU | Textures GPU |
|---|---|---|
| Avant correction | 214 → 492 | 15 → 26 |
| Après correction | 61 → 61 (stable, 59–68 selon le stade) | 9 → 9 (8–9) |
| Après l'addendum mobile (signalétique, personnel, numéros) | 71 → 71 | 10 → 10 |

Trois fuites trouvées et corrigées pendant cette passe : géométries annexes non libérées (pelouse, buts, drapeaux, bancs) → libération récursive de tout sous-graphe déchargé ; anciens tampons de la foule conservés à chaque repeuplement (`setAttribute` ne libère pas le tampon remplacé) ; texture du ballon recréée par stade et restée orpheline côté GPU (identifiée en traçant `createTexture` / `deleteTexture`). Le test est rejouable : Lab › Performance › « Tester 11 changements de stade ».

## Coût de l'addendum mobile

| Ajout | Appels de dessin | Triangles | Remarque |
|---|---|---|---|
| Signalétique (sections, SORTIE, portes) | 1 | 2 par panneau | atlas ≤ 2 Mo |
| Vomitoires | 1 | 2 par ouverture | |
| Nez de marche jaunes (allées) | 1 | 2 par marche | quads instanciés ; un point de profil de plus aurait coûté +70 k triangles sur Arena (mesuré, abandonné) |
| Éclairage d'allées | 1 (nuit seulement) | 12 par pavé | invisible et non dessiné le jour |
| Personnel (caméras, photographes, stewards, table) | 5 (+4 en passe d'ombre) | ≈ 6 k | |
| Numéros de sièges proches | 1 (vue siège seulement) | ≤ 280 | ≤ 140 plaques |
| Incrustation B (comparaison, téléphone) | ×2 une image sur deux | ×2 une image sur deux | ombres non recalculées ; cible 240 × 160 px environ |
| Côte à côte (bureau, sur demande) | ×2 | ×2 | ombres calculées une fois |

## Prochains leviers (mesurés, non faits)

1. Découper sièges et foule par section (une instance par section, ~40–90 appels de plus) pour profiter du découpage par frustum en vue siège : −40 à −60 % de triangles attendus en vue siège.
2. Niveau de détail de la foule lointaine (points au-delà de ~120 m).
3. Mesure sur appareils réels (portable de présentation, iPhone 12+, Android milieu de gamme) avec le profil automatique, 10–15 min de charge soutenue (échauffement).
