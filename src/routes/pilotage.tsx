import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Download, Filter, Lock, RefreshCw, TrendingDown, TrendingUp, WifiOff, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { client } from "@/lib/appwrite";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { BarChart, Donut, HBars, LineChart, PALETTE } from "@/components/charts";
import { exportReport, type ExportFormat } from "@/lib/report-export";
import type { ReportData } from "@/domain/exports";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { useSubscription } from "./subscription";
import { ActivitePage } from "./activite";

type Any = Record<string, any>;
const SPACES = [{ id: "essential", l: "Activité" }, { id: "exec", l: "Vue exécutive" }, { id: "sales", l: "Commercial" }, { id: "profit", l: "Rentabilité" }, { id: "stock", l: "Stocks" }, { id: "purchases", l: "Achats" }, { id: "stores", l: "Magasins" }, { id: "forecast", l: "Prévisions" }, { id: "reports", l: "Rapports" }] as const;
type SpaceId = (typeof SPACES)[number]["id"];
const PRESETS = [["today", "Aujourd'hui"], ["yesterday", "Hier"], ["last7", "7 jours"], ["last30", "30 jours"], ["last90", "90 jours"], ["month", "Ce mois"], ["lastMonth", "Mois précédent"], ["year", "Cette année"], ["lastYear", "Année précédente"], ["last365", "365 jours"], ["custom", "Personnalisée"]] as const;
const GRANS = [["", "Auto"], ["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["year", "Année"]] as const;
const METHOD: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte", credit: "À crédit" };
const FKEYS = ["categories", "articles", "suppliers", "sellers", "shops", "methods"] as const;
const FLABEL: Record<string, string> = { categories: "Catégories", articles: "Articles", suppliers: "Fournisseurs", sellers: "Vendeurs", shops: "Magasins", methods: "Modes de paiement" };
const REPORTS = [["commercial", "Rapport commercial"], ["profit", "Rapport de rentabilité"], ["stock", "Rapport de stock"], ["inventory", "Rapport d'inventaire"], ["purchases", "Rapport d'achats"], ["suppliers", "Rapport fournisseurs"], ["store", "Rapport par magasin"], ["seller", "Rapport par vendeur"]] as const;
const KIND_TONE: Record<string, string> = { comptable: "bg-sky-500/20 text-sky-300", commercial: "bg-emerald-500/20 text-emerald-300", estimatif: "bg-amber-500/20 text-amber-300" };
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} %`);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "Non calculable" : formatFcfa(v));
const dd = (k: string) => (k.length === 10 ? `${k.slice(8)}/${k.slice(5, 7)}` : k.length === 7 ? `${k.slice(5)}/${k.slice(2, 4)}` : k);

type Filters = Record<(typeof FKEYS)[number], string[]>;
const EMPTY: Filters = { categories: [], articles: [], suppliers: [], sellers: [], shops: [], methods: [] };

function Delta({ v, suffix = " %", invert = false }: { v: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (v === null || v === undefined) return null; const up = v > 0; const good = invert ? !up : up; if (v === 0) return <span className="text-xs text-white/40">= stable</span>;
  const I = up ? TrendingUp : TrendingDown; return <span className={`text-xs inline-flex items-center gap-0.5 ${good ? "text-emerald-300" : "text-red-300"}`}><I size={12} />{up ? "+" : ""}{v}{suffix}</span>;
}
function Card({ label, value, sub, kind, method, delta, tone }: { label: string; value: string; sub?: string; kind?: string; method?: string; delta?: number | null; tone?: string }) {
  const [open, setOpen] = useState(false);
  return <div className="card flex flex-col gap-0.5"><div className="flex justify-between gap-1 items-start"><span className="text-white/50 text-xs">{label}</span>{kind && <span className={`text-[10px] rounded-full px-1.5 py-0.5 shrink-0 ${KIND_TONE[kind] ?? ""}`}>{kind}</span>}</div>
    <div className={`font-semibold text-lg leading-tight ${tone ?? ""}`}>{value}</div><div className="flex gap-2 items-center"><Delta v={delta} />{sub && <span className="text-[11px] text-white/40 leading-snug">{sub}</span>}</div>
    {method && <button className="text-[11px] text-[var(--gold)] text-left flex items-center gap-0.5" onClick={() => setOpen(!open)} aria-expanded={open}><ChevronDown size={11} className={open ? "rotate-180" : ""} />Méthode</button>}{open && <p className="text-[11px] text-white/60">{method}</p>}</div>;
}
const Na = ({ label, reason }: { label: string; reason: string }) => <Card label={label} value="Non calculable" sub={reason} kind="comptable" tone="text-white/50" />;
const Box = ({ title, children, empty, note }: { title: string; children: React.ReactNode; empty?: string; note?: string }) => <section className="card flex flex-col gap-2"><h2 className="font-semibold text-sm">{title}</h2>{empty ? <p className="text-sm text-white/50">{empty}</p> : children}{note && <p className="text-[11px] text-white/40">{note}</p>}</section>;
function Rows({ cols, rows, max = 8 }: { cols: string[]; rows: (string | number | null)[][]; max?: number }) {
  const [all, setAll] = useState(false); const shown = all ? rows : rows.slice(0, max);
  return <div className="flex flex-col"><div className="grid gap-2 text-[11px] text-white/40 pb-1 border-b border-[var(--line)]" style={{ gridTemplateColumns: `1.6fr ${"1fr ".repeat(cols.length - 1)}` }}>{cols.map((c, i) => <span key={c} className={i ? "text-right" : ""}>{c}</span>)}</div>
    {shown.map((r, k) => <div key={k} className="grid gap-2 text-sm py-1 border-b border-[var(--line)]/50" style={{ gridTemplateColumns: `1.6fr ${"1fr ".repeat(cols.length - 1)}` }}>{r.map((c, i) => <span key={i} className={i ? "text-right" : "truncate"}>{c === null ? "—" : typeof c === "number" ? c.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : c}</span>)}</div>)}
    {rows.length > max && <button className="text-xs text-[var(--gold)] pt-1 self-start" onClick={() => setAll(!all)}>{all ? "Réduire" : `Voir les ${rows.length} lignes`}</button>}</div>;
}
const Warn = ({ children }: { children: React.ReactNode }) => <div className="card border border-amber-400/40 text-sm flex gap-2 items-start" role="status"><AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>{children}</span></div>;

/** Tableau de bord Pro : 9 espaces (Activité Business incluse). Chaque espace est UNE action serveur qui calcule sur les données réelles, selon les mêmes filtres ; rien n'est calculé ni simulé ici. */
export function PilotagePage() {
  const { session } = useSession(); const s = session!; const sub = useSubscription(); const allowed = planAllows(sub.data?.entitlement.plan.id, "proDashboard"); const qc = useQueryClient();
  const [space, setSpace] = useState<SpaceId>("exec"); const [preset, setPreset] = useState("last30"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [compare, setCompare] = useState("prev"); const [gran, setGran] = useState(""); const [shop, setShop] = useState(s.shopId);
  const [filters, setFilters] = useState<Filters>(EMPTY); const [saleState, setSaleState] = useState("paid"); const [showF, setShowF] = useState(false); const [th, setTh] = useState({ slowDays: "90", fastDays: "15", overDays: "180", coverTarget: "30" }); const [live, setLive] = useState(false);
  const custom = preset === "custom"; const ready = !custom || (!!from && !!to && from <= to); const active = FKEYS.reduce((a, k) => a + (filters[k].length ? 1 : 0), 0) + (saleState !== "paid" ? 1 : 0);
  const params = useMemo(() => ({ space, preset, ...(custom ? { from, to } : {}), compare, gran: gran || undefined, shopId: shop, filters, saleState, thresholds: Object.fromEntries(Object.entries(th).map(([k, v]) => [k, Number(v)])) }), [space, preset, custom, from, to, compare, gran, shop, filters, saleState, th]);
  const q = useQuery({ queryKey: ["pro-dash", s.shopId, params], enabled: allowed && ready && space !== "essential" && space !== "reports", placeholderData: keepPreviousData, staleTime: 60_000, retry: 1, queryFn: () => api<Any>(s, "dashboard.pro", params) });
  const opts = useQuery({ queryKey: ["pro-options", s.shopId], enabled: allowed && showF, staleTime: 5 * 60_000, queryFn: () => api<Any>(s, "dashboard.options", { shopId: "all" }) });
  // Temps réel : une vente ou un mouvement enregistré invalide les indicateurs (aucun chiffre n'est modifié côté client).
  useEffect(() => { if (!allowed) return; let un: (() => void) | undefined; let timer: ReturnType<typeof setTimeout> | undefined; const db = import.meta.env.VITE_APPWRITE_DATABASE_ID || "dmp";
    try { un = client.subscribe([`databases.${db}.tables.sales.rows`, `databases.${db}.tables.stock_moves.rows`, `databases.${db}.tables.purchase_orders.rows`], () => { clearTimeout(timer); timer = setTimeout(() => void qc.invalidateQueries({ queryKey: ["pro-dash"] }), 1500); }) as unknown as () => void; setLive(true); } catch { setLive(false); }
    return () => { clearTimeout(timer); try { un?.(); } catch { /* déjà fermé */ } }; }, [allowed, qc]);
  if (!allowed) return (
    <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Tableau de bord Pro</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Pro</span><span className="text-white/60">Performance commerciale, rentabilité, stocks, achats, magasins, prévisions indicatives et exports PDF, Excel, CSV. Le tableau de bord Business reste disponible.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`)}>Passer à Pro</button></div></div>
  );
  const d = q.data; const offline = typeof navigator !== "undefined" && !navigator.onLine; const set = (k: (typeof FKEYS)[number], v: string[]) => setFilters({ ...filters, [k]: v });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-bold">Tableau de bord Pro</h1><div className="flex gap-1">
        <button className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1" onClick={() => setShowF(true)} aria-label="Filtres"><Filter size={16} />{active ? `Filtres (${active})` : "Filtres"}</button>
        <button className="btn-ghost !px-3 !py-2" aria-label="Actualiser" onClick={() => { void qc.invalidateQueries({ queryKey: ["pro-dash"] }); void qc.invalidateQueries({ queryKey: ["overview"] }); }}><RefreshCw size={16} className={q.isFetching ? "animate-spin" : ""} /></button></div></div>
      <nav aria-label="Espaces" className="scroll-x">{SPACES.map((x) => <button key={x.id} className="chip" aria-current={space === x.id} onClick={() => setSpace(x.id)}>{x.l}</button>)}</nav>
      {space !== "essential" && <>
        <nav aria-label="Période" className="scroll-x">{PRESETS.map(([id, l]) => <button key={id} className="chip" aria-current={preset === id} onClick={() => setPreset(id)}>{l}</button>)}</nav>
        {custom && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-white/60">Du<input className="input mt-1" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-white/60">Au<input className="input mt-1" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label></div>}
        <div className="grid grid-cols-2 gap-2"><label className="text-xs text-white/60">Comparer à<select className="input mt-1" value={compare} onChange={(e) => setCompare(e.target.value)}><option value="none">Aucune comparaison</option><option value="prev">Période précédente</option><option value="yoy">Même période l'an dernier</option></select></label>
          {["exec", "sales"].includes(space) && <label className="text-xs text-white/60">Évolution<select className="input mt-1" value={gran} onChange={(e) => setGran(e.target.value)}>{GRANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}</div>
        {(d?.scope?.shops?.length ?? 0) > 1 && <label className="text-xs text-white/60 flex flex-col gap-1">Magasin<select className="input" value={shop} onChange={(e) => setShop(e.target.value)}>{d!.scope.shops.map((x: Any) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="all">Tous mes magasins</option></select></label>}
        {(offline || q.error) && space !== "reports" && <div className="card border border-amber-400/40 text-sm flex gap-2 items-start" role="alert"><WifiOff size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>{offline ? "Hors ligne : ce tableau a besoin d'une connexion." : `Impossible de charger : ${(q.error as Error).message}`} <button className="underline text-[var(--gold)]" onClick={() => void q.refetch()}>Réessayer</button></span></div>}
        {q.isLoading && space !== "reports" && <div className="grid grid-cols-2 gap-2" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-20 animate-pulse bg-white/5" />)}</div>}
        {d && space !== "reports" && <p className="text-[11px] text-white/40 flex items-center gap-1">{live && <Zap size={11} className="text-emerald-300" />}{d.period.label} · {d.period.from} → {d.period.to}{d.prevPeriod ? ` · comparé à ${d.prevPeriod.from} → ${d.prevPeriod.to}` : ""} · fuseau {d.tz} · calculé à {new Date(d.generatedAt).toLocaleTimeString("fr-FR", { timeZone: d.tz, hour: "2-digit", minute: "2-digit" })}{live ? " · mise à jour en direct" : ""}</p>}
        {d?.truncated && <Warn>Volume très élevé : certaines lignes n'ont pas été lues. Les totaux peuvent être partiels (réduisez la période ou filtrez).</Warn>}
        {d?.saleState === "open" && <Warn>Vous consultez les ventes <b>non finalisées</b> : elles ne sont pas du chiffre d'affaires.</Warn>}
      </>}
      {space === "essential" && <ActivitePage embedded />}
      {d && space === "exec" && <Exec d={d} />}{d && space === "sales" && <Sales d={d} />}{d && space === "profit" && <Profit d={d} />}{d && space === "stock" && <Stock d={d} th={th} setTh={setTh} />}{d && space === "purchases" && <Purchases d={d} />}{d && space === "stores" && <Stores d={d} />}{d && space === "forecast" && <Forecast d={d} />}
      {space === "reports" && <Reports params={params} />}
      {showF && <Sheet title="Filtres avancés" onClose={() => setShowF(false)}>
        <p className="text-xs text-white/50">Tous les graphiques, indicateurs et rapports se recalculent avec ces filtres. Un filtre d'article, de catégorie ou de fournisseur réduit chaque vente à ses lignes concernées.</p>
        <label className="text-sm flex flex-col gap-1"><span className="text-white/60">État des ventes</span><select className="input" value={saleState} onChange={(e) => setSaleState(e.target.value)}><option value="paid">Terminées (comptabilisées)</option><option value="open">Non finalisées (diagnostic)</option></select></label>
        {opts.isLoading && <p className="text-sm text-white/50">Chargement des listes…</p>}{opts.error && <p className="text-red-400 text-sm">{(opts.error as Error).message}</p>}
        {opts.data && FKEYS.map((k) => { const list: { id: string; name: string }[] = k === "categories" ? opts.data!.categories.map((c: string) => ({ id: c, name: c })) : k === "methods" ? opts.data!.methods.map((m: string) => ({ id: m, name: METHOD[m] ?? m })) : opts.data![k]; return <FilterList key={k} title={FLABEL[k]!} list={list} value={filters[k]} onChange={(v) => set(k, v)} />; })}
        <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => { setFilters(EMPTY); setSaleState("paid"); }}>Réinitialiser</button><button className="btn flex-1" onClick={() => setShowF(false)}>Appliquer</button></div>
      </Sheet>}
    </div>
  );
}
function FilterList({ title, list, value, onChange }: { title: string; list: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [find, setFind] = useState(""); const shown = list.filter((x) => !find.trim() || x.name.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 60);
  return <details className="card"><summary className="cursor-pointer text-sm font-semibold">{title}{value.length ? ` (${value.length})` : ""}</summary><div className="flex flex-col gap-1 pt-2"><input className="input !py-1.5" placeholder="Rechercher" value={find} onChange={(e) => setFind(e.target.value)} aria-label={`Rechercher — ${title}`} />
    <div className="max-h-40 overflow-y-auto flex flex-col gap-1">{!list.length && <p className="text-xs text-white/50">Aucune valeur disponible.</p>}{shown.map((x) => <label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(x.id)} onChange={() => onChange(value.includes(x.id) ? value.filter((v) => v !== x.id) : [...value, x.id])} /><span className="truncate">{x.name}</span></label>)}</div></div></details>;
}

function Exec({ d }: { d: Any }) {
  const t = d.totals, p = d.previous, c = d.comparison; const def = d.definitions; const dl = (k: string) => (c ? c[k] : null);
  return <>
    <Warn>La marge brute n'est <b>pas un bénéfice net</b> : les charges d'exploitation ne sont pas déduites. Les indicateurs sont classés : <span className="text-sky-300">comptable</span> · <span className="text-emerald-300">commercial</span> · <span className="text-amber-300">estimatif</span>.</Warn>
    <section aria-label="Indicateurs" className="grid grid-cols-2 gap-2">
      <Card label="Chiffre d'affaires TTC" value={formatFcfa(t.revenue)} kind="comptable" method={def.revenue[1]} delta={dl("revenue")} sub={p ? `préc. ${formatFcfa(p.revenue)}` : undefined} />
      <Card label="Encaissements" value={formatFcfa(t.encaisse)} kind="comptable" method={def.encaisse[1]} sub={`dont à crédit non encaissé : ${formatFcfa(t.credit)}`} />
      <Na label="Remboursements" reason="Fonction inexistante : non calculable" />
      <Card label="Coût des marchandises vendues" value={money(t.cogs)} kind="comptable" method={def.cogs[1]} sub={t.cogs === null && t.count ? `Coût manquant sur ${t.cost.linesWithoutCost} ligne(s)` : undefined} />
      <Card label="Marge brute" value={money(t.margin)} kind="comptable" method={def.margin[1]} delta={dl("margin")} sub={t.margin === null && t.count ? `Indicative sur ${t.cost.coveragePct} % du CA : ${formatFcfa(t.cost.indicativeMargin)}` : "Pas un bénéfice net"} />
      <Card label="Taux de marge" value={pct(t.marginRate)} kind="comptable" method={def.marginRate[1]} delta={c?.marginRate} sub={c?.marginRate !== null && c?.marginRate !== undefined ? "points vs période comparée" : undefined} />
      <Card label="Taux de marque" value={pct(t.markup)} kind="comptable" method={def.markup[1]} />
      <Card label="Achats enregistrés (HT)" value={formatFcfa(d.purchasesHt)} kind="comptable" method={def.purchases[1]} />
      <Na label="Dépenses d'exploitation" reason="Non saisies dans l'application" />
      <Na label="Résultat opérationnel estimé" reason="Charges d'exploitation indisponibles" />
      <Card label="Valeur du stock" value={d.stock.value === null ? "Non calculée" : formatFcfa(d.stock.value)} kind="comptable" method={def.stockValue[1]} sub={d.stock.methodLabel} />
      <Card label="Rotation des stocks" value={d.stock.rotation === null ? "Non calculable" : `${d.stock.rotation} ×`} kind="estimatif" method={def.rotation[1]} sub={d.stock.rotation === null ? "Coût ou stock moyen indisponible" : `stock moyen ${formatFcfa(d.stock.avgValue ?? 0)}`} />
      <Card label="Nombre de ventes" value={String(t.count)} kind="commercial" method={def.count[1]} delta={dl("count")} sub={p ? `préc. ${p.count}` : undefined} />
      <Card label="Panier moyen" value={formatFcfa(t.basket)} kind="commercial" method={def.basket[1]} delta={dl("basket")} />
    </section>
    {d.comparisonNote && <p className="text-xs text-white/50">{d.comparisonNote}</p>}
    <Box title={`Évolution du CA (${d.gran === "day" ? "par jour" : d.gran === "week" ? "par semaine" : d.gran === "month" ? "par mois" : "par an"})`} empty={t.count ? undefined : "Aucune vente sur la période et les filtres choisis."}><LineChart label="Chiffre d'affaires" data={d.series.map((x: Any) => ({ key: x.key, label: dd(x.key), value: x.revenue, sub: `${x.count} vente(s)` }))} />
      {d.previousSeries && <p className="text-xs text-white/50">Période comparée : {formatFcfa(p.revenue)} sur {p.count} vente(s).</p>}</Box>
    <Box title="Points d'attention" note="Comptages issus des mêmes calculs que les espaces détaillés."><ul className="text-sm flex flex-col gap-1"><li>Articles en rupture : <b>{d.highlights.out}</b></li><li>Articles dormants (stock sans vente) : <b>{d.highlights.dormant}</b></li><li>Articles en surstock : <b>{d.highlights.overstock}</b></li><li>Lignes sans coût de revient : <b>{d.highlights.lowMarginLines}</b></li></ul></Box>
    <Check d={d} />
  </>;
}
const Check = ({ d }: { d: Any }) => (d.checks ? <p className="text-[11px] text-white/40">Contrôles de cohérence : somme des périodes = total {d.checks.seriesEqualsTotal ? "✓" : "✗"} · encaissé + crédit = CA {d.checks.paymentsEqualRevenue ? "✓" : "✗"}</p> : null);

function Sales({ d }: { d: Any }) {
  const t = d.totals; const lbl = (x: Any) => ({ key: x.key, label: x.name, value: x.revenue, sub: `${x.qty} vendu(s) · ${x.tickets} ticket(s)` });
  return <>
    <section className="grid grid-cols-2 gap-2"><Card label="CA TTC" value={formatFcfa(t.revenue)} delta={d.comparison?.revenue} kind="comptable" /><Card label="Ventes" value={String(t.count)} delta={d.comparison?.count} kind="commercial" /><Card label="Panier moyen" value={formatFcfa(t.basket)} delta={d.comparison?.basket} kind="commercial" /><Card label="Heure de pointe" value={d.peakHour ? `${String(d.peakHour.hour).padStart(2, "0")}h` : "—"} sub={d.peakHour ? formatFcfa(d.peakHour.revenue) : undefined} kind="commercial" /></section>
    {d.comparisonNote && <Warn>{d.comparisonNote}</Warn>}
    <Box title="Évolution du CA" empty={t.count ? undefined : "Aucune vente sur la période."}><LineChart label="CA" data={d.series.map((x: Any) => ({ key: x.key, label: dd(x.key), value: x.revenue, sub: `${x.count} vente(s)` }))} />{d.previousSeries && <><p className="text-xs text-white/50 pt-1">Période comparée</p><LineChart label="CA période comparée" data={d.previousSeries.map((x: Any) => ({ key: x.key, label: dd(x.key), value: x.revenue, sub: `${x.count} vente(s)` }))} /></>}</Box>
    <Box title="Ventes par tranche horaire" empty={t.count ? undefined : "Aucune vente."}><BarChart label="Ventes par heure" data={d.byHour.map((h: Any) => ({ key: String(h.hour), label: `${h.hour}h`, value: h.revenue, sub: `${h.count} vente(s)` }))} /></Box>
    <Box title="Articles les plus performants" empty={d.best.length ? undefined : "Aucun article vendu."}><HBars data={d.best.map(lbl)} /></Box>
    <Box title="Articles les moins performants (vendus)" note={d.perfNote} empty={d.worst.length ? undefined : "Aucun article vendu."}><HBars data={d.worst.map(lbl)} /></Box>
    <Box title="Par catégorie" empty={d.byCategory.length ? undefined : "Aucune vente."}><Donut label="Catégories" data={d.byCategory.slice(0, 6).map((x: Any) => ({ key: x.key, label: x.name, value: x.revenue }))} /></Box>
    <Box title="Par vendeur" empty={d.bySeller.length ? undefined : "Aucune vente."}><HBars data={d.bySeller.map((x: Any) => ({ key: x.key, label: x.name, value: x.revenue, sub: `${x.tickets} vente(s)` }))} /></Box>
    {d.byShop.length > 1 && <Box title="Par magasin"><HBars data={d.byShop.map((x: Any) => ({ key: x.key, label: x.name, value: x.revenue, sub: `${x.tickets} vente(s)` }))} /></Box>}
    <Box title="Par mode de paiement" empty={d.byMethod.length ? undefined : "Aucun paiement."}><Donut label="Paiements" data={d.byMethod.map((x: Any) => ({ key: x.method, label: METHOD[x.method] ?? x.method, value: x.amount }))} /></Box>
    <Box title="Analyse du panier" note="Quartiles et déciles observés sur les ventes de la période (aucun seuil fixé à l'avance)." empty={d.basket.count ? undefined : "Aucune vente."}><div className="grid grid-cols-3 gap-2 text-center text-sm">{[["Moyen", d.basket.avg], ["Médian", d.basket.median], ["Max", d.basket.max], ["10 % bas ≤", d.basket.p10], ["Quartile 1", d.basket.p25], ["Quartile 3", d.basket.p75]].map(([l, v]) => <div key={String(l)} className="card !p-2"><div className="text-[11px] text-white/50">{l}</div><b>{formatFcfa(v as number)}</b></div>)}</div><p className="text-xs text-white/60">Articles par ticket : {d.basket.avgItems} · 90 % des paniers ≤ {formatFcfa(d.basket.p90)}</p></Box>
    <Box title="Détail par article"><Rows cols={["Article", "Qté", "CA TTC"]} rows={d.byArticle.map((a: Any) => [a.name, a.qty, a.revenue])} /></Box><Check d={d} />
  </>;
}

function Profit({ d }: { d: Any }) {
  const m = d.margin;
  return <>
    <Warn>{m.note}</Warn>
    <section className="grid grid-cols-2 gap-2"><Card label="Marge brute" value={money(m.amount)} kind="comptable" /><Card label="Taux de marge" value={pct(m.rate)} kind="comptable" /><Card label="Taux de marque" value={pct(m.markup)} kind="comptable" /><Card label="Couverture des coûts" value={`${m.cost.coveragePct} %`} sub={m.cost.complete ? "Tous les coûts connus" : `${m.cost.linesWithoutCost} ligne(s) sans coût`} /></section>
    <Box title="Marge par article" empty={d.byArticle.length ? undefined : "Aucune vente."}><Rows cols={["Article", "Marge", "Marge %", "Marque %", "Couv."]} rows={d.byArticle.map((a: Any) => [a.name, a.margin, a.marginRate, a.markup, a.coveragePct])} max={10} /></Box>
    <Box title="Contribution des catégories (CA et marge)" empty={d.contribution.length ? undefined : "Aucune vente."} note="Part de marge affichée seulement si la marge globale est calculable."><Rows cols={["Catégorie", "% du CA HT", "% de la marge"]} rows={d.contribution.map((c: Any) => [c.key, c.revenueSharePct, c.marginSharePct])} /></Box>
    <Box title="Marge par catégorie"><Rows cols={["Catégorie", "CA HT", "Marge", "Marge %"]} rows={d.byCategory.map((a: Any) => [a.name, a.revenueHt, a.margin, a.marginRate])} /></Box>
    {d.byShop.length > 1 && <Box title="Marge par magasin"><Rows cols={["Magasin", "CA HT", "Marge", "Marge %"]} rows={d.byShop.map((a: Any) => [a.name, a.revenueHt, a.margin, a.marginRate])} /></Box>}
    <Box title={`Ventes à perte (${d.loss.count})`} empty={d.loss.count ? undefined : "Aucune vente à perte sur la période."} note="Prix HT inférieur au coût de revient figé de la ligne."><p className="text-sm text-red-300">Perte cumulée : {formatFcfa(d.loss.amount)}</p><Rows cols={["Article", "Vente", "CA HT", "Coût"]} rows={d.loss.lines.map((l: Any) => [l.name, l.saleNumber, l.revenueHt, l.cost])} /></Box>
    <Box title={`Articles vendus à faible marge (${d.lowMargin.count})`} empty={d.lowMargin.count ? undefined : "Aucune ligne sous le seuil."} note={`Seuil : ${d.lowMargin.thresholdPct} % (${d.lowMargin.thresholdSource}).`}><Rows cols={["Article", "Vente", "Marge %"]} rows={d.lowMargin.lines.map((l: Any) => [l.name, l.saleNumber, l.marginPct])} /></Box>
    <Box title="Évolution des prix de vente et des coûts (5 articles les plus vendus)" empty={d.evolution.length ? undefined : "Aucune vente."} note="Moyennes hebdomadaires pondérées par les quantités ; coût = coût figé à chaque vente."><div className="flex flex-col gap-3">{d.evolution.map((e: Any) => <div key={e.productId}><div className="text-sm font-semibold">{e.name}</div><Rows cols={["Semaine", "Prix moyen", "Coût moyen"]} rows={e.weeks.map((w: Any) => [w.week.slice(5), w.avgPrice, w.avgCost])} max={4} /></div>)}</div></Box>
    <Box title="Données de coût manquantes" empty={d.missingCost.articles.length ? undefined : "Tous les articles vendus ont un coût de revient."} note="Renseignez le coût de ces articles : leurs marges ne sont pas calculables."><Rows cols={["Article", "Lignes sans coût", "Couv. %"]} rows={d.missingCost.articles.map((a: Any) => [a.name, a.lines, a.coveragePct])} /></Box>
    <p className="text-[11px] text-white/40">{d.method}</p>
  </>;
}

function Stock({ d, th, setTh }: { d: Any; th: Record<string, string>; setTh: (v: any) => void }) {
  const [tab, setTab] = useState<"out" | "dormant" | "slow" | "overstock" | "fast">("out"); const c = d.counts; const list = d.lists[tab] as Any[];
  return <>
    {d.partialShops.length > 0 && <Warn>L'historique de stock de {d.partialShops.length} magasin(s) est trop volumineux : valeur et classements non calculés pour eux.</Warn>}
    <section className="grid grid-cols-2 gap-2"><Card label="Valeur du stock" value={d.valueTotal === null ? "Non calculée" : formatFcfa(d.valueTotal)} kind="comptable" sub={d.methodLabel} /><Card label="Rotation" value={d.rotationGlobal === null ? "Non calculable" : `${d.rotationGlobal} ×`} kind="estimatif" method={d.methods.rotation} /><Card label="Ruptures" value={String(c.out)} tone={c.out ? "text-red-300" : ""} /><Card label="Dormants" value={String(c.dormant)} tone={c.dormant ? "text-amber-300" : ""} /><Card label="Rotation lente" value={String(c.slow)} /><Card label="Forte rotation" value={String(c.fast)} /><Card label="Surstocks" value={String(c.overstock)} tone={c.overstock ? "text-amber-300" : ""} /><Card label="Écarts d'inventaire" value={String(d.gaps.inventory.count)} sub={`${formatFcfa(d.gaps.inventory.value)} (coût actuel)`} /></section>
    <Box title="Valeur du stock par magasin" empty={d.byShop.length ? undefined : "Aucune donnée."}><HBars data={d.byShop.map((s: Any) => ({ key: s.shopId, label: s.name, value: s.value, sub: `${s.articles} article(s) · rotation ${s.rotation ?? "—"} · ${s.out} rupture(s)` }))} /></Box>
    <Box title="Classement des articles" note={d.methods.classes}><div className="scroll-x">{([["out", "Ruptures"], ["dormant", "Dormants"], ["slow", "Lents"], ["overstock", "Surstocks"], ["fast", "Forte rotation"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {list.length ? <Rows cols={["Article", "Stock", "Vendu", "Rot.", "Couv. j"]} rows={list.map((r) => [r.name, r.qty, r.sold, r.rotation, r.coverage])} /> : <p className="text-sm text-white/50">Aucun article dans cette catégorie.</p>}<p className="text-[11px] text-white/40">{d.methods.coverage}</p></Box>
    <Box title="Conventions de classement (modifiables)"><div className="grid grid-cols-2 gap-2">{([["slowDays", "Lent > (jours)"], ["fastDays", "Fort ≤ (jours)"], ["overDays", "Surstock > (jours)"], ["coverTarget", "Couverture cible (j)"]] as const).map(([k, l]) => <label key={k} className="text-xs text-white/60">{l}<input className="input mt-1" inputMode="numeric" value={th[k]} onChange={(e) => setTh({ ...th, [k]: e.target.value.replace(/\D/g, "") })} /></label>)}</div></Box>
    <Box title="Ruptures fréquentes" empty={d.frequentStockouts.length ? undefined : "Aucun article en rupture 2 fois ou plus sur la période."} note={d.methods.stockouts}><Rows cols={["Article", "Ruptures", "Jours en rupture"]} rows={d.frequentStockouts.map((r: Any) => [r.name, r.episodes, r.daysOut])} /></Box>
    <Box title={`Lots expirés (${d.expiry.expired.length}) — ${formatFcfa(d.expiry.expiredValue)}`} empty={d.expiry.expired.length ? undefined : "Aucun lot expiré avec du stock."}><Rows cols={["Article", "Lot", "Expiré le", "Qté", "Valeur"]} rows={d.expiry.expired.map((e: Any) => [e.name, e.lotNo, e.expiresAt.slice(0, 10), e.qty, e.value])} /></Box>
    <Box title={`Proches de l'expiration ≤ 30 j (${d.expiry.soon.length}) — ${formatFcfa(d.expiry.soonValue)}`} empty={d.expiry.soon.length ? undefined : "Aucun lot proche de l'expiration."} note={d.methods.expiry}><Rows cols={["Article", "Lot", "Jours", "Qté", "Valeur"]} rows={d.expiry.soon.map((e: Any) => [e.name, e.lotNo, e.daysLeft, e.qty, e.value])} /></Box>
    <Box title="Pertes, écarts d'inventaire et ajustements" note={d.gaps.note} empty={d.gaps.entries.length ? undefined : "Aucun écart, perte ou ajustement sur la période."}><div className="grid grid-cols-3 gap-2 text-center text-sm"><div className="card !p-2"><div className="text-[11px] text-white/50">Inventaire</div><b>{d.gaps.inventory.count}</b><div className="text-[11px]">{formatFcfa(d.gaps.inventory.value)}</div></div><div className="card !p-2"><div className="text-[11px] text-white/50">Pertes</div><b>{d.gaps.loss.count}</b><div className="text-[11px]">{formatFcfa(d.gaps.loss.value)}</div></div><div className="card !p-2"><div className="text-[11px] text-white/50">Autres</div><b>{d.gaps.other.count}</b><div className="text-[11px]">{formatFcfa(d.gaps.other.value)}</div></div></div><Rows cols={["Article", "Type", "Qté", "Valeur"]} rows={d.gaps.entries.map((g: Any) => [g.name, g.kind, g.qty, g.value])} /></Box>
    <p className="text-[11px] text-white/40">Données utilisées : {d.dataUsed.products} article(s), {d.dataUsed.moves} mouvement(s), fenêtre {d.dataUsed.window}.</p>
  </>;
}

function Purchases({ d }: { d: Any }) {
  return <>
    <section className="grid grid-cols-2 gap-2"><Card label="Facturé HT" value={formatFcfa(d.invoicedHt)} kind="comptable" method={d.methods.invoiced} /><Card label="Commandé" value={formatFcfa(d.orderedTotal)} method={d.methods.ordered} /><Card label="Commandes" value={String(d.orders)} /><Card label="Délai moyen observé" value={d.leadTimes.avgDays === null ? "Inconnu" : `${d.leadTimes.avgDays} j`} method={d.methods.lead} sub={d.leadTimes.avgDays === null ? "Aucune réception exploitable" : undefined} /></section>
    <Box title="Achats par fournisseur" empty={d.bySupplier.length ? undefined : "Aucune commande sur la période."}><HBars data={d.bySupplier.map((s: Any) => ({ key: s.id, label: s.name, value: s.total, sub: `${s.orders} commande(s) · ${s.items} article(s) · délai ${s.avgLeadDays ?? "—"} j (${s.leadObservations} obs.)` }))} /></Box>
    <Box title="Fournisseurs les plus sollicités" empty={d.mostSolicited.length ? undefined : "Aucune commande."}><Rows cols={["Fournisseur", "Commandes", "Délai (j)"]} rows={d.mostSolicited.map((s: Any) => [s.name, s.orders, s.avgLeadDays])} /></Box>
    <Box title="Comparaison des fournisseurs (même article)" empty={d.compare.length ? undefined : "Aucun article acheté auprès d'au moins 2 fournisseurs sur la période."}>{d.compare.map((c: Any) => <div key={c.productId}><div className="text-sm font-semibold">{c.name} <span className="text-xs text-white/50">écart {c.spreadPct}</span></div><Rows cols={["Fournisseur", "Prix moyen", "Commandes"]} rows={c.suppliers.map((s: Any) => [s.name, s.avgPrice, s.orders])} /></div>)}</Box>
    <Box title="Évolution des prix d'achat" empty={d.evolution.length ? undefined : "Aucun achat sur la période."}><Rows cols={["Article", "Obs.", "Premier", "Dernier", "Var. %"]} rows={d.evolution.map((e: Any) => [e.name, e.observations, e.first, e.last, e.changePct])} /></Box>
    <Box title={`Variations anormales de prix (${d.anomalies.length})`} empty={d.anomalies.length ? undefined : "Aucune variation anormale détectée."} note={d.methods.anomalies}><Rows cols={["Article", "Date", "Prix", "Réf.", "Écart %"]} rows={d.anomalies.map((a: Any) => [a.name, a.at.slice(0, 10), a.price, a.baseline, a.deviationPct])} /></Box>
    <Box title="Articles à réapprovisionner" empty={d.reorder.items.length ? undefined : "Aucun besoin détecté."} note={`${d.reorder.method} Fiabilité : ${d.reorder.reliability}. ${d.reorder.limits}`}><Rows cols={["Article", "Stock", "Par jour", "Commandé", "À prendre"]} rows={d.reorder.items.map((r: Any) => [r.name, r.stock, r.perDay, r.onOrder, r.suggested])} /></Box>
    <Box title="Historique des commandes et réceptions" empty={d.history.length ? undefined : "Aucune commande."}><Rows cols={["N°", "Fournisseur", "Statut", "Total", "Délai"]} rows={d.history.map((h: Any) => [h.number, h.supplier, h.status, h.total, h.leadDays])} /></Box>
  </>;
}

function Stores({ d }: { d: Any }) {
  return <>
    <p className="text-xs text-white/50">{d.note}</p>
    <Box title="Classement par chiffre d'affaires" empty={d.shops.length ? undefined : "Aucun magasin."}><HBars data={d.shops.map((s: Any) => ({ key: s.id, label: `${s.rankRevenue}. ${s.name}`, value: s.revenue, sub: `${s.count} vente(s) · panier ${formatFcfa(s.basket)}${s.revenueGapPct !== null ? ` · ${s.revenueGapPct > 0 ? "+" : ""}${s.revenueGapPct} % vs moyenne` : ""}` }))} /></Box>
    <Box title="Marges, stocks et rotations"><Rows cols={["Magasin", "Marge %", "Stock", "Rot.", "Rupt."]} rows={d.shops.map((s: Any) => [s.name, s.marginRate, s.stockValue, s.rotation, s.out])} /></Box>
    <Box title="Écarts de performance (vs moyenne des magasins)" empty={d.comparable ? undefined : "Un seul magasin : pas de comparaison."}><Rows cols={["Magasin", "CA %", "Panier %", "Marge (pts)"]} rows={d.shops.map((s: Any) => [s.name, s.revenueGapPct, s.basketGapPct, s.marginGapPts])} /></Box>
    {d.shops.map((s: Any) => <Box key={s.id} title={`Vendeurs — ${s.name}`} empty={s.sellers.length ? undefined : "Aucune vente."}><Rows cols={["Vendeur", "Ventes", "CA", "Marge"]} rows={s.sellers.map((v: Any) => [v.name, v.tickets, v.revenue, v.margin])} /></Box>)}
  </>;
}

const REL_TONE: Record<string, string> = { insuffisante: "text-red-300", faible: "text-amber-300", moyenne: "text-sky-300", correcte: "text-emerald-300" };
function Forecast({ d }: { d: Any }) {
  if (d.insufficient) return <Warn>{d.reason}</Warn>;
  const sev: Record<string, string> = { critical: "border-red-400/40", warning: "border-amber-400/40", info: "border-sky-400/30" };
  return <>
    <p className="text-xs text-white/50">{d.disclaimer} Historique disponible : {d.historyDays} jours.</p>
    {!d.recommendations.length && <p className="card text-sm text-white/60">Aucune recommandation : aucune tendance, rupture ou risque ne ressort de l'historique.</p>}
    {d.recommendations.map((r: Any) => <details key={r.id} className={`card border ${sev[r.severity]}`}><summary className="cursor-pointer text-sm"><b>{r.title}</b><span className={`ml-2 text-[11px] ${REL_TONE[r.reliability]}`}>fiabilité {r.reliability}</span></summary>
      <div className="text-xs text-white/70 flex flex-col gap-1 pt-2"><p><b>Période analysée :</b> {r.period.from} → {r.period.to}</p><p><b>Données :</b> {Object.entries(r.data).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join(" · ")}</p><p><b>Méthode :</b> {r.method}</p><p><b>Limites :</b> {r.limits}</p></div></details>)}
  </>;
}

function Reports({ params }: { params: Any }) {
  const { session } = useSession(); const s = session!; const [busy, setBusy] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [fmt, setFmt] = useState<ExportFormat>("pdf");
  const run = useMutation({ mutationFn: async (kind: string) => { setBusy(kind); setErr(""); setMsg(""); const { space: _s, ...rest } = params; const r = await api<ReportData>(s, "dashboard.report", { ...rest, kind }); await exportReport(r, fmt); return r; },
    onSuccess: (r) => { setBusy(""); setMsg(`« ${r.title} » généré : ${r.sections.length} section(s), ${r.sections.reduce((a, x) => a + x.rows.length, 0)} ligne(s).`); }, onError: (e) => { setBusy(""); setErr((e as Error).message); } });
  return <div className="flex flex-col gap-3">
    <p className="text-xs text-white/50">Les rapports respectent la période, le magasin et les filtres choisis ci-dessus ({params.preset}{params.filters && Object.values(params.filters as Filters).some((v) => v.length) ? ", filtres actifs" : ""}). Le fichier est généré à partir des mêmes calculs que les écrans.</p>
    <div className="flex gap-2">{(["pdf", "xlsx", "csv"] as const).map((f) => <button key={f} className="chip" aria-current={fmt === f} onClick={() => setFmt(f)}>{f === "pdf" ? "PDF" : f === "xlsx" ? "Excel" : "CSV"}</button>)}</div>
    <div className="grid grid-cols-1 gap-2">{REPORTS.map(([k, l]) => <button key={k} className="card flex items-center justify-between text-left" disabled={!!busy} onClick={() => run.mutate(k)}><span className="font-semibold text-sm">{l}</span><span className="text-xs text-[var(--gold)] flex items-center gap-1"><Download size={14} />{busy === k ? "Génération…" : fmt === "xlsx" ? "Excel" : fmt.toUpperCase()}</span></button>)}</div>
    {msg && <p className="text-emerald-300 text-sm" role="status">{msg}</p>}{err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
  </div>;
}
void PALETTE;
