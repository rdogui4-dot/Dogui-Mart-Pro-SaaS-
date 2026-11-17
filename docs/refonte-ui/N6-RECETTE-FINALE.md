# N6 — Recette finale de la refonte (cahier « Refonte totale » v1.0, 15/11/2026)

Date : 17/11/2026. Méthode : tests automatisés réels (serveur en mémoire identique à la fonction `dmp-api`, navigateur Chromium piloté), aucun chiffre estimé. Les limites sont écrites telles quelles.

## 1. Résultats chiffrés
| Contrôle | Résultat |
| --- | --- |
| Tests serveur et domaine (vitest) | 104 fichiers, 1 457 tests, 0 échec |
| Suite navigateur complète | 41 scénarios (29 historiques réparés + 12 de la refonte, dont `recette.cjs`) ; dernière exécution complète avant N6 : 40 scénarios, 362 vérifications, 0 échec ; liste des échecs connus vide |
| Contrastes (WCAG AA) | 34 paires par thème (clair et sombre), toutes conformes (`scripts/contrast.mjs`) |
| Mesures sous contrainte (processeur ×4, réseau lent 150 ms / 1,6 Mbit/s, téléphone 390 px) | voir §3 |

## 2. Parcours obligatoires (§21)
| Parcours | Couverture | Statut |
| --- | --- | --- |
| Visiteur → inscription → vérification → entreprise → boutique → premier article | `recette.cjs` (connexion, messages neutres, récupération, champs d'inscription), `master.cjs`/`shell.cjs` (accueil « Bien démarrer »), tests serveur `tenant.init`, `shop.create`, `article.save` | Partiel : la création réelle du compte Appwrite et l'envoi effectif de l'e-mail de vérification ne sont pas testables hors ligne (à valider sur l'environnement réel) |
| Connexion → tableau de bord → caisse → vente confirmée → reçu | `recette.cjs`, `caisse.cjs`, j1, j18 (tickets 58/80 mm) | Couvert |
| Achat → commande → réception acceptée → stock mis à jour | j22, j30, `achats-depenses.cjs` (commande sans entrée de stock, réception partielle) | Couvert |
| Inventaire → comptage → validation → ajustement approuvé | j23, j24 (comptage aveugle, second comptage indépendant) | Couvert |
| Invitation → rôle → contrôle d'accès | j11, tests serveur d'accès (`access.test.ts` et modules) | Couvert |
| Paramètres → changement → confirmation serveur | `settings.cjs` (succès affiché seulement après réponse, en vert) | Couvert |
| Business → Pro → Business, données conservées | 15 fichiers de tests (serveur et navigateur) sur la rétrogradation | Couvert |

### Sécurité (§21)
| Contrôle | Couverture |
| --- | --- |
| Accès à une autre entreprise / boutique | 25 fichiers de tests serveur (refus « Vous n'appartenez pas à ce commerce », boutique non attribuée) ; journal d'activité limité à la boutique active (test dédié) |
| Action sans rôle approprié | tests de droits par module (vendeur refusé, gérant limité) |
| Double soumission, réutilisation d'une action sensible | 48 fichiers de tests sur l'idempotence (identifiants de requête, ventes, paiements) |
| Route privée en accès direct | `recette.cjs` : visiteur non connecté renvoyé à la connexion |
| Fichiers et exports d'un autre commerce | tests serveur d'isolation (pièces, images, exports) |

### Mouvement et accessibilité (§17, §21)
| Contrôle | Résultat |
| --- | --- |
| Mouvement réduit | aucune animation en cours dans l'espace connecté (accueil, caisse, finance) ; page publique : image fixe, pas de canvas |
| JavaScript désactivé (page publique) | tout le contenu visible (`public.cjs`) |
| Navigation clavier | recherche, aide et MASTER atteints au clavier, contour de focus visible ; Ctrl + K puis Entrée ; Échap ferme toutes les fenêtres |
| Noms accessibles et débordement | contrôlés à 390, 820 et 1280 px dans 8 scénarios |
| Animation hors écran / onglet inactif | réseau neuronal suspendu (aucune image dessinée hors écran), bouton pause effectif |

## 3. Performance mesurée (processeur ×4, réseau lent, 390 px)
| Page | LCP | CLS | INP (interaction testée) |
| --- | --- | --- | --- |
| Page publique | 156 ms | 0 | 24 ms (lien « Voir les offres ») |
| Accueil connecté | 516 ms | 0,018 | 64 ms (ouverture de la recherche) |
| Caisse | 588 ms | 0,028 | 80 ms (ajout au panier) |
Cibles du cahier : LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms — atteintes. Limite : site servi en local (pas de latence réelle du serveur Appwrite ni du CDN) ; à reconfirmer sur un téléphone d'entrée de gamme réel.

## 4. Défauts trouvés et corrigés pendant la recette et les lots N0-N6
- Fiches plein écran sans fermeture par Échap ni retour du focus (N3).
- Champs annonçant « aucun » ou un exemple au lieu de leur libellé (Promotions Pro, campagne) (N0).
- Inscription : l'aide « 8 caractères minimum » faisait partie du nom du champ mot de passe ; désormais description liée (N6).
- Messages de succès affichés en orange dans les Réglages (N5).
- **Décalage de mise en page à l'accueil (CLS 0,48)** au premier chargement sur un nouvel appareil : la carte « Bien démarrer » apparaissait en haut après le chargement et repoussait tout le contenu de 492 px. Place désormais réservée pendant le chargement, état « terminé » mémorisé sur l'appareil : CLS 0,009 au premier chargement, 0 ensuite (N6).

## 5. Annexe A — liste de validation
| Point | Statut |
| --- | --- |
| Audit dépôt et Appwrite | Fait (`CAHIER-V2-AUDIT-ET-PLAN.md`) |
| Inscription et onboarding testés de bout en bout | Partiel (voir §2 : compte Appwrite réel et e-mail réel non testables ici) |
| Navigation cohérente desktop / tablette / mobile | Fait |
| États vide, chargement, erreur, succès par module | Fait dans les modules refondus ; vérifiés par les scénarios |
| Paramètres organisés par intention | Fait (N5) |
| Design system documenté, contrastes contrôlés | Fait |
| Logos cohérents, cerveau MASTER non déformé | Fait (N1) |
| Thèmes clair et sombre testés | Fait (captures et contrastes) |
| Une animation = une fonction ; un effet signature par page ; ≤ 3 effets futuristes | Fait (réseau neuronal public, halo MASTER ; pas d'orbe : MASTER n'expose pas d'état de traitement IA en continu) |
| Hero affiché sans attendre l'effet | Fait |
| Animations hors écran suspendues, replis mobile et mouvement réduit | Fait |
| `prefers-reduced-motion`, focus visible, lecteurs d'écran | Fait |
| Test mobile d'entrée de gamme, connexion lente, LCP/CLS/INP | Fait en émulation (processeur ×4, réseau lent) ; appareil réel à confirmer |
| Isolation entreprise/boutique, permissions serveur, idempotence | Fait (tests serveur) |
| Aucun secret côté client | Fait (clés injectées côté serveur ; aucun secret dans le dépôt) |
| Business/Pro sans duplication ni suppression | Fait |

## 6. Reste à faire hors de ce dépôt
- Valider l'envoi réel de l'e-mail de vérification et un vrai paiement Selar sur `/merci`.
- Confirmer les mesures sur un téléphone d'entrée de gamme réel et sur le réseau mobile.
- Faire valider les règles comptables et fiscales par un professionnel en Côte d'Ivoire (§11.11).
