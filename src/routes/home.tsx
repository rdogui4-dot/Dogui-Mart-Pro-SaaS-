import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wallet, History, Tags, Layers, LayoutDashboard, Percent, LogOut, BookOpen, Boxes, Crown, Receipt, ScanLine, Settings, Users, AlertTriangle, TrendingUp, ShoppingBag, ShieldCheck, Banknote, PiggyBank, ClipboardList } from "lucide-react";
import { formatFcfa } from "@/domain/money";
import { isLow } from "@/domain/stock";
import { isVirtualBundle } from "@/domain/bundles";
import { Query } from "@/lib/appwrite";
import { list, qtyOf, variantQty } from "@/lib/data";
import { can, useSession, type Perm } from "@/lib/session";
import { planAllows } from "@/domain/features";
import { stateLabel } from "@/domain/reminders";
import { useSubscription } from "./subscription";
import { RejectedSales } from "@/components/RejectedSales";
import { MasterReminder } from "./master";
import { useProductsAll, useStockLevels, useVariantsAll } from "@/lib/queries";

type Sale = { total: number; status: string; soldAt: string };
const greeting = () => { const h = new Date().getHours(); return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir"; };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

const TILES: { to: string; label: string; hint: string; icon: typeof ScanLine; perm: Perm }[] = [
  { to: "/pos", label: "Caisse", hint: "Encaisser une vente", icon: ScanLine, perm: "pos" },
  { to: "/caisse", label: "Pilotage de caisse", hint: "Session, fond, écart, sorties", icon: Wallet, perm: "pos" },
  { to: "/caisse-pro", label: "Caisse Pro", hint: "Approbations, écarts, performance, droits", icon: ShieldCheck, perm: "pos" },
  { to: "/depenses", label: "Dépenses", hint: "Dépenses, justificatifs, sorties de caisse", icon: Banknote, perm: "pos" },
  { to: "/depenses-pro", label: "Dépenses Pro", hint: "Budgets, échéances, trésorerie, prévisions", icon: PiggyBank, perm: "pos" },
  { to: "/ventes", label: "Ventes", hint: "Historique, remboursements, tickets", icon: History, perm: "pos" },
  { to: "/articles", label: "Articles", hint: "Catalogue, photos & prix", icon: Tags, perm: "stock" },
  { to: "/promotions", label: "Promotions", hint: "Remises, codes & résultats", icon: Percent, perm: "stock" },
  { to: "/activite", label: "Tableau de bord", hint: "Ventes, marge, stock & alertes", icon: LayoutDashboard, perm: "reports" },
  { to: "/pilotage", label: "Pilotage Pro", hint: "Rentabilité, stocks, prévisions, exports", icon: TrendingUp, perm: "reports" },
  { to: "/tableau", label: "Alertes articles", hint: "Péremption, marges, meilleurs articles (Pro)", icon: AlertTriangle, perm: "stock" },
  { to: "/bundles", label: "Bundles", hint: "Packs d'articles à prix propre", icon: Layers, perm: "stock" },
  { to: "/stock", label: "Stock", hint: "Produits & mouvements", icon: Boxes, perm: "stock" },
  { to: "/inventaire", label: "Inventaire", hint: "Silent Count : comptage & écarts", icon: ClipboardList, perm: "stock" },
  { to: "/clients", label: "Clients", hint: "Fidélité & crédit", icon: Users, perm: "customers" },
  { to: "/achats", label: "Achats", hint: "Commandes & fournisseurs", icon: Receipt, perm: "purchases" },
  { to: "/finance", label: "Finance", hint: "Comptes, flux, virements, rapprochement", icon: Banknote, perm: "accounting" },
  { to: "/investissements", label: "Investissements", hint: "Projets, placements déclarés, scénarios", icon: TrendingUp, perm: "accounting" },
  { to: "/master", label: "MASTER DOGUI", hint: "Licence, essai gratuit, conditions", icon: ShieldCheck, perm: "settings" },
  { to: "/icompta", label: "ICompta", hint: "Facturation, écritures, grand livre, clôture", icon: BookOpen, perm: "finance" },
  { to: "/reglages", label: "Réglages", hint: "Commerce, équipe, abonnement", icon: Settings, perm: "settings" },
];

export function HomePage() {
  const { session } = useSession(); const s = session!;
  const sub = useSubscription();
  const sales = useQuery({ queryKey: ["home-sales", s.shopId], enabled: can(s, "pos"), queryFn: () => list<Sale>("sales", s, [Query.greaterThanEqual("soldAt", startOfToday())], 500) });
  const canStock = can(s, "stock"); const prodQ = useProductsAll(canStock); const varQ = useVariantsAll(canStock); const lvlQ = useStockLevels();
  const stock = { data: canStock && prodQ.data && varQ.data && lvlQ.data ? { products: prodQ.data, variants: varQ.data, levels: lvlQ.data } : undefined };
  const paid = (sales.data ?? []).filter((x) => x.status === "paid");
  const total = paid.reduce((a, x) => a + x.total, 0);
  const prods = (stock.data?.products ?? []).filter((p) => !p.archived);
  const lowNames = [
    ...prods.filter((p) => !p.hasVariants && !isVirtualBundle(p) && isLow(qtyOf(stock.data?.levels, p), p.minStock ?? 0)).map((p) => p.name),
    ...(stock.data?.variants ?? []).filter((v) => !v.archived).flatMap((v) => { const p = prods.find((x) => x.$id === v.productId); return p?.hasVariants && isLow(variantQty(stock.data?.levels, v, p.qtyScale ?? 0), v.minStock ?? 0) ? [`${p.name} — ${v.label}`] : []; }),
  ];
  const low = lowNames;
  const ent = sub.data?.entitlement;
  const visible = (to: string) => (to !== "/articles" || planAllows(ent?.plan.id, "articles")) && (to !== "/pilotage" || planAllows(ent?.plan.id, "proDashboard")) && (to !== "/caisse-pro" || planAllows(ent?.plan.id, "smartPosPro")) && (to !== "/depenses-pro" || planAllows(ent?.plan.id, "expensesPro")) && ((to !== "/caisse" && to !== "/ventes" && to !== "/depenses") || planAllows(ent?.plan.id, "smartPos")); // Articles : Business ou Pro uniquement
  const shopName = s.shops.find((x) => x.id === s.shopId)?.name;
  return (
    <div className="flex flex-col gap-4">
      <RejectedSales />
      <MasterReminder />
      <header>
        <p className="text-white/50 text-sm">{greeting()},</p>
        <h1 className="text-2xl font-bold">{s.name}</h1>
        {shopName && <p className="text-sm text-white/50">{shopName}</p>}
      </header>
      {ent?.lifetime && s.role === "owner" && <div className="card flex items-center gap-3"><Crown className="text-[var(--gold)]" /><div className="text-sm"><b>Accès à vie</b><br /><span className="text-white/50">Toutes les fonctions et les prochaines mises à jour sont incluses.</span></div></div>}
      {ent && !ent.lifetime && s.role === "owner" && (
        <Link to="/reglages" className="card flex items-center justify-between text-sm"><span><b>Abonnement {ent.plan.name}</b><br /><span className="text-white/50">{stateLabel[ent.state]}</span></span><span className="text-[var(--gold)]">Gérer ›</span></Link>
      )}
      {can(s, "pos") && (
        <div className="grid grid-cols-2 gap-3">
          <div className="kpi"><TrendingUp size={18} className="text-[var(--gold)]" /><b>{formatFcfa(total)}</b><span>Ventes du jour</span></div>
          <div className="kpi"><ShoppingBag size={18} className="text-[var(--gold)]" /><b>{paid.length}</b><span>Tickets</span></div>
        </div>
      )}
      {can(s, "stock") && low.length > 0 && (
        <Link to="/stock" className="card flex items-center gap-3 border-amber-400/30">
          <AlertTriangle className="text-amber-300 shrink-0" /><span className="text-sm"><b>{low.length} produit(s) à réapprovisionner</b><br /><span className="text-white/50">{low.slice(0, 3).join(", ")}{low.length > 3 ? "…" : ""}</span></span>
        </Link>
      )}
      <section aria-label="Modules" className="grid grid-cols-2 gap-3">
        {TILES.filter((t) => can(s, t.perm) && visible(t.to)).map(({ to, label, hint, icon: I }) => (
          <Link key={to} to={to} className="tile"><I size={26} /><b>{label}</b><span className="text-xs text-white/50">{hint}</span></Link>
        ))}
      </section>
    </div>
  );
}

/** « Plus » : tous les modules accessibles, le compte et la déconnexion. */
export function PlusPage() {
  const { session, logout } = useSession(); const s = session!;
  const plan = useSubscription().data?.entitlement.plan.id;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Plus</h1>
      <RejectedSales />
      <div className="card text-sm"><b>{s.name}</b><br /><span className="text-white/50">{s.role === "owner" ? "Gérant principal (propriétaire)" : s.role}</span></div>
      {TILES.filter((t) => can(s, t.perm) && (t.to !== "/articles" || planAllows(plan, "articles")) && (t.to !== "/pilotage" || planAllows(plan, "proDashboard")) && (t.to !== "/caisse-pro" || planAllows(plan, "smartPosPro")) && (t.to !== "/depenses-pro" || planAllows(plan, "expensesPro")) && ((t.to !== "/caisse" && t.to !== "/ventes" && t.to !== "/depenses") || planAllows(plan, "smartPos"))).map(({ to, label, hint, icon: I }) => (
        <Link key={to} to={to} className="card flex items-center gap-3"><I className="text-[var(--gold)]" /><span><b>{label}</b><br /><span className="text-xs text-white/50">{hint}</span></span></Link>
      ))}
      <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => void logout()}><LogOut size={18} />Se déconnecter</button>
    </div>
  );
}
