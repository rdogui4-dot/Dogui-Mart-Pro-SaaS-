# Lot S0 — Rapport d'audit de référence (lecture seule)

Date : 2026-11-21 · Référence : cahier des charges Sécurité & DevSecOps v2 · Commit audité : 1473598

## 1. Objectif et périmètre
Établir l'état réel avant toute modification : Appwrite (projet `6ae9d6010001952ea399`, base `dmp`), dépôt GitHub, workflows, site publié, code des fonctions. **Aucune modification** de la production ni du code n'a été faite. Aucun secret n'est reproduit dans ce rapport.

## 2. Méthode et limites
Lecture via l'outil Appwrite (liste de ressources, exécutions), API GitHub, `curl -I` sur le site, relecture du code, recherche de motifs de secrets dans l'arbre et l'historique git.
**Limites** : motifs de secrets simples (pas d'analyse d'entropie) ; réglages GitHub non exposés par l'outil (2FA du compte, jetons personnels, applications autorisées, règles du dépôt hors indicateur `protected`) : **non vérifiés, à confirmer par le propriétaire** ; aucune lecture du contenu des journaux au-delà de 2 exécutions d'échantillon ; aucun test d'intrusion.

## 3. Inventaire constaté (Appwrite)
- Projet nommé « PRO HRI CENTER » dans l'organisation « Meet Evidence », offre gratuite (niveau 0). Le projet de production est donc **partagé avec un autre nom/organisation** : à clarifier (D-décision).
- Base `dmp` : **102 tables réelles = 102 tables du schéma** (`scripts/schema.mjs`), aucune différence. Permissions de table vides, sécurité par ligne activée partout, 1255 colonnes toutes « disponibles », 151 index ; `tenantId` présent sur 100/102 tables (seules `platform_settings` et `market_cache` n'en ont pas, normal : tables de plateforme) ; `tenantId` indexé sur 78/102.
- Fonctions : `dmp-api`, `dmp-hooks` (exécution « any »). Droits de la clé de fonction : incluent écriture sur bases/tables.
- Stockage : 1 compartiment, taille maximale 3 Mo.
- Utilisateurs : un seul administrateur plateforme, **sans MFA**. Politique de mot de passe minimale ; durée de session 365 jours.
- Webhooks Appwrite : 0. Exécutions `dmp-hooks` : 0 (aucune notification reçue). `dmp-api` : 101 exécutions, journaux vides (aucun contenu sensible journalisé dans l'échantillon).
- Sauvegardes Appwrite : **non disponibles** sur l'offre gratuite.

## 4. Constats

| ID | Gravité | Constat | Preuve | Limite |
|---|---|---|---|---|
| S0-01 | Élevée | Aucune sauvegarde Appwrite (offre gratuite) : une perte de données cloud n'est récupérable que via les postes Windows ou des exports | `backups` refusé par l'offre | Les postes Windows ont leurs propres sauvegardes |
| S0-02 | Élevée | Compte administrateur plateforme unique, sans MFA ; e-mail de console identique à un utilisateur applicatif | liste des utilisateurs/MFA | — |
| S0-03 | Élevée | Branche unique (par défaut) non protégée : un push publie en production sans revue | `protected: false` | Règles d'organisation non visibles |
| S0-04 | Moyenne | Droits de la clé des fonctions plus larges que nécessaire (écriture bases/tables) | scopes lus | Réduction à tester avant (S1) |
| S0-05 | Moyenne | `DMP_RECEIPT_KEY` non défini : la signature des tickets (QR) retombe sur `APPWRITE_API_KEY`, puis sur une valeur de développement fixe | `pos-pro.ts:150` ; variable absente | Si la clé d'API change, tous les tickets déjà imprimés deviennent « invalides » |
| S0-06 | Moyenne | Compartiment limité à 3 Mo alors que la synchronisation accepte 5 Mo : un fichier de 3 à 5 Mo échouera | bucket vs `MAX_FILE_BYTES` | À aligner |
| S0-07 | Moyenne | Jeton du webhook de paiement transmis dans l'URL (`?k=`) : visible dans les journaux d'exécution (chemin de requête) | `dmp-hooks/main.ts` | Seule l'empreinte est stockée côté base ; jeton affiché une seule fois ; frein de rafale (30 jetons invalides/min par instance) ; comparaison en temps constant ; aucune exécution à ce jour |
| S0-08 | Moyenne | Pas de signature HMAC ni d'horodatage vérifié sur le webhook : rejeu possible si le jeton fuit | code `master-pay.ts` | Mitigations : doublons par empreinte de corps, jeton de demande à usage unique (`payment_refs`) |
| S0-09 | Moyenne | Limitation de débit : présente seulement pour l'assistant, les évaluations, les abonnements et le webhook ; pas de plafond général par utilisateur/IP sur `dmp-api` | recherche 429 | Pare-feu Appwrite non évalué |
| S0-10 | Moyenne | Site publié sans en-têtes de sécurité (CSP, X-Content-Type-Options, Referrer-Policy, frame) ; `access-control-allow-origin: *` ; seul HSTS présent | `curl -I` | Limite structurelle de GitHub Pages : CSP possible seulement via balise `<meta>` |
| S0-11 | Moyenne | Actions GitHub épinglées par étiquette (`@v4`), pas par empreinte de commit ; `desktop.yml` a `contents: write` | workflows | `publish.yml` est en `contents: read` |
| S0-12 | Faible | Aucun analyseur automatique (CodeQL, Dependabot, secret scanning) ni SBOM | `.github/` | Fonctions du dépôt non vérifiables ici |
| S0-13 | Faible | Aucun environnement de pré-production | inventaire | — |
| S0-14 | Faible | Installateur Windows non signé (avertissement SmartScreen) | CI | Empreinte SHA-256 publiée |
| S0-15 | Info | Aucun secret trouvé dans l'arbre ni dans l'historique (motifs : clés AWS/GitHub/Google/privées PEM/jetons Appwrite) ; seul `.env.example` est suivi | recherche git | Motifs simples |
| S0-16 | Info | Isolement par commerce : `tenantId` présent et le test structurel vérifie qu'il est dans le schéma de chaque table synchronisée | tests | — |

## 5. Inconnues de l'annexe B
Vérifiées : tables/schéma (B1), fonctions et variables (B2), compartiments (B3), sauvegardes (B4 : indisponibles), webhooks (B5 : aucun), protection de branche (B6 : absente), journaux (B7 : vides, rétention non mesurée), en-têtes (B8), secrets dans le dépôt (B9 : aucun).
**Non vérifiables avec les accès actuels** : 2FA du compte GitHub, jetons personnels, destinataire des alertes (B10) — à confirmer par le propriétaire.

## 6. Anomalies restantes et risques résiduels
Voir tableau §4. Risque principal : perte de données cloud sans sauvegarde plateforme (S0-01) et publication directe sans revue (S0-03).

## 7. Décisions à valider (D1–D10 du cahier v2)
Voir `docs/DOGUI_MART_PRO_CAHIER_DES_CHARGES_DEVSECOPS_V2.md` §D. Ajout issu de S0 : D11 — clarifier le rattachement du projet « PRO HRI CENTER / Meet Evidence ».

## 8. Prochaine étape proposée (sous réserve de validation)
Lot S1 « gains rapides », sans toucher aux données : protection de branche et revue, CodeQL/Dependabot/secret scanning, épinglage des actions, balise CSP, alignement 3 Mo/5 Mo, `DMP_RECEIPT_KEY` dédié, MFA et second administrateur plateforme.
