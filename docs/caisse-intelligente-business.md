# Caisse intelligente Business — rapport technique

Fonctions de caisse : formule Business ou Pro (`smartPos`, vérifiée côté serveur). La **vente de base reste disponible en Starter** (rien n'est cassé). Routes : `/pos` (vente), `/caisse` (pilotage de caisse), `/ventes` (historique).

## 1. Audit de l'existant
| Besoin | Constat | Décision |
|---|---|---|
| Recherche, scan, panier, unités, variantes, séries, promotions automatiques, coupon | Présents | Conservés ; recherche par Entrée sur SKU/code-barres exact, catégories, images, disponibilité |
| Prix, stock, remise manuelle | Serveur fait foi ; remise = gérant (`need manager`) | Champ « % » visible aux gérants seulement (le serveur refuse sinon : 403) |
| Idempotence | `clientId` → vente unique, étapes rejouables à identifiants fixes | Conservée ; testée (double validation simultanée) |
| Paiement mixte | Serveur : tableau de paiements ; interface : un seul moyen | Éditeur de paiement multi-lignes (`PayPanel`), contrôles partagés `domain/pay.ts` |
| Mobile Money | Exigeait un lien QR confirmé | Référence saisie acceptée (obligatoire, ≥ 4 car.), enregistrée avec `verified:false` — l'application ne confirme rien d'externe ; le QR reste possible si configuré |
| Sessions de caisse, écarts, sorties | **Inexistants** | `cash_sessions`, `cash_movements` |
| Annulation / remboursement | **Inexistants** | `sale_returns` (opérations tracées), mouvements de stock `return`, écriture comptable inverse |
| Historique, réimpression | Dernier ticket seulement | `sales.list`, `sale.get` (duplicata 58/80 mm tracé) |

## 2. Appwrite
Nouvelles tables (créées sur le projet avant le déploiement du code) : `cash_sessions` (fond, compté, théorique, écart, résumé figé), `cash_movements` (sortie/entrée, motif, statut, autorisation), `sale_returns` (type, montant, répartition des remboursements avec références, lignes, motif, session, points). Colonne `shops.cashRequired`. Toutes isolées par `tenantId` + `shopId`, lecture réservée au propriétaire et au personnel de la boutique, **aucune écriture client** (tout passe par `dmp-api`, clé serveur jamais exposée).
**Transactions** : l'API de transactions Appwrite n'est pas utilisée ; l'atomicité est obtenue par une *saga idempotente* (déjà en production pour la vente) : ligne d'opération créée d'abord, puis écritures à identifiants déterministes (mouvements, écritures comptables, fidélité guardée par le statut), statut final en dernier. Une coupure se reprend sans rien doubler (testé : rejeu identique, doubles requêtes simultanées).

## 3. Règles
- **Vente** : prix, remises, promotions et stock recalculés par le serveur ; numéro unique `V-AAAAMMJJ-XXXXXX` ; stock décrémenté dans la vente confirmée ; confirmation explicite côté interface avant validation.
- **Encaissement** : montants entiers ; reste à payer et monnaie en direct ; monnaie seulement sur espèces ; crédit = client + plafond ; Wave/Orange = référence obligatoire ; carte = référence facultative ; aucune validation si incohérent (interface ET serveur).
- **Session** : une session ouverte par vendeur et boutique ; solde théorique = fond + espèces encaissées (monnaie exclue) − espèces remboursées − sorties autorisées + entrées ; compté saisi à la fermeture, écart = compté − théorique ; fermeture rejouable ; sorties saisies par un caissier « en attente » (ne comptent pas) jusqu'à autorisation d'un gérant, à traiter avant la fermeture ; réglage propriétaire « session obligatoire pour vendre » (contrôle à la date de la vente, ventes hors ligne comprises).
- **Annulation / remboursement** (gérant ou propriétaire) : jamais de suppression ; vente d'origine conservée ; annulation = vente entière (statut `cancelled`, exclue du CA) ; remboursement partiel ou total par lignes/quantités, montant calculé par le serveur sur les prix et remises figés, réparti sur des moyens (espèces, Wave/Orange/carte avec référence, compte client plafonné à la dette) ; stock remis ; écriture comptable inverse ; fidélité et cumul client corrigés ; motif obligatoire. **Non géré (refus explicite)** : bundles, articles à numéro de série ou à lot.
- **Tableaux de bord** : le CA exclut les ventes annulées/remboursées en totalité ; les remboursements sont affichés (Business : carte « Remboursements » et CA net ; Pro : indicateur comptable).
- **Réimpression** : duplicata 58/80 mm marqué « DUPLICATA », trace d'audit, aucune écriture de vente ni de stock.

## 4. Limites assumées
- Remboursements partiels : la marge brute des tableaux Pro n'est pas ajustée du coût des marchandises retournées (le montant remboursé est affiché séparément).
- Les références Mobile Money/carte sont déclaratives ; aucune vérification auprès des opérateurs.
- La session est rattachée aux ventes par vendeur et période (pas de colonne sur la vente) : deux sessions simultanées du même vendeur dans la même boutique sont interdites.

## 5. Tests
`functions/dmp-api/src/cashier.test.ts` (droits et formule, sessions, solde théorique, écart, fermeture rejouable, sorties autorisées, session obligatoire, rapport vendeur, paiements incohérents/mixtes/références, prix serveur et remise, double validation, remboursement partiel et total, annulation, refus des lignes non gérées, historique et réimpression) ; `src/domain/pay.test.ts` ; parcours navigateur (ouverture, rupture, paiement mixte, confirmation, tickets, historique, remboursement, sortie, fermeture).
