# MASTER DOGUI — étape 5B : rédaction par Gemini (livré, inactif tant que non configuré)

Fournisseur choisi par la direction : **API Gemini**. Le code est déployé mais **inerte** : aucun appel externe n'a lieu tant que les variables ci-dessous ne sont pas posées dans la fonction Appwrite `dmp-api`.

## Activation (par vous, dans la console Appwrite : Functions › dmp-api › Settings › Variables)
| Variable | Rôle |
| --- | --- |
| `GEMINI_API_KEY` | Clé de l'API Gemini. **Jamais dans le code, le dépôt, une conversation ni une URL.** |
| `GEMINI_MODEL` | Identifiant du modèle à utiliser. **Aucun modèle n'est présumé** : à choisir dans Google AI Studio. |
| `MASTER_AI_ENABLED` | `true` pour activer. À ne poser **qu'après** avoir confirmé les conditions ci-dessous. |
| `GEMINI_API_VERSION` | (facultatif) version de l'API : `v1beta` par défaut ; `v1` ou `v1alpha` si votre modèle n'existe que sur celle-ci (l'exemple « Get code » d'AI Studio l'indique dans l'URL). |
| `MASTER_AI_DAILY_TOKENS` | (facultatif) plafond de jetons par entreprise et par jour, 200 000 par défaut. |
| `MASTER_AI_MAX_OUTPUT_TOKENS` | (facultatif) longueur maximale d'une réponse, 700 par défaut. |
| `MASTER_AI_TIMEOUT_MS` | (facultatif) délai maximal d'un appel, 20 000 par défaut. |

## Conditions à confirmer avant `MASTER_AI_ENABLED=true` (cahier §13.1)
- **Offre payante obligatoire.** D'après les conditions publiques de l'API Gemini, le contenu envoyé via l'offre gratuite peut servir à améliorer les produits de Google et être relu par des personnes ; ce n'est pas le cas des services payants (facturation activée sur le projet). Même en payant, relire la version en vigueur des conditions (journalisation temporaire de détection d'abus, localisation du traitement). Source : https://ai.google.dev/gemini-api/terms
- Base légale et information des personnes (loi n° 2013-450) : revue juridique à faire avant production.
- Alerte de budget sur le projet Google Cloud (en plus du plafond de jetons de l'application).

## Ce qui est transmis à Gemini
1. **Classement** (seulement pour une question hors catalogue) : le texte de la question, entouré de balises, avec l'ordre de choisir un sujet connu. Le modèle ne reçoit aucune donnée d'entreprise à ce stade.
2. **Rédaction** : la question et les résultats **déjà calculés** (titre, boutique, période, chiffres agrégés, observations, limites). Jamais de nom ou téléphone de client, de secret, de donnée de paiement, ni le profil de l'entreprise (texte libre) : la question « profil » n'est jamais transmise.
- Le journal (`chat.ask`) note : mode IA, version du prompt, longueur de la question, jetons, repli éventuel — jamais le contenu.

## Garde-fous
- Le modèle **ne calcule pas** : les chiffres, sources, méthode, limites et confiance viennent de l'outil. Sa conclusion n'est retenue que si elle ne contient **aucun nombre absent des résultats**, aucun lien, aucune balise ; sinon réponse calculée affichée avec explication.
- Panne, délai, HTTP ≠ 200, sortie illisible : **la question n'échoue jamais** ; repli sur la réponse calculée.
- Plafond de jetons du jour atteint : réponses calculées sans IA, avec message.
- Une question hors catalogue envoyée à l'IA **consomme le quota** (elle coûte un appel) ; pas de contournement par spam.
- Question et données traitées comme du contenu délimité, jamais comme consigne ; sortie JSON stricte.

## Limites assumées
- **Non testé avec la vraie API** : je n'ai ni clé ni accès réseau à Google depuis cet environnement. L'adaptateur (en-tête `x-goog-api-key`, route `v1beta/models/<modèle>:generateContent`, `systemInstruction`, `generationConfig`, `usageMetadata`) est testé avec des réponses simulées. Le premier appel réel est à vérifier ; en cas d'erreur de format, l'assistant retombe sur le mode guidé et la cause apparaît dans le message de repli.
- Les noms de champs de la réponse Gemini sont ceux que je connais ; seuls l'en-tête, la route et `usageMetadata.promptTokenCount` ont été recoupés avec la documentation publique.
- Pas de mesure de qualité sur le jeu de référence avec un vrai modèle (seuil à fixer avant production, §18.1).
