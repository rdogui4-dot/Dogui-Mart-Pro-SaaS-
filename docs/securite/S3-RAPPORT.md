# Lot S3 — Autosurveillance et moniteur indépendant (rapport d'étape S3-a et S3-b)

Date : 2026-11-22 · Plan : `S3-PLAN.md`. Décisions prises (délégation du propriétaire) : **D4** e-mail du compte GitHub + second abonné du dépôt (procédure dans `S3-PROCEDURES.md`) ; **D5** toutes les 15 minutes ; **D17** e-mail GitHub + ticket, aucun secret ; **D18** S3-d reporté (aucune clé à fournir) ; **D19** rétention des déploiements : reportée (changement de production à faible valeur, à faire avec prudence plus tard).

## S3-a — Sonde et version (code, **pas encore publié**)
- Action publique `health.ping` (`dmp-api`) et `GET /health` (`dmp-hooks`) : version (empreinte de commit injectée à la construction), date de construction, heure, **ancre du journal de la plateforme** ; aucune donnée de commerce, aucun identifiant. Une seule lecture (prouve aussi que la base répond ; ancre « null » si elle ne répond pas). N'écrit rien, n'est pas journalisée (pas de saturation). Les autres actions exigent toujours une identité (test).
- `version.json` publié avec le site (empreinte du commit).
- **Défaut trouvé à l'audit : `dmp-hooks` n'était jamais redéployée par le pipeline** (seule `dmp-api` l'était) : les événements de sécurité du webhook (S2-a) ne sont donc pas encore en production. Le pipeline déploie maintenant les deux fonctions.
- Numéro de requête ajouté aux événements de sécurité écrits par les actions (observation de S2-d).

## S3-b — Moniteur indépendant (code, **pas encore publié**)
- Logique de décision pure et testée (`src/domain/monitor.ts`) : coupure, base muette, lenteur, site, CSP disparue, **dérive de version par composant** (tolérance pendant un déploiement et 20 minutes après), certificats (14 j / 3 j), **ancre du journal qui recule**, désaccord entre fonctions, déploiement introuvable (jamais « tout va bien » sans comparaison), moniteur muet.
- Observation sans aucun identifiant Appwrite (session anonyme réutilisée) ; tickets d'alerte dédupliqués et fermés au rétablissement ; **les simulations ne ferment que les simulations** (un essai ne masque jamais un incident réel) ; une alerte fait échouer l'exécution (e-mail GitHub).
- `surveillance.yml` (toutes les 15 min, simulation commandée `panne|derive|ancre`, réinitialisation d'ancre humaine) et `bilan-securite.yml` (hebdomadaire, détection d'un moniteur muet). Actions épinglées par empreinte.
- Procédures écrites : `S3-PROCEDURES.md` (destinataires, alertes, moniteur muet, essais).

## Preuves
23 tests de décision et de bilan, 10 tests d'observation avec réseau simulé (session anonyme créée puis réutilisée, expirée puis recréée, aucun identifiant envoyé, base muette, site sans CSP, dernier déploiement, tickets ouverts/fermés/dédupliqués, simulations isolées), 7 tests de la sonde, 2 de la sonde du webhook. Typecheck propre, YAML des workflows validé.

## À faire à la publication
1. Publier : le pipeline déploie `dmp-api` et `dmp-hooks` (premier déploiement de `dmp-hooks` depuis le 13 nov.) et le site avec `version.json`.
2. Vérifier en réel : `health.ping` et `GET /health` (versions = commit publié) ; un faux jeton de webhook produit bien l'événement `hook.rejected` (preuve que `dmp-hooks` est à jour).
3. Lancer le moniteur en réel puis les trois simulations (panne, dérive, ancre) : échec attendu, ticket `[SIMULATION]` ouvert, e-mail GitHub, fermeture ensuite ; mesurer le délai réel des exécutions planifiées.

## Reste du lot S3
S3-c (contrôles « changements de privilèges » et « activité du journal » dans le Centre de sécurité). S3-d reporté.
