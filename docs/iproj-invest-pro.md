# IProj-Invest Pro

Fonction `investPro` (forfait Pro). Étend IProj-Invest Business sur les mêmes données.

> Simulation et analyse : ni conseil financier, ni promesse de rendement. **Aucune opération n'est exécutée** (souscription, ordre, transfert) et rien n'est écrit en comptabilité ni en trésorerie. Aucun taux, pondération, seuil, cours ou rendement n'est fabriqué : tout vient du propriétaire ou de l'utilisateur et est identifié comme tel.

## Réglages du propriétaire (onglet « Réglages Pro »)
Coût du capital (% par an), enveloppe budgétaire, plafond de concentration, seuils d'approbation (gérant / propriétaire), pondérations du classement (total 100). Sans valeur : la fonction concernée est inactive (VAN masquée, pas de classement, pas d'alerte de concentration). Chaque modification est journalisée avec l'avant/après.

## Indicateurs (formule, période, source, hypothèses, limites affichés dans l'application et dans chaque export)
VAN, TRI (non défini sans changement de signe ; « non fiable » s'il y a plusieurs solutions), ROI, récupération simple et actualisée, échéancier de prêt, score multicritère, sélection sous enveloppe, concentration (part, HHI), volatilité observée, écart réel / prévu. Tous testés indépendamment des données (calculs de référence, cas extrêmes : tous flux négatifs, taux nul, TRI multiples).

## Fonctions
- **Financement** : fonds propres, prêt (tout le budget) ou mixte, conditions saisies (taux, durée). Échéancier par annuité constante (taux nul : linéaire), effet sur les flux de fonds propres (net, intérêts, besoin maximal, VAN, TRI). 5 plans actifs au plus, archivage motivé.
- **Échéancier des décaissements** : tranches prévues (total ≤ budget), en retard signalées, paiement avec **niveau d'approbation** selon le montant ; un paiement ne se fait qu'une fois (réservation unique). Si le réel est saisi, le paiement crée un fait constaté de source « tranche » ; s'il suit ICompta, il ne crée rien (pas de double comptage).
- **Approbations et dépassements** : sans seuil, seul le propriétaire approuve un projet (comportement Business). Avec seuils, le gérant approuve sous le seuil propriétaire. Un décaissement qui dépasserait le budget est refusé au gérant ; le propriétaire l'enregistre ou **révise le budget** (motif, historique, jamais en dessous du réel déjà constaté).
- **Source du réel unique par projet** : saisie (avec dépenses et tranches rattachées) ou écritures **ICompta validées** portant le code analytique « projet » (classes 2 et 6 = décaissements, une contrepassation les réduit ; classe 7 = encaissements). Jamais additionnées ; la saisie manuelle est refusée quand le projet suit ICompta.
- **Portefeuille** : classement multicritère (ROI et récupération du scénario central normalisés entre les projets comparés ; adéquation stratégique et risque notés 1 à 5 par l'utilisateur), projets incomplets listés avec ce qui manque, sélection sous enveloppe (recherche exhaustive jusqu'à 20 projets, glouton au-delà). Vue consolidée de toutes les boutiques réservée au propriétaire, en lecture.
- **Placements** : catégorie d'actif choisie par l'utilisateur, diversification (parts, HHI, frais cumulés), alerte de concentration seulement si le plafond est fixé, valorisations **saisies** (jamais supprimées, annulées avec motif), volatilité (écart-type des variations, baisse maximale) disponible à partir de 6 valorisations, sinon « non disponible ».
- **Rapports** : portefeuille, projet, placements en PDF / Excel / CSV, journalisés, avec la documentation des indicateurs.

## Droits
Lecture : propriétaire, gérants, comptable (même après rétrogradation). Écriture Pro : propriétaire et gérants (Pro requis, 402 sinon). Réglages, révision du budget, vue consolidée : propriétaire seul. Isolation par boutique, idempotence (clés de requête), anti-concurrence, journal `invest.*`.

## Retour de Pro à Business
Tout reste lisible (tranches, plans, valorisations, historique de budget). Les actions Pro sont refusées ; les seuils d'approbation et le suivi du réel ICompta ne sont plus appliqués (retour au comportement Business).

## Données (Appwrite, base `dmp`)
`inv_financing`, `inv_tranches`, `inv_values` ; le paramétrage vit dans la clé `pro` de `inv_config` (le profil de risque Business est préservé) ; les notes, la source du réel et la catégorie d'actif dans la clé `pro` de la fiche (`inv_items.data`).

## Limites assumées
- Le réel n'a pas de volumes : l'écart est présenté en encaissements / décaissements, sans décomposition prix/quantité.
- Classement et sélection : simulations fondées sur vos pondérations et vos notes, projets supposés indépendants.
- Pas de rapprochement automatique avec les prévisions FinI : la capacité de financement observée (Business) reste indicative ; les prévisions FinI Pro ne sont pas importées dans les projets.
- Prêt : taux fixe, sans différé ni frais de dossier ; ne remplace pas le tableau d'amortissement de la banque.
- Volatilité : à intervalles irréguliers elle est signalée peu comparable ; le passé ne prédit pas l'avenir.
