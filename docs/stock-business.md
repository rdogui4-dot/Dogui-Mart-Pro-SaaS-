# Stock intelligent (formule Business)

Module `/stock` (fonctionnalité `stockIntel`, Business et Pro ; Starter garde la page simple). Aucune quantité n'est saisie directement : le stock est **toujours la somme des mouvements** (`stock_moves`), journal en ajout seul.

## Écrans
- **Tableau** : articles suivis, disponibles / bas / en rupture / négatifs, valeur estimée (quantité × coût configuré), articles sans coût comptés à part, par boutique, par emplacement, derniers mouvements, alertes. Filtres catégorie et période ; le propriétaire peut consolider toutes les boutiques.
- **Articles** : liste existante (ajustement rapide, lots, séries) + bouton **Fiche** par article/variante.
- **Fiche de stock** : en stock (théorique), disponible, réservé, en commande, en transit (entrant / sortant), seuils, valeur, derniers achats/réceptions, ventes, ajustements, inventaires, historique complet. Le gérant peut régler seuils/emplacement/durée sans mouvement et faire une **correction motivée** (motif ≥ 5 caractères, jamais négatif, idempotente).
- **Mouvements** : journal filtrable (type, article/référence, période) avec pagination ; chaque ligne : identifiant, article, quantité signée, origine → destination, date, auteur, référence.
- **Transferts** : préparé → départ validé (stock source diminue, marchandise « en transit », indisponible à destination) → réception(s) depuis la boutique de destination (partielle possible, clé d'idempotence, plafond = reste à recevoir) → clôture avec écart (retour au stock de départ ou perte en transit, motif obligatoire). Les deux côtés sont conservés.
- **Alertes** : stock minimum, rupture, négatif, sous seuil d'alerte, sans mouvement (durée configurable par article), réception attendue en retard, inventaire à vérifier, transfert en retard.

## Actions serveur (`dmp-api`)
`stk.dashboard`, `stk.article`, `stk.moves`, `stk.correct`, `stk.settings`, `stk.alerts`, `xfer.save|ship|receive|close|cancel|list|get` — contrôle d'abonnement et de rôle côté serveur, isolation par tenant/boutique, écritures atomiques (`batch`), réservation de rang contre les réceptions simultanées.

## Colonnes Appwrite ajoutées
`products` : `alertStock`, `location`, `idleDays` · `stock_moves` : `note` · `transfers` : `flow`, `shippedAt/By`, `receivedAt/By`, `closedAt/By`, `closeNote`, `dueAt`, `history`.

## Limites connues
- Les transferts v2 excluent les articles suivis par lot/série et les bundles virtuels (utiliser le transfert direct Lots/Séries).
- Pas de notification push ou e-mail : les alertes sont consultées dans l'application.
- Le stock est recalculé en lisant les mouvements de la boutique (coût de lecture croissant avec l'historique).
- La vérification du stock au départ n'est pas atomique avec une vente simultanée : un stock négatif éventuel est signalé par une alerte.
- Les seuils d'alerte et la durée sans mouvement sont par article (pas par variante) ; le stock minimum reste par variante.
- Les coûts passés ne sont jamais recalculés : la valeur utilise le coût actuel configuré.
