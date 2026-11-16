# Refonte UI/UX — Phase 5, lot 1 : Caisse (audit et plan)

Date : 16/11/2026 · Statut : **à valider avant code**. Aucune règle de vente, de prix, de promotion, de stock ou de paiement n'est modifiée : le serveur reste seul juge, le client garde le même calcul d'aperçu.

## 1. Périmètre
Quatre écrans liés : **Caisse** (`/pos`, 266 lignes), **Session de caisse** (`/caisse`), **Caisse Pro** (`/caisse-pro`), **Ventes** (`/ventes`) + composants `PayPanel`, `PosPro`, `QrPay`, `Scanner`, reçu.

## 2. Audit (constats mesurés)
| # | Constat | Source | Effet pour le vendeur |
|---|---|---|---|
| 1 | Le **panier est une carte sous la grille d'articles** : sur téléphone, il faut faire défiler jusqu'en bas pour voir le total et le bouton « Encaisser » | `pos.tsx` l.167-199 | perte de temps à chaque vente ; risque d'oublier un article déjà ajouté |
| 2 | Aucune **barre de total toujours visible** | idem | le vendeur ne voit pas le montant en ajoutant |
| 3 | Grille fixe **2 colonnes** (3 en mode compact) quelle que soit la largeur | l.167 | sur tablette/ordinateur : 2 cartes très larges, beaucoup de vide, défilement inutile |
| 4 | Panier et paiement dans le **même flux vertical** que le catalogue (plus de 12 blocs conditionnels : promotions, coupon, simulation Pro, client, paiement, bouton) | l.200-206 | écran long et chargé, surtout en Pro |
| 5 | Boutons de quantité (`−`, `+`, retirer) en `!p-2` avec icône 16 px ≈ **32 px** de côté (< 44 px recommandés) | `pos.tsx` ×3, `PayPanel` ×6 | clics manqués au doigt |
| 6 | Composant `Pos` : 12 `useState` + 15 requêtes dans une seule fonction | `pos.tsx` | refonte du fichier = risque ; on ne touche que la **mise en page** |
| 7 | Quatre écrans de la caisse répartis en **quatre entrées de menu** (Caisse, Ventes, Session de caisse, Caisse Pro) | `lib/nav.ts` | décision A2 de la phase 1 : « Pro = section de son module » |
| 8 | Raccourcis clavier F2/F4/F8 **réservés au Pro** | l.149 | utiles aussi sur ordinateur en Business |
| 9 | Scénarios navigateur de la caisse périmés (`j1` : vente sans session ouverte ; j5, j12, j18) | `e2e/known-failures.json` | pas de filet sur la caisse avant la refonte |

## 3. Conception
### 3.1 Disposition de la Caisse
- **Ordinateur / tablette large (≥ 1024 px)** : deux colonnes. À gauche, recherche, filtres, catalogue (grille de 3 à 5 colonnes selon la largeur). À droite, **panneau de vente fixe** (largeur ~24 rem, défilement interne) : lignes du panier, client, promotions/coupon, simulation Pro, paiement, bouton « Encaisser ».
- **Téléphone (< 1024 px)** : le catalogue occupe l'écran ; une **barre fixe en bas** (au-dessus de la barre de navigation) affiche « N articles · total FCFA » et un bouton « Voir le panier » qui ouvre le panier en **fiche plein écran** (composant `Sheet` existant) contenant la même chose que le panneau de droite. Un seul rendu du panneau (composant extrait `SalePanel`), deux conteneurs.
- Tablette 768–1023 px : catalogue 3 colonnes + barre du bas (comportement téléphone, plus d'espace).
- Mode caisse plein écran sur téléphone : la barre de navigation de l'application est masquée **uniquement** pendant que la fiche panier est ouverte (déjà couvert par `Sheet`).

### 3.2 Contrôles
- Boutons `−`/`+`/retirer : **44 × 44 px** (zone cliquable), icône 18 px ; champ de remise et de quantité alignés sur la même hauteur.
- Total en gros caractères (1,5 rem, chiffres tabulaires), monnaie rendue bien visible.
- Raccourcis F2 (recherche), F4 (encaisser), F8 (vider) **ouverts à tous les profils** sur ordinateur (aucun changement de droit : l'action reste soumise aux mêmes conditions que le bouton).
- États vides : « Aucun article » avec lien vers Stock ; « Caisse fermée » avec bouton d'ouverture direct.

### 3.3 Les quatre écrans = un module « Caisse » avec onglets (décision A2)
- Composant `CaisseTabs` (Encaisser · Ventes · Session · Pro) affiché en tête des quatre routes, **les adresses actuelles restent inchangées** ; l'onglet Pro n'apparaît que si la formule l'autorise (même règle `smartPosPro`), les autres selon `smartPos` comme aujourd'hui.
- `lib/nav.ts` : les quatre entrées de menu deviennent **une seule entrée « Caisse »** (vers `/pos`), le reste se trouve dans les onglets. Les droits (`pos`) sont inchangés.

### 3.4 Accessibilité et mouvement
Focus visible, noms accessibles sur tous les boutons (déjà ~590 libellés), `aria-live` sur le total et sur les erreurs, ouverture de la fiche panier avec focus géré, mouvement sobre (200 ms, déjà en place).

## 4. Ce qui ne change pas
Calculs (prix, remises, TVA, arrondis), contrôles serveur, file hors ligne, idempotence des ventes, reçus 58/80 mm, QR de paiement, scanner, approbations Pro, droits par rôle, données.

## 5. Plan de réalisation
1. Extraire `SalePanel` (panier + paiement + bouton) **sans changer son contenu** ; tests existants inchangés.
2. Disposition deux colonnes ≥ 1024 px, grille adaptative, barre de total et fiche panier sur petit écran.
3. Cibles tactiles, total, raccourcis.
4. `CaisseTabs` sur les quatre routes ; entrée de menu unique.
5. **Nouveau scénario navigateur `caisse.cjs`** (versionné) : création d'articles, ouverture de session, ajout au panier, total visible sans défilement, vente espèces puis mixte, hors ligne puis synchronisation, refus serveur signalé, rôle vendeur (droits), aux trois largeurs (390 / 820 / 1280 px) avec contrôle de débordement et de noms accessibles. Réparation des étapes de caisse périmées de `j1` si elles tombent dans le périmètre.
6. Vérifications : types, 1 449 tests existants, suite navigateur comparée à la liste de référence, captures avant/après (390, 820, 1280 ; clair et sombre), puis **publication après votre relecture** (option B).

## 6. Risques
| Risque | Parade |
|---|---|
| Régression d'une vente (le cœur du produit) | aucun changement de logique ; scénario `caisse.cjs` couvrant vente simple, mixte, hors ligne, refus ; relecture ligne à ligne du diff de `pos.tsx` |
| Fiche panier mobile qui perd l'état (quantités, paiement) | un seul état dans `Pos`, le panneau n'est qu'une vue ; test d'aller-retour fermeture/ouverture |
| Clavier virtuel qui masque la barre du bas | barre positionnée avec `env(safe-area-inset-bottom)` et masquée quand un champ de saisie du panier a le focus |

## 7. Décisions à valider
| # | Décision | Recommandation |
|---|---|---|
| C1 | Panneau de vente fixe à droite ≥ 1024 px ; barre de total + fiche panier sous 1024 px | oui |
| C2 | Quatre écrans réunis en onglets avec une seule entrée de menu « Caisse » (adresses inchangées) | oui |
| C3 | Raccourcis F2/F4/F8 ouverts à tous (ordinateur) | oui |
| C4 | Cibles tactiles 44 px | oui |
