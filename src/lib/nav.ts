/** Architecture de navigation : six espaces regroupant les modules existants (les adresses actuelles restent valides). */
import { BookOpen, Boxes, Settings, ShoppingCart, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
import { can, type Perm } from "@/lib/session";
import { planAllows } from "@/domain/features";

export type NavItem = { to: string; label: string; hint: string; perm: Perm };
export type Space = { id: string; label: string; icon: LucideIcon; hint: string; items: NavItem[] };

export const SPACES: Space[] = [
  { id: "vendre", label: "Vendre", icon: ShoppingCart, hint: "Caisse, ventes, clients, promotions", items: [
    { to: "/pos", label: "Caisse", hint: "Encaisser une vente", perm: "pos" },
    { to: "/ventes", label: "Ventes", hint: "Historique, remboursements, tickets", perm: "pos" },
    { to: "/caisse", label: "Session de caisse", hint: "Fond, écart, sorties", perm: "pos" },
    { to: "/caisse-pro", label: "Caisse Pro", hint: "Approbations, écarts, performance, droits", perm: "pos" },
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
    { to: "/depenses", label: "Dépenses", hint: "Dépenses, justificatifs, sorties de caisse", perm: "pos" },
    { to: "/depenses-pro", label: "Dépenses Pro", hint: "Budgets, échéances, trésorerie, prévisions", perm: "pos" },
  ] },
  { id: "piloter", label: "Piloter", icon: TrendingUp, hint: "Tableaux de bord et MASTER DOGUI", items: [
    { to: "/activite", label: "Tableau de bord", hint: "Ventes, marge, stock et alertes", perm: "reports" },
    { to: "/pilotage", label: "Pilotage Pro", hint: "Rentabilité, stocks, prévisions, exports", perm: "reports" },
    { to: "/master", label: "MASTER DOGUI", hint: "Rapports, recommandations, assistant, licence", perm: "settings" },
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
export const spaceOfPath = (path: string) => SPACES.find((s) => s.items.some((i) => path === i.to || path.startsWith(i.to + "/")));
