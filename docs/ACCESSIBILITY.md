# Accessibilité

Cible : **WCAG 2.2 AA** pour toute l'interface. La 3D n'est jamais la seule source d'information : tout ce qu'elle montre (place, prix, vue, abri, accès) existe aussi en texte, au clavier et sans WebGL.

## Clavier

| Touche | Effet |
|---|---|
| `Tab` / `Maj+Tab` | parcourir les commandes (ordre : stade ou retour, puce de position, puce de match, heure et météo, son, plus, puis dock, fiche) |
| Flèches (sur la scène) | vue d'ensemble : tribune suivante · tribune : section suivante · section : section voisine (↑↓ : niveau) · place : place voisine (↑↓ : rang) · vue siège : se déplacer |
| `Maj` + flèches | regarder autour (vue siège) |
| `Entrée` | valider (tribune → section → meilleure place → vue siège ; en vue siège : infos) |
| `Échap` | fermer le panneau ouvert, sinon revenir d'un niveau |
| `M` / `C` / `I` | se déplacer / comparer / infos |
| `B` | parcourir toutes les places sans la 3D |
| `Début` (Home) | recentrer (vue siège : sur le jeu ; ailleurs : cadrage par défaut) |
| `Ctrl` / `Cmd` + `Z` | annuler le dernier changement de place |
| `Espace` / `Entrée` maintenus sur « Jumelles » | zoom ×3 tant que la touche est enfoncée |
| `?` | aide des raccourcis |

Le canevas est focusable (`role="application"`, description associée). Les panneaux reçoivent le focus à l'ouverture et le rendent à leur déclencheur à la fermeture.

## Focus visible

Anneau de 2 px blanc séparé de 2 px du fond (contraste ≥ 3:1 sur toute surface) ; jamais une simple nuance de couleur.

## Lecteur d'écran

- Une région `aria-live` annonce chaque changement significatif : « Tribune Sud, section 104, rang 12, place 18. Disponible. 72 €. Très bonne vue. Abrité. 12 marches depuis l'accès. »
- Rôles : barre d'actions (`nav`), fiche (`aside` libellée par son titre), panneaux (`dialog`), interrupteurs (`switch` + `aria-checked`), segments (`radiogroup`), état de lecture (`aria-pressed`, `aria-current`).
- Le nombre de marches depuis l'accès est calculé depuis la géométrie (hauteur à franchir / 19 cm), l'accès étant le vomitoire au mur arrière du niveau.
- Annonces sémantiques, jamais d'animation pure : « Vue siège. … », « Déplacé : rang 8, place 18. 45 €. », « Nuit sélectionnée », « Pluie activée », « Regard recentré sur le jeu. », « Zoom ×2 : ce n'est plus la vision réelle. ».
- Les signaux visuels temporaires (vue courante, moment de match) sont masqués aux lecteurs d'écran : l'information équivalente est déjà annoncée.

## Interface qui s'efface (Micro-HUD)

En vue siège, l'interface passe de COMPLET à MINIMAL (≈ 3 s) puis IMMERSIF (≈ 6 s) **uniquement** à la souris ou au toucher. Elle ne s'efface jamais :
- après une saisie au clavier (Tab, flèches, Entrée) ;
- en contraste élevé ou en texte agrandi ;
- quand un panneau, une fiche ou la bande d'environnement est ouvert ;
- quand un élément de l'interface a le focus (`:focus-within` le garde visible).

Le toucher qui fait réapparaître l'interface ne sélectionne rien. Le mode immersif volontaire (Plus › Mode immersif) se quitte d'un toucher ou avec Échap.

## Focus

Quand une fiche ou une feuille se ferme alors qu'elle contenait le focus, il est rendu au dock (ou au HUD), jamais au canevas. Les panneaux rendent le focus à leur déclencheur ; la bande d'environnement à la puce météo.

## Représentation 2D

Touche `B` ou « Plus › Parcourir les places sans 3D » : stade → tribune → section → rang → place, avec places libres, prix minimum, zones (familles, supporters, visiteurs), vue, abri. Utilisée aussi comme **repli automatique** si WebGL est indisponible (mêmes calculs, sans GPU).

## Couleurs

- Cartes de chaleur en palette séquentielle de type viridis (lisible en protanopie, deutéranopie, tritanopie), toujours accompagnée d'une légende textuelle (« Moins cher / Plus cher », « Exposé / Abrité »).
- Disponibilité : vert / gris foncé **et** texte (« Disponible / Vendue »).
- Le Lab simule protanopie, deutéranopie, tritanopie et achromatopsie sur la scène.
- Contraste élevé : surfaces opaques, bordures franches, textes secondaires éclaircis.

## Mouvement

- `prefers-reduced-motion` respecté par défaut, et réglable dans l'application : coupes franches avec bref fondu au lieu des vols, ambiance instantanée, pas de dérive d'ouverture, transitions d'interface ≤ 1 ms.
- **Mode confort** : aucune secousse (but), traversées de stade en fondu, aucun balancement de tête (déjà nul par défaut).
- Durées bornées : interface 90–320 ms, déplacements de place 350–1100 ms, aucun mouvement automatique sans action (sauf la dérive d'ouverture, interrompue au premier geste, et la vitrine du mode présentation).

## Son

Muet par défaut ; jamais nécessaire. Sous-titres d'ambiance optionnels (« Clameur du public : but ! », « Chants et applaudissements »).

## Texte et mise en page

Tailles en `rem` : Normale / Grande (112,5 %) / Très grande (131 %), et zoom du navigateur jusqu'à 200 % sans perte (pas de défilement horizontal, panneaux défilants). Zones sûres (`env(safe-area-inset-*)`) sur mobile.

## Cibles tactiles

44 × 44 px minimum sur mobile et tablette (HUD, dock, feuille, segments, puces, bande de candidats). Les petits boutons secondaires (40 px visibles) ont une zone tactile élargie à 46 px (§18). Sélection de place tolérante : rayon de 18 à 28 px selon la taille apparente des sièges, sélection aimantée, bande de candidats si plusieurs places se valent, appui long pour un aperçu.

En texte agrandi, moins d'étiquettes dans le monde (3 sur téléphone, 6 sur bureau) et des crans de feuille plus hauts : le prix et l'action principale ne sont jamais coupés.

## Vérifié automatiquement

`tests/a11y.py` : axe-core (WCAG 2.0/2.1/2.2 A et AA) sur six états, parcours 100 % clavier, annonce lecteur d'écran, mouvement réduit, texte 200 %, cibles 44 px, paysage, repli sans WebGL. Résultats : `docs/AUDIT_V3.md`.

## Non vérifié

Lecteurs d'écran réels (VoiceOver, NVDA, TalkBack) sur appareil ; contrastes de la scène 3D elle-même (variables selon l'heure, hors périmètre WCAG pour le contenu graphique non textuel, mais les étiquettes du monde ont un fond sombre garanti).
