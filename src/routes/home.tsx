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
import { ItemLink } from "@/components/ItemLink";
import { startProgress, startSteps } from "@/domain/onboarding";
import { getShop } from "@/lib/data";
import { planAllows } from "@/domain/features";
import { Check, ChevronDown, Circle } from "lucide-react";
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
      <StartGuide />
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
  const { session, logout } = useSession(); const s = session!; const [open, setOpen] = useState<string[]>(["vendre"]);
  const plan = useSubscription().data?.entitlement.plan.id;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Plus</h1>
      <RejectedSales />
      <div className="card text-sm"><b>{s.name}</b><br /><span className="text-muted">{s.role === "owner" ? "Gérant principal (propriétaire)" : s.role}</span></div>
      {SPACES.map((sp) => { const its = itemsOf(sp, s, plan); if (!its.length) return null; const isOpen = open.includes(sp.id); const I = sp.icon; return (
        <section key={sp.id} aria-label={sp.label} className="card !p-0 overflow-hidden">
          <h2><button type="button" className="w-full flex items-center gap-3 px-4 py-3 min-h-12 text-left" aria-expanded={isOpen} aria-controls={`plus-${sp.id}`} onClick={() => setOpen(isOpen ? open.filter((x) => x !== sp.id) : [...open, sp.id])}>
            <I size={20} className="text-accent-text shrink-0" /><span className="flex-1"><b>{sp.label}</b><span className="block text-xs text-muted font-normal">{sp.hint}</span></span><ChevronDown size={18} className={`text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} /></button></h2>
          {isOpen && <div id={`plus-${sp.id}`} className="flex flex-col border-t border-line">{its.map((it) => <ItemLink key={it.to} item={it} className="d3-unfold-y flex items-center gap-3 w-full px-4 py-3 border-b border-line last:border-b-0 hover:bg-subtle" ><span><b>{it.label}</b><br /><span className="text-xs text-muted">{it.hint}</span></span></ItemLink>)}</div>}
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

const guideKey = (t: string) => `dmp.guide.hidden.${t}`;
const guideHidden = (t: string) => { try { return localStorage.getItem(guideKey(t)) === "1"; } catch { return false; } };

/** Guide de démarrage du propriétaire : l'état de chaque étape est déduit des données réelles ; masquable (par appareil) ; disparaît quand tout est fait. */
function StartGuide() {
  const { session } = useSession(); const s = session!; const sub = useSubscription();
  const owner = s.role === "owner" && !!s.shopId;
  const [hidden, setHidden] = useState(guideHidden(s.tenantId));
  const one = (table: string, extra: string[] = []) => list<{ role?: string }>(table, s, extra, 5);
  const q = useQuery({
    queryKey: ["start-guide", s.shopId], enabled: owner && !hidden, staleTime: 10_000,
    queryFn: async () => {
      const [shop, products, sessions, sales, staff] = await Promise.all([getShop(s), one("products"), one("cash_sessions").catch(() => []), one("sales"), one("staff").catch(() => [])]);
      return { shopDetails: !!(shop?.address || shop?.phone), articles: products.length, cashSessions: sessions.length, sales: sales.length, collaborators: staff.filter((x) => x.role !== "owner").length };
    },
  });
  // Stabilité de la mise en page (CLS) : pendant le chargement, la place de la carte est réservée, sauf si l'on sait déjà sur cet appareil que le guide est terminé.
  const doneKey = `dmp.guide.done.${s.tenantId}`; let knownDone = false; try { knownDone = localStorage.getItem(doneKey) === "1"; } catch { /* stockage indisponible */ }
  if (!owner || hidden) return null;
  if (!q.data) return knownDone ? null : <section className="card h-[27.5rem] bg-subtle animate-pulse" aria-busy="true" aria-label="Guide de démarrage (chargement)" />;
  const steps = startSteps({ ...q.data, cashSessionAvailable: planAllows(sub.data?.entitlement.plan.id, "smartPos") });
  const p = startProgress(steps);
  try { if (p.complete) localStorage.setItem(doneKey, "1"); else localStorage.removeItem(doneKey); } catch { /* préférence non mémorisée */ }
  if (p.complete) return null;
  return (
    <section className="card flex flex-col gap-3" aria-label="Guide de démarrage">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="font-bold">Bien démarrer</h2><p className="text-sm text-muted">{p.done} étape{p.done > 1 ? "s" : ""} sur {p.total} terminée{p.done > 1 ? "s" : ""}</p></div>
        <button className="text-sm text-muted underline" onClick={() => { try { localStorage.setItem(guideKey(s.tenantId), "1"); } catch { /* préférence non mémorisée */ } setHidden(true); }}>Masquer</button>
      </div>
      <div className="h-1.5 rounded bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Progression du démarrage"><div className="h-1.5 rounded bg-accent" style={{ width: `${(p.done / p.total) * 100}%` }} /></div>
      <ul className="flex flex-col">{steps.map((st) => (
        <li key={st.id}><Link to={st.to} className="flex items-center gap-3 py-2.5 border-t border-line first:border-t-0">
          {st.done ? <Check size={18} className="text-ok shrink-0" aria-label="Terminé" /> : <Circle size={18} className="text-muted shrink-0" aria-label="À faire" />}
          <span className={st.done ? "text-muted" : ""}><b className={st.done ? "font-medium line-through" : ""}>{st.label}</b><br /><span className="text-xs text-muted">{st.hint}</span></span>
        </Link></li>))}
      </ul>
    </section>
  );
}
