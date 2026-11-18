/** IProj Marchés & connaissances : change, économies africaines, BRVM (Pro, source communautaire), contexte mondial (Pro), liens avec vos projets, base de connaissances, sources.
 *  Consultation seulement : chaque chiffre affiche sa source et sa date ; ce n'est jamais un conseil en investissement. */
import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, Globe2, Landmark, Lock, Search, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, StatusBadge } from "@/components/kit";
import { LineChart } from "@/components/charts";
import { Sheet } from "@/components/ui";
import { KNOWLEDGE } from "@/domain/invest-knowledge";
import { formatFcfa } from "@/domain/money";
import { Err, Field, Note, fmtDay, useAct, useQ } from "./icompta-kit";

type Meta = { source: string; provider: string; url: string; note: string; fetchedAt: string; stale: boolean; error: string };
type Status = { pro: boolean; canEdit: boolean; country: string | null; countries: { code: string; name: string; group: string }[]; fredKey: boolean; disclaimer: string; sources: { key: string; label: string; provider: string; url: string; note: string; pro: boolean; available: boolean; enabled: boolean; fetchedAt: string; error: string }[] };
type Fx = { base: string; date: string; parity: string; rates: { code: string; name: string; perUnit: number; date: string; change30dPct: number | null; series: { date: string; perUnit: number }[] }[]; meta: Meta };
type Val = { value: number; year: string } | null;
type Macro = { country: string | null; countries: { code: string; name: string; group: string; values: Record<string, Val> }[]; indicators: { key: string; label: string; unit: string }[]; meta: Meta };
type Tk = { ticker: string; name: string; sector: string; close: number; prev: number | null; changePct: number | null; date: string; volumeFcfa: number; high52: number; low52: number; change52Pct: number | null; lastDividend: { amount: number; date: string; exercice: string } | null; yieldPct: number | null; spark: number[] };
type Brvm = { asOf: string; breadth: { up: number; down: number; flat: number }; tickers: Tk[]; sectors: { name: string; count: number; avgChangePct: number | null }[]; splits: { ticker: string; date: string; ratio: number; note: string }[]; indexNote: string; meta: Meta };
type World = { keyMissing: boolean; series: { id: string; label: string; unit: string; last: { date: string; value: number }; yearAgo: { date: string; value: number } | null; points: { date: string; value: number }[] }[]; meta: Meta };
type Links = { country: string | null; countryName: string | null; inflation: Val; lending: Val; lendingUsable: boolean; real: Val; placements: { id: string; name: string; amount: number; expectedRatePct: number | null; realPct: number | null }[]; note: string };

const fr = (n: number, d = 2) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });
const pctTxt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${fr(n)} %`);
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "" : n > 0 ? "text-ok" : "text-bad");
const dt = (iso: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
function SourceLine({ m }: { m?: Meta }) {
  if (!m) return null;
  return <div className="text-xs text-muted flex flex-col gap-0.5 border-t border-[var(--line)] pt-2 mt-1">
    <span>Source : <a className="underline inline-flex items-center gap-0.5" href={m.url} target="_blank" rel="noreferrer">{m.provider}<ExternalLink size={11} aria-hidden="true" /></a>{m.fetchedAt ? ` · relevé le ${dt(m.fetchedAt)}` : ""}</span>
    {m.error && <span className={m.fetchedAt ? "text-warn" : "text-bad"} role="status">{m.error}{m.fetchedAt ? " Dernière valeur connue affichée." : ""}</span>}
    <span>{m.note}</span></div>;
}
const Blocked = ({ e, onSources }: { e: unknown; onSources: () => void }) => { const msg = (e as Error)?.message ?? ""; return /désactivée/.test(msg) ? <div className="card text-sm flex flex-col gap-2"><p>{msg}</p><button className="btn-ghost self-start" onClick={onSources}>Voir les sources</button></div> : /formule Pro|réservé/.test(msg) ? <p className="card text-sm text-muted inline-flex items-center gap-2"><Lock size={14} />{msg}</p> : <Err e={e} />; };

type Sub = "fx" | "eco" | "brvm" | "world" | "know" | "src";
export function Marches() {
  const st = useQ<Status>("mk.status"); const [sub, setSub] = useState<Sub>("fx"); const pro = st.data?.pro === true;
  const subs: [Sub, string, boolean][] = [["fx", "Change", false], ["eco", "Économies africaines", false], ["brvm", "BRVM", true], ["world", "Contexte mondial", true], ["know", "Connaissances", false], ["src", "Sources", false]];
  return <div className="flex flex-col gap-3">
    <div role="tablist" aria-label="Rubriques des marchés" className="scroll-x !gap-1.5 md:flex-wrap md:overflow-x-visible">{subs.map(([k, l, p]) => <button key={k} role="tab" type="button" aria-selected={sub === k} className="chip !min-h-8 !py-1 !px-3 text-sm inline-flex items-center gap-1" onClick={() => setSub(k)}>{l}{p && !pro && <Lock size={12} aria-label="Réservé à une offre supérieure" />}</button>)}</div>
    {st.data && <Note>{st.data.disclaimer}</Note>}<Err e={st.error} />
    {sub === "fx" && <FxPanel onSources={() => setSub("src")} />}
    {sub === "eco" && <EcoPanel st={st.data} onSources={() => setSub("src")} />}
    {sub === "brvm" && <BrvmPanel onSources={() => setSub("src")} />}
    {sub === "world" && <WorldPanel onSources={() => setSub("src")} />}
    {sub === "know" && <Knowledge />}
    {sub === "src" && st.data && <SourcesPanel st={st.data} />}
  </div>;
}

function FxPanel({ onSources }: { onSources: () => void }) {
  const q = useQ<Fx>("mk.fx"); const [sel, setSel] = useState("USD"); const [amt, setAmt] = useState("100000"); const [dir, setDir] = useState<"from" | "to">("from");
  if (q.error) return <Blocked e={q.error} onSources={onSources} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />;
  const d = q.data; const cur = d.rates.find((r) => r.code === sel) ?? d.rates[0]; const n = Number(amt.replace(/\s/g, "").replace(",", "."));
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
    <Panel title="Le franc CFA face aux devises" icon={Globe2} action={d.date ? <span className="text-xs text-muted">taux du {fmtDay(d.date)}</span> : undefined}>
      {!d.rates.length ? <p className="text-sm text-muted">Aucun taux disponible pour le moment.</p> : <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Taux de change en FCFA"><thead className="text-xs text-muted"><tr><th className="text-left py-1">Devise</th><th className="text-right">FCFA pour 1 unité</th><th className="text-right">Sur 30 jours</th></tr></thead>
        <tbody>{d.rates.map((r) => <tr key={r.code} className={`border-t border-[var(--line)] cursor-pointer hover:bg-subtle ${r.code === cur?.code ? "bg-subtle" : ""}`} onClick={() => setSel(r.code)}><td className="py-1.5"><b>{r.code}</b> <span className="text-muted">{r.name}</span></td><td className="text-right tabular-nums">{fr(r.perUnit, r.code === "EUR" ? 3 : r.perUnit < 10 ? 4 : 2)}</td><td className={`text-right tabular-nums ${tone(r.change30dPct)}`}>{r.code === "EUR" || r.code === "XAF" ? "parité fixe" : pctTxt(r.change30dPct)}</td></tr>)}</tbody></table></div>}
      <Note>{d.parity}</Note><SourceLine m={d.meta} />
    </Panel>
    <div className="flex flex-col gap-4">
      {cur && <Panel title={`Évolution — ${cur.code}`}>{cur.series.length > 1 ? <LineChart zero={false} format={(n) => `${fr(n, n < 10 ? 4 : 2)} FCFA`} label={`FCFA pour 1 ${cur.code} sur 30 jours`} w={340} data={cur.series.map((p) => ({ key: p.date, label: fmtDay(p.date), value: p.perUnit }))} /> : <p className="text-sm text-muted">Pas assez de points.</p>}</Panel>}
      {cur && <Panel title="Convertisseur"><div className="flex flex-col gap-2"><div className="grid grid-cols-2 gap-2"><Field label="Montant"><input className="input" inputMode="decimal" aria-label="Montant à convertir" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field><Field label="Sens"><select className="input" aria-label="Sens de conversion" value={dir} onChange={(e) => setDir(e.target.value as "from" | "to")}><option value="from">FCFA → {cur.code}</option><option value="to">{cur.code} → FCFA</option></select></Field></div>
        <p className="text-lg font-semibold tabular-nums" aria-live="polite">{Number.isFinite(n) && n > 0 ? (dir === "from" ? `${fr(n / cur.perUnit)} ${cur.code}` : formatFcfa(Math.round(n * cur.perUnit))) : "—"}</p><Note>Au taux de référence : les banques et bureaux de change appliquent leur propre cours et des frais.</Note></div></Panel>}
    </div>
  </div>;
}

function EcoPanel({ st, onSources }: { st?: Status; onSources: () => void }) {
  const q = useQ<Macro>("mk.macro"); const save = useAct("mk.config.save"); const country = st?.country ?? q.data?.country ?? null;
  if (q.error) return <Blocked e={q.error} onSources={onSources} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />;
  const d = q.data; const groups = [...new Set(d.countries.map((c) => c.group))]; const cell = (v: Val) => (v ? <span className="tabular-nums">{fr(v.value)} %<span className="block text-[11px] text-muted">{v.year}</span></span> : <span className="text-xs text-muted">non publié</span>);
  return <div className="flex flex-col gap-4">
    <Panel title="Votre pays de référence" icon={Landmark}><div className="flex flex-col gap-2">{st?.canEdit ? <Field label="Pays utilisé pour comparer vos placements et repérer un coût du capital"><select className="input" aria-label="Pays de référence" value={country ?? ""} disabled={save.isPending} onChange={(e) => save.mutate({ country: e.target.value || null })}><option value="">— Choisir —</option>{st.countries.filter((c) => c.group !== "Repères").map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field> : <p className="text-sm">{country ? st?.countries.find((c) => c.code === country)?.name : "Non défini (choix du propriétaire)."}</p>}<Err e={save.error} /></div></Panel>
    {st?.pro && <ProjectLinks />}
    <Panel title="Indicateurs économiques">{!d.countries.length ? <p className="text-sm text-muted">Aucune donnée disponible pour le moment.</p> : <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Indicateurs économiques par pays"><thead className="text-xs text-muted"><tr><th className="text-left py-1">Pays</th>{d.indicators.map((i) => <th key={i.key} className="text-right">{i.label}</th>)}</tr></thead>
      <tbody>{groups.map((g) => [<tr key={g}><td colSpan={d.indicators.length + 1} className="pt-3 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">{g}</td></tr>, ...d.countries.filter((c) => c.group === g).map((c) => <tr key={c.code} className={`border-t border-[var(--line)] ${c.code === country ? "bg-subtle font-medium" : ""}`}><td className="py-1.5">{c.name}</td>{d.indicators.map((i) => <td key={i.key} className="text-right">{cell(c.values[i.key] ?? null)}</td>)}</tr>)])}</tbody></table></div>}
      <Note>Chaque valeur indique l'année de la dernière publication. Pour plusieurs pays de l'UEMOA, le taux débiteur publié est ancien : à interpréter avec prudence.</Note><SourceLine m={d.meta} /></Panel>
  </div>;
}

function ProjectLinks() {
  const q = useQ<Links>("mk.links"); const cfg = useAct("ip.config.save"); const [done, setDone] = useState(false); const st = useQ<Status>("mk.status");
  if (q.error) return <Err e={q.error} />; if (!q.data) return null; const d = q.data;
  return <Panel title="Pour vos projets et placements" icon={TrendingUp}>{!d.country ? <p className="text-sm text-muted">{d.note}</p> : <div className="flex flex-col gap-2 text-sm">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2"><div className="rounded-xl bg-subtle p-2"><span className="text-xs text-muted block">Inflation — {d.countryName}</span><b>{d.inflation ? `${fr(d.inflation.value)} % (${d.inflation.year})` : "non publiée"}</b></div><div className="rounded-xl bg-subtle p-2"><span className="text-xs text-muted block">Taux débiteur bancaire</span><b>{d.lending ? `${fr(d.lending.value)} % (${d.lending.year})` : "non publié"}</b></div><div className="rounded-xl bg-subtle p-2"><span className="text-xs text-muted block">Taux d'intérêt réel</span><b>{d.real ? `${fr(d.real.value)} % (${d.real.year})` : "non publié"}</b></div></div>
    {d.lending && (d.lendingUsable ? (st.data?.canEdit && <div className="flex flex-wrap items-center gap-2"><button className="btn-ghost" disabled={cfg.isPending} onClick={() => cfg.mutate({ discountRatePct: d.lending!.value }, { onSuccess: () => setDone(true) })}>Utiliser {fr(d.lending.value)} % comme coût du capital</button>{done && <span className="text-ok text-xs" role="status">Coût du capital mis à jour (modifiable dans Réglages Pro).</span>}<Err e={cfg.error} /></div>) : <p className="text-xs text-warn">Dernier taux débiteur publié en {d.lending.year} : trop ancien pour servir de repère de coût du capital.</p>)}
    <b className="mt-1">Vos placements actifs face à l'inflation</b>
    {!d.placements.length ? <p className="text-xs text-muted">Aucun placement actif déclaré.</p> : d.placements.map((p) => <div key={p.id} className="flex justify-between gap-2 border-t border-[var(--line)] pt-1.5"><span className="min-w-0"><b className="block truncate">{p.name}</b><span className="text-xs text-muted">{formatFcfa(p.amount)} · rendement attendu {p.expectedRatePct === null ? "—" : `${fr(p.expectedRatePct)} %`}</span></span><span className="text-right shrink-0">{p.realPct === null ? <span className="text-xs text-muted">non calculable</span> : <StatusBadge tone={p.realPct < 0 ? "bad" : "ok"}>réel {pctTxt(p.realPct)}</StatusBadge>}</span></div>)}
    <Note>{d.note}</Note></div>}</Panel>;
}

function BrvmPanel({ onSources }: { onSources: () => void }) {
  const q = useQ<Brvm>("mk.brvm"); const [term, setTerm] = useState(""); const [sector, setSector] = useState(""); const [sort, setSort] = useState<"ticker" | "up" | "down" | "volume" | "yield">("ticker"); const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => { const t = term.trim().toUpperCase(); const xs = (q.data?.tickers ?? []).filter((x) => (!sector || x.sector === sector) && (!t || `${x.ticker} ${x.name}`.toUpperCase().includes(t))); const k = (x: Tk) => (sort === "up" ? -(x.changePct ?? -1e9) : sort === "down" ? x.changePct ?? 1e9 : sort === "volume" ? -x.volumeFcfa : sort === "yield" ? -(x.yieldPct ?? -1) : 0); return sort === "ticker" ? xs : [...xs].sort((a, b) => k(a) - k(b)); }, [q.data, term, sector, sort]);
  if (q.error) return <Blocked e={q.error} onSources={onSources} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />;
  const d = q.data; const b = d.breadth;
  return <div className="flex flex-col gap-4">
    <p className="card text-sm text-warn" role="note">Source communautaire non officielle : vérifiez toujours les cours sur brvm.org ou auprès de votre SGI avant toute décision.</p>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Panel title="Séance" action={d.asOf ? <span className="text-xs text-muted">{fmtDay(d.asOf)}</span> : undefined}><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-ok-bg/40 p-2"><TrendingUp size={16} className="mx-auto text-ok" aria-hidden="true" /><b className="block text-lg">{b.up}</b><span className="text-xs text-muted">en hausse</span></div><div className="rounded-xl bg-bad-bg/40 p-2"><TrendingDown size={16} className="mx-auto text-bad" aria-hidden="true" /><b className="block text-lg">{b.down}</b><span className="text-xs text-muted">en baisse</span></div><div className="rounded-xl bg-subtle p-2"><b className="block text-lg mt-4">{b.flat}</b><span className="text-xs text-muted">stables</span></div></div><Note>{d.indexNote}</Note></Panel>
      <Panel title="Secteurs (variation moyenne simple de la séance)"><div className="flex flex-col gap-1">{d.sectors.map((s) => <button key={s.name} className={`flex justify-between gap-2 rounded-lg px-2 py-1 text-sm text-left hover:bg-subtle ${sector === s.name ? "bg-subtle" : ""}`} onClick={() => setSector(sector === s.name ? "" : s.name)}><span>{s.name} <span className="text-xs text-muted">({s.count})</span></span><b className={`tabular-nums ${tone(s.avgChangePct)}`}>{pctTxt(s.avgChangePct)}</b></button>)}</div></Panel>
    </div>
    <Panel title="Titres cotés">
      <div className="flex flex-wrap gap-2 mb-2"><label className="relative flex-1 min-w-48"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" /><input className="input !pl-8" aria-label="Rechercher un titre" placeholder="Code ou société" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
        <select className="input !w-auto" aria-label="Secteur" value={sector} onChange={(e) => setSector(e.target.value)}><option value="">Tous les secteurs</option>{d.sectors.map((s) => <option key={s.name}>{s.name}</option>)}</select>
        <select className="input !w-auto" aria-label="Trier les titres" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="ticker">Par code</option><option value="up">Plus fortes hausses</option><option value="down">Plus fortes baisses</option><option value="volume">Montant échangé</option><option value="yield">Rendement du dividende</option></select></div>
      <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="Cours BRVM"><thead className="text-xs text-muted"><tr><th className="text-left py-1">Titre</th><th className="text-right">Cours</th><th className="text-right">Séance</th><th className="text-right hidden md:table-cell">Sur un an</th><th className="text-right hidden lg:table-cell">Échangé</th><th className="text-right hidden md:table-cell">Rdt div.</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.ticker} className="border-t border-[var(--line)] cursor-pointer hover:bg-subtle" onClick={() => setOpen(x.ticker)}><td className="py-1.5"><b>{x.ticker}</b><span className="block text-xs text-muted truncate max-w-56">{x.name}</span></td><td className="text-right tabular-nums">{fr(x.close, 0)}</td><td className={`text-right tabular-nums ${tone(x.changePct)}`}>{pctTxt(x.changePct)}</td><td className={`text-right tabular-nums hidden md:table-cell ${tone(x.change52Pct)}`}>{pctTxt(x.change52Pct)}</td><td className="text-right tabular-nums hidden lg:table-cell">{formatFcfa(x.volumeFcfa)}</td><td className="text-right tabular-nums hidden md:table-cell">{x.yieldPct === null ? "—" : `${fr(x.yieldPct)} %`}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="text-sm text-muted">Aucun titre pour ce filtre.</p>}
      <Note>Cours en FCFA, ajustés des fractionnements déclarés. Rendement du dividende = dernier dividende détaché (moins de 13 mois) ÷ cours.</Note><SourceLine m={d.meta} />
    </Panel>
    {open && <TickerSheet ticker={open} onClose={() => setOpen(null)} />}
  </div>;
}
function TickerSheet({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const q = useQ<Tk & { series: { d: string; c: number; v: number }[]; dividends: { date: string; amount: number; exercice: string }[]; splits: { date: string; ratio: number; note: string }[]; meta: Meta }>("mk.brvm.ticker", { ticker }); const d = q.data;
  return <Sheet title={d ? `${d.ticker} — ${d.name}` : ticker} onClose={onClose} back size="panel"><div className="flex flex-col gap-3 p-3"><Err e={q.error} />{!d ? <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" /> : <>
    <div className="grid grid-cols-2 gap-2 text-sm"><div className="card"><span className="text-xs text-muted">Cours ({fmtDay(d.date)})</span><b className="block text-lg">{formatFcfa(d.close)}</b><span className={tone(d.changePct)}>{pctTxt(d.changePct)}</span></div><div className="card"><span className="text-xs text-muted">Plus bas / plus haut sur la période</span><b className="block">{formatFcfa(d.low52)} – {formatFcfa(d.high52)}</b><span className={tone(d.change52Pct)}>{pctTxt(d.change52Pct)} sur un an</span></div></div>
    <Panel title="Cours de clôture (ajustés)">{d.series.length > 1 ? <LineChart zero={false} label={`Cours de ${d.ticker}`} w={360} data={d.series.map((p) => ({ key: p.d, label: fmtDay(p.d), value: p.c, sub: `échangé ${formatFcfa(p.v)}` }))} /> : <p className="text-sm text-muted">Historique indisponible.</p>}</Panel>
    <Panel title="Dividendes détachés">{d.dividends.length ? d.dividends.slice(0, 6).map((x) => <p key={x.date} className="flex justify-between text-sm border-t border-[var(--line)] pt-1 first:border-0"><span>{fmtDay(x.date)} · exercice {x.exercice}</span><b>{formatFcfa(x.amount)}</b></p>) : <p className="text-sm text-muted">Aucun dividende enregistré dans la source.</p>}{d.splits.length > 0 && <Note>Montants bruts à la date de détachement ; fractionnement : {d.splits.map((s) => `${fmtDay(s.date)} (rapport ${s.ratio})`).join(", ")}.</Note>}</Panel>
    <p className="text-xs text-muted">Secteur : {d.sector}. Informations indicatives, sans recommandation.</p><SourceLine m={d.meta} /></>}</div></Sheet>;
}

function WorldPanel({ onSources }: { onSources: () => void }) {
  const q = useQ<World>("mk.world");
  if (q.error) return <Blocked e={q.error} onSources={onSources} />; if (!q.data) return <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />; const d = q.data;
  if (d.keyMissing) return <div className="card text-sm flex flex-col gap-1"><b>Contexte mondial non disponible</b><p className="text-muted">La clé gratuite FRED n'est pas encore configurée sur le serveur de la plateforme. Dès qu'elle le sera, les taux de la BCE et de la Fed, le rendement des obligations américaines à 10 ans et le prix du Brent s'afficheront ici.</p></div>;
  return <div className="flex flex-col gap-4"><div className="grid gap-4 md:grid-cols-2">{d.series.map((s) => <Panel key={s.id} title={s.label} action={<span className="text-xs text-muted">{s.unit}</span>}><div className="flex items-baseline justify-between gap-2"><b className="text-2xl tabular-nums">{fr(s.last.value)}</b><span className="text-xs text-muted">{fmtDay(s.last.date)}{s.yearAgo ? ` · il y a un an : ${fr(s.yearAgo.value)}` : ""}</span></div>{s.points.length > 1 && <LineChart zero={false} format={(n) => `${fr(n)} ${s.unit}`} label={`${s.label}, 13 derniers mois`} w={340} data={s.points.map((p) => ({ key: p.date, label: fmtDay(p.date).slice(3), value: p.value }))} />}</Panel>)}</div>{!d.series.length && <p className="text-sm text-muted">Aucune série disponible pour le moment.</p>}<SourceLine m={d.meta} /></div>;
}

function Knowledge() {
  const [term, setTerm] = useState(""); const t = term.trim().toLowerCase();
  const secs = KNOWLEDGE.map((s) => ({ ...s, items: s.items.filter((i) => !t || `${s.title} ${i.title} ${i.text}`.toLowerCase().includes(t)) })).filter((s) => s.items.length);
  return <div className="flex flex-col gap-3"><label className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" /><input className="input !pl-8" aria-label="Rechercher dans les connaissances" placeholder="BRVM, dividende, inflation, obligation…" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
    {secs.map((s) => <Panel key={s.id} title={s.title} icon={BookOpen}><p className="text-sm text-muted mb-2">{s.intro}</p><div className="flex flex-col gap-1">{s.items.map((i) => <details key={i.title} className="rounded-lg border border-[var(--line)] px-3 py-2" open={!!t}><summary className="cursor-pointer text-sm font-medium">{i.title}</summary><p className="text-sm mt-1.5">{i.text}</p></details>)}</div></Panel>)}
    {!secs.length && <p className="text-sm text-muted">Aucun résultat.</p>}
    <Note>Repères généraux à but pédagogique, à confirmer auprès d'un professionnel agréé. Ce n'est ni un conseil ni une recommandation.</Note></div>;
}

function SourcesPanel({ st }: { st: Status }) {
  const save = useAct("mk.config.save");
  return <Panel title="Sources des données">{<div className="flex flex-col gap-2">{st.sources.map((s) => <div key={s.key} className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-1 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><b>{s.label}</b><span className="flex items-center gap-2">{!s.available ? <StatusBadge tone="muted" icon={Lock}>Formule Pro</StatusBadge> : <StatusBadge tone={s.enabled ? "ok" : "muted"}>{s.enabled ? "Activée" : "Désactivée"}</StatusBadge>}
      {st.canEdit && s.available && <button className="btn-ghost !py-1" disabled={save.isPending} onClick={() => save.mutate({ sources: { [s.key]: !s.enabled } })}>{s.enabled ? "Désactiver" : "Activer"}</button>}</span></div>
    <a className="text-xs underline inline-flex items-center gap-0.5 self-start" href={s.url} target="_blank" rel="noreferrer">{s.provider}<ExternalLink size={11} aria-hidden="true" /></a>
    <span className="text-xs text-muted">{s.note}</span>
    <span className="text-xs text-muted">{s.fetchedAt ? `Dernier relevé : ${dt(s.fetchedAt)}` : "Pas encore relevée."}{s.key === "world" && !st.fredKey ? " · clé FRED non configurée sur le serveur" : ""}</span>
    {s.error && <span className="text-xs text-warn">{s.error}</span>}</div>)}
    <Err e={save.error} />{!st.canEdit && <Note>Seul le propriétaire active ou désactive les sources.</Note>}</div>}</Panel>;
}
