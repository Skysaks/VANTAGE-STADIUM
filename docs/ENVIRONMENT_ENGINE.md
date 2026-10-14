# EnvironmentEngine

`src/environment/EnvironmentEngine.ts`. L'environnement est **indépendant du lieu** : il est conservé quand on change de stade (nuit + pluie restent nuit + pluie).

## Modèle

Cible (`EnvironmentSpec`) : `minutes` (heure locale), `clouds` (`clear | partly | overcast`), `rain` (`none | light | rain | heavy`), `fog` 0–1, `wind` 0–1, `lights` (`auto | on | off`).

État interpolé (`EnvironmentLive`) : heure, couverture nuageuse, pluie, brume, vent, **humidité**, niveau des projecteurs, lumière du jour, hauteur du soleil.

Toute combinaison est valide (nuit + brouillard + pluie fine, coucher + couvert…). Chaque changement est interpolé en **3 à 6 s** (durée croissante avec l'écart d'heure : le soleil traverse le ciel), instantané en mouvement réduit ou pour une capture. L'interpolation suit l'horloge murale : une image lente ne ralentit pas l'ambiance.

## Heure et soleil

- Position solaire astronomique (précision ≈ 1°) pour la latitude, la longitude et la date de l'événement ; orientation réelle du terrain.
- Préréglages **calculés** depuis la hauteur réelle du soleil (pas d'heures codées) : Matin, Midi (culmination), Après-midi (28°), Heure dorée (7°), Coucher (0,5°), Heure bleue (−5°), Nuit (−14° ou 21 h 15). Curseur 08:00–23:00.
- L'ensoleillement de chaque place (soleil, ombre, éblouissement) est recalculé pour l'heure choisie (profil 2D des tribunes, toit, niveau supérieur, tribune d'en face).

## Ciel et nuages

Shader procédural : dégradé dépendant de la hauteur du soleil, disque et halo solaires, étoiles (masquées par les nuages), nuages fbm projetés sur un plafond, couleurs de nuages éclairés/ombrés selon l'heure (dorés au coucher), dérive selon le vent, **halo des projecteurs** sur les nuages bas et la brume la nuit.

## Pluie

- Traînées orientées par la vitesse (gravité + vent), largeur projetée avec un minimum d'un pixel : lisibles de près comme depuis la vue d'ensemble.
- Deux couches : proche (60 × 36 × 60 m autour de l'œil : profondeur, gouttes qui passent devant) et stade entier (330 × 75 × 330 m).
- **Protection par les toits** : une carte d'abri vue de dessus (`RoofMask`, 512², hauteur de la plus haute surface couvrante : toit ou dessous d'un niveau supérieur) est lue dans le vertex shader : aucune goutte sous un abri. Depuis une place couverte, la pluie tombe devant, pas sur vous.
- Gouttes plus brillantes la nuit sous les projecteurs.
- Densité plafonnée par le profil de qualité.

## Humidité

Monte en quelques secondes sous la pluie, sèche lentement (≈ 30 s). Effets : pelouse plus sombre et plus brillante, béton plus sombre et moins rugueux, **sièges exposés assombris, sièges abrités secs**, abords mouillés. La foule exposée sort capuches et ponchos (proportion croissante avec l'intensité) ; la foule abritée non.

## Brume et vent

Brouillard exponentiel : légère brume de beau temps, épaisse en brouillard, plus dense sous la pluie. Le vent incline la pluie et fait dériver les nuages.

## Projecteurs

Automatiques sous 12° de soleil, ou sous 30° par temps couvert, pluie ou brume ; forçables. Montée/descente ≈ 2 s. Effets : lumière directionnelle zénithale + remplissage, rampes et pylônes émissifs, **halos** (points additifs) et **faisceaux** visibles dans la brume et la pluie. La révélation les allume rampe par rampe (`sequence`).

## Interface

- Accès rapide : Soleil, Nuageux, Pluie, Nuit (+ Coucher dans le présentateur).
- Panneau : curseur d'heure, sept moments, réglages avancés (ciel, pluie, brume, vent, projecteurs).
- Présentateur : `D` jour, `N` nuit, `R` pluie ; « Réinitialiser » rétablit Jour · dégagé · vent neutre.
- Liens : `?env=day|morning|midday|golden|sunset|blue|night|cloud|rain|heavy|nightrain|fog`, `?t=1290` (minutes).

L'interface **ne change pas de thème** avec l'heure du stade : le HUD reste sombre et stable.
