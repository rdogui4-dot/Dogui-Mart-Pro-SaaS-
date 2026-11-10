# Achats & fournisseurs (Business)

Page `/achats` (onglets : Tableau, Fournisseurs, Commandes, Réceptions, Factures). Réservée à la formule **Business** (Pro et « à vie » inclus). Sur Starter, la page affiche un message de verrouillage ; l'ancien écran d'achats simples reste visible dessous.

Tout est calculé et contrôlé **côté serveur** (fonction `dmp-api`, actions `purch.*`). L'interface ne calcule aucun solde.

## Principe : quatre étapes distinctes

| Étape | Ce que c'est | Effet |
|---|---|---|
| Commande | engagement auprès du fournisseur | aucun effet sur le stock ni sur l'argent |
| Réception | marchandise réellement livrée | crée le stock (quantités **acceptées** uniquement) |
| Facture | dette enregistrée | ne sort pas d'argent |
| Paiement | sortie financière réelle | jamais compté comme dépense d'exploitation |

Le tableau de bord présente commandé / reçu / facturé / payé séparément et ne les additionne jamais. « À payer » et « échu » sont des soldes à date.

## Fournisseurs
Fiche complète (nom commercial, raison sociale, contact, téléphone, WhatsApp, e-mail, adresse, identifiant fiscal, catégories, conditions de paiement, délai habituel, notes, pièces jointes). Recherche, filtres statut/catégorie. Doublon de nom : confirmation explicite. **Solde calculé** = factures − paiements réels. Archivage réversible ; **suppression refusée dès qu'il existe un historique** (commande, réception, facture ou paiement).

## Commandes
Brouillon → en attente de validation → validée → partiellement reçue → reçue ; annulée possible avant toute réception.
- Lignes issues du catalogue (remise %, unités de conditionnement), frais de transport et autres frais **explicites**, taxe **uniquement** si un taux est configuré sur la boutique.
- Validation par un gérant ; on ne valide pas sa propre commande (sauf le propriétaire).
- Après validation, toute modification passe par « Modifier (avec motif) » : historisée avant/après, jamais sous le déjà reçu, aucune ligne reçue retirée.
- Clôture du reliquat (motif) pour une commande partielle.

## Réceptions
Liées à une commande validée. Par ligne : commandé / déjà reçu / **acceptée / endommagée / refusée** / manquant. N° de bon de livraison obligatoire (même BL pour le même fournisseur → doublon à confirmer).
- Brouillon, puis **validation explicite** : les mouvements de stock sont créés **une seule fois** (identifiants déterministes), uniquement pour les quantités acceptées. Rejouer la validation ne double rien.
- Deux réceptions simultanées ne peuvent pas dépasser le restant (rang réservé dans `payment_refs`, 409 pour la seconde).
- Une réception validée ne se modifie ni ne s'annule (le stock existe) ; un brouillon s'annule avec motif.
- Les frais n'alourdissent le coût de revient qu'avec la formule Pro (coût de revient) ; le coût suit la méthode de la boutique (CMUP par défaut).

## Factures et paiements
Facture liée (facultatif) à une commande/réception validée, référence obligatoire, dates, montant TTC, TVA. **Doublons** : même référence pour le même fournisseur = refusé ; montant identique à ≤ 3 jours = confirmation explicite. Litige : bloque le paiement jusqu'à sa levée (motif tracé).
- Paiement total ou partiel, jamais au-delà du reste dû, clé d'idempotence (`paymentKey`), paiements simultanés sérialisés.
- Origine : *hors caisse* (moyens réellement configurés : espèces, banque/carte/virement, Wave et Orange Money seulement si leur lien est configuré) ou *caisse ouverte* (espèces) : crée un mouvement de caisse (`supplierPaymentId`), contrôlé contre le solde théorique, visible dans `movements.supplierOut` de la session et dans le rapport Dépenses (bloc « Paiements fournisseurs », hors total des dépenses).
- Écritures comptables équilibrées (601/4452/401, 401/trésorerie) ; en Pro, remontée au registre de caisse.

## Articles
`purch.article` : attendu (commandes validées non reçues) ≠ disponible (stock réel) ; historique des prix d'achat avec variation % (table `article_cost_events`). Les anciennes ventes gardent leur prix et coût figés.

## Droits
Magasinier : prépare des commandes/réceptions. Gérant/propriétaire : valide, factures, paiements, tableau de bord. Caissier : aucun accès. Consolidation multi-boutiques du tableau de bord : propriétaire seul (`shopId: "all"`).

## Limites connues
- Pas d'avoir fournisseur ; une facture n'est ni modifiable ni supprimable (litige + nouvelle facture).
- La validation d'une réception écrit d'abord le stock (identifiants déterministes) puis l'état de la commande : en cas de coupure entre les deux, relancer la validation termine proprement sans doubler le stock.
- Pièces jointes : JPEG/PNG/WebP/PDF, 1,8 Mo, 8 par élément (bucket `articles`).

## Réclamations et avoirs fournisseur
- **Unités endommagées ou refusées** : à la validation d'une réception, chaque unité endommagée ou refusée devient une *réclamation* (`purchase_claims`), valorisée au coût de la commande. Elle n'entre jamais dans le stock vendable. Les réceptions passées sont rattrapées automatiquement, sans doublon.
- **Décision tracée** (responsable, motif obligatoire) : renvoi au fournisseur, mise au rebut (perte valorisée) ou remise en stock après contrôle (mouvement de stock +). Une marchandise refusée ne peut que retourner au fournisseur.
- **Retour de marchandise** après facture (`purch.return`) : crée aussi une réclamation « retourné ».
- **Avoir fournisseur** (`supplier_credits`, accès responsable + comptabilité) : couvre des réclamations d'un même fournisseur, borné par leur valeur, un seul avoir par réclamation, idempotent. Il se règle de deux façons combinables : **déduction** d'une facture impayée (écriture 401/601, reste dû réduit) et **remboursement en argent** reçu (caisse ouverte ou compte : écriture compte d'argent/401, mouvement de caisse lié, flux visible dans la trésorerie Finance). Annulation possible tant qu'il n'a pas servi.
- Visible : onglet *Réclamations* des Achats et bloc sur la fiche article.
- Limite : la TVA n'est pas ventilée sur l'avoir ; les règles fiscales relèvent de la Compta.
