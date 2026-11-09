# Caisse super intelligente Pro

Même moteur de vente que la caisse Business (`checkout`), avec les fonctions Pro en plus. Aucune donnée historique n'est modifiée ; les ventes passées gardent leurs prix, coûts et remises figés. Formule requise : **Pro** (`smartPosPro`), vérifiée côté serveur à chaque action.

## Transactions Appwrite (vérifié sur le projet réel)
`createTransaction` → `createOperations` (create avec `$permissions`, update, delete) → `updateTransaction({commit:true})` fonctionne avec node-appwrite 31.1 sur TablesDB ; un rollback ne laisse aucune ligne. `Store.batch()` l'encapsule. Une vente (stock, journal comptable, client, paiements, journal financier, audit) est validée **entièrement ou pas du tout** quand elle tient en 90 opérations ; au-delà, l'ancien enchaînement idempotent est conservé (reprise des anciennes ventes partielles comprise).

## Ce qui est garanti côté serveur
| Besoin | Mécanisme |
|---|---|
| Surventes simultanées | rang de stock par article (ligne à identifiant déterministe) : une seule vente occupe un rang ; la perdante relit le stock réel et rejoue (jusqu'à 12 fois), puis échoue proprement « Stock insuffisant » |
| Même vente envoyée deux fois | `clientId` idempotent, une seule vente / sortie de stock / écriture de journal |
| Doublon de paiement | référence (carte, Wave, Orange…) liée à UNE vente (`payment_refs`) |
| Bon d'achat dépensé deux fois | utilisation numérotée par rang : deux ventes visent le même rang, une seule réussit |
| Remise manuelle, marge | droit « remise » ou approbation ; marge sous le seuil (réglage boutique `minMarginPct`) ou sous le coût : droit « valider » ou approbation ; coût inconnu → aucune alerte inventée |
| Approbations | 15 min, une seule utilisation, liées au vendeur, à la boutique et à l'empreinte du panier ; on ne valide pas sa propre demande |
| Droits distincts | ouvrir, fermer, remise, annuler, rembourser, valider, autoriser les sorties, transférer, corriger — fixés par le propriétaire par employé |
| Journal financier | `finance_ledger` en ajout seul, empreinte SHA-256 par écriture, contrôle d'intégrité (altération, vente sans écriture, écriture orpheline) |
| Multi-caisses | une session par caisse (nom unique, même en parallèle), transfert contrôlé avec comptage, écart validé hiérarchiquement, correction tracée, performance par caisse/vendeur/boutique |
| Avoirs | remboursement en bon d'achat (code déterministe, rejouable), utilisable en paiement, nominatif possible |
| Ticket vérifiable | QR = `DMP1.numéro.total.signature` (HMAC serveur), vérifié par `sale.verify` ; émis seulement après confirmation du serveur |

## Intelligence (toujours expliquée, jamais certitude)
`pos.suggest` (ventes croisées sur 90 jours de ventes réelles, ≥ 3 ventes ; quantité habituelle ≥ 5 ventes ; habitudes du client), `pos.simulate` (calcul exact d'une vente sans écriture), `pos.insights` (panier moyen, remise, marge estimée sur les coûts connus, top articles, associations, heures d'affluence, vendeurs, anomalies avec leur seuil, prévision par moyenne des mêmes jours de semaine avec fiabilité et limites), `customer.profile` (historique, régulier = 4 achats / 90 j, fidélité, bons ; crédit seulement si une limite est accordée).

## Interface
Caisse : suggestions, favoris et densité (préférences locales), raccourcis F2/F4/F8, simulation et demande d'approbation, paiement par bon d'achat. « Caisse Pro » : approbations, écarts, performance, intelligence, journal, transfert, droits, vérification de ticket. Mode instable : la vente est mise en file locale, affichée **« en attente de synchronisation »** et jamais « confirmée » avant la réponse du serveur ; un refus définitif reste visible.

## Schéma Appwrite ajouté
Tables `payment_refs`, `pos_approvals`, `finance_ledger`, `customer_vouchers` ; colonnes `cash_sessions.register|varianceStatus|validatedBy|validatedAt|handoverFrom`, `staff.posRights`, `shops.varianceTolerance`.

## Limites assumées
- Les références de paiement ne sont **pas vérifiées auprès de l'opérateur** (aucune API opérateur branchée) ; seul le lien QR confirmé l'est.
- Le stock reste « calculé par mouvements » : le rang de stock départage les ventes ; un ajustement manuel simultané peut encore, très rarement, rendre un stock négatif — la vente est alors tracée (`stock.negative`, alerte d'intelligence) sans annulation automatique.
- Points de fidélité et crédit client : lecture puis écriture du solde (pas de verrou) ; deux ventes simultanées du même client peuvent désynchroniser légèrement le cumul.
- Remboursement/avoir : bundles, articles à série ou à lot non gérés (refus explicite).
- Les tarifs par canal ne sont pas configurables ; les remises restent celles des promotions et des règles de prix existantes.
- Ventes hors ligne : une approbation expire en 15 min ; une vente en file qui en dépend sera refusée si l'approbation a expiré.
- Le numéro de vente garde la forme `V-date-6 premiers caractères du clientId` (collision théorique) ; le journal et la vérification s'appuient sur l'identifiant de vente.
