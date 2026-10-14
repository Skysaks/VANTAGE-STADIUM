# Décrire un lieu (VenueConfig)

Un lieu est un objet de `src/config/venues.ts`. Le moteur ne contient **aucune** donnée de stade : changer de lieu = changer de configuration. Les noms sont fictifs et remplaçables.

## Les cinq archétypes livrés

| Id (lien) | Nom | Type | Places | Particularités |
|---|---|---|---|---|
| `arena` | Vantage Arena | bol moderne, 3 niveaux | 56 444 | bol continu, toit membrane qui couvre tout, vitrine |
| `compact` | Vantage Compact | 4 tribunes droites | 23 112 | tribunes à 6–7 m de la pelouse, coins remplis, toit partiel, poteaux en tribune Face |
| `grand` | Vantage Grand | très grand bol, 3 niveaux | 83 788 | niveaux profonds, toit en porte-à-faux, échelle d'une finale |
| `classic` | Vantage Classic | 4 tribunes asymétriques | 29 726 | coins ouverts, poteaux de toit, gradinage ancien (contremarche constante), une tribune découverte |
| `olympic` | Vantage Olympic | bol avec piste | 66 116 | piste d'athlétisme, recul important, toit partiel |

Alias acceptés dans les liens : `modern`, `bowl` → `arena` ; `mega` → `grand` ; `A–D` (liens v2).

## Champs

```ts
{
  id: 'arena', archetype: 'arena', label: 'Bol moderne', name: 'Vantage Arena',
  pitchLine: 'Une phrase pour le sélecteur',
  city, country, lat, lon,          // pour le soleil astronomique uniquement
  orientationDeg: 12,               // nord géographique ↔ axe -Z du monde (soleil, mini-carte)
  layout: 'bowl' | 'stands',
  bowl?: { shape: 'superellipse' | 'track', exponent, setbackSide, setbackEnd, trackStraight?, trackRadius?, tiers, roof, stands },
  stands?: StandConfig[],           // tribunes indépendantes : setback, length, tiers, roof (ou null)
  corners?: 'open' | 'filled',
  seatWidth: 0.5, aisle: 1.2,
  floodlights: 'roof' | 'pylons',
  style: { concrete, concreteDark, stair, roofTop, roofUnder, roof: 'membrane'|'metal'|'cantilever', facade, surroundings: 'urban'|'park'|'suburban' },
  away, family?, ultras?, hospitality?   // sections par tribune / niveau / indices
}
```

Niveau (`TierConfig`) : `rows`, `rowDepth`, `riser` (contremarche **minimale**), `sections`, `overhang` (avancée sur le niveau inférieur, négatif = recul), `gap`, `firstRowHeight`, **`cTarget`**.

Toit (`RoofConfig`) : `cover` (profondeur du bord avant depuis l'avant de la tribune ; négatif = débord au-dessus du terrain), `clearance`, `columns` (un poteau toutes les N allées : source d'obstruction calculée).

## Règles de géométrie

- **Valeur C** : si `cTarget` est fourni, chaque contremarche est calculée pour garantir ce dégagement au-dessus de la tête du rang devant : `N = (C + R)(D + T) / D − R` (R = hauteur de l'œil au-dessus de la ligne de touche, D = distance horizontale, T = giron), bornée par `riser` et par une pente de 37°. Sans `cTarget` : contremarche constante (tribunes anciennes, valeur C dégradée — c'est voulu pour `classic`).
- Un bol continu utilise un seul profil pour toutes ses tribunes (sinon marches visibles aux jonctions), calculé pour la distance focale la plus courte.
- L'exposant d'une superellipse est relevé automatiquement si un coin du terrain s'approche à moins de 4 m des gradins.
- Identifiants de places stables : `104-R12-S18` (section, rang, numéro), indépendants de l'événement.

## Ajouter un lieu

1. Copier un archétype proche, changer `id`, `name`, `style`, la géométrie.
2. L'ajouter à `VENUES` et `VENUE_ORDER`.
3. `npm run build` puis, dans le Lab, onglet Scène : vérifier les états `overview`, `covered`, `far` ; onglet Caméra : simulations d'écran.

La révélation, le sélecteur (vignette calculée depuis la configuration), les scénarios et la mini-carte fonctionnent sans autre modification : ils n'utilisent que des ancres sémantiques.
