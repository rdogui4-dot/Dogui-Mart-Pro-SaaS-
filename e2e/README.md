# Tests navigateur

`npm run e2e:master` (ou `bash e2e/run.sh master`) construit le site et un serveur en mémoire (même routeur que la fonction `dmp-api`), puis pilote un vrai navigateur (Playwright, Chromium).

Scénario `master.cjs` : les 5 onglets de MASTER DOGUI (Licence, Rapports, Profil, Recommandations, Assistant), exports CSV / Excel / PDF (contenu vérifié), délai entre deux questions, hors connexion, tablette 1024 px sans débordement, noms accessibles, expiration de la licence. Captures dans `e2e/out/` (ignoré par git).

Prérequis : Playwright disponible (`require('playwright')`). Aucune clé, aucun réseau externe : les appels Appwrite sont simulés par `harness.cjs`.
