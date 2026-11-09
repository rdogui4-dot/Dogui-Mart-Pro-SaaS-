# Promotions Pro — rapport technique

**Principe** : UN SEUL moteur de promotions pour Business et Pro (`src/domain/promotions.ts`, pur, partagé serveur/interface). Les droits d'abonnement n'altèrent jamais le calcul d'une promotion simple : ils activent ou **gèlent** des fonctions avancées. Le serveur (`dmp-api`) fait foi : aucune remise n'est appliquée sans validation serveur ; l'interface ne calcule rien seule (aperçu caisse = même calcul qu'une vraie vente, `dryRun`, rien n'est écrit).

## 1. Fichiers
| Zone | Fichiers |
|---|---|
| Moteur partagé | `src/domain/promotions.ts` (familles, cumul, plafonds, budgets, marge, fuseau horaire, chevauchements, explications), `src/domain/features.ts` (`promotionsPro`) |
| Serveur | `functions/dmp-api/src/promotions.ts` (chargement, évaluation, utilisations, enregistrement, statuts, coupons, règles de magasin, réglages), `promotions-pro.ts` (liste, analyses, recommandations, journal), `checkout.ts` (intégration vente), `handlers.ts`, `permissions.ts` |
| Schéma | `scripts/schema.mjs` + tables/colonnes créées sur Appwrite |
| Interface | `src/routes/promotions.tsx` (campagnes, création dynamique, détail), `promo-pro.tsx` (calendrier, coupons, budgets, performance, magasins, conseils, réglages, journal), `promo-shared.tsx`, `pos.tsx` (coupon, explications) |
| Tests | `src/domain/promotions*.test.ts`, `functions/dmp-api/src/promotions*.test.ts` |

## 2. Structures Appwrite
Existantes étendues : `promotions` (+ family, objective, stackable, maxLinePct, maxCartDiscount, budget, minMarginPct, requiresCoupon, storeScope, shopIds, tierBasis), `promotion_items` (+ role target/exclude/require/combo, qty, sku), `promotion_usage` (+ couponId, family, rules, decisions), `shops` (+ promoTz, promoMaxLinePct, promoMaxCartPct, promoStrategy, promoTypeRank).
Nouvelles : `promotion_conditions` (paliers, achetez X obtenez Y), `promotion_customer_groups` (catégories, fidélité, nouveaux clients, clients précis), `promotion_coupons`, `promotion_coupon_usage` (utilisations ET tentatives invalides), `promotion_store_rules` (activation/valeur/budget locaux).
`promotion_analytics` n'est volontairement **pas** une table : les indicateurs sont calculés en direct depuis `promotion_usage` / `promotion_coupon_usage` (aucune duplication susceptible de diverger ; aucun chiffre simulé). Realtime non utilisé : les listes se rafraîchissent à l'action.
Toutes les tables sont lisibles seulement par propriétaire + personnel de la boutique ; AUCUNE écriture client (tout passe par la fonction avec clé serveur, jamais de clé privilégiée dans l'application Android).

## 3. Règles métier
- **Familles** : remise simple, prix dégressifs (palier par ligne ou cumulé), achetez X obtenez Y (les Y moins chers, % de remise), pack à prix fixe (autant de packs que possible), remise conditionnée à des articles requis, remise panier (montant minimal). Un lot est appliqué en entier ou pas du tout.
- **Cumul** : par défaut une seule promotion par ligne (la plus avantageuse — ou la plus prioritaire en stratégie « priorité » —, départage par priorité, rang du type, ancienneté). Deux campagnes ne se cumulent que si les DEUX sont cumulables ; jamais d'empilement automatique d'une non-cumulable. Lots non cumulables.
- **Plafonds** : par campagne (par article %, par panier), de la boutique (par article %, par panier %), budget de campagne (et budget local par magasin), limite d'utilisation globale et par client.
- **Rentabilité** : marge minimale (boutique ou campagne) sur le **coût réel figé** ; coût inconnu + marge exigée ⇒ aucune remise (jamais d'approximation) ; refus explicite à l'enregistrement quand détectable ; vente sous marge possible seulement par autorisation explicite de la campagne.
- **Clients** : catégorie, fidélité (paliers calculés), nouveaux clients, clients précis ; client non identifié ⇒ refus expliqué.
- **Coupons** : code personnalisé/généré, usage unique, nombre limité, période, réservé à un client, séries ; réservation atomique par « slot » ; tentatives invalides tracées. Une campagne peut exiger un coupon.
- **Multi-magasins** : campagne propre / tous / certains magasins ; articles reconnus par SKU dans les autres magasins ; valeur et budget locaux, suspension locale (autorisation du gérant du magasin) ; stock et ventes restent par magasin.
- **Dates** : fuseau de l'entreprise (réglage), contrôle de la date à chaque vente (activation/expiration automatiques), chevauchements détectés, expirations < 3 jours signalées.
- **Explications** : chaque campagne concernée par le panier reçoit une décision (appliquée / refusée + raison), affichée à la caisse.
- **Immuabilité** : la ligne de vente porte un instantané figé (prix de base, remise par promotion) ; chaque utilisation enregistre un instantané des règles et des décisions ; une vente confirmée n'est jamais recalculée ; une campagne utilisée ne change plus de définition.
- **Idempotence** : même `clientId` ⇒ une seule vente, une seule utilisation de campagne, un seul coupon consommé (y compris soumissions simultanées) ; échec de vente ⇒ réservations annulées et compteurs recalculés.

## 4. Abonnements
Business = remise simple (+ tout ce qui existait). Pro = familles avancées, cumul, coupons, ciblage, budgets, plafonds, magasins, analyses, conseils (contrôle serveur : 402). **Rétrogradation** : campagnes et historiques conservés ; les campagnes avancées sont **gelées** (non appliquées, motif « frozen » expliqué, affichées « Gelée ») ; création/activation/modification d'une règle Pro bloquée ; suspension/fin toujours possibles ; retour en Pro ⇒ elles reprennent. Aucune vente n'est supprimée ni recalculée.

## 5. Tests
Domaine : fuseaux, gel Pro, invariants aléatoires (400 paniers/campagnes : jamais de remise négative ou supérieure à la ligne, parties = remise de ligne, budget et plafonds, déterminisme, cumul seulement entre cumulables), validation de saisie, chevauchements. Serveur (30+ scénarios) : chaque famille, promotions simultanées, cumul, priorités, plafonds, coupons (usage unique, période, client réservé, limite, série, invalides), ciblage clients, budgets (y compris ventes simultanées), marges et coût inconnu, limites, échec de vente, multi-magasins, rétrogradation, immuabilité, requête rejouée, suppression, calendrier, analyses, recommandations, journal, droits par rôle et par formule. Parcours navigateur (Playwright sur le vrai code serveur derrière un Appwrite simulé).

## 6. Limites assumées
- Les articles d'autres magasins sont reconnus par SKU : sans SKU commun, la campagne ne s'y applique pas.
- Le budget est contrôlé avant et APRÈS écriture (annulation en cas de dépassement simultané) : en cas de course, une vente peut être refusée à tort ; jamais acceptée à tort.
- Les recommandations se limitent aux signaux calculables (rotation, couverture de stock, ventes liées, rythme hebdomadaire) et signalent leurs limites ; elles ne prétendent à aucune causalité.
- Marge brute : seulement sur les lignes dont le coût de revient est connu.
