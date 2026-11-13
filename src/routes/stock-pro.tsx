import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { formatQty } from "@/domain/quantity";
import type { ReportData } from "@/domain/exports";
import { exportReport, type ExportFormat } from "@/lib/report-export";

type Open = (productId: string, variantId?: string) => void;
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-bad text-sm" role="alert">{(e as Error).message}</p> : null);
const Kpi = ({ label, value, tone = "", hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) => <div className="card"><div className="text-muted text-xs">{label}</div><div className={`font-semibold ${tone}`}>{value}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>;
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-muted flex flex-col gap-1">{label}{children}</label>;
const Notes = ({ items }: { items: string[] }) => <div className="text-xs text-muted flex flex-col gap-1">{items.map((n) => <p key={n}>{n}</p>)}</div>;
const RISK_TONE: Record<string, string> = { out: "text-bad", high: "text-bad", medium: "text-warn", low: "text-ok", none: "text-muted" };
const CLS_TONE: Record<string, string> = { dead: "text-bad", overstock: "text-warn", slow: "text-warn", normal: "text-ok", nodata: "text-muted" };
const DAYS = [30, 60, 90, 180, 365];
const key = (...p: unknown[]) => ["stkp", ...p];

export function ProLock() {
  return <div className="card flex gap-2 items-start text-sm text-soft"><Lock size={16} className="mt-0.5 shrink-0 text-accent-text" /><span>Analyses de rotation, prévisions de demande, réapprovisionnement suggéré, optimisation multi-magasins, anomalies, simulations et rapports PDF/Excel/CSV : disponibles avec la formule <b>Pro</b>. Vos mouvements et historiques restent intacts quand vous changez de formule.</span></div>;
}

// ------------------------------------------------------------------ analyse
type AItem = { shopId: string; shop: string; key: string; productId: string; variantId: string; name: string; category: string; qty: number; value: number; sold: number; dailyAvg: number; rotation: number | null; coverDays: number | null; cls: string; clsLabel: string; abc: string; change: { pct: number | null; flag: string | null }; risk: string; riskLabel: string; daysToOut: number | null; excess: number; lastSaleDaysAgo: number | null };
type Analysis = { period: { from: string; to: string; days: number }; scope: string[]; summary: { articles: number; value: number; classes: { dead: number; overstock: number; slow: number; normal: number }; risks: { out: number; high: number; medium: number }; excessValue: number; deadValue: number; noForecast: number; abcValue: { A: number; B: number; C: number }; abcCount: { A: number; B: number; C: number }; surges: number; drops: number }; byShop: { name: string; articles: number; value: number; sold: number; excess: number; atRisk: number }[]; byCategory: { name: string; articles: number; value: number; sold: number; excess: number; atRisk: number }[]; items: AItem[]; total: number; notes: string[] };
export function ProAnalysis({ onOpen }: { onOpen: Open }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ days: 90, abcBy: "sales", all: false, cover: 14 }); const [flt, setFlt] = useState<"" | "risk" | "overstock" | "slow" | "dead">("risk"); const [sim, setSim] = useState<AItem | null>(null);
  const q = useQuery({ queryKey: key("analysis", s.shopId, f), retry: 1, queryFn: () => api<Analysis>(s, "stkp.analysis", { days: f.days, abcBy: f.abcBy, cover: f.cover, ...(f.all ? { shopId: "all" } : {}) }) }); const d = q.data;
  const rows = (d?.items ?? []).filter((i) => !flt || (flt === "risk" ? i.risk === "out" || i.risk === "high" || i.risk === "medium" : i.cls === flt));
  return (
    <div className="flex flex-col gap-3">
      <div className="card grid grid-cols-2 gap-2">
        <Field label="Période d'analyse"><select className="input" aria-label="Période d'analyse" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>{DAYS.map((x) => <option key={x} value={x}>{x} jours</option>)}</select></Field>
        <Field label="Classement ABC selon"><select className="input" aria-label="Classement ABC" value={f.abcBy} onChange={(e) => setF({ ...f, abcBy: e.target.value })}><option value="sales">Valeur des ventes</option><option value="stock">Valeur du stock</option><option value="moves">Jours de vente</option></select></Field>
        {s.shops.length > 1 && <Field label="Boutiques"><select className="input" aria-label="Boutiques analysées" value={f.all ? "all" : "one"} onChange={(e) => setF({ ...f, all: e.target.value === "all" })}><option value="one">Boutique actuelle</option><option value="all">Toutes mes boutiques</option></select></Field>}
        <Field label="Couverture cible (jours)"><input className="input" aria-label="Couverture cible" inputMode="numeric" value={f.cover} onChange={(e) => setF({ ...f, cover: Math.max(1, Math.min(180, Number(e.target.value.replace(/\D/g, "")) || 1)) })} /></Field>
      </div>
      {q.isLoading && <p className="text-sm text-muted" role="status">Calcul en cours…</p>}<Err e={q.error} />
      {d && <>
        <p className="text-xs text-muted">Période : {d.period.from} → {d.period.to} · {d.scope.join(", ")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="Articles analysés" value={d.summary.articles} /><Kpi label="Valeur du stock (coût)" value={formatFcfa(d.summary.value)} />
          <Kpi label="Risque de rupture" value={d.summary.risks.out + d.summary.risks.high} tone={d.summary.risks.out + d.summary.risks.high ? "text-bad" : ""} hint={`dont ${d.summary.risks.out} déjà en rupture`} />
          <Kpi label="Surstock" value={d.summary.classes.overstock} tone="text-warn" hint={`Capital en excès : ${formatFcfa(d.summary.excessValue)}`} />
          <Kpi label="Rotation lente" value={d.summary.classes.slow} /><Kpi label="Sans vente" value={d.summary.classes.dead} tone="text-bad" hint={`Immobilisé : ${formatFcfa(d.summary.deadValue)}`} />
          <Kpi label="Consommation en hausse" value={d.summary.surges} /><Kpi label="Consommation en baisse" value={d.summary.drops} />
        </div>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Classement ABC</h2>{(["A", "B", "C"] as const).map((k) => <div key={k} className="text-sm flex justify-between border-t border-[var(--line)] pt-1"><span>Classe {k}</span><span className="text-muted">{d.summary.abcCount[k]} article(s) · stock {formatFcfa(d.summary.abcValue[k])}</span></div>)}</section>
        {d.summary.noForecast > 0 && <p className="card text-sm text-warn">{d.summary.noForecast} article(s) en stock sans prévision : moins de 14 jours de ventes depuis la première vente.</p>}
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Par boutique</h2>{d.byShop.map((x) => <div key={x.name} className="text-sm flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="truncate">{x.name}</span><span className="text-muted text-right">{formatFcfa(x.value)} · {x.atRisk} à risque · excès {formatFcfa(x.excess)}</span></div>)}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Par catégorie</h2>{d.byCategory.map((x) => <div key={x.name} className="text-sm flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="truncate">{x.name}</span><span className="text-muted text-right">{x.articles} art. · {formatFcfa(x.value)} · vendu {formatQty(x.sold)}</span></div>)}</section>
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filtrer les articles">{([["risk", "À risque"], ["overstock", "Surstock"], ["slow", "Rotation lente"], ["dead", "Sans vente"], ["", "Tous"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={flt === k} onClick={() => setFlt(k)}>{l}</button>)}</div>
        {rows.length === 0 && <p className="card text-sm text-soft">Aucun article dans cette catégorie.</p>}
        <ul className="flex flex-col gap-2">{rows.map((i) => (
          <li key={`${i.shopId}${i.key}`} className="card flex flex-col gap-1"><button className="text-left" onClick={() => onOpen(i.productId, i.variantId)}><span className="flex justify-between gap-2"><b className="truncate">{i.name}</b><span className="text-xs text-muted">ABC {i.abc}</span></span>
            <span className="block text-xs text-muted">{d.scope.length > 1 ? `${i.shop} · ` : ""}stock {formatQty(i.qty)} · vendu {formatQty(i.sold)} · {i.coverDays !== null ? `couverture ${i.coverDays} j` : "pas de couverture"}{i.rotation !== null ? ` · rotation ${i.rotation}` : ""}</span>
            <span className="block text-xs"><span className={CLS_TONE[i.cls]}>{i.clsLabel}</span> · <span className={RISK_TONE[i.risk]}>{i.riskLabel}{i.daysToOut !== null ? ` (${i.daysToOut} j)` : ""}</span>{i.change.flag ? ` · conso ${i.change.flag} (${i.change.pct}%)` : ""}{i.excess > 0 ? ` · excès ${formatFcfa(i.excess)}` : ""}</span></button>
            {i.sold > 0 && !f.all && <button className="btn-ghost !py-1 text-sm self-start" onClick={() => setSim(i)}>Simuler</button>}</li>))}</ul>
        {d.total > d.items.length && <p className="text-xs text-muted">{d.items.length} articles affichés sur {d.total} (les plus à risque et les plus immobilisés d'abord) ; le rapport exporte le détail.</p>}
        <Notes items={d.notes} />
      </>}
      {sim && <SimSheet productId={sim.productId} variantId={sim.variantId} name={sim.name} onClose={() => setSim(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ simulation
type Sim = { name: string; qty: number; horizon: number; assumptions: { dailyDemand: number; sd: number; price: number; cost: number; lead: { days: number; source: string }; source: string; confidence: string }; scenarios: { label: string; note: string; result: { stockoutDay: number | null; lostUnits: number; lostRevenue: number; lostMargin: number; endQty: number; lostUnitsHigh: number } }[]; notes: string[] };
export function SimSheet({ productId, variantId, name, onClose }: { productId: string; variantId: string; name: string; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const [qty, setQty] = useState(""); const [arr, setArr] = useState(""); const [go, setGo] = useState({ qty: "", arr: "" });
  const q = useQuery({ queryKey: key("sim", s.shopId, productId, variantId, go), retry: 0, queryFn: () => api<Sim>(s, "stkp.simulate", { productId, variantId, ...(go.qty ? { orderQty: go.qty.replace(",", ".") } : {}), ...(go.arr ? { arrivalDays: go.arr } : {}) }) }); const d = q.data;
  return (
    <Sheet title={`Simulation · ${name}`} onClose={onClose} back>
      <div className="card grid grid-cols-2 gap-2"><Field label="Quantité commandée"><input className="input" aria-label="Quantité de la commande simulée" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field><Field label="Livraison dans (jours)"><input className="input" aria-label="Délai de livraison simulé" inputMode="numeric" value={arr} onChange={(e) => setArr(e.target.value.replace(/\D/g, ""))} /></Field>
        <button className="btn col-span-2" disabled={q.isFetching} onClick={() => setGo({ qty, arr })}>Comparer les scénarios</button></div>
      {q.isLoading && <p className="text-sm text-muted" role="status">Calcul…</p>}<Err e={q.error} />
      {d && <>
        <p className="text-xs text-muted">Stock actuel {formatQty(d.qty)} · demande retenue {d.assumptions.dailyDemand}/jour (±{d.assumptions.sd}) sur {d.horizon} jours · délai {d.assumptions.lead.days} j ({d.assumptions.lead.source}) · méthode : {d.assumptions.source}</p>
        {d.scenarios.map((x) => <div key={x.label} className="card flex flex-col gap-1"><b className="text-sm">{x.label}</b><span className="text-xs text-muted">{x.note}</span><span className="text-sm">{x.result.stockoutDay ? <span className="text-bad">Rupture au jour {x.result.stockoutDay}</span> : <span className="text-ok">Pas de rupture</span>} · ventes manquées estimées {formatQty(x.result.lostUnits)} u. (≈ {formatFcfa(x.result.lostRevenue)}, marge ≈ {formatFcfa(x.result.lostMargin)}) · pessimiste {formatQty(x.result.lostUnitsHigh)} u. · stock final {formatQty(x.result.endQty)}</span></div>)}
        <Notes items={d.notes} />
      </>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ réapprovisionnement
type RItem = { shopId: string; key: string; productId: string; variantId: string; name: string; unit: string; qty: number; onOrder: number; inTransit: number; cost: number; min: number; supplierId: string; supplier: string; lead: { days: number; source: string }; risk: string; riskLabel: string; daysToOut: number | null; reorderPoint: number; safety: number; suggestedQty: number; suggestedMin: number; estimatedCost: number; formula: string; forecast: { daily: number | null; total?: number; low?: number; high?: number; horizon?: number; confidence?: string; method?: string; activeDays?: number; salesDays?: number; seasonal?: boolean; reason?: string; limits: string[] }; data: string };
type Repl = { period: { from: string; to: string; days: number }; params: { cover: number; horizon: number }; items: RItem[]; total: number; insufficient: { count: number; names: string[] }; totalEstimated: number; notes: string[] };
export function ProReplenish({ onOpen }: { onOpen: Open }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const manager = s.role === "owner" || s.role === "manager"; const [f, setF] = useState({ days: 90, cover: 14, horizon: 30 }); const [pick, setPick] = useState<Record<string, string>>({}); const [open, setOpen] = useState(""); const [draft, setDraft] = useState(false); const [sim, setSim] = useState<RItem | null>(null);
  const q = useQuery({ queryKey: key("repl", s.shopId, f), retry: 1, queryFn: () => api<Repl>(s, "stkp.replenish", f) }); const d = q.data; const sel = (d?.items ?? []).filter((i) => pick[i.key] !== undefined);
  const setMin = useMutation({ mutationFn: (i: RItem) => api(s, "stk.settings", { productId: i.productId, minStock: i.suggestedMin }), onSuccess: () => { void qc.invalidateQueries(); } });
  return (
    <div className="flex flex-col gap-3">
      <div className="card grid grid-cols-3 gap-2"><Field label="Historique (j)"><select className="input !px-2" aria-label="Historique des ventes" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>{DAYS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
        <Field label="Couverture cible (j)"><input className="input !px-2" aria-label="Couverture cible (jours)" inputMode="numeric" value={f.cover} onChange={(e) => setF({ ...f, cover: Math.max(1, Math.min(180, Number(e.target.value.replace(/\D/g, "")) || 1)) })} /></Field>
        <Field label="Prévision sur (j)"><select className="input !px-2" aria-label="Horizon de prévision" value={f.horizon} onChange={(e) => setF({ ...f, horizon: Number(e.target.value) })}>{[14, 30, 60, 90].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field></div>
      <p className="text-xs text-muted">Ce sont des <b>suggestions</b> : rien n'est commandé sans votre validation.</p>
      {q.isLoading && <p className="text-sm text-muted" role="status">Calcul en cours…</p>}<Err e={q.error} />
      {d && <>
        <p className="text-xs text-muted">{d.total} article(s) à traiter · coût estimé des suggestions {formatFcfa(d.totalEstimated)} · ventes du {d.period.from} au {d.period.to}</p>
        {d.insufficient.count > 0 && <p className="card text-sm text-warn">{d.insufficient.count} article(s) sans prévision (historique insuffisant) : {d.insufficient.names.slice(0, 5).join(", ")}{d.insufficient.count > 5 ? "…" : ""}.</p>}
        {d.items.length === 0 && <p className="card text-sm text-soft">Aucun article ne demande de réapprovisionnement selon ces paramètres.</p>}
        <ul className="flex flex-col gap-2">{d.items.map((i) => { const on = pick[i.key] !== undefined; return (
          <li key={i.key} className="card flex flex-col gap-1">
            <div className="flex gap-2 items-start">{manager && <input type="checkbox" className="mt-1" aria-label={`Sélectionner ${i.name}`} checked={on} onChange={(e) => setPick((p) => { const n = { ...p }; if (e.target.checked) n[i.key] = String(i.suggestedQty); else delete n[i.key]; return n; })} />}
              <button className="text-left flex-1 min-w-0" onClick={() => setOpen(open === i.key ? "" : i.key)}><span className="flex justify-between gap-2"><b className="truncate">{i.name}</b><span className={`text-xs ${RISK_TONE[i.risk]}`}>{i.riskLabel}</span></span>
                <span className="block text-xs text-muted">stock {formatQty(i.qty)}{i.onOrder ? ` · en commande ${formatQty(i.onOrder)}` : ""}{i.inTransit ? ` · en transit ${formatQty(i.inTransit)}` : ""} · {i.daysToOut !== null ? `rupture dans ~${i.daysToOut} j` : "—"} · délai {i.lead.days} j</span>
                <span className="block text-sm">Suggéré : <b>{formatQty(i.suggestedQty)}</b>{i.suggestedQty ? ` ≈ ${formatFcfa(i.estimatedCost)}` : ""}{i.supplier ? ` · ${i.supplier}` : ""}</span></button></div>
            {on && <input className="input" aria-label={`Quantité à commander ${i.name}`} inputMode="decimal" value={pick[i.key]} onChange={(e) => setPick({ ...pick, [i.key]: e.target.value })} />}
            {open === i.key && <div className="text-xs text-soft flex flex-col gap-1 border-t border-[var(--line)] pt-1">
              {i.forecast.daily !== null ? <p><b>Prévision :</b> {i.forecast.daily}/jour, soit {i.forecast.total} sur {i.forecast.horizon} j (intervalle {i.forecast.low}–{i.forecast.high}) · confiance <b>{i.forecast.confidence}</b> · {i.forecast.activeDays} jours d'historique dont {i.forecast.salesDays} avec ventes. Méthode : {i.forecast.method}.</p> : <p><b>Pas de prévision :</b> {i.forecast.reason}</p>}
              <p><b>Données :</b> {i.data}</p><p><b>Calcul :</b> {i.formula}. Point de commande {i.reorderPoint} (sécurité {i.safety}).</p>{i.forecast.limits.map((l) => <p key={l} className="text-muted">• {l}</p>)}
              <div className="flex gap-2 flex-wrap"><button className="btn-ghost !py-1 text-sm" onClick={() => onOpen(i.productId, i.variantId)}>Fiche de stock</button><button className="btn-ghost !py-1 text-sm" onClick={() => setSim(i)}>Simuler</button>{manager && i.suggestedMin !== i.min && <button className="btn-ghost !py-1 text-sm" disabled={setMin.isPending} onClick={() => setMin.mutate(i)}>Appliquer le seuil {i.suggestedMin} (actuel {i.min})</button>}</div></div>}
          </li>); })}</ul>
        {setMin.error && <Err e={setMin.error} />}
        {manager && sel.length > 0 && <div className="sticky bottom-20 card flex items-center justify-between gap-2"><span className="text-sm">{sel.length} sélectionné(s)</span><button className="btn" onClick={() => setDraft(true)}>Créer un brouillon de commande</button></div>}
        <Notes items={d.notes} />
      </>}
      {draft && <DraftOrder lines={sel.map((i) => ({ productId: i.productId, variantId: i.variantId, name: i.name, qty: pick[i.key]!, cost: i.cost, supplierId: i.supplierId }))} onClose={() => setDraft(false)} onDone={() => { setDraft(false); setPick({}); }} />}
      {sim && <SimSheet productId={sim.productId} variantId={sim.variantId} name={sim.name} onClose={() => setSim(null)} />}
    </div>
  );
}
function DraftOrder({ lines, onClose, onDone }: { lines: { productId: string; variantId: string; name: string; qty: string; cost: number; supplierId: string }[]; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const id = useRef(crypto.randomUUID().replace(/-/g, "").slice(0, 24)); const sups = useQuery({ queryKey: ["purch-sup", s.shopId, "active"], retry: 1, queryFn: () => api<{ suppliers: { id: string; name: string }[] }>(s, "purch.supplier.list", { status: "active" }) });
  const [sup, setSup] = useState(lines.find((l) => l.supplierId)?.supplierId ?? ""); const [made, setMade] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api<{ number: string }>(s, "purch.po.save", { clientId: id.current, supplierId: sup, lines: lines.map((l) => ({ productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), qty: l.qty.replace(",", "."), unitCost: l.cost })) }), onSuccess: (r) => setMade(r.number) });
  const bad = lines.some((l) => !/^\d+([.,]\d{1,3})?$/.test(l.qty.trim()) || Number(l.qty.replace(",", ".")) <= 0);
  return (
    <Sheet title="Brouillon de commande" onClose={made ? onDone : onClose} back>
      {made ? <><p className="card text-sm text-ok" role="status">Brouillon {made} créé. Il n'est ni soumis ni validé : ouvrez Achats → Commandes pour le relire, l'ajuster puis le soumettre.</p><button className="btn" onClick={onDone}>Terminer</button></> : <>
        <p className="text-xs text-muted">Vous validez ici le contenu d'un <b>brouillon</b> : il ne part au fournisseur qu'après soumission et validation dans Achats.</p>
        <Field label="Fournisseur"><select className="input" aria-label="Fournisseur du brouillon" value={sup} onChange={(e) => setSup(e.target.value)}><option value="">Choisir…</option>{(sups.data?.suppliers ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        {lines.map((l) => <p key={l.productId + l.variantId} className="text-sm border-t border-[var(--line)] pt-1">{l.name} · <b>{l.qty}</b> × {formatFcfa(l.cost)}</p>)}
        {lines.some((l) => !(l.cost > 0)) && <p className="text-xs text-warn">Certains articles n'ont pas de coût : le prix d'achat sera à compléter dans le brouillon.</p>}
        <Err e={m.error} /><button className="btn" disabled={m.isPending || !sup || bad} onClick={() => m.mutate()}>Créer le brouillon</button></>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ multi-magasins
type Net = { period: { from: string; to: string; days: number }; scope: string[]; shops: { shopId: string; shop: string; articles: number; soldUnits: number; salesValue: number; stockValue: number; rotation: number | null; outOfStock: number; low: number; dead: number; inTransitIn: number; inTransitOut: number }[]; rebalance: { name: string; imbalanced: boolean; positions: { shopId: string; shop: string; qty: number; inTransit: number; dailyAvg: number; coverDays: number | null }[]; hints: { fromShopId: string; toShopId: string; qty: number; from: string; to: string; why: string }[]; productIds: Record<string, { productId: string; variantId: string }> }[]; openTransfers: { id: string; number: string; from: string; to: string; inTransit: number; late: boolean; daysInTransit: number }[]; notes: string[] };
export function ProNetwork({ onGoTransfers }: { onGoTransfers: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const manager = s.role === "owner" || s.role === "manager"; const q = useQuery({ queryKey: key("net", s.shopId), retry: 1, queryFn: () => api<Net>(s, "stkp.network", {}) }); const d = q.data; const ids = useRef<Record<string, string>>({}); const [msg, setMsg] = useState("");
  const prep = useMutation({ mutationFn: (h: { to: string; toShopId: string; productId: string; variantId: string; qty: number; k: string }) => api<{ number: string }>(s, "xfer.save", { clientId: (ids.current[h.k] ??= crypto.randomUUID().replace(/-/g, "").slice(0, 24)), toShopId: h.toShopId, lines: [{ productId: h.productId, ...(h.variantId ? { variantId: h.variantId } : {}), qty: h.qty }] }), onSuccess: (r, h) => { setMsg(`Transfert ${r.number} préparé vers ${h.to} : validez le départ dans l'onglet Transferts.`); void qc.invalidateQueries(); }, onError: (e) => setMsg((e as Error).message) });
  return (
    <div className="flex flex-col gap-3">
      {q.isLoading && <p className="text-sm text-muted" role="status">Calcul en cours…</p>}<Err e={q.error} />
      {d && <>
        {d.scope.length < 2 && <p className="card text-sm text-soft">Une seule boutique accessible : la comparaison et les suggestions de transfert demandent au moins deux boutiques.</p>}
        <section className="flex flex-col gap-2"><h2 className="font-semibold">Performance par boutique ({d.period.days} j)</h2>{d.shops.map((x) => <div key={x.shopId} className="card text-sm flex flex-col gap-0.5"><b>{x.shop}</b><span className="text-soft">Ventes {formatFcfa(x.salesValue)} ({formatQty(x.soldUnits)} u.) · stock {formatFcfa(x.stockValue)} · rotation {x.rotation ?? "—"}</span><span className="text-xs text-muted">{x.outOfStock} en rupture · {x.low} sous le minimum · {x.dead} sans vente · transit entrant {formatQty(x.inTransitIn)} / sortant {formatQty(x.inTransitOut)}</span></div>)}</section>
        <section className="flex flex-col gap-2"><h2 className="font-semibold">Déséquilibres et transferts suggérés</h2>{d.rebalance.length === 0 && <p className="card text-sm text-soft">Aucun déséquilibre détecté : pas de transfert utile avant un nouvel achat.</p>}
          {d.rebalance.map((r) => <div key={r.name} className="card flex flex-col gap-1"><b>{r.name}</b>{r.positions.map((p) => <span key={p.shopId} className="text-xs text-soft">{p.shop} : {formatQty(p.qty)} en stock{p.inTransit ? ` (+${formatQty(p.inTransit)} en transit)` : ""} · {p.dailyAvg}/jour · {p.coverDays !== null ? `${p.coverDays} j de couverture` : "pas de vente"}</span>)}
            {r.hints.map((h, i) => <div key={i} className="border-t border-[var(--line)] pt-1 text-sm"><p>Transférer <b>{formatQty(h.qty)}</b> de {h.from} vers {h.to}</p><p className="text-xs text-muted">{h.why}</p>{manager && h.fromShopId === s.shopId && r.productIds[h.fromShopId] ? <button className="btn-ghost !py-1 text-sm mt-1" disabled={prep.isPending} onClick={() => prep.mutate({ to: h.to, toShopId: h.toShopId, productId: r.productIds[h.fromShopId]!.productId, variantId: r.productIds[h.fromShopId]!.variantId, qty: h.qty, k: `${r.name}${h.toShopId}${h.qty}` })}>Préparer ce transfert</button> : <p className="text-xs text-muted">À préparer depuis la boutique {h.from}.</p>}</div>)}</div>)}
          {msg && <p className="text-sm text-warn" role="status">{msg} <button className="underline" onClick={onGoTransfers}>Transferts</button></p>}</section>
        <section className="flex flex-col gap-2"><h2 className="font-semibold">Marchandises en transit</h2>{d.openTransfers.length === 0 && <p className="card text-sm text-soft">Aucun transfert en cours.</p>}{d.openTransfers.map((t) => <div key={t.id} className="card text-sm flex justify-between gap-2"><span>{t.number} · {t.from} → {t.to}</span><span className={t.late ? "text-bad" : "text-muted"}>{t.late ? "Non réceptionné · " : ""}{formatQty(t.inTransit)} u. · {t.daysInTransit} j</span></div>)}</section>
        <Notes items={d.notes} />
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ anomalies
type Ano = { key: string; kind: string; priority: "high" | "medium" | "low"; title: string; justification: string; evidence: { id: string; at: string; label: string; qty: number; by: string; ref: string }[]; check: string; caveat: string; productId?: string; variantId?: string };
const PRI = { high: "Priorité haute", medium: "Priorité moyenne", low: "Priorité basse" } as const; const PRI_TONE = { high: "text-bad", medium: "text-warn", low: "text-info" } as const;
export function ProAnomalies({ onOpen }: { onOpen: Open }) {
  const { session } = useSession(); const s = session!; const [days, setDays] = useState(60); const [open, setOpen] = useState(""); const manager = s.role === "owner" || s.role === "manager";
  const q = useQuery({ queryKey: key("ano", s.shopId, days), enabled: manager, retry: 1, queryFn: () => api<{ period: { from: string; to: string }; anomalies: Ano[]; total: number; counts: Record<string, number>; caveat: string; notes: string[] }>(s, "stkp.anomalies", { days }) }); const d = q.data;
  if (!manager) return <p className="card text-sm text-soft">Les anomalies sont réservées aux gérants et au propriétaire.</p>;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Période examinée"><select className="input" aria-label="Période des anomalies" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180].map((x) => <option key={x} value={x}>{x} jours</option>)}</select></Field>
      {q.isLoading && <p className="text-sm text-muted" role="status">Analyse…</p>}<Err e={q.error} />
      {d && <>
        <p className="card text-xs text-soft">{d.caveat}</p><p className="text-xs text-muted">{d.total} anomalie(s) : {d.counts.high} haute(s), {d.counts.medium} moyenne(s), {d.counts.low} basse(s) · {d.period.from} → {d.period.to}</p>
        {d.anomalies.length === 0 && <p className="card text-sm text-soft">Aucune situation inhabituelle détectée sur cette période.</p>}
        <ul className="flex flex-col gap-2">{d.anomalies.map((a) => <li key={a.key} className="card flex flex-col gap-1"><button className="text-left flex gap-2 items-start" onClick={() => setOpen(open === a.key ? "" : a.key)}><AlertTriangle size={16} className={`mt-0.5 shrink-0 ${PRI_TONE[a.priority]}`} /><span><span className={`block text-sm font-medium ${PRI_TONE[a.priority]}`}>{a.title}</span><span className="block text-xs text-muted">{PRI[a.priority]} · {a.justification}</span></span></button>
          {open === a.key && <div className="text-xs text-soft flex flex-col gap-1 border-t border-[var(--line)] pt-1"><p><b>Contrôle recommandé :</b> {a.check}</p>{a.evidence.length > 0 && <div><b>Preuves ({a.evidence.length}) :</b>{a.evidence.map((e) => <p key={e.id} className="text-muted">{new Date(e.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {e.label} · {e.qty > 0 ? "+" : ""}{formatQty(e.qty)}{e.by ? ` · ${e.by}` : ""}</p>)}</div>}<p className="text-muted">{a.caveat}</p>{a.productId && <button className="btn-ghost !py-1 text-sm self-start" onClick={() => onOpen(a.productId!, a.variantId)}>Fiche de stock</button>}</div>}</li>)}</ul>
        <Notes items={d.notes} />
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ lots, péremptions, produits à forte valeur
type Prod = { horizon: number; features: { lots: boolean; serials: boolean }; lots: { lotId: string; productId: string; variantId: string; name: string; lotNo: string; expiresAt: string; daysLeft: number; remaining: number; value: number; status: string; fefoFirst: boolean }[]; expired: { count: number; value: number }; soon: { count: number; value: number }; highValue: { productId: string; variantId: string; name: string; qty: number; cost: number; value: number; location: string; tracking: string; serialsInStock: number | null; lastMoveAt: string | null }[]; notes: string[] };
export function ProProducts({ onOpen }: { onOpen: Open }) {
  const { session } = useSession(); const s = session!; const [days, setDays] = useState(90); const q = useQuery({ queryKey: key("prod", s.shopId, days), retry: 1, queryFn: () => api<Prod>(s, "stkp.products", { days }) }); const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Péremptions dans les"><select className="input" aria-label="Horizon des péremptions" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180].map((x) => <option key={x} value={x}>{x} jours</option>)}</select></Field>
      {q.isLoading && <p className="text-sm text-muted" role="status">Chargement…</p>}<Err e={q.error} />
      {d && <>
        <div className="grid grid-cols-2 gap-2"><Kpi label="Lots périmés" value={d.expired.count} tone={d.expired.count ? "text-bad" : ""} hint={`Valeur ${formatFcfa(d.expired.value)}`} /><Kpi label="Expirent sous 30 j" value={d.soon.count} tone={d.soon.count ? "text-warn" : ""} hint={`Valeur ${formatFcfa(d.soon.value)}`} /></div>
        <section className="flex flex-col gap-2"><h2 className="font-semibold">Lots à surveiller (FEFO)</h2>{d.lots.length === 0 && <p className="card text-sm text-soft">Aucun lot avec stock restant n'expire dans cet horizon.</p>}
          {d.lots.map((l) => <button key={l.lotId} className="card text-left" onClick={() => onOpen(l.productId, l.variantId)}><span className="flex justify-between gap-2"><b className="truncate">{l.name} · lot {l.lotNo}</b><span className={l.daysLeft < 0 ? "text-bad text-xs" : "text-warn text-xs"}>{l.status}</span></span><span className="block text-xs text-muted">Expire le {l.expiresAt.split("-").reverse().join("/")} ({l.daysLeft < 0 ? `${-l.daysLeft} j de retard` : `dans ${l.daysLeft} j`}) · reste {formatQty(l.remaining)} · {formatFcfa(l.value)}{l.fefoFirst ? " · à vendre en premier" : ""}</span></button>)}</section>
        <section className="flex flex-col gap-2"><h2 className="font-semibold">Produits à forte valeur</h2>{d.highValue.map((h) => <button key={h.productId + h.variantId} className="card text-left" onClick={() => onOpen(h.productId, h.variantId)}><span className="flex justify-between gap-2"><b className="truncate">{h.name}</b><span className="text-sm">{formatFcfa(h.value)}</span></span><span className="block text-xs text-muted">{formatQty(h.qty)} × {formatFcfa(h.cost)}{h.location ? ` · ${h.location}` : ""}{h.tracking ? ` · suivi ${h.tracking === "serial" ? "par série" : "par lot"}` : ""}{h.serialsInStock !== null ? ` · ${h.serialsInStock} n° de série en stock` : ""}</span></button>)}</section>
        <Notes items={d.notes} />
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ rapports Pro
const SECTIONS: [string, string][] = [["valuation", "Valorisation par magasin et catégorie"], ["rotation", "Rotation et couverture"], ["overstock", "Surstocks et sous-stocks"], ["ruptures", "Prévisions de rupture"], ["losses", "Pertes et écarts d'inventaire"], ["moves", "Historique des mouvements"], ["supply", "Performance des approvisionnements"], ["compare", "Comparaison avec la période précédente"]];
export function ProReports() {
  const { session } = useSession(); const s = session!; const manager = s.role === "owner" || s.role === "manager"; const [days, setDays] = useState(30); const [all, setAll] = useState(false); const [sel, setSel] = useState<string[]>(SECTIONS.map(([k]) => k)); const [fmt, setFmt] = useState<ExportFormat | null>(null);
  const body = { days, sections: sel, ...(all ? { shopId: "all" } : {}) };
  const q = useQuery({ queryKey: key("rep", s.shopId, days, all, sel), enabled: manager && sel.length > 0, retry: 1, queryFn: () => api<{ export: ReportData; preview: { name: string; rows: number }[] }>(s, "stkp.report", body) });
  const exp = useMutation({ mutationFn: async (f: ExportFormat) => { setFmt(f); try { const r = await api<{ export: ReportData }>(s, "stkp.report", body); await exportReport({ ...r.export, title: "Stock Pro — rapport" }, f); } finally { setFmt(null); } } });
  if (!manager) return <p className="card text-sm text-soft">Les rapports sont réservés aux gérants et au propriétaire.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="card grid grid-cols-2 gap-2"><Field label="Période"><select className="input" aria-label="Période du rapport" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180, 365].map((x) => <option key={x} value={x}>{x} jours</option>)}</select></Field>
        {s.shops.length > 1 && <Field label="Boutiques"><select className="input" aria-label="Boutiques du rapport" value={all ? "all" : "one"} onChange={(e) => setAll(e.target.value === "all")}><option value="one">Boutique actuelle</option><option value="all">Toutes mes boutiques</option></select></Field>}</div>
      <fieldset className="card flex flex-col gap-1"><legend className="text-sm font-semibold px-1">Sections</legend>{SECTIONS.map(([k, l]) => <label key={k} className="text-sm flex gap-2 items-center"><input type="checkbox" checked={sel.includes(k)} onChange={(e) => setSel(e.target.checked ? [...sel, k] : sel.filter((x) => x !== k))} />{l}</label>)}</fieldset>
      {sel.length === 0 && <p className="text-sm text-warn">Choisissez au moins une section.</p>}
      {q.isLoading && <p className="text-sm text-muted" role="status">Calcul du rapport…</p>}<Err e={q.error ?? exp.error} />
      {q.data && <div className="card text-sm flex flex-col gap-1"><b>Contenu du rapport</b>{q.data.preview.map((p) => <span key={p.name} className="text-soft flex justify-between gap-2"><span>{p.name}</span><span>{p.rows} ligne(s)</span></span>)}</div>}
      <div className="grid grid-cols-3 gap-2">{(["pdf", "xlsx", "csv"] as const).map((f) => <button key={f} className="btn-ghost flex items-center justify-center gap-1" disabled={!q.data || !!fmt} onClick={() => exp.mutate(f)}><Download size={14} />{f === "xlsx" ? "Excel" : f.toUpperCase()}{fmt === f ? "…" : ""}</button>)}</div>
      <p className="text-xs text-muted">Les exports reprennent exactement les filtres choisis. Valeurs au coût et au prix actuels ; prévisions = estimations, jamais des certitudes.</p>
    </div>
  );
}
