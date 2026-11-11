# MASTER DOGUI — étape 3 : profil d'entreprise (livré)

Plan validé (audit : `AUDIT-ETAPE-3-PROFIL.md`), choix par défaut : propriétaire seul pour modifier ; faits issus des modules non stockés ; catalogue proposé ; faits par entreprise ou par boutique ; suppression définitive avec trace.

## Ce qui est livré
- **Domaine** `src/domain/master-profile.ts` : catalogue fermé de 9 informations (secteur, forme d'activité, taille, pays, objectif, priorités ≤ 3, contraintes, mois forts, horaires, remarques), validation et normalisation (aucune valeur hors liste ; texte ≤ 120/300 caractères, nettoyé, jamais interprété comme consigne).
- **Table Appwrite `md_profile`** (une ligne par fait ; index unique entreprise + clé + boutique ; créée via MCP, colonnes « available ») ; droits de ligne : propriétaire ; écritures par `dmp-api` seulement.
- **Actions** : `md.profile` (lecture), `md.profile.set`, `md.profile.confirm`, `md.profile.delete` (niveau entreprise ; lecture exemptée du verrou d'abonnement).
- **Qualification** : déclaré / hypothèse / estimation, avec source, date, auteur. « Vérifié » n'est jamais stocké : boutiques, équipe, articles, fournisseurs et clients sont lus dans les modules à chaque affichage, avec leur source.
- **Gouvernance** : hypothèse ou estimation -> déclaré uniquement par confirmation explicite du propriétaire ; tout est journalisé (`profile.set|update|confirm|delete`, sans la valeur à la suppression) ; suppression sans effet sur les rapports déjà produits.
- **Droits** : propriétaire (lecture + écriture), gérant (lecture : sans les « contraintes » ni les boutiques hors de son périmètre), caissier refusé. **Licence** : écriture exigée valide ; consultation seule ensuite.
- **Isolation** : toutes les lectures filtrées par l'entreprise du contexte serveur ; test d'isolation entre deux entreprises (lecture, confirmation, suppression).
- **Interface** : onglet « Profil » de MASTER DOGUI (vérifié, mémorisé, « à renseigner » facultatif, modification, confirmation, suppression).

## Limites assumées
- Les compteurs « vérifiés » portent sur toute l'entreprise (pas filtrés par boutique pour un gérant) et sont plafonnés (20 000 lignes, affiché « n+ »).
- Aucune alimentation automatique par IA (étapes suivantes) ; aucune valeur n'est déduite.
- Les valeurs des listes (secteurs, tailles, objectifs) sont celles proposées dans l'audit.
