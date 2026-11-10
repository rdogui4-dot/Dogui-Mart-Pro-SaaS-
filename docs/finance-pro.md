# Finance Pro (FinI Pro)

Extension de FinI Business (`/finance`, fonctionnalité `finPro`, Pro). **Même moteur, mêmes pièces d'origine, aucune seconde comptabilité** : le registre de flux, les comptes et les virements de Business sont réutilisés ; seuls les plans, scénarios, règles et budgets Pro sont enregistrés.

## Choix validés
- Approbation : seuils configurables ; **gérant** valide jusqu'au seuil propriétaire, **propriétaire** seul au-dessus.
- Horizons de prévision : 30, 60, 90, 180 et 365 jours (de 7 à 365 acceptés).
- Consolidation : **propriétaire sur toutes les boutiques, gérant sur les siennes** ; comptable et autres rôles : boutique active uniquement.

## Fonctions
- **Prévisions de trésorerie** (`finpro.forecast`) : solde projeté = solde d'ouverture des comptes configurés + cadence quotidienne habituelle (ventes, remboursements de crédits, dépenses payées, remboursements clients, mouvements de caisse manuels ; fenêtre ≤ 90 jours depuis le premier flux) × ajustements + échéances connues à leur date (créances décalées du retard moyen observé, dettes, plans). Fourchette = ± 1,645 × σ(net quotidien) × √jours (hypothèse d'indépendance annoncée). **Refus de projeter la cadence sous 14 jours d'historique**. Sans solde d'ouverture : variation cumulée seulement. Bandeau permanent : « pas un solde disponible ».
- **Réalisé / engagé / prévisionnel** affichés séparément (30 derniers jours réels, échéances connues, plans, cadence).
- **Scénarios** : ventes %, charges %, retard des créances, délai fournisseurs, événements ponctuels ; enregistrables, rejouables, archivables ; formules, hypothèses et limites expliquées à l'écran.
- **Alertes de tension** : trésorerie minimale configurable ; alerte critique datée si le central passe dessous, avertissement si la borne basse passe dessous.
- **Échéancier** (`finpro.plan.*`) : paiements et encaissements planifiés. Un plan **ne déplace aucun argent** : le paiement réel (partiel ou total) s'enregistre dans Achats, Dépenses ou Finance ; le plan est marqué « réalisé » avec la référence de la pièce. Au-dessus du seuil, un paiement planifié attend l'approbation ; un gérant ne valide pas son propre plan.
- **Seuils d'approbation** (`finpro.rules`, propriétaire seul) appliqués côté serveur aux virements internes, remboursements fournisseur et paiements planifiés ; sans Pro ou sans seuil, aucune règle.
- **Budgets multi-périodes** (mois, trimestre, année), par catégorie et service, multi-boutiques avec consolidé ; réalisé (payé), engagé (reste à payer) et reste.
- **Comparatifs** période/période et boutique/boutique ; **ventilation analytique** par catégorie, service, fournisseur ou boutique.
- **Rapprochement avancé** : tolérance de dates réglable, regroupement (plusieurs flux = une ligne du relevé), toujours confirmé à la main ; clôture exige une explication si écart.
- **Vue consolidée** des boutiques accessibles.

## Rétrogradation Pro → Business
Plans, scénarios, règles, budgets et historique restent **consultables** ; toutes les actions Pro (prévision, création, approbation, enregistrement) sont refusées (402) sans suppression.

## Sécurité et fiabilité
Module comptabilité + abonnement vérifiés côté serveur ; toutes les écritures idempotentes (requestKey), journalisées dans `audit_log` ; approbation protégée contre les doubles décisions ; aucune écriture hors de la boutique ; consolidation limitée aux boutiques de l'utilisateur.

## Limites
La prévision ne connaît ni les ventes futures réelles ni la saisonnalité ; les créances sans échéance ne sont pas projetées ; la fourchette suppose des variations indépendantes. Aucune règle fiscale ni avis financier (voir Compta).

Fichiers : `src/domain/fin-pro.ts`, `functions/dmp-api/src/fin-pro.ts`, `fin-rules.ts`, `src/routes/finance-pro.tsx`, tests `fin-pro.test.ts`, e2e `j31`.
