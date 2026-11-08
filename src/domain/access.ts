/** Accès du personnel : 7 modules, et des rôles qui sont des préréglages de modules. Le propriétaire (gérant principal) a tous les accès. */
export const MODULES = ["pos", "customers", "stock", "purchases", "invoices", "accounting", "reports"] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABEL: Record<Module, string> = {
  pos: "Caisse", customers: "Clients & fidélité", stock: "Stock", purchases: "Achats", invoices: "Factures clients", accounting: "Comptabilité", reports: "Rapports",
};
/** Ce que chaque module permet réellement (texte affiché au propriétaire quand il attribue les accès). */
export const MODULE_HELP: Record<Module, string> = {
  pos: "Vendre, encaisser (espèces, carte, crédit, QR Wave/Orange), tickets, rembourser un crédit client.",
  customers: "Voir et créer les fiches clients (le plafond de crédit reste réservé aux gérants).",
  stock: "Produits, prix, inventaire, mouvements, transferts entre boutiques.",
  purchases: "Fournisseurs, bons de commande, réceptions.",
  invoices: "Créer, encaisser et exporter les factures clients.",
  accounting: "Journal comptable, factures fournisseurs et leurs règlements.",
  reports: "Rapports de ventes, marges, stock valorisé (boutiques affectées).",
};

export const STAFF_ROLES = ["manager", "cashier", "stockkeeper", "accountant"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ROLE_PRESETS: Record<StaffRole, { label: string; description: string; modules: Module[] }> = {
  manager: { label: "Gérant", description: "Gère le commerce au quotidien : tous les modules, remises et plafonds de crédit. Ne gère ni l'équipe, ni les boutiques, ni l'abonnement.", modules: [...MODULES] },
  cashier: { label: "Caissier", description: "Tient la caisse et les fiches clients.", modules: ["pos", "customers"] },
  stockkeeper: { label: "Magasinier", description: "Gère le stock, les fournisseurs et les réceptions.", modules: ["stock", "purchases"] },
  accountant: { label: "Comptable", description: "Factures, comptabilité et rapports.", modules: ["invoices", "accounting", "reports"] },
};
export const isStaffRole = (r: unknown): r is StaffRole => (STAFF_ROLES as readonly unknown[]).includes(r);
export const isModule = (m: unknown): m is Module => (MODULES as readonly unknown[]).includes(m);

/** Modules effectifs : liste explicite valide si elle existe, sinon préréglage du rôle (rôle inconnu = caissier : le plus restreint). */
export function modulesFor(role: unknown, access?: unknown): Module[] {
  let list: unknown = access;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = undefined; } }
  if (Array.isArray(list)) { const ok = [...new Set(list.filter(isModule))]; if (ok.length) return MODULES.filter((m) => ok.includes(m)); }
  return [...ROLE_PRESETS[isStaffRole(role) ? role : "cashier"].modules];
}

/** Valide une liste de modules saisie par le propriétaire (au moins un, aucun inconnu). */
export function parseModules(input: unknown): { ok: true; modules: Module[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || !input.length) return { ok: false, error: "Au moins un accès est requis" };
  const bad = input.find((m) => !isModule(m)); if (bad !== undefined) return { ok: false, error: `Accès inconnu : ${String(bad)}` };
  return { ok: true, modules: MODULES.filter((m) => input.includes(m)) };
}

export const sameModules = (a: Module[], b: Module[]): boolean => a.length === b.length && a.every((m) => b.includes(m));
/** « Personnalisé » si les accès ne correspondent plus au préréglage du rôle. */
export const isCustomAccess = (role: unknown, modules: Module[]): boolean => !sameModules(modules, modulesFor(role));
