import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Boxes, ClipboardList, Lock, Plus, Receipt, RefreshCw, ScanLine, Tags, WifiOff, FileBarChart } from "lucide-react";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { BarChart, Donut, HBars, LineChart } from "@/components/charts";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { PRESETS, type PresetId } from "@/domain/overview";
import { useSubscription } from "./subscription";

type Daily = { date: string; revenue: number; count: number };
type Margin = { known: boolean; amount: number | null; pct: number | null; linesWithoutCost: number; coveragePct: number; indicative: number };
type Overview = {
  tz: string; asOf: string; today: string; scope: { shopId: string; shops: { id: string; name: string }[]; many: boolean }; period: { preset: PresetId; label: string; from: string; to: string; days: number };
  kpis: { today: { revenue: number; count: number }; month: { from: string; to: string; revenue: number; count: number }; period: { count: number; revenue: number; avgBasket: number; encaisse: number; credit: number; purchases: number; margin: Margin };
    stock: { articles: number; value: number | null; methodLabel: string; partial: boolean; low: number | null; out: number | null } };
  charts: { last7: Daily[]; series: Daily[]; byMethod: { method: string; amount: number }[]; top: { key: string; name: string; qty: number; revenue: number }[]; byCategory: { category: string; revenue: number; qty: number }[]; byShop: { id: string; name: string; revenue: number; count: number }[] };
  activity: { sales: { id: string; number: string; total: number; at: string; shop: string; methods: string[]; lines: { name: string; qty: number; amount: number }[] }[]; purchases: { id: string; number: string; supplier: string; total: number; status: string; at: string }[];
    moves: { id: string; name: string; label: string; qty: number; at: string; shop: string }[]; created: { id: string; name: string; price: number; at: string }[]; important: { id: string; name: string; label: string; qty: number; at: string }[] };
  alerts: { id: string; type: string; severity: "critical" | "warning" | "info"; label: string; detail: string; count: number; link: string }[]; truncated: { sales: boolean }; notes: string[];
};
const METHOD: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte", credit: "À crédit" };
const PO: Record<string, string> = { ordered: "Commandé", partial: "Partiel", received: "Reçu", cancelled: "Annulé" };
const dt = (iso: string, tz: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dd = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
const TONE = { critical: "border-red-400/40 text-red-300", warning: "border-amber-400/40 text-amber-300", info: "border-sky-400/30 text-sky-300" } as const;

function Skeleton() { return <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Chargement">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card h-20 animate-pulse bg-white/5" />)}</div>; }
function Kpi({ label, value, sub, to, tone }: { label: string; value: string; sub: string; to?: string; tone?: string }) {
  const inner = <><div className="text-white/50 text-xs">{label}</div><div className={`font-semibold text-lg leading-tight ${tone ?? ""}`}>{value}</div><div className="text-[11px] text-white/40 leading-snug">{sub}</div></>;
  return to ? <Link to={to} className="card block">{inner}</Link> : <div className="card">{inner}</div>;
}
const Section = ({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string }) => <section className="card flex flex-col gap-2"><h2 className="font-semibold text-sm">{title}</h2>{empty ? <p className="text-sm text-white/50">{empty}</p> : children}</section>;

/** Tableau de bord de l'activité (Business) : tout vient d'une seule action serveur (`dashboard.business`) calculée sur les ventes, achats, stock et mouvements réellement enregistrés. */
export function ActivitePage() {
  const { session } = useSession(); const s = session!; const sub = useSubscription(); const allowed = planAllows(sub.data?.entitlement.plan.id, "businessDashboard");
  const [preset, setPreset] = useState<PresetId>("last30"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [shop, setShop] = useState(s.shopId); const [tab, setTab] = useState<"sales" | "purchases" | "moves" | "created" | "important">("sales"); const [open, setOpen] = useState<string | null>(null);
  const custom = preset === "custom"; const ready = !custom || (!!from && !!to && from <= to);
  const q = useQuery({ queryKey: ["overview", s.shopId, preset, custom ? from : "", custom ? to : "", shop], enabled: allowed && ready, placeholderData: keepPreviousData, retry: 1, queryFn: () => api<Overview>(s, "dashboard.business", { preset, ...(custom ? { from, to } : {}), shopId: shop }) });
  if (!allowed) return (
    <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Tableau de bord</h1>
      <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Business</span><span className="text-white/60">Chiffre d'affaires, marge, stock, graphiques et alertes sur vos données réelles.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div></div>
  );
  const d = q.data; const tz = d?.tz ?? "UTC"; const offline = typeof navigator !== "undefined" && !navigator.onLine; const k = d?.kpis; const per = k?.period;
  const periodTxt = d ? (d.period.from === d.period.to ? dd(d.period.from) : `${dd(d.period.from)} → ${dd(d.period.to)}`) : "";
  const shortcuts = [{ to: "/pos", l: "Nouvelle vente", i: ScanLine, p: "pos" }, { to: "/articles", l: "Ajouter un article", i: Plus, p: "stock" }, { to: "/achats", l: "Enregistrer un achat", i: Receipt, p: "purchases" }, { to: "/stock", l: "Consulter le stock", i: Boxes, p: "stock" }, { to: "/stock", l: "Effectuer un inventaire", i: ClipboardList, p: "stock" }, { to: "/compta", l: "Consulter les rapports", i: FileBarChart, p: "finance" }] as const;
  const sale = d?.activity.sales.find((x) => x.id === open);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-bold">Tableau de bord</h1>
        <button className="btn-ghost !px-3 !py-2 flex items-center gap-1 text-sm" aria-label="Actualiser" onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw size={16} className={q.isFetching ? "animate-spin" : ""} />Actualiser</button></div>
      <p className="text-xs text-white/50">{d ? `Mis à jour à ${new Date(d.asOf).toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })} · jours en heure de l'entreprise (${tz})` : "Chargement des données réelles…"}</p>
      <nav aria-label="Période" className="scroll-x">{PRESETS.map((p) => <button key={p.id} className="chip" aria-current={preset === p.id} onClick={() => setPreset(p.id)}>{p.label}</button>)}</nav>
      {custom && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-white/60">Du<input className="input mt-1" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-white/60">Au<input className="input mt-1" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>{!ready && <p className="col-span-2 text-xs text-white/50">Choisissez deux dates (92 jours au plus).</p>}</div>}
      {d?.scope.many && <label className="text-xs text-white/60 flex flex-col gap-1">Boutique<select className="input" value={shop} onChange={(e) => setShop(e.target.value)}>{d.scope.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="all">Toutes mes boutiques</option></select></label>}
      {(offline || q.error) && <div className="card border border-amber-400/40 text-sm flex gap-2 items-start" role="alert"><WifiOff size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>{offline ? "Vous êtes hors ligne : le tableau de bord a besoin d'une connexion." : `Impossible de charger les données : ${(q.error as Error).message}`}{d ? " Les chiffres affichés datent de la dernière actualisation réussie." : ""} <button className="underline text-[var(--gold)]" onClick={() => void q.refetch()}>Réessayer</button></span></div>}
      {q.isLoading && ready && <Skeleton />}
      {d && k && per && <>
        {d.truncated.sales && <div className="card text-sm text-amber-300 flex gap-2"><AlertTriangle size={16} />Volume de ventes très élevé : certaines ventes de la période n'ont pas été lues, les totaux peuvent être partiels.</div>}
        <section aria-label="Indicateurs" className={`grid grid-cols-2 gap-2 ${q.isFetching ? "opacity-70" : ""}`}>
          <Kpi label="CA du jour" value={formatFcfa(k.today.revenue)} sub={`${dd(d.today)} · ventes terminées TTC`} />
          <Kpi label="CA du mois" value={formatFcfa(k.month.revenue)} sub={`${dd(k.month.from)} → ${dd(k.month.to)} · ventes terminées TTC`} />
          <Kpi label="Ventes réalisées" value={String(per.count)} sub={`${periodTxt} · tickets terminés`} />
          <Kpi label="Panier moyen" value={formatFcfa(per.avgBasket)} sub={`${periodTxt} · CA ÷ ventes`} />
          <Kpi label="Encaissé" value={formatFcfa(per.encaisse)} sub={`${periodTxt} · hors crédit, monnaie exclue`} />
          <Kpi label="Vendu à crédit" value={formatFcfa(per.credit)} sub={`${periodTxt} · non encaissé`} tone={per.credit ? "text-amber-300" : ""} />
          <Kpi label="Achats enregistrés" value={formatFcfa(per.purchases)} sub={`${periodTxt} · HT, factures fournisseurs`} to="/achats" />
          <Kpi label="Marge brute" value={per.margin.known ? formatFcfa(per.margin.amount!) : "Non calculable"} sub={per.margin.known ? `${periodTxt} · ${per.margin.pct} % du CA HT − coût de revient` : per.count ? `Coût manquant sur ${per.margin.linesWithoutCost} ligne(s) (${per.margin.coveragePct} % du CA couvert)` : `${periodTxt} · aucune vente`} />
          <Kpi label="Articles actifs" value={String(k.stock.articles)} sub="À l'instant · non archivés" to="/articles" />
          <Kpi label="Valeur du stock" value={k.stock.value === null ? "Non calculée" : formatFcfa(k.stock.value)} sub={k.stock.partial ? "Historique trop volumineux" : `À l'instant · ${k.stock.methodLabel}`} to="/stock" />
          <Kpi label="Stock faible" value={k.stock.low === null ? "—" : String(k.stock.low)} sub="Sous le seuil d'alerte" to="/stock" tone={k.stock.low ? "text-amber-300" : ""} />
          <Kpi label="Ruptures" value={k.stock.out === null ? "—" : String(k.stock.out)} sub="Stock à zéro ou moins" to="/stock" tone={k.stock.out ? "text-red-300" : ""} />
        </section>
        <section aria-label="Alertes" className="flex flex-col gap-2"><h2 className="font-semibold text-sm">Alertes</h2>
          {!d.alerts.length && <p className="card text-sm text-emerald-300">Aucune alerte : aucun événement à signaler.</p>}
          {d.alerts.map((a) => <Link key={a.id} to={a.link} className={`card border ${TONE[a.severity]} flex gap-2 items-start`}><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span className="text-sm min-w-0"><b>{a.label}</b><span className="block text-xs text-white/60 break-words">{a.detail}</span></span></Link>)}</section>
        <Section title={`Évolution du CA — 7 derniers jours`}><BarChart label="Chiffre d'affaires des 7 derniers jours" data={d.charts.last7.map((x) => ({ key: x.date, label: dd(x.date), value: x.revenue, sub: `${x.count} vente(s)` }))} /></Section>
        <Section title={`Évolution du CA — ${d.period.label} (${periodTxt})`} empty={per.count ? undefined : "Aucune vente sur la période."}><LineChart label="Chiffre d'affaires de la période" data={d.charts.series.map((x) => ({ key: x.date, label: dd(x.date), value: x.revenue, sub: `${x.count} vente(s)` }))} /></Section>
        <Section title={`Modes de paiement — ${periodTxt}`} empty={d.charts.byMethod.length ? undefined : "Aucun paiement sur la période."}><Donut label="Répartition par mode de paiement" data={d.charts.byMethod.map((x) => ({ key: x.method, label: METHOD[x.method] ?? x.method, value: x.amount }))} /></Section>
        <Section title={`Top 5 articles — ${periodTxt}`} empty={d.charts.top.length ? undefined : "Aucun article vendu sur la période."}><HBars data={d.charts.top.map((x) => ({ key: x.key, label: x.name, value: x.revenue, sub: `${x.qty} vendu(s)` }))} /></Section>
        <Section title={`Ventes par catégorie — ${periodTxt}`} empty={d.charts.byCategory.length ? undefined : "Aucune vente sur la période."}><Donut label="Répartition par catégorie" data={d.charts.byCategory.slice(0, 6).map((x) => ({ key: x.category, label: x.category, value: x.revenue }))} /></Section>
        {!!d.charts.byShop.length && <Section title={`Boutiques — ${periodTxt}`}><HBars data={d.charts.byShop.map((x) => ({ key: x.id, label: x.name, value: x.revenue, sub: `${x.count} vente(s)` }))} /></Section>}
        <section aria-label="Activité récente" className="card flex flex-col gap-2"><h2 className="font-semibold text-sm">Activité récente</h2>
          <div className="scroll-x">{([["sales", "Ventes"], ["purchases", "Achats"], ["moves", "Mouvements"], ["created", "Nouveaux articles"], ["important", "Opérations importantes"]] as const).map(([id, l]) => <button key={id} className="chip" aria-current={tab === id} onClick={() => setTab(id)}>{l}</button>)}</div>
          {tab === "sales" && (d.activity.sales.length ? d.activity.sales.map((x) => <button key={x.id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2 text-left" onClick={() => setOpen(x.id)}><span>{x.number}<span className="text-xs text-white/50 block">{dt(x.at, tz)} · {x.methods.map((m) => METHOD[m] ?? m).join(" + ")}{d.scope.many ? ` · ${x.shop}` : ""}</span></span><b>{formatFcfa(x.total)}</b></button>) : <p className="text-sm text-white/50">Aucune vente récente.</p>)}
          {tab === "purchases" && (d.activity.purchases.length ? d.activity.purchases.map((x) => <Link key={x.id} to="/achats" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span>{x.number}<span className="text-xs text-white/50 block">{x.supplier || "Fournisseur"} · {PO[x.status] ?? x.status}</span></span><b>{formatFcfa(x.total)}</b></Link>) : <p className="text-sm text-white/50">Aucun achat enregistré.</p>)}
          {tab === "moves" && (d.activity.moves.length ? d.activity.moves.map((x) => <Link key={x.id} to="/stock" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span className="truncate">{x.name}<span className="text-xs text-white/50 block">{x.label} · {dt(x.at, tz)}</span></span><b className={x.qty < 0 ? "text-red-300" : "text-emerald-300"}>{x.qty > 0 ? "+" : ""}{x.qty}</b></Link>) : <p className="text-sm text-white/50">Aucun mouvement ces 7 derniers jours.</p>)}
          {tab === "created" && (d.activity.created.length ? d.activity.created.map((x) => <Link key={x.id} to="/articles" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span className="truncate">{x.name}<span className="text-xs text-white/50 block">{dt(x.at, tz)}</span></span><b>{formatFcfa(x.price)}</b></Link>) : <p className="text-sm text-white/50">Aucun article créé ces 30 derniers jours.</p>)}
          {tab === "important" && (d.activity.important.length ? d.activity.important.map((x) => <Link key={x.id} to="/stock" className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-2"><span className="truncate">{x.name}<span className="text-xs text-white/50 block">{x.label} · {dt(x.at, tz)}</span></span><b>{x.qty > 0 ? "+" : ""}{x.qty}</b></Link>) : <p className="text-sm text-white/50">Aucune perte, transfert ou écart d'inventaire ces 30 derniers jours.</p>)}
        </section>
        <section aria-label="Raccourcis" className="grid grid-cols-2 gap-2">{shortcuts.filter((x) => can(s, x.p)).map(({ to, l, i: I }) => <Link key={l} to={to} className="tile !py-3"><I size={20} /><b className="text-sm">{l}</b></Link>)}</section>
        <details className="card text-xs text-white/50"><summary className="cursor-pointer">Méthodes de calcul</summary><ul className="list-disc pl-4 pt-1 flex flex-col gap-1">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul></details>
      </>}
      {sale && <Sheet title={`Vente ${sale.number}`} onClose={() => setOpen(null)} back>
        <div className="card flex flex-col gap-1 text-sm"><div className="flex justify-between"><span className="text-white/50">Date</span><span>{dt(sale.at, tz)}</span></div><div className="flex justify-between"><span className="text-white/50">Paiement</span><span>{sale.methods.map((m) => METHOD[m] ?? m).join(" + ")}</span></div><div className="flex justify-between"><span className="text-white/50">Boutique</span><span>{sale.shop}</span></div><div className="flex justify-between font-semibold"><span>Total TTC</span><span>{formatFcfa(sale.total)}</span></div></div>
        <h3 className="font-semibold text-sm">Lignes</h3>{sale.lines.map((l, i) => <div key={i} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span className="truncate">{l.qty} × {l.name}</span><span>{formatFcfa(l.amount)}</span></div>)}
        <Link to="/compta" className="btn-ghost text-center text-sm"><Tags size={14} className="inline mr-1" />Voir les rapports et factures</Link>
      </Sheet>}
    </div>
  );
}
