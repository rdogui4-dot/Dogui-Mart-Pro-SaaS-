> **Correction du 13 novembre 2026** : les constats C2 et la décision 8 ci-dessous reposaient sur une affirmation inexacte (« le coût au moment de la vente n'est pas enregistré »). Les lignes de vente conservent le coût unitaire figé ; la marge exacte a été mise en place sans modifier le module Caisse (voir `ETAPE-2-RAPPORTS.md`).

# MASTER DOGUI — étape 6 : durcissement avant mise en vente — audit et plan (à valider)

Aucun code modifié. Constats vérifiés dans le dépôt (lectures et recherches), classés par priorité : **P1** avant toute vente, **P2** avant la montée en charge.

## 1. Ce qui est sain (vérifié)
- Aucun secret dans le dépôt (recherche de clés `AIza…`, `sk-…`, clés privées : seule une fausse clé de test) ; `.env.example` ne contient que des identifiants non secrets (valeur de `APPWRITE_API_KEY` vide).
- Clé Gemini uniquement dans les variables de la fonction (marquée « Secret » dans la console) ; jamais écrite dans la base, le journal, les messages d'erreur (testé).
- Licence, droits, isolation entre entreprises et entre utilisateurs testés sur chaque module MASTER (1 389 tests).
- Réception de paiement : jeton comparé à une empreinte, corps borné, rien d'activé sans correspondance exacte, file d'examen.

## 2. Constats

### Sécurité et abus
| # | Constat | Gravité |
| --- | --- | --- |
| A1 | **Aucune limitation de débit** nulle part (recherche `rate limit` : aucun résultat). La fonction publique `dmp-hooks` lit la base **avant** de vérifier le jeton : un inconnu peut faire consommer des lectures en boucle. | P1 |
| A2 | **Plafond de questions par entreprise seulement** (30/jour) : un seul utilisateur peut épuiser celui de tous, et rien ne limite les rafales. | P1 |
| A3 | **Données personnelles dans la question libre** : le texte tapé (téléphone, e-mail, nom) est transmis tel quel à Gemini et conservé 12 mois. Seuls balises et caractères de contrôle sont retirés (cahier §13.1 : minimisation). | P1 |
| A4 | **Charge utile brute des paiements conservée sans purge** (jusqu'à 6 000 caractères, peut contenir l'e-mail de l'acheteur) tant que la correspondance des champs est vide ; les événements décidés ne sont jamais purgés. | P1 |
| A5 | **Aucune purge** de `md_usage` (≈ 30 lignes/jour/entreprise), `md_events`, `audit_log` ; seules les conversations sont purgées (12 mois, à la consultation). | P2 |
| A6 | Erreurs avalées sans trace : accroches de clôture (`closeHooks`) et suivi des recommandations de rapports : en cas d'échec, rien n'est journalisé. | P1 |

### Coût et conformité de l'IA
| # | Constat | Gravité |
| --- | --- | --- |
| B1 | Les jetons sont enregistrés mais **aucun écran** ne les montre : impossible de surveiller le coût, les replis ou les erreurs par entreprise. | P1 |
| B2 | Plafond de jetons **par entreprise** seulement ; **aucun plafond global** de la plateforme. | P1 |
| B3 | Rien n'empêche techniquement d'utiliser le **modèle gratuit avec de vraies données** (Google peut alors réutiliser le contenu, ce que le cahier interdit). La mention n'existe que dans la documentation. | P1 |
| B4 | Le modèle et la version du prompt ne sont pas stockés avec chaque réponse (seulement dans le journal) : non reproductible après un changement de modèle. | P2 |
| B5 | Le premier appel réel est validé pour l'API « interactions » ; le mode `generateContent` n'a jamais été éprouvé en réel. | P2 |

### Qualité
| # | Constat | Gravité |
| --- | --- | --- |
| C1 | **Pas de jeu de référence mesuré avec le vrai modèle** (§18.1 : seuil « 100 % des chiffres exacts, 0 donnée inventée » à fixer avant production). Le contrôle de fondement protège, mais rien ne mesure le taux de rédactions écartées ou de questions mal classées. | P1 |
| C2 | La marge n'est jamais exacte : le **coût au moment de la vente n'est pas enregistré** (touche le module Caisse : décision séparée). | P2 |

### Produit et livraison
| # | Constat | Gravité |
| --- | --- | --- |
| D1 | **Aucun export** (PDF, Excel, CSV) des rapports, recommandations et réponses, alors que le cahier le prévoit ; la bibliothèque PDF existe déjà dans le projet. | P1 |
| D2 | **Aucun test navigateur** des écrans MASTER (5 onglets) : seuls les tests de logique existent ; la vérification de l'interface repose sur vos essais sur tablette. | P1 |
| D3 | Pas de **consigne d'exploitation** (variables, déploiement, retour arrière, support de l'activation de licence) ; le déploiement se fait par commandes manuelles. | P2 |
| D4 | Pas de contrôle d'accessibilité et de lisibilité sur téléphone des nouveaux écrans. | P2 |
| D5 | **Textes juridiques** (conditions de MASTER DOGUI, information sur l'envoi de questions à un prestataire d'IA, loi 2013-450) non rédigés ; revue par un juriste à faire. | P1 |

## 3. Plan proposé (trois lots, chacun testé et déployé séparément)
**Lot 1 — Sécurité et données** (A1, A2, A3, A4, A5, A6)
- `dmp-hooks` : rejet immédiat sans lecture de base si le jeton est absent ou de mauvaise forme ; mise en cache courte de la configuration ; règle de limitation de débit à poser dans les règles de pare-feu Appwrite (action de votre côté, je donne la marche).
- Plafond **par utilisateur** (en plus du plafond d'entreprise) et délai minimal entre deux questions.
- **Masquage** des numéros de téléphone et e-mails dans la question avant transmission **et** avant stockage.
- Purge : charge brute des paiements effacée à la décision ou après 30 jours ; événements décidés > 12 mois ; `md_usage` > 90 jours (au fil des consultations, par lots, sans planificateur).
- Journalisation des échecs silencieux (`master.hook.failed`).

**Lot 2 — IA : coût, conformité, qualité** (B1–B5, C1)
- Panneau administrateur : questions, jetons, replis et erreurs par jour et par entreprise ; seuil d'alerte.
- **Plafond global** de jetons par jour (variable) en plus du plafond par entreprise.
- **Garde « offre payante confirmée »** : sans la variable `MASTER_AI_BILLING_CONFIRMED=true`, l'IA reste éteinte même si tout le reste est configuré.
- Modèle, style d'API et version du prompt stockés avec chaque réponse.
- **Jeu de référence** (≥ 25 questions avec chiffres attendus sur données synthétiques, jamais de données réelles) et action réservée à l'administrateur qui le rejoue contre le vrai modèle et affiche : chiffres exacts, rédactions écartées, classements corrects ; seuil proposé : 100 % de chiffres exacts, 0 donnée inventée.

**Lot 3 — Produit et livraison** (D1–D5, C2 si décidé)
- Exports PDF / Excel / CSV des rapports, recommandations et réponses de l'assistant.
- Tests navigateur des 5 onglets MASTER (Licence, Rapports, Profil, Recommandations, Assistant) sur tablette et téléphone, avec captures.
- Consigne d'exploitation (variables, déploiement, retour arrière, support licence).
- Projet de textes : conditions d'utilisation et information « vos questions sont envoyées à un prestataire d'IA », **à faire valider par un juriste** (je ne livre pas d'avis juridique).
- Marge exacte : enregistrer le coût à la vente = **modification du module Caisse**, à décider séparément.

## 4. Décisions à valider
1. **Plafond par utilisateur** : 15 questions par jour et par utilisateur, 1 question toutes les 5 secondes (en plus des 30 par entreprise) ?
2. **Masquage** : téléphones et e-mails remplacés par « [numéro] » / « [e-mail] » avant envoi et avant stockage ?
3. **Durées de purge** : charge brute 30 jours, événements décidés 12 mois, `md_usage` 90 jours ?
4. **Plafond global** de jetons par jour : valeur initiale 1 000 000 (modifiable par variable) ?
5. **Garde « offre payante confirmée »** : d'accord pour que l'IA exige cette variable en plus (vous la posez après avoir activé la facturation Google) ? Votre IA actuelle s'éteindrait tant que vous ne l'avez pas posée.
6. **Jeu de référence** : 25 questions ; seuil de production 100 % de chiffres exacts ?
7. **Exports** : PDF + Excel + CSV, ou seulement PDF et CSV ?
8. **Marge exacte (coût à la vente)** : à étudier séparément avec le module Caisse, ou hors périmètre pour l'instant ?
9. **Ordre** : lot 1, puis 2, puis 3 ?
