# Refonte UI/UX — Phase 5, lot 5 : Comptabilité, Finance et Investissements (audit et plan)

Date : 17/11/2026 · Statut : **à valider avant code**. Aucune règle comptable (écritures chaînées, immuabilité, lettrage, amortissements, clôtures, approbations, états financiers), financière (soldes, rapprochement, prévisions, échéancier) ou d'investissement (VAN, TRI, scénarios, placements) n'est modifiée ; seule la présentation change. Les textes d'avertissement (« à faire confirmer par un expert-comptable », « aucun solde n'est inventé », « indicatif ») sont conservés intégralement.

## 1. Périmètre
Finance (`finance.tsx` 208 + `finance-pro.tsx` 129), ICompta (`icompta.tsx` 185 + `icompta-pro.tsx` 140 + `compta.tsx` 221 + `icompta-kit.tsx`), Investissements (`investissements.tsx` 151 + `investissements-pro.tsx` 115). Environ 1 170 lignes d'interface, 3 entrées de menu.

## 2. Audit (captures 390 px et 1280 px)
| # | Constat | Effet |
|---|---|---|
| 1 | **ICompta : jusqu'à 16 onglets** à plat (Facturation, Synthèse, Écritures, Propositions, Livres, Tiers, Périodes, Plan de comptes, Lettrage, Immobilisations, Analytique, États, Clôture guidée, Réglages Pro, Exports comptables, Rapports d'activité) sur une rangée à défilement ; le tiers est caché sur ordinateur | impossible de s'y repérer ; un comptable cherche « Grand livre » ou « Balance » sans les voir |
| 2 | **Finance : 12 onglets** à plat (Trésorerie, Comptes, Flux, Virements, Rapprochement, Échéances, Budgets, Prévisions, Échéancier, Analyses, Règles, Rapports) | idem |
| 3 | **Investissements : 6 onglets** dont « Réglages Pro » et « Profil de risque » au même niveau que Synthèse et Projets | moindre, mais mêmes constats |
| 4 | **Aucune vue en tableau** : écritures, grand livre, balance, flux, comptes, virements, projets et placements sont des cartes empilées | la comptabilité se lit en **colonnes alignées** (date, pièce, libellé, débit, crédit, solde) : c'est le défaut majeur |
| 5 | Indicateurs en 2 colonnes fixes (6 cartes Finance) ; boutons d'action pleine largeur (« Créer un compte », « Facture libre », « Depuis une vente ») | gaspillage d'espace sur grand écran |
| 6 | Avertissements longs en tête d'écran (« Facturation, comptabilité et rapports… », « Boutique active : comptes et soldes… ») | indispensables mais bruyants : à garder visibles en une ligne et dépliables |
| 7 | Une **carte vide** en bas de la Trésorerie (bloc sans contenu quand aucun compte n'existe) | défaut visuel mineur |
| 8 | Montants non alignés à droite, sans chiffres tabulaires dans les listes | lecture et addition à l'œil difficiles |
| 9 | Aucun scénario navigateur fiable (j3 compta, j10 compta, j17, plusieurs périmés) | pas de filet de non-régression |

## 3. Conception
### 3.1 Onglets regroupés (composant `GroupedTabs` existant)
- **ICompta** : **Saisie** (Facturation, Écritures, Propositions) · **Consultation** (Synthèse, Livres, Tiers, États) · **Organisation** (Périodes, Plan de comptes, Clôture guidée) · **Pro** (Lettrage, Immobilisations, Analytique, Réglages Pro) · **Sorties** (Exports comptables, Rapports d'activité). Les onglets restent soumis aux mêmes droits qu'aujourd'hui.
- **Finance** : **Suivi** (Trésorerie, Analyses, Rapports) · **Mouvements** (Flux, Virements, Rapprochement) · **Engagements** (Échéances, Échéancier, Budgets, Prévisions) · **Organisation** (Comptes, Règles).
- **Investissements** : **Suivi** (Synthèse) · **Portefeuille** (Projets, Placements, Portefeuille) · **Réglages** (Profil de risque, Réglages Pro).

### 3.2 Tableaux comptables (≥ 1024 px)
- **Écritures** (date, pièce, libellé, compte, débit, crédit, statut), **Livres** (grand livre, balance : compte, intitulé, débit, crédit, solde), **Tiers**, **Factures** (n°, client, date, échéance, total, reste), **Flux**, **Comptes**, **Virements**, **Projets**, **Placements** : `DataGrid` avec montants à droite en chiffres tabulaires, totaux en pied de tableau quand l'écran en a déjà ; ligne cliquable → fiche existante en volet latéral ; cartes conservées en dessous de 1024 px.
- Impression/export : inchangés ; mise en page d'impression sobre (sans menu ni barre latérale) via feuille de style d'impression pour les écrans de livres et d'états.

### 3.3 Écrans d'accueil de module
Indicateurs en 3 à 4 colonnes ; boutons d'action à largeur naturelle dans l'en-tête ; avertissements réduits à une ligne avec « Lire la suite » (texte intégral conservé) ; suppression de la carte vide.

### 3.4 Accessibilité et mouvement
En-têtes de colonnes `scope`, `aria-sort` seulement quand un tri existe, montants avec unité, débit/crédit jamais indiqués par la seule couleur, focus visible, mouvement sobre existant.

## 4. Ce qui ne change pas
Chaînage et immuabilité des écritures, propositions et approbations, lettrage, immobilisations et amortissements, analytique, états financiers, clôtures, plan de comptes, rapprochement bancaire, prévisions et scénarios, échéanciers, VAN/TRI, profil de risque, droits, formules, hors ligne, données et exports.

## 5. Plan de réalisation
1. Onglets regroupés pour les trois modules (sans toucher aux contenus d'onglets).
2. Tableaux ≥ 1024 px, volets, montants alignés ; feuille de style d'impression des livres/états.
3. En-têtes, indicateurs, boutons, avertissements dépliables, carte vide.
4. **Nouveau scénario `compta-finance.cjs`** : 390 / 820 / 1280 px sans débordement ni élément sans nom ; onglets regroupés ; création d'un compte financier, d'une facture libre et d'une écriture par l'interface ; tableau du grand livre et de la balance ; droits (rôle sans accès comptable : refus) ; reprise des scénarios périmés de compta si possible.
5. Vérifications : types, tests unitaires (les calculs comptables ont déjà leurs tests, non modifiés), suite navigateur comparée à la liste de référence, captures avant/après, **publication après votre relecture**.

## 6. Risques
| Risque | Parade |
|---|---|
| Altération d'un montant ou d'un signe à l'affichage | aucun calcul déplacé ; les colonnes reprennent les valeurs déjà affichées ; scénario comparant le total du tableau à celui de l'écran d'origine |
| Perte d'un onglet (16 pour ICompta) dans le regroupement | test automatique : chaque onglet de l'ancienne liste est présent, avec les mêmes droits |
| Impression de livres cassée | test d'impression (aperçu PDF) des écrans Livres/États |

## 7. Décisions à valider
| # | Décision | Recommandation |
|---|---|---|
| F1 | Onglets des trois modules regroupés comme en 3.1 | oui |
| F2 | Tableaux comptables et financiers ≥ 1024 px avec volet, montants alignés, feuille de style d'impression | oui |
| F3 | Avertissements réduits à une ligne dépliable (texte conservé) | oui |
| F4 | Boutons d'action à largeur naturelle en en-tête, indicateurs sur 3 à 4 colonnes | oui |

## Réalisé (lot 5)

- Onglets regroupés : Finance (Suivi, Mouvements, Engagements, Organisation), ICompta (Saisie, Consultation, Organisation, Pro, Sorties), Investissements (Suivi, Portefeuille, Réglages). Aucun onglet retiré ; colonne des libellés élargie (« Consultation » n'est plus tronqué).
- Avertissements en `Disclaimer` : une ligne et « Lire la suite » sur téléphone, texte complet à partir de la tablette.
- Tableaux à partir de 1024 px (cartes en dessous) : comptes, flux, virements (actions dans la ligne), factures clients (fiche en volet), écritures, journal, balance, grand livre, tiers, projets et placements.
- Trésorerie : indicateurs sur 3 colonnes à partir de la tablette ; la carte vide des comptes n'est plus affichée sans compte actif ; boutons d'action à largeur naturelle, à droite.
- Fiches en volet (écriture, période, projet, placement, facture) ; nouvelle écriture en grande fenêtre.
- Impression : navigation, onglets et boutons masqués ; tableaux en noir sur blanc, en-têtes répétés à chaque page.
- Accessibilité : le choix du client de la facture libre a désormais un nom accessible.
- Scénario `e2e/compta-finance.cjs` (20 vérifications) : 390, 820 et 1280 px, onglets, tableaux, création d'un compte, d'un virement et d'une facture libre, livres, impression, volets.
- Limite : le harness navigateur ne connaît que le propriétaire ; les droits par rôle de ces modules restent couverts par les tests unitaires serveur (`access.test.ts`, `fin*.test.ts`, `icompta*.test.ts`, `invest*.test.ts`).
