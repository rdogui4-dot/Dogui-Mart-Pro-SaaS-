# Refonte UI/UX — Phase 5, lot 2 : Stock, Articles, Bundles, Inventaire (audit et plan)

Date : 16/11/2026 · Statut : **à valider avant code**. Aucune règle de stock, de coût, de prix, de lot, de série, d'inventaire ou de droit n'est modifiée ; seule la présentation change.

## 1. Périmètre
Stock (hub Business/Pro, 344 + 228 lignes), Articles (389), Bundles (195), Inventaire (165 + Pro 133), fiches annexes (variantes 139, suivi lots/séries 188, tarifs 93, coûts 134). Environ 2 170 lignes d'interface.

## 2. Audit (constats mesurés sur captures 390 px et 1280 px)
| # | Constat | Effet |
|---|---|---|
| 1 | Le hub **Stock compte jusqu'à 12 onglets** en Pro (Tableau, Articles, Mouvements, Transferts, Alertes, Analyse, Réappro, Réseau, Anomalies, Lots, Rapports…) sur **une seule rangée à défilement horizontal**, y compris sur ordinateur où la place existe | des onglets coupés à droite, fonctions introuvables |
| 2 | Les indicateurs du tableau de stock sont en **2 colonnes fixes** : sur ordinateur, 4 lignes de grandes cartes vides au lieu de 4 colonnes | beaucoup de défilement pour 8 chiffres |
| 3 | **Articles = une carte large par ligne** sur ordinateur (une photo vignette, un nom, un prix, une pastille de stock à l'extrême droite) | impossible de comparer ou de trier visuellement 50 articles ; pas de colonnes |
| 4 | « Articles » existe à **deux endroits** : une entrée de menu et un onglet du hub Stock (comptage rapide) | confusion sur l'endroit où modifier un article |
| 5 | Toutes les fiches (article, bundle, lot, série, inventaire) s'ouvrent en **plein écran limité à 28 rem** (`Sheet` à `max-w-md`) | sur ordinateur, une fiche étroite au milieu d'un grand vide ; formulaires longs sur une seule colonne |
| 6 | **Bundles** : liste à une colonne | idem 3 |
| 7 | **Inventaire** : écran presque vide sans inventaire (texte seul), sélecteur « Tous les inventaires » plein écran, onglets Inventaires/Campagnes/Planification | pas de guidage au premier usage |
| 8 | Pas de tri/filtre mémorisé, pas de sélection multiple en Business | actions répétitives sur gros catalogues |
| 9 | Aucun scénario navigateur fiable sur ces écrans (j6, j7, j30, j3-stock listés comme périmés dans la liste de référence) | pas de filet de non-régression |

## 3. Conception
### 3.1 Hub Stock
- Onglets regroupés en **trois niveaux lisibles** au lieu de 12 à plat : rangée principale (Tableau · Articles/Comptage · Mouvements · Transferts · Alertes), puis, pour la formule Pro, une seconde rangée **« Analyses »** (Analyse · Réappro · Réseau · Anomalies · Rapports) et **« Suivi »** (Lots · Séries). Sur ≥ 768 px les rangées passent à la ligne (pas de défilement horizontal) ; sur téléphone, défilement conservé avec indicateur d'ombre à droite.
- Indicateurs en grille adaptative (`auto-fit`, 2 colonnes téléphone, 4 colonnes ordinateur).
- L'onglet « Articles » du hub devient **« Comptage rapide »** (c'est ce qu'il fait : ajuster un stock) avec un lien explicite « Modifier les fiches → Articles ».

### 3.2 Articles
- **≥ 1024 px** : tableau (`DataTable` du système de design) — vignette, article, référence, catégorie, prix, stock, statut — tri par colonne, ligne cliquable qui ouvre la fiche dans un **volet latéral** (≈ 32 rem) sans quitter la liste ; **< 1024 px** : cartes actuelles (aucune perte).
- Barre d'actions : recherche, filtres (actifs/archivés/catégorie/tri) conservés, **mémorisés par appareil**.
- Formulaires de fiche : **deux colonnes** sur ≥ 768 px (identité | prix et stock), une colonne sur téléphone.

### 3.3 Fiches (Sheet)
`Sheet` gagne une option `size` : `md` (défaut actuel, inchangé pour les écrans non migrés), `lg` (≈ 44 rem, deux colonnes de formulaire) et `panel` (volet latéral). Adoption écran par écran, jamais en masse.

### 3.4 Bundles et Inventaire
- Bundles : grille de cartes 2 à 3 colonnes ; fiche en `lg`.
- Inventaire : liste en tableau sur grand écran (référence, périmètre, statut, avancement, écart), **état vide guidé** (« Un inventaire compte votre stock sans afficher les quantités attendues. Créer le premier inventaire »), saisie de comptage conservée mobile d'abord (grandes zones tactiles 44 px).
- Hors périmètre de ce lot : Silent Smart Count (campagnes/planification) hormis les onglets, qui passent sur `Tabs`.

### 3.5 Accessibilité et mouvement
Focus visible, tableaux avec en-têtes `scope`, noms accessibles pour chaque bouton/vignette, `aria-sort` sur les colonnes triables, volet latéral avec focus piégé/restauré et fermeture par Échap, mouvement sobre (200 ms) déjà en place.

## 4. Ce qui ne change pas
Calculs de stock et de valeur, mouvements, transferts, alertes, lots/FEFO, séries, variantes, tarifs, coûts, inventaires et écarts, droits par rôle, formules, hors ligne, données.

## 5. Plan de réalisation
1. `Sheet` : options de taille (aucun écran existant modifié) + composant volet.
2. Hub Stock : regroupement des onglets, grille d'indicateurs, renommage « Comptage rapide ».
3. Articles : tableau ≥ 1024 px + volet + préférences mémorisées + formulaire 2 colonnes.
4. Bundles, Inventaire (tableau, état vide).
5. **Nouveau scénario navigateur `stock.cjs`** (versionné) : 390 / 820 / 1280 px, aucun débordement, noms accessibles ; création d'article par l'interface, ajustement de stock, tri/recherche du tableau, ouverture du volet, création d'un inventaire ; rôle sans droit « stock » (accès refusé). Réparation des étapes périmées de j6/j7/j30 si elles entrent dans le périmètre.
6. Vérifications : types, tests unitaires, suite navigateur comparée à la liste de référence, captures avant/après, **publication après votre relecture** (option B).

## 6. Risques
| Risque | Parade |
|---|---|
| Régression sur la fiche article (écran le plus riche : variantes, lots, séries, tarifs, coûts, bundles) | le contenu de la fiche n'est pas réécrit : seule la mise en colonnes et le conteneur changent ; scénario de bout en bout |
| Tableau lent sur 5 000 articles | pagination et recherche déjà en place (lots de 100) conservées ; pas de rendu de tout le catalogue |
| Préférences mémorisées qui masquent des articles (filtre oublié) | filtre actif toujours affiché avec bouton « Réinitialiser » |

## 7. Décisions à valider
| # | Décision | Recommandation |
|---|---|---|
| S1 | Onglets du hub regroupés (principal / Analyses / Suivi), sans défilement horizontal sur ordinateur | oui |
| S2 | Articles en tableau ≥ 1024 px avec volet latéral, cartes en dessous | oui |
| S3 | Onglet « Articles » du hub renommé « Comptage rapide » | oui |
| S4 | `Sheet` : tailles `lg` et `panel`, formulaires à deux colonnes sur grand écran | oui |
| S5 | Filtres/tri mémorisés par appareil, avec « Réinitialiser » visible | oui |
