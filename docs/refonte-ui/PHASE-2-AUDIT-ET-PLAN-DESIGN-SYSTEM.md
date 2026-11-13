# Refonte UI/UX — Phase 2 : système de design (audit et plan)

Date : 13/11/2026 · Statut : à valider avant code · Décisions A1–A7 de la phase 1 validées.

## 1. Audit chiffré des styles actuels
| Famille | Occurrences | Remarque |
|---|---|---|
| Texte blanc translucide (`text-white/30…/90`) | ≈ 1 250 (50 : 578, 60 : 336, 40 : 178, 70 : 99) | codé pour fond noir ; illisible en thème clair ; /40 et /50 sous 4,5:1 |
| Fonds/bordures translucides (`bg-white/5`, `/10`, `border-white/10`, `/15`) | ≈ 115 | idem |
| Voiles (`bg-black/80`, `/90`) | 16 | fonds de fenêtres : à garder en thème sombre et clair (voile neutre) |
| Couleurs d'état Tailwind (amber-300 ×272, red-300 ×141, emerald-300 ×128, red-400 ×111, sky-300 ×21, orange, etc.) | ≈ 750 | teintes pastel pour fond noir : trop pâles sur fond clair |
| Or (`var(--gold)`) | 91 + 118 mentions | accent principal actuel → devient bleu (A5) |
| Couleurs hexadécimales en dur | 8 (graphiques, un reste d'or) | à passer en jetons de série |
| Classes maison : `card` ≈ 600, `input` ≈ 684, `btn` ≈ 260, `btn-ghost` ≈ 306, `chip` ≈ 90, `kpi` 7, `tile` 2 | | **bonne nouvelle** : en changeant ces 7 classes à un seul endroit, l'essentiel des écrans change sans toucher aux pages |
| Composants partagés (`ui.tsx`) | `Thumb`, `Sheet`, `Confirm` seulement | manquent : onglets, tableau, état vide, toast, bandeau, étiquette de statut |

## 2. Approche (peu risquée, réversible)
1. **Jetons sémantiques** dans `index.css` (Tailwind v4 `@theme`) : `--bg, --surface, --surface-2, --line, --text, --text-soft, --text-muted, --accent, --accent-ink, --ok, --warn, --bad, --info` + versions « fond léger » des 4 états. Deux jeux : clair (défaut) et sombre, via `data-theme` + préférence système au premier lancement + bascule mémorisée (localStorage, avec repli si indisponible).
2. **Palette** (contraste vérifié par script, AA ≥ 4,5:1 texte, ≥ 3:1 éléments) : clair = fond #F6F8FB, surface #FFFFFF, texte #10243A, accent #2563EB ; sombre = fond #0E1621, surface #152233, texte #E8EEF6, accent #6EA0FF ; états : vert/ambre/rouge/bleu à deux niveaux (texte, fond).
3. **Remplacement mécanique contrôlé** (script, un commit par famille, relu par la compilation + tests) :
   - `text-white/{30,40,50,55,60}` → `text-muted` ; `/{70,80,90}` → `text-soft` ; `text-white` → `text-main` ;
   - `bg-white/{5,10}` → `bg-subtle` ; `border-white/{10,15}` → `border-line` ;
   - `text-amber-300/200` → `text-warn`, `text-red-300/400` → `text-bad`, `text-emerald-300/400` → `text-ok`, `text-sky-300` → `text-info` (+ fonds/bordures correspondants) ;
   - `var(--gold)` → `var(--accent)`.
4. **Classes maison sobres** : `btn` = aplat accent (pas de dégradé, pas d'ombre), `btn-ghost` = contour, rayon 10 px (cartes 12 px) au lieu de 24–28 px, bordure 1 px, `kpi` sans dégradé, `.gold-text` supprimée, `tile` sans effet d'échelle.
5. **Accessibilité** : `:focus-visible` anneau 2 px accent partout ; `prefers-reduced-motion` ; taille minimale de texte 12 px (les 124 `text-[10/11px]` passent à 12–13 px, quelques mises en page serrées ajustées) ; cibles ≥ 44 px pour boutons et champs.
6. **Composants ajoutés** (`ui.tsx`) : `Tabs` (remplace les onglets maison au fil des modules), `EmptyState`, `Notice` (info/ok/alerte/erreur), `Badge`, `Toast` + fournisseur, `PageHeader` (titre + action principale), `DataTable` (version tableau ≥ 768 px, empilée sur téléphone). Ils sont **créés et testés ici mais adoptés module par module** en phase 5 : aucune page ne change de structure en phase 2.
7. **Police** : pile système (déjà `Inter, system-ui…` ; on retire `Inter` s'il n'est pas embarquée pour éviter un faux espoir de rendu).
8. **Bascule de thème** : dans le menu du compte (barre supérieure en phase 3) ; en phase 2, un interrupteur dans « Plus ».
9. **Icône PWA / `theme_color`** : couleur de thème alignée sur le thème clair ; logo inchangé.

## 3. Ce qui ne change pas en phase 2
Aucune route, aucun libellé de menu, aucune logique, aucune donnée. Les pages gardent leur disposition mobile actuelle ; seuls couleurs, rayons, ombres, focus, tailles minimales changent.

## 4. Vérification (sorties à produire)
- Script `scripts/contrast.mjs` : calcule le contraste de chaque paire de jetons, dans les deux thèmes ; échoue sous AA.
- Recherche automatisée : 0 `text-white/`, 0 `bg-white/`, 0 `from-`/`to-`/`gradient` hors logo, 0 `text-[10px]`/`[11px]`.
- Captures avant/après (390 px) clair et sombre pour : connexion, accueil, caisse, stock, réglages, MASTER ; contrôle visuel (je vous les envoie).
- Tests unitaires existants + `bash e2e/run.sh master` + `all` comparé à la liste des échecs connus (aucun nouvel échec).
- Build de production, taille du paquet comparée (pas d'augmentation sensible).

## 5. Risques et parades
| Risque | Parade |
|---|---|
| Un écran perd en lisibilité (ex. graphiques à couleurs fixes) | jetons de série de graphique, captures de tous les graphiques |
| Remplacement mécanique trop large | un commit par famille, relecture du diff, retour arrière simple |
| Textes à 12 px qui débordent | contrôle de débordement horizontal dans e2e (déjà fait pour MASTER), à étendre à Caisse/Stock/Accueil |

## 6. Livrables
`index.css` refondu, `ui.tsx` étendu, script de contraste, rapport `docs/refonte-ui/PHASE-2-RAPPORT.md` (chiffres avant/après, captures), commits poussés (publication automatique du site : **le changement de thème sera visible chez les utilisateurs dès la publication** ; je le signalerai avant de pousser).

## 7. Décision demandée
Valider ce plan (notamment : thème clair par défaut dès la publication de la phase 2, et publication directe sur le site actuel ou après votre relecture des captures).
