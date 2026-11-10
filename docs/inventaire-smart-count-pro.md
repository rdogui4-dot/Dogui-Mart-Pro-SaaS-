# Silent Smart Count — inventaire Pro

Même page `/inventaire` que Silent Count Business : tout le Business est conservé (création, comptage à l'aveugle, rapprochement, contrôles, validation, ajustements, rapports). En formule **Pro** (à vie inclus) s'ajoutent les onglets **Campagnes** et **Planification**, une barre d'**alertes** et, dans chaque inventaire, zones, contrôles indépendants, anomalies, analyse et propositions. Les actions Pro sont `scount.*` ; elles réutilisent les tables `inventories`, `inventory_lines` et `inventory_events` (colonnes ajoutées, aucune donnée dupliquée).

## Comptage assisté
- **Zones et agents** : une zone = des agents + des catégories et/ou des classes ABC. Un agent affecté à des zones ne voit et ne compte que ses zones (+ les articles sans zone). Les classes A/B/C sont calculées par le serveur sur la valeur des ventes des 90 derniers jours (à défaut : valeur du stock, indiqué). L'ordre de comptage est « zone, classe A d'abord, catégorie, valeur ».
- **Identification** (`scount.identify`) : suggestions du catalogue (code-barres, référence, mots du nom), avec la raison ; les références partagées entre plusieurs articles sont signalées. Rien n'est compté automatiquement.
- **Scan** : caméra (API BarcodeDetector d'Android Chrome) ou saisie ; doublons de scan ignorés (5 s), codes inconnus conservés.
- **Synchronisation** : chaque saisie a une clé idempotente ; rejouer après coupure ne double rien ; deux agents en désaccord = conflit signalé.

## Comptage aveugle avancé
- Les quantités théoriques restent masquées aux agents (API et interface) jusqu'à la fin du comptage ; et, pour un contrôle indépendant, la valeur du comptage précédent reste masquée à l'agent suivant.
- **Second comptage indépendant** : demandé par le gérant (lignes choisies ou tous les écarts importants), obligatoirement fait par un **autre agent** que le premier.
- **Comparaison** : accord = confirmé ; désaccord au-dessus du seuil (% ou valeur configurés) = **troisième contrôle** par un troisième agent ; deux valeurs identiques sur trois font foi ; sinon **arbitrage** du gérant avec motif. Désaccord sous le seuil : arbitrage direct.
- Toutes les versions sont conservées (colonnes `second`/`third` + journal d'événements).
- **Séparation des droits** : compter / vérifier (décider) / valider. En Pro, le valideur ne peut être ni un compteur ni celui qui a tranché les écarts (le propriétaire reste autorisé, comme en Business).

## Anomalies (`scount.anomalies`)
Calculées sur les données réelles, après la fin du comptage. Chacune porte : justification chiffrée, données, priorité (haute/moyenne/basse), vérification proposée, et la mention « indicateur à vérifier, jamais une qualification de fraude ». Décision humaine tracée (vérifiée / écartée / transmise, note obligatoire).
- Écart inhabituel vs historique de l'article (≥ 3 inventaires, sinon « historique insuffisant » : jamais inventé) ; écart important sans historique.
- Pertes récurrentes (≥ 3 écarts négatifs approuvés sur les 5 derniers inventaires).
- Stock négatif ou incohérent ; erreur d'unité possible (rapport ≈ facteur de conditionnement ou puissance de 10) ; quantité très éloignée du stock habituel (12 semaines, ≥ 5 relevés).
- Ajustement manuel ou ventes inhabituelles pendant la campagne ; références partagées.
- Réception validée sans mouvement de stock complet ; transfert non rapproché (sorties ≠ entrées).

## Analyse et valorisation (`scount.analysis`)
Valeur théorique et physique estimée, surplus/manquants/net, précision (en lignes et en valeur), par catégorie/zone/classe/agent, articles A en écart, historique comparatif (`scount.history`). Valorisation au **coût unitaire figé au lancement** (méthode de la boutique, CMUP par défaut) ; articles sans coût listés (valeur 0) ; marge de revente potentielle donnée à titre indicatif, **jamais assimilée à un bénéfice perdu**.

## Planification
- Fréquence par classe (défaut A 30 j, B 90 j, C 180 j ; A ≤ B ≤ C). Suggestions d'après l'historique réel des inventaires validés ; un article jamais compté est signalé comme tel (pas d'ancienneté inventée) ; pertes récurrentes ajoutées.
- **Génération** d'un brouillon cyclique (idempotent par jour) : jamais lancé ni validé automatiquement.
- **Alertes** : comptage en cours > 3 j, comptage terminé non vérifié > 2 j, vérification en attente > 3 j, brouillon ancien, écarts au-dessus des seuils, cycle en retard.

## Campagnes multi-magasins
Un gérant ayant accès à toutes les boutiques (ou le propriétaire) crée une campagne : un brouillon d'inventaire par boutique. Lancement groupé, suivi consolidé et par boutique (avancement, taux d'articles en écart, précision, écart net), validation centralisée (chaque boutique suit les mêmes règles ; les non prêtes sont signalées sans bloquer les autres). **Transferts pendant la campagne** : le théorique de chaque boutique étant calculé à l'instant de SON comptage, ses écarts restent justes ; le risque porte sur le total consolidé (marchandise comptée deux fois ou nulle part), signalé par transfert.

## Rapports (`scount.report`)
PDF, Excel, CSV : synthèse, écarts, valorisation, par zone / classe / agent, anomalies et décisions, comparaison avec les inventaires précédents, journal d'audit complet.

## Abonnement
Pro → Business : rien n'est supprimé ; les actions `scount.*` répondent 402 ; les onglets Pro disparaissent ; les lignes en contrôle indépendant se convertissent en recomptage standard (`count.recount`) et l'inventaire se valide avec les règles Business. Business → Pro : tout redevient disponible.

## Limites
- **Aucune notification externe** (e-mail, SMS, push) : aucun service de messagerie n'est configuré ; les alertes se calculent à l'ouverture.
- **Pas de planificateur en arrière-plan** : la fonction n'a pas de tâche cron ; la « création planifiée » consiste en suggestions + génération en un clic.
- Pas d'emplacements physiques dans le catalogue : les zones s'appuient sur catégories et classes ; l'ordre de comptage est un ordre logique, pas un itinéraire géographique.
- Articles à lots/séries et bundles virtuels hors inventaire (listés).
- Écritures concurrentes sur une même ligne : pas de verrou de version (dernier écrit gagne) ; l'idempotence, le refus du même agent et les statuts limitent le risque.
- Calculs lourds (anomalies, analyse) relisent les mouvements de la boutique à chaque appel ; un index `stock_moves(tenantId, shopId)` a été ajouté.
