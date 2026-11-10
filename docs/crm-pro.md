# CRM Pro

Extension du CRM Business (`/clients`, fonctionnalité `crmPro`, Pro uniquement). **Même moteur et mêmes identifiants** : mêmes clients (`customers`), prospects (`crm_leads`), opportunités, relances (`crm_tasks`) et journal (`crm_events`) ; l'historique d'achat reste calculé depuis les ventes confirmées (aucune duplication). Au retour en Business, tout est conservé ; seules les fonctions Pro se referment (402).

## Audit et schéma
Réutilisé : `customers` (consentements, préférences, responsable, étiquettes, fidélité), `sales`/`sale_returns`, `promotion_usage`, `products` (catégories), `crm_*` du Business, `audit_log`. **Tables ajoutées** (absentes, vérifiées disponibles) : `crm_config` (paramètres et règles de fidélité), `crm_segments`, `crm_campaigns`, `crm_targets`, `crm_rules`, `crm_runs` (journal des automatisations), `crm_teams`. Chaque ligne porte `tenantId` + `shopId` ; écriture uniquement par `dmp-api`.

## Fonctions
- **Segmentation** : RFM (récence, fréquence 12 mois, valeur relative à la médiane) en segments nommés avec barèmes affichés ; critères combinables (récence, fréquence, valeur, catégorie achetée, promotions, crédit, origine, étiquette, consentement) ; segments enregistrés avec effectifs ; aperçu avec éligibilité par canal.
- **Scores explicables** : potentiel de réachat (client) et maturité commerciale (prospect) = somme de critères affichés avec leurs points et leurs données ; « non évaluable » sous 2 achats ; mention permanente « ni une prédiction certaine ni une décision automatique ».
- **Campagnes** (préparation de contacts, **aucun envoi externe**) : cible, objectif, message ({prénom}), canal (WhatsApp, SMS, e-mail), dates, budget, statut. Brouillon → autorisée (autre personne que l'auteur, ou propriétaire) → en cours → terminée/annulée. Les cibles sont figées au démarrage : coordonnée du canal + consentement du canal + délai minimal depuis le dernier contact (toutes campagnes). Au moment du contact, consentement et fréquence sont revérifiés (sinon la cible est écartée). Désabonnement = retrait immédiat du consentement du canal, tracé. Résultats : contactés, réponses, achats attribués (ventes du client dans la fenêtre qui suit le contact : corrélation, pas causalité), ROI, désabonnements. Cibles en échec visibles et rejouables.
- **Autorisation du propriétaire** : campagnes et automatisations sont **désactivées** tant que le propriétaire ne les a pas autorisées (paramètres CRM Pro, avec délai de fréquence et fenêtre d'attribution).
- **Automatisations** : 5 déclencheurs vérifiés (premier achat confirmé, client inactif N jours, niveau de fidélité atteint, prospect sans activité, opportunité en retard) → **tâches internes** (jamais de message). Idempotence par clé d'événement (`règle|sujet|jeton`), plafond de 50 tâches par règle et par exécution, journal complet (`crm_runs`), échecs visibles (responsable introuvable, panne d'écriture…) et **rejouables** (jusqu'à 5 tentatives, sans doublon).
- **Analyses** : valeur client (historique, projection 12 mois seulement avec ≥ 3 achats), rétention 90 j, réachat 30/60/90 j, cohortes, inactivité, conversion par origine et responsable, taux de gain, prévision du pipeline (pondérée déclarative ; ajustée au taux de gain historique seulement avec ≥ 10 clôturées) et projection des ventes (≥ 3 mois).
- **Équipes** : équipes, membres, objectifs mensuels, attribution groupée de portefeuille (tracée), performance par commercial (portefeuille, ventes, conversion, opportunités, ponctualité des relances).
- **Fidélité configurable** (propriétaire) : montant par point, valeur du point, plafond d'utilisation, seuils et bonus Argent/Or, avantages affichés ; règles décrites en clair, passif de points ; **appliquées aux ventes futures** (caisse, retours, aide à la vente) sans jamais recalculer l'historique ; historique des changements.
- **Consentements** : historique (auteur, date) des changements et désabonnements.

## Actions serveur
`crmpro.settings(.save)`, `crmpro.segments`, `crmpro.segment.preview|save`, `crmpro.insight`, `crmpro.analytics`, `crmpro.campaign.save|approve|start|close`, `crmpro.campaigns`, `crmpro.campaign`, `crmpro.target.contact|reply|skip|retry|optout`, `crmpro.consents`, `crmpro.rule.save`, `crmpro.rules`, `crmpro.run`, `crmpro.runs`, `crmpro.run.retry`, `crmpro.team.save`, `crmpro.teams`, `crmpro.portfolio.assign`, `crmpro.loyalty(.save)`.

## Droits
Module Clients + formule Pro côté serveur. Gérants : segments, campagnes, règles, équipes, analyses. Propriétaire seul : autorisations (campagnes, automatisations) et règles de fidélité. Tout employé du module Clients : fiche enrichie (score) et exécution des contacts de campagne.

## Limites connues
- Aucun envoi automatique : les liens WhatsApp/SMS/e-mail ouvrent l'application du téléphone ; l'équipe confirme le contact. Pas de reçu de lecture.
- Un employé peut re-cocher un consentement après un désabonnement : l'événement est tracé (auteur, date) mais non bloqué.
- Les automatisations s'exécutent à la demande (« Exécuter maintenant »), pas par planification automatique ; l'idempotence garantit qu'un événement n'est traité qu'une fois.
- Les poids des scores sont fixés par convention (affichés), pas appris ; l'attribution des ventes aux campagnes est temporelle.
- Les retours de vente restituent les points avec les règles de fidélité en vigueur au moment du retour.
- Calculs relus sur jusqu'à 20 000 ventes par boutique ; 500 cibles maximum par campagne.
- Données par boutique (comme les clients) ; objectifs d'équipe en mois civil UTC.

## Suspension WhatsApp (décision du propriétaire, jusqu'à nouvel ordre)
L'envoi WhatsApp est suspendu : `SUSPENDED_CHANNELS` (src/domain/crm-pro.ts). Création, autorisation, démarrage et contact d'une campagne WhatsApp sont refusés (409) côté serveur ; le canal n'est plus proposé, les liens `wa.me` sont retirés du CRM, et l'éligibilité n'affiche plus que SMS et e-mail. Les consentements WhatsApp restent enregistrés et l'historique est conservé. Pour réactiver : retirer `whatsapp` de `SUSPENDED_CHANNELS`.
