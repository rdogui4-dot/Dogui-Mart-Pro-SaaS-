# Lot S4-a — Garde IA de l'assistant MASTER : rapport

Date : 2026-11-22. Périmètre : SEC-C2A-01 à 07. **Non publié** (en attente de « publie »). Aucun appel réel au fournisseur d'IA, aucune clé utilisée : tous les essais emploient un modèle factice.

## Ce qui a changé
| Exigence | Réalisation | Preuve |
|---|---|---|
| 01 Texte = donnée | Marqueurs `[CONSIGNES]`, `[DONNÉES]`, `[SYSTEM]`… neutralisés dans toute saisie ; caractères invisibles/bidi retirés ; `<` `>` toujours retirés | `ai-guard.test.ts`, test « 25 injections » (modèle hostile) |
| 02 Pas de donnée d'un autre commerce | Capture du prompt réellement envoyé : aucun nom, téléphone, identifiant ni montant d'un autre commerce, ni de données nominatives du commerce | `master-ai-guard.test.ts` (prompt capturé) |
| 03 Sortie jamais exécutée | `checkWrite` refuse : liens (http, www, markdown, `javascript:`, domaine nu), code/balises, invisibles, e-mails, téléphones, secrets, nombres absents des faits ; repli sur la réponse calculée ; événement `ai.output.rejected` (code de raison) | 10 sorties hostiles, aucune écriture déclenchée |
| 04 Secrets | `detectSecrets` (10 formats, TYPE seulement) : question refusée **422 avant tout appel**, sans stockage ni quota ; sortie contenant un secret écartée et comptée « critique » ; événement `ai.secret.blocked` sans valeur | clés factices, journaux et audit vérifiés sans la valeur |
| 05 Budgets | Alertes `ai.budget.warn` (80 %) / `ai.budget.full` (100 %), une fois par jour et par palier, dans le journal de la plateforme ; dépassement ⇒ réponse calculée sans IA | test de dépassement |
| 06 Journal | Notes de `chat.ask` sans texte du fournisseur (parenthèses retirées) | test erreur 404 |
| 07 Double verrou | inchangé et testé ; état affiché dans le contrôle **« Assistant IA : verrous et garde »** (10ᵉ contrôle du Centre de sécurité : sans objet / ok / à surveiller / critique) | tests + e2e `kit29` (10 contrôles) |

Nouveaux événements : `ai.secret.blocked`, `ai.output.rejected` (journal du commerce) ; `ai.budget.warn`, `ai.budget.full` (journal plateforme).

## Vérifications
- Tests unitaires : 146 fichiers, **1832 tests verts** ; `tsc` sans erreur.
- e2e `kit29` : 10 contrôles, journal, filtres, rupture de chaîne, responsive : tous OK.
- Aucun changement de schéma Appwrite.

## Limites (dites telles quelles)
- Détection de secrets par **formats connus** : un secret de format inédit, ou une chaîne courte, n'est pas reconnu.
- Aucun essai avec le vrai fournisseur (pas de clé, et ce n'est pas nécessaire au contrôle) : le comportement réel du modèle n'est pas mesuré.
- La carte « verrous » est intégrée au contrôle (texte de preuve), pas une carte distincte.
- Essai réel Appwrite (écriture des événements `ai.*` dans le journal) : à faire après « publie », car il exige le déploiement de `dmp-api`.
- Faux positif possible : un montant de 8 à 15 chiffres écrit sans espaces par le modèle est considéré comme un numéro et sa rédaction écartée (repli calculé, sans conséquence).
