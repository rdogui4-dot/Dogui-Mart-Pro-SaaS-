/** Architecture de navigation : six espaces regroupant les modules existants (les adresses actuelles restent valides). */
import { BookOpen, Boxes, Settings, ShoppingCart, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
import { can, type Perm } from "@/lib/session";
import { planAllows } from "@/domain/features";
import { BarChart3, Boxes as BoxesI, Brain, Building2, Calculator, ClipboardCheck, CreditCard, LayoutDashboard, Megaphone, Package, Settings as SettingsI, ShoppingCart as CartI, Truck, UserCog, Users, Wallet, Landmark } from "lucide-react";

export type NavItem = { to: string; label: string; hint: string; perm: Perm; /** autres adresses du même module (onglets) */ also?: string[]; /** s'ouvre en fenêtre sur place (pas de changement de page) */ modal?: boolean };
export type Space = { id: string; label: string; icon: LucideIcon; hint: string; items: NavItem[] };

export const SPACES: Space[] = [
  { id: "vendre", label: "Vendre", icon: ShoppingCart, hint: "Caisse, ventes, clients, promotions", items: [
    { to: "/pos", label: "Caisse", hint: "Encaisser, ventes, session de caisse, caisse Pro", perm: "pos", also: ["/ventes", "/caisse", "/caisse-pro"] },
    { to: "/clients", label: "Clients", hint: "Fidélité, crédit, prospects", perm: "customers" },
    { to: "/promotions", label: "Promotions", hint: "Remises, codes et résultats", perm: "stock" },
  ] },
  { id: "stock", label: "Stock", icon: Boxes, hint: "Articles, stock, inventaires", items: [
    { to: "/stock", label: "Stock", hint: "Produits et mouvements", perm: "stock" },
    { to: "/articles", label: "Articles", hint: "Catalogue, photos et prix", perm: "stock" },
    { to: "/bundles", label: "Bundles", hint: "Packs d'articles à prix propre", perm: "stock" },
    { to: "/inventaire", label: "Inventaire", hint: "Comptage et écarts", perm: "stock" },
    { to: "/tableau", label: "Alertes articles", hint: "Péremption, marges, meilleurs articles", perm: "stock" },
  ] },
  { id: "acheter", label: "Acheter et dépenser", icon: Receipt, hint: "Achats, fournisseurs, dépenses", items: [
    { to: "/achats", label: "Achats", hint: "Commandes et fournisseurs", perm: "purchases" },
    { to: "/depenses", label: "Dépenses", hint: "Dépenses, justificatifs, sorties de caisse, budgets et prévisions", perm: "pos", also: ["/depenses-pro"] },
  ] },
  { id: "piloter", label: "Piloter", icon: TrendingUp, hint: "Tableaux de bord et MASTER DOGUI", items: [
    { to: "/activite", label: "Tableau de bord", hint: "Ventes, marge, stock et alertes", perm: "reports" },
    { to: "/pilotage", label: "Pilotage Pro", hint: "Rentabilité, stocks, prévisions, exports", perm: "reports" },
    { to: "/master", label: "MASTER DOGUI", hint: "Rapports, recommandations, assistant, licence", perm: "settings", modal: true },
  ] },
  { id: "compta", label: "Comptabilité et finance", icon: BookOpen, hint: "Finance, ICompta, investissements", items: [
    { to: "/finance", label: "Finance", hint: "Comptes, flux, virements, rapprochement", perm: "accounting" },
    { to: "/icompta", label: "ICompta", hint: "Facturation, écritures, grand livre, clôture", perm: "finance" },
    { to: "/investissements", label: "Investissements", hint: "Projets, placements, scénarios", perm: "accounting" },
  ] },
  { id: "admin", label: "Administration", icon: Settings, hint: "Commerce, équipe, abonnement", items: [
    { to: "/reglages", label: "Réglages", hint: "Commerce, boutiques, équipe, abonnement", perm: "settings" },
  ] },
];

/** Formule : une entrée Pro absente de la formule n'est pas proposée (même règle qu'avant la refonte). */
export function planVisible(to: string, plan: string | undefined): boolean {
  return (to !== "/articles" || planAllows(plan, "articles")) && (to !== "/pilotage" || planAllows(plan, "proDashboard")) && (to !== "/caisse-pro" || planAllows(plan, "smartPosPro")) && (to !== "/depenses-pro" || planAllows(plan, "expensesPro")) && ((to !== "/caisse" && to !== "/ventes" && to !== "/depenses") || planAllows(plan, "smartPos"));
}

type Who = Parameters<typeof can>[0];
export const itemsOf = (space: Space, session: Who, plan: string | undefined) => space.items.filter((i) => can(session, i.perm) && planVisible(i.to, plan));
export const matchesItem = (i: NavItem, path: string) => [i.to, ...(i.also ?? [])].some((t) => path === t || path.startsWith(t + "/"));
export const spaceOfPath = (path: string) => SPACES.find((s) => s.items.some((i) => matchesItem(i, path)));

/* ---- Navigation plate du kit « 24 interfaces » (lot K1) : 17 modules aux noms du kit, dans l'ordre des maquettes.
 *  Chaque module pointe vers une page existante ; les sous-pages (also) restent ses onglets. Les espaces ci-dessus servent encore au téléphone (« Plus »), au fil d'Ariane et à la recherche. */
export type KitModule = NavItem & { id: string; icon: LucideIcon; /** paramètre ?onglet= qui distingue deux modules de la même page */ onglet?: string };
export const KIT_MODULES: KitModule[] = [
  { id: "dashboard", to: "/activite", label: "Tableau de bord", hint: "Indicateurs, ventes, alertes", perm: "reports", icon: LayoutDashboard },
  { id: "pos", to: "/pos", label: "Caisse (Ventes)", hint: "Encaisser, ventes, session de caisse", perm: "pos", also: ["/ventes", "/caisse", "/caisse-pro"], icon: CartI },
  { id: "articles", to: "/articles", label: "Articles & Catalogue", hint: "Catalogue, photos, prix, bundles", perm: "stock", also: ["/bundles", "/tableau"], icon: Package },
  { id: "stock", to: "/stock", label: "Stocks & Inventaires", hint: "Quantités, mouvements, transferts, alertes", perm: "stock", icon: BoxesI },
  { id: "count", to: "/inventaire", label: "Inventaires (Silent Count)", hint: "Comptage aveugle, écarts, validation", perm: "stock", icon: ClipboardCheck },
  { id: "purchases", to: "/achats", label: "Achats & Fournisseurs", hint: "Commandes, réceptions, factures", perm: "purchases", icon: Truck },
  { id: "expenses", to: "/depenses", label: "Dépenses", hint: "Dépenses, justificatifs, budgets", perm: "pos", also: ["/depenses-pro"], icon: Wallet },
  { id: "crm", to: "/clients", label: "Clients (CRM)", hint: "Clients, prospects, fidélité", perm: "customers", icon: Users },
  { id: "fini", to: "/finance", label: "Finance (FinI)", hint: "Trésorerie, flux, rapprochement", perm: "accounting", icon: Landmark },
  { id: "icompta", to: "/icompta", label: "ICompta", hint: "Écritures, grand livre, clôture", perm: "finance", also: ["/compta"], icon: Calculator },
  { id: "invest", to: "/investissements", label: "IProj-Invest", hint: "Projets, financements, scénarios", perm: "accounting", icon: Building2 },
  { id: "reports", to: "/pilotage", label: "Rapports & Analyses", hint: "Rentabilité, stocks, prévisions, exports", perm: "reports", icon: BarChart3 },
  { id: "master", to: "/master", label: "MASTER DOGUI", hint: "Rapports, recommandations, assistant, licence", perm: "settings", modal: true, icon: Brain },
  { id: "promo", to: "/promotions", label: "Promotions & Offres", hint: "Remises, coupons, résultats", perm: "stock", icon: Megaphone },
  { id: "team", to: "/reglages", onglet: "equipe", label: "Équipe & Permissions", hint: "Membres, rôles, accès, journal", perm: "settings", icon: UserCog },
  { id: "settings", to: "/reglages", label: "Paramètres", hint: "Commerce, boutiques, règles, paiements", perm: "settings", icon: SettingsI },
  { id: "billing", to: "/reglages", onglet: "abonnement", label: "Abonnement & Facturation", hint: "Formule, paiements, échéances", perm: "settings", icon: CreditCard },
];
export const moduleHref = (m: KitModule) => (m.onglet ? `${m.to}?onglet=${m.onglet}` : m.to);
/** Modules visibles pour ce profil et cette formule. Sans accès aux rapports, « Tableau de bord » mène à l'accueil (toujours accessible). */
export function kitModulesFor(session: Who, plan: string | undefined): KitModule[] {
  return KIT_MODULES.flatMap((m) => {
    if (m.id === "dashboard" && !can(session, "reports")) return [{ ...m, to: "/accueil", perm: "pos" as Perm, also: [] }].filter(() => !!session);
    return can(session, m.perm) && planVisible(m.to, plan) ? [m] : [];
  });
}
/** Module actif : chemin + onglet (Équipe et Abonnement partagent la page Réglages). */
export function activeModuleId(path: string, search: string): string | undefined {
  const onglet = new URLSearchParams(search).get("onglet") ?? "";
  if (path === "/accueil" || path.startsWith("/accueil/")) return "dashboard";
  if (path === "/reglages") return onglet === "equipe" ? "team" : onglet === "abonnement" ? "billing" : "settings";
  return KIT_MODULES.find((m) => !m.onglet && matchesItem(m, path))?.id;
}
