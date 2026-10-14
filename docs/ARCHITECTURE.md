# Architecture

Vantage est une application web monopage en TypeScript strict, sans framework d'interface, construite par Vite en **un seul fichier HTML autonome** par saveur (public, présentation, lab). Rendu : three.js r170.

## Couches

```
config/        données déclaratives : produit (marque), lieux (VenueConfig), sport, équipes, événements, révélations
venue/         génération déterministe d'un lieu : courbes, gradins (valeur C), sièges, sections, grille spatiale ; métriques
environment/   EnvironmentEngine : heure → soleil astronomique → ciel, nuages, pluie (carte d'abri), brume, vent, humidité, projecteurs
engine/        rendu : tribunes, sièges instanciés, foule GPU, pelouse, joueurs, écrans, abords, qualité adaptative, picking ;
               micro-détails (Details : signalétique, vomitoires, éclairage d'allées, personnel ; SeatNumbers : numéros proches)
camera/        CameraDirector : états, transitions par écart, planification sans collision, vision humaine, encarts d'interface
interaction/   saisie : gestes selon le mode (orbiter / regarder / se déplacer), vitesse, inertie, double-tap, pincement
app/           App (contrôleur), Hud (Micro-HUD : niveaux d'interface, puces, faits, recentrer, annuler, incrustation),
               ModeMachine, intelligence (Pareto, intentions, conditions, faits, badges, comparaison), EventDirector, Store
ui/            jetons de design, gabarits (fonctions pures), composants (MiniMap, Sheet, WorldOverlay), ViewportInsets
reveal/        RevealDirector : chorégraphie sur ancres sémantiques, valable pour tout lieu
presentation/  mode présentation (présentateur, raccourcis, vitrine, enregistrement), scénarios 01–07, états déterministes
lab/           Experience Lab (construction lab uniquement)
```

Règle de dépendance : `config` et `venue` ne connaissent ni three.js ni le DOM ; `engine` ne connaît pas l'interface ; `ui` ne connaît pas three.js (sauf la projection des étiquettes) ; seul `app` relie tout.

## Flux d'une image

`renderer.setAnimationLoop` → `Engine.frame()` :

1. temps réel borné (`dtReal ≤ 0,1 s`), temps d'animation `dt = dtReal × timeScale` (0 = figé pour les captures) ;
2. `QualityManager.tick` (fenêtres de 2 s, hystérésis) ;
3. `CameraDirector.update` (transition, regard, orbite + anti-collision, décalage du centre optique) ;
4. joueurs (pas fixe ≤ 50 ms), pelouse, foule (uniformes seulement), vue éclatée ;
5. `EnvironmentEngine.update` (interpolation sur l'horloge murale, humidité, projecteurs, pluie) ;
6. crochets d'image : étiquettes du monde (écriture directe de `transform`, occultation ≈ 4 Hz, collisions, plafond de densité), mini-carte (≤ 8 Hz, si la caméra a bougé), directeur d'événements, Micro-HUD (niveau d'interface à chaque image ; décisions — recentrer, fait suivant, incrustation — ≈ 4 Hz), pose de la seconde caméra ;
7. rendu : vue unique (avec ou sans « bloom »), **côte à côte** (deux viewports à ciseaux, ombres calculées une fois), ou **incrustation** (cible réduite en demi-flottants rafraîchie une image sur deux, recopiée par un quad orthographique).

**L'interface n'est jamais redessinée par image.** Elle ne l'est que sur changement d'état sémantique (mode, place, panneau, environnement cible). Les seules écritures par image sont des `transform` d'étiquettes déjà créées.

## État et modes

- `ModeMachine` : `overview · stand · section · seat · pov · move · compare · reveal · lab`, transitions autorisées déclarées, retour défini par mode. Aucun booléen épars pour « suis-je en vue siège ».
- `CameraDirector.state` : 14 états caméra (`STADIUM_ORBIT`, `SECTION_FOCUS`, `SEAT_POV`, `SEAT_SWITCH`, `REVEAL`…), chacun avec son contrat (orbite, regard libre, type de picking, limites).
- Le mode d'expérience pilote l'interface ; l'état caméra pilote les gestes. Les deux sont reliés par `App`.

## Événements sémantiques

Le moteur expose des événements de haut niveau (changement d'état caméra, but marqué, environnement interpolé ≤ 4 Hz via `onLive`) ; l'interface s'y abonne. Le journal de session (`App.telemetry`, visible dans le Lab) enregistre les événements produit sans donnée personnelle.

## Constructions

| Saveur | Fichier | Contenu |
|---|---|---|
| public | `dist/vantage.html` | expérience seule ; aucun code de Lab ni de présentateur |
| presentation | `dist/vantage-presentation.html` | + présentateur, raccourcis, vitrine, enregistrement, capture propre |
| lab | `dist/vantage-lab.html` | + Experience Lab, états déterministes, diagnostics, journal, build |

La constante `__BUILD__` est remplacée à la construction ; les branches mortes (import dynamique du Lab, du présentateur) disparaissent. Le HTML est filtré (`data-only`). `scripts/build.mjs` **échoue** si la version publique contient une chaîne propre au Lab ou au présentateur.

## Robustesse

- Pas de WebGL → message soigné + **parcours 2D** des places (calculs CPU identiques).
- Perte de contexte WebGL → voile « Reprise de l'affichage… », rechargement du lieu à la restauration, bouton de secours.
- Erreurs non capturées → journalisées, jamais affichées en trace brute ; une fonction optionnelle (son, bloom, foule) peut échouer sans arrêter l'expérience (drapeaux `FLAGS`).
- `RecoveryController` (dans `App.frame`) : caméra non finie, sous la pelouse ou hors limites → retour à l'ancre « vue d'ensemble ».
- Changement de lieu : `Engine.unload()` libère géométries, matériaux, textures, carte d'abri ; vérifié par le test mémoire du Lab.

## Choix contesté : pas de React

Le brief UI v1.0 parle d'état « React » séparé du rendu. Nous avons gardé du TypeScript sans framework :

- **pour** : ~25 surfaces d'interface seulement, toutes pilotées par une machine d'états ; une délégation d'événements unique (`data-act`) ; aucun coût de réconciliation ; fichier unique plus léger (React + ReactDOM ≈ 140 Ko) ; l'exigence réelle — « l'interface ne se redessine pas à chaque image » — est respectée par construction ;
- **contre** : pas d'écosystème de composants, tests unitaires d'interface plus artisanaux, montée en charge d'équipe moins évidente ;
- **seuil de bascule** : au-delà d'un panier, d'un compte ou d'un tunnel d'achat (hors périmètre), React (ou Preact) devient préférable. Les gabarits `ui/views.ts` étant des fonctions pures, la migration est mécanique.
