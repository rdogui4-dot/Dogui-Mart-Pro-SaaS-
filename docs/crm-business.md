# CRM Business

Écran `/clients` (fonctionnalité `crm`, Business et Pro ; Starter garde la page Clients simple). Les fonctions existantes (crédit, encaissement, fidélité, catégorie tarifaire) restent dans l'onglet **Crédit & fidélité**.

## Audit du schéma et réutilisation
- **Réutilisé** : `customers` (clients, crédit, points, fidélité), `sales` / `sale_returns` (historique réel), `promotion_usage`, `stock_moves`/articles (articles les plus achetés), `staff` (responsables), `audit_log`.
- **Colonnes ajoutées à `customers`** : `email, company, address, source, ownerId, tags, prefs, consents, archived`.
- **Tables créées** (absentes) : `crm_leads` (prospects), `crm_opps` (opportunités), `crm_tasks` (agenda : appels, rendez-vous, tâches, relances), `crm_events` (journal chronologique, ajout seul). Toutes portent `tenantId` + `shopId` ; lecture limitée aux employés de la boutique (opportunités : gérants), écriture uniquement par la fonction `dmp-api`.

## Principes
- **Historique issu des ventes, jamais dupliqué** : achats, total, dernier achat, segment, articles les plus achetés, paiements et remboursements sont recalculés depuis `sales` (statuts payée/postée ; annulées, en attente et entièrement remboursées exclues ; remboursements partiels déduits). Une vente confirmée met donc la fiche à jour sans saisie et rejouer une vente ne crée aucun second achat.
- **Prospect ≠ client** : un prospect n'entre jamais dans la liste de la caisse. Il devient client par **conversion explicite** (identifiant déterministe → un seul client, idempotent, atomique) ou par rattachement à un client existant ; « Gagné » ne s'obtient pas par simple changement d'étape.
- **Doublons** : téléphone (9 derniers chiffres) ou e-mail identiques → 409 `DOUBLON_POSSIBLE`, confirmation explicite requise.
- **Relances** : chaque élément d'agenda conserve créateur, date de création, responsable, statut, auteur et date de clôture, résultat ou motif d'annulation. Une relance faite/annulée ne se modifie plus ; une relance suivante peut être créée en une action (idempotente).
- **Notes** : datées, signées, ajout seul, idempotentes (`requestKey`).

## Actions serveur
`crm.customers`, `crm.customer`, `crm.customer.save`, `crm.leads`, `crm.lead`, `crm.lead.save`, `crm.lead.stage`, `crm.lead.convert`, `crm.lead.archive`, `crm.opps`, `crm.opp.save`, `crm.opp.stage`, `crm.tasks`, `crm.task.save|done|cancel`, `crm.note`, `crm.dashboard`, `crm.owners`.

## Rôles
| | Caissier / module Clients | Gérant / propriétaire |
|---|---|---|
| Clients, prospects, notes, conversion | oui | oui |
| Agenda | ses éléments (responsable ou créateur) | tous, attribution à un collègue |
| Opportunités, tableau de bord, archivage, réouverture d'un élément clôturé | non (403) | oui |
Le module Stock sans module Clients n'a pas accès (403).

## Écrans
Tableau (clients par segment, pipeline pondéré, relances en retard, clients inactifs à relancer, meilleurs clients, origines) · Clients (recherche, segments, origine, tri, « mes clients », fiche complète) · Prospects (étapes nouveau → contacté → qualifié → proposition → négociation → gagné/perdu) · Opportunités (valeur, probabilité, échéance, responsable, prochaine action) · Agenda · Crédit & fidélité.

## Segments (déduits des ventes)
Sans achat · Nouveau (1er achat ≤ 30 j) · Actif · Fidèle (≥ 5 achats dont un récent) · Inactif (> 60 j, configurable côté serveur 15–365) · Dormant (> 180 j).

## Limites connues
- Données par boutique (comme les clients existants) : pas de consolidation multi-boutiques.
- Le tableau de bord Business général n'affiche pas encore d'indicateurs CRM ; la caisse n'identifie que les clients (pas les prospects).
- Aucun envoi automatique de SMS/WhatsApp/e-mail : les boutons ouvrent l'application du téléphone ; les consentements sont enregistrés avec auteur et date mais rien n'est envoyé.
- Les valeurs pondérées sont des estimations commerciales, pas du chiffre d'affaires.
- Historique recalculé en lisant jusqu'à 20 000 ventes de la boutique (coût croissant avec l'historique).
- Un prospect avec plus de ~80 éléments rattachés ne peut être converti atomiquement (clôturez d'anciennes relances).
