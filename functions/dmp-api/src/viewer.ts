/** Rôle Consultant (lecture seule) : contrôle central dans `handle`. Seules les actions de CONSULTATION ci-dessous lui sont permises ;
 *  toute autre action — y compris une action ajoutée plus tard et non listée ici — est refusée (refus par défaut).
 *  Chaque action garde en plus ses propres contrôles (rôle minimal, module, boutique) : figurer ici ne donne aucun droit supplémentaire. */
export const READ_ACTIONS: ReadonlySet<string> = new Set([
  "dashboard.business", "dashboard.pro", "dashboard.report", "dashboard.options",
  "cash.current", "cash.sessions", "cash.sellers", "cash.performance", "sales.list", "sale.get", "sale.verify", "pos.suggest", "pos.simulate", "pos.insights", "customer.profile",
  "scount.anomalies", "scount.analysis", "scount.history", "scount.plan.get", "scount.alerts", "scount.campaign.list", "scount.campaign.get", "scount.report",
  "stk.dashboard", "stk.article", "stk.moves", "stk.alerts", "stkp.analysis", "stkp.replenish", "stkp.simulate", "stkp.network", "stkp.anomalies", "stkp.products", "stkp.report",
  "xfer.list", "xfer.get", "count.list", "count.get", "count.report", "count.history", "articles.dashboard", "article.profitability",
  "crm.customers", "crm.customer", "crm.leads", "crm.lead", "crm.opps", "crm.tasks", "crm.dashboard", "crm.owners",
  "crmpro.settings", "crmpro.loyalty", "crmpro.segments", "crmpro.segment.preview", "crmpro.insight", "crmpro.analytics", "crmpro.associations", "crmpro.performance", "crmpro.campaigns", "crmpro.campaign", "crmpro.consents", "crmpro.rules", "crmpro.runs", "crmpro.teams",
  "purch.config", "purch.dashboard", "purch.article", "purch.supplier.list", "purch.supplier.get", "purch.preorder.status", "purch.po.list", "purch.po.get", "purch.receipt.list", "purch.receipt.get", "purch.invoice.list", "purch.invoice.get",
  "expense.list", "expense.get", "expense.categories", "expense.settings", "expense.myRights", "expense.report", "expense.payments", "exppro.plans.list", "exppro.budgets", "exppro.insights", "exppro.report", "exppro.config", "treasury.view",
  "approval.list", "ledger.verify", "voucher.list", "voucher.get", "voucher.check", "my.rights", "claim.list", "credit.list",
  "promotions.list", "promotions.settings", "coupons.list", "promotions.analytics", "promotions.recommendations", "promotions.journal", "promotions.stats", "promotions.preview",
  "fin.accounts", "fin.flows", "fin.transfers", "fin.reconcile.preview", "fin.reconciliations", "fin.dues", "fin.budgets", "fin.dashboard", "fin.performance", "fin.report",
  "finpro.rules", "finpro.scenarios", "finpro.plans", "finpro.forecast", "finpro.budgets", "finpro.compare", "finpro.ventilation", "finpro.consolidated", "finpro.reconcile.preview",
  "ic.overview", "ic.monthly", "ic.accounts", "ic.config", "ic.proposals", "ic.entries", "ic.entry", "ic.periods", "ic.period.controls", "ic.verify", "ic.ledger", "ic.balance", "ic.journal", "ic.third", "ic.report",
  "icp.overview", "icp.config", "icp.dims", "icp.letter.candidates", "icp.letters", "icp.assets", "icp.analytic", "icp.statements", "icp.close.guide", "icp.report",
  "inv.overview", "inv.portfolio", "inv.config", "inv.items", "inv.item", "inv.maturity", "inv.report", "ip.config", "ip.item.pro", "ip.project", "ip.placement", "ip.portfolio", "ip.report",
  "mk.status", "mk.fx", "mk.macro", "mk.brvm", "mk.brvm.ticker", "mk.world", "mk.links",
  "md.license", "md.home", "md.reports", "md.report", "md.reco.list", "md.profile", "md.pay.list", "md.chat.list", "md.chat.get",
  "settings.overview", "payments.settings.get", "payment_link.status", "subscription.get", "report.consolidated",
]);
export const READ_ONLY_MESSAGE = "Compte Consultant : consultation seule, cette action est réservée aux autres rôles";
