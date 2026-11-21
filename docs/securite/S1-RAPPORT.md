# Lot S1 — Gains rapides (rapport)

Date : 2026-11-21 · Suite du rapport S0 (`S0-RAPPORT-BASELINE.md`).

## Fait dans le dépôt (vérifié)
| Mesure | Constat S0 | Fichier | Vérification |
|---|---|---|---|
| CSP par balise `<meta>` (scripts en ligne autorisés par empreinte SHA-256 calculée à la construction, `object-src 'none'`, `base-uri`, `form-action`) | S0-10 | `vite.config.ts` | construction : balise présente avec l'empreinte ; e2e `master` : 9/9, aucune erreur console ; typecheck OK ; 1684 tests OK |
| Actions GitHub épinglées par empreinte de commit | S0-11 | `.github/workflows/*.yml` | empreintes lues sur les dépôts officiels (`git ls-remote`) |
| Workflow **Sécurité** : `npm audit` (production : échec dès « high »), SBOM CycloneDX (artefact 90 j), CodeQL, recherche de secrets arbre + historique, hebdomadaire | S0-12, S0-15 | `.github/workflows/securite.yml` | YAML valide ; `npm audit` = 0 vulnérabilité ; recherche de secrets = 0 résultat en local ; CodeQL à confirmer au premier passage CI |
| Dependabot (npm racine, npm desktop, actions) | S0-12 | `.github/dependabot.yml` | — |
| Politique de sécurité et `security.txt` (signalement privé GitHub) | — | `SECURITY.md`, `public/.well-known/security.txt` | servi sous le sous-chemin du site, pas à la racine du domaine (limite de GitHub Pages) |
| Maquettes de l'interface Security Guardian | — | `docs/securite/maquettes/` | 2 images enregistrées |

Limite de la CSP : `frame-ancestors` et les en-têtes HTTP ne se posent pas par balise `<meta>` ; `style-src` garde `'unsafe-inline'` (styles en ligne de React). Décision D3 (CDN/WAF) toujours ouverte.

## À faire par le propriétaire (réglages GitHub, hors de mes accès)
1. **Secret scanning + push protection** : Settings → Code security.
2. **Protection de branche / ruleset** sur la branche par défaut. Attention : exiger une pull request bloquerait aussi mes publications directes ; choix à faire : (a) bloquer force-push et suppression seulement (sans gêne), (b) exiger revue + CI verte (plus sûr, change notre façon de publier).
3. Activer **la 2FA** du compte GitHub et revoir jetons personnels/applications autorisées.
4. Activer « Private vulnerability reporting » (utilisé par `SECURITY.md`).
5. Rattachement Appwrite : renommer le projet « PRO HRI CENTER » ; l'organisation « Meet Evidence » est à traiter à part (D11).

## Non fait volontairement
Réduction des droits de clé Appwrite, `DMP_RECEIPT_KEY`, alignement 3 Mo/5 Mo, MFA du compte plateforme : modifications de production ou de code métier, à planifier séparément avec essais.
