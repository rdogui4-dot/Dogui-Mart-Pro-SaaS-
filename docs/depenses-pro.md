# Dépenses Pro

Version Pro de la gestion des dépenses, **sur les mêmes données** que le module Business (table `expenses` et ses événements, mouvements de caisse, sessions) : aucune dépense n'est dupliquée ni altérée. Abonnement Pro vérifié côté serveur (`expensesPro`) pour toute action Pro.

## Données ajoutées
| Élément | Rôle |
|---|---|
| `expenses` + `dueOn`, `paidAmount`, `payMode`, `recurringId`, `service` | échéance, paiement différé et montant payé, lien vers un modèle récurrent, service ; ventilation, circuit et signaux dans `meta` |
| `expense_payments` | paiements partiels (rang de paiement dans l'identifiant : deux paiements simultanés → un seul) |
| `expense_config` | budgets, plafonds par responsable, circuits d'approbation, modèles récurrents, échéances planifiées, soldes déclarés (type + configuration JSON, versions, journal d'audit des anciennes valeurs) |

## Cycle de vie d'une dépense
Planifiée (échéance générée par un modèle, hors table `expenses`) → En attente (validation) → Validée/Engagée (à payer) → Partiellement payée → Payée ; Rejetée / Annulée conservent leur historique. Une dépense « immédiate » validée est payée en totalité (comportement Business inchangé).

## Règles garanties côté serveur
- **Budgets** mensuels, trimestriels, annuels, par boutique, catégorie et service (réalisé / en attente / planifié distincts). Un dépassement **n'est jamais validé automatiquement** : un autre responsable doit valider ; le propriétaire doit confirmer avec un motif tracé ; un budget « bloquant » refuse tout responsable.
- **Plafonds** par dépense et par mois par responsable : même effet qu'un dépassement de budget.
- **Circuit d'approbation** configurable (montant, catégorie, boutique ; 1 à 4 niveaux gérant/propriétaire). Chaque niveau exige un responsable différent ; le propriétaire franchit seul tous les niveaux (tracé). Compatible avec le code de validation (chaque code d'un responsable valide un niveau). Le circuit s'applique **quel que soit l'abonnement** une fois la dépense créée.
- **Paiements partiels** : solde restant exact, trop-payé refusé, paiement en espèces depuis la caisse (session ouverte, solde vérifié, sortie dans la clôture) ou compte externe ; idempotence par clé ; annulation refusée après un paiement.
- **Récurrentes et planifiées** : génération idempotente des échéances (modèle + date), engagement en dépense (une seule, identifiant déterministe), passage ignoré avec motif.
- **Ventilation** entre boutiques (pourcentages ou montants à somme exacte), réservée au propriétaire ; correction tracée avant/après avec motif ; budgets et rapports comptent la part de chaque boutique.
- **Permissions** : propriétaire partout ; un responsable local configure uniquement sa boutique ; employé sans droit de valider : aucun accès aux analyses.

## Intelligence (signaux explicables, jamais des certitudes)
Variation inhabituelle par catégorie (≥ 3 mois d'historique), doublons potentiels (≤ 3 jours), dépenses répétées, récurrences détectées non modélisées, validations sans contrôle indépendant, attentes anciennes, échéances dépassées, alertes budgets, comparaison des prix fournisseurs (fiches article-fournisseur, ≥ 2 fournisseurs). Chaque signal donne sa base ; les recommandations donnent données, période et limites.

## Trésorerie
Quatre notions **toujours distinctes** : solde de caisse (espèces théoriques des sessions ouvertes, calculé), soldes bancaire/mobile/coffre (**uniquement déclarés** par un responsable à une date, jamais déduits des ventes ; relevés conservés), encaissements enregistrés (par moyen, crédit exclu, présentés comme non garantis) et engagements/dépenses payées. Projection indicative : ouverture + entrées moyennes (espèces par défaut) − échéances, planifiées, en attente (option) et dépenses courantes (option). **Solde d'ouverture inconnu = aucun solde affiché** (flux seuls). Scénarios modifiables : variation des ventes, part non-espèces disponible, décalage des paiements, sorties supplémentaires, seuil de sécurité. Alerte de manque de liquidités avec hypothèses, méthode, limites et fiabilité.

## Rapports
Synthèse budgétaire et écarts, à valider, à payer, sorties de caisse par session, récurrentes, par responsable, par boutique (ventilation), par catégorie, détail ; filtres période/catégorie/statut/responsable/cycle ; exports PDF, Excel, CSV.

## Abonnement
Retour à Business : les budgets, circuits, échéances, paiements et soldes restent en base ; les actions Pro répondent 402 (« données conservées »), les dépenses Pro restent lisibles dans Dépenses et le circuit déjà attaché continue de s'appliquer. Remontée en Pro : tout réapparaît, sans doublon.

## Limites assumées
- Les justificatifs ont été remplacés par le code de validation d'un responsable (décision précédente) : le signalement « pièce manquante » devient « validation sans contrôle indépendant » ; les anciens justificatifs restent consultables.
- Un budget n'est pas une garantie de trésorerie ; le planifié est compté à part et n'engage pas de dépense tant qu'il n'est pas « engagé ».
- Dépense convertie avant son échéance : elle compte à la date du jour dans les budgets.
- Pas d'import bancaire : sans relevé déclaré, aucun solde bancaire n'est affiché.
- Les échéances se génèrent à la demande (idempotent), pas par tâche planifiée.
- Annuler une dépense déjà payée en partie est refusé (pas d'écriture de remboursement automatique).
