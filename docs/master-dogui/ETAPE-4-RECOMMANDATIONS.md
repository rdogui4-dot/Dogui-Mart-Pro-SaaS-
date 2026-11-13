# MASTER DOGUI — étape 4 : recommandations suivies (livré)

Plan validé (`AUDIT-ETAPE-4-RECOMMANDATIONS.md`) avec les choix par défaut : propriétaire et gérants (leurs boutiques) décident ; 7 règles ; report 7 j ; suivi 14 j ; recommandations des rapports suivies par le même moteur ; conservation sans limite.

## Livré
- **Domaine** `src/domain/master-reco.ts` : machine d'états (nouvelle → acceptée | refusée | reportée ; acceptée → en cours → réalisée | sans effet mesurable ; refusée/réalisée/sans effet terminales), règles, seuils bornés, texte de suivi factuel, ordre d'affichage.
- **Tables Appwrite** `md_recos` (index unique entreprise + boutique + règle + empreinte ; index par statut, par règle, par entreprise) et `md_reco_cfg` ; colonnes et index vérifiés « available ».
- **Actions** : `md.reco.generate`, `md.reco.list` (lecture exemptée du verrou d'abonnement), `md.reco.decide`, `md.reco.cfg.save`.
- **Règles** (lecture seule des fonctions des modules, aucun calcul dupliqué) : rupture/stock négatif (Stock) ; réapprovisionnement conseillé (Stock Pro, estimation) ; écarts de caisse répétés (Caisse) ; dépenses à contrôler (Dépenses Pro) ; encours client au plafond (Clients) ; commandes fournisseurs en retard (Achats) ; suggestions promotionnelles (Promotions Pro) ; recommandations des rapports MASTER (règle « report »).
- **Idempotence et concurrence** : identifiant déterministe issu de l'empreinte des faits ; création refusée si elle existe. Refusée : non re-proposée à l'identique ; de nouveaux faits (nouvelle empreinte) créent une nouvelle recommandation. Reportée : redevient « nouvelle » à l'échéance.
- **Suivi sans causalité** : à l'acceptation la mesure de la règle est figée ; chaque actualisation relève la mesure des recommandations acceptées de la même règle et boutique ; texte « évolution observée entre deux dates, non attribuée à cette action » ; délai de suivi signalé (aucun changement de statut automatique).
- **Données insuffisantes** : écarts de caisse (moins de 5 sessions sur la période), réapprovisionnement sans historique : message explicite, aucune recommandation émise. Règles Pro absentes d'une formule Business : signalées « non disponibles », jamais simulées.
- **Droits** : propriétaire (toutes boutiques), gérant (ses boutiques : liste, génération, décision), caissier refusé. Seuils : propriétaire seul, journalisés. **Licence** : génération et décisions exigent une licence valide ; historique toujours consultable.
- **Profil** : ses priorités réordonnent l'affichage (jamais ne créent ni ne suppriment) ; l'ordre appliqué est indiqué.
- **Interface** : onglet « Recommandations » (filtres par statut, motif, sources, limites, décisions, suivi, seuils, règles actives).

## Écarts assumés par rapport au plan
- **Créances échues** : aucune date d'échéance de crédit client n'existe dans les données ; la règle devient « encours client au plafond » (≥ 90 % du plafond, paramétrable) et le dit explicitement dans son motif.
- **Actualisation à la demande** (bouton) ; l'accrochage automatique n'existe que pour les recommandations des rapports d'ouverture et de clôture, car aucun planificateur n'existe.
- Les statuts de recommandations déjà acceptées ne changent jamais seuls : « réalisée » et « sans effet mesurable » restent un choix de l'utilisateur.
- Aucune règle de marge dans cette étape (le coût figé à la vente existe : une règle de marge pourrait être ajoutée ; voir la correction du 13 novembre 2026 dans `ETAPE-2-RAPPORTS.md`).
