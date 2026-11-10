# Silent Count — inventaire Business

Page `/inventaire` (tuile « Inventaire » de l'accueil). Réservée à la formule **Business** (Pro et « à vie » inclus). Le comptage rapide historique (`stock.adjust`, page Stock) reste disponible ; Silent Count est le processus complet et contrôlé.

## Principe
Le stock n'est jamais écrasé. Le **stock théorique** se calcule à partir des mouvements enregistrés (`stock_moves`) ; l'inventaire ne produit que des **mouvements correctifs** (`kind: adjust`, `refId: inventaire:<numéro>`, auteur, date) pour les écarts approuvés. Aucun mouvement n'est modifié ni supprimé.

## Cycle de vie
Brouillon → En cours → Comptage terminé → À vérifier → Validé → Clôturé ; Annulé possible avant la validation.
- **Création** (gérant/propriétaire) : complet ou partiel (catégories, articles précis), responsable, agents de comptage (accès au stock exigé), seuils d'écart important (% et FCFA, configurables), observations. Numéro unique `INV-AAAAMMJJ-XXXXXX`.
- **Périmètre** : articles actifs ; variantes comptées une à une ; unités de conditionnement acceptées. Exclus et signalés : articles suivis par lot/série (à compter dans leurs modules) et bundles virtuels. Un article ne peut pas être dans deux inventaires actifs à la fois.
- **Lancement** : fixe la date de lancement.

## Comptage silencieux
Seuls les agents assignés, le responsable, les gérants et le propriétaire comptent. L'écran montre nom, référence, code-barres ; scan caméra ou saisie ; quantité constatée (décimales/unités selon l'article), observation ; sauvegarde à chaque saisie.
- **À l'aveugle** : ni l'interface ni l'API ne renvoient le théorique tant que le comptage n'est pas terminé, même au gérant. (Limite : un utilisateur techniquement capable pourrait relire les mouvements directement ; l'objectif est d'éviter le biais pendant le comptage, pas le secret cryptographique.)
- **Doublons** : même agent + même quantité en moins de 5 s = ignoré ; ressaisie d'un article déjà compté = confirmation explicite, l'ancienne valeur reste dans l'historique ; deux agents en désaccord = conflit signalé ; `entryKey` rend l'envoi rejouable sans doublon (perte réseau).
- **Codes inconnus** : conservés et listés, jamais ignorés ; article hors périmètre refusé explicitement.

## Date de référence et mouvements pendant le comptage
Stratégie explicite : le théorique de chaque article est évalué **à l'instant où CET article a été compté** (jamais de dates mélangées). Les ventes, réceptions, retours et transferts survenus **après** ce comptage ne sont pas des écarts ; l'ajustement n'ajoute que l'écart, donc le stock final = compté + mouvements ultérieurs. Aucune vente n'est bloquée. Sont signalés : mouvements entre le lancement et le comptage, mouvements dans les 15 minutes avant le comptage (recomptage conseillé), mouvements depuis le comptage.

## Contrôle et validation
- Écarts affichés **après** la fin du comptage (statut « À vérifier ») : théorique, compté, écart, valeur (coût figé au lancement), importance.
- **Écart important** (≥ seuil % ou FCFA) : approbation refusée tant qu'il n'y a pas de **second comptage** ; exception explicite avec motif détaillé (≥ 10 caractères), tracée.
- **Second comptage** : le gérant désigne les lignes à recompter ; l'inventaire repasse « En cours » ; les agents recomptent à l'aveugle (manche 2).
- Motif obligatoire pour chaque approbation/refus. Les écarts refusés et les articles non comptés ne reçoivent aucun ajustement.
- **Validation** : gérant/propriétaire ; refusée si un écart n'est pas tranché, si un recomptage est en attente, ou si le valideur a lui-même compté (sauf propriétaire). Un rang réservé évite deux validations simultanées ; les mouvements ont des identifiants déterministes (reprise après coupure sans doublon) ; écriture par lots transactionnels.
- **Clôture** : plus aucune modification. Une validation ne s'annule pas : toute correction passe par une opération corrective tracée (nouvel inventaire ou ajustement).

## Rapports
Avancement, comptés / non comptés, écarts + et −, valeur (surplus, manquants, net), par catégorie, articles à recompter, mouvements à surveiller, codes inconnus, historique complet (auteur, date, avant/après, motif). Export PDF, Excel, CSV.

## Traçabilité vérifiée (avant inventaire)
- Réception validée → mouvements `purchase` (réf. = n° de commande, auteur).
- Retour fournisseur (`purch.return`, nouveau) → mouvement `adjust` négatif `retour-fournisseur:<réception>` borné par les quantités acceptées, idempotent, jamais de stock négatif ; la dette n'est pas modifiée (pas d'avoir fournisseur : litige de facture).
- Correction rapide de stock (`stock.adjust`) → mouvement `adjust` (réf. `inventaire`, auteur).
- Inventaire Silent Count → mouvement `adjust` `inventaire:INV-…`.
Un test automatique vérifie que chaque mouvement porte un auteur et une référence.

## Limites
- Articles à lots/séries et bundles virtuels hors Silent Count.
- Pas de gestion d'emplacements physiques (les catégories servent de découpage).
- Un inventaire = une boutique.
