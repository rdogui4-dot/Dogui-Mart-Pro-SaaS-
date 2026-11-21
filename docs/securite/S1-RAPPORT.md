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

## Réglages GitHub / Appwrite : état au 2026-11-21
| Réglage | État |
|---|---|
| Secret scanning + push protection | activés (déclaré par le propriétaire) |
| Protection de branche | rulesets créés par le propriétaire (étiquettes : suppression et force-push interdits ; branche par défaut : suppression et force-push interdits). Pas de revue obligatoire : un push publie sans revue (risque accepté, compensé par les tests avant publication). Vérifié par captures d'écran |
| 2FA du compte GitHub | activée (déclaré par le propriétaire) |
| Signalement privé de vulnérabilités | activé (déclaré par le propriétaire) |
| Projet et organisation Appwrite renommés | projet « Dogui Mart Pro » vérifié par lecture (D11 clos) |

## Non fait volontairement
Réduction des droits de clé Appwrite, `DMP_RECEIPT_KEY`, alignement 3 Mo/5 Mo, MFA du compte plateforme : modifications de production ou de code métier, à planifier séparément avec essais.

## Observation supplémentaire (à décider)
Méthodes d'authentification Appwrite actives : e-mail/mot de passe, lien magique, code e-mail, **anonyme**, invitations, JWT, **téléphone** ; passkey désactivée. L'application n'en utilise que certaines : désactiver les méthodes inutilisées réduit la surface d'attaque (à vérifier par essai avant, lot S2).
