# MASTER DOGUI — audit de l'existant (aucune modification de code ni de schéma)

Date : 11 novembre 2026. Branche `ccr-360cd683-uvf925`. Références : cahier des charges v1.1.

## 1. Faits observés
| Sujet | Constat |
| --- | --- |
| Fonction IA | **Aucune.** Aucun appel à un fournisseur d'IA, aucune clé, aucune table de conversation, de mémoire ou de coût IA. |
| Backend | Une seule fonction Appwrite `dmp-api` (≈ 14 900 lignes TS, 93 fichiers), routeur d'actions `handlers.ts`, magasin abstrait `Store` (Appwrite et mémoire), lecture/écriture par clé serveur. Aucun planificateur (cron) ni webhook entrant. |
| Abonnement | Table `subscriptions` (un enregistrement par entreprise, id = tenantId, index unique), états essai / payé / à vie, essai de 14 jours créé **à la première lecture** (idempotent par entreprise). Garde `needFeature` (rang starter < business < pro) et `assertWritable`. |
| Paiement | **Activation manuelle** par l'équipe plateforme après vérification (`platform.payment.review`, `platform.subscription.grant`). Liens Selar enregistrés ; pas de confirmation automatique du prestataire. |
| Caisse | `cash_sessions` (statut open/closed, userId, openedAt/closedAt, comptage, théorique, écart, résumé JSON). **Une session ouverte par vendeur et par boutique** (`openSessionOf` filtre par userId). Une seule voie de clôture serveur : `closeSession` (met à jour le statut puis journalise). Ouverture : `openSession`, jamais automatique. |
| Rapports existants | `businessDashboard` et `proDashboard` (agrégats), rapports exportables au format commun `ReportData` (PDF/Excel/CSV) dans la plupart des modules, rapports de Silent Count, ICompta, IProj-Invest. Source de vérité exploitable sans duplication. |
| Journal | `audit_log` (boutique, utilisateur, action, détail) alimenté par toutes les actions sensibles ; `cash_ledger` pour la caisse Pro. |
| Droits | Rôles (propriétaire, gérant, comptable, caissier, magasinier), modules d'accès, étiquettes de permissions par boutique sur chaque ligne ; formules via `features.ts`. Isolation testée (`isolation.test.ts`). |
| Idempotence | Schémas éprouvés : identifiants déterministes (sha1 de clé de requête), réservations uniques dans `payment_refs`, lots atomiques (`batch`). Réutilisables pour « un rapport par session ». |
| Fuseau | Dates en UTC dans les rapports existants ; le tableau de bord gère un fuseau par boutique pour ses agrégats ; la notion de « date commerciale » n'existe pas comme règle unique. |
| Hors ligne | PWA avec cache et file d'envoi des ventes ; aucun mécanisme prévu pour des requêtes d'analyse différées. |
| Environnement | Appwrite Cloud (région Francfort), MCP pour le schéma, déploiement par archive `.tar.gz`. Réseau sortant des sessions limité ; l'accès sortant de la fonction vers un fournisseur IA n'a **pas été vérifié**. |

## 2. Inconnues (à lever avant conception détaillée)
1. Fournisseur et modèle IA, localisation du traitement, conditions de confidentialité et de coût.
2. Durée maximale d'exécution de la fonction Appwrite et limites de mémoire : une réponse IA peut dépasser la limite actuelle d'une action.
3. Possibilité de planificateur/événement Appwrite (Functions programmées) pour les analyses périodiques et les relances.
4. Moyen de paiement cible pour l'automatisation (Selar fournit-il des webhooks signés ?) ; en leur absence l'activation reste manuelle.
5. Règle de « date commerciale » par entreprise (fuseau, heure de bascule).
6. Gestion du droit d'accès/effacement (loi 2013-450) : processus et responsable.
7. Combien d'entreprises et de volumes (ventes/jour) pour dimensionner coûts et quotas.

## 3. Écarts avec le cahier des charges
| Exigence | Existant | Écart |
| --- | --- | --- |
| Licence indépendante, essai 14 j unique | Essai 14 j par entreprise, mais **attaché à la formule principale** ; supprimer et recréer une entreprise redonne un essai | Nouvelle licence séparée ; règle anti-contournement à définir |
| Activation par confirmation vérifiable du prestataire | Activation manuelle par la plateforme | Webhook signé ou file de vérification manuelle journalisée |
| Mode consultation à l'expiration | Verrou global `assertWritable` (402) pour l'abonnement principal | Verrou propre à MASTER DOGUI, sans toucher aux autres modules |
| Rapport d'ouverture « si aucune session ouverte » | Une session par vendeur : plusieurs sessions peuvent coexister dans une boutique | Définir « périmètre » : boutique entière (toute session ouverte bloque le briefing) |
| Rapport de clôture après clôture confirmée | Point d'accroche unique et propre dans `closeSession` | Aucun écart technique ; prévoir un rejeu si la génération échoue |
| Rapports idempotents et versionnés | Schéma d'idempotence disponible, pas de table de rapports automatiques | Table et clé `business+store+type+date+session` |
| Calculs reproductibles, sources citées | Moteurs déterministes existants (marge, trésorerie, stock) | Couche d'agrégation commune et contrat de « source » |
| Mémoire/profil qualifiés | Réglages par module, pas de profil unifié | Nouveau profil d'entreprise |
| Conversation, recommandations suivies | Rien | À créer |
| Coûts IA, quotas, console d'administration | Aucun suivi ; console plateforme existante pour les abonnements | À créer |
| Base de connaissances datée (fiscalité…) | Rien | À créer + responsable de mise à jour |
| Minimisation des données vers le fournisseur IA | Rien | Couche de pseudonymisation |

## 4. Risques
- **Hallucination et chiffres faux** : à écarter en n'envoyant au modèle que des résultats pré-calculés et en vérifiant les nombres cités.
- **Fuite entre entreprises** : mémoire et contexte doivent porter businessId/storeId et rôle à chaque appel (déjà la discipline du projet).
- **Données personnelles vers un tiers** (loi de 2013) : base légale, contrat et pseudonymisation à valider avant production.
- **Coût IA non maîtrisé** : plafonds et mode dégradé (rapports déterministes seuls).
- **Dépendance à un fournisseur** : couche d'abstraction dès le départ.
- **Limites d'exécution** de la fonction : réponses longues ou analyses multiples à découper (tâches asynchrones).
- **Injection de prompt** via libellés d'articles, notes, noms de clients : toute donnée est traitée comme du contenu.
- **Fraude à l'essai** par recréation d'entreprise.
- **Complexité commerciale** si l'activation reste manuelle (délais, erreurs).

## 5. Ce qui est réutilisable tel quel
Droits et isolation, journal d'audit, schéma d'idempotence, format `ReportData` et exports, moteurs de calcul (caisse, stock, trésorerie, marge, prévisions, investissements), garde de formule, console plateforme, conventions de tests (mémoire + navigateur), déploiement.

## 6. Plan proposé (à valider)
1. **Fondations** : licence MASTER DOGUI séparée (essai, période payante, consultation), événements de licence journalisés, interface d'état. Aucune IA.
2. **Rapports déterministes** : rapport de clôture (accroche dans `closeSession`, idempotent par session, rejouable) et briefing d'ouverture (calculé à la demande, une fois par date commerciale, bloqué si une session est ouverte dans la boutique). Sources et limites affichées. Partiel en cas de données manquantes.
3. **Profil d'entreprise** : informations qualifiées (vérifiée / déclarée / hypothèse / estimation), modifiable, isolé.
4. **Recommandations** : règles déterministes sur les modules (rupture, surstock, écart de caisse, créance, échéance), statut et suivi du résultat.
5. **Assistant conversationnel** : couche d'abstraction du fournisseur, outils en lecture seule appelant les moteurs existants, réponses structurées, quotas et coûts, contrôle des nombres cités.
6. **Commercialisation** : paiement vérifiable (webhook si disponible, sinon file de validation), rappels, mode consultation.
7. **Validation** : jeu de questions de référence, isolation, charge, coûts, revue juridique.

Les étapes 1 à 4 ne dépendent d'aucun fournisseur IA et livrent déjà de la valeur ; l'étape 5 attend les décisions du chapitre 2.

## 7. Décisions attendues de la direction
1. Fournisseur IA et localisation du traitement (ou : commencer sans IA par les étapes 1 à 4).
2. « Périmètre » du briefing d'ouverture : boutique entière (recommandé) ou par vendeur.
3. Règle anti-contournement de l'essai (identifiant retenu).
4. Règlement de la première période payante et délai de grâce.
5. Visibilité des conversations par le propriétaire.
6. Périmètre de la version 1 (cahier des charges, 19.1).
