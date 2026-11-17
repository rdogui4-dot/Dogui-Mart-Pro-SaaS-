# Kit « Refonte 24 interfaces » — rapport d'audit et plan de refonte

Date : 17/11/2026. **Aucun code, aucune table, aucune fonction ni aucune permission modifiés.** Sources : archive `DOGUI_MART_PRO_KIT_REFONTE_24_INTERFACES` (4 parties reconstituées, 100 Mo), dépôt (branche `ccr-360cd683-uvf925`, commit 51a461f), projet Appwrite réel (interrogé en lecture).

## 1. Le kit
| Élément | Constat |
| --- | --- |
| Contenu | 24 PNG (1670-1672 × 941 px, bureau uniquement), 24 SVG, 24 fiches, README, manifeste, plan de séquencement, note SVG : tout est présent |
| SVG | Chaque SVG ne contient que le PNG encodé (aucun calque) ; tout doit être reconstruit en composants HTML/CSS (le kit le dit lui-même) |
| Fiches | Les 24 fiches sont **le même modèle** : seuls le titre et la ligne « Objectif » changent. Pas de spécification propre à chaque écran (champs, règles, états) : le détail vient de l'image et des règles déjà en place |
| Mobile, tablette | **Aucune référence** : les adaptations sont à concevoir (comme l'exige le kit) |
| **Images erronées** | **11 Stocks et mouvements** montre l'écran Articles (variante) ; **18 ICompta** est un doublon exact de 12 Inventaires (même empreinte de fichier) ; **22 Équipe et Permissions** montre Paramètres ; **23 Paramètres** montre Abonnement ; **24 Abonnement** est un doublon exact de 13 Achats. **Il manque donc les vraies références de Stocks, ICompta et Équipe et Permissions** |

### Contenus des maquettes à ne pas reproduire (règles 0.2 et kit)
| Contenu | Raison |
| --- | --- |
| Photos de personnes (accueil, inscription, connexion, MASTER), robot mascotte, nom « Emmanuel » | Banque d'images générée ; pas de photo réelle fournie. Remplacées par des illustrations du produit (captures réelles, symboles) |
| Logos Carrefour, CFAO, CDCI, Prosuma (« Ils nous font confiance ») | Faux témoignage de clients : interdit. Remplacé par des garanties vérifiables (Appwrite, hors ligne, isolation) |
| Marques de produits (Lux, Peak, Jif, Panzani…) | Données fictives ; les fiches affichent les photos réelles des articles du commerçant |
| Tous les chiffres, pourcentages, tendances « +12,5 % », score « 86/100 », « Gain estimé », « Économies réalisées » | Données fictives ; seuls les indicateurs calculés par le serveur avec période et source sont affichés ; un indicateur sans calcul réel n'est pas affiché |
| Formules « Starter 5 000 / Pro 15 000 / Business 25 000 », Business au-dessus de Pro, « 11/11 modules », « 10 utilisateurs », « -20 % annuel » | **Contredit l'offre réelle** (Starter < Business < Pro ; prix fixés par l'administration dans `platform_settings.plans`). Les cartes d'offre reprennent les offres et prix réels |
| Intégrations « Connecté » (Google Drive, Sheets, WhatsApp Business, Orange/MTN/Moov), sauvegardes « À jour », 2FA, notifications SMS/e-mail | Aucune de ces liaisons n'existe ; les prestataires externes sont suspendus. Affichées seulement si réelles, sinon « non disponible » ou absentes |
| Connexion Google / Microsoft / Apple | Aucun fournisseur OAuth n'est branché dans l'application (0 appel). À n'afficher qu'après activation réelle dans Appwrite |
| « Stock système » visible pendant le comptage (réf. 12) | Contredit le comptage aveugle en place (Silent Count) : le stock théorique reste masqué pendant le comptage |
| Boutons « Appliquer la recommandation », « Générer une commande automatique » | Aucune action automatique (décision MASTER étape 4). Remplacés par des liens vers l'action réelle, avec confirmation |

## 2. Audit du dépôt
| Domaine | État |
| --- | --- |
| Architecture | PWA React 19 + Vite 8, TanStack Router (routes déclarées dans `src/main.tsx`, chargement différé), TanStack Query, IndexedDB hors ligne (`idb`), service worker `dmp-shell-v4` |
| Styles | Tailwind v4 (`@theme inline`), jetons CSS clair et sombre, Inter auto-hébergée, texte 16 px, chiffres tabulaires, jetons de mouvement, contrastes AA contrôlés (34 paires par thème) |
| Couleurs | Bleu nuit, bleu `#2563EB`, cyan et or existent déjà en jetons ; le kit demande `#10243A`, `#F5F7FA`, `#14B8D4`, `#D6A84F`, texte `#172334`, secondaire `#64748B` : **valeurs à aligner** (écarts de teinte faibles) |
| 3D et mouvement | Lots 3D-0 à 3D-6 : cartes KPI retournables, graphique WebGL (three.js différé), menu repliable, niveaux `full/lite/flat`, mouvement réduit respecté |
| Navigation | Barre latérale bleu nuit repliable, **6 espaces regroupés** (Vendre, Stock, Acheter et dépenser, Piloter, Comptabilité et finance, Administration), fil d'Ariane, recherche Ctrl+K, aide, barre inférieure mobile. Le kit montre **une liste plate de 16 modules** + sélecteur de boutique + notifications + profil |
| Pages | 51 fichiers de routes (8 400 lignes), composants partagés (`ui.tsx`, `DataGrid`, `GroupedTabs`, `charts`, `Chart3D`, `PayPanel`, `PosPro`, `Shell`, `Layout`) |
| Dépendances | react, react-dom, @tanstack/react-router, @tanstack/react-query, appwrite 29, three 0.187, lucide-react, jspdf, qrcode, zod, idb, clsx (aucune bibliothèque d'interface tierce ; rien à ajouter a priori) |
| Tests | 104 fichiers vitest / 1 457 tests ; 43 scénarios navigateur / 396 vérifications, 0 échec, liste des échecs connus vide |
| Déploiement | Push → workflow « Publier » → GitHub Pages ; fonction déployée par curl (archive `dist/main.js`) |

### Correspondance des 24 interfaces avec l'existant
| N° | Interface | Existant | Nature du travail |
| --- | --- | --- | --- |
| 01 | Accueil public | `public/presentation/` (statique, réseau neuronal, halo MASTER) | Refaire la composition (hero, modules, garanties, offres réelles, pied de page) |
| 02-04 | Inscription, Connexion, Récupération | `auth.tsx` (une carte centrée, messages neutres, récupération par lien) | Nouvelle mise en page en deux colonnes ; **récupération : Appwrite envoie un lien, pas un code** → étapes « Demande / Nouveau mot de passe / Confirmation » adaptées au lien |
| 05 | Profil entreprise | Aucun écran ; le commerce = une équipe Appwrite ; seul `shops.legal` (120 caractères) existe | **Nouveau** : champs RCCM, forme juridique, secteur, pays, ville, logo, description → **colonnes à créer** (voir §4) |
| 06 | Création de boutique | `tenant-setup.tsx` (nom), `shop.create`, fiche boutique dans Réglages | Assistant en étapes ; type, devise, fuseau, horaires, logo **n'existent pas** en base |
| 07 | Finalisation onboarding | « Bien démarrer » sur l'accueil (étapes déduites des données réelles) | Écran dédié reprenant la même logique (aucune case cochée à la main) |
| 08 | Dashboard principal | `/activite` (KPI retournables, graphique 3D, alertes) + `/pilotage` Pro | Recomposer : bandeau KPI, évolution, encart MASTER, répartition, top 5, activité récente, raccourcis |
| 09 | Caisse POS | `/pos` + `PosPro`, `/caisse`, `/ventes` | Recomposer : catégories, grille, panier fixe, raccourcis F3-F6 (à vérifier un par un : client, remise, avoir, retour, attente existent-ils ?) |
| 10 | Articles et Catalogue | `/articles` (+ variantes, prix, lots, bundles) | Grille avec panneau de détail latéral, actions groupées réelles |
| 11 | Stocks et mouvements | `/stock`, `stock-business`, `stock-pro` | **Pas de référence valide** |
| 12 | Inventaires Silent Count | `/inventaire`, `inventaire-pro` | Recomposer ; garder le comptage aveugle |
| 13 | Achats et Fournisseurs | `/achats`, `fournisseurs`, réceptions | Recomposer |
| 14 | Dépenses et Charges | `/depenses`, `depenses-pro` | Recomposer |
| 15 | Promotions et Offres | `/promotions`, `promo-pro` | Recomposer |
| 16 | CRM | `/clients` (`crm`, `crm-pro`) | Recomposer ; communications WhatsApp/SMS suspendues |
| 17 | FinI | `/finance`, `finance-pro` | Recomposer |
| 18 | ICompta | `/icompta`, `icompta-pro` | **Pas de référence valide** |
| 19 | IProj-Invest | `/investissements`, `investissements-pro` | Recomposer |
| 20 | MASTER DOGUI | fenêtre MASTER (rapports, recommandations, assistant guidé, licence) | Page pleine ; **IA réelle inactive** (voir §3) |
| 21 | Rapports et Analyses | exports dans `/pilotage` et modules | **Nouveau regroupement** des rapports existants (aucun nouveau calcul inventé) |
| 22 | Équipe et Permissions | onglet Équipe des Réglages (`team.tsx`) + journal d'activité | **Pas de référence valide** ; page dédiée possible |
| 23 | Paramètres généraux | `/reglages` regroupé par intention (N5) | Recomposer (réf. utilisable : l'image n° 22) |
| 24 | Abonnement et Facturation | `subscription.tsx` (offres réelles, paiement Selar, QR) | Recomposer (réf. utilisable : l'image n° 23), sans les prix des maquettes |

## 3. Audit Appwrite (lecture seule)
| Service | Constat |
| --- | --- |
| Projet | Région Francfort ; base `dmp` |
| TablesDB | 100 tables déclarées dans `scripts/schema.mjs` (source de vérité versionnée, appliquée par `npm run appwrite:setup`). **La clé disponible dans cette session n'a pas le droit `databases.read`** : impossible de relire le schéma réel en direct ; il faudra une clé avec ce droit (via l'environnement, jamais dans la conversation) avant toute création de colonne |
| Isolation | Toutes les tables métier portent `tenantId` (+ `shopId` où pertinent) ; le kit parle de `businessId`/`storeId` : **ce sont les mêmes notions, déjà en place** ; aucun renommage (il casserait les données) |
| Functions | `dmp-api` (routeur, Node 22, déploiement actif `6afc5b67…`) et `dmp-hooks` (Node 22) ; aucune planification, aucun événement |
| Variables de `dmp-api` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_API_STYLE`, `GEMINI_API_VERSION`, `MASTER_AI_ENABLED`, `MASTER_AI_DAILY_TOKENS`, `PLATFORM_ADMINS`. **`MASTER_AI_BILLING_CONFIRMED` est absente** → l'adaptateur IA reste désactivé (double garde) : **aucune IA générative n'est active aujourd'hui**. L'orbe MASTER affichera donc l'état réel « assistant guidé » et ne s'animera qu'en traitement réel |
| Storage | Aucun compartiment listé avec cette clé (ou droit manquant) : à vérifier avant d'ajouter des logos d'entreprise/boutique |
| Auth | E-mail + mot de passe, vérification d'e-mail, récupération par lien ; équipes = commerces ; **OAuth non branché** côté application |
| Abonnements | Offres `starter`, `business`, `pro` (Pro = la plus complète) ; prix et liens de paiement en base (`platform_settings`) ; paiement Selar ; rétrogradation sans suppression (testée) |

## 4. Synthèse
**Fonctionne et se conserve** : tout le serveur (règles métier, isolation, idempotence, droits), les 1 457 tests, le hors ligne, le comptage aveugle, la caisse transactionnelle, les offres réelles, le design system (jetons, contrastes), la 3D maîtrisée et ses replis.

**À améliorer (refonte visuelle sur l'existant)** : 08-10, 12-17, 19, 21, 23, 24 : nouvelle composition fidèle aux maquettes, même logique et mêmes actions serveur.

**À construire** : écrans 01-07 (parcours public et onboarding en assistant), page Rapports et Analyses (regroupement), page MASTER pleine, barre supérieure (sélecteur de boutique, centre d'alertes, profil), navigation plate.

**Données manquantes en base (création à valider, non destructive)** : profil entreprise (RCCM, forme juridique, secteur, pays, ville, adresse, téléphone, description, logo) ; boutique (type, devise, fuseau, horaires, logo). Le reste des maquettes se nourrit des tables existantes.

**Risques** : régression de parcours testés (une suite navigateur de 396 vérifications sert de filet : chaque lot la relance) ; poids de page (photos et illustrations : formats légers, chargement différé) ; tentation des chiffres des maquettes (règle : jamais) ; changement de navigation (habitudes des utilisateurs actuels, liens profonds à garder) ; 3 écrans sans référence.

**Dépendances** : design system → barre latérale et barre supérieure → toutes les pages de gestion ; profil entreprise et boutique (schéma) → écrans 05, 06, 23 ; parcours 02-07 → accueil connecté ; dashboard 08 → rapports 21 et MASTER 20.

## 5. Plan d'exécution proposé (un lot à la fois, validé puis publié sur « publie »)
| Lot | Contenu | Validation |
| --- | --- | --- |
| K0 | Design system aligné sur le kit : couleurs exactes, cartes KPI, badges de statut, tableaux, filtres, pagination, onglets, panneaux latéraux, états (chargement, vide, erreur, partiel, refusé, désactivé) dans une page de référence interne | contrastes, captures clair/sombre |
| K1 | Coque : barre latérale plate (16 modules, sous-pages en onglets), sélecteur de boutique, barre supérieure (recherche, centre d'alertes réelles, aide, profil), mobile (barre inférieure + menu) | e2e coque, liens existants conservés |
| K2 | 08 Dashboard principal | e2e + captures comparatives 1280/820/390 |
| K3 | 09 Caisse POS (tests métier renforcés) | e2e caisse, j1, j18 |
| K4 | 10 Articles, 11 Stocks, 12 Inventaires | e2e stock, inventaire |
| K5 | 13 Achats, 14 Dépenses | e2e achats, dépenses |
| K6 | 15 Promotions, 16 CRM | e2e |
| K7 | 17 FinI, 18 ICompta, 19 IProj-Invest | e2e + tests compta |
| K8 | 20 MASTER (page, orbe sur état réel), 21 Rapports et Analyses | e2e |
| K9 | 22 Équipe, 23 Paramètres, 24 Abonnement | e2e réglages, abonnement |
| K10 | Schéma profil entreprise / boutique (après accord et clé `databases.read`), puis 01-07 parcours public et onboarding | e2e parcours, recette |
| K11 | Recette transversale : responsive, accessibilité, sécurité, performance, non-régression | rapport chiffré |

Ordre proposé : coque et pages de gestion d'abord (le kit les illustre le mieux et elles touchent tous les utilisateurs actuels), parcours public en fin car il dépend de colonnes à créer. Chaque lot : captures comparatives avec la référence, écarts, tests, fichiers modifiés.

## 6. Informations manquantes avant toute modification
1. **Références valides** pour 11 Stocks, 18 ICompta, 22 Équipe et Permissions (images erronées dans le kit).
2. **Logo** : les maquettes utilisent le **cerveau or comme logo principal** de DOGUI MART PRO ; le logo officiel adopté en N1 est le « M » + point or, le cerveau étant réservé à MASTER DOGUI (le brief le confirme : « le cerveau est le symbole central de MASTER DOGUI »).
3. **Navigation** : passer à la liste plate des maquettes ou garder les 6 espaces.
4. **Photos** : pas de photos réelles fournies pour le parcours public et l'onboarding.
5. **Schéma** : accord pour ajouter les colonnes profil entreprise et boutique (§4), et une clé serveur avec `databases.read` pour relire le schéma réel avant.
6. **OAuth Google/Microsoft/Apple** : à activer dans la console Appwrite (identifiants des fournisseurs) ou à retirer des écrans.
7. **IA MASTER** : rester en assistant guidé (état réel actuel) ou activer Gemini (confirmation de l'offre payante du fournisseur : variable `MASTER_AI_BILLING_CONFIRMED`).

## 7. Décisions validées (17/11/2026)
- Logo : **le « M » + point or reste le logo principal** ; le cerveau reste le symbole de MASTER DOGUI.
- Navigation : **liste plate du kit** (16 modules) ; sous-pages en onglets ; anciens liens conservés.
- Écrans sans référence valide (11, 18, 22) : **conçus dans le style du kit**, captures montrées avant publication.
- Ordre : **K0 design system puis K1 coque**, puis 08 à 24 ; parcours public et onboarding (01-07) en fin, après accord sur les colonnes.
