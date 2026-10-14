# Licences et actifs

## Composants tiers embarqués

| Composant | Licence | Usage | Obligations |
|---|---|---|---|
| three.js 0.170 | MIT | rendu 3D | texte de licence inclus en tête de chaque fichier HTML construit ✔ |
| Inter (fontsource, sous-ensemble latin 400/500/600/700) | SIL OFL 1.1 | typographie de l'interface | police non vendue seule, nom réservé non utilisé pour une dérivée, mention incluse ✔ |
| vite, vite-plugin-singlefile, typescript, esbuild | MIT / Apache-2.0 | outils de construction (non distribués) | aucune |
| Playwright (tests), Pillow (comparaison d'images) | Apache-2.0 / HPND | tests (non distribués) | aucune |

## Actifs

Aucune image, aucun modèle 3D, aucun son, aucune police externe chargée à l'exécution. Tout est produit par le code :

- stades, sièges, foule (silhouettes dessinées en shader), joueurs (primitives), pelouse, panneaux LED, écrans géants, abords : procéduraux ;
- icônes : tracés SVG originaux (`src/ui/dom.ts`) ;
- son : synthèse Web Audio (bruit filtré, oscillateurs), muet par défaut ;
- noms de stades, de clubs, prix, disponibilités : **fictifs** ; inventaire simulé, signalé dans l'interface (« Stades, clubs, prix et disponibilités sont fictifs »), dans le Lab (« DONNÉES DE DÉMONSTRATION ») et dans les fiches (provenance de chaque mesure : calculé, estimé, simulé).

Les villes ne servent qu'au calcul du soleil ; aucun stade réel n'est reproduit.

## Statut du code par rapport au dépôt tiers

- Le dépôt `thebuggeddev/football-stadium(-kimi)` est sous **PolyForm Noncommercial 1.0.0**. Aucun code, actif ni structure n'en a été repris (audit initial : `STADIVIEW_audit_depot.md`).
- **Limite honnête** : le code de Vantage a été écrit dans une session qui avait lu ce dépôt pendant l'audit. Ce n'est **pas une salle blanche stricte** au sens procédural, même si l'architecture et l'implémentation diffèrent (génération par courbes et profils, foule en shader SDF, caméra à états, moteur d'environnement, intelligence de sélection).
- Avant toute exploitation commerciale : validation par un avocat ; si elle l'exige, réécriture des modules d'ambiance (foule, joueurs, jour/nuit) dans une session neuve, à partir de la seule spécification.

## Avant une présentation publique ou commerciale

Confirmer les droits sur : code source (ci-dessus), foule (procédurale ✔), son (synthèse ✔), polices (OFL ✔), textures (procédurales ✔), icônes (originales ✔), bibliothèques (MIT ✔). Restriction restante : la réserve juridique ci-dessus.
