import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Crown, TrendingUp, AlertTriangle, ShoppingBag } from "lucide-react";
import { formatFcfa } from "@/domain/money";
import { isLow } from "@/domain/stock";
import { isVirtualBundle } from "@/domain/bundles";
import { Query } from "@/lib/appwrite";
import { list, qtyOf, variantQty } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { stateLabel } from "@/domain/reminders";
import { useSubscription } from "./subscription";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { SPACES, itemsOf } from "@/lib/nav";
import { useState } from "react";
import { RejectedSales } from "@/components/RejectedSales";
import { MasterBriefing, MasterReminder } from "./master";
import { useProductsAll, useStockLevels, useVariantsAll } from "@/lib/queries";

type Sale = { total: number; status: string; soldAt: string };
const greeting = () => { const h = new Date().getHours(); return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir"; };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };


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
  const shopName = s.shops.find((x) => x.id === s.shopId)?.name;
  return (
    <div className="flex flex-col gap-4">
      <RejectedSales />
      <MasterReminder />
      <MasterBriefing />
      <header>
        <p className="text-muted text-sm">{greeting()},</p>
        <h1 className="text-2xl font-bold">{s.name}</h1>
        {shopName && <p className="text-sm text-muted">{shopName}</p>}
      </header>
      {ent?.lifetime && s.role === "owner" && <div className="card flex items-center gap-3"><Crown className="text-accent-text" /><div className="text-sm"><b>Accès à vie</b><br /><span className="text-muted">Toutes les fonctions et les prochaines mises à jour sont incluses.</span></div></div>}
      {ent && !ent.lifetime && s.role === "owner" && (
        <Link to="/reglages" className="card flex items-center justify-between text-sm"><span><b>Abonnement {ent.plan.name}</b><br /><span className="text-muted">{stateLabel[ent.state]}</span></span><span className="text-accent-text">Gérer ›</span></Link>
      )}
      {can(s, "pos") && (
        <div className="grid grid-cols-2 gap-3">
          <div className="kpi"><TrendingUp size={18} className="text-accent-text" /><b>{formatFcfa(total)}</b><span>Ventes du jour</span></div>
          <div className="kpi"><ShoppingBag size={18} className="text-accent-text" /><b>{paid.length}</b><span>Tickets</span></div>
        </div>
      )}
      {can(s, "stock") && low.length > 0 && (
        <Link to="/stock" className="card flex items-center gap-3 border-warn/30">
          <AlertTriangle className="text-warn shrink-0" /><span className="text-sm"><b>{low.length} produit(s) à réapprovisionner</b><br /><span className="text-muted">{low.slice(0, 3).join(", ")}{low.length > 3 ? "…" : ""}</span></span>
        </Link>
      )}
      <section aria-label="Espaces" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SPACES.filter((sp) => itemsOf(sp, s, ent?.plan.id).length > 0).map((sp) => (
          <Link key={sp.id} to={`/espace/${sp.id}`} className="tile"><sp.icon size={22} /><b>{sp.label}</b><span className="text-sm text-muted">{itemsOf(sp, s, ent?.plan.id).map((i) => i.label).join(" · ")}</span></Link>
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
      <div className="card text-sm"><b>{s.name}</b><br /><span className="text-muted">{s.role === "owner" ? "Gérant principal (propriétaire)" : s.role}</span></div>
      {SPACES.map((sp) => { const its = itemsOf(sp, s, plan); if (!its.length) return null; return (
        <section key={sp.id} aria-label={sp.label} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide pt-2">{sp.label}</h2>
          {its.map(({ to, label, hint }) => <Link key={to} to={to} className="card flex items-center gap-3"><span><b>{label}</b><br /><span className="text-xs text-muted">{hint}</span></span></Link>)}
        </section>); })}
      <ThemeSwitch />
      <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => void logout()}><LogOut size={18} />Se déconnecter</button>
    </div>
  );
}

function ThemeSwitch() {
  const [t, set] = useState<Theme>(getTheme());
  const pick = (x: Theme) => { setTheme(x); set(x); };
  return (
    <div className="card flex items-center justify-between gap-3" role="group" aria-label="Thème d'affichage">
      <span className="text-sm font-medium">Affichage</span>
      <div className="flex gap-2">
        <button className="chip" aria-current={t === "light"} onClick={() => pick("light")}>Clair</button>
        <button className="chip" aria-current={t === "dark"} onClick={() => pick("dark")}>Sombre</button>
      </div>
    </div>
  );
}
