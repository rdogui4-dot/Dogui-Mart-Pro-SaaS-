# ICompta Business

Module `/icompta` (fonctionnalité `icompta`, Business et Pro ; accès : module `accounting` = propriétaire, gérants, comptable). Suivi comptable **opérationnel** compatible avec l'esprit du SYSCOHADA révisé, **sous réserve de validation par un expert-comptable** : aucun taux, compte, règle fiscale ou écriture n'est inventé. Comptabilité tenue **par boutique** (écritures, périodes, clôtures).

## Décisions validées
Validation par propriétaire et gérants (le comptable saisit/propose) · exercice = année civile, périodes mensuelles · par boutique avec vue consolidée à venir côté propriétaire · **séparation des rôles** : l'auteur d'une écriture ne la valide pas (sauf propriétaire, signalé « auto-validée »).

## Anti-vol / anti-falsification (priorité)
- **Immuabilité** : une écriture validée ne se modifie ni ne se supprime (aucune action n'existe). Correction = **contrepassation** (écriture inverse, à valider) ou **écriture corrective** liée ; une contrepassation ne se contrepasse pas ; une écriture ne se contrepasse qu'une fois.
- **Numérotation continue sans trou** (rang réservé de façon unique, même en cas de validations simultanées) et **chaîne d'empreintes SHA-256** : chaque écriture valide son contenu (journal, date, libellé, lignes, pièces, auteur, valideur, horodatage) et l'empreinte de la précédente. `ic.verify` détecte toute modification, suppression ou insertion et affiche l'**empreinte de tête** à noter.
- **Scellé de clôture** : à la clôture d'une période, une empreinte des écritures du système et d'ICompta est enregistrée ; tout ajout/changement ultérieur dans cette période est détecté (antidatage, écriture insérée après coup).
- **Périodes closes** : plus aucune écriture n'y est acceptée ; la réouverture est réservée au propriétaire, avec un motif détaillé, tracée et signalée dans les alertes.
- **Pièces justificatives obligatoires** pour soumettre une saisie manuelle ; **doublons refusés** : une pièce déjà comptabilisée par le système (vente, facture, paiement…) ou déjà saisie ne se saisit pas deux fois.
- **Alertes** : écritures auto-validées par le propriétaire, validations plus de 35 jours après leur date, périodes rouvertes, ruptures de chaîne, scellés différents.
- Tout est vérifié côté serveur (module, abonnement, rôle), idempotent (requestKey) et journalisé dans `audit_log` avec piste d'audit consultable par écriture.

## Fonctions
- **Plan de comptes** paramétrable : initialisé **uniquement** avec les 12 comptes déjà utilisés par l'application (571, 5722, 5723, 521, 411, 4191, 401, 701, 601, 31, 4431, 4452), tous « à confirmer » ; ajout par un responsable ; « confirmé par un professionnel » déclaré par le propriétaire seul. **Journaux** conventionnels VE, AC, CA, BQ, OD (à confirmer).
- **Reprise sans duplication** des écritures automatiques existantes (`journal_entries` : ventes, remboursements, paiements, factures, avoirs, retours) : elles alimentent grand livre et balance telles quelles (« source : système »).
- **Propositions d'écritures** pour les événements sans écriture (dépenses approuvées, paiements de dépenses différées, mouvements de caisse manuels) : proposition **bloquée avec la raison** tant que le compte n'est pas paramétré ; jamais comptabilisée automatiquement (devient un brouillon à valider).
- **Cycle** : brouillon → à valider → validée ou rejetée (rejet motivé, final).
- **Grand livre**, **balance** (contrôle débit = crédit), **comptes tiers** clients/fournisseurs issus des factures et règlements, **exports** PDF/Excel/CSV journalisés.
- **Clôture de période** bloquée, avec explications, si : écriture déséquilibrée, brouillon/à valider restant, événement sans écriture, pièce système déséquilibrée, compte hors plan, chaîne altérée, période antérieure non close. Contrôle informatif : événements non couverts (écarts de stock, TVA).

## Limites (à traiter avec l'expert-comptable)
TVA, impôts, amortissements, écarts d'inventaire et états financiers réglementaires ne sont pas calculés ; les comptes de charges et de contrepartie sont à paramétrer ; la chaîne protège contre les modifications courantes mais un administrateur de la base pourrait théoriquement la réécrire entièrement : conservez l'empreinte de tête (et les exports) hors de l'application.

Fichiers : `src/domain/icompta.ts`, `functions/dmp-api/src/icompta.ts`, `src/routes/icompta.tsx`, tests `icompta.test.ts`, e2e `j32`.

## Fusion Compta + Factures dans ICompta
L'ancienne page `/compta` est supprimée (elle redirige vers `/icompta`). ICompta réunit :
- **Facturation** (factures clients : création depuis une vente ou libre, encaissement, PDF) — code et données inchangés ; accès : module *factures*.
- **Synthèse, Écritures, Propositions, Livres (balance, grand livre, journal unifié), Tiers, Périodes, Plan de comptes, Exports comptables** — accès : module *comptabilité*.
- **Rapports d'activité** (ancien rapport consolidé) — accès : module *rapports*.
Les onglets affichés dépendent des modules de l'utilisateur (un vendeur qui facture ne voit pas les écritures) ; le serveur applique les mêmes droits. Le « Journal » unifié remplace l'ancien Journal, qui ne montrait que les écritures automatiques. Les factures fournisseur restent dans Achats (ICompta les lit).
