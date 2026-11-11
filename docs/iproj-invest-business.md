# IProj-Invest Business

Fonction `investBusiness` (forfait Business, incluse dans Pro). Page **Investissements** (`/investissements`).

> Outil d'analyse et de simulation. **Ni conseil financier, ni promesse de rendement, ni exécution d'opération** (aucune souscription, aucun achat, aucun transfert). Toute hypothèse est saisie par l'utilisateur et identifiée comme telle ; aucun cours ni rendement de marché n'est fabriqué. À valider par un professionnel compétent.

## Deux catégories séparées
- **Projet d'entreprise** (nouveau magasin, équipement, véhicule, recrutement, extension…) : fiche (objectif, budget initial, dates, financement), statut *étude → approuvé → en cours → terminé / abandonné*.
- **Placement financier** : actif, montant, date, horizon, frais, **rendement attendu déclaré**, **niveau de risque déclaré** et risques décrits (obligatoires), échéances.

## Calculs (formules, période, source, limites)
| Indicateur | Formule | Remarque |
| --- | --- | --- |
| Flux mensuels | mois 0 = −budget ; mois m = ventes × marge % − coûts fixes (+ flux ponctuels) ; valeur résiduelle au dernier mois | ventes = hypothèse saisie, croissance et délai avant premières ventes optionnels ; arrondi à l'entier chaque mois |
| Résultat net | somme des flux | prévision, pas un constaté |
| ROI | net ÷ budget initial | en % |
| Délai de récupération | premier mois où le cumul ≥ 0, interpolé dans le mois | « jamais » si non atteint |
| Seuil de rentabilité | coûts fixes ÷ marge % (ventes mensuelles) | indéfini si marge = 0 |
| Besoin maximal | −min(cumul) | trésorerie à prévoir |
| Sensibilité | ventes et coûts fixes ±10 % / ±20 %, une variable à la fois | scénario central |
| Projection d'un placement | (montant − frais) × (1 + rendement déclaré)^(mois/12) | **non garantie**, jamais présentée comme un résultat |

Pas de VAN ni de TRI en Business : ils exigent un coût du capital (Pro).

## Prévu et réel
Trois scénarios (prudent, central, optimiste) modifiables, **versionnés** (historique conservé avec auteur et date, détection des modifications simultanées). Le réel est une série **distincte** : faits constatés saisis (ou dépense approuvée rattachée, montant et date repris, une seule fois), toujours accompagnés de leur **source**. Jamais supprimés : annulés avec motif. Alerte de dépassement du budget, comparaison mensuelle prévu central / réel cumulés.

La « capacité observée » de la synthèse provient des flux réels FinI des 90 derniers jours (source affichée).

## Droits et sécurité
- Propriétaire : tout, sur toutes les boutiques (une à la fois). Gérant : sa boutique. Comptable : lecture seule. Caissier/magasinier : aucun accès.
- Approbation, lancement et clôture d'un projet, profil de risque : **propriétaire seul**. Un projet en cours ne se modifie que par le propriétaire.
- Écritures uniquement côté serveur, isolées par boutique, idempotentes (clé de requête), anti-concurrence (réservation unique d'une dépense, version des hypothèses), journalisées (`invest.*`).
- IProj-Invest ne crée aucune écriture comptable ni mouvement de trésorerie.

## Profil de risque
Prudent / équilibré / dynamique, **choisi par le propriétaire** (aucun questionnaire inventé). Il sert uniquement à signaler un écart avec le risque déclaré d'un placement ; il ne produit aucune recommandation.

## Données (Appwrite, base `dmp`)
`inv_items` (projets et placements, fiche en JSON validée côté serveur), `inv_scenarios` (hypothèses + historique), `inv_actuals` (réalisations), `inv_config` (profil) ; index par boutique/projet.

## Limites assumées
- Suivi par boutique ; la consolidation multi-projets/multi-boutiques, VAN/TRI, financements, approbations multi-niveaux et rapprochement automatique avec FinI/ICompta relèvent de **IProj-Invest Pro**.
- Les flux FinI ne portent pas d'étiquette de projet : le rattachement du réel est explicite (saisie ou dépense choisie), jamais deviné.
- Les hypothèses sont celles de l'utilisateur et peuvent être fausses ; une simulation n'est pas une prévision fiable.
