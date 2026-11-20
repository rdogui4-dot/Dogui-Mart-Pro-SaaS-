import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Info, Users, RotateCcw, AlertTriangle, Boxes, ClipboardList, Lock, Plus, Receipt, RefreshCw, ScanLine, Tags, WifiOff, FileBarChart, ShoppingCart, Coins, Package, ShoppingBasket, Truck, UserPlus, BarChart3, ChevronRight, ArrowDownToLine, PackagePlus, PieChart, Trophy, Activity, LineChart as LineIcon, Send, TrendingUp, LayoutDashboard, type LucideIcon } from "lucide-react";
import { useMasterModal } from "@/lib/master-modal";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { BarChart, Donut, HBars, LineChart, MultiLine } from "@/components/charts";
import { hasWebGL, tiltHandlers, useFxLevel } from "@/lib/fx3d";
import { lazy, Suspense, useMemo } from "react";
const Chart3D = lazy(() => import("@/components/Chart3D"));
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { PRESETS, type PresetId } from "@/domain/overview";
import type { TrendRange } from "@/domain/overview-compare";
import { PillTabs, type PillTab } from "@/components/kit";
import { useSubscription } from "./subscription";
import { ProfitTab } from "./profit-tab";

type Daily = { date: string; revenue: number; count: number };
type Margin = { known: boolean; amount: number | null; pct: number | null; linesWithoutCost: number; coveragePct: number; indicative: number };
type Overview = {
  tz: string; asOf: string; today: string; scope: { shopId: string; shops: { id: string; name: string }[]; many: boolean }; period: { preset: PresetId; label: string; from: string; to: string; days: number };
  kpis: { compare: { today: { prevRevenue: number; deltaPct: number | null }; month: { prevFrom: string; prevTo: string; prevRevenue: number; deltaPct: number | null }; basket: { prevFrom: string; prevTo: string; prevAvg: number; deltaPct: number | null }; period: { deltaPct: number | null } } | null; customers: { active30: number; prev30: number | null; deltaPct: number | null; note: string }; today: { revenue: number; count: number }; month: { from: string; to: string; revenue: number; count: number }; period: { count: number; revenue: number; avgBasket: number; encaisse: number; credit: number; purchases: number; margin: Margin; refunds: { amount: number; count: number } };
    stock: { articles: number; value: number | null; methodLabel: string; partial: boolean; low: number | null; out: number | null } };
  charts: { trend: Record<TrendRange, { current: Daily[]; previous: { date: string; revenue: number }[]; currentSpan: { from: string; to: string }; previousSpan: { from: string; to: string } | null }>; last7: Daily[]; series: Daily[]; byMethod: { method: string; amount: number }[]; top: { key: string; name: string; qty: number; revenue: number }[]; byCategory: { category: string; revenue: number; qty: number }[]; byShop: { id: string; name: string; revenue: number; count: number }[] };
  activity: { sales: { id: string; number: string; total: number; at: string; shop: string; methods: string[]; lines: { name: string; qty: number; amount: number }[] }[]; purchases: { id: string; number: string; supplier: string; total: number; status: string; at: string }[];
    moves: { id: string; name: string; label: string; qty: number; at: string; shop: string }[]; created: { id: string; name: string; price: number; at: string }[]; important: { id: string; name: string; label: string; qty: number; at: string }[] };
  alerts: { id: string; type: string; severity: "critical" | "warning" | "info"; label: string; detail: string; count: number; link: string }[]; truncated: { sales: boolean }; notes: string[];
};
const METHOD: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte", credit: "À crédit" };
const TREND_LABEL: Record<TrendRange, string> = { "7": "7 derniers jours", "30": "30 derniers jours", month: "mois en cours" };
const PO: Record<string, string> = { ordered: "Commandé", partial: "Partiel", received: "Reçu", cancelled: "Annulé" };
const dt = (iso: string, tz: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dd = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
const TONE = { critical: "border-bad/40 text-bad", warning: "border-warn/40 text-warn", info: "border-info/30 text-info" } as const;

function Skeleton() { return <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Chargement">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card h-20 animate-pulse bg-subtle" />)}</div>; }
const TINT = { green: "bg-[var(--tint-green-bg)] text-[var(--tint-green)]", blue: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue)]", amber: "bg-[var(--tint-amber-bg)] text-[var(--tint-amber)]", violet: "bg-[var(--tint-violet-bg)] text-[var(--tint-violet)]", cyan: "bg-[var(--tint-cyan-bg)] text-[var(--tint-cyan)]", rose: "bg-[var(--tint-rose-bg)] text-[var(--tint-rose)]" } as const;
type TintK = keyof typeof TINT;
function Kpi({ label, value, sub, to, tone, def, i = 0, icon, tint = "blue", delta, vs }: { label: string; value: string; sub: string; to?: string; tone?: string; def?: string; i?: number; icon?: LucideIcon; tint?: TintK; /** écart réel en % ; absent si la période de comparaison est nulle */ delta?: number | null; vs?: string }) {
  const [flip, setFlip] = useState(false);
  const front = <span className="flex items-center gap-3 min-w-0">
    {icon && <span aria-hidden="true" className={`shrink-0 size-11 rounded-full flex items-center justify-center ${TINT[tint]}`}>{(() => { const I = icon; return <I size={22} />; })()}</span>}
    <span className="min-w-0 flex flex-col"><span className="text-muted text-[0.8125rem] leading-4 pr-8">{label}</span><span className={`font-bold ${icon ? "text-xl" : "text-lg"} leading-tight text-brand whitespace-nowrap ${tone ?? ""}`}>{value}</span><span className="text-xs text-muted leading-snug">{sub}</span>{delta != null && <span className={`text-xs font-semibold inline-flex items-center gap-0.5 ${delta >= 0 ? "text-ok" : "text-bad"}`} aria-label={`${delta >= 0 ? "Hausse" : "Baisse"} de ${Math.abs(delta).toLocaleString("fr-FR")} % ${vs ?? ""}`}>{delta >= 0 ? "▲" : "▼"} {delta >= 0 ? "+" : ""}{delta.toLocaleString("fr-FR")} % <span className="font-normal text-muted">{vs}</span></span>}</span></span>;
  return (
    <div className="d3-flip d3-in relative h-full" style={{ ["--i" as string]: i }} data-flipped={flip} {...tiltHandlers(3)}>
      <div className="d3-flip-inner h-full">
        <div className="d3-flip-front" aria-hidden={flip}>{to ? <Link to={to} className="card d3-card block h-full" tabIndex={flip ? -1 : undefined}>{front}</Link> : <div className="card d3-card h-full">{front}</div>}</div>
        {def && <div className="d3-flip-back card d3-card h-full flex flex-col gap-1" aria-hidden={!flip}><div className="text-xs font-semibold pr-8">{label} : définition</div><p className="text-xs text-soft leading-snug">{def}</p><p className="text-[0.7rem] text-muted mt-auto">Source : opérations enregistrées dans l'application.</p></div>}
      </div>
      {def && <button type="button" className="absolute top-1.5 right-1.5 z-10 rounded-full p-1.5 text-muted hover:text-main hover:bg-subtle" aria-label={flip ? `Revenir à la valeur : ${label}` : `Définition : ${label}`} aria-pressed={flip} onClick={() => setFlip(!flip)}>{flip ? <RotateCcw size={15} /> : <Info size={15} />}</button>}
    </div>
  );
}
/** Dépenses validées de la période (module Dépenses) : affiché seulement si l'abonnement et les droits le permettent ; jamais mélangé au chiffre d'affaires ni à la marge. */
function ExpenseKpi({ from, to, label }: { from: string; to: string; label: string }) {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["expense-kpi", s.shopId, from, to], retry: 0, staleTime: 60_000, queryFn: () => api<{ totals: { period: number; count: number }; pending: { count: number; amount: number } }>(s, "expense.report", { from, to }) });
  if (!q.data) return null; const t = q.data;
  return <Kpi label="Dépenses validées" value={formatFcfa(t.totals.period)} sub={`${label} · ${t.totals.count} dépense(s)${t.pending.count ? ` · ${t.pending.count} en attente (${formatFcfa(t.pending.amount)})` : ""}`} to="/depenses" tone={t.pending.count ? "text-warn" : ""} />;
}
const Section = ({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string }) => <section className="card flex flex-col gap-2"><h2 className="font-semibold text-sm">{title}</h2>{empty ? <p className="text-sm text-muted">{empty}</p> : children}</section>;

const QUICK = [
  { to: "/pos", l: "Nouvelle vente", h: "Ouvrir la caisse", i: ShoppingCart, t: "green", p: "pos", pro: false },
  { to: "/articles", l: "Ajouter un article", h: "Au catalogue", i: PackagePlus, t: "blue", p: "stock", pro: false },
  { to: "/achats", l: "Passer une commande", h: "Auprès d'un fournisseur", i: Truck, t: "amber", p: "purchases", pro: false },
  { to: "/clients", l: "Ajouter un client", h: "Dans le CRM", i: UserPlus, t: "violet", p: "customers", pro: false },
  { to: "/pilotage", l: "Voir les rapports", h: "Analyses et exports", i: BarChart3, t: "cyan", p: "reports", pro: true },
] as const;
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); if (m < 1) return "à l'instant"; if (m < 60) return `il y a ${m} min`; const h = Math.round(m / 60); if (h < 24) return `il y a ${h} h`; const j = Math.round(h / 24); return `il y a ${j} j`; };
/** Activités récentes : fusion, par date, des ventes, achats, mouvements de stock et nouveaux articles réellement enregistrés (données du serveur, rien d'estimé). */
function RecentFeed({ d, onAll, onSale }: { d: Overview; tz: string; onAll: () => void; onSale: (id: string) => void }) {
  type It = { id: string; at: string; icon: LucideIcon; tint: TintK; text: string; amount?: number; sale?: string };
  const all: It[] = [
    ...d.activity.sales.map((x) => ({ id: "s" + x.id, at: x.at, icon: ShoppingCart, tint: "green" as TintK, text: `Vente ${x.number}`, amount: x.total, sale: x.id })),
    ...d.activity.purchases.map((x) => ({ id: "p" + x.id, at: x.at, icon: Truck, tint: "amber" as TintK, text: `Achat ${x.number} · ${x.supplier}`, amount: x.total })),
    ...d.activity.moves.filter((x) => !/vente/i.test(x.label)).map((x) => ({ id: "m" + x.id, at: x.at, icon: ArrowDownToLine, tint: "blue" as TintK, text: `${x.label} · ${x.name} (${x.qty})` })),
    ...d.activity.created.map((x) => ({ id: "c" + x.id, at: x.at, icon: PackagePlus, tint: "violet" as TintK, text: `Nouvel article : ${x.name}` })),
  ];
  const items = all.sort((a, b) => (Date.parse(b.at) - Date.parse(a.at)) || (a.sale ? -1 : 0) - (b.sale ? -1 : 0)).slice(0, 5); // les sorties de stock des ventes ne sont pas répétées : la vente est déjà listée
  return (
    <section aria-label="Activités récentes" className="card flex flex-col gap-2 min-w-0 md:col-span-2 xl:col-span-1">
      <div className="flex items-center gap-2"><h2 className="font-bold text-brand inline-flex items-center gap-2 flex-1"><Activity size={20} className="text-[var(--tint-violet)]" aria-hidden="true" />Activités récentes</h2><button type="button" className="text-sm font-semibold text-accent-text underline" onClick={onAll}>Tout voir</button></div>
      {items.length ? <ul className="flex flex-col">{items.map((x) => { const I = x.icon; const body = <><span aria-hidden="true" className={`size-8 shrink-0 rounded-lg flex items-center justify-center ${TINT[x.tint]}`}><I size={16} /></span><span className="min-w-0 flex-1 text-sm truncate">{x.text}</span>{x.amount !== undefined && <b className="text-sm tabular-nums whitespace-nowrap">{formatFcfa(x.amount)}</b>}<span className="text-xs text-muted whitespace-nowrap">{ago(x.at)}</span></>;
        return <li key={x.id} className="border-t border-line first:border-0">{x.sale ? <button type="button" className="w-full flex items-center gap-2.5 py-2 text-left hover:bg-subtle rounded" onClick={() => onSale(x.sale!)}>{body}</button> : <div className="flex items-center gap-2.5 py-2">{body}</div>}</li>; })}</ul>
        : <p className="text-sm text-muted">Aucune opération récente.</p>}
    </section>
  );
}
type MdLic = { state: "none" | "trial" | "active" | "grace" | "expired"; canAnalyze: boolean; canStartTrial: boolean; daysLeft: number | null };
/** Encart MASTER DOGUI : état réel de la licence et du mode de réponse (guidé ou IA). La question est préparée ici et envoyée par l'utilisateur dans l'assistant ; aucune réponse n'est simulée. */
function DashMaster() {
  const { session } = useSession(); const s = session!; const m = useMasterModal(); const [text, setText] = useState("");
  const owner = s.role === "owner";
  const lic = useQuery({ queryKey: ["md", "license", s.tenantId], enabled: owner, retry: 0, staleTime: 5 * 60_000, queryFn: () => api<MdLic>(s, "md.license", {}) });
  const chat = useQuery({ queryKey: ["md", "chat", s.tenantId], enabled: owner && !!lic.data?.canAnalyze, retry: 0, staleTime: 5 * 60_000, queryFn: () => api<{ mode: { ai: boolean; label: string } }>(s, "md.chat.list", {}) });
  if (!owner) return null;
  const sym = `url(${import.meta.env.BASE_URL}master-symbol.svg)`;
  const ask = (q: string) => { try { localStorage.setItem("md-chat-draft", q); } catch { /* confort seulement */ } m.open("chat"); };
  const l = lic.data; const st = l ? { none: "Licence non démarrée", trial: `Essai en cours${l.daysLeft !== null ? ` · ${l.daysLeft} j restants` : ""}`, active: "Licence active", grace: "Délai de grâce", expired: "Licence expirée · consultation seule" }[l.state] : "";
  return (
    <section aria-label="MASTER DOGUI" className="rounded-2xl p-5 flex flex-col gap-3 text-white bg-[linear-gradient(135deg,#10243a_0%,#16345a_60%,#1d4a7a_100%)] shadow-[var(--shadow-card)] min-w-0">
      <div className="flex items-center gap-3"><span aria-hidden="true" className="size-10 shrink-0 bg-[var(--gold)]" style={{ WebkitMaskImage: sym, maskImage: sym, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }} />
        <div><h2 className="text-xl font-bold leading-tight">MASTER DOGUI</h2>{l && <p className="text-xs text-[#c9d6e6] flex items-center gap-1.5"><span aria-hidden="true" className={`size-2 rounded-full ${l.canAnalyze ? "bg-[#4ade9a]" : "bg-[#f5b73b]"}`} />{st}{chat.data ? ` · ${chat.data.mode.label.split(":")[0]}` : ""}</p>}</div></div>
      <p className="text-sm text-[#dbe5f0]">Votre assistant de gestion : il répond à partir des données réelles de votre commerce, avec ses sources et ses limites.</p>
      {lic.isLoading ? <span className="h-11 rounded-xl bg-white/10 animate-pulse" aria-busy="true" aria-label="Chargement de la licence" />
        : l?.canAnalyze ? <>
          <form className="flex items-center gap-2 rounded-xl bg-white p-1.5 pl-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) ask(text.trim()); }}>
            <label className="sr-only" htmlFor="dash-md-q">Question pour MASTER DOGUI</label>
            <input id="dash-md-q" className="flex-1 min-w-0 bg-transparent text-[#172334] placeholder:text-[#5f6e82] outline-none text-sm py-1.5" placeholder="Posez une question à MASTER DOGUI…" value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn-gold !min-h-9 !px-3" aria-label="Préparer la question dans l'assistant" disabled={!text.trim()}><Send size={16} /></button>
          </form>
          <div className="flex flex-wrap gap-2">{[["Analyser mes ventes", "Comment évoluent mes ventes ?"], ["Optimiser mon stock", "Quels articles dois-je réapprovisionner ?"], ["Suivre ma trésorerie", "Quelle est ma situation de trésorerie ?"]].map(([lbl, q]) => <button key={lbl} type="button" className="text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 px-3 min-h-9" onClick={() => ask(q!)}>{lbl}</button>)}</div>
          <p className="text-[0.7rem] text-[#c9d6e6]">La question s'ouvre dans l'assistant : vous l'envoyez vous-même.</p></>
        : <button type="button" className="btn-gold self-start" onClick={() => m.open("lic")}>{l?.canStartTrial ? "Démarrer l'essai gratuit" : "Voir la licence"}</button>}
    </section>
  );
}

/** Tableau de bord de l'activité (Business) : tout vient d'une seule action serveur (`dashboard.business`) calculée sur les ventes, achats, stock et mouvements réellement enregistrés. */
export function ActivitePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { session } = useSession(); const s = session!; const sub = useSubscription(); const allowed = planAllows(sub.data?.entitlement.plan.id, "businessDashboard");
  const [preset, setPreset] = useState<PresetId>("last30"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [shop, setShop] = useState(s.shopId); const [tab, setTab] = useState<"sales" | "purchases" | "moves" | "created" | "important">("sales"); const [open, setOpen] = useState<string | null>(null); const [allAct, setAllAct] = useState(false);
  const [view, setView] = useState<"overview" | "profit">("overview"); const canProfit = !embedded && (s.role === "owner" || s.role === "manager"); // bénéfice brut : propriétaire et gérant, toutes les formules
  const pf = { preset, setPreset, from, setFrom, to, setTo, shop, setShop }; const viewTabs: PillTab<"overview" | "profit">[] = [{ key: "overview", label: "Vue d'ensemble", icon: LayoutDashboard }, { key: "profit", label: "Bénéfice brut", icon: TrendingUp }];
  useEffect(() => { if (open) setAllAct(false); }, [open]); // une seule fenêtre à la fois : le détail d'une vente remplace la liste
  const custom = preset === "custom"; const ready = !custom || (!!from && !!to && from <= to);
  const q = useQuery({ queryKey: ["overview", s.shopId, preset, custom ? from : "", custom ? to : "", shop], enabled: allowed && ready, placeholderData: keepPreviousData, retry: 1, queryFn: () => api<Overview>(s, "dashboard.business", { preset, ...(custom ? { from, to } : {}), shopId: shop }) });
  const fx = useFxLevel(); const use3d = fx !== "flat" && hasWebGL();
  const [wideChart, setWideChart] = useState(() => typeof matchMedia === "function" && matchMedia("(min-width: 768px)").matches);
  useEffect(() => { if (typeof matchMedia !== "function") return; const m = matchMedia("(min-width: 768px)"); const f = () => setWideChart(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []); // courbe en bandeau sur grand écran, proportions classiques sur téléphone
  const last7 = useMemo(() => (q.data?.charts.last7 ?? []).map((x) => ({ key: x.date, label: dd(x.date), value: x.revenue, sub: `${x.count} vente(s)` })), [q.data]);
  if (!allowed) return (
    <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Tableau de bord</h1>
      {canProfit && <PillTabs idBase="tdb" label="Sections du tableau de bord" value={view} onChange={setView} items={viewTabs} />}
      {canProfit && view === "profit" ? <ProfitTab f={pf} /> : <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Business</span><span className="text-muted">Chiffre d'affaires, marge, stock, graphiques et alertes sur vos données réelles.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div>}</div>
  );
  const proOn = planAllows(sub.data?.entitlement.plan.id, "proDashboard"); const d = q.data; const tz = d?.tz ?? "UTC"; const offline = typeof navigator !== "undefined" && !navigator.onLine; const k = d?.kpis; const per = k?.period;
  const [trendRange, setTrendRange] = useState<TrendRange>("30"); const trend = d?.charts.trend?.[trendRange];
  const periodTxt = d ? (d.period.from === d.period.to ? dd(d.period.from) : `${dd(d.period.from)} → ${dd(d.period.to)}`) : "";
  const sale = d?.activity.sales.find((x) => x.id === open);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">{embedded ? <h2 className="text-lg font-semibold">Activité (essentiel)</h2> : <><p className="text-soft text-sm">Bonjour, {(s.name || "").split(" ")[0]}</p><h1 className="text-2xl md:text-[1.75rem] font-bold text-brand leading-tight">Tableau de bord</h1></>}
          <p className="text-xs text-muted mt-0.5">{d ? `Mis à jour à ${new Date(d.asOf).toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })} · jours en heure de l'entreprise (${tz})` : "Chargement des données réelles…"}</p></div>
        <button className="btn-ghost !px-3 !py-2 flex items-center gap-1 text-sm" aria-label="Actualiser" onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw size={16} className={q.isFetching ? "animate-spin" : ""} />Actualiser</button></div>
      {proOn && !embedded && <Link to="/pilotage" className="card !py-3 flex items-center justify-between text-sm border border-accent/40"><span><b>Tableau de bord Pro</b> <span className="text-muted text-xs">· rentabilité, stocks, achats, magasins, prévisions, exports</span></span><span className="text-accent-text font-semibold inline-flex items-center">Ouvrir<ChevronRight size={16} /></span></Link>}
      {canProfit && <PillTabs idBase="tdb" label="Sections du tableau de bord" value={view} onChange={setView} items={viewTabs} />}
      {view === "profit" && canProfit ? <ProfitTab f={pf} /> : <>
      <nav aria-label="Période" className="scroll-x">{PRESETS.map((p) => <button key={p.id} className="chip" aria-current={preset === p.id} onClick={() => setPreset(p.id)}>{p.label}</button>)}</nav>
      {custom && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted">Du<input className="input mt-1" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-muted">Au<input className="input mt-1" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>{!ready && <p className="col-span-2 text-xs text-muted">Choisissez deux dates (92 jours au plus).</p>}</div>}
      {d?.scope.many && <label className="text-xs text-muted flex flex-col gap-1">Boutique<select className="input" value={shop} onChange={(e) => setShop(e.target.value)}>{d.scope.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="all">Toutes mes boutiques</option></select></label>}
      {(offline || q.error) && <div className="card border border-warn/40 text-sm flex gap-2 items-start" role="alert"><WifiOff size={16} className="text-warn shrink-0 mt-0.5" /><span>{offline ? "Vous êtes hors ligne : le tableau de bord a besoin d'une connexion." : `Impossible de charger les données : ${(q.error as Error).message}`}{d ? " Les chiffres affichés datent de la dernière actualisation réussie." : ""} <button className="underline text-accent-text" onClick={() => void q.refetch()}>Réessayer</button></span></div>}
      {q.isLoading && ready && <Skeleton />}
      {d && k && per && <>
        {d.truncated.sales && <div className="card text-sm text-warn flex gap-2"><AlertTriangle size={16} />Volume de ventes très élevé : certaines ventes de la période n'ont pas été lues, les totaux peuvent être partiels.</div>}
        <section aria-label="Indicateurs" className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 ${q.isFetching ? "opacity-70" : ""}`}>
          <Kpi icon={ShoppingCart} tint="green" i={0} def={d.notes[0]} label="CA du jour" value={formatFcfa(k.today.revenue)} sub={`${dd(d.today)} · ventes terminées TTC`} delta={k.compare?.today.deltaPct} vs="vs hier à la même heure" />
          <Kpi icon={Coins} tint="blue" i={1} def={d.notes[0]} label="CA du mois" value={formatFcfa(k.month.revenue)} sub={`${dd(k.month.from)} → ${dd(k.month.to)} · ventes terminées TTC`} delta={k.compare?.month.deltaPct} vs={k.compare ? `vs ${dd(k.compare.month.prevFrom)} → ${dd(k.compare.month.prevTo)}` : undefined} />
          <Kpi icon={Users} tint="amber" i={2} def={k.customers.note} label="Clients actifs" value={String(k.customers.active30)} sub="30 derniers jours · avec fiche client" to={can(s, "customers") ? "/crm" : undefined} delta={k.customers.deltaPct} vs="vs 30 jours précédents" />
          <Kpi icon={ShoppingBasket} tint="violet" i={3} label="Panier moyen" value={formatFcfa(per.avgBasket)} sub={`${periodTxt} · CA ÷ ventes`} delta={k.compare?.basket.deltaPct} vs={k.compare ? `vs ${dd(k.compare.basket.prevFrom)} → ${dd(k.compare.basket.prevTo)}` : undefined} />
        </section>
        <div className="grid xl:grid-cols-3 gap-4 items-start">
          <section aria-label="Évolution des ventes" className="card flex flex-col gap-2 xl:col-span-2 min-w-0">
            <div className="flex items-start gap-2 flex-wrap"><LineIcon size={22} className="text-accent shrink-0 mt-0.5" aria-hidden="true" /><div className="min-w-0 flex-1"><h2 className="font-bold text-brand">Évolution des ventes</h2><p className="text-xs text-muted">Chiffre d'affaires TTC · {TREND_LABEL[trendRange]}{trend ? ` (${dd(trend.currentSpan.from)} → ${dd(trend.currentSpan.to)})` : ""}{trend?.previousSpan ? ` · en pointillé : ${dd(trend.previousSpan.from)} → ${dd(trend.previousSpan.to)}` : ""}</p></div>
              <div role="group" aria-label="Période de la courbe" className="flex gap-1">{(Object.keys(TREND_LABEL) as TrendRange[]).map((r) => <button key={r} type="button" className="chip !min-h-8 !py-1 !px-3 text-sm" aria-pressed={trendRange === r} onClick={() => setTrendRange(r)}>{r === "7" ? "7 jours" : r === "30" ? "30 jours" : "Mois en cours"}</button>)}</div></div>
            {trend && trend.current.some((x) => x.count > 0) ? <MultiLine w={wideChart ? 760 : 320} label="Chiffre d'affaires de la période, comparé à la période précédente" labels={trend.current.map((x) => dd(x.date))}
              series={[{ name: "Période", values: trend.current.map((x) => x.revenue) }, ...(trend.previousSpan && trend.previous.some((x) => x.revenue > 0) ? [{ name: "Période précédente", values: trend.current.map((_, i) => trend.previous[i]?.revenue ?? null), dashed: true }] : [])]} /> : <p className="text-sm text-muted py-6 text-center">Aucune vente sur cette période.</p>}
          </section>
          {!embedded && <DashMaster />}
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          <section aria-label="Répartition du chiffre d'affaires" className="card flex flex-col gap-2 min-w-0"><h2 className="font-bold text-brand inline-flex items-center gap-2"><PieChart size={20} className="text-accent" aria-hidden="true" />Répartition du chiffre d'affaires</h2><p className="text-xs text-muted -mt-1">Par mode de paiement · {periodTxt}</p>
            {d.charts.byMethod.length ? <Donut label="Répartition par mode de paiement" data={d.charts.byMethod.map((x) => ({ key: x.method, label: METHOD[x.method] ?? x.method, value: x.amount }))} /> : <p className="text-sm text-muted">Aucun paiement sur la période.</p>}</section>
          <section aria-label="Top 5 des articles vendus" className="card flex flex-col gap-2 min-w-0"><h2 className="font-bold text-brand inline-flex items-center gap-2"><Trophy size={20} className="text-gold-text" aria-hidden="true" />Top 5 des articles vendus</h2><p className="text-xs text-muted -mt-1">{periodTxt}</p>
            {d.charts.top.length ? <ol className="flex flex-col">{d.charts.top.slice(0, 5).map((x, i) => <li key={x.key} className="flex items-center gap-3 py-2 border-t border-line first:border-0"><span aria-hidden="true" className={`size-7 shrink-0 rounded-full text-sm font-bold flex items-center justify-center ${i === 0 ? "bg-[var(--gold-soft)] text-gold-text" : "bg-subtle text-soft"}`}>{i + 1}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{x.name}</b><span className="text-xs text-muted">{x.qty} vendu(s)</span></span><b className="text-sm tabular-nums whitespace-nowrap">{formatFcfa(x.revenue)}</b></li>)}</ol> : <p className="text-sm text-muted">Aucun article vendu sur la période.</p>}</section>
          <RecentFeed d={d} tz={tz} onAll={() => setAllAct(true)} onSale={(id) => setOpen(id)} />
        </div>
        <section aria-label="Raccourcis" className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">{QUICK.filter((x) => can(s, x.p) && (!x.pro || proOn)).map(({ to, l, h, i: I, t }) => <Link key={l} to={to} className="card d3-card !p-3.5 flex items-center gap-3 hover:bg-subtle"><span aria-hidden="true" className={`size-11 shrink-0 rounded-full flex items-center justify-center ${TINT[t]}`}><I size={22} /></span><span className="min-w-0 flex-1"><b className="block text-sm">{l}</b><span className="text-xs text-muted">{h}</span></span><ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" /></Link>)}</section>
        <section aria-label="Indicateurs détaillés" className="flex flex-col gap-2"><h2 className="font-bold text-brand">Indicateurs détaillés</h2>
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <Kpi i={2} label="Articles actifs" value={String(k.stock.articles)} sub="À l'instant · non archivés" to="/articles" />
          <Kpi i={2} label="Ventes réalisées" value={String(per.count)} sub={`${periodTxt} · tickets terminés`} />
          <Kpi i={4} def={d.notes[1]} label="Encaissé" value={formatFcfa(per.encaisse)} sub={`${periodTxt} · hors crédit, monnaie exclue`} />
          <Kpi i={5} def={d.notes[2]} label="Remboursements" value={formatFcfa(per.refunds.amount)} sub={`${periodTxt} · ${per.refunds.count} opération(s) · CA net ${formatFcfa(per.revenue - per.refunds.amount)}`} tone={per.refunds.amount ? "text-warn" : ""} />
          <Kpi i={6} def={d.notes[1]} label="Vendu à crédit" value={formatFcfa(per.credit)} sub={`${periodTxt} · non encaissé`} tone={per.credit ? "text-warn" : ""} />
          <ExpenseKpi from={d.period.from} to={d.period.to} label={periodTxt} />
          <Kpi i={8} label="Achats enregistrés" value={formatFcfa(per.purchases)} sub={`${periodTxt} · HT, factures fournisseurs`} to="/achats" />
          <Kpi i={9} def={d.notes[4]} label="Marge brute" value={per.margin.known ? formatFcfa(per.margin.amount!) : "Non calculable"} sub={per.margin.known ? `${periodTxt} · ${per.margin.pct} % du CA HT − coût de revient` : per.count ? `Coût manquant sur ${per.margin.linesWithoutCost} ligne(s) (${per.margin.coveragePct} % du CA couvert)` : `${periodTxt} · aucune vente`} />
          <Kpi label="Valeur du stock" value={k.stock.value === null ? "Non calculée" : formatFcfa(k.stock.value)} sub={k.stock.partial ? "Historique trop volumineux" : `À l'instant · ${k.stock.methodLabel}`} to="/stock" />
          <Kpi label="Stock faible" value={k.stock.low === null ? "—" : String(k.stock.low)} sub="Sous le seuil d'alerte" to="/stock" tone={k.stock.low ? "text-warn" : ""} />
          <Kpi label="Ruptures" value={k.stock.out === null ? "—" : String(k.stock.out)} sub="Stock à zéro ou moins" to="/stock" tone={k.stock.out ? "text-bad" : ""} />
          </div></section>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          <Section title={`Évolution du CA — 7 derniers jours`}>{use3d ? <Suspense fallback={<BarChart label="Chiffre d'affaires des 7 derniers jours" data={last7} />}><Chart3D label="Chiffre d'affaires des 7 derniers jours (vue 3D)" data={last7} format={formatFcfa} /></Suspense> : <BarChart label="Chiffre d'affaires des 7 derniers jours" data={last7} />}</Section>
          <Section title={`Ventes par catégorie — ${periodTxt}`} empty={d.charts.byCategory.length ? undefined : "Aucune vente sur la période."}><Donut label="Répartition par catégorie" data={d.charts.byCategory.slice(0, 6).map((x) => ({ key: x.category, label: x.category, value: x.revenue }))} /></Section>
          <div className="flex flex-col gap-2"><section aria-label="Alertes" className="flex flex-col gap-2"><h2 className="font-semibold text-sm">Alertes</h2>
          {!d.alerts.length && <p className="card text-sm text-ok">Aucune alerte : aucun événement à signaler.</p>}
          {d.alerts.map((a) => <Link key={a.id} to={a.link} className={`card border ${TONE[a.severity]} flex gap-2 items-start`}><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span className="text-sm min-w-0"><b>{a.label}</b><span className="block text-xs text-muted break-words">{a.detail}</span></span></Link>)}</section></div>
        </div>
        {!!d.charts.byShop.length && <Section title={`Boutiques — ${periodTxt}`}><HBars data={d.charts.byShop.map((x) => ({ key: x.id, label: x.name, value: x.revenue, sub: `${x.count} vente(s)` }))} /></Section>}
        {allAct && <Sheet title="Activité récente" onClose={() => setAllAct(false)}>
        <section aria-label="Activité récente" className="card flex flex-col gap-2"><h2 className="font-semibold text-sm">Activité récente</h2>
          <div className="scroll-x">{([["sales", "Ventes"], ["purchases", "Achats"], ["moves", "Mouvements"], ["created", "Nouveaux articles"], ["important", "Opérations importantes"]] as const).map(([id, l]) => <button key={id} className="chip" aria-current={tab === id} onClick={() => setTab(id)}>{l}</button>)}</div>
          {tab === "sales" && (d.activity.sales.length ? d.activity.sales.map((x) => <button key={x.id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2 text-left" onClick={() => setOpen(x.id)}><span>{x.number}<span className="text-xs text-muted block">{dt(x.at, tz)} · {x.methods.map((m) => METHOD[m] ?? m).join(" + ")}{d.scope.many ? ` · ${x.shop}` : ""}</span></span><b>{formatFcfa(x.total)}</b></button>) : <p className="text-sm text-muted">Aucune vente récente.</p>)}
          {tab === "purchases" && (d.activity.purchases.length ? d.activity.purchases.map((x) => <Link key={x.id} to="/achats" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span>{x.number}<span className="text-xs text-muted block">{x.supplier || "Fournisseur"} · {PO[x.status] ?? x.status}</span></span><b>{formatFcfa(x.total)}</b></Link>) : <p className="text-sm text-muted">Aucun achat enregistré.</p>)}
          {tab === "moves" && (d.activity.moves.length ? d.activity.moves.map((x) => <Link key={x.id} to="/stock" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span className="truncate">{x.name}<span className="text-xs text-muted block">{x.label} · {dt(x.at, tz)}</span></span><b className={x.qty < 0 ? "text-bad" : "text-ok"}>{x.qty > 0 ? "+" : ""}{x.qty}</b></Link>) : <p className="text-sm text-muted">Aucun mouvement ces 7 derniers jours.</p>)}
          {tab === "created" && (d.activity.created.length ? d.activity.created.map((x) => <Link key={x.id} to="/articles" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span className="truncate">{x.name}<span className="text-xs text-muted block">{dt(x.at, tz)}</span></span><b>{formatFcfa(x.price)}</b></Link>) : <p className="text-sm text-muted">Aucun article créé ces 30 derniers jours.</p>)}
          {tab === "important" && (d.activity.important.length ? d.activity.important.map((x) => <Link key={x.id} to="/stock" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span className="truncate">{x.name}<span className="text-xs text-muted block">{x.label} · {dt(x.at, tz)}</span></span><b>{x.qty > 0 ? "+" : ""}{x.qty}</b></Link>) : <p className="text-sm text-muted">Aucune perte, transfert ou écart d'inventaire ces 30 derniers jours.</p>)}
        </section>
        </Sheet>}
        <details className="card text-xs text-muted"><summary className="cursor-pointer">Méthodes de calcul</summary><ul className="list-disc pl-4 pt-1 flex flex-col gap-1">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul></details>
      </>}
      </>}
      {sale && <Sheet title={`Vente ${sale.number}`} onClose={() => setOpen(null)} back>
        <div className="card flex flex-col gap-1 text-sm"><div className="flex justify-between"><span className="text-muted">Date</span><span>{dt(sale.at, tz)}</span></div><div className="flex justify-between"><span className="text-muted">Paiement</span><span>{sale.methods.map((m) => METHOD[m] ?? m).join(" + ")}</span></div><div className="flex justify-between"><span className="text-muted">Boutique</span><span>{sale.shop}</span></div><div className="flex justify-between font-semibold"><span>Total TTC</span><span>{formatFcfa(sale.total)}</span></div></div>
        <h3 className="font-semibold text-sm">Lignes</h3>{sale.lines.map((l, i) => <div key={i} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span className="truncate">{l.qty} × {l.name}</span><span>{formatFcfa(l.amount)}</span></div>)}
        <Link to="/icompta" className="btn-ghost text-center text-sm"><Tags size={14} className="inline mr-1" />Voir les rapports et factures</Link>
      </Sheet>}
    </div>
  );
}
