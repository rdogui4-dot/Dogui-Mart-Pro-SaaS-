# Lot S2-c — Centre de sécurité « Security Guardian » (rapport)

Date : 2026-11-21 · Suite de S2-a (journal) et S2-b (états). **Pas encore publié.**

## Livré
- **Page `/securite`** (entrée « Security Guardian » du menu, juste avant Paramètres, comme dans la maquette) réservée au **propriétaire** : le menu ne la propose pas aux autres rôles, la page affiche « accès réservé » et le serveur refuse aussi (403). Même moteur sur le cloud et sur le poste Windows.
- **Niveau de sécurité** : score `X / 100` avec niveau (Excellent ≥ 90, Bon ≥ 75, À renforcer ≥ 50, Critique), barre de progression, **couverture** (part réellement mesurée), nombre de contrôles inconnus non comptés, et « Comment ce score est-il calculé ? » (poids et état de chaque contrôle). Aucun contrôle mesuré ⇒ « Non évaluable », jamais de score par défaut.
- **Indicateurs réels** : contrôles conformes / à surveiller / critiques / inconnus.
- **7 contrôles** en cartes : état (texte + pictogramme, jamais la couleur seule), preuve, source, heure de mesure (« aucune mesure » pour un contrôle inconnu), action à faire et lien vers la page qui permet de traiter (équipe, abonnement, synchronisation, sauvegardes).
- **Journal de sécurité** : état de la chaîne en tête (« Chaîne vérifiée : N événements intacts » ou alerte rouge « Rupture de chaîne détectée » avec la cause), filtres (type, gravité, recherche), tableau sur ordinateur, cartes sur téléphone, répétitions regroupées (×n), **export CSV et PDF** du journal filtré (avec l'état de la chaîne en note).
- **« Ce qui n'est pas mesuré »** : réglages de la console Appwrite, sauvegardes du cloud, connexions échouées, et mention explicite qu'aucun compteur d'« attaques bloquées », de pays sources ou d'adresses bloquées n'est affiché (pas de pare-feu applicatif).
- Éléments de la maquette **volontairement absents** (aucune source réelle) : carte du monde, « attaques bloquées », « tentatives d'intrusion », « IP bloquées », mode de protection, tests d'attaque, phrase de récupération — voir `S2-PLAN.md` §3.

## Défauts trouvés par l'essai navigateur et corrigés
1. **Suppression du premier événement du journal non détectée** (seuls le milieu et la fin l'étaient) : sans ancre de purge, le premier événement conservé doit porter le n° 1. Test ajouté. Lecture tronquée (plus de 5000 événements) : seule la fenêtre lue est vérifiée (pas de fausse alerte).
2. « Actualiser » ne relisait pas le journal (cache) : il relit maintenant états et journal.

## Preuves
- Scénario navigateur `e2e/kit29.cjs` (11 étapes, zéro erreur console) : page propriétaire, aucun compteur décoratif, 7 contrôles, sauvegardes « Inconnu » jamais « Conforme », 2FA « À surveiller » puis « Conforme » une fois mesurée, journal avec événements réels (employé créé, refus), tentative d'un étranger **absente** du journal du commerce, aucune donnée sensible, filtres et export CSV vérifiés (contenu), **suppression d'un événement ⇒ rupture signalée et contrôle d'intégrité « Critique »**, limites dites, 1600/820/390 px et mode sombre sans débordement (captures `e2e/out/kit29-*.png`), gérant refusé côté page et côté serveur.
- 9 tests du domaine d'affichage (niveaux, tons, liens, filtres, export), tests de navigation mis à jour (18 modules), nouveau test de chaîne (premier événement). **1752 tests** verts, typecheck propre.

## Limites
- Les actions du Centre (révoquer une session, désactiver un employé, sauvegarde immédiate) sont le lot S2-d ; aujourd'hui les liens mènent aux pages existantes.
- La purge de rétention reste une action d'administrateur de la plateforme (pas d'interface dans ce lot).
- Aucune migration de production dans ce lot (interface seulement).
