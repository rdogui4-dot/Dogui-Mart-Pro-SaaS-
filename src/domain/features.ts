/** Droits d'abonnement : ce que chaque FORMULE permet. Distinct des rôles du personnel (src/domain/access.ts) : un rôle dit « qui peut », la formule dit « ce que le commerce a acheté ». */
export type PlanId = "starter" | "business" | "pro";
const RANK: Record<PlanId, number> = { starter: 0, business: 1, pro: 2 };

export const FEATURES = {
  promotions: { label: "Promotions", min: "business", help: "Remises programmées, codes promotionnels, suivi des résultats." },
  smartPos: { label: "Caisse intelligente (sessions, remboursements, historique)", min: "business", help: "Ouverture/fermeture de caisse, écarts, sorties autorisées, annulations et remboursements tracés, historique des ventes et réimpression." },
  smartPosPro: { label: "Caisse super intelligente Pro (suggestions, approbations, multi-caisses, journal financier)", min: "pro", help: "Suggestions de vente croisée réelles, simulation avant validation, protection des marges avec approbation hiérarchique, droits distincts, bons d'achat, multi-caisses, journal financier immuable et ticket vérifiable par QR." },
  expenses: { label: "Dépenses et sorties de caisse", min: "business", help: "Dépenses par catégorie avec justificatif, sorties d'espèces rattachées à la session de caisse, validation hiérarchique, annulation tracée et rapports." },
  expensesPro: { label: "Dépenses Pro (budgets, circuits d'approbation, trésorerie, prévisions)", min: "pro", help: "Budgets par période, boutique, catégorie et service, plafonds par responsable, circuit de validation multi-niveaux, dépenses récurrentes et planifiées, paiements partiels, ventilation entre boutiques, contrôle des anomalies, trésorerie et scénarios." },
  purchasing: { label: "Fournisseurs et achats (commandes, réceptions, factures, paiements)", min: "business", help: "Fiches fournisseurs complètes, commandes avec circuit de validation, réceptions partielles avec écarts, factures et paiements fournisseurs reliés à la caisse, historique des prix et tableau de bord des achats." },
  businessDashboard: { label: "Tableau de bord de l'activité", min: "business", help: "Chiffre d'affaires, ventes, marge, stock, graphiques, activité récente et alertes réelles." },
  proDashboard: { label: "Tableau de bord Pro (analyses, rentabilité, prévisions, exports)", min: "pro", help: "Performance commerciale, rentabilité, stocks, achats, magasins, prévisions indicatives et exports PDF/Excel/CSV." },
  promotionsPro: { label: "Promotions avancées", min: "pro", help: "Prix dégressifs, achetez X obtenez Y, packs, coupons, ciblage clients, multi-magasins, budgets, analyses et recommandations." },
  articles: { label: "Catalogue d'articles", min: "business", help: "Fiches complètes, photos, catégories, historique des prix." },
  // Fonctions avancées réservées à Pro (verrouillées et proposées en mise à niveau ; non développées dans cette version)
  costing: { label: "Fournisseurs multiples, frais et valorisation du stock", min: "pro", help: "Comparer vos fournisseurs, intégrer les frais d'approvisionnement au coût, choisir la méthode de valorisation." },
  variants: { label: "Variantes (taille, couleur…)", min: "pro", help: "Un article, plusieurs déclinaisons avec leur propre stock." },
  packaging: { label: "Multi-conditionnement et quantités décimales", min: "pro", help: "Vendre à la pièce, au carton, au kilo ou au litre (1,5 kg), avec conversions automatiques." },
  tieredPricing: { label: "Tarifs par client ou quantité", min: "pro", help: "Prix de gros, remises par palier, tarifs clients." },
  lots: { label: "Lots et dates d'expiration", min: "pro", help: "Traçabilité des lots et alertes de péremption." },
  serials: { label: "Numéros de série", min: "pro", help: "Suivi unitaire des articles sensibles." },
  multiShopCatalog: { label: "Catalogue multi-magasins avancé", min: "pro", help: "Prix et disponibilité différents par boutique, synchronisés." },
  bundles: { label: "Bundles et compositions", min: "pro", help: "Vendre des lots d'articles ou des produits composés." },
  dashboard: { label: "Tableau de bord articles et alertes", min: "pro", help: "Indicateurs de stock, alertes de rupture, de péremption et de marge, meilleurs articles." },
  profitability: { label: "Analyses avancées de rentabilité", min: "pro", help: "Marge par article, catégorie et période." },
} as const satisfies Record<string, { label: string; min: PlanId; help: string }>;
export type FeatureKey = keyof typeof FEATURES;

/** La formule « à vie » est portée par la formule Pro (voir subscriptions.ts) : elle ouvre donc tout. */
export const planAllows = (plan: string | undefined, feature: FeatureKey): boolean =>
  (RANK[(plan as PlanId) ?? "starter"] ?? 0) >= RANK[FEATURES[feature].min];
export const PRO_LOCKED = (Object.keys(FEATURES) as FeatureKey[]).filter((k) => FEATURES[k].min === "pro");
