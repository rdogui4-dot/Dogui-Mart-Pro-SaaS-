# Cahier des charges « Refonte totale » (v1.0 du 15/11/2026) — audit d'alignement et plan

Aucun code modifié à ce stade. Sources : le nouveau cahier, le nouveau logo (archive `dogui-saas-logo.zip`) et le dépôt (lu et compté). Les phases 0 à 5 de la refonte précédente sont déjà publiées ; cet audit mesure l'écart restant.

## 1. Déjà conforme (aucune reprise nécessaire)
| § | Exigence | État |
| --- | --- | --- |
| 0.2, 19 | Appwrite seul, droits côté serveur, isolation boutique, idempotence, pas de faux succès | Conforme (tests serveur : 1 454 réussis) |
| 3.2 | Bleu nuit `#10243A`, bleu d'action `#2563EB`, fond `#F4F6F9`, vert/ambre/rouge fonctionnels | Conforme (`--main`, `--accent`, `--bg`) ; contrastes AA contrôlés |
| 3.3 | Thème clair complet, thème sombre conçu (pas inversé) | Conforme |
| 5.3, 5.4 | Barre latérale (≥ md), barre inférieure 5 entrées + « Plus », tableaux → cartes sur téléphone, volets | Conforme |
| 13.3, 14.1 | `transform`/`opacity`, `prefers-reduced-motion`, pas de scroll-jacking, pas de chiffres animés | Conforme |
| 11 | Règles métier (commande ≠ entrée de stock, reçu réimprimé sans effet, inventaire après approbation, écritures immuables) | Conforme et testé |
| 17 | Focus visible, cibles 44 px, noms accessibles, modales qui gèrent le focus | Conforme (vérifié par les scénarios navigateur) |

## 2. Écarts constatés
| § | Exigence | Constat | Preuve |
| --- | --- | --- | --- |
| Logo | Nouveau logo DOGUI MART PRO (« M » + point or) | L'application utilise encore l'ancien symbole (chariot) : `Logo.tsx`, `icon.svg`, `logo.svg/png`, 7 icônes PNG, manifeste, page de présentation | `public/`, `src/components/Logo.tsx` |
| Logo | Icône d'application | **Défaut dans l'archive** : `3-app_icon_512` n'est pas centrée (« M » décalé d'environ 50 px vers le haut et la gauche) ; pas d'icône « maskable » ni de petites tailles | rendu de `3-app_icon_512.png` |
| Logo | Couleurs | Le logo utilise `#0B1F3A` et l'or `#C9A227` ; le cahier `#10243A` et `#D6A84F` | fichiers SVG |
| 4 | Symbole cerveau MASTER DOGUI distinct du logo principal | Les fichiers existent (`docs/master-dogui/logo/*.svg`) mais **aucun n'est utilisé** dans l'application (bouton et fenêtre MASTER en texte seul) | recherche `brain/cerveau` : 0 |
| 3.2 | Cyan (accent technologique) et or (premium) | Absents des jetons | `index.css` |
| 3.3 | Bleu nuit pour les zones de navigation | Barre latérale blanche | `Layout.tsx` |
| 3.4 | Police moderne, corps ≥ 16 px, chiffres tabulaires, monospace pour les références | Police système ; corps majoritairement 14 px (`text-sm`) ; chiffres tabulaires seulement dans les tableaux | `index.css` |
| 13.2 | Jetons `press 160`, `panel 280`, `page 320`, `reveal 450`, `stagger 50` | 3 jetons seulement (`120/200/320`) | `index.css` l. 32 |
| 5.3 | Fil d'Ariane, barre latérale repliable, aide dans la barre supérieure | Absents | `Layout.tsx` |
| 5.3 | Recherche, notifications | Absentes. Une recherche **réelle** est possible (modules et pages autorisés) ; des notifications exigeraient un service d'envoi (suspendu) : à ne pas simuler | — |
| 15.2 | Réseau neuronal discret (accueil public, présentation MASTER), halo sur la carte MASTER | Absents (page publique sobre, sans effet) | `public/presentation/index.html` |
| 15.2 | Orbe MASTER lié à un état IA réel | MASTER DOGUI **n'a pas d'IA** aujourd'hui (licence, briefing et rapport calculés) : aucun état « traitement IA » réel n'existe, donc **pas d'orbe animé** (règle 0.2-6) | `master.tsx` l. 1 |
| 10 | Définition accessible de chaque KPI | Partielle (libellés et périodes, pas de définition) | tableaux de bord |
| 12 | Paramètres par intention | Prévu au lot suivant (Réglages et Administration) | — |
| 18, 21 | LCP, CLS, INP mesurés ; test mouvement réduit, JS désactivé, connexion lente | Jamais mesurés | — |

## 3. Nettoyage du site (avant tout le reste)
1. **Scénarios navigateur historiques** : 37 scénarios `e2e/scenarios/j*`, dont 3 plantent et environ 36 étapes « échecs connus » (libellés périmés depuis la refonte). Réparer ceux dont l'écran existe encore ; retirer ceux que les nouveaux scénarios par module couvrent déjà (liste fournie avant suppression).
2. **Anciens visuels** : symbole chariot (`icon.svg`, `logo.svg`, `logo.png`, icônes PNG) remplacés par le nouveau logo, pas laissés en double.
3. **Code et styles morts** : aucun fichier source orphelin (vérifié) ; recherche des classes CSS, composants et exports devenus inutiles après la refonte, suppression seulement s'ils ne sont référencés nulle part.
4. **Dépôt** : captures, sorties de test et archives hors suivi Git ; documents obsolètes signalés (pas supprimés sans accord).
Garde-fou : tests unitaires + suite navigateur complète avant et après ; aucune route, donnée ni fonction retirée.

## 4. Plan (un lot à la fois, chacun validé puis publié sur « publie »)
| Lot | Contenu | Validation |
| --- | --- | --- |
| N0 | Nettoyage (§3) | suite verte, liste de ce qui est retiré |
| N1 | Nouveau logo partout : composant, favicons, icônes PWA (dont maskable, centrée), manifeste, page publique, PDF et reçus ; symbole cerveau sur le bouton et la fenêtre MASTER | captures 390/820/1280, clair/sombre |
| N2 | Jetons : cyan et or (usage rare), police Inter auto-hébergée, corps 16 px, chiffres tabulaires, jetons de mouvement du cahier ; barre latérale bleu nuit | contrastes recalculés, captures |
| N3 | Coque : fil d'Ariane, barre latérale repliable (mémorisée), aide, recherche réelle des pages autorisées | scénario navigateur |
| N4 | Page publique : réseau neuronal différé (≤ 60 points, pause hors écran, repli statique et mouvement réduit), halo discret de la carte MASTER, présentation MASTER honnête (capacités réelles) | LCP/CLS mesurés, JS désactivé |
| N5 | Réglages et Administration par intention (lot déjà prévu) | scénario navigateur |
| N6 | Recette finale : parcours du §21, sécurité, mouvement réduit, connexion lente, LCP/CLS/INP | rapport chiffré |

Le lot précédent (Comptabilité, Finance, Investissements) est commité et attend toujours « publie ».

## 5. Décisions validées (17/11/2026)
- Icône d'application : **recentrée** (dessin inchangé), tailles PWA générées.
- Page publique : **réseau neuronal discret** (≤ 60 points, différé, pause hors écran, image fixe en repli et en mouvement réduit) ; rien dans l'espace de gestion.
- Espace de gestion : **barre latérale bleu nuit** et **texte courant 16 px** (tableaux compacts).
- Scénarios historiques : **réparer ou retirer** (liste des retraits montrée avant suppression).
