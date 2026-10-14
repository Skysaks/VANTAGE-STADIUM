# Système de caméra

`src/camera/CameraDirector.ts`.

## États

14 états, chacun avec un contrat (orbite, regard libre, type de picking, distances, angle polaire, panoramique) :
`STADIUM_ORBIT, AERIAL, STAND_FOCUS, SECTION_FOCUS, ROW_FOCUS, SEAT_APPROACH, SEAT_POV, SEAT_SWITCH, WALK_MODE, PITCH_VIEW, TUNNEL_VIEW, PLAYER_VIEW, REVEAL, FREE_CAMERA`.
Les modes d'expérience (`overview`…`compare`) s'appuient sur ces états ; aucune combinaison invalide n'est possible.

## Transitions selon l'écart (UI/UX v1.0)

| Déplacement | Style | Durée |
|---|---|---|
| même rang, < 9 m | glissé latéral | 350–500 ms |
| rang voisin | saut court | 450–650 ms |
| même bloc | saut | 600–850 ms |
| autre bloc, même niveau | glisse devant la tribune | 800–1100 ms |
| autre niveau | montée/descente devant la tribune | 800–1100 ms |
| autre tribune | recul, traversée haute, approche | 900–1100 ms (fondu en mode confort) |
| vue d'ensemble → section | ancrage | 700–1100 ms |
| entrée dans une place | ancres : haut → devant la section → devant le rang → œil | 700–1600 ms |

Splines Catmull-Rom centripètes ; continuité de vitesse (un mouvement en cours est prolongé) ; regard interpolé le long d'une spline de cibles puis aligné sur l'orientation finale (slerp sur le dernier quart) ; champ légèrement élargi pendant le trajet (+6 %), naturel à l'arrivée.

## Collisions

- **Avant** chaque trajet : la spline est échantillonnée (40 points) ; un point dans les gradins (grille spatiale des sièges) ou dans l'épaisseur d'un toit (carte d'abri) déclenche l'insertion d'un point de passage au-dessus et un nouvel essai (2 maximum).
- **Pendant** l'orbite : la caméra reste au-dessus de la pelouse (0,8 m), au-dessus des gradins (+3 m) et hors de l'épaisseur des toits.
- `RecoveryController` : position non finie, sous le sol ou à plus de 3 km → retour à la vue d'ensemble.

## Vision humaine

- Œil : adulte assis 1,17 m, debout 1,62 m, enfant 0,92 / 1,15 m au-dessus du sol du rang ; 10 cm devant le dossier.
- Champ horizontal naturel 68°, champ vertical plafonné à 62° (pas de fish-eye), « large » plafonné à 84°, zoom ×1 à ×3 (molette, pincement).
- Regard limité à ±100° autour de l'axe du siège (on ne se retourne pas dans son siège) ; inertie courte après un lancer, jamais de rotation infinie.
- Aucun balancement de tête par défaut ; le mode confort supprime aussi les secousses de but.

## Cadrage par encarts (ViewportInsets)

Chaque surface visible (HUD, dock, carte, feuille, mini-carte, plateau de comparaison, déplacer, présentateur) publie son rectangle et son bord. La zone libre en est déduite ; la caméra :

1. décale son **centre optique** (`setViewOffset`) vers le centre de la zone libre (transition douce) : la section ou la place visée n'est jamais sous la carte ou la feuille ;
2. recalcule le **cadrage d'ensemble** pour la largeur et la hauteur réellement libres (portrait : vue dans l'axe du terrain, champ vertical 58°).

En vue siège, le centre optique reste au centre de l'écran (vision humaine ; pas de saut quand le HUD s'estompe).

Le picking et les étiquettes utilisent la même matrice de projection : le décalage est transparent pour eux.
