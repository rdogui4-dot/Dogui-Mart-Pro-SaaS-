// Schéma Appwrite (TablesDB). Multi-tenant : chaque ligne porte tenantId (= Team Appwrite) et shopId.
// Sécurité : AUCUNE table n'accorde d'écriture aux clients. Toutes les écritures passent par la fonction `dmp-api`
// (clé API serveur) qui vérifie l'appartenance au tenant et le rôle. Les lignes sont lisibles par la Team du tenant.
// Types : s=string(size) t=text i=int f=float b=bool d=datetime
const s = (key, size = 255, required = false) => ({ key, type: "s", size, required });
const t = (key, required = false) => ({ key, type: "t", required });
const i = (key, required = false) => ({ key, type: "i", required });
const f = (key, required = false) => ({ key, type: "f", required });
const b = (key) => ({ key, type: "b", required: false });
const d = (key) => ({ key, type: "d", required: false });
const base = [s("tenantId", 64, true), s("shopId", 64, true)];

export const TABLES = {
  shops: { cols: [s("tenantId", 64, true), s("costMethod", 16), s("expiredPolicy", 8), i("minMarginPct"), b("cashRequired"), i("varianceTolerance"), i("expenseThreshold"), b("expenseCodeRequired"), t("expenseSensitive"), s("promoTz", 40), i("promoMaxLinePct"), i("promoMaxCartPct"), s("promoStrategy", 10), s("promoTypeRank", 80), s("name", 120, true), s("city"), s("phone", 32), i("vatRatePct"), s("address", 160), s("legal", 120)], idx: [["tenant", ["tenantId"]]] },
  products: { cols: [...base, s("sku", 64), s("barcode", 64), s("name", 160, true), s("category", 80), i("price", true), i("cost"), i("minStock"), b("archived"), s("originId", 64), t("description"), s("unit", 16), s("supplierId", 64), s("imageFileId", 64), i("qtyScale"), b("hasVariants"), s("tracking", 8), s("kind", 8), s("bundleMode", 8)], idx: [["shop", ["tenantId", "shopId"]], ["barcode", ["barcode"]], ["origin", ["originId"]], ["tenant", ["tenantId"]], ["name_ft", ["name"], "fulltext"], ["sku", ["sku"]], ["category", ["tenantId", "shopId", "category"]]] },
  // Historique des modifications de prix d'un article (les ventes gardent leur propre prix figé).
  // Conditionnements d'un article (1 unité = `factor` unités de base). Une ligne par (article, unité) ; retirée = active:false.
  article_units: { cols: [...base, s("productId", 64, true), s("unit", 16, true), f("factor", true), b("active")], idx: [["product", ["productId"]]] },
  // Variantes d'un article (taille, couleur…) : SKU, prix, seuil et stock propres (stock = mouvements portant ce variantId).
  article_variants: { cols: [...base, s("productId", 64, true), t("attributes", true), s("attrKey", 255, true), s("label", 255, true), s("sku", 64), s("barcode", 64), i("price", true), i("cost"), i("minStock"), s("imageFileId", 64), b("archived")], idx: [["product", ["productId"]], ["sku", ["sku"]], ["barcode", ["barcode"]], ["shop", ["tenantId", "shopId"]]] },
  // Tarifs avancés (Pro) : promotion, prix par catégorie de clients, prix par quantité. Un prix par règle ; variantId vide = article sans variantes.
  article_price_rules: { cols: [...base, s("productId", 64, true), s("variantId", 64), s("kind", 16, true), i("price", true), s("unit", 16), f("minQty"), s("customerCategory", 16), d("startsAt"), d("endsAt"), i("priority"), b("active"), s("label", 60)], idx: [["product", ["productId"]], ["shop", ["tenantId", "shopId"]]] },
  // Conditions d'approvisionnement : un fournisseur par (article, variante). lastPrice = dernier prix réellement payé (mis à jour à la réception).
  article_suppliers: { cols: [...base, s("productId", 64, true), s("variantId", 64), s("supplierId", 64, true), s("supplierRef", 64), i("price", true), i("leadDays"), f("minQty"), f("feePct"), i("lastPrice"), d("lastPurchaseAt"), s("status", 16)], idx: [["product", ["productId"]], ["supplier", ["supplierId"]]] },
  // Évolution des coûts d'achat : une ligne par article reçu (prix payé, coût de revient avec frais, coût du stock avant/après).
  article_cost_events: { cols: [...base, s("productId", 64, true), s("variantId", 64), s("supplierId", 64), s("kind", 16, true), i("unitCost"), i("landedCost"), f("qty"), i("costBefore"), i("costAfter"), s("method", 16), s("ref", 64)], idx: [["product", ["productId"]]] },
  // Lots (péremption) : quantité d'un lot = somme des mouvements portant son lotId. unitCost = coût de revient du lot (valorisation par lot).
  // Bundles virtuels : composition d'un article `kind = bundle` (une ligne par composant ; qty entière en unité de base du composant).
  article_components: { cols: [...base, s("bundleId", 64, true), s("componentId", 64, true), s("variantId", 64), i("qty", true)], idx: [["bundle", ["bundleId"]], ["component", ["componentId"]], ["shop", ["tenantId", "shopId"]]] },
  // Alertes du jour : une ligne par (type, objet, jour) à identifiant déterministe ; `status` open → read (accusé de lecture tracé).
  article_alerts: { cols: [...base, s("day", 10, true), s("type", 24, true), s("productId", 64), s("refId", 64, true), s("severity", 10), s("label", 255), s("detail", 500), s("status", 10), s("readBy", 64), d("readAt")], idx: [["shop_day", ["tenantId", "shopId", "day"]]] },
  // Ordres d'assemblage / démontage d'un kit physique : composants sortis (ou rendus) et kit entré (ou sorti) par mouvements tracés.
  assembly_orders: { cols: [...base, s("number", 32, true), s("bundleId", 64, true), s("type", 12, true), i("qty", true), i("unitCost"), t("lines"), s("status", 10), s("userId", 64)], idx: [["bundle", ["bundleId"]], ["shop", ["tenantId", "shopId"]]] },
  // Promotions (Business) : définition, articles concernés, et une ligne d'utilisation par (promotion, vente) — la limite globale se réserve par « slot » à identifiant unique.
  promotions: { cols: [...base, s("family", 10), s("objective", 200), b("stackable"), i("maxLinePct"), i("maxCartDiscount"), i("budget"), i("minMarginPct"), b("requiresCoupon"), s("storeScope", 6), t("shopIds"), s("tierBasis", 12), s("name", 160, true), t("description"), s("code", 24), s("kind", 8, true), s("scope", 8, true), i("discountValue", true), s("category", 80), d("startAt", true), d("endAt", true), s("status", 10, true), f("minQty"), i("minCart"), i("usageLimit"), i("usageCount"), i("perCustomerLimit"), i("priority"), b("allowBelowMargin"), s("createdBy", 64), d("createdOn")], idx: [["shop", ["tenantId", "shopId"]], ["code", ["code"]]] },
  promotion_items: { cols: [...base, s("promotionId", 64, true), s("productId", 64, true), s("role", 8), f("qty"), s("sku", 64)], idx: [["promotion", ["promotionId"]], ["shop", ["tenantId", "shopId"]]] },
  promotion_usage: { cols: [...base, s("promotionId", 64, true), s("saleId", 64, true), s("saleNumber", 32), s("customerId", 64), s("code", 24), i("discount", true), i("baseAmount"), i("finalAmount"), t("lines"), i("slot"), s("userId", 64), d("usedAt"), s("couponId", 64), s("family", 10), t("rules"), t("decisions")], idx: [["promotion", ["promotionId"]], ["sale", ["saleId"]], ["customer", ["promotionId", "customerId"]], ["shop", ["tenantId", "shopId"]]] },

  // Promotions Pro : conditions (paliers, achetez X obtenez Y), groupes de clients ciblés, coupons, utilisations de coupons (y compris tentatives invalides), règles par magasin.
  promotion_conditions: { cols: [...base, s("promotionId", 64, true), s("kind", 8, true), f("minQty"), s("valueKind", 8), i("value"), t("params")], idx: [["promotion", ["promotionId"]]] },
  promotion_customer_groups: { cols: [...base, s("promotionId", 64, true), s("kind", 10, true), s("value", 64), i("days")], idx: [["promotion", ["promotionId"]]] },
  promotion_coupons: { cols: [...base, s("promotionId", 64, true), s("code", 24, true), b("singleUse"), i("maxUses"), i("usedCount"), s("customerId", 64), d("validFrom"), d("validTo"), b("active"), s("createdBy", 64)], idx: [["promotion", ["promotionId"]], ["code", ["tenantId", "code"]]] },
  promotion_coupon_usage: { cols: [...base, s("couponId", 64), s("promotionId", 64), s("code", 24, true), s("outcome", 8, true), s("reason", 24), s("saleId", 64), s("customerId", 64), i("slot"), s("userId", 64), d("usedAt")], idx: [["coupon", ["couponId"]], ["promotion", ["promotionId"]], ["shop", ["tenantId", "shopId"]]] },
  promotion_store_rules: { cols: [...base, s("promotionId", 64, true), s("targetShopId", 64, true), b("enabled"), i("value"), i("budget")], idx: [["promotion", ["promotionId"]]] },
  // Caisse Business : sessions de caisse (fond initial, comptage, écart), sorties/entrées autorisées, annulations et remboursements tracés (jamais de suppression de l'historique).
  cash_sessions: { cols: [...base, s("userId", 64, true), d("openedAt"), d("closedAt"), s("status", 8, true), i("openingFloat"), i("countedCash"), i("theoreticalCash"), i("variance"), t("summary"), s("closedBy", 64), s("note", 200), s("register", 40), s("varianceStatus", 10), s("validatedBy", 64), d("validatedAt"), s("handoverFrom", 64)], idx: [["shop", ["tenantId", "shopId"]], ["user", ["userId"]]] },
  cash_movements: { cols: [...base, s("sessionId", 64, true), s("kind", 4, true), i("amount", true), s("reason", 200), s("status", 12), s("userId", 64), s("authorizedBy", 64), d("at"), s("expenseId", 64), s("beneficiary", 120)], idx: [["session", ["sessionId"]]] },
  payment_refs: { cols: [...base, s("saleId", 64), s("method", 16), s("reference", 64), i("amount")], idx: [["sale", ["saleId"]]] },
  pos_approvals: { cols: [...base, s("kind", 16, true), s("status", 10, true), s("refId", 64), t("details"), i("amount"), s("requestedBy", 64), s("decidedBy", 64), d("requestedAt"), d("decidedAt"), d("expiresAt"), s("usedBy", 64), s("note", 200)], idx: [["shop", ["tenantId", "shopId"]]] },
  finance_ledger: { cols: [...base, s("kind", 16), s("ref", 64), i("amount"), s("method", 60), s("userId", 64), d("at"), s("sessionId", 64), t("payload"), s("hash", 64)], idx: [["shop", ["tenantId", "shopId", "at"]], ["ref", ["ref"]]] },
  customer_vouchers: { cols: [...base, s("kind", 8), s("code", 24), s("customerId", 64), i("amount"), s("status", 10), d("expiresAt"), s("createdBy", 64), d("createdAt"), s("ref", 64)], idx: [["code", ["code"]]] },
  expenses: { cols: [...base, s("number", 24, true), s("label", 120, true), s("description", 500), s("category", 40, true), i("amount", true), d("spentOn"), s("method", 16), s("reference", 64), s("beneficiary", 120), s("supplierId", 64), s("source", 10), s("sessionId", 64), d("dueOn"), i("paidAmount"), s("payMode", 10), s("recurringId", 64), s("service", 40), t("receipts"), s("status", 12, true), s("createdBy", 64), s("decidedBy", 64), s("movementId", 64), t("meta")], idx: [["shop", ["tenantId", "shopId", "spentOn"]], ["session", ["sessionId"]], ["status", ["status"]]] },
  expense_events: { cols: [...base, s("expenseId", 64, true), s("kind", 16, true), s("userId", 64), d("at"), t("detail")], idx: [["expense", ["expenseId"]]] },
  expense_categories: { cols: [s("tenantId", 64, true), s("name", 40, true), b("active"), s("createdBy", 64)], idx: [["tenant", ["tenantId"]]] },
  expense_config: { cols: [s("tenantId", 64, true), s("shopId", 64), s("type", 12, true), s("key", 64), t("config"), b("active"), s("createdBy", 64), i("version")], idx: [["tenant", ["tenantId", "type"]]] },
  expense_payments: { cols: [...base, s("expenseId", 64, true), i("amount", true), s("method", 16), s("source", 10), d("paidOn"), s("reference", 64), s("sessionId", 64), s("movementId", 64), s("createdBy", 64), s("requestKey", 64)], idx: [["expense", ["expenseId"]]] },
  sale_returns: { cols: [...base, s("saleId", 64, true), s("saleNumber", 32), s("kind", 8, true), i("amount", true), t("refunds"), t("lines"), s("reason", 200), s("userId", 64), s("sessionId", 64), d("at"), i("points"), s("status", 10)], idx: [["sale", ["saleId"]], ["shop", ["tenantId", "shopId"]]] },
  article_lots: { cols: [...base, s("productId", 64, true), s("variantId", 64), s("lotNo", 40, true), d("manufacturedAt"), d("expiresAt"), d("receivedAt"), s("supplierId", 64), i("unitCost"), s("status", 16)], idx: [["product", ["productId"]], ["shop", ["tenantId", "shopId"]]] },
  // Numéros de série : une ligne par unité ; `cycle` compte les retours remis en stock (verrou de vente atomique par identifiant de mouvement).
  article_serials: { cols: [...base, s("productId", 64, true), s("variantId", 64), s("serial", 64, true), s("status", 16, true), d("receivedAt"), s("supplierId", 64), i("unitCost"), i("warrantyMonths"), s("saleId", 64), s("saleRef", 64), d("soldAt"), d("warrantyUntil"), i("cycle"), s("entryRef", 64)], idx: [["product", ["productId"]], ["serial", ["serial"]], ["shop", ["tenantId", "shopId"]]] },
  price_history: { cols: [...base, s("productId", 64, true), i("oldPrice"), i("newPrice"), i("oldCost"), i("newCost"), s("userId", 64), s("variantId", 64)], idx: [["product", ["productId"]]] },
  // Journal immuable de mouvements : le stock est la somme des mouvements.
  stock_moves: { cols: [...base, s("productId", 64, true), i("qty", true), s("kind", 24, true), s("refId", 64), s("userId", 64), s("unit", 16), f("unitQty"), s("variantId", 64), s("lotId", 64), s("serial", 64)], idx: [["prod", ["productId"]], ["variant", ["variantId"]], ["lot", ["lotId"]]] },
  customers: { cols: [...base, s("name", 160, true), s("phone", 32), i("creditLimit"), i("creditBalance"), i("points"), i("annualSpend"), s("category", 16)], idx: [["shop", ["tenantId", "shopId"]], ["phone", ["phone"]]] },
  suppliers: { cols: [...base, s("name", 160, true), s("phone", 32), s("email", 160), i("balance")], idx: [["shop", ["tenantId", "shopId"]]] },
  sales: { cols: [...base, s("number", 32, true), i("total", true), i("vat"), s("customerId", 64), s("cashierId", 64), t("payments"), t("lines"), s("status", 16), s("clientId", 64, true), d("soldAt")], idx: [["shop", ["tenantId", "shopId"]], ["status", ["status"]]] },
  purchase_orders: { cols: [...base, s("number", 32, true), s("supplierId", 64, true), t("lines"), i("total"), s("status", 16), t("receipts"), t("invoicedIds")], idx: [["shop", ["tenantId", "shopId"]]] },
  invoices: { cols: [...base, s("number", 32, true), s("kind", 16, true), s("partyId", 64), i("total", true), i("paid"), s("status", 16), d("dueAt"), s("poId", 64), s("ref", 64), i("vat"), t("payments"), s("saleId", 64), t("lines")], idx: [["shop", ["tenantId", "shopId"]], ["kind", ["kind"]]] },
  journal_entries: { cols: [...base, s("ref", 64, true), s("account", 16, true), i("debit"), i("credit"), s("label", 200), d("date")], idx: [["shop", ["tenantId", "shopId"]], ["ref", ["ref"]]] },
  payment_settings: { cols: [...base, t("waveTemplate"), t("orangeTemplate"), i("expiryMinutes")], idx: [] },
  // Liens de paiement Wave/Orange Business (le QR est dessiné côté client depuis `url`).
  payment_links: { cols: [...base, s("provider", 16, true), i("amount", true), s("reference", 40, true), t("url", true), s("status", 16, true), s("saleId", 64), s("txRef", 64), d("expiresAt"), s("createdBy", 64), s("confirmedBy", 64)], idx: [["tenant_tx", ["tenantId", "txRef"]], ["shop", ["tenantId", "shopId"]]] },
  // Fiche employé (le rôle fait foi dans l'appartenance à la Team ; ici : boutiques affectées et statut).
  staff: { cols: [s("tenantId", 64, true), s("userId", 64, true), s("name", 100, true), s("username", 32), s("email", 160), s("role", 16, true), t("shopIds"), t("access"), b("active"), t("posRights"), t("expenseRights")], idx: [["tenant", ["tenantId"]]] },
  transfers: { cols: [...base, s("toShopId", 64, true), s("number", 32), t("lines"), s("userId", 64), s("status", 10)], idx: [["shop", ["tenantId", "shopId"]], ["to", ["toShopId"]]] },
  // Abonnement du commerce : identifiant de ligne = tenantId. Les limites viennent du catalogue de formules (modifiable par la plateforme).
  subscriptions: { cols: [s("tenantId", 64, true), s("plan", 16, true), s("period", 16), s("status", 16), d("startedAt"), d("renewsAt"), d("remindedAt")], idx: [["tenant", ["tenantId"], "unique"]] },
  // Demandes de paiement d'abonnement (liens Selar, validés à la main par la plateforme) et attributions manuelles.
  subscription_payments: { cols: [s("tenantId", 64, true), s("tenantName", 120), s("plan", 16, true), s("period", 16, true), i("count"), i("amount", true), s("provider", 16), s("reference", 40), t("url"), s("status", 24, true), s("txRef", 64), s("payerEmail", 160), s("requestedBy", 64), s("reviewedBy", 64), s("note", 200), d("startsAt"), d("endsAt")], idx: [["tenant", ["tenantId"]], ["status", ["status"]], ["tx", ["txRef"]]] },
  // Réglages de la plateforme (une seule ligne "main") : aucune lecture client, accessibles seulement par la fonction serveur.
  // selarLinks : JSON { "formule:période": "https://selar.co/…" } ; plans : surcharge JSON du catalogue.
  platform_settings: { cols: [t("selarLinks"), t("plans")], idx: [] },
  audit_log: { cols: [...base, s("userId", 64), s("action", 64, true), t("detail")], idx: [["shop", ["tenantId", "shopId"]]] },
};
