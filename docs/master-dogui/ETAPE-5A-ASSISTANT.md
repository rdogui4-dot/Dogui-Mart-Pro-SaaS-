# MASTER DOGUI — étape 5A : assistant conversationnel, socle sans fournisseur d'IA (livré)

Plan validé (`AUDIT-ETAPE-5-ASSISTANT.md`), choix par défaut : 5A avant 5B ; 30 questions par jour et par entreprise ; 600 caractères ; conservation 12 mois ; conversations privées ; propriétaire et gérants ; aucun nom de client.

## Livré
- **Domaine** `src/domain/master-chat.ts` : catalogue fermé de 7 questions guidées, nettoyage de la question, appariement déterministe par mots-clés (sujet + période), **contrôle de fondement** (`groundedCheck` : tout nombre rédigé doit figurer dans les résultats déterministes ; prêt pour le branchement du modèle en 5B), plafonds, seuil de conservation.
- **Outils déterministes en lecture seule** (`master-chat.ts`) : ventes (avec remboursements séparés et comparaison à la période précédente), produits les plus vendus, stock à surveiller, écarts de caisse, encours de crédit clients (agrégats seulement), recommandations ouvertes, profil. Chaque réponse présente conclusion, période, boutique, chiffres, observations, méthode, sources, limites, niveau de confiance et recommandations.
- **Tables Appwrite** `md_chats`, `md_msgs`, `md_usage` (colonnes et index « available ») ; aucun droit de lecture client : tout passe par la fonction.
- **Actions** : `md.chat.ask`, `md.chat.list`, `md.chat.get`, `md.chat.delete` (consultation, lecture et effacement exemptés du verrou d'abonnement).
- **Confidentialité** : conversations privées à l'utilisateur (le propriétaire ne lit pas celles d'un gérant, aucune lecture inter-entreprises) ; effacement par l'utilisateur ; purge automatique au-delà de 12 mois lors de la consultation ; journal sans contenu (`chat.ask`, `chat.delete`) qui indique explicitement « aucune donnée transmise à un fournisseur externe ».
- **Quota** : plafond par entreprise et par jour, réservé de façon atomique (une ligne par question, création refusée si prise) ; le quota n'est consommé que lorsqu'un outil est exécuté ; une demande rejouée (même identifiant) ne consomme rien et renvoie la réponse déjà calculée.
- **Droits** : propriétaire et gérants (leurs boutiques) ; caissier refusé ; un outil refusé par les droits ou la formule répond « accès refusé », sans chiffres.
- **Sécurité** : la question est du contenu (balises et contrôles retirés), jamais une consigne ; aucune donnée d'une autre entreprise n'est atteignable ; texte hors catalogue : aucune réponse improvisée, liste des questions disponibles.
- **Licence** : nouvelle question exige une licence valide ; conversations consultables après expiration.
- **Hors ligne** : conversations déjà chargées lisibles ; une question tapée hors connexion reste dans la zone de saisie (brouillon local) avec un message explicite, jamais perdue en silence.
- **Interface** : onglet « Assistant » (boutique, période, questions guidées, saisie libre, conversations, suppression, quota restant).
- **Jeu de référence** (§18.1) : 17 tests serveur sur données de test avec chiffres exacts attendus (ventes, produits, stock, caisse, crédit), injection, fuite inter-entreprises, droits, quota, idempotence, conservation, licence.

## Ajout : synthèse de l'activité
Question « Comment se porte mon commerce ? » : sujet `overview` qui assemble les réponses des outils existants (ventes, stock, caisse, crédit clients, recommandations) pour la boutique et la période choisies, sans calcul supplémentaire. Une section refusée par les droits ou la formule est signalée dans les limites, jamais inventée. Une seule question consomme un seul quota.

## Ajout : 13 sujets supplémentaires (21 au total)
Dépenses, commandes fournisseurs, dettes fournisseurs, trésorerie (module Finance), clients, pipeline commercial (CRM), promotions, inventaires, transferts de stock, investissements, comptabilité (ICompta), équipe, valeur du stock. Chaque sujet lit les tables ou fonctions du module (lecture seule), applique le même contrôle de droits et de formule que le module (sinon « accès refusé » sans chiffres), reste limité à la boutique choisie (sauf l'équipe), ne présente aucun nom de client ni de personne, et cite ses limites (ex. une facture sans échéance n'est jamais « échue »). Le classement des questions pondère les expressions (ex. « transferts de stock », « dois-je ») et ignore les apostrophes. Jeu de test : `master-chat-topics.test.ts`.

## Limites assumées
- **Aucun langage naturel libre** : sans fournisseur d'IA, l'assistant ne comprend que les sujets du catalogue ; le reste est signalé comme non couvert (étape 5B).
- Les remboursements sont affichés à part, non déduits ; la marge n'est pas calculée (coût à la vente non enregistré).
- Appariement par mots-clés : une question à deux sujets équivalents est signalée ambiguë.
- Pas encore d'export PDF/Excel/CSV des réponses, ni de limite par utilisateur (le plafond est par entreprise).

## 5B (à décider)
Fournisseur d'IA, lieu de traitement, clauses de confidentialité, clé posée par vous dans les variables de `dmp-api`, plafonds de coût, seuil du jeu de référence avant production.
