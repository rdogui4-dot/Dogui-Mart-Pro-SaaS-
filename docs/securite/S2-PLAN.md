# Lot S2 — Journal de sécurité et Centre de sécurité : plan (à valider)

Date : 2026-11-21 · Statut : **plan, aucun code écrit** · Précédents : S0 (audit), S1 (gains rapides).
Règle : audit → plan validé → implémentation → tests → e2e → « publie ». Rien n'est modifié avant votre validation.

## 1. Objectif
Donner au propriétaire d'un commerce (et à l'administrateur de la plateforme) une vue **réelle** de la sécurité : ce qui s'est passé (journal), l'état des protections (avec preuve et heure de mesure), et des actions simples et confirmées. **Aucun indicateur n'est affiché vert sans mesure** : sans donnée, l'état est « inconnu ».

## 2. Audit préalable (constaté dans le code)
| Sujet | Constat | Conséquence |
|---|---|---|
| Journal existant `audit_log` | 68 écritures dans `dmp-api` ; colonnes : `userId`, `action`, `detail` (texte libre), `shopId` ; pas de gravité, pas de résultat, pas de rôle, pas de numéro de requête, pas de chaînage | Bon pour l'historique métier ; insuffisant et risqué pour la sécurité (texte libre = fuite possible de données) |
| Refus d'accès (401/403, hors commerce, rôle insuffisant) | Non journalisés | Angle mort principal : une tentative d'accès à un autre commerce laisse aucune trace |
| Connexions échouées / réussies | Gérées par Appwrite Auth, **hors de notre code** | Non observables par `dmp-api` ; lecture possible seulement via l'API Appwrite si la clé a les droits (à tester) |
| Appareils / sessions | Sessions Appwrite ; poste Windows : liste d'appareils connectés (existe dans le serveur local) | Cloud : à vérifier (droit de lecture des sessions) ; poste : déjà disponible |
| Sauvegardes | Poste Windows : sauvegardes vérifiées + alerte 48 h (existe). **Cloud : aucune** (S0-01) | Afficher honnêtement « aucune sauvegarde cloud » |
| Méthodes de connexion Appwrite | Actives : e-mail/mot de passe, lien magique, code e-mail, **anonyme**, invitations, JWT, téléphone. Le code n'utilise que : e-mail/mot de passe, vérification d'e-mail, récupération de mot de passe, **session anonyme (acceptation des invitations, `src/lib/api.ts`)** | **Anonyme doit rester actif.** Lien magique, code e-mail, téléphone, JWT : aucun appel dans le code → désactivables après essai réel |
| Rôles | propriétaire/admin/gérant/caissier, accès par module (existant) | Le Centre de sécurité est réservé au propriétaire (et admin plateforme pour la vue plateforme) |

## 3. Ce que la maquette peut et ne peut pas afficher (honnêteté)
| Élément de la maquette | Faisable en S2 ? | Source réelle |
|---|---|---|
| Niveau de sécurité 98/100 | Oui, **calculé par règles visibles** (liste des points gagnés/perdus), pas un chiffre décoratif | contrôles listés §5 |
| Événements récents | **Oui** | `security_events` |
| Appareils connectés, sessions | Oui (poste) ; cloud si droit confirmé | serveur local / Appwrite |
| Sauvegardes à jour | Oui, état réel (poste) ; cloud : « aucune » | module sauvegardes |
| 2FA/MFA des membres | Partiel : état du compte propriétaire si lisible, sinon « inconnu » | Appwrite (à tester) |
| « Attaques bloquées 1 248 », « pays sources », carte, IP bloquées, WAF | **Non** : aucune source (pas de WAF, offre gratuite) ; on affiche « non disponible » | — |
| Instruction Shield, Attack Lab | Non en S2 | lot S4 / S5 |
| Self-Defense, intégrité, dérive de configuration | Non en S2 | lot S3 |
| Recovery Vault (12 mots, 2-sur-3), Trusted Recovery | Non en S2 | lot S6 (décision D8) |
| Mode de protection Standard/Renforcé/Confinement | Non en S2 (à définir : un mode doit avoir des effets mesurables) | à décider |

## 4. Conception
### 4.1 Table `security_events` (nouvelle, serveur seulement)
Colonnes : `tenantId`, `shopId` (opt.), `at`, `kind` (liste fermée), `severity` (info/avertissement/critique), `outcome` (accepté/refusé/échec), `actorId`, `actorRole`, `target` (type+id, **sans données personnelles**), `requestId`, `source` (cloud/poste), `prevHash`, `hash` (chaînage SHA-256 : toute suppression ou modification est détectable). Pas de texte libre ; la table n'est **ni modifiable ni supprimable** par l'application (écriture « ajout seulement »). Rétention : à décider (D12, proposition 13 mois). Table de plateforme séparée pour les événements sans commerce (webhook, administrateur).
Création des colonnes dans Appwrite via `scripts/schema.mjs` + script d'installation (modification de production **après votre « publie »**, avec vérification réelle comme au lot précédent).

### 4.2 Événements journalisés (liste fermée, chacun testé)
Accès refusé (sans identité, hors commerce, hors boutique, rôle insuffisant) · création/désactivation/changement de rôle d'un employé · réinitialisation de mot de passe d'un employé · changement d'abonnement/licence · export et restauration de sauvegarde · prise/retour d'hébergement du poste · rattachement du poste au cloud · conflits de synchronisation · webhook de paiement (accepté, rejeté, doublon) · actions de l'administrateur plateforme · désactivation/activation d'un module sensible. Anti-spam : regroupement des refus répétés (compteur par minute) pour qu'un attaquant ne remplisse pas le journal.

### 4.3 Moteur d'états (`security-status`)
Chaque contrôle renvoie `{id, état: ok | à surveiller | critique | inconnu, preuve, mesuré à, source}`. Règle : pas de mesure ⇒ `inconnu`, jamais `ok`. Contrôles S2 : 2FA du propriétaire, mots de passe faibles non applicable (géré par Appwrite : afficher la politique réelle), sauvegarde poste récente, sauvegarde cloud (absente = à surveiller), poste hébergeur synchronisé, appareils inconnus récents, conflits non examinés, licence, refus d'accès récents (seuil), continuité du journal (chaînage valide).

### 4.4 Interface « Centre de sécurité » (selon la maquette, version honnête)
Page unique réservée au propriétaire : bandeau d'état + score expliqué, événements (filtres, export CSV), appareils/sessions, sauvegardes, comptes et rôles, actions rapides **toutes confirmées** (révoquer une session, désactiver un employé, forcer un retour au cloud, lancer une sauvegarde). Aucune action automatique. Thème et composants du design existant ; accessible, mobile 360 px.

### 4.5 Durcissement de l'authentification Appwrite (production)
Désactiver, **un par un avec essai réel** (e2e réel 27/27 rejoué après chaque changement) : code e-mail, lien magique, téléphone, JWT. Conserver : e-mail/mot de passe, invitations, **anonyme**. Retour arrière immédiat si un essai échoue. Politique de mot de passe et durée de session (365 j) : proposition de valeur à décider (D13).

## 5. Étapes (dans l'ordre, un commit par étape)
1. **S2-a Journal** : schéma, écriture serveur (chaînage, regroupement), événements de §4.2, tests par événement (cas accepté et refusé), test de détection de rupture de chaîne.
2. **S2-b États** : moteur et contrôles §4.3, tests (dont « aucune donnée ⇒ inconnu »), actions serveur de lecture réservées au propriétaire.
3. **S2-c Interface** : page, composants, e2e par rôle (propriétaire voit, caissier/gérant refusé), mobile, export CSV.
4. **S2-d Actions confirmées** : révocation de session, désactivation d'employé, sauvegarde immédiate ; journalisées.
5. **S2-e Authentification** : désactivation progressive §4.5 avec essais réels et nettoyage.
6. Rapport S2 + mise à jour de la documentation ; essai de bout en bout sur le vrai Appwrite (comptes jetonnés, nettoyage vérifié).

## 6. Critères de sortie (preuves jointes au rapport)
Tests unitaires par événement et par contrôle ; e2e par rôle ; aucun statut vert par défaut (test dédié) ; chaîne du journal vérifiée et rupture détectée ; isolation par commerce (un commerce ne lit jamais les événements d'un autre : test dans la batterie existante) ; essai réel Appwrite ; 1684+ tests verts, typecheck, e2e de non-régression.

## 7. Risques et limites
Les connexions échouées ne sont pas visibles côté application (Appwrite) : affichées seulement si la lecture des journaux Appwrite est possible, sinon « non disponible ». Écriture d'un événement par requête refusée : coût et volume (regroupement prévu). Nouvelle table = modification de schéma de production (réversible : table supprimable, aucune donnée existante touchée). La désactivation de méthodes de connexion peut bloquer un usage non repéré : d'où les essais un par un.

## 8. Décisions à valider
- **D12** Rétention du journal : 13 mois (proposition) ?
- **D13** Durée de session : 365 j → 30 j (proposition) et politique de mot de passe minimale à relever ?
- **D14** Journal dédié `security_events` (proposition) plutôt que d'enrichir `audit_log` ?
- **D15** Les contrôles « inconnu » doivent-ils déclencher un bandeau d'alerte, ou rester discrets ?
- **D16** Le Centre est-il réservé au propriétaire (proposition), ou aussi aux gérants en lecture seule ?
- Confirmer l'ordre S2-a → S2-e et que S2-e (production) vienne en dernier.

## 9. Hors périmètre de S2
Alertes e-mail et moniteur indépendant (S3), sécurité de l'assistant IA (S4), préproduction et batterie d'autorisations sur 100 % des actions (S5), récupération par phrase/clé (S6), WAF/CDN (D3).
