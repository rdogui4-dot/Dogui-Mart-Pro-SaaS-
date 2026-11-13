# MASTER DOGUI — étape 4 : moteur de recommandations suivies — audit et plan (à valider)

Aucun code écrit à ce stade. Références : cahier v1.1, §8 et §8.1 (priorités, statuts, suivi sans causalité présumée, seuil minimal de données, seuils paramétrables, pas de re-proposition à l'identique d'une recommandation refusée).

## 1. Ce qui existe (vérifié dans le dépôt)
| Élément | Existant | Constat |
| --- | --- | --- |
| Recommandations calculées par les modules | `expenses-intel.ts` (variation de catégorie, doublons, modèles récurrents, fournisseur moins cher), `promotions-pro.ts` (suggestions), `analytics.ts` (prévisions de réappro), `pos-intel.ts` (remises), `crm-pro.ts` (ventes croisées), `stock-pro.ts` (réapprovisionnement), alertes `stock-biz.ts` | Calculées à la demande, **jamais enregistrées** : aucun statut, aucun suivi, aucune mémoire de ce qui a été refusé |
| Recommandations dans les rapports MASTER (étape 2) | `Reco` embarquée dans `md_reports.data`, statut figé « nouvelle » | Texte de rapport, pas un objet suivi ; si le rapport est régénéré, aucun lien avec une décision |
| Priorités, motif, sources, nature fait/estimation | Types `Prio`, `Reco` (master-report.ts) | À réutiliser tels quels |
| Profil (étape 3) | Priorités et objectifs déclarés | Peut ordonner les recommandations, jamais en inventer |
| Licence | `needMaster`, mode consultation | Génération réservée à une licence valide ; consultation de l'historique toujours permise |
| Planificateur / tâches de fond | Aucun | Pas d'exécution en arrière-plan : la génération se fait à la demande ou sur événement (pas d'horloge) |

## 2. Principe retenu
**Ne pas dupliquer les calculs des modules** : le moteur appelle leurs fonctions existantes (lecture seule), transforme chaque constat en recommandation normalisée, l'enregistre **une seule fois** et suit sa vie. Aucune action n'est exécutée automatiquement (« Rien n'est créé ni activé automatiquement »).

## 3. Plan proposé
**Table `md_recos`** (une ligne par recommandation) : `tenantId`, `shopId` (ou « entreprise »), `ruleId` (liste fermée), `fingerprint` (empreinte des faits déclencheurs : arrondie, pour ne pas varier à chaque lecture), `prio`, `title`, `reason`, `sources` (JSON : module, période, valeurs), `kind` (fait / estimation), `confidence` (haute/moyenne/basse, dérivée de la quantité de données), `status`, `statusAt`, `statusBy`, `note`, `snoozeUntil`, `baseline` (JSON : valeur de la mesure suivie au moment de l'acceptation), `outcome` (JSON : mesure ultérieure), `createdAt`. **Index unique (entreprise, boutique, ruleId, fingerprint)** : la génération est idempotente et concurrente-sûre (création refusée si elle existe).

**Cycle de vie (§8)** : nouvelle → acceptée | refusée | reportée ; acceptée → en cours → réalisée | sans effet mesurable ; reportée → redevient nouvelle à `snoozeUntil`. Toute transition est validée côté serveur (machine d'états), journalisée dans `audit_log`, horodatée et signée de l'utilisateur.

**Pas de re-proposition à l'identique (§8.1)** : une recommandation refusée garde son empreinte ; elle n'est recréée que si les faits changent assez pour produire une **nouvelle empreinte** (seuil d'arrondi documenté par règle).

**Suivi des résultats sans causalité** : à l'acceptation, la mesure de la règle est figée (`baseline`) ; à la réalisation ou à la demande, la même mesure est relue (`outcome`) et affichée « évolution observée entre deux dates : X -> Y ; ce changement n'est pas attribué à cette action ». « Sans effet mesurable » = choix de l'utilisateur ou constat automatique informatif (mesure inchangée après le délai de suivi). Aucune promesse de gain.

**Données insuffisantes (§8.1)** : chaque règle a un seuil minimal (historique, nombre de ventes) ; en dessous, aucune recommandation n'est émise : un message « données insuffisantes » (non stocké comme recommandation) indique ce qui manque.

**Règles initiales (liste fermée, déterministes, sur données réelles)** — à valider :
1. Rupture ou stock sous seuil critique (alertes stock Business) → réapprovisionner.
2. Réapprovisionnement conseillé sur historique suffisant (stock Pro) → estimation, confiance selon l'historique.
3. Écarts de caisse répétés sur une période (caisse) → revoir la procédure ou former.
4. Dépenses : variation anormale de catégorie, doublons potentiels, fournisseur moins cher (`expenses-intel`).
5. Créances clients échues (crédit client).
6. Commandes fournisseurs en retard de réception (achats).
7. Suggestions promotionnelles existantes (promotions Pro).
Chaque règle cite sa source (module, période, valeurs) ; les règles absentes d'une formule (Pro) ne tournent pas pour une entreprise Business.

**Seuils paramétrables par l'entreprise (§8.1)** : une ligne de configuration (`md_reco_cfg`, JSON borné et validé) ; valeurs par défaut documentées dans le code et affichées dans l'interface ; modification réservée au propriétaire, journalisée.

**Déclenchement** : bouton « Actualiser » (à la demande) et accrochage idempotent à l'ouverture du briefing et à la clôture (mécanisme `closeHooks` existant) ; jamais bloquant pour la caisse ; erreurs avalées et tracées.

**Profil** : les priorités et l'objectif du profil **réordonnent** l'affichage (jamais ne créent ni ne suppriment une recommandation) ; l'ordre appliqué est indiqué à l'utilisateur.

**Droits** : propriétaire (toutes les boutiques) et gérant (ses boutiques) lisent et décident ; caissier refusé ; isolation par entreprise et par boutique testée.

**Interface** : onglet « Recommandations » (centre) : filtres par statut/priorité/boutique, fiche (motif, sources, période, confiance, fait/estimation), boutons de décision (accepter, refuser avec motif facultatif, reporter jusqu'à une date), suivi (en cours, réalisée, sans effet), évolution observée, historique des décisions.

**Tests** : machine d'états (transitions interdites), idempotence et concurrence de la génération, non-re-proposition après refus et nouvelle proposition si les faits changent, report et réveil, baseline/outcome sans causalité, seuils minimaux, licence expirée (génération suspendue, historique consultable), droits et isolation, une règle par module avec données réelles de test.

**Hors périmètre** : rédaction par IA, actions automatiques, notifications externes (suspendues), prévisions nouvelles (on réutilise celles des modules).

## 4. Limites à connaître
- Les mesures de suivi reposent sur ce que chaque module sait calculer à deux dates ; pour une règle sans mesure fiable, le suivi se limite au statut.
- Sans historique suffisant, certaines règles resteront silencieuses : c'est voulu.
- (Correction du 13 novembre 2026 : le coût est figé à la vente, la marge exacte est possible.) Aucune règle de marge n'est incluse dans cette étape.

## 5. Décisions à valider
1. **Qui décide** : propriétaire et gérants (pour leurs boutiques), ou propriétaire seul ?
2. **Règles initiales** : la liste de 7 règles convient-elle (en retirer ou en ajouter) ?
3. **Report par défaut** : 7 jours (modifiable à chaque report) ?
4. **Délai de suivi** : 14 jours après l'acceptation pour relire la mesure et proposer « réalisée / sans effet mesurable » ?
5. **Recommandations des rapports** : les rendre suivies (même moteur, même table) ou laisser les rapports tels quels ?
6. **Conservation** : historique conservé sans limite (recommandé) ou archivage après 12 mois ?
