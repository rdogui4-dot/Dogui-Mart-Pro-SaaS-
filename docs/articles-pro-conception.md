# Articles Pro — audit du module Business et conception

## 1. Audit du module Business (état du code au moment de l'audit)

**Vérifié correct** : un seul chemin d'écriture (`saveProduct`) ; droits de formule côté serveur (`needFeature`) et interface ; isolation par commerce et boutique (tests croisés) ; prix et coût figés dans chaque ligne de vente (test : modifier l'article ne change pas la vente) ; stock = somme des mouvements (aucune écriture directe) ; suppression refusée dès qu'il y a un historique ; photos privées, droits posés par la fonction ; historique de prix ; journal d'audit ; compte à vie = formule Pro (toutes les fonctions présentes et futures s'ouvrent via `planAllows`).

**Défauts trouvés et corrigés** (tests ajoutés) :
1. Reprise après coupure : un renvoi de la même création retournait « doublon » sans recréer le stock initial ni l'historique si la coupure avait eu lieu juste après la fiche. Corrigé (écritures à identifiants fixes, rejouables).
2. Scan code-barres en caisse : un article archivé était trouvé puis refusé par le serveur (message trompeur). Corrigé.
3. Transfert entre boutiques : l'article créé dans la boutique cible perdait description et unité. Corrigé (le fournisseur et la photo restent propres à la boutique, leurs droits de lecture sont par boutique).
4. Fiche : recherche du fournisseur par liste de 200 lignes. Corrigé (lecture directe).

**Limites connues, à traiter avec le module Pro** (non corrigées car elles touchent la structure) :
- **Quantités entières seulement** : une unité « kg » ou « litre » ne peut pas se vendre en 1,5. Le Pro devra introduire une échelle de quantité par article (entiers en sous-unité) — décision de fond, voir §3.
- **Unicité SKU / code-barres** : vérifiée avant écriture, sans index unique en base (deux créations simultanées identiques pourraient passer). Le Pro ajoutera une clé d'unicité à identifiant déterministe (ligne « réservation » `sku:<boutique>:<valeur>`).
- **Caisse limitée à 500 articles chargés** et **niveaux de stock recalculés depuis tout le journal à chaque écran** : suffisant pour un petit commerce, à remplacer par une recherche serveur et des soldes de stock matérialisés pour de gros catalogues.
- **Catalogue par boutique** : chaque boutique a sa ligne `products` (copie liée par `originId` lors d'un transfert), il n'existe pas de catalogue commun unique.
- **Pas de transaction Appwrite** : les opérations multi-écritures reposent sur des identifiants fixes et des reprises (mécanisme déjà utilisé par la vente et la réception).

## 2. Principe : un seul catalogue, étendu

Le Pro **réutilise** `products` (article), `stock_moves` (journal), `sales` (lignes JSON), `suppliers`, `purchase_orders`, `audit_log`. Pas de deuxième catalogue.

| Prompt Pro | Décision |
|---|---|
| `articles` | = `products` (existant) |
| `store_articles` (prix, seuil, activation par magasin) | **Inutile** : `products` est déjà par boutique (prix, seuil `minStock`, `archived` propres à chaque boutique) |
| `article_price_history` | = `price_history` (existant) |
| `article_audit_logs` | = `audit_log` (existant) |
| `article_variants` | à créer : `productId`, `sku`, `barcode`, `attributes` (JSON clé/valeur), `price`, `cost`, `minStock`, `imageFileId`, `archived` |
| `article_units` | à créer : `productId`, `unit`, `factor` (entier ≥ 1 en unité de base), `barcode`, `price` facultatif |
| `article_price_rules` | à créer : `productId`/`variantId`, `kind` (gros, revendeur, promo, quantité, catégorie client), `minQty`, `customerCategory`, `startsAt`, `endsAt`, `price`, `priority` |
| `article_suppliers` | à créer : `productId`, `supplierId`, `supplierRef`, `price`, `leadDays`, `minQty`, `lastPrice`, `status` |
| `article_lots` | à créer : `productId`, `variantId`, `lotNo`, `manufacturedAt`, `expiresAt`, `receivedAt`, `supplierId`, `status` ; quantités par lot = somme des mouvements portant `lotId` |
| `article_serial_numbers` | à créer : `productId`, `serial` (unique par commerce+article), `status`, `saleRef`, `warrantyUntil` |
| `article_bundles` / `_components` | à créer : bundle = un `products` de type `bundle` ; composants `bundleId`, `componentId`, `qty` ; type `virtual` (composants sortis à la vente) ou `kit` (assemblage = mouvements d'entrée/sortie) |

Extensions de l'existant : `stock_moves` gagne `variantId`, `lotId`, `serial`, `unit`, `unitQty` (traçabilité de l'unité vendue) ; la ligne de vente gagne `variantId`, `unit`, `unitQty`, `priceSource` (règle appliquée) ; `products` gagne `tracking` (aucun / lot / série), `kind` (simple / bundle), `qtyScale`.

## 3. Règles métier à figer avant le code

- **Stock** : toujours en unité de base, en entiers à l'échelle de l'article (`qtyScale` : 0 = pièces, 3 = kg au gramme). Une vente en carton ×2 = 24 pièces ; aucune division : les conversions sont des multiplications entières → pas d'erreur d'arrondi.
- **Prix, priorité (la plus haute gagne)** : promotion en cours > prix catégorie de client > palier de quantité (le plus grand `minQty` atteint) > gros/revendeur selon le client > prix de détail. À égalité : `priority` puis règle la plus récente. Le prix retenu et sa source sont écrits dans la ligne de vente.
- **Lots** : sortie FEFO (expiration la plus proche d'abord, lots expirés exclus si la politique « interdire la vente de lots expirés » est active). **Séries** : une série n'existe qu'une fois ; vendre exige le statut « disponible ».
- **Bundle virtuel** : disponibilité = min(⌊stock composant / quantité⌋) ; la vente génère un mouvement par composant (référence = vente). Un kit physique a son propre stock, alimenté par un ordre d'assemblage.
- **Valorisation** : une méthode par boutique (coût moyen pondéré par défaut, cohérent avec les rapports actuels) ; changement de méthode = décision explicite journalisée, jamais mélangée.
- **Droits** : chaque action Pro appelle `needFeature(store, ctx, <fonction>)` côté serveur et `planAllows` côté interface. Retour à Business : données conservées, **lecture** autorisée, **création/modification/vente avec variantes, lots, séries ou bundles** refusée en 402.
- **Alertes** : calculées par une fonction planifiée, une ligne par (type, article, jour) à identifiant déterministe → dédupliquées et traçables.

## 4. Plan de réalisation (chaque phase : serveur + tests + interface + vérification réelle)

1. **Quantités et unités** : échelle de quantité, conversions, traçabilité de l'unité dans stock et ventes.
2. **Variantes** : table, stock par variante, caisse, inventaire, transferts.
3. **Tarification** : règles, résolution de prix, prix figé par ligne.
4. **Fournisseurs multiples, coûts, marges, valorisation**.
5. **Lots / FEFO et numéros de série**.
6. **Bundles**.
7. **Tableau de bord Articles Pro et alertes**.

Opérations manuelles Appwrite : aucune pour l'instant ; chaque phase crée ses colonnes et index (script `schema.mjs` + application sur le projet) et le dira.

## 5. Avancement

- **Phase 1 — quantités et unités : faite** (serveur, tests, interface, schéma Appwrite appliqué et vérifié par écriture/relecture réelle d'un coefficient et d'un mouvement en sous-unités). Colonnes : `products.qtyScale`, `stock_moves.unit` / `unitQty` ; table `article_units`.
- Décision appliquée : quantités en entiers de sous-unités ; `stock_moves.qty` reste un entier, ce qui laisse intactes toutes les anciennes données (échelle 0).
- Restent : phases 2 à 7.
