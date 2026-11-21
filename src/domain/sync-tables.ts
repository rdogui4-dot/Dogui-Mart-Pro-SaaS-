/** Qui fait référence pour chaque table quand un commerce est hébergé par un poste local (synchronisation avec le cloud).
 *  - « local »  : écrites sur le poste (ventes, stock, caisse, clients, compta…), envoyées au cloud qui en garde le miroir (lecture, rapports, sauvegarde) ;
 *  - « cloud »  : décidées par la plateforme (abonnement, paiements, licence MASTER) ; le poste les reçoit, ne les envoie jamais ;
 *  - « shared » : catalogue et réglages modifiables des deux côtés ; en cas de modification simultanée, le poste l'emporte et la version écrasée est gardée pour examen. */
export type SyncClass = "local" | "cloud" | "shared";

const CLOUD = ["subscriptions", "subscription_payments", "platform_settings", "market_cache", "md_licenses", "md_trials", "md_payments"];
const SHARED = ["shops", "products", "article_units", "article_variants", "article_price_rules", "article_suppliers", "article_components", "suppliers", "payment_settings", "expense_categories", "expense_config", "crm_config", "acct_config", "inv_config", "md_reco_cfg"];

export const SYNC_CLASS_OF: Record<string, SyncClass> = {};
const ALL = ["shops", "products", "article_units", "article_variants", "article_price_rules", "article_suppliers", "article_cost_events", "article_components", "article_alerts", "assembly_orders", "promotions", "promotion_items", "promotion_usage", "promotion_conditions", "promotion_customer_groups", "promotion_coupons", "promotion_coupon_usage", "promotion_store_rules", "cash_sessions", "cash_movements", "payment_refs", "pos_approvals", "finance_ledger", "customer_vouchers", "expenses", "expense_events", "expense_categories", "expense_config", "expense_payments", "purchase_receipts", "inventories", "inventory_lines", "inventory_campaigns", "inventory_plans", "inventory_events", "purchase_events", "sale_returns", "article_lots", "article_serials", "price_history", "stock_moves", "customers", "crm_leads", "crm_opps", "crm_tasks", "crm_config", "crm_segments", "crm_campaigns", "crm_targets", "crm_rules", "crm_runs", "purchase_claims", "supplier_credits", "fin_accounts", "fin_transfers", "fin_reconciliations", "acct_accounts", "acct_config", "acct_periods", "acct_entries", "acct_assets", "acct_letters", "acct_dims", "inv_items", "inv_scenarios", "inv_actuals", "inv_config", "inv_financing", "inv_tranches", "inv_values", "fin_rules", "fin_scenarios", "fin_plans", "fin_budgets", "crm_teams", "crm_events", "suppliers", "sales", "purchase_orders", "invoices", "journal_entries", "payment_settings", "payment_links", "staff_invites", "staff", "transfers", "subscriptions", "subscription_payments", "md_licenses", "md_trials", "md_payments", "md_reports", "md_profile", "md_recos", "md_reco_cfg", "md_chats", "md_msgs", "md_usage", "md_events", "platform_settings", "market_cache", "audit_log"];
for (const t of ALL) SYNC_CLASS_OF[t] = CLOUD.includes(t) ? "cloud" : SHARED.includes(t) ? "shared" : "local";

export const syncClass = (table: string): SyncClass | null => SYNC_CLASS_OF[table] ?? null;
/** Tables que le poste envoie au cloud (locales et partagées). */
export const PUSHED_TABLES = Object.keys(SYNC_CLASS_OF).filter((t) => SYNC_CLASS_OF[t] !== "cloud");
/** Tables que le poste reçoit du cloud en continu (décidées par la plateforme ou partagées). */
export const PULLED_TABLES = Object.keys(SYNC_CLASS_OF).filter((t) => SYNC_CLASS_OF[t] !== "local");
