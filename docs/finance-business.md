# Finance Business (FinI)

Page `/finance` (module d'accès `accounting`, fonctionnalité d'abonnement `finBusiness`, Business et Pro). Accès : **propriétaire, gérants et rôle comptable existant** ; les caissiers et magasiniers sont refusés côté serveur. **Tout est géré par boutique** (boutique active) : un compte appartient à une boutique, les virements se font entre comptes de la même boutique.

## Audit (ce qui existait, réutilisé sans copie)
- `journal_entries` (comptes 571 espèces, 5722 Wave, 5723 Orange Money, 521 banque) : ventes, remboursements, remboursements de crédit, encaissements de factures clients, règlements fournisseurs.
- `expenses` (immédiates approuvées) et `expense_payments` (dépenses différées payées en plusieurs fois).
- `cash_movements` **non rattachés** à une dépense ou à un paiement fournisseur (retraits/apports manuels) ; ceux qui y sont rattachés sont ignorés pour éviter le double comptage.
- `invoices` (clients/fournisseurs, échéances), `customers.creditBalance`, dépenses à payer.
- Le registre n'**écrit** jamais ces pièces : il les lit et les unifie (source, référence, date, auteur, statut), dédoublonné par clé.

## Nouveau schéma Appwrite (créé via MCP, colonnes vérifiées)
`fin_accounts` (nom, type caisse/banque/mobile/coffre, moyens rattachés, solde d'ouverture + date, actif), `fin_transfers` (virements, statut en attente/confirmé/annulé, motif, auteurs), `fin_reconciliations` (relevé, solde calculé, écart, correspondances, statut brouillon/clôturé), `fin_budgets` (mois, catégorie, montant). Lecture réservée au propriétaire et au module comptabilité de la boutique ; aucune écriture client.

## Règles
- **Solde = ouverture saisie + flux réels des moyens rattachés (date ≥ ouverture) + virements confirmés.** Sans solde d'ouverture, le compte est « à configurer » et **aucun solde n'est affiché**.
- **Un moyen de règlement n'alimente qu'un seul compte actif** (sinon double comptage). Les flux d'un moyen non rattaché sont signalés « non affectés », jamais perdus ni comptés.
- Soldes recalculés à chaque lecture : impossible de désynchroniser ; rejouer une demande ne double rien.
- **Virements** : création (en attente) → confirmation (vérifie le solde, les soldes d'ouverture et les dates) ; solde insuffisant refusé, forçable par un responsable avec motif ; annulation avec motif (confirmé : responsable). Idempotents (requestKey), journalisés (`audit_log`).
- **Rapprochement assisté** : l'utilisateur saisit le solde du relevé et, s'il le souhaite, ses lignes ; l'application **propose** des correspondances (même montant, ±3 jours, un flux une seule fois) que l'utilisateur confirme. Clôture : écart non nul ⇒ explication obligatoire. Les flux rapprochés ne sont plus proposés. Aucune connexion bancaire.
- **Créances / dettes** : factures clients et crédits clients ; factures fournisseurs et dépenses à payer ; vieillissement (non échu, 1-30, 31-60, 61-90, +90 jours, sans échéance).
- **Budgets** : par mois et catégorie (un seul par couple), comparés aux dépenses approuvées réelles ; états OK / à surveiller (≥ 80 %) / dépassé / sans budget.
- **Trésorerie** : total des comptes configurés, entrées/sorties 30 jours, alertes (soldes négatifs, comptes non configurés, flux non affectés, pas de rapprochement depuis 30 jours, créances/dettes échues, budgets dépassés). La « perspective à 30 jours » est **indicative** (soldes + échéances à 30 jours) : aucune vente future n'est devinée.
- **Rapports** (flux, comptes, créances/dettes, virements, budgets) exportables en PDF, Excel et CSV ; chaque export est journalisé (`fin.export`).
- Changement d'abonnement : Starter ⇒ accès refusé (402) mais **toutes les données sont conservées** ; Pro conserve tout et pourra recevoir les fonctions Pro.

## Limites assumées
- Une dépense annulée après paiement en caisse n'est pas re-créditée automatiquement : le registre suit les pièces existantes.
- Les mouvements de caisse manuels sont inclus tels quels ; l'ouverture de session (fond de caisse) n'est pas un flux.
- Pas de multi-devises, pas d'import bancaire automatique, pas de rapprochement entre boutiques (non demandé).
- Les règles fiscales/comptables relèvent du prompt Compta ultérieur ; ce module ne produit aucun avis financier.

## Fichiers
`src/domain/fin.ts` (règles pures, `fin.test.ts`), `functions/dmp-api/src/fin.ts` (actions `fin.*`, `fin.test.ts`), `src/routes/finance.tsx`, `scripts/schema.mjs`, `permissions.ts` (POLICY), e2e `j29`.
