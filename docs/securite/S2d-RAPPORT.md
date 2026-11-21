# Lot S2-d — Actions confirmées du Centre de sécurité (rapport)

Date : 2026-11-21 · Suite de S2-c (publié). **Pas encore publié.**

## Livré
Nouvel onglet **« Comptes et actions »** du Centre de sécurité (propriétaire seulement). Principe : **aucune action automatique** ; chacune est demandée par le propriétaire, **confirmée** dans une fenêtre qui explique l'effet, exécutée par le serveur et **tracée au journal de sécurité**.
- **Comptes du commerce** : nom et identifiant, rôle, état (Actif / Désactivé), dernière connexion, sessions des 24 h, double authentification (« Inconnue » si l'annuaire est illisible — jamais inventée). Tableau sur ordinateur, cartes sur téléphone.
- **Déconnecter** (`security.sessions.revoke`) : ferme **toutes** les sessions d'un employé ; il peut se reconnecter. Cloud : `users.deleteSessions` (droit `users.write`, déjà accordé à la fonction) ; poste Windows : suppression des sessions locales (le jeton cesse de marcher aussitôt, vérifié par test).
- **Désactiver / Réactiver** : réutilise `staff.update` (déjà existant), avec **événements dédiés** « Compte d'un employé désactivé » (avertissement) et « réactivé » ; aucun événement si l'état ne change pas.
- **Sauvegarde immédiate** (poste Windows) : confirmation, puis sauvegarde vérifiée ; événement « Sauvegarde immédiate lancée ». Dans le cloud, l'écran explique que la sauvegarde se lance depuis le poste (aucune sauvegarde cloud déclenchable par l'application).

## Garde-fous (testés)
- Propriétaire du commerce seulement (403 pour gérant, caissier, étranger).
- La cible doit être un **employé de CE commerce** : jamais un propriétaire, jamais un compte d'un autre commerce, jamais un identifiant inventé (404, rien n'est fermé).
- Autorisée même quand un poste héberge le commerce (couper un compte compromis ne doit pas attendre) ; la désactivation, elle, suit la règle d'hébergement existante.
- Aucune donnée personnelle dans le journal (cible générique « compte:employé »), acteur et rôle enregistrés, source « cloud » ou « poste ».
- Annuler la confirmation n'envoie **rien** (vérifié sur le réseau).

## Preuves
- 7 tests serveur (`security-actions.test.ts`) + 1 test du poste réel (jeton de l'employé invalidé, événements « poste ») ; 1760 tests verts, typecheck propre.
- Scénario navigateur `e2e/kit30.cjs` (9 étapes, zéro erreur console) : comptes, propriétaire sans action, annulation, fermeture des sessions (seul le compte visé), désactivation puis réactivation avec événements au journal, erreur serveur affichée en alerte sans faux succès, 1600/820/390 px et mode sombre sans débordement.

## À valider en production (au « publie »)
Essai réel sur Appwrite avec comptes jetables : fermeture des sessions (la clé de la fonction a `users.write` : à confirmer en réel), désactivation/réactivation, événements au journal, nettoyage vérifié. Aucune migration de schéma.

## Limites
- La fermeture des sessions n'empêche pas la reconnexion : pour cela, désactiver le compte (dit dans la confirmation).
- Pas de forçage du retour au cloud ni de réinitialisation de mot de passe dans ce lot (existent ailleurs : Paramètres → Synchronisation, Équipe).
