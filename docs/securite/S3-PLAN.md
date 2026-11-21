# Lot S3 — Autosurveillance et moniteur indépendant : audit et plan (à valider)

Date : 2026-11-21 · Statut : **audit fait, plan proposé, aucun code écrit.** Référence : cahier v2 §6.3 (SEC-C3-01 à 08), D4, D5.
Règle : audit → plan validé → implémentation → tests → validation → « publie ».

## 1. Audit préalable (constaté)
| Sujet | Constat | Conséquence |
|---|---|---|
| Sonde de santé | Aucune. Un appel sans identité répond « Connexion requise » (401) : on sait que la fonction répond, mais pas **quelle version** tourne | Il faut une action publique minimale `health.ping` |
| Version déployée | Les déploiements Appwrite sont créés « manuellement » par le pipeline : **aucun hash de commit ni somme de contrôle** n'est enregistré (`providerCommitHash` vide). 102 déploiements sont conservés (`deploymentRetention` = 0 = illimité) | La dérive ne peut pas se lire dans la console : le **code de la fonction doit déclarer lui-même sa version** (empreinte de commit injectée à la construction) |
| Dérive du site | Le site publié ne déclare pas sa version | Un fichier `version.json` (commit, date) publié avec le site |
| Moniteur | Aucun. GitHub Actions est le seul domaine **indépendant d'Appwrite** (identifiants et hébergement distincts) mais il partage le domaine de compromission du dépôt (protection de branche partielle, 2FA activée, secret scanning actif) | Moniteur = tâche planifiée GitHub Actions, sans aucun identifiant Appwrite |
| Canal d'alerte e-mail | Aucun fournisseur SMTP : Appwrite Messaging non configuré (`smtpEnabled: false`). **GitHub envoie lui-même des e-mails** : échec d'un workflow planifié (à la personne qui a modifié le cron) et ouverture d'un ticket (aux abonnés du dépôt) | Alerte e-mail **sans secret ni fournisseur** : échec du workflow + ticket « Alerte sécurité » avec déduplication et clôture au rétablissement |
| Continuité du journal | La chaîne détecte modification, suppression partielle, suppression du début ; mais un administrateur de la base pourrait supprimer **tout le journal et son pointeur** sans trace (limite connue S2-a) | **Ancre externe** : le moniteur mémorise le dernier numéro du journal de la plateforme ; un numéro qui recule = alerte |
| Préproduction | Inexistante (lot S5) | L'essai de coupure se fait par **simulation commandée** (voir §4), pas en coupant la production |
| Planification GitHub | Les tâches planifiées peuvent être retardées de plusieurs minutes et sont désactivées après 60 jours sans activité du dépôt | Délai de détection réaliste annoncé (§5) ; activité du dépôt régulière ; bilan hebdomadaire pour détecter un moniteur muet |
| Changements de privilèges | Le changement de rôle d'un employé n'a pas d'événement dédié ; seule la modification générique est tracée | Événement dédié + contrôle dans le Centre (S3-c) |

## 2. Conception
**S3-a — Sonde et version (code)**
- Action publique `health.ping` : répond `{ ok, version (empreinte de commit), builtAt, journal: { seq } }` **sans aucune lecture de donnée de commerce**, sans identité, très bon marché (une lecture du pointeur du journal de la plateforme). Pas de journalisation de chaque appel (pas de saturation). Limitée : ne renvoie jamais de nom, d'identifiant de commerce, ni d'adresse.
- Empreinte de commit injectée à la construction (`dmp-api`, `dmp-hooks` et site) ; `version.json` publié avec le site.
- Ajout du numéro de requête manquant aux événements de sécurité écrits par les actions (observation de S2-d).

**S3-b — Moniteur indépendant (GitHub Actions, `surveillance.yml`)**
Toutes les N minutes (D5) : (1) la sonde répond dans un délai borné ; (2) **dérive** : version de la fonction = dernier déploiement réussi du pipeline (tolérance pendant un déploiement) ; version du site = idem ; (3) site joignable et **CSP présente** ; (4) **certificats** TLS du site et du point d'accès Appwrite valides plus de 14 jours ; (5) ancre du journal : le numéro ne recule jamais. Tout écart ⇒ échec du workflow (e-mail GitHub) **et** ticket « Alerte sécurité » (un seul ticket ouvert par type d'alerte, mis à jour, clos automatiquement au rétablissement). **Bilan hebdomadaire** (ticket de synthèse) : son absence signale un moniteur muet (SEC-C3-05). Le moniteur n'écrit rien dans Appwrite et ne détient aucun identifiant Appwrite.

**S3-c — Contrôles dans le Centre de sécurité**
- Contrôle « Changements de privilèges (7 jours) » (rôle élevé, nouveau propriétaire) avec événement dédié.
- Contrôle « Activité du journal » : volume anormalement nul alors que l'activité existe ⇒ à surveiller (SEC-C3-03).

**S3-d — Référence de configuration (nécessite une clé de lecture, décision D18)**
Fichier versionné de la configuration **attendue** (variables de la fonction — noms seulement —, droits de la clé, méthodes de connexion, liste des tables, limites du compartiment, durée de conservation des déploiements), comparé par un script en lecture seule. Sans clé fournie par le propriétaire, ce contrôle est **« non vérifié »** (jamais « ok »).

## 3. Ce que ce lot ne fait pas
Pas de blocage ni de retour arrière automatique (règle « aucune action automatique ») ; pas d'alerte SMS/WhatsApp (suspendus) ; pas de préproduction (S5) ; pas de signature de code (D7).

## 4. Essais prévus (critères de sortie)
- **Coupure simulée** : lancement manuel du moniteur avec l'option `simuler_panne` (la sonde vise une adresse invalide) ⇒ le workflow échoue, un ticket est ouvert et l'e-mail GitHub part ; relance sans simulation ⇒ ticket clos.
- **Dérive injectée** : option `simuler_derive` (version attendue différente) ⇒ alerte ; sans simulation ⇒ rétablissement.
- **Ancre** : numéro de journal reculé (simulation dans un test) ⇒ alerte ; croissance normale ⇒ pas d'alerte.
- Tests unitaires de la sonde (aucune donnée exposée, réponse sans identité), de la logique de décision du moniteur (pure et testée), de l'empreinte de version ; e2e du Centre pour les nouveaux contrôles.
- Mesure réelle du délai de détection (journal des exécutions planifiées).

## 5. Décisions à valider
- **D4** — destinataires : e-mail du compte GitHub du propriétaire + au moins un second destinataire (à ajouter comme abonné du dépôt). Lequel ?
- **D5** — fréquence : proposition **toutes les 15 minutes** (détection d'une coupure en 15 à 30 minutes ; GitHub peut retarder). Plus court (5 min) possible mais plus sensible aux retards et au quota.
- **D17** — canal : e-mail GitHub + ticket (proposé, **aucun secret**) plutôt qu'un fournisseur SMTP (secret à stocker).
- **D18** — S3-d : le propriétaire crée lui-même, dans la console Appwrite, une **clé en lecture seule** et la saisit dans les secrets GitHub (jamais dans le chat) ? Sinon S3-d est reporté et le contrôle reste « non vérifié ».
- **D19** — rétention des déploiements Appwrite : passer de « illimitée » (102 conservés) à « les 10 derniers » (réduit la surface et le stockage) ?
- Ordre S3-a → S3-b → S3-c → S3-d, un commit par étape, publication à la fin de chaque étape sur votre « publie ».
