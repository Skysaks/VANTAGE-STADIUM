# Addendum mobile & Micro-HUD

Ce document couvre l'addendum « Mobile Responsiveness & Micro-HUD ». Le produit n'a pas été redessiné : on a resserré l'interface existante (UI/UX System v1.0) autour du téléphone, du pouce et du contexte.

La règle de fond est inchangée : le stade d'abord, l'interface ensuite. Avant d'ajouter une surface, on a cherché à faire passer l'information par le cadrage, les étiquettes du monde, le comportement ou la signalétique du stade.

## Ce qui a changé, en bref

| Thème | Avant | Maintenant |
|---|---|---|
| HUD haut | fil d'Ariane complet, son et « Plus » en haut sur téléphone | puce de position compacte (`104 · R7 · P18`) qui révèle la hiérarchie au toucher ; « Plus » dans le dock (zone du pouce) |
| Match | absent de l'interface | puce de match optionnelle : en haut au centre sur bureau, compacte en vue siège, masquée en comparaison et en sélection |
| Environnement | panneau complet | puce heure et météo, puis bande rapide Jour / Coucher / Nuit / Pluie (en bas sur téléphone) qui se replie seule 1,5 s après un choix |
| Information | carte ou rien | un seul fait contextuel à la fois, classé selon les conditions ; en vue siège, une barre de 3 faits pendant 3 s à l'arrivée |
| Masquage | estompage unique au bout de 3,5 s | trois niveaux FULL / MINIMAL / IMMERSIVE, bouton « Mode immersif », jamais au clavier ni en accessibilité |
| Tactile | rayon fixe | rayon 18–28 px selon la taille apparente des sièges, aimantation, bande de candidats, appui long, axe verrouillé, bords protégés |
| Comparaison | A/B bascule, détruite par la vue d'ensemble | conservée (reprise depuis le dock), côte à côte synchronisé sur bureau, incrustation B sur téléphone |
| Stade | — | numéros de sièges et marquages de rang autour de la place, nez de marche jaunes, éclairage d'allées la nuit, signalétique SORTIE / section / PORTE, vomitoires, zone technique, caméras, photographes, stewards |

## Correspondance avec l'addendum

✓ = fait et testé automatiquement · ◐ = fait, vérifié visuellement ou en partie · ✗ = non fait (raison donnée) · ▣ = exige un appareil réel (protocole ci-dessous).

| § | Exigence | État | Où |
|---|---|---|---|
| 1 | parcours complet à une main | ✓ | `tests/mobile.py` §111 (version publique, gestes tactiles réels) |
| 2 | budget de visibilité par état | ✓ | mesuré sur 390 × 844 (résultats plus bas) |
| 3, 8, 113 | Micro-HUD sans tableau de bord, priorités par état, 1 contexte par catégorie | ✓ | `app/Hud.ts`, budget d'information testé |
| 4–5, 55 | puce de match optionnelle | ✓ | `#evchip` ; masquée en exploration, sélection, révélation et capture ; interrupteur « Afficher le match » |
| 6, 50, 101 | puce d'environnement, bande rapide, repli après 1,5 s | ✓ | `#envstrip` ; icônes SVG, aucun émoji |
| 7, 45 | puce de position compacte, hiérarchie au toucher | ✓ | `.ctx` → panneau « Où suis-je ? » (stade, tribune, section, rang, place, faits, places récentes) |
| 9–10 | un fait à la fois, remplacé après 5 s d'inactivité, arrêt immédiat à la saisie | ✓ | `seatFacts` (intelligence.ts) |
| 11 | badges humains, un par place | ✓ | Meilleure vue / Meilleur rapport / Abritée / Ambiance, sur les places de la section et dans la fiche |
| 12 | barre de faits en vue siège, repli après 3 s | ✓ | les mots remplacent la note : « Très bonne vue · 34 m du terrain · Abrité » |
| 13–15 | niveaux FULL / MINIMAL / IMMERSIVE, bouton Immersif | ✓ | `data-ui` ; le toucher qui réveille l'interface ne sélectionne rien |
| 14 | pas de masquage au clavier ni en accessibilité | ✓ | désactivé si navigation clavier, contraste élevé ou texte agrandi |
| 16–18 | zone du pouce, cibles 44–52 px, hit slop | ✓ | actions dans les 40 % bas, mesuré ; cibles ≥ 44 px |
| 19–21 | ciblage 3D adaptatif, aimantation, bande de candidats ~2 s | ✓ / ◐ | rayon et classement testés ; la bande apparaît quand les sièges font moins de 16 px à l'écran |
| 22 | pincement non linéaire, pas de traversée | ✓ | vitesse de zoom selon la distance ; anti-collision existante |
| 23 | double toucher contextuel, jamais en vue siège | ✓ | testé |
| 24 | appui long : aperçu | ✓ | testé ; robuste aux images lentes (l'horodatage matériel fait foi) |
| 25–27 | seuils, verrou d'axe, bords protégés | ✓ | 14 px, rapport 1,6, marge de 22 px ; testés |
| 28–29 | 100dvh, zones sûres partout | ✓ / ◐ | `height: 100dvh`, `visualViewport` ; zones sûres sur HUD, dock, feuille, panneaux, rail paysage, bouton Passer. Simulation d'encoche dans le Lab |
| 30 | rotation sans perte d'état | ✓ | testé en comparaison de nuit ; seul le cadrage est recalculé |
| 31 | paysage : rail d'actions à droite, infos à gauche | ✓ | gabarit existant, ajusté |
| 32 | suggestion de rotation, une seule fois | ✓ | stockage de session |
| 33 | plein écran proposé, jamais imposé, mémorisé pour la session | ✓ | demandé seulement dans un geste (« Voir ») si la personne l'a choisi |
| 34 | crans de feuille proportionnels | ✓ | 15 / 38 / 72 % (≥ 760 px), 18 / 44 / 78 % sinon ; plus hauts en texte agrandi |
| 35–36 | écrans courts et étroits | ✓ / ◐ | `data-short` (libellés du dock lus par les lecteurs d'écran, masqués à l'écran), `data-narrow` (3 actions + Plus) |
| 37 | tablette = logique mobile | ✓ | `data-device` d'après pointeur et survol, pas la largeur |
| 38 | pliables, écran partagé | ◐ | requêtes de conteneur ; préréglages « pliable » et « petit écran » dans le Lab |
| 39–40 | carte `clamp(300px, 24vw, 360px)`, prix `clamp` | ✓ | en rem, donc suit le zoom texte |
| 41–44 | étiquettes : échelle bornée, occultation, collisions, densité | ✓ | 4 étiquettes au plus sur téléphone, 8 sur bureau (3 et 6 en texte agrandi) |
| 46 | boussole | ✗ | les tribunes nommées (Virage Ouest…) et la mini-carte orientée (bureau) jouent ce rôle ; ajouter une boussole contredirait le §114 |
| 47 | indicateur de vue temporaire | ✓ | « Vue d'ensemble », « Section 104 », « Vue siège », environ 1,2 s |
| 48, 98 | Recentrer contextuel, recentrer sur le jeu | ✓ | n'apparaît que si l'on s'est écarté du cadrage ; touche Début (Home) |
| 49 | logo = vue d'ensemble | ✓ | bureau ; sur téléphone, la hiérarchie (« Où suis-je ? ») offre le même raccourci |
| 51 | indicateur d'ambiance en cours | ✓ | pendant toute la transition |
| 52–54 | abri et soleil selon les conditions, pondération expliquée | ✓ | ±6 points au plus, « Mieux protégée dans les conditions actuelles » |
| 56–57 | micro-notifications de match, but d'abord sur les écrans du stade | ✓ | Corner, Coup franc, Penalty, Coup d'envoi, Mi-temps ; « But » 1,3 s après les écrans |
| 58–60 | une distance, hauteur en mots, terrain visible en mots | ✓ | `seatFacts` |
| 61 | gêne matérielle et sa source | ✓ | poteau, avancée du niveau supérieur, bord du toit, garde-corps ; toucher le fait tourne la tête vers le poteau |
| 62 | échelle | ✓ | anneaux sur les joueurs et distance pendant 3,5 s |
| 63 | sélecteur de perspective | ✓ | Naturelle, Large, Debout, Terrain, Aérienne (panneau « Vue ») |
| 64–65 | zoom ×2 présenté comme tel, jumelles maintenues | ✓ | puce « Zoom ×2 · Vue réelle » ; retour à ×1 en changeant de place |
| 66 | côte à côte (bureau, sur demande) | ◐ | deux vues synchronisées ; vérifié visuellement |
| 67–68 | incrustation B (téléphone), placement intelligent | ✓ / ◐ | coin choisi loin du ballon et du rond central, hors commandes |
| 69 | enregistrement instantané | ✓ | signet sur la puce et l'épingle ; proposées en premier pour la comparaison |
| 70 | places récentes | ✓ | 5 dernières, dans « Où suis-je ? » (et appui long sur Retour) |
| 71 | Annuler (~2 s) | ✓ | testé ; aussi Ctrl/Cmd + Z |
| 72 | comparaison préservée | ✓ | « Reprendre A/B » dans le dock ; « Effacer » explicite |
| 73–74 | persistance de session, état dans l'URL | ✓ | préférences d'accessibilité, match, plein écran, mode léger ; URL : stade, place, mode, heure, météo, B comparée, événement |
| 75–76 | retour haptique léger, aucun son d'interface | ✓ | 5–12 ms, jamais à chaque pas de glissement |
| 77–78, 81 | plafond de densité de pixels par palier, résolution dynamique, dégradation graduelle | ✓ | paliers 2 / 1,5 / 1,2 ; ×1 → ×0,85 → ×0,72 avant de changer de profil |
| 79–80 | post-traitement réduit, pluie proportionnée | ✓ | existant (bloom réservé à Ultra, pluie en 2 couches selon le profil) |
| 82 | mode léger | ✓ | « Plus » › Mode léger, `?lite=1`, ou « économie de données » du système |
| 83–84 | réseau lent, monde squelette | sans objet | fichier unique, hors ligne, sans actif réseau ; le monde se charge déjà par couches (pelouse → bol → places → foule) |
| 85–92 | micro-détails | ✓ / ◐ | voir « Stade » ; vérifiés sur captures |
| 93–94 | ballon lisible, maillots contrastés | ✓ | ballon ×1 à ×1,7 selon la distance ; maillot trop proche de la pelouse → tenue alternative |
| 95–97 | suivre le ballon / l'action, la main reprend toujours | ✓ | toute saisie de regard coupe le suivi |
| 99–100 | conditions à place égale | ✓ | panneau « Vue » › Conditions ; caméra immobile |
| 102–104 | focus, annonces, texte agrandi | ✓ | focus rendu au dock à la fermeture d'une fiche ; « Vue siège. … », « Déplacé : rang 8, place 18 », « Nuit sélectionnée », « Pluie activée » |
| 105–109 | une main, en marchant, en plein soleil, de nuit, chaleur 15 min | ▣ | protocole ci-dessous ; l'automatisation n'en couvre que la part mesurable |
| 110 | acceptation du Micro-HUD | ▣ | test utilisateur à faire (question : « y a-t-il beaucoup d'informations à l'écran ? ») |
| 111 | acceptation mobile | ✓ | 13 étapes tactiles sans ouvrir « Plus » |
| 112 | captures de référence | ✓ | `tests/mobile_shots.py` → `docs/mobile_reference.jpg` |
| 114 | pas de clarté par ajout d'interface | — | voir « Décisions contestées » |

## Résultats mesurés

Téléphone simulé 390 × 844, tactile via le protocole DevTools, GPU logiciel (SwiftShader). Les volumes et les états sont exacts ; les temps d'image ne veulent rien dire.

**§111 — parcours complet, version publique, sans ouvrir « Plus » : 13 étapes sur 13** (`tests/mobile.py` : 42 contrôles sur 42). Tourner (un doigt), zoomer (pincement), section, place, vue siège, regarder, places, rangs, Annuler proposé, Recentrer, comparer (avec incrustation B), jour / nuit / pluie depuis la place, retour à la vue d'ensemble, bande rapide d'environnement.

**§2 — part du stade visible** (surface non couverte par l'interface, grille de 4 px) :

| État | Exigence | Mesuré |
|---|---|---|
| Vue d'ensemble | > 88 % | 89,2 % |
| Section | > 82 % | 87,4 % |
| Place (feuille au premier cran) | > 68 % | 80,8 % |
| Vue siège (après repli de la barre de faits) | > 90 % | 90,5 % |
| Comparaison (avec incrustation B) | > 65 % | 71,5 % |

La vue siège est le cas le plus serré. Pour tenir 90 %, le dock du téléphone y est réduit à sa largeur utile (4 × 56 px) et la barre de faits passe à un seul fait après 3 s.

**§113 — budget d'information** respecté dans les cinq états : au plus un contexte de match, un spatial, un d'environnement, un groupe d'actions et un fait.

**§16 — zone du pouce** : sur téléphone, toutes les actions du dock et l'action principale de la feuille sont dans les 40 % bas (centre à 95 % de la hauteur).

**Gestes** : double toucher en vue siège sans effet (§23) ; geste accidentel de 8 px sans effet (§25) ; geste diagonal surtout vertical traité comme un changement de rang seul (§26) ; geste depuis le bord gauche ignoré (§27) ; appui long : aperçu sans sélection (§24).

**Niveaux** : complet → minimal → immersif ; le toucher qui réveille l'interface ne sélectionne rien ; aucun masquage au clavier.

**§30 — rotation** portrait → paysage en comparaison de nuit : stade, places A et B, mode et ambiance identiques.

**§109 — endurance, 15 min** (`tests/soak.py`, gestionnaire adaptatif actif) : 135 opérations (changements de stade, de place, d'ambiance, comparaisons). Géométries GPU entre 68 et 80, 71 à la fin ; textures entre 9 et 13, 10 à la fin ; tas JavaScript stable à 65 Mo ; aucune erreur. La dégradation est bien graduelle : résolution ×1 → ×0,85 → ×0,72, puis profil Mobile → Low. Les images/s du GPU logiciel ne disent rien d'un téléphone.

**Mémoire, 11 changements de stade** : géométries 71 → 71, textures 10 → 10.

**Non-régression** : parcours §111 du brief « Presentation Ready » (version de présentation, une session, sans rechargement) : 24 étapes sur 24.

**Accessibilité** (28 contrôles sur 28) : axe-core sans violation sur 10 états, dont les nouveaux panneaux (« Où suis-je ? », « Vue », match, bande d'environnement). Le nom accessible des puces contient toujours leur texte visible (WCAG 2.5.3).

## Défauts antérieurs trouvés pendant cette passe

1. **Boutons secondaires invisibles depuis la v3.** La classe `ghost` servait à la fois à l'aperçu de place en vue siège (`display: none`) et à la variante de bouton secondaire. Résultat : « Fermer » des panneaux, « Tous les détails », « Échanger », « Effacer », « Quitter » et le « Comparer » du conseil voisin n'étaient pas affichés. L'aperçu s'appelle désormais `ghostcard`.
2. **Boutons du HUD transparents.** La variante `.btn` / `.chip`, déclarée après `.surface`, annulait le fond sombre des boutons posés sur le stade (retour, plus, son, météo). Au-dessus d'un ciel clair, le contraste était insuffisant, ce qui comptait pour la lisibilité en plein soleil (§107). Le fond est rétabli.

## Décisions contestées

1. **Pas de note sur 100 dans la barre de faits.** L'exemple du brief (« VIEW 91 ») contredit ses §11 et §60. On affiche les mots : « Très bonne vue ».
2. **Puce de match à droite en vue siège sur téléphone.** Au centre, elle chevauche la puce de position dès 390 px de large (mesuré). Elle reste au centre sur bureau et tablette, et devient compacte (score, minute) sur téléphone.
3. **Environnement en vue siège sur téléphone : dans le panneau « Vue », pas dans le HUD haut.** Il n'y a pas la place pour une troisième puce à côté de la position et du match. Le panneau « Vue » est une action nommée du dock, pas un menu « hamburger » (§111 respecté).
4. **Pas de boussole (§46).** Les noms de tribunes posés dans le monde et la mini-carte orientée suffisent. Une boussole serait de l'interface en plus, sans information nouvelle.
5. **Accès au stade : vomitoires au mur arrière de chaque niveau.** Le modèle d'accès (marches, sortie) a été aligné sur la géométrie dessinée. Avant, le niveau inférieur était censé s'ouvrir à mi-hauteur, alors qu'aucune ouverture n'y était dessinée. Les scores d'accès et « en famille » bougent légèrement. C'est une estimation, et elle est affichée comme telle.
6. **La bande de candidats apparaît souvent sur téléphone.** C'est voulu : à 390 px, un siège en vue de section mesure souvent moins de 16 px, plus petit qu'un doigt. La sélection est déjà faite (la place la plus probable) ; la bande ne sert qu'à corriger en un toucher, puis disparaît au bout d'environ 2 s.

## Protocoles sur appareil réel (§105–110)

À faire sur l'iPhone 12+ et l'Android milieu de gamme de démonstration, version publique, réseau coupé (le fichier est autonome).

1. **Une main (§105).** Tenir le téléphone d'une seule main, pouce seul. Enchaîner vue d'ensemble → section → place → Voir → Déplacer (2 places, 2 rangs) → Annuler → Comparer → retour. Noter chaque geste qui oblige à changer de prise. Critère : aucun.
2. **En marchant (§106).** Même parcours en marchant lentement. Noter les touchers ratés (place voisine choisie, bande de candidats utilisée). Critère : moins de 1 sur 5 nécessite la bande.
3. **Plein soleil (§107).** Luminosité automatique, dehors, soleil de face. Lire le prix, la puce de position et le fait affiché. Critère : lisibles sans ombrer l'écran.
4. **Nuit (§108).** Pièce sombre, ambiance Nuit. Critère : le HUD ne paraît pas plus lumineux que le stade.
5. **Chaleur, 15 min (§109).** Exploration continue (comme `tests/soak.py`). Relever toutes les 2 min les images/s (Lab › Performance, ou `__vantage.e.diag`), le profil et l'échelle de résolution choisis par le gestionnaire, et la température ressentie. Critère : plus de 35 images/s stables, aucune baisse brutale, mémoire stable.
6. **Micro-HUD (§110).** Cinq personnes qui ne connaissent pas le produit ; après 2 min de libre exploration, poser deux questions : « Y avait-il beaucoup d'informations à l'écran ? » et « Saviez-vous toujours où vous étiez et ce que coûtait la place ? ». Rejet si 2 personnes ou plus répondent oui à la première.

## Limites connues

- **Seconde vue (incrustation et côte à côte).** Elle redessine la scène : c'est le deuxième poste de coût après la vue principale. L'incrustation est rafraîchie une image sur deux, sans recalculer les ombres. La pluie est centrée sur la caméra principale, donc l'incrustation montre moins de gouttes.
- **Signalétique.** Elle est lisible de près, illisible au-delà de ~60 m, comme dans un vrai stade. L'atlas pèse au plus 2 Mo.
- **Haptique.** `navigator.vibrate` n'existe pas sur iOS Safari, donc pas de retour haptique sur iPhone. C'est sans conséquence : rien n'en dépend.
- **Plein écran.** iOS Safari sur iPhone ne le permet pas pour une page. L'option n'apparaît que si le navigateur la propose.
