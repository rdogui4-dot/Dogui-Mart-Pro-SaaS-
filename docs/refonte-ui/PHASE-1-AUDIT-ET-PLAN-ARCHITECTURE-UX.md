# Refonte UI/UX — Phase 1 : audit de l'architecture UX et plan

Date : 13/11/2026 · Statut : **à valider avant tout code d'interface**
Finalité fixée par le propriétaire : *une interface fluide et très professionnelle, sans effets « IA » ni décor gratuit.*

## 1. Principes directeurs (critères de recette de toute la refonte)
1. **Sobre** : pas de dégradé, pas de lueur, pas d'ombre portée décorative, pas d'emoji, pas de texte doré en dégradé, pas d'animation qui ne sert pas l'orientation (seuls : chargement, ouverture d'un panneau, retour d'action ; 150 ms max ; respect de `prefers-reduced-motion`).
2. **Une seule couleur d'accent** (bleu du cahier), + 3 couleurs d'état (succès, alerte, erreur) réservées au sens. L'or du logo reste dans le logo seulement.
3. **Lisible avant joli** : contraste ≥ 4,5:1 partout (WCAG AA), texte ≥ 14 px (13 px pour les libellés secondaires, jamais 10–11 px), cibles tactiles ≥ 44 px, focus clavier visible.
4. **Dense là où on travaille, aéré là où on décide** : listes et tableaux compacts sur ordinateur, grandes zones tactiles à la caisse.
5. **Prévisible** : mêmes composants, mêmes emplacements (titre, action principale en haut à droite, filtres sous le titre), mêmes états (vide, chargement, erreur, hors ligne, accès refusé).
6. **Honnête** : jamais de chiffre ou d'état inventé ; un module verrouillé dit pourquoi et ce qu'il faut pour le débloquer.
7. **Aucun changement de logique métier** : la refonte touche présentation et navigation, pas les règles, pas les données.

## 2. Audit de l'existant (constats mesurés sur le code)

### 2.1 Navigation et structure
| Constat | Mesure | Conséquence |
|---|---|---|
| Une seule navigation : barre du bas à 5 entrées (Accueil, 3 modules, Plus) | `Layout.tsx` | sur ordinateur/tablette, aucune navigation latérale ; l'écran large est inutilisé |
| **21 modules à plat** sur l'accueil et dans « Plus » (Caisse, Pilotage de caisse, Caisse Pro, Dépenses, Dépenses Pro, Ventes, Articles, Promotions, Tableau de bord, Pilotage Pro, Alertes articles, Bundles, Stock, Inventaire, Clients, Achats, Finance, Investissements, MASTER DOGUI, ICompta, Réglages) | `home.tsx` TILES | difficile de se repérer ; « Business » et « Pro » du même sujet sont séparés (Caisse / Caisse Pro, Dépenses / Dépenses Pro, Tableau de bord / Pilotage Pro) |
| Les 3 modules de la barre du bas dépendent des droits (les 3 premiers accessibles) | `Layout.tsx` | la barre change d'un utilisateur à l'autre : la mémoire musculaire ne s'installe pas |
| Pas de page 404, pas de page d'erreur d'application, pas de fil d'Ariane | `main.tsx` | un lien cassé ou une erreur de rendu mène à un écran vide |
| Pas de page publique : l'URL racine redirige vers `/accueil` puis vers la connexion | `main.tsx` | aucune vitrine, aucun parcours d'inscription expliqué |
| Onglets internes par module (23 fichiers) construits chacun à sa façon | grep `tab` | mêmes concepts, comportements différents |
| Libellé trompeur : « Pilotage de caisse » vs « Caisse » vs « Caisse Pro » | `home.tsx` | l'utilisateur ne sait pas où aller |

### 2.2 Système visuel
| Constat | Mesure |
|---|---|
| Thème sombre unique (noir + or) | `index.css` ; aucune version claire (inadapté aux boutiques très éclairées, aux impressions, aux écrans bas de gamme) |
| Décor à retirer | dégradés dans `index.css`, `subscription.tsx`, `auth.tsx` ; `.btn` en dégradé + ombre ; `.gold-text` ; cartes en `rounded-3xl` ; 54 usages d'`animate-*` (surtout `animate-pulse` de chargement : à garder, sobrement) |
| Couleurs en dur dans les composants | `text-white/…` ×985, `bg-white/…` ×64 → impossible de basculer en thème clair sans les remplacer par des jetons |
| Texte trop petit | `text-[10px]/[11px]` ×124 |
| Contraste insuffisant | `text-white/40` utilisé ×178 (≈ 3,8:1 < 4,5:1) |
| Aucun style de focus clavier | `focus-visible` : 0 occurrence |
| Pas de composants partagés pour tableau, boîte de dialogue, notification, état vide, formulaire | `ui.tsx` très réduit ; chaque écran réinvente |

### 2.3 Adaptation aux écrans
| Constat | Mesure |
|---|---|
| Aucune mise en page large | `md:` ×0, `lg:` ×0 (hors quelques largeurs maximales) |
| Manifeste verrouillé en portrait | `"orientation": "portrait"` → inutilisable en paysage sur tablette/ordinateur installé |
| Contenu centré sur une colonne mobile | tous les modules |

### 2.4 Points forts à conserver
- Hors ligne et file de synchronisation déjà visibles dans l'en-tête ;
- chargement différé des pages, bannière d'abonnement, verrous Pro explicites ;
- bonne couverture d'étiquettes accessibles (`aria-label` ×590) ;
- droits par rôle déjà centralisés (`can`, `Perm`) → la navigation peut en dériver sans les dupliquer.

## 3. Architecture cible

### 3.1 Six espaces au lieu de 21 tuiles
Chaque espace regroupe ses modules ; les versions Pro deviennent des **sections internes** de leur module (avec cadenas explicite si la formule ne les inclut pas), au lieu d'entrées séparées.

| Espace | Contenu (routes existantes conservées) |
|---|---|
| **Vendre** | Caisse (`/pos`), Ventes (`/ventes`), Session de caisse (`/caisse`, + Caisse Pro en section), Promotions (`/promotions`), Clients (`/clients`) |
| **Stock** | Stock (`/stock`), Articles (`/articles`), Bundles (`/bundles`), Inventaire (`/inventaire`), Alertes articles (`/tableau`) |
| **Acheter & dépenser** | Achats (`/achats`), Dépenses (`/depenses`, + Pro en section) |
| **Piloter** | Tableau de bord (`/activite`, + Pilotage Pro en section), MASTER DOGUI (rapports, recommandations, assistant) |
| **Comptabilité & finance** | Finance (`/finance`), ICompta (`/icompta`), Investissements (`/investissements`) |
| **Administration** | Réglages (commerce, boutiques, équipe, paiements, abonnement), MASTER DOGUI licence |

Règles : un espace n'apparaît que si l'utilisateur a au moins un droit dedans ; les anciennes URL continuent de fonctionner (alias/redirections), donc **aucun lien, favori ou e-mail existant ne casse**.

### 3.2 Coque d'application (shell) responsive
- **Téléphone (< 768 px)** : barre du bas fixe à **5 entrées stables** : Accueil · Vendre · Stock · Piloter · Plus (les entrées non autorisées sont grisées avec explication, pas supprimées, pour garder la même place). Le contenu des espaces s'ouvre en liste de sous-modules.
- **Tablette / ordinateur (≥ 768 px)** : **barre latérale** repliable (6 espaces + sous-modules), **barre supérieure** (boutique, état hors ligne/synchronisation, abonnement, compte, thème), contenu en largeur adaptée (listes en tableaux, volets de détail côte à côte).
- **Caisse** : mode plein écran sans barre latérale sur téléphone ; sur tablette/ordinateur, catalogue à gauche et ticket à droite.
- Pages **404**, **erreur d'application** (avec « Recharger » et « Revenir à l'accueil », sans perdre la file hors ligne), **accès refusé** (explique le rôle/la formule requis), **abonnement expiré** (consultation conservée, déjà existante, restylée).
- Manifeste : orientation libre ; raccourcis d'application mis à jour.

### 3.3 Page d'accueil de l'application
Remplace la grille de 21 tuiles par : (1) ce qui demande une action maintenant (ventes à vérifier, rappels, briefing MASTER, ruptures), (2) 3–4 chiffres du jour (selon droits), (3) accès rapides aux 4 actions les plus fréquentes, (4) bandeau abonnement discret. Pas de carrousel, pas de salutation décorative.

### 3.4 Composants de base (phase 2, listés ici pour cadrer)
Bouton (3 variantes), champ, sélecteur, case/interrupteur, onglets, carte, tableau (tri, ligne cliquable, version empilée sur téléphone), boîte de dialogue/volet, notification (toast), état vide, squelette de chargement, bandeau d'état, étiquette de statut, fil d'Ariane, barre d'actions de page. Tout en jetons de couleur (thème clair + sombre), jamais de couleur en dur.

## 4. Plan par phases (chaque phase = audit court → votre validation → code → tests → déploiement)
| Phase | Contenu | Risque | Vérification |
|---|---|---|---|
| **2. Système de design** | jetons (couleurs, typo, espacements, rayons, ombres minimales), thèmes clair/sombre + bascule, focus visible, contraste, composants de base ; remplacement progressif des `text-white/…` par jetons ; **aucune page déplacée** | moyen (touche tous les écrans) | contraste mesuré, captures avant/après, suite e2e vs liste des échecs connus |
| **3. Coque responsive** | barre latérale/supérieure, barre du bas stable, 404/erreur/accès refusé, manifeste, alias d'URL | moyen | e2e navigation par rôle, 390 / 768 / 1280 px, hors ligne |
| **4. Site public + démarrage** | page publique statique (à l'adresse GitHub Pages, sans nom de domaine), tarifs lus dans la configuration existante (pas de prix inventé), parcours d'inscription, liste de démarrage ; vérification d'e-mail seulement si faisable avec les e-mails système Appwrite | faible | lecture sans connexion, accessibilité, Lighthouse |
| **5. Modules, dans cet ordre** : Caisse → Ventes → Stock/Articles → Achats/Dépenses → Clients/Promotions → Piloter/MASTER → Compta/Finance/Investissements | un module par lot, tableau et formulaires sur les composants communs, version large | faible à moyen par lot | e2e du module (réparer les scénarios périmés au passage) |
| **6. Réglages & Administration** | regroupement, abonnement, équipe | faible | e2e rôles |
| **7. Recette finale** | parcours complets par rôle et par appareil, accessibilité, performance, texte français relu | — | rapport |

## 5. Ce que je ne ferai pas
- Aucune migration de données, aucun changement de droits ou de règles de calcul.
- Aucune dépendance graphique lourde (pas de bibliothèque d'animation, pas de polices externes chargées en ligne : polices système).
- Pas d'effets décoratifs « tendance » (verre dépoli, lueurs, dégradés, mascotte, confettis).
- Pas de suppression d'URL existante.

## 6. Décisions à valider
| # | Décision | Ma recommandation |
|---|---|---|
| A1 | Six espaces comme en 3.1 | oui |
| A2 | Pro = sections internes du module (plus d'entrées « Caisse Pro », « Dépenses Pro », « Pilotage Pro » séparées) | oui, avec cadenas explicite |
| A3 | Barre du bas à 5 entrées stables (Accueil, Vendre, Stock, Piloter, Plus) | oui |
| A4 | Thème par défaut : **clair** (boutiques éclairées, impression), sombre en option, mémorisé par appareil | clair par défaut |
| A5 | Accent bleu du cahier ; or réservé au logo | oui |
| A6 | Polices système (aucune police en ligne) | oui |
| A7 | Ordre des modules de la phase 5 : Caisse d'abord | oui |
| D3 | Pas de nom de domaine : site public à l'adresse GitHub Pages | acté |
