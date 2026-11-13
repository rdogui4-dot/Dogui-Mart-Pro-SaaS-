# MASTER DOGUI — récapitulatif de validation (version 1)

Date : 13 novembre 2026. Ce document dit, sans embellir, **ce qui est livré, ce qui a été vérifié pour de vrai, ce qui ne l'a été que par simulation, et ce qui reste à votre charge**. Il se rapporte au périmètre proposé de la version 1 (cahier v1.1, §19.1).

## 1. Périmètre de la version 1 (§19.1)
| Élément | État | Documents |
| --- | --- | --- |
| Licence et essai | Livré | `ETAPE-1-LICENCE.md` |
| Briefing d'ouverture | Livré (sans IA) | `ETAPE-2-RAPPORTS.md` |
| Rapport de clôture | Livré (sans IA) | `ETAPE-2-RAPPORTS.md` |
| Profil d'entreprise | Livré | `ETAPE-3-PROFIL.md` |
| Recommandations suivies | Livré | `ETAPE-4-RECOMMANDATIONS.md` |
| Assistant sur les modules disponibles | Livré : 21 sujets calculés ; rédaction par IA optionnelle | `ETAPE-5A-ASSISTANT.md`, `ETAPE-5B-GEMINI.md` |
| Durcissement avant vente | Livré (3 lots) | `ETAPE-6-LOT1-SECURITE.md`, `ETAPE-6-LOT2-IA.md`, `ETAPE-6-LOT3-PRODUIT.md` |
| Exploitation et juridique | Consigne livrée ; textes en **projet** | `EXPLOITATION.md`, `TEXTES-JURIDIQUES-PROJET.md` |

**Hors version 1, non réalisés comme prévu au cahier** : veille concurrentielle, fiscalité détaillée, RH avancée (seul un décompte de l'équipe existe), automatisations d'actions externes. **Aussi non réalisés** : base de connaissances sourcée et datée (§9.3), « agents » spécialisés au sens d'un orchestrateur multi-modèles (l'assistant utilise un catalogue fermé d'outils calculés par domaine), exports sous forme de rapports planifiés, notifications externes (WhatsApp, SMS, e-mail : suspendues).

## 2. Ce qui a été vérifié pour de vrai (environnement réel)
- **Base Appwrite** : 11 tables MASTER (`md_licenses`, `md_trials`, `md_payments`, `md_events`, `md_reports`, `md_profile`, `md_recos`, `md_reco_cfg`, `md_chats`, `md_msgs`, `md_usage`) créées par l'API, colonnes et index relus en statut « available ».
- **Fonctions** : `dmp-api` et `dmp-hooks` déployées, statut « ready » à chaque version ; une exécution réelle de `dmp-hooks` avec un jeton mal formé a bien répondu 404 immédiatement.
- **Assistant sur votre tablette** : réponse réelle « 8 ventes pour 37 110 FCFA » (7 derniers jours) avec limites et sources ; mode IA actif ; erreurs réelles du fournisseur observées et gérées proprement (404 modèle retiré, 503 forte demande) ; **appel réel à Gemini réussi** (« Rédigé par IA (Gemini) : chiffres calculés et vérifiés par MASTER DOGUI ») via l'API « interactions ».
- La licence de votre entreprise est valide (l'assistant n'aurait pas répondu sinon).

## 3. Ce qui n'a été vérifié que par simulation
- **1 434 tests automatiques** passent (dont **167 propres à MASTER**), sur une base en mémoire et un fournisseur d'IA simulé : droits, isolation entre entreprises et entre utilisateurs, idempotence, concurrence du quota, licence, purges, injection, contrôle de fondement, chiffres exacts sur données de test.
- **Scénario navigateur** (`npm run e2e:master`, 9 étapes sur 9) : les 5 onglets, exports vérifiés sur le contenu des fichiers, téléphone et tablette sans débordement, noms accessibles, hors ligne, expiration. Appwrite y est simulé.
- Le mode `generateContent` de Gemini (défaut) n'a **jamais** été appelé en réel.

## 4. Ce qui n'a PAS été vérifié en réel
- **Confirmation automatique de paiement** : aucune notification Selar réelle n'a jamais été reçue ; le paramétrage des champs n'a pas été calibré ; le relais Gmail n'est pas installé. L'activation manuelle par l'administrateur fonctionne.
- **Rapports d'ouverture et de clôture, profil, recommandations, exports** sur vos vraies données et votre appareil : testés par simulation, mais **vous ne les avez pas encore confirmés à l'écran**.
- **Jeu de référence contre le vrai modèle** : jamais lancé (panneau « IA de MASTER DOGUI : coûts et qualité » › « Lancer l'évaluation ») ; aucun taux de réussite réel n'est connu.
- **Coût réel de l'IA** : aucune mesure en production.
- **Limitation de débit** de la réception publique : à poser dans la console Appwrite.

## 5. État actuel de l'IA en production
Depuis le lot 2, l'IA exige `MASTER_AI_BILLING_CONFIRMED=true` : **tant que vous ne l'avez pas posée, l'assistant fonctionne en mode guidé** (réponses calculées, aucune donnée envoyée). Le modèle utilisé jusqu'ici était gratuit : voir ci-dessous.

## 6. Reste à votre charge avant toute vente (ordre conseillé)
1. **Activer la facturation** du projet Google de la clé Gemini (le contenu envoyé via l'offre gratuite peut être réutilisé par Google, ce que le cahier interdit), puis poser `MASTER_AI_BILLING_CONFIRMED=true` et redéployer.
2. **Lancer le jeu de référence** (administration) ; seuil : 100 % de chiffres exacts, au moins 90 % de sujets bien classés ; corriger si besoin. Fixer ensuite un plafond de coût et une alerte de budget chez Google.
3. **Confirmer à l'écran** rapports de clôture, profil, recommandations et exports sur votre tablette et votre téléphone.
4. **Paiements** : régénérer le jeton exposé, retirer-le de la redirection Selar, installer et calibrer le relais Gmail avec un vrai e-mail de vente, faire un achat test complet, poser la règle de limitation de débit.
5. **Juridique** : faire valider par un juriste les textes (conditions, information sur l'IA, politique de confidentialité) et la conformité à la loi n° 2013-450 ; compléter les clauses marquées [à valider].
6. **Pilote contrôlé** (§19, phase 10) avec quelques entreprises : suivre le panneau de coûts, les replis et les retours, avant la généralisation.

## 7. Décisions de la direction (points de l'annexe C) — défauts retenus
Règlement unique de 15 000 FCFA pour la première année puis 2 500 FCFA/mois, **sans délai de grâce**, rappels dans l'application seulement ; unicité de l'essai par e-mail du propriétaire **et** numéro de téléphone ; une licence par entreprise pour toutes les boutiques ; fournisseur d'IA : Gemini ; conversations privées (le propriétaire ne les consulte pas) ; périmètre de la version 1 ci-dessus. Les valeurs de listes du profil (secteurs, tailles, objectifs) sont celles proposées lors de l'audit.

## 8. Limites connues à garder en tête
- La **marge brute** est exacte lorsque toutes les lignes vendues ont un coût figé à la vente (correction du 13 novembre 2026 : ma version initiale affirmait à tort que ce coût n'était pas enregistré) ; sinon elle est « non calculée ». Les ventes antérieures à l'enregistrement du coût restent sans marge.
- Les « créances échues » n'existent pas faute de date d'échéance sur le crédit client : la règle s'appuie sur le plafond de crédit.
- Les purges se font au fil des consultations (pas de planificateur) ; le plafond personnel de questions peut être dépassé de 1 en cas de demandes simultanées ; le compteur global de jetons est approximatif sous forte concurrence.
- Un attaquant peut faire refuser environ une minute les envois légitimes de la réception de paiements (frein de rafale) ; le relais Gmail rejoue.
- Les rédactions de l'IA sont écartées dès qu'elles contiennent un chiffre inconnu ; le taux d'écart réel n'est pas encore mesuré.
