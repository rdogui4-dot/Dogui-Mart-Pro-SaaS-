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
  shops: { cols: [s("tenantId", 64, true), s("name", 120, true), s("city"), s("phone", 32), i("vatRatePct")], idx: [["tenant", ["tenantId"]]] },
  products: { cols: [...base, s("sku", 64), s("barcode", 64), s("name", 160, true), s("category", 80), i("price", true), i("cost"), i("minStock"), b("archived")], idx: [["shop", ["tenantId", "shopId"]], ["barcode", ["barcode"]]] },
  // Journal immuable de mouvements : le stock est la somme des mouvements.
  stock_moves: { cols: [...base, s("productId", 64, true), i("qty", true), s("kind", 24, true), s("refId", 64), s("userId", 64)], idx: [["prod", ["productId"]]] },
  customers: { cols: [...base, s("name", 160, true), s("phone", 32), i("creditLimit"), i("creditBalance"), i("points"), i("annualSpend")], idx: [["shop", ["tenantId", "shopId"]], ["phone", ["phone"]]] },
  suppliers: { cols: [...base, s("name", 160, true), s("phone", 32), s("email", 160), i("balance")], idx: [["shop", ["tenantId", "shopId"]]] },
  sales: { cols: [...base, s("number", 32, true), i("total", true), i("vat"), s("customerId", 64), s("cashierId", 64), t("payments"), t("lines"), s("status", 16), s("clientId", 64, true), d("soldAt")], idx: [["shop", ["tenantId", "shopId"]]] },
  purchase_orders: { cols: [...base, s("number", 32, true), s("supplierId", 64, true), t("lines"), i("total"), s("status", 16)], idx: [["shop", ["tenantId", "shopId"]]] },
  invoices: { cols: [...base, s("number", 32, true), s("kind", 16, true), s("partyId", 64), i("total", true), i("paid"), s("status", 16), d("dueAt")], idx: [["shop", ["tenantId", "shopId"]]] },
  journal_entries: { cols: [...base, s("ref", 64, true), s("account", 16, true), i("debit"), i("credit"), s("label", 200), d("date")], idx: [["shop", ["tenantId", "shopId"]], ["ref", ["ref"]]] },
  payment_settings: { cols: [...base, t("waveTemplate"), t("orangeTemplate"), i("expiryMinutes")], idx: [] },
  // Liens de paiement Wave/Orange Business (le QR est dessiné côté client depuis `url`).
  payment_links: { cols: [...base, s("provider", 16, true), i("amount", true), s("reference", 40, true), t("url", true), s("status", 16, true), s("saleId", 64), s("txRef", 64), d("expiresAt"), s("createdBy", 64), s("confirmedBy", 64)], idx: [["tenant_tx", ["tenantId", "txRef"]], ["shop", ["tenantId", "shopId"]]] },
  subscriptions: { cols: [s("tenantId", 64, true), s("plan", 16, true), s("status", 16), d("renewsAt"), i("maxShops"), i("maxUsers")], idx: [["tenant", ["tenantId"], "unique"]] },
  audit_log: { cols: [...base, s("userId", 64), s("action", 64, true), t("detail")], idx: [["shop", ["tenantId", "shopId"]]] },
};
