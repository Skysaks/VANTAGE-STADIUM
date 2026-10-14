# Vantage

> © 2026 Florian Iglesias — Tous droits réservés. Ce dépôt est public à titre de portfolio uniquement.
> Aucune licence n'est concédée : copie, modification, distribution ou exploitation interdites sans accord écrit. Voir [LICENSE](LICENSE).

> Nom de travail. Le nom, le logo et les couleurs viennent de `src/config/product.ts` : le moteur ne contient aucune marque.

Vantage montre ce qu'on voit depuis n'importe quelle place d'un stade, avant d'acheter. Un seul moteur, cinq stades, toutes les ambiances :

- **cinq archétypes** générés (23 000 à 84 000 places) : bol moderne, stade compact, très grand stade, stade historique asymétrique, stade olympique ;
- **un moteur d'environnement** : soleil astronomique réel pour le lieu et la date, ciel et nuages, pluie qui ne tombe pas sous les toits, humidité, brume, vent, projecteurs automatiques — transitions de 3 à 6 s, conservé d'un stade à l'autre ;
- un match et une foule vivants (moments de match, but complet, clameur en cascade, ola, ponchos sous la pluie) ;
- une navigation de place en place (durées selon l'écart, sans traverser le béton) ;
- une comparaison A/B qui conclut, des recommandations non dominées (Pareto) et expliquées ;
- une **révélation** cinématique qui fonctionne dans tout stade et sous toute météo, et se termine dans la place ;
- une interface « le stade est l'interface » : HUD contextuel, bureau / mobile / paysage distincts, cadrage caméra qui évite l'interface ;
- un **Micro-HUD** pensé d'abord pour le téléphone : puces de match, de météo et de position, un seul fait utile à la fois, interface qui s'efface en vue siège (complet → minimal → immersif), tout le parcours au pouce sans menu ;
- des micro-détails là où l'on regarde : numéros de sièges autour de sa place, marquages de rang, nez de marche, éclairage d'allées la nuit, signalétique SORTIE / section / PORTE, vomitoires, zone technique, caméras, photographes, stewards ;
- accessibilité WCAG 2.2 AA (clavier, lecteur d'écran, parcours 2D sans WebGL, mouvement réduit, confort, contraste, texte 200 %).

Chaque construction tient dans **un seul fichier HTML** : hors ligne, sans serveur, sans CDN.

```bash
npm install
npm run dev          # http://localhost:5173 (saveur lab) ; sur un téléphone du même réseau : npm run dev -- --host
npm run build        # dist/vantage.html · vantage-presentation.html · vantage-lab.html + contrôle de séparation
```

| Fichier | Pour qui | Taille |
|---|---|---|
| `dist/vantage.html` | le public : l'expérience seule | ≈ 1 000 Ko (340 Ko gzip) |
| `dist/vantage-presentation.html` | démonstration : présentateur, scénarios 01–07, raccourcis, vitrine, enregistrement | ≈ 1 010 Ko |
| `dist/vantage-lab.html` | équipe : Experience Lab, états déterministes, diagnostics, journal | ≈ 1 025 Ko |

## Démarrer une démonstration

1. Ouvrir `dist/vantage-presentation.html` (Chrome ou Edge récents), `F` pour le plein écran.
2. `1`–`7` scénarios · `D` / `N` / `R` jour / nuit / pluie · `G` but · `V` stade suivant · `X` réinitialiser · `K` capture propre · `H` masquer la barre.
3. Liens directs : `?v=grand&env=night`, `?v=classic&env=rain&seat=104-R12-S18`, `?scenario=goal`, `?reveal=final&style=epic` (détails : `docs/PRESENTATION_MODE.md`).

## Commandes (public)

Souris / doigt : glisser = tourner (vue d'ensemble) ou regarder (vue siège) ; pincer = zoomer ; toucher une tribune → section → place (sélection aimantée ; si plusieurs places se valent, une petite bande permet de corriger) ; appui long = aperçu ; « Voir depuis cette place ». En vue siège : **Se déplacer** (glisser ← → places, ↑ ↓ rangs), **Comparer** (incrustation de l'autre place sur téléphone, côte à côte sur bureau), **Vue** (recentrer sur le jeu, suivre le ballon ou l'action, zoom ×2, jumelles, perspective, jour / nuit / pluie à place égale), **Annuler** juste après un changement de place, **Recentrer** quand on s'est perdu.
Clavier : flèches, Entrée, Échap, `M` déplacer, `C` comparer, `I` infos, `B` toutes les places sans 3D, `Début` recentrer, `Ctrl/Cmd+Z` annuler, `?` aide.

## Documentation

| Document | Contenu |
|---|---|
| `docs/AUDIT_V3.md` | audit (UX, rendu, accessibilité, algorithmes), mesure de départ, changements priorisés, avant / après, résultats des tests |
| `docs/ARCHITECTURE.md` | couches, flux d'une image, modes, constructions, robustesse, choix contesté de React |
| `docs/VENUE_CONFIG.md` | décrire un lieu ; les 5 archétypes ; règles de géométrie (valeur C) |
| `docs/ENVIRONMENT_ENGINE.md` | heure, soleil, ciel, nuages, pluie sous les toits, humidité, projecteurs |
| `docs/CAMERA_SYSTEM.md` | états, transitions selon l'écart, collisions, vision humaine, cadrage par encarts |
| `docs/PRESENTATION_MODE.md` | présentateur, scénarios, vitrine, enregistrement, liens profonds, parcours §111 |
| `docs/PERFORMANCE.md` | budgets, gestionnaire adaptatif, mesures, matrice lieux × profils, mémoire |
| `docs/MOBILE_MICROHUD.md` | addendum mobile et Micro-HUD : correspondance §1–114, décisions contestées, protocoles sur appareil réel |
| `docs/ACCESSIBILITY.md` | WCAG 2.2 AA : clavier, lecteur d'écran, alternative 2D, mouvement, contraste, 200 % |
| `docs/LICENSES.md` | audit des licences et des actifs, statut du code (salle blanche non stricte) |
| `tests/README.md` | tous les tests et comment les lancer |

## Statut juridique — à lire avant tout usage commercial

- **Aucun code, actif ni structure** du dépôt tiers `thebuggeddev/football-stadium(-kimi)` (PolyForm Noncommercial 1.0.0) n'a été repris.
- **Composants tiers embarqués** : three.js (MIT) et la police Inter (SIL OFL 1.1), textes de licence en tête de chaque fichier construit. Ni image, ni modèle 3D, ni son, ni police externe : tout est généré par le code.
- **Limite honnête** : le code a été écrit dans une session qui avait lu le dépôt tiers pendant l'audit initial. Ce n'est donc **pas une salle blanche stricte** au sens procédural. Avant une exploitation commerciale : validation par un avocat et, si elle l'exige, réécriture des modules d'ambiance (foule, joueurs, jour/nuit) dans une session neuve. Détail : `docs/LICENSES.md`.
- **Données fictives** : stades, clubs, prix et disponibilités ; inventaire simulé ; provenance (calculé, estimé, simulé) affichée.

## Limites connues

1. **Fluidité non mesurée sur vrai GPU.** Les tests tournent sur un GPU logiciel (SwiftShader, 2 cœurs) : volumes exacts, temps d'image relatifs. La cible 60 i/s (bureau) / 50–60 (mobile récent) reste à valider sur un portable de présentation, un iPhone 12+ et un Android milieu de gamme.
2. **Lecteurs d'écran réels** (VoiceOver, NVDA, TalkBack) non testés ; axe-core et les annonces ARIA le sont.
3. **Foule** : silhouettes dessinées en shader, convaincantes au-delà de 3 m ; les têtes du rang juste devant restent stylisées.
4. **Valeur C** : les niveaux supérieurs des grands stades plafonnent à 37° de pente ; une partie des places y reste sous 60 mm (la fiche le dit : « la ligne de touche proche peut être masquée »), comme dans de vrais stades.
5. **Rendu** : pas d'occlusion ambiante ni d'ombres de contact ; halo (« bloom ») réservé au profil Ultra.

## Sécurité

- Chaque fichier construit est autonome et porte une Content-Security-Policy qui interdit tout chargement et tout envoi réseau : rien ne sort de l'appareil.
- Les paramètres d'URL (stade, place, événement, révélation, heure…) ne sont acceptés que s'ils correspondent à une valeur connue ; sinon, valeurs par défaut.
- Le serveur de développement n'écoute que sur la machine locale.
- La construction vérifie que la version publique ne contient aucune commande de Lab ni de présentateur.
- Signalement d'une faille : [SECURITY.md](SECURITY.md).

## Mentions légales

© 2026 Florian Iglesias. Tous droits réservés — voir [LICENSE](LICENSE), hors composants tiers (three.js, MIT ; Inter, SIL OFL 1.1). Les contributions de code ne sont pas acceptées ([CONTRIBUTING.md](CONTRIBUTING.md)). Stades, clubs, prix et disponibilités sont fictifs ; aucun stade réel n'est reproduit.
