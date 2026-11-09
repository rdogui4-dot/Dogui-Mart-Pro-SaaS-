/** Droits d'abonnement : ce que chaque FORMULE permet. Distinct des rôles du personnel (src/domain/access.ts) : un rôle dit « qui peut », la formule dit « ce que le commerce a acheté ». */
export type PlanId = "starter" | "business" | "pro";
const RANK: Record<PlanId, number> = { starter: 0, business: 1, pro: 2 };

export const FEATURES = {
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
