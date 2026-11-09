# Tableau de bord Pro — rapport technique

Route `/pilotage` (tuile « Pilotage Pro »), formule Pro (`proDashboard`, vérifiée côté serveur à chaque appel), module Rapports. Le tableau Business reste accessible (premier espace « Activité », et `/activite`). Actions : `dashboard.pro` (un espace par appel), `dashboard.options` (listes de filtres), `dashboard.report` (données d'un rapport). Les fichiers PDF/Excel/CSV sont produits sur le téléphone à partir des lignes renvoyées par le serveur avec les mêmes filtres.

## 1. Audit et données réellement disponibles
| Donnée | Source | Usage |
|---|---|---|
| Ventes, lignes, paiements, vendeur | `sales` (`cashierId`, lignes JSON avec **coût de revient figé**), statut `paid` seul compté | CA, coûts historiques, vendeurs, heures |
| Coût historique | `unitCost` figé dans chaque ligne au moment de la vente | Marge réelle (changer le coût de la fiche ne réécrit jamais le passé) |
| Stock | somme de `stock_moves` (`$createdAt`), lots (`article_lots`) | Valeur, rotation, couverture, ruptures, péremption, écarts |
| Achats | `purchase_orders` (lignes, prix), mouvements `purchase` (réceptions), journal 601 | Montants, délais, prix, anomalies |
| Remboursements / annulations | **N'existent pas** | « Non calculable » (jamais « 0 ») |
| Dépenses d'exploitation | **Aucun module** | « Non calculable » ; résultat opérationnel non calculable |

## 2. Formules (affichées dans l'application, rubrique « Méthode »)
- **Comptable** : CA TTC = Σ ventes terminées ; encaissements = paiements hors crédit plafonnés au total (monnaie exclue, fractionnés une fois) ; coût des marchandises vendues = Σ quantité × coût figé (absent si une ligne n'a pas de coût) ; marge brute = CA HT − CMV ; taux de marge = marge ÷ CA HT ; taux de marque = marge ÷ CMV ; valeur du stock = quantité × coût de fiche (lots à leur coût) ; achats = débits du compte 601.
- **Commercial** : nombre de ventes, panier moyen (CA ÷ ventes), tranches horaires (heure de l'entreprise), quantiles du panier.
- **Estimatif** : rotation = CMV ÷ valeur moyenne du stock ((ouverture + clôture) ÷ 2, quantités reconstituées depuis les mouvements, valorisées au coût actuel) ; couverture = stock ÷ ventes/jour ; classes (dormant, lent, fort, surstock) selon des conventions **modifiables à l'écran**.
- La marge brute n'est jamais présentée comme un bénéfice net (bandeau permanent).

## 3. Espaces
1. **Activité (Business)** — tout le tableau Business intégré. 2. **Vue exécutive** — 14 indicateurs classés comptable/commercial/estimatif, comparaisons, contrôles de cohérence. 3. **Commercial** — évolutions jour/semaine/mois/année, comparaison période précédente et même période l'an dernier (indisponible sans données), article, catégorie, vendeur, magasin, paiement, tranche horaire, panier, meilleurs/moins bons articles. 4. **Rentabilité** — marge par article/catégorie/magasin, contribution CA vs marge, évolution des prix et coûts, ventes à perte, faible marge, coûts manquants. 5. **Stocks** — valeur par magasin, rotation, couverture, classes, ruptures fréquentes (épisodes reconstitués), expirés/proches, écarts d'inventaire, pertes. 6. **Achats** — facturé/commandé, par fournisseur, délais observés, comparaison, évolution et anomalies de prix, réapprovisionnement, historique. 7. **Magasins** — classement, écarts vs moyenne, marges, stocks, rotations, vendeurs par magasin. 8. **Prévisions** — recommandations avec période, données, méthode, fiabilité et limites ; aucune prévision sans 28 jours d'historique. 9. **Rapports** — 8 rapports en PDF, Excel (XLSX natif) et CSV.

## 4. Filtres
Période (11 présélections + personnalisée jusqu'à 400 jours), comparaison, granularité, magasin, catégories, articles, fournisseurs, vendeurs, magasins, modes de paiement, état des ventes (terminées / non finalisées), seuils de stock. Un filtre de ligne réduit chaque vente à ses lignes concernées ; tous les écrans et exports se recalculent.

## 5. Prévisions : méthodes et limites
Quantités hebdomadaires sur 12 semaines ; tendance par régression linéaire (pente ÷ moyenne, seuil ±5 %/semaine, qualité d'ajustement R²) ; demande/jour = moyenne des 4 dernières semaines ; fourchette ± écart-type ; baisse de marge = 7 derniers jours vs 28 précédents (−2 points et −10 % relatifs, coûts connus partout). Fiabilité (insuffisante/faible/moyenne/correcte) selon le nombre de points, la régularité et R² ; jamais « certaine ». Limites écrites : saisonnalité, promotions, ruptures passées, commandes en cours.

## 6. Architecture Appwrite et performance
- Aucune nouvelle table : calcul à la demande dans la fonction `dmp-api` (clé serveur jamais exposée), lectures bornées (20 000 ventes/boutique, 100 000 mouvements) avec indicateur de troncature et valeurs « non calculées » plutôt que fausses.
- **Pas d'agrégats pré-calculés** : à ce volume, un calcul reproductible vaut mieux qu'une table dérivée susceptible de diverger. Si un agrégat devenait nécessaire : clé déterministe (boutique, jour), recalcul idempotent depuis `sales`, contrôle de cohérence quotidien (somme jour = somme ventes) — les contrôles de cohérence sont déjà renvoyés à chaque appel.
- Cache : React Query (60 s) ; **Realtime** Appwrite sur `sales`, `stock_moves`, `purchase_orders` → invalidation des indicateurs (anti-rebond 1,5 s), jamais de modification locale des chiffres.
- Isolation : `tenantId` + boutiques autorisées du rôle ; aucun accès à un autre commerce ; propriétaire : toutes boutiques ; gérant/comptable : leurs boutiques.
- Pagination côté serveur (scan par pages) ; listes limitées (50–100 lignes) avec « voir tout » côté interface.

## 7. Droits d'abonnement
Business < Pro ; contrôle serveur de `proDashboard` sur les 3 actions. Retour en Business : écrans Pro verrouillés (402), **aucune donnée ni historique supprimé** ; le tableau Business continue.

## 8. Tests
`src/domain/analytics.test.ts`, `exports.test.ts` ; `functions/dmp-api/src/analytics.test.ts` (opérations réelles via `checkout`, achats, inventaire, lots) : droits Pro/rôles/isolation commerce et magasin, cohérence CA/encaissé/crédit et avec le tableau Business, non-comptage des ventes annulées/non finalisées, comparaisons (précédente, an dernier), granularités (même total), sommes par article/catégorie/vendeur/magasin/paiement/heure = total, coûts historiques (changement de coût de fiche), ventes à perte et faible marge, valeur du stock = rapports, rotation/ruptures/péremption/écarts, achats (délais, anomalies, comparaison), classement magasins, prévisions (28 jours, champs obligatoires), baisse de marge, rapports alignés sur les écrans et filtres. XLSX validé avec openpyxl.
