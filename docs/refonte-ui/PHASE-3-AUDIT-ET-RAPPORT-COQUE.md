# Refonte UI/UX — Phase 3 : coque responsive (audit, réalisation, vérification)

Date : 15/11/2026 · Décisions A1–A7 validées (phase 1).

## 1. Audit (état avant)
- Une seule navigation (barre du bas, 5 entrées dont 3 variables selon les droits) ; 21 modules à plat sur l'accueil et « Plus ».
- Aucune mise en page large : sur tablette/ordinateur, colonne mobile étirée.
- Aucune page 404, aucune page d'erreur d'affichage ; un accès refusé redirigeait silencieusement vers l'accueil.
- Droits (`can`) et règles de formule (`planAllows`) déjà centralisés : la navigation peut en dériver sans dupliquer de règle.

## 2. Réalisé
| Élément | Détail |
|---|---|
| `src/lib/nav.ts` | six espaces (Vendre, Stock, Acheter et dépenser, Piloter, Comptabilité et finance, Administration) et leurs modules ; mêmes droits et mêmes règles de formule qu'avant (`planVisible`, `itemsOf`) |
| Téléphone (< 768 px) | barre du bas à 5 entrées **stables** : Accueil · Vendre · Stock · Piloter · Plus ; un espace sans accès est grisé (non cliquable, avec explication) au lieu de disparaître ; les autres espaces sont dans « Plus » |
| Tablette / ordinateur (≥ 768 px) | barre latérale (espaces et modules autorisés, module actif surligné), barre supérieure (boutique, état hors ligne/synchronisation, compte, « Quitter »), contenu centré (largeur max 64 rem) |
| Pages d'espace | `/espace/<id>` : liste des modules de l'espace avec explication ; état vide clair si aucun accès |
| Accueil | six cartes d'espaces (avec la liste des modules) à la place de 21 tuiles ; alertes et chiffres du jour inchangés |
| « Plus » | modules groupés par espace, thème, déconnexion |
| 404 / erreur / accès refusé | pages dédiées (l'erreur d'affichage rassure : ventes hors ligne conservées ; bouton Recharger) |
| Compatibilité | **toutes les adresses existantes restent valides** ; aucune règle métier modifiée |

## 3. Reporté (phase 5, avec chaque module)
Fusion des entrées Pro dans leur module (ex. « Caisse Pro » dans Caisse), mise en page deux colonnes des modules (caisse : catalogue + ticket), tableaux sur grand écran.

## 4. Vérification
Types, 1 436 tests unitaires, scénario MASTER (9/9), suite navigateur comparée à la liste des échecs connus (résultat dans le message de livraison), captures téléphone 390 px, tablette 820 px, ordinateur 1280 px.
