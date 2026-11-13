# MASTER DOGUI — étape 6, lot 2 : IA — coût, conformité, qualité (livré)

Décisions validées (défauts de l'audit) : plafond global 1 000 000 de jetons/jour ; garde « offre payante confirmée » ; jeu de référence de 25 questions avec seuil 100 % de chiffres exacts.

## Variables de la fonction `dmp-api` (récapitulatif)
| Variable | Rôle |
| --- | --- |
| `MASTER_AI_ENABLED` | `true` pour permettre l'IA |
| **`MASTER_AI_BILLING_CONFIRMED`** | **nouveau, obligatoire** : `true` seulement après activation de la facturation (offre payante) chez le fournisseur ; sans elle, l'IA reste éteinte même si tout le reste est configuré |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_STYLE`, `GEMINI_API_VERSION` | fournisseur (inchangé) |
| `MASTER_AI_DAILY_TOKENS` | plafond par entreprise (200 000 par défaut) |
| `MASTER_AI_GLOBAL_DAILY_TOKENS` | **nouveau** : plafond global de la plateforme (1 000 000 par défaut, 10 000 à 100 000 000) |

## Livré
- **B3 garde de conformité** : l'IA exige `MASTER_AI_ENABLED` **et** `MASTER_AI_BILLING_CONFIRMED`. Le texte de l'assistant explique l'état « configurée mais en attente de la confirmation ».
- **B2 plafond global** : compteur de jetons de toute la plateforme par jour ; atteint = réponses calculées sans IA avec message ; compté aussi pour l'évaluation. Compteur volontairement approximatif sous forte concurrence (plafond souple).
- **B1 panneau administrateur** (Administration › « IA de MASTER DOGUI : coûts et qualité ») : état de configuration, questions / réponses IA / replis / jetons par jour sur 7 jours, plus gros consommateurs du jour, alertes (≥ 80 % du plafond global, > 30 % de replis).
- **B4 traçabilité** : modèle, style d'API et version du prompt conservés avec chaque réponse (rédigée ou repliée).
- **C1 jeu de référence** (`master-eval.ts`) : 25 questions (16 boutons + 9 formulations libres) sur des **données synthétiques** construites en mémoire à chaque appel (aucune donnée d'entreprise lue ni transmise). Action `platform.master.ai.eval`, réservée à l'administrateur, par lots de 3 (la fonction a 30 s) ; mesure : sujet bien classé, chiffres exacts, rédaction retenue / écartée, chiffres inventés bloqués, jetons ; verdict « seuil atteint » si 100 % de chiffres exacts et ≥ 90 % de sujets bien classés. Les 16 tests de chiffres attendus tournent aussi **sans fournisseur** (garde de non-régression).
- **Amélioration issue de l'évaluation** : quand l'IA est active, une question **saisie** voit son sujet choisi par l'IA ; les mots-clés ne servent plus que de repli si l'IA échoue (ils se trompaient sur des « faux amis » : « Qui me doit de l'argent ? » → trésorerie ; « …dans ma boutique » → synthèse). Les boutons restent explicites.
- **Appwrite** : colonnes `aiUsed`, `fallback` et index `dayonly` sur `md_usage`.

## Limites assumées
- Le jeu de référence mesure ce que le **vrai modèle** fait des questions : il n'a pas encore été lancé en réel (clé non disponible ici) ; la première mesure est à faire par l'administrateur depuis le panneau.
- Les chiffres « exacts » valident les outils déterministes sur le jeu synthétique ; le risque « donnée inventée » est borné par le contrôle de fondement (toute rédaction contenant un nombre inconnu est écartée et comptée).
- Le panneau lit tous les décomptes du jour (jusqu'à 20 000 lignes) : à reconsidérer à très grande échelle.
