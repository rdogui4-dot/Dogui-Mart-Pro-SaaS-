/** IProj-Invest (interface, kit) : vue d'ensemble, projets, simulations, plan de financement (Pro), suivi & rentabilité ; placements, portefeuille, profil de risque, réglages Pro.
 *  Outil d'analyse et de simulation, jamais un conseil : toutes les projections viennent des hypothèses saisies. */
import { useState } from "react";
import { Briefcase, CalendarClock, FolderKanban, Gauge, LayoutGrid, LineChart as LineIcon, Lock, Percent, Plus, TrendingUp, Wallet, Landmark, Activity } from "lucide-react";
import { InsightCard, KpiRow, KpiTile, LockedState, ModuleHeader, Panel, PillTabs, StatusBadge, type Insight, type PillTab, type StatusTone } from "@/components/kit";
import { Donut, LineChart } from "@/components/charts";
import { formatFcfa } from "@/domain/money";
import { metrics as projMetrics, PROJECT_TYPES } from "@/domain/invest";
import { Disclaimer } from "@/components/ui";
import { DataGrid } from "@/components/DataGrid";
import { useMinWidth } from "@/lib/media";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { exportReport, type ExportFormat } from "@/lib/report-export";
import type { ReportData } from "@/domain/exports";
import { Err, Field, Kpi, Note, day, fmtDay, money, rid, useAct, useQ } from "./icompta-kit";
import { PlacementPro, Portfolio, ProjectPro, Reglages } from "./investissements-pro";
import { Marches } from "./investissements-marches";

type Alert = { level: "critical" | "warn" | "info"; text: string; item?: string; id?: string };
const TONE = { critical: "text-bad", warn: "text-warn", info: "text-muted" } as const;
const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/\s/g, "").replace(",", ".")));
const Limits = ({ items }: { items?: string[] }) => (items?.length ? <div className="card text-xs text-muted flex flex-col gap-1" aria-label="Limites et avertissements"><b className="text-soft">Limites et validation</b>{items.map((l, i) => <p key={i}>• {l}</p>)}</div> : null);
const Alerts = ({ list }: { list: Alert[] }) => <>{list.map((a, i) => <p key={i} className={`card text-sm ${TONE[a.level]}`} role={a.level === "critical" ? "alert" : undefined}>{a.item ? <b>{a.item} : </b> : null}{a.text}</p>)}</>;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} %`);
const months = (v: number | null | undefined) => (v === null || v === undefined ? "jamais" : `${v} mois`);

type Tab = "ov" | "proj" | "sim" | "fin" | "suivi" | "mk" | "plac" | "port" | "reg" | "rpro";
type PRow = { id: string; name: string; type: string; status: string; statusLabel: string; budget: number; spent: number; months: number | null; net: number | null; roiPct: number | null; paybackMonths: number | null; annualGain: number | null };
type Folio = { pro: boolean; counts: { total: number; active: number; withCentral: number }; invested: number; avgRoiPct: number | null; annualGain: number | null; avgPaybackMonths: number | null; totals: { budget: number; net: number; roiPct: number | null }; byType: { type: string; budget: number }[]; projects: PRow[]; best: string | null; note: string;
  main: null | { id: string; name: string; budget: number; months: number; cumulative: number[]; scenarios: { name: string; label: string; set: boolean; growthPct?: number; sales?: number; net?: number; roiPct?: number | null; paybackMonths?: number | null }[]; pro: null | { rate: number | null; npv: number | null; irr: number | null; pi: number | null } } };
type Ov = { projects: { total: number; active: number; study: number; budget: number; spent: number }; placements: { total: number; active: number; invested: number }; alerts: Alert[]; profile: string | null; financing: { source: string; monthlyIn: number; monthlyOut: number; monthlyNet: number; note: string }; limits: string[] };
const STONE: Record<string, StatusTone> = { study: "info", approved: "progress", in_progress: "progress", done: "ok", abandoned: "muted" };
const fr = (n: number) => n.toLocaleString("fr-FR");

export function InvestPage() {
  const { session } = useSession(); const s = session!; const mgr = s.role === "owner" || s.role === "manager"; const owner = s.role === "owner";
  const f = useQ<Folio>("inv.portfolio"); const pro = f.data?.pro === true; const [tab, setTab] = useState<Tab>("ov"); const [nw, setNw] = useState(false);
  const main: PillTab<Tab>[] = [{ key: "ov", label: "Vue d'ensemble", icon: LayoutGrid }, { key: "proj", label: "Projets d'investissement", icon: FolderKanban }, { key: "sim", label: "Simulations & projections", icon: LineIcon }, { key: "fin", label: "Plan de financement", icon: Landmark, locked: !pro }, { key: "suivi", label: "Suivi & rentabilité", icon: Activity }];
  const extra: [Tab, string, boolean][] = [["mk", "Marchés & connaissances", false], ["plac", "Placements", false], ["port", "Portefeuille", true], ["reg", "Profil de risque", false], ["rpro", "Réglages Pro", true]];
  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader icon={Briefcase} title="IProj-Invest — Investissements & Projections" subtitle="Évaluez vos projets d'entreprise et simulez leur rentabilité à partir de vos propres hypothèses." actions={mgr ? <button className="btn-gold !py-2.5 inline-flex items-center gap-2" onClick={() => setNw(true)}><Plus size={18} />Nouveau projet</button> : undefined} />
      <InvKpis q={f} />
      <PillTabs idBase="inv" label="Sections Investissements" value={main.some((t) => t.key === tab) ? tab : ("" as Tab)} onChange={setTab} items={main} />
      <div role="tablist" aria-label="Autres sections Investissements" className="scroll-x !gap-1.5 -mt-2 md:flex-wrap md:overflow-x-visible">{extra.map(([k, l, isPro]) => <button key={k} role="tab" type="button" aria-selected={tab === k} className="chip !min-h-8 !py-1 !px-3 text-sm inline-flex items-center gap-1" onClick={() => setTab(k)}>{l}{isPro && !pro && <Lock size={12} aria-label="Réservé à une offre supérieure" />}</button>)}</div>
      <Disclaimer>Étude de vos projets d'entreprise et suivi de vos placements déclarés. Outil d'analyse et de simulation : ce n'est ni un conseil financier ni une promesse de rendement, et aucune opération n'est exécutée.</Disclaimer>
      {tab === "ov" && <InvOverview q={f} onTab={setTab} />}
      {tab === "proj" && <Items kind="project" mgr={mgr} hideNew />}
      {tab === "sim" && <Simulations q={f} />}
      {tab === "fin" && (pro ? <Financing q={f} /> : <LockedState feature="Plan de financement" plan="Pro" />)}
      {tab === "suivi" && <Suivi q={f} onTab={setTab} />}
      {tab === "mk" && <Marches />}{tab === "plac" && <Items kind="placement" mgr={mgr} />}{tab === "port" && <Portfolio owner={owner} />}{tab === "rpro" && <Reglages />}{tab === "reg" && <Profil owner={owner} />}
      {nw && <Sheet title="Nouveau projet" onClose={() => setNw(false)} back size="lg"><ProjectForm types={[...PROJECT_TYPES]} onDone={() => { setNw(false); setTab("proj"); }} /></Sheet>}
    </div>
  );
}

type FQ = ReturnType<typeof useQ<Folio>>;
const centralSub = (d?: Folio) => (d ? (d.counts.withCentral ? `${d.counts.withCentral} projet(s) avec scénario central` : "aucun scénario central saisi") : undefined);
/** Indicateurs du kit : budgets réels des projets ; ROI, gain annuel et délai de retour calculés sur les seuls projets dont le scénario central est saisi. */
function InvKpis({ q }: { q: FQ }) {
  const d = q.data;
  return <KpiRow cols={5}>
    <KpiTile icon={Wallet} tint="blue" label="Investissements en cours" loading={q.isLoading} value={d ? formatFcfa(d.invested) : "—"} sub="budgets des projets approuvés ou lancés" />
    <KpiTile icon={FolderKanban} tint="violet" label="Projets actifs" loading={q.isLoading} value={d ? d.counts.active : "—"} sub={d ? `sur ${d.counts.total} projet(s) suivi(s)` : undefined} />
    <KpiTile icon={Percent} tint="green" label="ROI moyen (central)" loading={q.isLoading} value={d?.avgRoiPct == null ? "—" : `${fr(d.avgRoiPct)} %`} sub={centralSub(d)} />
    <KpiTile icon={TrendingUp} tint="amber" label="Gain annuel estimé" loading={q.isLoading} value={d?.annualGain == null ? "—" : formatFcfa(d.annualGain)} sub={d?.annualGain == null ? centralSub(d) : "hors investissement initial"} />
    <KpiTile icon={CalendarClock} tint="cyan" label="Délai moyen de retour" loading={q.isLoading} value={d?.avgPaybackMonths == null ? "—" : `${fr(d.avgPaybackMonths)} mois`} sub={d && d.avgPaybackMonths == null && d.counts.withCentral ? "non atteint sur la durée simulée" : centralSub(d)} />
  </KpiRow>;
}

const projSeries = (cum: number[]) => cum.map((v, i) => ({ key: String(i), label: `M${i}`, value: v, sub: i === 0 ? "investissement initial" : "trésorerie cumulée" }));
function ScenTable({ rows }: { rows: NonNullable<Folio["main"]>["scenarios"] }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Comparaison des scénarios"><thead className="text-xs text-muted"><tr><th className="text-left py-1">Scénario</th><th className="text-right">Croissance</th><th className="text-right">Ventes cumulées</th><th className="text-right">Résultat net</th><th className="text-right">ROI</th><th className="text-right">Retour</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.name} className="border-t border-[var(--line)]"><td className="py-1.5 font-medium">{r.label}</td>{r.set ? <><td className="text-right tabular-nums">{r.growthPct} %/mois</td><td className="text-right tabular-nums">{formatFcfa(r.sales ?? 0)}</td><td className={`text-right tabular-nums ${(r.net ?? 0) < 0 ? "text-bad" : ""}`}>{formatFcfa(r.net ?? 0)}</td><td className="text-right tabular-nums">{pct(r.roiPct)}</td><td className="text-right tabular-nums">{months(r.paybackMonths)}</td></> : <td colSpan={5} className="text-right text-xs text-muted">non renseigné</td>}</tr>)}</tbody></table></div>;
}

function InvOverview({ q, onTab }: { q: FQ; onTab: (t: Tab) => void }) {
  const o = useQ<Ov>("inv.overview"); const d = q.data; const O = o.data;
  if (q.error || o.error) return <Err e={q.error ?? o.error} />;
  const items: Insight[] = [];
  if (d) { if (d.best && d.counts.withCentral > 1) { const b = d.projects.find((p) => p.name === d.best); items.push({ id: "best", tone: "ok", text: `Projet le plus rentable selon vos hypothèses centrales : ${d.best}${b?.roiPct != null ? ` (ROI ${fr(b.roiPct)} %)` : ""}.` }); }
    const miss = d.projects.filter((p) => p.net === null); if (miss.length) items.push({ id: "miss", tone: "warn", text: `Scénario central manquant : ${miss.slice(0, 3).map((p) => p.name).join(", ")}${miss.length > 3 ? ` et ${miss.length - 3} autre(s)` : ""}. Sans lui, ces projets ne comptent pas dans les indicateurs.` });
    const over = d.projects.filter((p) => p.spent > p.budget && p.budget > 0); if (over.length) items.push({ id: "over", tone: "warn", text: `Dépassement de budget (réel saisi) : ${over.map((p) => p.name).join(", ")}.` }); }
  if (O) for (const [i, a] of O.alerts.slice(0, 4).entries()) items.push({ id: `a${i}`, tone: a.level === "info" ? "info" : "warn", text: `${a.item ? `${a.item} : ` : ""}${a.text}` });
  const row = (l: string, v: string, tone = "") => <div className={`flex justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${tone}`}><span>{l}</span><b className="tabular-nums">{v}</b></div>;
  const pr = d?.main?.pro;
  return <div className="flex flex-col gap-4">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title={d?.main ? `Projection — ${d.main.name}` : "Projection du projet principal"} action={d?.main ? <span className="text-xs text-muted">scénario central · {d.main.months} mois</span> : undefined}>{d?.main ? <LineChart label={`Trésorerie cumulée projetée du projet ${d.main.name}`} w={380} data={projSeries(d.main.cumulative)} /> : <p className="text-sm text-muted">{q.isLoading ? "Chargement…" : "Aucun projet avec scénario central : renseignez les hypothèses d'un projet pour voir sa projection."}</p>}</Panel>
      <Panel title="Indicateurs du portefeuille">{d ? <div className="flex flex-col gap-1">{row("Total investi (budgets suivis)", formatFcfa(d.totals.budget), "bg-subtle")}{row("Gain net cumulé projeté", d.counts.withCentral ? formatFcfa(d.totals.net) : "—", "bg-ok-bg/40")}{row("ROI global (central)", pct(d.totals.roiPct), "bg-subtle")}{row("Délai moyen de retour", d.avgPaybackMonths == null ? "—" : `${fr(d.avgPaybackMonths)} mois`, "bg-subtle")}<Note>Gain et ROI : projets à scénario central, sur la durée de chaque scénario.</Note></div> : <p className="text-sm text-muted">Chargement…</p>}</Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Panel title="Répartition par type">{d?.byType.length ? <Donut label="Budgets par type de projet" data={d.byType.map((t) => ({ key: t.type, label: t.type, value: t.budget }))} /> : <p className="text-sm text-muted">{q.isLoading ? "Chargement…" : "Aucun projet suivi."}</p>}</Panel>
      <Panel title="Projets" action={d?.projects.length ? <button className="text-xs text-accent-text underline" onClick={() => onTab("proj")}>Tout voir</button> : undefined}>{d?.projects.length ? <div className="flex flex-col gap-1.5">{[...d.projects].sort((a, b) => b.budget - a.budget).slice(0, 5).map((p) => <div key={p.id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1.5 first:border-0 first:pt-0"><span className="min-w-0"><b className="block truncate">{p.name}</b><span className="text-xs text-muted">{p.type} · {formatFcfa(p.budget)}</span></span><span className="text-right shrink-0"><StatusBadge tone={STONE[p.status] ?? "muted"}>{p.statusLabel}</StatusBadge><span className="block text-xs text-muted">ROI {pct(p.roiPct)}</span></span></div>)}</div> : <p className="text-sm text-muted">{q.isLoading ? "Chargement…" : "Aucun projet : créez-en un avec « Nouveau projet »."}</p>}</Panel>
      <Panel title="Analyse Pro" icon={Gauge}>{!d ? <p className="text-sm text-muted">Chargement…</p> : !d.pro ? <p className="text-sm text-muted inline-flex items-center gap-1"><Lock size={14} />VAN, TRI et indice de profitabilité : formule Pro.</p> : !d.main ? <p className="text-sm text-muted">Aucun projet avec scénario central.</p> : pr?.rate == null ? <p className="text-sm text-muted">Coût du capital non défini : le propriétaire le fixe dans « Réglages Pro ». Sans lui, la VAN et l'indice de profitabilité ne sont pas calculés.{pr?.irr != null ? ` TRI du projet principal : ${fr(pr.irr)} % par an.` : ""}</p> : <div className="flex flex-col gap-1">{row("VAN (" + fr(pr.rate) + " %)", formatFcfa(pr.npv ?? 0), (pr.npv ?? 0) < 0 ? "bg-bad-bg/40" : "bg-ok-bg/40")}{row("TRI annuel", pr.irr == null ? "non calculable" : `${fr(pr.irr)} %`, "bg-subtle")}{row("Indice de profitabilité", pr.pi == null ? "—" : fr(pr.pi), "bg-subtle")}<Note>Projet principal ({d.main.name}), scénario central.</Note></div>}</Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title={d?.main ? `Scénarios — ${d.main.name}` : "Scénarios du projet principal"}>{d?.main ? <ScenTable rows={d.main.scenarios} /> : <p className="text-sm text-muted">{q.isLoading ? "Chargement…" : "Aucun scénario à comparer."}</p>}</Panel>
      <InsightCard module="IProj-Invest" loading={q.isLoading || o.isLoading} items={items} source="projets, scénarios saisis, réalisations constatées et alertes de la boutique" emptyText="Rien à signaler sur vos projets." />
    </div>
    {d && <Note>{d.note}</Note>}
  </div>;
}

function ProjectPick({ q, value, onChange, filter }: { q: FQ; value: string; onChange: (v: string) => void; filter?: (p: PRow) => boolean }) {
  const list = (q.data?.projects ?? []).filter(filter ?? (() => true));
  return <Field label="Projet"><select className="input" aria-label="Projet analysé" value={value} onChange={(e) => onChange(e.target.value)}>{list.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.statusLabel}</option>)}</select></Field>;
}
const firstId = (q: FQ) => q.data?.main?.id ?? q.data?.projects[0]?.id ?? "";

function Simulations({ q }: { q: FQ }) {
  const [pick, setPick] = useState(""); const id = pick || firstId(q);
  if (q.error) return <Err e={q.error} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />;
  if (!q.data.projects.length) return <p className="card text-sm text-muted">Aucun projet : créez un projet puis renseignez ses scénarios prudent, central et optimiste.</p>;
  return <div className="flex flex-col gap-3"><ProjectPick q={q} value={id} onChange={setPick} />{id && <SimView key={id} id={id} />}</div>;
}
function SimView({ id }: { id: string }) {
  const q = useQ<{ item: Project; canEdit: boolean }>("inv.item", { id }); const [scn, setScn] = useState<string | null>(null); const it = q.data?.item;
  if (q.error) return <Err e={q.error} />; if (!it) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />;
  const series = it.scenarios.filter((s2) => s2.set && s2.assumptions).map((s2) => ({ name: s2.name, label: s2.label, cum: projMetrics(it.budget, s2.assumptions as never).cumulative }));
  const central = series.find((x) => x.name === "central") ?? series[0];
  return <div className="flex flex-col gap-3">
    <Panel title="Trésorerie cumulée projetée" action={central ? <span className="text-xs text-muted">scénario {central.label.toLowerCase()}</span> : undefined}>{central ? <LineChart label={`Trésorerie cumulée projetée, scénario ${central.label}`} w={380} data={projSeries(central.cum)} /> : <p className="text-sm text-muted">Aucun scénario renseigné pour ce projet.</p>}</Panel>
    <Panel title="Scénarios et hypothèses">
      <div className="flex flex-col gap-2">{it.scenarios.map((s2) => <div key={s2.name} className="rounded-xl border border-[var(--line)] p-3 text-sm flex flex-col gap-1"><div className="flex justify-between items-center"><b>{s2.label}</b>{q.data!.canEdit && <button className="btn-ghost" onClick={() => setScn(scn === s2.name ? null : s2.name)}>{s2.set ? "Modifier" : "Renseigner"}</button>}</div>
        {s2.set && s2.metrics ? <><p className="text-xs text-muted">Ventes {money(s2.assumptions?.monthlySales)}/mois · croissance {s2.assumptions?.growthPct} %/mois · marge {s2.assumptions?.marginPct} % · coûts fixes {money(s2.assumptions?.fixedCosts)}/mois · {s2.assumptions?.months} mois</p><div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-xs"><span>Résultat net : <b className={s2.metrics.net < 0 ? "text-bad" : ""}>{money(s2.metrics.net)}</b></span><span>ROI : <b>{pct(s2.metrics.roiPct)}</b></span><span>Retour : <b>{months(s2.metrics.paybackMonths)}</b></span><span>Besoin max : <b>{money(s2.metrics.peakNeed)}</b></span></div></> : <p className="text-xs text-muted">Non renseigné.</p>}
        {scn === s2.name && <ScenarioForm id={id} name={s2.name} cur={s2.assumptions} version={s2.version} onDone={() => setScn(null)} />}</div>)}</div>
    </Panel>
    {it.scenarios.find((x) => x.name === "central" && x.sensitivity) && <Panel title="Sensibilité du scénario central"><table className="w-full text-xs"><thead className="text-muted"><tr><th className="text-left">Variation</th><th className="text-right">Net</th><th className="text-right">ROI</th><th className="text-right">Retour</th></tr></thead><tbody>{it.scenarios.find((x) => x.name === "central")!.sensitivity!.rows.map((r, i) => <tr key={i} className="border-t border-[var(--line)]"><td>{r.variable} {r.change > 0 ? "+" : ""}{r.change} %</td><td className="text-right">{money(r.net)}</td><td className="text-right">{pct(r.roiPct)}</td><td className="text-right">{months(r.paybackMonths)}</td></tr>)}</tbody></table></Panel>}
    <Note>Les courbes et indicateurs découlent uniquement des hypothèses saisies ; ils ne prédisent pas le résultat réel.</Note>
  </div>;
}

function Financing({ q }: { q: FQ }) {
  const [pick, setPick] = useState(""); const id = pick || firstId(q);
  if (q.error) return <Err e={q.error} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />;
  if (!q.data.projects.length) return <p className="card text-sm text-muted">Aucun projet : le plan de financement (sources, tranches, échéancier) se construit projet par projet.</p>;
  return <div className="flex flex-col gap-3"><ProjectPick q={q} value={id} onChange={setPick} />{id && <ProjectPro key={id} id={id} />}</div>;
}

function Suivi({ q, onTab }: { q: FQ; onTab: (t: Tab) => void }) {
  const [sel, setSel] = useState<string | null>(null); const d = q.data;
  return <div className="flex flex-col gap-3">
    <Panel title="Budget et rentabilité par projet">{q.error ? <Err e={q.error} /> : !d ? <p className="text-sm text-muted">Chargement…</p> : !d.projects.length ? <p className="text-sm text-muted">Aucun projet suivi.</p> : <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Suivi des projets"><thead className="text-xs text-muted"><tr><th className="text-left py-1">Projet</th><th className="text-left">Statut</th><th className="text-right">Budget</th><th className="text-right">Décaissé (réel)</th><th className="text-right">Utilisé</th><th className="text-right">Net central</th><th className="text-right">ROI</th></tr></thead>
      <tbody>{d.projects.map((p) => { const used = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : 0; return <tr key={p.id} className="border-t border-[var(--line)] cursor-pointer hover:bg-subtle" onClick={() => setSel(p.id)}><td className="py-1.5 font-medium">{p.name}</td><td><StatusBadge tone={STONE[p.status] ?? "muted"}>{p.statusLabel}</StatusBadge></td><td className="text-right tabular-nums">{formatFcfa(p.budget)}</td><td className="text-right tabular-nums">{formatFcfa(p.spent)}</td><td className={`text-right tabular-nums ${used > 100 ? "text-bad" : ""}`}>{used} %</td><td className={`text-right tabular-nums ${(p.net ?? 0) < 0 ? "text-bad" : ""}`}>{p.net === null ? "—" : formatFcfa(p.net)}</td><td className="text-right tabular-nums">{pct(p.roiPct)}</td></tr>; })}</tbody></table></div>}</Panel>
    <Synthese onTab={onTab} />
    {sel && <ProjectSheet id={sel} onClose={() => setSel(null)} />}
  </div>;
}

function Synthese({ onTab }: { onTab: (t: Tab) => void }) {
  const q = useQ<Ov>("inv.overview");
  if (q.error) return <Err e={q.error} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />; const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2"><Kpi label="Projets en cours" value={d.projects.active} /><Kpi label="Projets en étude" value={d.projects.study} /><Kpi label="Budget engagé (approuvés)" value={money(d.projects.budget)} /><Kpi label="Décaissé (réel saisi)" value={money(d.projects.spent)} /><Kpi label="Placements actifs" value={d.placements.active} /><Kpi label="Capital placé (déclaré)" value={money(d.placements.invested)} /></div>
      <Alerts list={d.alerts} />{d.alerts.length === 0 && <p className="card text-sm text-muted">Aucune alerte.</p>}
      <div className="card text-sm flex flex-col gap-1"><b>Capacité observée</b><p className="text-xs text-muted">Source : {d.financing.source}</p><p>Entrées moyennes {money(d.financing.monthlyIn)}/mois · sorties {money(d.financing.monthlyOut)}/mois · solde <b className={d.financing.monthlyNet < 0 ? "text-bad" : ""}>{money(d.financing.monthlyNet)}</b>/mois</p><Note>{d.financing.note}</Note></div>
      {!d.profile && <button className="card text-left text-sm text-warn" onClick={() => onTab("reg")}>Profil de risque non défini : à renseigner (propriétaire).</button>}
      <Limits items={d.limits} /></div>
  );
}

type Row = { id: string; kind: string; name: string; status: string; statusLabel: string; budget: number; startOn: string; type?: string; spent?: number; central?: { net: number; roiPct: number | null; paybackMonths: number | null } | null; scenariosSet?: number; alerts: number; riskLabel?: string; endsOn?: string };
function Items({ kind, mgr, hideNew }: { kind: "project" | "placement"; mgr: boolean; hideNew?: boolean }) {
  const wide = useMinWidth(1024); const q = useQ<{ items: Row[]; types: string[]; limits: string[] }>("inv.items", { kind }); const [open, setOpen] = useState(false); const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3"><Err e={q.error} />
      {mgr && !hideNew && <button className="btn self-start md:self-end" onClick={() => setOpen(!open)}>{open ? "Fermer" : kind === "project" ? "Nouveau projet" : "Nouveau placement"}</button>}
      {open && (kind === "project" ? <ProjectForm types={q.data?.types ?? []} onDone={() => setOpen(false)} /> : <PlacementForm onDone={() => setOpen(false)} />)}
      {q.data?.items.length === 0 && <p className="text-xs text-muted">Aucun {kind === "project" ? "projet" : "placement"} enregistré.</p>}
      {wide && q.data && q.data.items.length > 0 && <DataGrid label={kind === "project" ? "Projets" : "Placements"} rows={q.data.items} rowKey={(i) => i.id} onRow={(i) => setSel(i.id)} columns={kind === "project" ? [
        { label: "Projet", cell: (i) => i.name },
        { label: "Statut", cell: (i) => i.statusLabel },
        { label: "Budget", align: "right", cell: (i) => money(i.budget) },
        { label: "Scénarios", align: "right", cell: (i) => `${i.scenariosSet ?? 0}/3` },
        { label: "Résultat central", align: "right", cell: (i) => (i.central ? <b className={i.central.net < 0 ? "text-bad" : ""}>{money(i.central.net)}</b> : "—") },
        { label: "Alertes", align: "right", cell: (i) => (i.alerts > 0 ? <span className="text-warn">{i.alerts}</span> : "—") },
      ] : [
        { label: "Placement", cell: (i) => i.name },
        { label: "Statut", cell: (i) => i.statusLabel },
        { label: "Montant", align: "right", cell: (i) => money(i.budget) },
        { label: "Risque déclaré", cell: (i) => i.riskLabel ?? "—" },
        { label: "Fin", cell: (i) => fmtDay(i.endsOn ?? "") },
        { label: "Alertes", align: "right", cell: (i) => (i.alerts > 0 ? <span className="text-warn">{i.alerts}</span> : "—") },
      ]} />}
      {!wide && q.data?.items.map((i) => <button key={i.id} className="card text-left text-sm flex justify-between" onClick={() => setSel(i.id)}><span><b>{i.name}</b><span className="block text-xs text-muted">{i.statusLabel} · {kind === "project" ? `budget ${money(i.budget)} · ${i.scenariosSet ?? 0}/3 scénarios` : `${money(i.budget)} · risque déclaré ${i.riskLabel} · fin ${fmtDay(i.endsOn ?? "")}`}</span></span><span className="text-right">{kind === "project" && i.central && <b className={i.central.net < 0 ? "text-bad" : ""}>{money(i.central.net)}</b>}{i.alerts > 0 && <span className="block text-xs text-warn">{i.alerts} alerte(s)</span>}</span></button>)}
      {sel && (kind === "project" ? <ProjectSheet id={sel} onClose={() => setSel(null)} /> : <PlacementSheet id={sel} onClose={() => setSel(null)} />)}
      <Limits items={q.data?.limits} /></div>
  );
}

function ProjectForm({ types, onDone }: { types: string[]; onDone: () => void }) {
  const [f, setF] = useState({ name: "", type: "Autre", objective: "", budget: "", startOn: day(), endOn: "", fsrc: "", famt: "" }); const [rk] = useState(rid); const save = useAct("inv.item.save", onDone); const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card flex flex-col gap-2"><Field label="Nom du projet"><input className="input" aria-label="Nom du projet" value={f.name} onChange={set("name")} /></Field><Field label="Type"><select className="input" aria-label="Type de projet" value={f.type} onChange={set("type")}>{types.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Objectif"><input className="input" aria-label="Objectif" value={f.objective} onChange={set("objective")} /></Field>
      <div className="grid grid-cols-3 gap-2"><Field label="Budget initial (FCFA)"><input className="input" aria-label="Budget initial" inputMode="numeric" value={f.budget} onChange={set("budget")} /></Field><Field label="Début"><input className="input" type="date" aria-label="Début du projet" value={f.startOn} onChange={set("startOn")} /></Field><Field label="Fin prévue"><input className="input" type="date" aria-label="Fin prévue" value={f.endOn} onChange={set("endOn")} /></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Financement : source"><input className="input" aria-label="Source de financement" value={f.fsrc} onChange={set("fsrc")} /></Field><Field label="Montant"><input className="input" aria-label="Montant de financement" inputMode="numeric" value={f.famt} onChange={set("famt")} /></Field></div>
      <Err e={save.error} /><button className="btn" disabled={save.isPending} onClick={() => save.mutate({ kind: "project", requestKey: rk, name: f.name, type: f.type, objective: f.objective, budget: num(f.budget), startOn: f.startOn, endOn: f.endOn || undefined, financing: f.fsrc && f.famt ? [{ source: f.fsrc, amount: num(f.famt) }] : [] })}>Enregistrer (en étude)</button></div>
  );
}
function PlacementForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ asset: "", amount: "", boughtOn: day(), horizonMonths: "", fees: "0", rate: "", risk: "", riskNotes: "", mdate: "", mamt: "", mlabel: "" }); const [rk] = useState(rid); const save = useAct("inv.item.save", onDone); const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card flex flex-col gap-2"><Field label="Actif (désignation)"><input className="input" aria-label="Actif" value={f.asset} onChange={set("asset")} /></Field>
      <div className="grid grid-cols-3 gap-2"><Field label="Montant investi"><input className="input" aria-label="Montant investi" inputMode="numeric" value={f.amount} onChange={set("amount")} /></Field><Field label="Date"><input className="input" type="date" aria-label="Date d'investissement" value={f.boughtOn} onChange={set("boughtOn")} /></Field><Field label="Horizon (mois)"><input className="input" aria-label="Horizon en mois" inputMode="numeric" value={f.horizonMonths} onChange={set("horizonMonths")} /></Field><Field label="Frais"><input className="input" aria-label="Frais" inputMode="numeric" value={f.fees} onChange={set("fees")} /></Field><Field label="Rendement attendu %/an (déclaré)"><input className="input" aria-label="Rendement attendu" inputMode="decimal" value={f.rate} onChange={set("rate")} /></Field><Field label="Risque déclaré"><select className="input" aria-label="Risque déclaré" value={f.risk} onChange={set("risk")}><option value="">— à choisir —</option><option value="low">Faible</option><option value="medium">Moyen</option><option value="high">Élevé</option></select></Field></div>
      <Field label="Risques déclarés (en clair)"><input className="input" aria-label="Risques déclarés" value={f.riskNotes} onChange={set("riskNotes")} /></Field>
      <div className="grid grid-cols-3 gap-2"><Field label="Échéance : date"><input className="input" type="date" aria-label="Date d'échéance" value={f.mdate} onChange={set("mdate")} /></Field><Field label="Montant"><input className="input" aria-label="Montant d'échéance" inputMode="numeric" value={f.mamt} onChange={set("mamt")} /></Field><Field label="Libellé"><input className="input" aria-label="Libellé d'échéance" value={f.mlabel} onChange={set("mlabel")} /></Field></div>
      <Note>Le rendement est celui que VOUS déclarez : l'application ne propose aucun rendement ni aucun cours, et ne recommande aucun placement.</Note><Err e={save.error} />
      <button className="btn" disabled={save.isPending} onClick={() => save.mutate({ kind: "placement", requestKey: rk, asset: f.asset, amount: num(f.amount), boughtOn: f.boughtOn, horizonMonths: num(f.horizonMonths), fees: num(f.fees), expectedRatePct: num(f.rate), risk: f.risk || undefined, riskNotes: f.riskNotes, maturities: f.mdate ? [{ date: f.mdate, amount: num(f.mamt || "0"), label: f.mlabel }] : [] })}>Enregistrer</button></div>
  );
}

type Metrics = { net: number; roiPct: number | null; paybackMonths: number | null; breakEvenSales: number | null; peakNeed: number; totalIn: number; totalOut: number; cumulative: number[] };
type Scn = { name: string; label: string; set: boolean; version?: number; assumptions?: Record<string, number>; metrics?: Metrics; sensitivity?: { rows: { variable: string; change: number; net: number; roiPct: number | null; paybackMonths: number | null }[] }; history?: { v: number; at: string }[] };
type Project = { id: string; name: string; status: string; statusLabel: string; budget: number; startOn: string; data: { type: string; objective: string; endOn: string; financing: { source: string; amount: number }[] }; scenarios: Scn[]; actuals: { id: string; date: string; kind: string; amount: number; label: string; sourceLabel: string; status: string; voidReason: string }[]; actualTotals: { out: number; in: number; net: number }; budgetUsedPct: number; financed: number; financingGap: number; comparison: { month: number; planned: number | null; actual: number; gap: number | null }[]; alerts: Alert[]; by: string };
function ProjectSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQ<{ item: Project; trail: { at: string; action: string; by: string; detail: string }[]; canEdit: boolean; owner: boolean; limits: string[] }>("inv.item", { id }); const st = useAct("inv.item.status"); const [why, setWhy] = useState(""); const [pick, setPick] = useState(""); const [scn, setScn] = useState<string | null>(null); const { session } = useSession(); const s = session!; const [err, setErr] = useState<unknown>(null);
  const it = q.data?.item; const can = q.data?.canEdit; const owner = q.data?.owner;
  const exp = async (fmt: ExportFormat) => { setErr(null); try { await exportReport(await api<ReportData>(s, "inv.report", { id }), fmt); } catch (e) { setErr(e); } };
  const nexts: Record<string, [string, string, boolean][]> = { study: [["approved", "Approuver (propriétaire)", false], ["abandoned", "Abandonner", true]], approved: [["in_progress", "Lancer (propriétaire)", false], ["study", "Remettre en étude", true], ["abandoned", "Abandonner", true]], in_progress: [["done", "Clôturer comme terminé (propriétaire)", false], ["abandoned", "Abandonner", true]] };
  return (
    <Sheet title={it?.name ?? "Projet"} onClose={onClose} back size="panel">
      <Err e={q.error} />{it && q.data && <div className="flex flex-col gap-3 p-3">
        <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>{it.data.type}</b><b>{it.statusLabel}</b></div><p className="text-xs text-muted">{it.data.objective}</p><p className="text-xs text-muted">Budget initial {money(it.budget)} · début {fmtDay(it.startOn)}{it.data.endOn ? ` · fin ${fmtDay(it.data.endOn)}` : ""} · financé {money(it.financed)}{it.financingGap > 0 ? ` (reste ${money(it.financingGap)} à financer)` : ""}</p></div>
        <Alerts list={it.alerts} />
        <b className="text-sm">Prévisions — hypothèses saisies par vous</b>
        <div className="flex flex-col gap-2">{it.scenarios.map((s2) => <div key={s2.name} className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>{s2.label}</b>{can && <button className="btn-ghost" onClick={() => setScn(scn === s2.name ? null : s2.name)}>{s2.set ? "Modifier" : "Renseigner"}</button>}</div>
          {s2.set && s2.metrics ? <><p className="text-xs text-muted">Ventes {money(s2.assumptions?.monthlySales)}/mois · marge {s2.assumptions?.marginPct} % · coûts fixes {money(s2.assumptions?.fixedCosts)}/mois · {s2.assumptions?.months} mois · v{s2.version}</p><div className="grid grid-cols-2 gap-1 text-xs"><span>Résultat net : <b className={s2.metrics.net < 0 ? "text-bad" : ""}>{money(s2.metrics.net)}</b></span><span>ROI : <b>{pct(s2.metrics.roiPct)}</b></span><span>Récupération : <b>{months(s2.metrics.paybackMonths)}</b></span><span>Seuil de rentabilité : <b>{s2.metrics.breakEvenSales === null ? "—" : `${money(s2.metrics.breakEvenSales)}/mois`}</b></span><span>Besoin maximal : <b>{money(s2.metrics.peakNeed)}</b></span></div></> : <p className="text-xs text-muted">Non renseigné.</p>}
          {scn === s2.name && <ScenarioForm id={id} name={s2.name} cur={s2.assumptions} version={s2.version} onDone={() => setScn(null)} />}</div>)}</div>
        {it.scenarios.find((x) => x.name === "central" && x.sensitivity) && <details className="card text-xs"><summary className="cursor-pointer text-sm">Sensibilité du scénario central</summary><table className="w-full mt-2"><thead className="text-muted"><tr><th className="text-left">Variation</th><th className="text-right">Net</th><th className="text-right">ROI</th><th className="text-right">Récup.</th></tr></thead><tbody>{it.scenarios.find((x) => x.name === "central")!.sensitivity!.rows.map((r, i) => <tr key={i} className="border-t border-line"><td>{r.variable} {r.change > 0 ? "+" : ""}{r.change} %</td><td className="text-right">{money(r.net)}</td><td className="text-right">{pct(r.roiPct)}</td><td className="text-right">{r.paybackMonths ?? "jamais"}</td></tr>)}</tbody></table></details>}
        <b className="text-sm">Réalisations constatées (réel)</b>
        <div className="card text-sm flex flex-col gap-1"><p>Décaissé <b>{money(it.actualTotals.out)}</b> ({it.budgetUsedPct} % du budget) · encaissé <b>{money(it.actualTotals.in)}</b></p>
          {it.comparison.length > 0 && <table className="w-full text-xs"><thead className="text-muted"><tr><th className="text-left">Mois</th><th className="text-right">Prévu (central, cumulé)</th><th className="text-right">Réel (cumulé)</th><th className="text-right">Écart</th></tr></thead><tbody>{it.comparison.slice(-6).map((c) => <tr key={c.month} className="border-t border-line"><td>M{c.month}</td><td className="text-right">{c.planned === null ? "—" : money(c.planned)}</td><td className="text-right">{money(c.actual)}</td><td className="text-right">{c.gap === null ? "—" : money(c.gap)}</td></tr>)}</tbody></table>}
          <Note>Le prévu vient de vos hypothèses ; le réel vient des entrées ci-dessous, avec leur source. Les deux ne sont jamais mélangés.</Note></div>
        {it.actuals.map((a) => <p key={a.id} className={`text-xs flex justify-between border-t border-line pt-1 ${a.status === "void" ? "line-through text-muted" : ""}`}><span>{fmtDay(a.date)} · {a.kind === "out" ? "−" : "+"}{money(a.amount)} · {a.label} <i className="text-muted">({a.sourceLabel})</i>{a.voidReason ? ` — annulé : ${a.voidReason}` : ""}</span>{a.status !== "void" && can && <VoidBtn id={a.id} />}</p>)}
        {can && ["approved", "in_progress"].includes(it.status) && <ActualForm id={id} />}
        {can && nexts[it.status] && <div className="card flex flex-col gap-2"><b className="text-sm">Statut</b><div className="flex gap-2 flex-wrap">{nexts[it.status]!.filter(([, , r]) => owner || r || false).map(([to, label, needs]) => <button key={to} className="btn-ghost" onClick={() => (needs ? setPick(to) : st.mutate({ id, status: to }))}>{label}</button>)}{!owner && <Note>Approbation, lancement et clôture : propriétaire seul.</Note>}</div>{pick && <div className="flex gap-2"><input className="input flex-1" aria-label="Motif du changement de statut" placeholder="Motif (5 caractères au moins)" value={why} onChange={(e) => setWhy(e.target.value)} /><button className="btn" disabled={why.trim().length < 5 || st.isPending} onClick={() => st.mutate({ id, status: pick, reason: why }, { onSuccess: () => { setPick(""); setWhy(""); } })}>Confirmer</button></div>}<Err e={st.error} /></div>}
        <div className="flex gap-2">{(["pdf", "xlsx", "csv"] as const).map((x) => <button key={x} className="btn-ghost" onClick={() => void exp(x)}>{x === "xlsx" ? "Excel" : x.toUpperCase()}</button>)}</div><Err e={err} />
        <b className="text-sm">Traçabilité</b>{q.data.trail.map((t, i) => <p key={i} className="text-xs text-muted border-t border-line pt-1">{new Date(t.at).toLocaleString("fr-FR")} · {t.by} · {t.action} · {t.detail}</p>)}
        <ProjectPro id={id} />
        <Limits items={q.data.limits} /></div>}
    </Sheet>
  );
}
function VoidBtn({ id }: { id: string }) { const [open, setOpen] = useState(false); const [why, setWhy] = useState(""); const v = useAct("inv.actual.void", () => setOpen(false)); return open ? <span className="flex gap-1"><input className="input" aria-label="Motif d'annulation" placeholder="Motif" value={why} onChange={(e) => setWhy(e.target.value)} /><button className="btn-ghost" disabled={why.trim().length < 5 || v.isPending} onClick={() => v.mutate({ id, reason: why })}>OK</button></span> : <button className="btn-ghost" onClick={() => setOpen(true)}>Annuler</button>; }
function ScenarioForm({ id, name, cur, version, onDone }: { id: string; name: string; cur?: Record<string, number>; version?: number; onDone: () => void }) {
  const [f, setF] = useState({ months: String(cur?.months ?? 24), sales: String(cur?.monthlySales ?? ""), margin: String(cur?.marginPct ?? ""), fixed: String(cur?.fixedCosts ?? ""), growth: String(cur?.growthPct ?? 0), delay: String(cur?.delayMonths ?? 0), residual: String(cur?.residualValue ?? 0) }); const save = useAct("inv.scenario.save", onDone); const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="flex flex-col gap-2"><div className="grid grid-cols-2 gap-2"><Field label="Durée d'analyse (mois)"><input className="input" aria-label="Durée d'analyse" inputMode="numeric" value={f.months} onChange={set("months")} /></Field><Field label="Ventes mensuelles"><input className="input" aria-label="Ventes mensuelles" inputMode="numeric" value={f.sales} onChange={set("sales")} /></Field><Field label="Marge sur ventes (%)"><input className="input" aria-label="Marge sur ventes" inputMode="decimal" value={f.margin} onChange={set("margin")} /></Field><Field label="Coûts fixes mensuels"><input className="input" aria-label="Coûts fixes mensuels" inputMode="numeric" value={f.fixed} onChange={set("fixed")} /></Field><Field label="Croissance mensuelle (%)"><input className="input" aria-label="Croissance mensuelle" inputMode="decimal" value={f.growth} onChange={set("growth")} /></Field><Field label="Mois avant 1res ventes"><input className="input" aria-label="Mois avant premières ventes" inputMode="numeric" value={f.delay} onChange={set("delay")} /></Field><Field label="Valeur résiduelle finale"><input className="input" aria-label="Valeur résiduelle" inputMode="numeric" value={f.residual} onChange={set("residual")} /></Field></div>
      <Err e={save.error} /><button className="btn" disabled={save.isPending} onClick={() => save.mutate({ id, name, expectedVersion: version ?? 0, months: num(f.months), monthlySales: num(f.sales), marginPct: num(f.margin), fixedCosts: num(f.fixed), growthPct: num(f.growth), delayMonths: num(f.delay), residualValue: num(f.residual) })}>Enregistrer les hypothèses</button></div>
  );
}
function ActualForm({ id }: { id: string }) {
  const [f, setF] = useState({ date: day(), kind: "out", amount: "", label: "", expenseId: "" }); const [rk, setRk] = useState(rid); const add = useAct("inv.actual.add", () => { setF({ ...f, amount: "", label: "", expenseId: "" }); setRk(rid()); }); const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card flex flex-col gap-2"><b className="text-sm">Enregistrer un fait constaté</b><div className="grid grid-cols-2 gap-2"><Field label="Date"><input className="input" type="date" aria-label="Date constatée" value={f.date} onChange={set("date")} /></Field><Field label="Sens"><select className="input" aria-label="Sens" value={f.kind} onChange={set("kind")}><option value="out">Décaissement</option><option value="in">Encaissement</option></select></Field><Field label="Montant (FCFA)"><input className="input" aria-label="Montant constaté" inputMode="numeric" value={f.amount} onChange={set("amount")} /></Field><Field label="Libellé"><input className="input" aria-label="Libellé constaté" value={f.label} onChange={set("label")} /></Field></div>
      <Field label="Ou rattacher une dépense approuvée (identifiant, montant et date repris)"><input className="input" aria-label="Identifiant de dépense" placeholder="optionnel" value={f.expenseId} onChange={set("expenseId")} /></Field><Err e={add.error} />
      <button className="btn" disabled={add.isPending} onClick={() => add.mutate({ id, requestKey: rk, ...(f.expenseId ? { expenseId: f.expenseId } : { date: f.date, kind: f.kind, amount: num(f.amount), label: f.label }) })}>Enregistrer (saisie identifiée comme telle)</button></div>
  );
}

type Plc = { id: string; name: string; status: string; statusLabel: string; budget: number; riskLabel: string; endsOn: string; data: { fees: number; expectedRatePct: number; horizonMonths: number; riskNotes: string; boughtOn: string; maturities: { id: string; date: string; amount: number; label: string; done: boolean }[]; note: string }; projection: { projected: number; gain: number; gainPct: number }; alerts: Alert[]; realized: { amount: number; gain: number; closedOn: string } | null };
function PlacementSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQ<{ item: Plc; trail: { at: string; action: string; by: string; detail: string }[]; canEdit: boolean; limits: string[] }>("inv.item", { id }); const mat = useAct("inv.maturity"); const close = useAct("inv.item.status", () => setShow(false)); const [show, setShow] = useState(false); const [f, setF] = useState({ real: "", why: "" }); const it = q.data?.item; const can = q.data?.canEdit;
  return (
    <Sheet title={it?.name ?? "Placement"} onClose={onClose} back size="panel">
      <Err e={q.error} />{it && q.data && <div className="flex flex-col gap-3 p-3"><Alerts list={it.alerts} />
        <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>{money(it.budget)}</b><b>{it.statusLabel}</b></div><p className="text-xs text-muted">Frais {money(it.data.fees)} · rendement DÉCLARÉ {it.data.expectedRatePct} %/an · horizon {it.data.horizonMonths} mois (fin {fmtDay(it.endsOn)}) · risque déclaré {it.riskLabel}</p><p className="text-xs text-muted">Risques : {it.data.riskNotes}</p></div>
        <div className="card text-sm"><b>Projection mécanique (non garantie)</b><p className="text-xs text-muted">{money(it.projection.projected)} à l'horizon, soit {money(it.projection.gain)} ({it.projection.gainPct} %), si — et seulement si — le rendement que vous avez déclaré se réalisait. Un placement peut perdre de la valeur.</p></div>
        {it.realized && <div className="card text-sm">Clôturé le {fmtDay(it.realized.closedOn)} : récupéré {money(it.realized.amount)} (saisi), soit {money(it.realized.gain)} par rapport au capital investi.</div>}
        <b className="text-sm">Échéances</b>{it.data.maturities.length === 0 && <p className="text-xs text-muted">Aucune échéance.</p>}{it.data.maturities.map((m) => <div key={m.id} className="text-xs flex justify-between border-t border-line pt-1"><span>{fmtDay(m.date)} · {m.label} · {money(m.amount)}</span>{can && it.status === "active" ? <button className="btn-ghost" onClick={() => mat.mutate({ id, maturity: m.id, done: !m.done })}>{m.done ? "Rouvrir" : "Constatée"}</button> : <span>{m.done ? "constatée" : ""}</span>}</div>)}
        {can && it.status === "active" && <><button className="btn-ghost self-start" onClick={() => setShow(!show)}>Clôturer ce placement…</button>{show && <div className="card flex flex-col gap-2"><Field label="Montant réellement récupéré (saisi par vous)"><input className="input" aria-label="Montant récupéré" inputMode="numeric" value={f.real} onChange={(e) => setF({ ...f, real: e.target.value })} /></Field><input className="input" aria-label="Motif de clôture" placeholder="Motif (5 caractères au moins)" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} /><Err e={close.error} /><button className="btn" disabled={close.isPending} onClick={() => close.mutate({ id, status: "closed", realizedAmount: num(f.real), reason: f.why })}>Clôturer</button></div>}</>}
        <Err e={mat.error} /><PlacementPro id={id} /><b className="text-sm">Traçabilité</b>{q.data.trail.map((t, i) => <p key={i} className="text-xs text-muted border-t border-line pt-1">{new Date(t.at).toLocaleString("fr-FR")} · {t.by} · {t.action} · {t.detail}</p>)}<Limits items={q.data.limits} /></div>}
    </Sheet>
  );
}

function Profil({ owner }: { owner: boolean }) {
  const q = useQ<{ profile: string | null; profiles: { key: string; label: string }[]; note: string }>("inv.config"); const save = useAct("inv.config.save");
  return (
    <div className="card flex flex-col gap-2"><b className="text-sm">Profil de risque du propriétaire</b><Err e={q.error ?? save.error} /><div className="flex gap-2" role="group" aria-label="Profil de risque">{q.data?.profiles.map((p) => <button key={p.key} className="chip" aria-current={q.data!.profile === p.key} disabled={!owner || save.isPending} onClick={() => save.mutate({ profile: p.key })}>{p.label}</button>)}</div>{!owner && <Note>Réservé au propriétaire.</Note>}<Note>{q.data?.note}</Note></div>
  );
}
