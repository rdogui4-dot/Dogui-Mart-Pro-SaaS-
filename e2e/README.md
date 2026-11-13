# Tests navigateur

`npm run e2e:master` (ou `bash e2e/run.sh master`) construit le site et un serveur en mémoire (même routeur que la fonction `dmp-api`), puis pilote un vrai navigateur (Playwright, Chromium).

Scénario `master.cjs` : les 5 onglets de MASTER DOGUI (Licence, Rapports, Profil, Recommandations, Assistant), exports CSV / Excel / PDF (contenu vérifié), délai entre deux questions, hors connexion, tablette 1024 px sans débordement, noms accessibles, expiration de la licence. Captures dans `e2e/out/` (ignoré par git).

Prérequis : Playwright disponible (`require('playwright')`). Aucune clé, aucun réseau externe : les appels Appwrite sont simulés par `harness.cjs`.

## Filet de non-régression (`bash e2e/run.sh all`)
`e2e/known-failures.json` liste les étapes déjà en échec au 13/11/2026 (libellés/sélecteurs périmés après les évolutions d'interface, pas de régression avérée) et les scénarios qui plantent (j1, j4, j12, j14). La commande `all` compare le résultat à cette liste : seule une **nouvelle** étape en échec ou un **nouveau** plantage fait échouer (code 1). Quand un scénario est réparé, retirer son entrée de la liste.
