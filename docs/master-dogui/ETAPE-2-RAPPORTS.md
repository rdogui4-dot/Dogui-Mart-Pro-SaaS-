# MASTER DOGUI — étape 2 : rapports d'ouverture et de clôture (sans IA)

Calculs **déterministes** : aucune IA générative n'intervient dans les chiffres. Chaque section cite sa source ; une donnée absente est listée dans « Données manquantes » et jamais remplacée.

## Rapport de clôture
- **Déclenchement** : uniquement après la clôture **confirmée** d'une session (abonné de `closeSession`, exécuté après la mise à jour). Une erreur de génération **ne bloque ni n'annule** la clôture : le rapport passe « échoué » et se rejoue (`md.closing`).
- **Contenu** : ventes confirmées (nombre, encaissé, comparaison à la session précédente du vendeur), remboursements, annulations/ventes non abouties, encaissements par moyen, fond de caisse / théorique / compté / écart (et statut de validation), apports et retraits, dépenses imputées, marge estimée (si fiable), alertes hiérarchisées, recommandations factuelles (motif, source, statut « nouvelle »), méthode et limites.
- **Écart de caisse** : « critique » seulement au-delà de la tolérance de la boutique (aucun seuil inventé) ; sinon information.

## Briefing d'ouverture
- **Quand** : à l'ouverture de l'application (accueil, propriétaire et gérants). Le **serveur décide** : aucun briefing si **une session de caisse est ouverte** dans la boutique (quel que soit le vendeur) ou sans licence valide. **Jamais d'ouverture automatique de caisse.**
- **Contenu** : synthèse de la veille et comparaison à l'avant-veille, marge estimée si fiable, état du stock (ruptures, sous seuil), commandes fournisseurs à réceptionner, dépenses à valider, écarts de caisse à valider, tâches CRM en retard, alertes et recommandations.
- Un briefing par boutique et par **date commerciale** (fuseau de la boutique) ; rejouer la demande renvoie le même. « Régénérer » crée une nouvelle version.

## Fiabilité (cahier 6.3)
- **Idempotence** : clé = entreprise + boutique + type + (date ou session) ; identifiant déterministe par version ; création atomique (deux clôtures ou ouvertures simultanées = un seul rapport).
- **États** : en génération, prêt, partiel (données manquantes listées), échoué (rejouable), remplacé (ancienne version conservée avec la référence de la nouvelle).
- **Journal** : `master.report.opening|closing[.failed]`.

## Marge : honnêteté sur les coûts
Le coût d'un article **au moment de la vente n'est pas enregistré** dans les ventes. La marge est donc une **estimation au coût actuel** des articles et n'est affichée que si **toutes** les lignes vendues ont un coût connu ; les articles conditionnés (plusieurs unités), les bundles ou sans coût rendent la marge indisponible (donnée manquante signalée). Pour une marge historique exacte, il faudrait enregistrer le coût à la vente (évolution possible, à décider).

## Droits et licence
- Lecture/génération : propriétaire et gérants de la boutique ; caissier refusé ; isolation par boutique et entreprise (permissions des lignes).
- **Après expiration** : l'historique reste consultable ; la génération (clôture, ouverture, régénération) est suspendue (402/ignorée). Les autres modules ne sont pas concernés.

## Limites assumées
- Pas de rappel ni d'envoi par message ; pas d'export PDF dédié (le contenu est affiché dans l'application).
- Les modules non souscrits ou non accessibles au rôle apparaissent comme « non disponibles » (Stock, Achats, Dépenses, Caisse intelligente, CRM).
- Les recommandations sont des règles simples sur des faits (rupture, écart, tâches en retard) : le moteur de recommandations suivi dans le temps vient à l'étape 4.

## Données (Appwrite, base `dmp`)
`md_reports` (index boutique). Permissions : propriétaire et gérants de la boutique.
