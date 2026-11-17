# Interfaces « 3D motion » — demande optimisée et plan (17/11/2026)

## 1. Demande d'origine
« Produis des interfaces 3D : visuel sur tableau de bord en premier, KPI 3D motion, menu 3D pliable et dépliable, caisse hyper intelligente HD, toutes les autres fonctionnalités en 3D motion, le réglage et ses fonctionnalités en 3D motion. »

## 2. Demande optimisée
Donner à toute l'application une **profondeur 3D cohérente et fonctionnelle** : chaque mouvement 3D explique quelque chose (ouvrir, plier, confirmer, hiérarchiser), reste rapide (≤ 300 ms), ne retarde jamais une action, et disparaît proprement sur appareil modeste ou en mouvement réduit. Ordre : tableau de bord d'abord, puis menu, caisse, modules, réglages.

| Zone | Ce qui est demandé (optimisé) | Fonction du mouvement |
| --- | --- | --- |
| Tableau de bord (en premier) | Scène d'accueil en profondeur : cartes KPI en relief (couches, ombre portée, légère inclinaison suivant le pointeur sur ordinateur), graphiques en relief (barres et anneaux avec volume), apparition en cascade 30–50 ms | Hiérarchiser les chiffres ; aucun chiffre animé qui simulerait une croissance (cahier §14.1) |
| KPI 3D motion | Retournement 3D d'une carte KPI pour montrer sa définition, sa période et sa source (recto : valeur, verso : explication) ; mise en évidence en relief quand la valeur réelle change | Expliquer le KPI (cahier §10 : définition accessible) |
| Menu 3D pliable / dépliable | Barre latérale qui se plie comme un volet sur charnière (rotation Y) en mode icônes, et se déplie ; sur téléphone, menu « Plus » qui se déplie en accordéon 3D | Montrer d'où vient et où va le menu |
| Caisse hyper intelligente HD | Rendu net (images d'articles haute définition, typographie nette, contrastes), tuiles articles avec enfoncement 3D à l'appui, panier qui glisse en profondeur, carte de confirmation qui se retourne au paiement validé ; les suggestions intelligentes existantes mises en avant en relief | Retour immédiat (≤ 160 ms) sans ralentir l'encaissement ; « intelligente » = fonctions réelles déjà présentes, rien d'inventé |
| Autres modules | Composants communs en profondeur : fiches et fenêtres qui entrent en perspective, changement d'onglet en léger basculement, tableaux à lignes en relief au survol | Cohérence sur tout le produit, un seul langage de mouvement |
| Réglages | Cartes de sections qui se déplient en 3D (accordéon), confirmation « Enregistré » en relief après réponse serveur | Orientation et confirmation réelle |

## 3. Garde-fous (non négociables)
- 3D en **CSS** (`perspective`, `transform`, `opacity`) : accélérée par le processeur graphique, sans bibliothèque lourde ; pas de WebGL dans l'espace de gestion (sauf décision contraire, §5).
- **Jamais de transform actif sur un parent d'élément fixe** (défaut déjà rencontré : fiches et boîtes de dialogue décalées) ; la 3D s'applique aux éléments eux-mêmes.
- Trois niveaux : **complet** (ordinateur, appareil récent), **allégé** (téléphone : profondeur sans inclinaison au pointeur), **plat** (mouvement réduit, économie de données, appareil modeste) ; préférence « Effets 3D » dans Mon profil, mémorisée sur l'appareil.
- Budgets mesurés à chaque lot : LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms (processeur ×4, réseau lent) ; caisse : retour visuel ≤ 160 ms.
- Aucun texte illisible (contraste AA conservé), aucun contenu masqué en attendant une animation, aucun faux chiffre.

## 4. Plan par lots (chacun audité, validé, testé, publié sur « publie »)
| Lot | Contenu | Vérification |
| --- | --- | --- |
| 3D-0 | Socle : jetons 3D (perspective, profondeurs, ombres, durées), utilitaires, préférence « Effets 3D », détection appareil modeste, repli plat | contrastes, mouvement réduit, scénario dédié |
| 3D-1 | Tableau de bord : scène en profondeur, KPI en relief, retournement définition/source, graphiques en relief | mesures, captures 390/820/1280, clair/sombre |
| 3D-2 | Menu pliable/dépliable (barre latérale charnière, « Plus » en accordéon) | clavier, focus, mémorisation |
| 3D-3 | Caisse HD : tuiles en relief, panier en profondeur, confirmation retournée, suggestions mises en avant | INP ≤ 160 ms, scénario caisse inchangé |
| 3D-4 | Modules : fiches/fenêtres en perspective, onglets, tableaux | suite complète |
| 3D-5 | Réglages en accordéon 3D, confirmations | scénario réglages |
| 3D-6 | Recette : performance, accessibilité, appareils | rapport chiffré |

## 5. Décisions à prendre
1. Intensité : profondeur sobre et professionnelle, ou effet 3D marqué.
2. Graphiques du tableau de bord : relief en CSS/SVG (léger), ou vraie 3D WebGL (plus spectaculaire, plus lourde : ~150 Ko et plus, batterie).
3. Préférence « Effets 3D » : activée par défaut partout, ou seulement sur ordinateur et appareils récents.

## 6. Décisions validées (17/11/2026)
- Intensité : **sobre et professionnelle**.
- Graphiques du tableau de bord : **vraie 3D WebGL**, chargée à la demande uniquement sur le tableau de bord, avec repli automatique sur les graphiques actuels (pas de WebGL, appareil modeste, mouvement réduit, préférence désactivée).
- Préférence « Effets 3D » : activée par défaut sur **ordinateur et appareils récents**, allégée sur téléphone, plate sur appareil modeste ou mouvement réduit ; modifiable dans Mon profil.

## 7. Réalisé — lots 3D-0 (socle) et 3D-1 (tableau de bord), 17/11/2026
- Socle : `src/lib/fx3d.ts` (niveau complet / allégé / plat selon appareil, préférence et mouvement réduit ; détection WebGL ; inclinaison au pointeur bornée à ±3–4°), styles `.d3-card`, `.d3-flip`, `.d3-in` dans `index.css` (3D appliquée aux cartes elles-mêmes, jamais à un parent d'élément fixe).
- Préférence « Effets 3D » dans Réglages › Mon profil (Automatique / Activés / Désactivés), mémorisée sur l'appareil, avec l'état réel affiché.
- Tableau de bord : cartes KPI en relief, apparition en cascade, inclinaison au pointeur (ordinateur), retournement vers la **définition officielle** fournie par le serveur (`notes`) ; graphique « 7 derniers jours » en **vraie 3D WebGL** (three.js, chargé seulement sur le tableau de bord quand la 3D est active ; rendu à la demande, croissance ≤ 700 ms, parallaxe au pointeur, pause hors écran ; valeurs lisibles en texte sous le graphique ; repli automatique sur le graphique plat).
- Scénario `e2e/fx3d.cjs` (7 vérifications) : three.js non chargé hors du tableau de bord, 3D complète sur ordinateur, retournement accessible, mouvement réduit plat, préférence, téléphone allégé, mesures (processeur ×4) CLS 0, INP 32–72 ms.

## 8. Réalisé — lot 3D-2 (menu pliable et dépliable), 17/11/2026
- Ordinateur : la barre latérale se replie (icônes) et se déplie avec une largeur animée et un contenu qui pivote sur une charnière gauche ; animation d'entrée seulement, aucun transform résiduel (vérifié).
- Téléphone : page « Plus » en accordéon par espace (icône, libellé, résumé, flèche), contenu qui se déplie depuis le haut ; `aria-expanded` et `aria-controls`, utilisable au clavier ; « Vendre » ouvert par défaut.
- Mouvement réduit ou 3D désactivée : pliage et dépliage sans animation.
- Scénario `fx3d.cjs` : 10 vérifications (dont 2 nouvelles pour le menu) ; j5 et shell inchangés et verts.

## 9. Réalisé — lot 3D-3 (caisse HD), 17/11/2026
- Tuiles d'articles en relief : enfoncement à l'appui (100 ms), soulèvement au survol sur ordinateur ; aucun transform permanent (catalogues longs).
- Panier : chaque nouvelle ligne arrive en profondeur (160 ms) ; le panneau de paiement entre en se retournant ; confirmation de vente et boutons de ticket qui se retournent à l'enregistrement.
- Suggestions intelligentes existantes (historique réel de la boutique) mises en avant dans un bandeau en relief ; elles restent affichées pendant leur rechargement.
- Vignettes nettes : chargement différé, décodage asynchrone, dimensions fixes.
- **Défaut corrigé** : le bandeau de suggestions disparaissait et réapparaissait à chaque ajout au panier, décalant la grille (CLS 0,077 sur téléphone) → 0,009.
- Scénarios : `fx3d.cjs` 12 vérifications (dont caisse HD, boîte de confirmation bien placée, aucun transform résiduel, INP 72–120 ms au processeur ×4) ; `caisse.cjs` 10/10 inchangé.

## 10. Réalisé — lot 3D-4 (autres modules), 17/11/2026
- Composants communs (s'applique à tous les modules) : fiches et fenêtres qui entrent en perspective selon leur taille — volet latéral depuis la droite en pivotant, fenêtre centrée (MASTER DOGUI) qui sort de la profondeur, fiche plein écran qui monte en basculant ; entrée seulement, aucun transform résiduel (vérifié).
- Onglets regroupés : l'onglet actif est en relief.
- Tableaux (composant commun et tableau des articles) : la ligne survolée se soulève (ordinateur).
- Mouvement réduit ou 3D désactivée : comportement plat inchangé.
- Scénarios : `fx3d.cjs` 13 vérifications ; master-modal, clients-promotions, compta-finance et stock inchangés et verts.

## 11. Réalisé — lot 3D-5 (réglages), 17/11/2026
- Au changement d'onglet, les cartes de la section ouverte se déplient depuis le haut, en cascade (40 ms).
- Confirmation « ✓ Enregistré » en relief (fond vert, ombre), affichée seulement après la réponse du serveur ; aucun transform résiduel.
- Bouton « Enregistrer » de la fiche boutique à largeur naturelle sur ordinateur.
- Scénarios : `fx3d.cjs` 14 vérifications ; `settings.cjs` inchangé et vert.

## 12. Recette 3D (lot 3D-6), 17/11/2026
Scénario `e2e/recette3d.cjs` (10 vérifications, toutes réussies) et `e2e/fx3d.cjs` (14 vérifications).

| Contrôle | Résultat |
| --- | --- |
| Appareil modeste (2 cœurs) | affichage plat automatique, graphique 2D, three.js jamais téléchargé |
| Sans WebGL | graphique 2D de repli, cartes en relief conservées |
| Libération du graphique WebGL en quittant le tableau de bord | aucun canvas restant |
| Mouvement réduit sur tout le parcours (tableau de bord, caisse, réglages, articles, page Plus) | aucune animation en cours |
| Clavier sur les cartes retournables | retournement et retour à Entrée, contour de focus visible |
| three.js hors du tableau de bord | jamais chargé (130 Ko compressés, à la demande) |

### Mesures sous contrainte (processeur ×4, réseau lent 150 ms / 1,6 Mbit/s)
| Écran | LCP | CLS | INP (interaction) |
| --- | --- | --- | --- |
| Tableau de bord 3D (ordinateur) | 576 ms | 0 | 48 ms (retournement d'une carte) |
| Tableau de bord (téléphone, 3D allégée) | 596 ms | 0,007 | 40 ms (retournement) |
| Caisse (téléphone) | 764 ms | 0,022 | 88 ms (ajout au panier) |
| Articles (ordinateur) | 596 ms | 0,049 | 168 ms (ouverture d'une fiche en perspective) |
| Réglages (téléphone) | 1 008 ms | 0 | 40 ms (changement d'onglet) |
Cibles : LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms — atteintes partout. Point le plus proche de la limite : ouverture d'une fiche article (168 ms sous processeur ×4). Limite : site servi en local ; à confirmer sur un téléphone d'entrée de gamme réel.

### Défauts trouvés et corrigés pendant le plan 3D
- Rechargement des suggestions de caisse qui décalait la grille (CLS 0,077 → 0,009).
- Bouton « Enregistrer » de la fiche boutique en pleine largeur.
