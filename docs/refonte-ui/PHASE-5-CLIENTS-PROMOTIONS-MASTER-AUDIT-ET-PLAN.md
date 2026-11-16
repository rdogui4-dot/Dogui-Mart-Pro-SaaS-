# Refonte UI/UX — Phase 5, lot 4 : Clients, Promotions et MASTER DOGUI en fenêtre (audit et plan)

Date : 16/11/2026 · Statut : **à valider avant code**. Aucune règle CRM, de score, de campagne, de remise, de coupon, de budget, de licence, de rapport ou d'assistant n'est modifiée ; seule la présentation change.

## 1. Périmètre
- **Clients** (`simple.tsx` → hub CRM `crm.tsx` 369 lignes + `crm-pro.tsx` 361) ;
- **Promotions** (`promotions.tsx` 256, `promo-pro.tsx` 191, `promo-shared.tsx` 37) ;
- **MASTER DOGUI** (`master.tsx` 130 + onglets Rapports, Profil, Recommandations, Assistant) : passe d'une **page** à une **fenêtre** (consigne du propriétaire : « MASTER DOGUI doit être un pop-up »).

## 2. Audit (captures 390 px et 1280 px)
| # | Constat | Effet |
|---|---|---|
| 1 | **Clients : jusqu'à 11 onglets** (Tableau, Clients, Prospects, Opportunités, Agenda, Segments, Campagnes, Automatisations, Équipes, Analyses…) sur une rangée à défilement, le dernier coupé même sur ordinateur | fonctions introuvables ; aucune hiérarchie |
| 2 | **Promotions : 10 onglets** (Campagnes, Calendrier, Coupons, Budgets, Performance, Magasins, Conseils, Réglages, Journal, Résultats) en une rangée coupée à droite ; cadenas 🔒 en emoji sur les onglets Pro | idem ; emoji hors charte sobre |
| 3 | Indicateurs du tableau Clients en **2 colonnes fixes** (6 cartes sur 3 lignes) ; « Clients par segment » en liste étroite pleine largeur | beaucoup de vide sur ordinateur |
| 4 | **Promotions : le bouton « Nouvelle campagne » occupe toute la largeur** ; filtres (statut, recherche, type, article, catégorie, deux dates) empilés sur 5 lignes | la liste des campagnes est repoussée sous l'écran |
| 5 | Listes (clients, prospects, opportunités, campagnes, coupons) en **cartes empilées** | pas de colonnes à comparer (dernier achat, solde, valeur, statut, période) |
| 6 | **MASTER DOGUI est une page** du menu « Piloter » à 5 onglets (Licence, Rapports, Profil, Recommandations, Assistant) ; l'utilisateur quitte son travail pour le consulter, et l'assistant n'est pas joignable depuis la caisse ou le stock | contraire au besoin exprimé : une aide à portée de main, qui ne fait pas perdre sa place |
| 7 | Rappels et briefing MASTER déjà affichés sur l'accueil (`MasterBriefing`, `MasterReminder`) mais **sans lien direct vers la fenêtre** | parcours dispersé |
| 8 | Scénarios navigateur j28 (CRM Pro), j13/j15 (promotions) périmés ou instables dans la liste de référence | pas de filet fiable |

## 3. Conception
### 3.1 Clients
- Onglets **regroupés** (rangées étiquetées, comme Stock et Achats) : **Suivi** (Tableau, Agenda) · **Relations** (Clients, Prospects, Opportunités) · **Pro** (Segments, Campagnes, Automatisations, Équipes, Analyses) ; cadenas en icône (pas d'emoji) avec explication de la formule au clic.
- Tableau de bord : indicateurs en 3 à 6 colonnes selon la largeur ; « Clients par segment » et « Pipeline des opportunités » côte à côte sur ordinateur.
- Clients, Prospects, Opportunités : **tableaux ≥ 1024 px** (nom, téléphone, segment, dernier achat, total, solde de crédit / étape, valeur, probabilité, prochaine relance), ligne cliquable → fiche en volet latéral ; cartes en dessous. Recherche et filtres en barre adaptative, mémorisés par appareil, « Réinitialiser » visible.

### 3.2 Promotions
- Onglets **regroupés** : **Campagnes** (Campagnes, Calendrier) · **Suivi** (Performance, Journal, Résultats) · **Pro** (Coupons, Budgets, Magasins, Conseils) · **Réglages**.
- Bouton « Nouvelle campagne » **à droite de l'en-tête** (largeur naturelle) ; filtres en une ou deux lignes sur ordinateur, repliés derrière « Filtres (n) » sur téléphone ; filtres mémorisés (hors dates).
- Liste des campagnes en **tableau ≥ 1024 px** (nom, type, période, statut, utilisations, remise cumulée), fiche en volet latéral ; formulaire de campagne en fiche large.

### 3.3 MASTER DOGUI en fenêtre (pop-up)
- **Fenêtre modale** : sur ordinateur/tablette ≥ 768 px, fenêtre centrée (≈ 48 rem de large, ≤ 88 % de la hauteur) avec fond atténué et fermeture par Échap, par la croix ou par clic à l'extérieur ; sur téléphone, plein écran avec bouton Fermer. Même contenu qu'aujourd'hui : les 5 onglets (Licence, Rapports, Profil, Recommandations, Assistant).
- **Accès permanent** : bouton « MASTER DOGUI » **dans la barre supérieure** de toutes les pages (visible dès que le profil a le droit d'y accéder, comme aujourd'hui) ; l'entrée du menu « Piloter » reste et **ouvre la fenêtre** au lieu de changer de page ; les rappels et le briefing de l'accueil ouvrent la fenêtre sur le bon onglet.
- **Adresse conservée** : `/master` et `/merci` (retour de paiement Selar) restent valides et ouvrent la fenêtre par-dessus l'accueil, donc aucun lien existant ne casse ; fermer la fenêtre ramène à l'écran précédent.
- **Continuité** : la fenêtre n'interrompt rien (un panier en cours à la caisse reste intact), garde son onglet et la saisie en cours de l'assistant tant qu'elle n'est pas fermée, et reste utilisable hors ligne en consultation comme aujourd'hui.
- Accessibilité : focus piégé dans la fenêtre puis restauré sur le bouton d'origine, `role="dialog"` nommé, Échap, lecteur d'écran.

### 3.4 Accessibilité et mouvement
Tableaux avec en-têtes `scope`, statuts en texte (jamais la couleur seule), noms accessibles, focus visible, mouvement sobre (200 ms) déjà en place.

## 4. Ce qui ne change pas
Segmentation RFM, scores, éligibilité et consentements, campagnes et automatisations, fidélité et crédit, calcul et priorité des remises, coupons, budgets de promotion, licence et paiement MASTER, génération des rapports, recommandations, assistant et plafonds, droits par rôle, formules, hors ligne, données.

## 5. Plan de réalisation
1. Composants communs : `Sheet` en variante **modale centrée** (réutilisable), `GroupedTabs` (rangées étiquetées) extrait des écrans Stock/Achats pour réutilisation (sans changer leur rendu).
2. MASTER en fenêtre : contexte d'ouverture, bouton de barre supérieure, entrée de menu, route `/master` et `/merci` ouvrant la fenêtre, liens des rappels/briefing ; **adaptation du scénario `master.cjs`** (même 9 vérifications, contenu identique, dans la fenêtre).
3. Clients : onglets regroupés, tableaux, filtres mémorisés.
4. Promotions : onglets regroupés, en-tête, filtres, tableau.
5. **Nouveaux scénarios `clients-promotions.cjs`** (390 / 820 / 1280 px, noms accessibles, tableaux, volets, filtres mémorisés, création d'un client et d'une campagne) et **`master.cjs` mis à jour** (ouverture depuis la barre supérieure, Échap, retour à l'écran précédent, deep link `/master` et `/merci`).
6. Vérifications : types, tests unitaires, suite navigateur comparée à la liste de référence, captures avant/après, **publication après votre relecture**.

## 6. Risques
| Risque | Parade |
|---|---|
| Rupture du retour de paiement Selar (`/merci`) | l'adresse reste valide et ouvre la fenêtre ; scénario dédié |
| Fenêtre MASTER qui masque un travail en cours | fenêtre modale fermable sans perte ; état de l'écran dessous conservé (pas de navigation) |
| Hauteur de l'assistant (conversation longue) dans une fenêtre | défilement interne de la conversation, zone de saisie fixe en bas |
| Régression du CRM Pro (volumineux) | seul le conteneur (onglets, liste, volet) change ; scénario de bout en bout |

## 7. Décisions à valider
| # | Décision | Recommandation |
|---|---|---|
| P1 | Onglets de Clients et de Promotions regroupés en rangées étiquetées, cadenas en icône | oui |
| P2 | Listes principales en tableaux ≥ 1024 px avec volet latéral | oui |
| P3 | Filtres adaptatifs mémorisés (hors dates), bouton « Nouvelle campagne » en en-tête | oui |
| P4 | **MASTER DOGUI = fenêtre modale**, ouverte par un bouton de la barre supérieure et par l'entrée de menu ; `/master` et `/merci` conservés | oui |
| P5 | Sur téléphone, la fenêtre MASTER est plein écran (pas de fenêtre flottante réduite) | oui |
