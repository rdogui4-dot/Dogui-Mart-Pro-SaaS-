# Lot S2-a — Journal de sécurité (rapport)

Date : 2026-11-21 · Plan : `S2-PLAN.md` (D12–D16 validées : journal dédié `security_events`, lecture propriétaire seul).

## Livré (code, tests ; **pas encore en production**)
- **Domaine pur** `src/domain/security-events.ts` : liste fermée de 28 types d'événements (gravité, libellé, portée commerce/plateforme), empreinte SHA-256 chaînée, vérificateur de chaîne.
- **Tables** `security_events` (une ligne par événement) et `security_heads` (dernier numéro et dernière empreinte par commerce) dans `scripts/schema.mjs` ; lecture réservée au propriétaire (`permissions.ts`) ; écriture serveur seulement ; **jamais synchronisées** (`NOT_SYNCED`) : chaque machine (cloud, poste) garde sa chaîne intacte et sa « source ».
- **Écriture** `functions/dmp-api/src/security-log.ts` : atomique (événement + pointeur dans la même transaction), numéro pris par création exclusive (aucune fourche en écritures simultanées), **ne lève jamais** (une panne du journal ne casse pas l'opération), regroupement des rafales (un événement par clé et par minute, compteur reporté aux seuils 10/100/1000/10000).
- **Lecture** : actions `security.events` (propriétaire du commerce) et `platform.security.events` (administrateur plateforme) ; vérification de la chaîne à chaque lecture (modification, suppression au milieu/en fin, suppression totale détectées).
- **Événements branchés** : refus d'accès (sans identité, étranger au commerce, boutique, consultation seule, droits insuffisants, administration plateforme) ; employés (création, modification, droits, mot de passe, invitations) ; hébergement du poste (prise/retour) ; actions de la plateforme (abonnement, accès à vie, MASTER, réglages, webhook) ; webhook de paiement (rejeté, reçu, doublon) ; poste Windows : export et restauration de sauvegarde, rattachement au cloud, conflits de synchronisation.

## Choix de sécurité
- Un compte **étranger** à un commerce n'écrit jamais dans le journal de ce commerce (sinon n'importe qui pourrait le polluer) : son refus va au journal de la plateforme, regroupé. Test dédié.
- Aucun texte libre : champs courts contrôlés ; ni mot de passe, ni jeton, ni nom de fichier, ni phrase secrète (tests).
- Journal propre à chaque machine, non synchronisé.

## Preuves
23 tests `security-log.test.ts` (événements, refus, chaîne, concurrence, panne, rôles, isolation entre commerces) + 1 test webhook (`dmp-hooks`) + 1 test poste (export/restauration) + test de non-synchronisation + toutes les batteries existantes : **1710 tests verts**, typecheck propre.

## Limites connues
- **Rétention (D12, 13 mois)** : la purge n'est pas encore écrite ; elle doit conserver la vérifiabilité de la chaîne (point d'ancrage). Prévue en S2-b.
- Les connexions échouées restent dans Appwrite Auth (hors de notre code).
- L'acceptation d'invitation (action publique) n'est pas encore journalisée.
- Le regroupement est par instance de fonction : le compteur peut sous-estimer sur plusieurs instances (l'événement, lui, est toujours écrit).
- Un administrateur de la base Appwrite (accès console) peut modifier le journal **et** le pointeur ensemble : la chaîne détecte une altération partielle, pas un administrateur total (ancrage externe prévu en S3 avec le moniteur indépendant).

## Essai réel sur Appwrite (2026-11-21, comptes jetables, nettoyage vérifié)
Tables créées (colonnes et index « available »), code déployé, puis commerce jetable avec propriétaire, employé et compte étranger : lecture du journal par le propriétaire, création/modification d'employé journalisées (acteur, rôle, source « cloud »), étranger refusé et son refus **dans le journal de la plateforme seulement** (journal du commerce non pollué), propriétaire refusé sur le journal de la plateforme, chaîne valide : **7/7**.
**Deux défauts trouvés par cet essai et corrigés (tests ajoutés, redéployés)** :
1. La chaîne paraissait invalide : Appwrite relit la date en « +00:00 » au lieu de « Z » ; l'empreinte utilise maintenant une date normalisée (commit 3dcf00b).
2. Le journal de la plateforme avait pour droit de lecture « team:platform/owner » : n'importe quel compte pouvait créer une équipe d'identifiant « platform » et le lire. Il n'a désormais **aucun** rôle de lecture (commit e7d2315). Aucune équipe « platform » n'existait.
Nettoyage : 3 comptes, 1 équipe et toutes les lignes (commerce, abonnement, employé, journal d'audit, événements, pointeurs) supprimés ; absence vérifiée.

## Mise en production (réalisée)
1. Créer les 2 tables dans Appwrite (colonnes, index) depuis `scripts/schema.mjs`, puis vérifier colonnes « available ».
2. Pousser le code (déploiement automatique de `dmp-api` et `dmp-hooks`).
3. Essai réel (comptes jetables, nettoyage vérifié) : refus, succès, lecture, chaîne valide.
Tant que les tables n'existent pas, le journal échoue silencieusement sans affecter l'application.
