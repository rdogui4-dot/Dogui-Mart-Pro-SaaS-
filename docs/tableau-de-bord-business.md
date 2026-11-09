# Tableau de bord Business — rapport technique

Route `/activite` (tuile « Tableau de bord »), action serveur `dashboard.business`. Formule Business ou Pro (`businessDashboard`) ; module « Rapports » requis (propriétaire, gérant, comptable). L'ancien tableau « Articles & alertes » (Pro) reste à `/tableau` (tuile « Alertes articles »).

## Audit préalable (ce qui existe réellement)
| Besoin | Constat | Décision |
|---|---|---|
| Ventes, lignes, paiements | `sales` (statuts `pending` → `posted` → `paid`), lignes/paiements en JSON, coût de revient figé par ligne | Seules les ventes `paid` comptent |
| Ventes annulées / remboursements | **N'existent pas** dans l'application | Aucune alerte « annulée », rien n'est déduit ; une vente non finalisée (>10 min) est signalée et exclue |
| Dépenses | **Pas de module de dépenses** | « Achats enregistrés » = débits du compte 601 du journal (HT, factures fournisseurs) ; la limite est écrite sur l'écran |
| Écarts d'inventaire « non résolus » | L'inventaire écrit immédiatement un mouvement d'ajustement | Pas d'alerte fictive ; les écarts apparaissent dans « Opérations importantes » |
| Valeur du stock | Déjà calculée par les rapports | Une seule définition partagée (`stock-snapshot.ts`) pour rapports et tableau de bord |
| Fuseau | Réglage de l'entreprise (`shops.promoTz`, défaut Africa/Dakar) | Tous les jours/périodes en heure de l'entreprise |

## Définitions
- **CA** = ventes terminées, TTC. **Encaissé** = paiements hors crédit, plafonnés au total (monnaie rendue exclue), fractionnés comptés une fois. **À crédit** = vendu non encaissé. Encaissé + crédit = CA.
- **Marge brute** = CA HT − coût de revient figé, uniquement si TOUTES les lignes ont un coût ; sinon « Non calculable » + nombre de lignes sans coût.
- **Stock faible** = quantité > 0 et ≤ seuil ; **Rupture** = quantité ≤ 0 ; si l'historique est trop volumineux, valeur et compteurs sont « non calculés » (jamais faux).
- Chaque carte affiche sa période et sa méthode.

## Sécurité
Lecture seule côté serveur ; isolation par `tenantId` ; un non-propriétaire ne voit que ses boutiques affectées ; « Toutes mes boutiques » = boutiques autorisées. Aucune table ni colonne nouvelle (aucune migration Appwrite). Pas de Function d'agrégation séparée : l'action de `dmp-api` lit des plages bornées (20 000 ventes, 100 000 mouvements) et signale toute troncature.

## Tests
`src/domain/overview.test.ts` (périodes, fuseaux, agrégats) ; `functions/dmp-api/src/overview.test.ts` (opérations réelles via `checkout`, achats, inventaire : droits, isolation, paiements fractionnés/crédit/monnaie, ventes non finalisées, marge, fuseau Lagos vs Dakar, présélections, alertes seulement sur événements réels, cohérence valeur du stock = rapports, multi-boutiques) ; parcours navigateur (état vide, chiffres, filtres, hors ligne, verrouillage Starter).
