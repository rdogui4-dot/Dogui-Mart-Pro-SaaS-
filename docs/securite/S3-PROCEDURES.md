# Surveillance indépendante — procédures (lot S3)

## Ce qui tourne
| Quoi | Fréquence | Où | Alerte |
|---|---|---|---|
| **Surveillance** (`surveillance.yml`) : sonde de `dmp-api` et `dmp-hooks`, versions en ligne comparées à la dernière publication réussie, site (CSP, version), certificats, ancre du journal de la plateforme | toutes les 15 minutes | GitHub Actions (aucun identifiant Appwrite) | l'exécution **échoue** (e-mail GitHub) et un ticket `[Alerte sécurité] <nom>` s'ouvre ; il se ferme tout seul au rétablissement |
| **Bilan** (`bilan-securite.yml`) | chaque lundi, vers 6 h UTC | GitHub Actions | un ticket « Bilan hebdomadaire » (signal de vie) ; alerte `moniteur_muet` si moins de la moitié des exécutions attendues |

## Recevoir les alertes par e-mail (D4)
1. GitHub → *Settings → Notifications* : laisser « Actions » (échecs de workflows) et « Issues » activés, avec l'e-mail du compte.
2. **Second destinataire** : lui donner l'accès au dépôt (lecture) puis qu'il clique **Watch → Custom → Issues** sur le dépôt ; il reçoit alors chaque ticket d'alerte. Aucun secret n'est nécessaire.
3. Les e-mails d'échec d'exécution partent à la personne qui a modifié le planning (`cron`) en dernier ; les tickets partent à tous ceux qui suivent le dépôt.

## Alertes et premiers gestes
| Alerte | Sens | À faire |
|---|---|---|
| `api_down` / `hooks_down` | une fonction ne répond pas | Console Appwrite → Functions → Executions / état de la fonction ; relancer le déploiement (workflow « Publier ») |
| `api_db_down` / `hooks_db_down` | la fonction répond, la base non | Console Appwrite → état de la base ; ne rien supprimer |
| `api_slow` / `hooks_slow` | réponse lente (> 8 s) | surveiller ; si persistant, voir les journaux d'exécution |
| `site_down` / `site_no_csp` | site indisponible / politique de sécurité disparue | vérifier le dernier déploiement du site ; `site_no_csp` = **modification du site à examiner immédiatement** |
| `drift_api` / `drift_hooks` / `drift_site` | la version en ligne n'est pas celle publiée | quelqu'un a déployé à la main, ou un déploiement a échoué à moitié : comparer avec le workflow « Publier », redéployer la version publiée |
| `deploy_unknown` | le dernier déploiement réussi est introuvable | vérifier que « Publier » s'exécute et que le moniteur a accès à l'API GitHub |
| `tls_*` | certificat proche de l'expiration | Appwrite et GitHub Pages renouvellent seuls ; vérifier si l'alerte persiste |
| `journal_rewind` | **le numéro du journal de la plateforme a reculé** : événements supprimés | traiter comme un incident : qui a eu accès à la base ? Voir ci-dessous |
| `journal_mismatch` | les deux fonctions ne lisent pas le même journal | vérifier les variables d'environnement des fonctions |
| `moniteur_muet` | le moniteur ne tourne plus normalement | voir « Si le moniteur lui-même tombe » |

### Après un nettoyage VOLONTAIRE de la base (essais, remise à zéro)
Le numéro du journal repart de zéro : l'alerte `journal_rewind` se déclenche, c'est voulu. Lancer **Actions → Surveillance → Run workflow** avec « reinitialiser_ancre » coché : le moniteur repart de l'ancre actuelle (action humaine, visible dans l'historique des exécutions).

## Si le moniteur lui-même tombe (SEC-C3-05)
Signes : pas de **bilan du lundi**, ticket `moniteur_muet`, ou aucune exécution récente dans *Actions → Surveillance*.
1. Vérifier *Actions → Surveillance* : si le workflow est **désactivé**, le réactiver (GitHub désactive les tâches planifiées d'un dépôt resté inactif 60 jours).
2. Lancer une exécution à la main (*Run workflow*) pour vérifier qu'elle réussit.
3. Si elle échoue sans alerte, lire le journal de l'exécution (accès à `api.github.com`, version de Node).
4. En attendant la remise en route, ouvrir le **Centre de sécurité** (Security Guardian) et la page *Actions → Publier* à la main chaque jour.
5. Exercice : une fois par trimestre, lancer la surveillance avec `simuler = panne` et vérifier que l'e-mail et le ticket arrivent.

## Essais commandés (sans toucher à la production)
*Actions → Surveillance → Run workflow* avec **simuler** :
- `panne` : les sondes visent une adresse inexistante → alertes de coupure ;
- `derive` : la « version publiée » est faussée → alertes de dérive ;
- `ancre` : le numéro du journal semble avoir reculé → `journal_rewind`.
L'exécution échoue (c'est le but) ; les tickets portent le préfixe `[SIMULATION]`. Une simulation ne ferme **jamais** un ticket réel ; la **prochaine exécution réelle ferme les tickets de simulation** (ils ne sont jamais un incident). L'ancre réelle n'est pas modifiée.

## Limites assumées
- Le moniteur partage le domaine de confiance **GitHub** avec le code (protection de branche partielle, 2FA activée, secret scanning actif).
- Les tâches planifiées de GitHub peuvent être retardées de plusieurs minutes : détection d'une coupure en **15 à 30 minutes**.
- La session anonyme du moniteur est conservée dans le cache d'Actions : elle n'ouvre aucun droit au-delà de ceux de n'importe quel visiteur.
- La configuration Appwrite (variables, droits, méthodes de connexion) n'est pas encore comparée à une référence (lot S3-d, en attente d'une clé en lecture seule).
