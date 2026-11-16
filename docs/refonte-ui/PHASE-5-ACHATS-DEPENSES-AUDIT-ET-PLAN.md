# Refonte UI/UX — Phase 5, lot 3 : Achats et Dépenses (audit et plan)

Date : 16/11/2026 · Statut : **à valider avant code**. Aucune règle d'achat, de réception, de facture, de paiement, de budget, d'approbation, de plafond, de justificatif ou de droit n'est modifiée ; seule la présentation change.

## 1. Périmètre
Achats & fournisseurs (`fournisseurs.tsx` 367 lignes + `achats.tsx` 229 + `reclamations.tsx` 115), Dépenses (`depenses.tsx` 222), Dépenses Pro (`depenses-pro.tsx` 135). Environ 1 070 lignes d'interface, 4 entrées de menu.

## 2. Audit (captures 390 px et 1280 px)
| # | Constat | Effet |
|---|---|---|
| 1 | **Achats : 6 onglets** (Tableau, Fournisseurs, Commandes, Réceptions, Réclamations, Factures) en une rangée à défilement, sans regroupement | onglets coupés sur téléphone ; pas de hiérarchie |
| 2 | **Filtres empilés pleine largeur** : sur ordinateur, Dépenses affiche une recherche + 2 dates + 5 listes déroulantes sur 5 lignes de 1 000 px de large ; Achats : 2 dates + 1 liste, chacune sur sa ligne | la liste réelle des dépenses est repoussée sous l'écran |
| 3 | Indicateurs en **2 colonnes fixes** (8 à 12 cartes) sur ordinateur | longue colonne de cartes vides à l'écran |
| 4 | Toutes les **listes sont des cartes empilées** (fournisseurs, commandes, réceptions, factures, dépenses) | pas de colonnes à comparer (date, montant, statut, échéance) ni de tri visuel sur ordinateur |
| 5 | « Dépenses » et « Dépenses Pro » sont **deux entrées de menu** (même constat que la caisse) | décision A2 : le Pro est une section du module |
| 6 | Filtres et période **non mémorisés** : retour sur l'écran = filtres remis à zéro | répétition à chaque ouverture |
| 7 | Fiches de saisie (commande, réception, facture, dépense) en plein écran étroit (28 rem) | formulaires longs sur une colonne même sur grand écran |
| 8 | Textes explicatifs longs au milieu des écrans (« Commandé, reçu, facturé et payé sont quatre mesures distinctes… ») | utiles mais bruyants : à placer dans une aide dépliable |
| 9 | Scénarios navigateur : j3 (achats), j20 (dépenses) périmés dans la liste de référence | pas de filet fiable |

## 3. Conception
### 3.1 Composants communs (système de design)
- **`FilterBar`** : grille adaptative (`auto-fit`, colonnes ≥ 11 rem) pour les filtres : sur ordinateur, tous les filtres tiennent sur **1 à 2 lignes** ; sur téléphone, recherche pleine largeur puis filtres en 2 colonnes, les filtres secondaires repliés derrière « Filtres (n) ». Filtres actifs rappelés en pastilles, bouton « Réinitialiser ».
- **Préférences par appareil** : période, filtres et vue mémorisés (même mécanisme que les Articles), jamais le texte de recherche.
- **`DataTable`** (déjà dans le design system) adopté pour les listes principales **≥ 1024 px** : en-têtes `scope`, ligne cliquable qui ouvre la fiche existante, montants alignés à droite en chiffres tabulaires, pastilles de statut ; cartes conservées en dessous.
- **`Sheet` `lg`** pour les formulaires de saisie (deux colonnes ≥ 768 px).

### 3.2 Achats
- Onglets regroupés : **Suivi** (Tableau) · **Achats** (Commandes, Réceptions, Factures) · **Tiers** (Fournisseurs, Réclamations), affichés en une ou deux rangées sans défilement sur ordinateur.
- Tableau de bord : indicateurs en 4 colonnes ; textes d'explication déplacés dans un bloc « Comment lire ces chiffres » dépliable (contenu inchangé).
- Commandes, Réceptions, Factures, Fournisseurs : tableaux ≥ 1024 px (numéro, fournisseur, date, montant, statut, échéance/solde selon l'écran).

### 3.3 Dépenses (Business + Pro en un module)
- `ExpensesTabs` (comme `CaisseTabs`) : **Dépenses · Rapports · Réglages** (Business) puis **Budgets et prévisions** (Pro) ; une seule entrée de menu « Dépenses » (adresses `/depenses` et `/depenses-pro` inchangées, onglet Pro selon la formule `expensesPro`).
- Liste en tableau ≥ 1024 px (date, libellé, catégorie, bénéficiaire, moyen, montant, statut, justificatif) ; filtres en `FilterBar`.
- Création de dépense en fiche large.

### 3.4 Accessibilité et mouvement
Tableaux avec en-têtes `scope`, noms accessibles sur toutes les actions, focus visible, montants avec unité, pas de couleur seule pour les statuts (texte dans la pastille), mouvement sobre existant.

## 4. Ce qui ne change pas
Circuits de validation, approbations et plafonds, paiements partiels, justificatifs PDF, sorties de caisse rattachées à la session, budgets et prévisions, soldes et échéances, historique des prix, droits par rôle, formules, hors ligne, données.

## 5. Plan de réalisation
1. `FilterBar` + préférences mémorisées (composants testés isolément).
2. Achats : onglets regroupés, indicateurs 4 colonnes, aide dépliable, tableaux ≥ 1024 px.
3. Dépenses : `ExpensesTabs`, entrée de menu unique, `FilterBar`, tableau, fiche large.
4. **Nouveau scénario `achats-depenses.cjs`** (versionné) : 390 / 820 / 1280 px sans débordement ni élément sans nom ; création d'un fournisseur, d'une commande et d'une dépense par l'interface ; tableau, ouverture de fiche, filtres mémorisés ; accès refusé sans droit. Réparation de j3/j20 dans le périmètre si possible.
5. Vérifications : types, tests unitaires, suite navigateur comparée à la liste de référence, captures avant/après, **publication après votre relecture**.

## 6. Risques
| Risque | Parade |
|---|---|
| Filtres repliés qui masquent un filtre actif | pastilles des filtres actifs toujours visibles + « Réinitialiser » |
| Régression de saisie d'une commande ou d'une facture | seul le conteneur de la fiche change ; scénario de bout en bout ; aucune modification des champs ni des contrôles |
| Menu : perte d'accès à Dépenses Pro | onglet Pro visible selon la même règle de formule ; adresse inchangée |

## 7. Décisions à valider
| # | Décision | Recommandation |
|---|---|---|
| E1 | Filtres en barre adaptative, repliable sur téléphone, mémorisés par appareil | oui |
| E2 | Listes principales en tableaux ≥ 1024 px (cartes en dessous) | oui |
| E3 | Dépenses et Dépenses Pro réunis en un module à onglets, une entrée de menu | oui |
| E4 | Onglets d'Achats regroupés (Suivi / Achats / Tiers) et textes d'explication dans une aide dépliable | oui |
