# MASTER DOGUI — étape 5 : assistant conversationnel — audit et plan (à valider)

Aucun code écrit à ce stade. Références : cahier v1.1, §7, §9.1–9.4, §11.1, §13, §13.1, §13.2, §18.1.

## 1. Constats (vérifiés dans le projet)
| Sujet | Constat |
| --- | --- |
| Fournisseur d'IA | **Aucun n'est configuré** dans le projet (ni variable, ni dépendance, ni secret côté fonction `dmp-api`). Le cahier (§13.1) exige de le valider avant production : fournisseur, localisation du traitement, clauses de confidentialité (pas d'entraînement sur vos données), base légale (loi 2013-450). Je ne peux ni le choisir à votre place ni inventer une clé. |
| Où placer une clé | Uniquement dans les **variables de la fonction Appwrite** `dmp-api` (jamais dans le code, le navigateur ou le dépôt). Je ne vois jamais la valeur : vous la saisissez dans la console Appwrite. |
| Sources de vérité | Les chiffres existent déjà, calculés de façon déterministe par les modules (tableaux de bord, caisse, stock, achats, dépenses, CRM, FinI, ICompta, IProj-Invest) et par MASTER (rapports, recommandations, profil). Le cahier impose que **le modèle rédige, ne calcule pas**. |
| Droits | `ctx` (rôle, boutiques, modules accessibles, formule) est déjà calculé côté serveur ; les fonctions de lecture des modules refusent déjà ce que le rôle ne peut pas voir. |
| Conversations | Aucune table. Visibilité par défaut : **privée à l'utilisateur** (§13.2). |
| Coûts / quotas | Aucun suivi de consommation IA. À créer avant tout appel externe. |
| Hors ligne | La PWA a déjà un cache de lecture ; une question hors ligne ne doit pas se perdre en silence (§11.1). |
| Jeu de référence | À créer (§18.1) : questions + réponses attendues sur données de test, seuil « 100 % des chiffres exacts, 0 donnée inventée ». |

## 2. Principe d'architecture proposé
1. **Outils déterministes** (lecture seule) : un catalogue fermé d'« outils » qui enveloppent des fonctions existantes (ex. ventes d'une période, stock critique, recommandations ouvertes, profil, rapport de clôture). Chaque outil vérifie les droits du demandeur, renvoie des **données agrégées** avec période, source et limites.
2. **Orchestrateur serveur** : choisit l'outil à partir de la question, jamais d'écriture de données métier. Aucune action modifiante dans cette étape (le cahier les soumet à confirmation et rôle : hors périmètre, à planifier).
3. **Couche IA interchangeable** (§9.4) : une interface `Provider` ; le modèle reçoit la question + les résultats d'outils **minimisés** et rédige la réponse structurée (conclusion, période, sources, méthode, observations, limites, confiance, recommandations).
4. **Contrôle de fondement** : tout nombre de la réponse doit figurer dans les résultats d'outils ; sinon la réponse est refusée (remplacée par les chiffres bruts et un avertissement). Pas de chiffre « inventé » possible.
5. **Minimisation (§13.1)** : liste de champs autorisés par outil ; clients nommés exclus ou pseudonymisés ; jamais de secrets, jetons ni données de paiement ; **journal de ce qui a été transmis** (outils, champs, volume), sans contenu sensible.
6. **Injection de prompt (§13)** : données et question traitées comme contenu délimité, jamais comme consigne ; texte de profil, notes et noms d'articles neutralisés ; tests d'injection et de fuite inter-entreprises.
7. **Quotas et coût** : plafond de questions par entreprise et par jour, longueur maximale, compteur de jetons ; refus clair au plafond ; suspendu sans licence valide (consultation de l'historique conservée).

## 3. Livraison en deux temps (proposition)
**5A — Socle sans fournisseur externe (réalisable immédiatement, coût nul)** : tables `md_chats`, `md_msgs`, `md_usage` ; outils déterministes ; orchestrateur ; **mode « questions guidées » sans IA** (liste de questions prêtes : ventes de la période, stock critique, écarts de caisse, recommandations ouvertes, etc., réponses structurées calculées) ; quotas ; journal de transmission ; confidentialité (privé par défaut) ; interface de conversation ; hors ligne (file conservée ou refus explicite) ; jeu de référence et tests (fondement, droits, isolation, injection) ; adaptateur `Provider` avec état honnête « aucun fournisseur configuré : l'assistant répond en mode guidé ».
**5B — Branchement du fournisseur IA** (après votre décision) : adaptateur du fournisseur choisi, variable de fonction posée par vous, rédaction en langage naturel, contrôle de fondement activé, mesure du jeu de référence (seuil à fixer avant production), plafonds de coût.

## 4. Ce qui reste hors périmètre
Agents multi-spécialités avancés, base de connaissances fiscale (§9.3, validation par un professionnel), actions modifiant des données, notifications externes (suspendues), consultation des conversations des collaborateurs (désactivée par défaut, annoncée si activée).

## 5. Décisions à prendre avant le code
1. **Livraison** : 5A d'abord (socle + questions guidées, sans fournisseur), puis 5B une fois le fournisseur choisi — d'accord ?
2. **Fournisseur IA pour 5B** : lequel (Anthropic Claude par défaut du cahier ? un autre ?), où traiter les données, et acceptez-vous de poser vous-même la clé dans les variables de la fonction `dmp-api` ?
3. **Plafonds par défaut** : 30 questions par jour et par entreprise, 600 caractères par question (modifiables) ?
4. **Conservation des conversations** : 12 mois puis purge (défaut proposé) ?
5. **Visibilité** : conversations privées à l'utilisateur uniquement (le propriétaire ne les consulte pas) ?
6. **Accès** : propriétaire et gérants (leurs boutiques) ; caissiers exclus ?
7. **Pseudonymisation des clients** : noms de clients exclus des données transmises (recommandé), seuls des agrégats sont envoyés ?
