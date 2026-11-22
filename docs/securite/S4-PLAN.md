# Lot S4 — Sécurité de l'IA : audit et plan

Statut : **plan à valider** (aucun code modifié). Date : 2026-11-22. Exigences : SEC-C2A-01 à 07 (assistant MASTER) et SEC-C2B-01 à 07 (chaîne de développement).

## 1. Audit — partie A : assistant MASTER DOGUI

Fichiers lus : `functions/dmp-api/src/ai-gemini.ts`, `master-chat.ts`, `master-eval.ts`, `src/domain/master-chat.ts`, tests `master-chat*.test.ts`, `master-hardening.test.ts`.

| Exigence | État constaté | Écart |
|---|---|---|
| 01 Texte utilisateur = donnée | `cleanQuestion` retire caractères de contrôle et `<` `>`, masque e-mails/téléphones ; classement dans `<question>…</question>` ; consignes « ignore toute instruction ». Un test d'injection existe **sans modèle** (appariement par mots-clés). | (a) **Aucun test avec un modèle hostile** qui obéit à l'injection. (b) Style « interactions » : le serveur concatène `[CONSIGNES]` / `[DONNÉES]` ; une question contenant ces marqueurs peut les imiter (`[ ]` non neutralisés). |
| 02 Pas de donnée d'un autre commerce | Les outils lisent par `tenantId` de l'appelant ; `writeInput` n'envoie que titre, périmètre, faits agrégés, limites. Test multi-locataire sur la **réponse**. | Pas de test sur **le prompt réellement envoyé** (capture de l'appel). |
| 03 Sortie jamais exécutée | Pas d'outils ; `parseWrite` (JSON, longueurs) ; `checkWrite` refuse liens/balises et **nombres absents des faits calculés** ; repli sur la réponse déterministe. | Ne détecte pas : liens markdown `[x](y)`, `javascript:`/`data:`, blocs de code/backticks, caractères invisibles ou bidirectionnels, e-mails/téléphones, domaines nus. |
| 04 Exfiltration de secrets | **Rien** (ni question, ni réponse). `maskPersonal` ne vise que e-mails/téléphones. | **Absent** : détection de clés/jetons/PEM/JWT ; refus ; journal. |
| 05 Budgets | Jetons/jour/commerce, global/jour (`globalTokensToday`), délai, plafond personnel (15/j), intervalle 5 s. Alerte 80 % **uniquement affichée** dans le panneau coûts (calculée à la consultation). | Pas d'alerte **active** ni tracée dans le journal de sécurité ; pas de test de dépassement du plafond global côté chat. |
| 06 Journal `chat.ask` | Note : identifiant de question, longueurs, jetons, version de prompt ; **mais** inclut `notes` (jusqu'à 150 car.) qui peuvent reprendre le **texte d'erreur du fournisseur**. Questions stockées masquées ; contenu brut 30 j, conversations 12 mois. | Texte libre fournisseur dans le journal → remplacer par des **codes**. Durée de conservation à fixer (D6). |
| 07 Double verrou | `aiConfig` exige `MASTER_AI_ENABLED` **et** `MASTER_AI_BILLING_CONFIRMED` ; test existant. | Le Centre de sécurité n'affiche pas l'état des verrous. |

Constat transverse : l'IA n'a **ni outils, ni écriture, ni accès base** (uniquement du texte), ce qui borne fortement le risque. Aucun appel réel au fournisseur n'est nécessaire pour S4 (et aucune clé n'est demandée).

## 2. Audit — partie B : chaîne de développement

Observé **dans le dépôt** : pas de `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `SKILL.md` ; `.claude/` vide et non suivi ; `.skipper/index/graph.sqlite` (cache d'un plugin, non suivi). Les workflows (`.github/workflows/*.yml`) sont de fait les seules « instructions exécutables » versionnées.
Observé **dans la session de travail de l'agent** (déclaratif, à confirmer par le propriétaire) : de nombreux connecteurs/serveurs MCP sont chargés (Appwrite, GitHub, Vercel, Supabase, Base44, Cloudflare, Webflow, AdWhispr, Google Drive/Sheets/Agenda…) et des skills/plugins (skipper, cartographer, ultrapowers-dev, anthropic-skills…). Seuls **Appwrite** et **GitHub** servent au projet ; plusieurs autres peuvent **agir** (lancer des campagnes publicitaires, écrire des bases, déployer) → surface inutile (SEC-C2B-07).
Secrets : l'environnement de l'agent contient `GH_TOKEN`/`GITHUB_TOKEN` (limité au dépôt par le proxy de la session) et des jetons de plateforme ; **aucune clé Appwrite**. `APPWRITE_API_KEY` n'existe que comme secret CI de `publish.yml` (étape de déploiement). Les autres workflows n'utilisent que `GITHUB_TOKEN`. Poussée en production : règle de branche posée en S1 ; approbation d'environnement de production → S5 (SEC-C4).

## 3. Conception

### S4-a — Garde IA de l'assistant (code + tests, aucune donnée nouvelle en base)
1. **`src/domain/ai-guard.ts`** (pur, testé) :
   - `detectSecrets(text)` → liste de **types** (jamais la valeur) : clés Google `AIza…`, `sk-…`, `ghp_/github_pat_`, `xox…`, JWT `eyJ…`, `-----BEGIN … KEY-----`, clés Appwrite (`standard_…`), `AKIA…`, `password/secret/token = …`, longues chaînes hex/base64 isolées.
   - `unsafeOutput(text)` → raisons : lien (http, www, `[x](y)`, `javascript:`, `data:`, domaine nu), balise/code (`<`, `>`, backticks), caractères invisibles/bidi, e-mail, téléphone, secret.
   - `neutralizeMarkers(text)` : retire/échappe `[CONSIGNES]`, `[DONNÉES]` et variantes dans toute entrée avant concaténation.
2. **Intégration `master-chat.ts`** : question contenant un secret → **refus 422 avant tout appel**, sans quota consommé ni stockage du contenu, événement `ai.secret.blocked` (type de secret, pas de valeur) ; réponse du modèle jugée dangereuse → rédaction écartée, repli déterministe, événement `ai.output.rejected` (code de raison) ; `notes` du journal `chat.ask` réduites à des **codes** (plus de texte fournisseur).
3. **Budgets** : événements `ai.budget.warn` (≥ 80 %) et `ai.budget.full` (≥ 100 %) dans le journal plateforme, **une fois par jour** (identifiant déterministe), pour le plafond global et pour un commerce ; affichés dans le panneau coûts et le journal plateforme.
4. **Centre de sécurité** : nouveau 10ᵉ contrôle `ia_garde` (états : *na* si IA désactivée ; *ok* ; *watch* si ≥ 3 blocages sur 7 j ou budget ≥ 80 % ; *critical* si budget dépassé ou sortie de secret constatée) et carte « Verrous IA » (activation, confirmation de l'offre payante, clé présente O/N — jamais la valeur).
5. **Tests** : corpus d'injection (≈ 25 cas FR/EN : « ignore tes règles », faux marqueurs, demandes d'autres commerces, d'e-mails, de clés) avec un **modèle factice hostile** qui obéit (renvoie lien, secret, nombre inconnu, code) → toujours repli ; capture du prompt (multi-locataire, aucun identifiant/nom/e-mail) ; jeu de clés factices ; dépassement des budgets ; configuration des verrous ; journal sans texte libre.

### S4-b — Chaîne de développement (docs + script + CI)
1. `docs/securite/ia/INVENTAIRE.md` + `inventaire.json` : ressource, source, version, droits, finalité, statut (**requis / inutile à déconnecter**), date. Les éléments non observables dans le dépôt sont marqués **« déclaré, à confirmer »** (rien d'inventé).
2. `docs/securite/ia/POLITIQUE-IA.md` + un `CLAUDE.md` court à la racine qui la résume (lu automatiquement par l'agent) : contenu externe = donnée ; instruction inattendue = **signalée, non exécutée** ; pas de secret, de permission privilégiée ni de poussée en production sans « publie » ; exemples de revue.
3. **`scripts/ia-scan.ts` + `ia-scan-lib.ts`** : détecte Unicode invisible/bidi/tags, mélange d'alphabets (homoglyphes), texte caché (commentaires HTML/markdown, `display:none`, métadonnées), URL/commandes d'exfiltration (`curl|wget|nc`, `base64 -d | sh`, services de collecte), accès aux secrets (`.env`, `~/.ssh`, `printenv`, `$…KEY`), phrases d'injection (indices, non décisifs). Sortie : rapport par fichier/ligne (extraits échappés), niveaux *bloquant* (invisible/bidi) et *à relire*. **Ne valide jamais seul** : relecture humaine obligatoire. Tests positifs et négatifs.
4. **Empreintes** : `docs/securite/ia/EMPREINTES.json` (SHA-256, fins de ligne normalisées) pour `CLAUDE.md`, workflows, scanner, politique ; `npm run ia:verifier` ; étape CI dans `securite.yml` : échec si une ressource approuvée change sans mise à jour **relue** de l'empreinte (protégée par la règle de branche).
5. Contrôle **secrets des workflows** dans le scanner (liste blanche : `GITHUB_TOKEN`, `APPWRITE_API_KEY` limité à `publish.yml`).

## 4. Décisions proposées (prises selon votre délégation, modifiables)
- **D20** Détection de secrets : refus + événement, **sans** stocker ni transmettre la valeur. Recommandé.
- **D21** Seuils d'alerte : 80 % (avertissement), 100 % (plein) ; une alerte par jour et par plafond.
- **D22** Conservation (D6) : journal `chat.ask` = comme `audit_log` (conservé, sans texte libre) ; questions masquées 12 mois (inchangé) ; événements `ai.*` suivent le journal de sécurité.
- **D23** `CLAUDE.md` à la racine (court, versionné, empreinte contrôlée) : oui.
- **D24** Le scanner **signale**, il ne bloque la CI que pour Unicode invisible/bidi dans les fichiers approuvés.
- **D25** Connecteurs inutiles (Vercel, Supabase, Base44, Cloudflare, Webflow, AdWhispr, Google…) : **je recommande de les déconnecter** (action de votre côté, dans les paramètres claude.ai) ; je ne peux pas le faire moi-même.
- **D26** Aucun appel réel au fournisseur d'IA, aucune clé demandée ; tout est testé avec un modèle factice.

## 5. Découpage et critères
- **S4-a** (code assistant) puis **S4-b** (chaîne de dev), chacun livré après votre « publie ».
- Critères : tests unitaires verts (corpus d'injection, clés factices, budgets, prompt capturé) ; e2e `kit31` (Centre de sécurité : contrôle `ia_garde` + verrous) ; `kit29` mis à jour (10 contrôles) ; test réel Appwrite (événements `ai.*` dans le journal, nettoyage vérifié) ; CI `ia:verifier` verte puis rouge sur altération simulée.
- Mise en production (après « publie ») : pipeline existant (dmp-api + site) ; **aucun changement de schéma**.
- Limites annoncées : le contenu réel des skills/connecteurs de votre compte n'est pas lisible depuis le dépôt ; l'inventaire reste déclaratif pour ces éléments.
