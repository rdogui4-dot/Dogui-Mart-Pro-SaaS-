# Refonte UI/UX DOGUI MART PRO — analyse du cahier directeur v1.0 et audit de l'existant (étape 0)

Aucun code modifié. Sources : le cahier directeur (PDF, 11 novembre 2026) et le dépôt (lectures et recherches, chiffres comptés). Le cahier lui-même demande cet audit d'abord (§12, §14) et rappelle qu'il « ne décrit pas les écrans réellement présents ».

## 1. Avis sur le cahier
**Points forts** : principes clairs (clarté, confiance, action avant décoration) ; règles métier non négociables explicites ; exigences honnêtes (« pas de faux KPI », « pas de hors ligne promis s'il n'est pas implémenté », « ne jamais annoncer enregistré avant persistance ») ; méthode par phases ; tests obligatoires nommés ; cohérent avec nos règles (Appwrite seul, rien d'inventé, droits côté serveur).
**Lacunes ou risques du cahier** :
1. **Aucun objectif chiffré** (temps de première vente, taux de complétion, budgets de performance) : §13 liste des indicateurs sans cibles ni outil de mesure.
2. **Aucune décision sur le thème** : il décrit une identité **claire** (fond gris très clair, cartes blanches, bleu nuit + bleu franc + or doux) alors que l'application et son logo sont **noir et or** (thème sombre) ; rien sur un mode sombre.
3. **Page publique et SEO** : l'application est une SPA hébergée sur GitHub Pages sous un sous-chemin ; une page d'accueil « indexable avec métadonnées et partage social » n'y est pas fiable sans page statique dédiée. Le cahier ne tranche pas (domaine, hébergement).
4. **Ampleur** : ~50 écrans de modules, 1 434 tests ; une refonte « de bout en bout » en une fois est risquée. Le cahier prévoit un séquencement, mais pas de garde-fou de non-régression.
5. **Vérification d'e-mail, notifications, aide, recherche globale** supposent des services que le cahier ne cadre pas (e-mail transactionnel, prestataires de notification : suspendus chez nous).
6. **Mesure d'usage** (§13) : pas de cadre de confidentialité ni de consentement.
7. Pas de **guide de ton et de vocabulaire** (français, FCFA, formats) ni de support de langues.

## 2. Audit de l'existant face au cahier (constats vérifiés)
| § cahier | Exigence | État constaté | Preuve |
| --- | --- | --- | --- |
| 2 | Navigation par profils et droits ; bouton jamais actif s'il ne peut pas fonctionner | **Partiel** : barre inférieure filtrée par droits (Accueil + 3 modules + « Plus ») ; pas de menu latéral, pas de fil d'Ariane, pas de recherche, pas de notifications, pas d'aide | `Layout.tsx` (59 lignes) |
| 2/10 | Desktop : analyses, multi-panneaux | **Absent** : une seule colonne étirée ; 7 usages de points de rupture (`sm/md/lg/xl`) dans tout le code ; aucun conteneur de largeur maximale | recherche `lg:` etc. |
| 3 | Design system (tokens, composants, états) | **Partiel** : variables CSS et 8 classes (`.btn`, `.card`, `.kpi`, `.chip`, `.tile`…) ; `ui.tsx` = 28 lignes (feuille, confirmation) ; **pas de toast, de tableau, de badge, de tiroir, de composant d'état** ; pas de documentation des tokens | `index.css`, `ui.tsx` |
| 3 | Palette bleu nuit / bleu franc / or / fond clair | **Écart** : charte noir + or, thème sombre unique (`color-scheme: dark`), aucun thème clair | `index.css` |
| 3/10 | Focus visible au clavier, contraste AA | **Défaillant** : **0** style `focus-visible` ; `text-white/40` utilisé **178** fois et `/30` 5 fois : contraste mesuré **3,8:1** et **2,7:1** sur fond de carte (seuil AA texte normal : 4,5:1) ; `text-[11px]` **128** fois ; `/50` = 5,3:1 (conforme) | recherches + calcul |
| 10 | Labels, rôles | **Bon point** : 760 `aria-label`, 215 `role=`, 11 `sr-only` ; tests navigateur MASTER : aucun élément sans nom, aucun débordement | e2e MASTER |
| 4 | Page publique (hero, bénéfices, offres, FAQ, SEO) | **Absente** : aucune route publique ; `/` redirige vers l'accueil connecté puis vers la connexion ; `index.html` n'a ni description ni balises de partage ; la page « pricing » du code est l'éditeur de tarifs d'articles, pas une page d'offres | `main.tsx`, `index.html` |
| 4 | Offres Business/Pro expliquées | **Données existantes** (formules, limites, liens Selar côté administration) réutilisables ; pas d'écran public | `subscription.tsx` |
| 5 | Inscription → vérification → entreprise → boutique → préférences → collaborateurs → checklist | **Partiel** : inscription, connexion, récupération de mot de passe, création d'entreprise, première boutique, équipe avec rôles (`team.tsx`) ; **pas de vérification d'e-mail observée, pas de checklist de démarrage persistante, pas de préférences (fuseau, devise, formats) à l'inscription** | `auth.tsx`, `tenant-setup.tsx` |
| 6 | Tableau de bord, « À traiter », raccourcis, états distincts | **Largement présent** : tableaux de bord Business et Pro, briefing MASTER, alertes ; pas de bloc « À traiter » unifié ; pas de fil d'Ariane | modules existants |
| 7 | Modules et règles métier non négociables | **Fonctions présentes et testées** par module (audits précédents) ; ligne de vente : nom, prix unitaire, remise et **coût unitaire** conservés (voir §3 ci-dessous), SKU non conservé, unité conditionnelle | `checkout.ts`, test réel |
| 8 | Paramètres et administration | **Partiel** : réglages, équipe, abonnement, paiements QR, journal d'activité ; pas de rubrique Données (export/conservation), Notifications, Intégrations, Aide/version | `settings.tsx` |
| 9 | États (chargement, vide, erreur, partiel, succès) | **Bon point** : 52 squelettes de chargement, 207 messages « Aucun… » ; **pas de composant d'erreur partagé, pas d'ErrorBoundary, pas de page 404, pas de toast** | recherches |
| 10 | Mobile prioritaire, tablette, desktop | Mobile : bon ; tablette : étiré ; **le manifeste PWA force l'orientation « portrait »**, ce qui bride tablettes et ordinateurs une fois installée | `manifest.webmanifest` |
| 10 | Hors ligne seulement si réellement implémenté | **Conforme** : file de ventes hors ligne, ventes rejetées signalées, synchronisation, tests existants | `offline.ts` |
| 11 | Appwrite seul, droits serveur, isolation, secrets serveur | **Conforme** (isolation et droits testés par module) | tests |
| 12 | Tests obligatoires (parcours, isolation, caisse, stock, Business/Pro) | **Couverture de logique forte (1 434 tests)** ; **parcours navigateur : seule la suite MASTER est versionnée** ; les scénarios navigateur des autres modules existent hors dépôt (non versionnés) | `e2e/` |
| 13 | Indicateurs instrumentés | **Absent** : aucune mesure d'usage, d'abandon ou de temps de première valeur | recherche |

## 3. Correction importante de ma part (relevée pendant cet audit)
J'ai écrit à plusieurs reprises que **« le coût au moment de la vente n'est pas enregistré »** (limite affichée par l'assistant MASTER, récapitulatif de validation, et motif de votre décision de laisser la marge exacte hors périmètre). **C'est inexact** : une vente enregistrée conserve le **coût unitaire** de chaque ligne (`unitCost`) dès que le coût de l'article est connu (vérifié par une vente de test réelle sur le routeur). Conséquences : (a) le texte « marge non calculée » de l'assistant est trompeur ; (b) la marge des rapports MASTER est estimée au coût actuel alors qu'une marge **exacte sur le coût figé** est possible, sans toucher au module Caisse ; (c) votre décision n° 8 (marge exacte hors périmètre) reposait sur une prémisse fausse. Les ventes anciennes ou les articles sans coût resteraient signalés « coût inconnu ». **Je propose de corriger cela en priorité** (hors refonte UI) : voir décision D0.

## 4. Plan proposé (adapté du §12 du cahier)
| Phase | Contenu | Critère de sortie |
| --- | --- | --- |
| 0 | Cet audit + inventaire écran par écran (états, droits, tests) | Inventaire validé |
| **0b (préalable)** | **Verser dans le dépôt les scénarios navigateur existants** (caisse, stock, achats, inventaire…) pour avoir un filet de non-régression avant de toucher à l'interface | Suite navigateur versionnée et verte |
| 1 | Architecture UX : personas, carte de navigation, wireframes des parcours clés (inscription → première vente ; caisse ; réception ; inventaire) | Parcours validés par vous |
| 2 | **Design system** : tokens (couleurs, typographie, espacements, rayons, ombres, points de rupture, tailles de contrôle), composants avec tous leurs états, thème(s), page de démonstration des composants, correction du focus et des contrastes | Composants testés ; 0 écart AA sur les composants |
| 3 | **Coque responsive** : barre latérale desktop, barre supérieure (boutique, recherche, notifications selon capacités, aide), barre inférieure mobile, fil d'Ariane, pages d'erreur et 404, orientation PWA libre | Cohérence mobile / tablette / desktop |
| 4 | **Site public** (page statique pré-rendue : accueil, fonctionnalités, offres, FAQ, SEO) + **inscription / onboarding** (vérification, entreprise, boutique, préférences, équipe, checklist persistante) | Parcours « nouveau compte → première vente » testé |
| 5 | Modules un par un, dans l'ordre de l'usage réel : Caisse, Catalogue, Stock, Achats, puis le reste | Tests métier, droits et états par module |
| 6 | Paramètres (données, notifications, intégrations, aide, version) | Actions réelles et journalisées |
| 7 | QA : régression, performance, accessibilité, livraison | Aucun blocage critique |
Chaque phase : fichiers modifiés, tests, résultats, risques, étape suivante ; aucune migration destructive sans validation.

## 5. Décisions à prendre avant la phase 1
- **D0** Corriger d'abord la marge MASTER (coût figé des lignes de vente) : oui / non ?
- **D1** Thème : **clair** comme le cahier, **sombre** comme aujourd'hui, ou **les deux avec bascule** (recommandé : tokens communs, clair par défaut pour la page publique, sombre conservé pour la caisse en boutique peu éclairée) ?
- **D2** Palette : adopter bleu nuit `#10243A` / bleu franc `#2563EB` comme structure et action, avec l'or réservé aux éléments « premium/intelligents » (cahier), en **gardant le logo actuel** ?
- **D3** Page publique : page **statique pré-rendue** à la racine du site (recommandé pour le SEO), l'application vivant sous un chemin dédié ; avez-vous un **nom de domaine** ou restons-nous sur l'adresse GitHub Pages ?
- **D4** Vérification d'e-mail à l'inscription : à confirmer techniquement (e-mails système d'Appwrite) ; acceptez-vous de l'exiger ?
- **D5** Mesure d'usage (§13) : journal d'événements **côté serveur**, sans donnée personnelle, par entreprise ; accepté ?
- **D6** Ordre des modules : Caisse en premier (usage quotidien), puis Catalogue, Stock, Achats ?
- **D7** Prérequis phase 0b (scénarios navigateur versionnés avant toute refonte) : d'accord ?
- **D8** Langue : français seul pour l'instant ? Devise et formats : FCFA uniquement ?
- **D9** Navigation cible : adopter les libellés du cahier (Vue d'ensemble, Ventes & Caisse, Catalogue, Stock, Achats & Fournisseurs, Clients/CRM, Finances, Comptabilité, Projets & Investissements, Rapports) avec « Plus » pour le reste sur mobile ?
