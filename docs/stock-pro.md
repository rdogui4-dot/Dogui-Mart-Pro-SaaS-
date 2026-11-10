# Stock super intelligent (formule Pro)

Étend le module Stock Business (`/stock`) avec six onglets Pro (fonctionnalité `stockPro`, Pro uniquement ; contrôle d'abonnement, de rôle, de tenant et de boutique **côté serveur**). Aucune table nouvelle : tout est calculé depuis `stock_moves`, `products`, `article_variants`, `article_lots`, `article_serials`, `article_suppliers`, `purchase_orders/receipts`, `transfers`, `inventory_lines`. Les analyses sont en **lecture seule** : elles ne modifient ni stock, ni seuils, ni commandes, ni transferts. Au retour en Business, historiques et mouvements restent intacts.

## Onglets et actions serveur
| Onglet | Action | Contenu |
|---|---|---|
| Analyse | `stkp.analysis` | rotation (vendu ÷ stock moyen reconstitué), couverture (jours), classes sans vente / surstock / rotation lente, ABC (valeur des ventes, du stock ou jours de vente), variation de consommation, capital immobilisé, par boutique et catégorie |
| Réappro | `stkp.replenish`, `stkp.simulate` | prévision par article, délai fournisseur réel, stock de sécurité, point de commande, quantité suggérée, risque de rupture, seuils proposés (appliqués seulement sur demande), simulation de scénarios, brouillon de commande **sur sélection explicite** (via Achats) |
| Réseau | `stkp.network` | performance par boutique, déséquilibres, transferts suggérés avant achat (préparés seulement sur clic), marchandises en transit et transferts non réceptionnés |
| Anomalies | `stkp.anomalies` (gérant) | mouvements répétés, stock négatif / évolution impossible, sorties inhabituelles (article, utilisateur), ajustements sans motif, écarts d'inventaire récurrents, réceptions différentes des commandes, coût absent ou en saut ; preuves + contrôle recommandé |
| Lots | `stkp.products` | lots/péremptions lus du catalogue Articles Pro, FEFO, valeur à risque, produits à forte valeur (emplacement, séries) |
| Rapports | `stkp.report` (gérant) | 8 sections, comparaison de périodes, exports PDF / Excel / CSV côté client à partir des lignes serveur |

## Méthodes (toutes affichées dans l'application)
- **Prévision** : lissage exponentiel (α = 0,1) des ventes journalières nettes des retours, depuis la première vente ; profil hebdomadaire seulement avec ≥ 56 jours d'historique ; intervalle ± 1,65 σ ; **aucune prévision en dessous de 14 jours** d'historique (explication affichée à la place). Confiance : élevée (≥ 60 j et CV ≤ 1), moyenne (≥ 28 j et CV ≤ 2), sinon faible.
- **Stock de sécurité** = 1,65 × σ(demande/jour) × √délai (≈ 95 % de service). **Point de commande** = demande × délai + sécurité.
- **Quantité suggérée** = demande × (délai + couverture cible) + sécurité − (en stock + en commande + en transit entrant).
- **Délai** : observé (médiane commande → réception validée, ≥ 2 réceptions), sinon configuré (lien article–fournisseur, puis fournisseur), sinon 7 jours **signalé comme défaut**.
- **Transfert suggéré** : un magasin couvrant moins de N jours reçoit l'excédent d'un autre (qui garde son minimum et max(30 j, 2N) de ventes) ; le transit entrant est déduit.
- **Simulation** : projection jour par jour à demande moyenne (et scénario pessimiste +1,65 σ) ; les ventes manquées sont une estimation, pas un chiffre d'affaires réalisé.

## Garanties
Aucune prévision n'est transformée en commande sans validation (brouillon créé seulement après sélection, quantités modifiables, fournisseur choisi ; il reste à soumettre/valider dans Achats). Une anomalie n'est jamais qualifiée de fraude (avertissement sur chaque anomalie). Pas de donnée fictive : sans historique suffisant, l'application l'indique.

## Limites connues
- Prévision fondée sur les seules ventes passées (promotions, changements de prix, événements non pris en compte).
- Jours calculés en UTC ; les quantités sont en unité de base de l'article (les conversions d'unités ne sont pas ré-exposées).
- Lecture de tous les mouvements de la boutique à chaque analyse : le coût croît avec l'historique (analyse « toutes boutiques » plus lente).
- Seuil d'alerte / durée sans mouvement par article (pas par variante).
- Délai observé calculé depuis la création de la commande (pas depuis sa validation).
- Rapprochement multi-magasins par origine (articles transférés) ou nom (variantes) ; deux articles créés séparément dans chaque boutique ne sont pas rapprochés.
- Notifications push/e-mail non prévues ; non testé avec un vrai utilisateur sur l'Appwrite réel.
