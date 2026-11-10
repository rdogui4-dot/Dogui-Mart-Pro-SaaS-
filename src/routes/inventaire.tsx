import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, ScanLine, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { list, listTenant } from "@/lib/data";
import { exportReport, type ExportFormat } from "@/lib/report-export";
import type { ReportData } from "@/domain/exports";
import { useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { INV_LABEL, LINE_LABEL, type InvStatus, type LineStatus } from "@/domain/inventory";
import { formatFcfa } from "@/domain/money";
import { useSubscription } from "./subscription";
import { AlertsBar, AnalysisBox, AnomaliesBox, CampaignsView, ControlBox, PlanView, ProposalsBox, ZonesSheet } from "./inventaire-pro";

type Prog = { total: number; counted: number; pending: number; recount: number; pct: number };
type Row = { id: string; number: string; status: InvStatus; label: string; kind: string; responsible: string; createdAt: string; startedAt: string; validatedAt: string; progress: Prog; adjusted: number; notes: string };
type Mv = { net: Record<string, number>; count: number; recent: number };
type Line = { id: string; productId: string; name: string; sku: string; barcode: string; category: string; scale: number; status: LineStatus; round: number; counted: number | null; second?: number | null; third?: number | null; zone?: string; abc?: string; countedBy: string; note: string; conflict: boolean; units: { unit: string; factor: number }[]; theoretical?: number; diff?: number | null; value?: number | null; significant?: boolean; movesAfter?: Mv; movesDuring?: Mv; recentBefore?: number; needsAttention?: boolean; reason?: string; decidedBy?: string };
type Ev = { id: string; kind: string; by: string; at: string; detail: Record<string, unknown> };
type Detail = { id: string; number: string; status: InvStatus; label: string; kind: string; responsible: string; responsibleId: string; agents: { id: string; name: string }[]; threshold: { pct: number; value: number }; notes: string; startedAt: string; countedAt: string; validatedAt: string; excluded: { name: string; reason: string }[]; docs: { fileId: string; name: string }[]; totals: { adjusted: number; rejected: number; uncounted: number; netValue: number; surplusValue: number; shortageValue: number } | null; progress: Prog; canCount: boolean; blind: boolean; lines: Line[]; unknown: { code: string; qty: number }[]; events: Ev[] };
type Report = { counted: number; uncounted: number; gaps: number; positive: number; negative: number; surplusValue: number; shortageValue: number; netValue: number; byCategory: { category: string; counted: number; gaps: number; surplusValue: number; shortageValue: number }[]; recount: { lineId: string; name: string; reason: string }[]; attention: { lineId: string; name: string }[]; unknown: unknown[]; note: string; export: ReportData };
type Staff = { userId: string; name: string; role: string; active?: boolean; shopIds?: string; access?: string };

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24); const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message.replace(/^(DEJA_COMPTE|NON_COMPTES|ECART_IMPORTANT|VALIDATION_IMPOSSIBLE) : /, "")}</p> : null);
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
const TONE: Record<string, string> = { draft: "text-white/60", in_progress: "text-sky-300", counted: "text-amber-300", review: "text-amber-300", validated: "text-emerald-300", closed: "text-white/50", cancelled: "text-white/40" };
const EVENT: Record<string, string> = { create: "Créé", update: "Modifié", start: "Comptage lancé", count: "Quantité saisie", unknown: "Article inconnu signalé", finish: "Comptage terminé", review: "Passé à la vérification", recount: "Recomptage demandé", approve: "Écarts approuvés", reject: "Écarts refusés", validate: "Validé (ajustements créés)", close: "Clôturé", cancel: "Annulé", attach: "Document ajouté" };
const Bar = ({ p }: { p: Prog }) => <div aria-label={`Avancement ${p.pct} %`}><div className="h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-[var(--gold)]" style={{ width: `${p.pct}%` }} /></div><span className="text-xs text-white/50">{p.counted}/{p.total} comptés ({p.pct} %){p.recount ? ` · ${p.recount} à recompter` : ""}</span></div>;
const sgn = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Silent Count (Business) : inventaire par boutique avec comptage à l'aveugle (aucune quantité théorique affichée pendant le comptage), rapprochement, second comptage, validation et ajustements tracés. */
export function InventairePage() {
  const { session } = useSession(); const s = session!; const sub = useSubscription(); const allowed = planAllows(sub.data?.entitlement.plan.id, "silentCount"); const qc = useQueryClient(); const manager = s.role === "owner" || s.role === "manager";
  const [sheet, setSheet] = useState<ReactNode>(null); const [status, setStatus] = useState(""); const pro = planAllows(sub.data?.entitlement.plan.id, "silentCountPro"); const [tab, setTab] = useState<"inv" | "camp" | "plan">("inv"); const { switchShop } = useSession();
  const q = useQuery({ queryKey: ["count-list", s.shopId, status], enabled: allowed, retry: 1, queryFn: () => api<{ inventories: Row[] }>(s, "count.list", { status }) });
  const refresh = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("count") || ["stock", "overview"].includes(String(x.queryKey[0])) });
  if (sub.isLoading) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />;
  if (!allowed) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Inventaire</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Silent Count : formule Business</span><p className="text-white/60">Comptage physique à l'aveugle, écarts valorisés, second comptage, validation et ajustements tracés.</p><button className="btn text-center" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Voir les formules</button></div></div>;
  const close = () => setSheet(null); const openInv = (id: string) => setSheet(<InventorySheet id={id} close={close} refresh={refresh} manager={manager} />); const proOn = pro && manager;
  return <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-bold">Inventaire</h1>{manager && <button className="btn !py-2 flex items-center gap-1" onClick={() => setSheet(<CreateForm close={close} done={() => { close(); refresh(); }} />)}><Plus size={16} />Nouveau</button>}</div>
    {!navigator.onLine && <div className="card border border-amber-400/40 text-sm flex gap-2" role="alert"><WifiOff size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>Hors ligne : chaque saisie est enregistrée côté serveur ; reconnectez-vous pour continuer le comptage.</span></div>}
    {proOn && <AlertsBar onOpen={openInv} />}
    {proOn && <nav aria-label="Sections Pro" className="scroll-x">{([["inv", "Inventaires"], ["camp", "Campagnes"], ["plan", "Planification"]] as [typeof tab, string][]).map(([k, l]) => <button key={k} className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>}
    {proOn && tab === "camp" && <CampaignsView onOpen={(id, shopId) => { if (shopId !== s.shopId) switchShop(shopId); openInv(id); }} />}
    {proOn && tab === "plan" && <PlanView onOpen={openInv} />}
    {(!proOn || tab === "inv") && <>
    <select className="input !py-2 text-sm" aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous les inventaires</option>{Object.entries(INV_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {q.isLoading && <div className="card h-20 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {q.data && !q.data.inventories.length && <p className="text-center text-white/50 text-sm py-6">{manager ? "Aucun inventaire. Créez-en un pour compter votre stock." : "Aucun inventaire ne vous est assigné."}</p>}
    {q.data?.inventories.map((r) => <button key={r.id} className="card text-left flex flex-col gap-2" onClick={() => setSheet(<InventorySheet id={r.id} close={close} refresh={refresh} manager={manager} />)}><span className="flex justify-between gap-2"><b>{r.number}</b><span className={`text-sm ${TONE[r.status]}`}>{r.label}</span></span><span className="text-xs text-white/50">{r.kind === "partial" ? "Partiel" : "Complet"} · responsable {r.responsible || "—"}{r.adjusted ? ` · ${r.adjusted} ajustement(s)` : ""}</span><Bar p={r.progress} /></button>)}
    </>}
    {sheet}
  </div>;
}

function CreateForm({ close, done }: { close: () => void; done: () => void }) {
  const { session } = useSession(); const s = session!; const prods = useQuery({ queryKey: ["count-products", s.shopId], queryFn: () => list<{ name: string; category?: string; archived?: boolean }>("products", s, [], 2000) }); const staff = useQuery({ queryKey: ["count-staff"], queryFn: () => listTenant<Staff>("staff", s, 200) });
  const [f, setF] = useState({ kind: "full", responsibleId: "", notes: "", pct: "10", value: "50000" }); const [cats, setCats] = useState<string[]>([]); const [agents, setAgents] = useState<string[]>([]); const [pick, setPick] = useState(""); const [chosen, setChosen] = useState<{ id: string; name: string }[]>([]); const [key] = useState(() => rid());
  const categories = [...new Set((prods.data ?? []).filter((p) => !p.archived).map((p) => p.category).filter(Boolean) as string[])].sort(); const found = pick ? (prods.data ?? []).filter((p) => !p.archived && p.name.toLowerCase().includes(pick.toLowerCase()) && !chosen.some((c) => c.id === p.$id)).slice(0, 6) : [];
  const stock = (staff.data ?? []).filter((x) => x.active !== false && (!x.access || x.access.includes("stock")) && (!x.shopIds || x.shopIds === "[]" || x.shopIds.includes(s.shopId)));
  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const m = useMutation({ mutationFn: () => api(s, "count.save", { clientId: key, kind: f.kind, categories: cats, productIds: chosen.map((c) => c.id), responsibleId: f.responsibleId || undefined, agents, notes: f.notes, thresholdPct: num(f.pct || "10"), thresholdValue: num(f.value || "50000") }), onSuccess: done });
  const valid = f.kind === "full" || cats.length > 0 || chosen.length > 0;
  return <Sheet title="Nouvel inventaire" onClose={close} back>
    <div className="grid grid-cols-2 gap-2">{([["full", "Complet"], ["partial", "Partiel"]] as [string, string][]).map(([k, l]) => <button key={k} className="chip justify-center" aria-pressed={f.kind === k} aria-current={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
    {f.kind === "partial" && <><h3 className="text-sm font-semibold">Catégories</h3><div className="flex flex-wrap gap-2">{categories.map((c) => <button key={c} className="chip" aria-current={cats.includes(c)} onClick={() => toggle(cats, c, setCats)}>{c}</button>)}{!categories.length && <p className="text-xs text-white/50">Aucune catégorie sur vos articles.</p>}</div>
      <input className="input" aria-label="Ajouter un article" placeholder="Ajouter un article précis…" value={pick} onChange={(e) => setPick(e.target.value)} />{found.map((p) => <button key={p.$id} className="card text-left text-sm" onClick={() => { setChosen([...chosen, { id: p.$id, name: p.name }]); setPick(""); }}>{p.name}</button>)}
      <div className="flex flex-wrap gap-2">{chosen.map((c) => <button key={c.id} className="chip" aria-label={`Retirer ${c.name}`} onClick={() => setChosen(chosen.filter((x) => x.id !== c.id))}>{c.name} ✕</button>)}</div></>}
    <Field label="Responsable"><select className="input" aria-label="Responsable" value={f.responsibleId} onChange={(e) => setF({ ...f, responsibleId: e.target.value })}><option value="">Moi</option>{stock.map((x) => <option key={x.userId} value={x.userId}>{x.name}</option>)}</select></Field>
    <h3 className="text-sm font-semibold">Agents de comptage</h3><div className="flex flex-wrap gap-2">{stock.map((x) => <button key={x.userId} className="chip" aria-current={agents.includes(x.userId)} onClick={() => toggle(agents, x.userId, setAgents)}>{x.name}</button>)}{!stock.length && <p className="text-xs text-white/50">Aucun membre du personnel avec accès au stock : le propriétaire et les gérants peuvent compter.</p>}</div>
    <div className="grid grid-cols-2 gap-2"><Field label="Écart important à partir de (%)"><input className="input" inputMode="decimal" aria-label="Seuil en pourcentage" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field><Field label="… ou de (FCFA)"><input className="input" inputMode="numeric" aria-label="Seuil en valeur" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field></div>
    <Field label="Observations"><textarea className="input" rows={2} aria-label="Observations" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    <Err e={m.error} /><button className="btn" disabled={!valid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Création…" : "Créer le brouillon"}</button>
  </Sheet>;
}

function InventorySheet({ id, close, refresh, manager }: { id: string; close: () => void; refresh: () => void; manager: boolean }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useQuery({ queryKey: ["count-get", id], retry: 1, refetchOnWindowFocus: true, queryFn: () => api<Detail>(s, "count.get", { id }) }); const d = q.data; const pro = planAllows(useSubscription().data?.entitlement.plan.id, "silentCountPro") && manager; const [zones, setZones] = useState(false);
  const reload = () => { void qc.invalidateQueries({ queryKey: ["count-get", id] }); void qc.invalidateQueries({ queryKey: ["count-anom", id] }); void qc.invalidateQueries({ queryKey: ["count-an", id] }); void qc.invalidateQueries({ queryKey: ["count-prop", id] }); void qc.invalidateQueries({ queryKey: ["count-report", id] }); refresh(); };
  const [ask, setAsk] = useState<null | { kind: string; title: string; text?: string; needReason?: boolean; body?: object }>(null); const [why, setWhy] = useState(""); const [tab, setTab] = useState("todo"); const [filter, setFilter] = useState("all"); const [code, setCode] = useState(""); const [scan, setScan] = useState(false); const [entry, setEntry] = useState<Line | null>(null); const [note, setNote] = useState("");
  const act = useMutation({ mutationFn: (a: { action: string; body?: object }) => api(s, `count.${a.action}`, { id, ...a.body }), onSuccess: () => { setAsk(null); setWhy(""); reload(); } });
  const open = (c: string) => { const l = d?.lines.find((x) => [x.barcode, x.sku].some((v) => v && v.toLowerCase() === c.trim().toLowerCase())); if (l) { setEntry(l); setCode(""); } else setUnknown(c.trim()); }; const [unknown, setUnknown] = useState("");
  if (q.isLoading) return <Sheet title="Inventaire" onClose={close} back><div className="card h-24 animate-pulse bg-white/5" aria-busy="true" /></Sheet>;
  if (!d) return <Sheet title="Inventaire" onClose={close} back><Err e={q.error} /></Sheet>;
  const st = d.status; const mine = d.lines; const todo = mine.filter((l) => l.counted === null || l.status === "recount"); const done = mine.filter((l) => l.counted !== null && l.status !== "recount"); const shown = (tab === "todo" ? todo : done).filter((l) => !code || l.name.toLowerCase().includes(code.toLowerCase()) || l.barcode.includes(code) || l.sku.toLowerCase().includes(code.toLowerCase()));
  const gaps = mine.filter((l) => l.diff !== undefined && l.diff !== null && l.diff !== 0); const view = filter === "all" ? gaps : filter === "big" ? gaps.filter((l) => l.significant) : filter === "attention" ? gaps.filter((l) => l.needsAttention) : gaps.filter((l) => l.status === "counted");
  return <Sheet title={d.number} onClose={close} back>
    <div className="card flex flex-col gap-2 text-sm"><p className="flex justify-between"><b>{d.kind === "partial" ? "Inventaire partiel" : "Inventaire complet"}</b><span className={TONE[st]}>{d.label}</span></p><p className="text-white/60 text-xs">Responsable : {d.responsible || "—"}{d.agents.length ? ` · agents : ${d.agents.map((a) => a.name).join(", ")}` : ""}<br />Écart important : ≥ {d.threshold.pct} % ou ≥ {formatFcfa(d.threshold.value)}</p>{d.notes && <p>{d.notes}</p>}<Bar p={d.progress} />
      {d.blind && st === "in_progress" && <p className="text-xs text-sky-300">Comptage à l'aveugle : les quantités théoriques ne sont pas affichées.</p>}{!!d.excluded.length && <details className="text-xs text-white/60"><summary>{d.excluded.length} article(s) hors inventaire</summary>{d.excluded.map((e) => <p key={e.name}>{e.name} — {e.reason}</p>)}</details>}</div>
    {/* ---------- actions par statut ---------- */}
    <div className="flex gap-2 flex-wrap">
      {st === "draft" && manager && <><button className="btn !py-2 text-sm" disabled={act.isPending} onClick={() => act.mutate({ action: "start" })}>Lancer le comptage</button></>}
      {st === "in_progress" && (manager || d.responsibleId === s.userId) && <button className="btn-ghost !py-2 text-sm" onClick={() => setAsk({ kind: "finish", title: "Terminer le comptage ?", text: todo.length ? `${todo.length} article(s) ne sont pas comptés : ils ne recevront aucun ajustement.` : "Tous les articles sont comptés.", body: { confirmUncounted: true } })}>Terminer le comptage</button>}
      {st === "counted" && manager && <button className="btn !py-2 text-sm" disabled={act.isPending} onClick={() => act.mutate({ action: "review" })}>Vérifier les écarts</button>}
      {st === "review" && manager && <><button className="btn !py-2 text-sm" onClick={() => setAsk({ kind: "decide", title: "Approuver tous les écarts non importants", needReason: true, body: { all: true, decision: "approve" } })}>Approuver les petits écarts</button><button className="btn-ghost !py-2 text-sm" onClick={() => setAsk({ kind: "validate", title: "Valider l'inventaire ?", text: "Les mouvements correctifs des écarts approuvés seront créés, une seule fois. Les écarts refusés et les articles non comptés ne sont pas ajustés." })}>Valider l'inventaire</button></>}
      {st === "validated" && manager && <button className="btn !py-2 text-sm" onClick={() => setAsk({ kind: "close", title: "Clôturer l'inventaire ?", text: "Après clôture, les résultats ne se modifient plus. Toute correction passera par une opération corrective tracée." })}>Clôturer</button>}
      {pro && (st === "draft" || st === "in_progress") && <button className="btn-ghost !py-2 text-sm" onClick={() => setZones(true)}>Zones et agents</button>}
      {manager && ["draft", "in_progress", "counted", "review"].includes(st) && <button className="btn-ghost !py-2 text-sm !border-red-400/60 !text-red-300" onClick={() => setAsk({ kind: "cancel", title: "Annuler l'inventaire", needReason: true })}>Annuler</button>}
    </div>
    <Err e={act.error} />
    {pro && ["in_progress", "counted", "review"].includes(st) && <ControlBox id={id} status={st} lines={mine} onDone={reload} />}
    {/* ---------- comptage silencieux ---------- */}
    {st === "in_progress" && <>
      <div className="flex gap-2"><input className="input flex-1" aria-label="Scanner ou rechercher" placeholder="Code-barres, référence ou nom…" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) open(code); }} /><button className="btn" aria-label="Scanner avec la caméra" onClick={() => setScan(true)}><ScanLine /></button></div>
      <nav aria-label="Liste" className="scroll-x"><button className="chip" aria-current={tab === "todo"} onClick={() => setTab("todo")}>Restants ({todo.length})</button><button className="chip" aria-current={tab === "done"} onClick={() => setTab("done")}>Comptés ({done.length})</button></nav>
      {!shown.length && <p className="text-center text-white/50 text-sm py-4">{tab === "todo" ? "Plus rien à compter." : "Rien de compté pour le moment."}</p>}
      {shown.map((l) => <button key={l.id} className="card text-left flex justify-between gap-2" onClick={() => setEntry(l)}><span className="min-w-0"><b className="block truncate">{l.name}</b><span className="text-xs text-white/50">{[l.sku, l.barcode].filter(Boolean).join(" · ") || l.category}{l.status === "recount" ? " · à recompter" : ""}{l.conflict ? " · désaccord entre agents" : ""}</span></span>{l.counted !== null && l.status !== "recount" && <b className="text-emerald-300">{l.counted}</b>}</button>)}
      {!!d.unknown.length && <p className="text-xs text-amber-300">{d.unknown.length} code(s) inconnu(s) signalé(s).</p>}
    </>}
    {/* ---------- écarts ---------- */}
    {(st === "counted" || st === "review" || st === "validated" || st === "closed") && manager && <>
      <nav aria-label="Filtre des écarts" className="scroll-x">{([["all", `Tous les écarts (${gaps.length})`], ["big", `Importants (${gaps.filter((l) => l.significant).length})`], ["attention", `Mouvements pendant le comptage (${gaps.filter((l) => l.needsAttention).length})`], ["open", "À traiter"]] as [string, string][]).map(([k, l]) => <button key={k} className="chip" aria-current={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</nav>
      {!view.length && <p className="text-center text-white/50 text-sm py-4">Aucun écart dans cette vue.</p>}
      {view.map((l) => <div key={l.id} className="card flex flex-col gap-1 text-sm"><p className="flex justify-between gap-2"><b>{l.name}</b><span className={l.diff! < 0 ? "text-red-300" : "text-emerald-300"}>{sgn(l.diff!)} · {formatFcfa(l.value ?? 0)}</span></p>
        <p className="text-xs text-white/60">Théorique {l.theoretical} → compté {l.counted} · {LINE_LABEL[l.status]}{l.round > 1 ? ` · ${l.round}ᵉ comptage` : ""}{l.significant ? " · ÉCART IMPORTANT" : ""}</p>
        {l.needsAttention && <p className="text-xs text-amber-300">{l.recentBefore ? `${l.recentBefore} mouvement(s) juste avant le comptage. ` : ""}{l.movesAfter?.count ? `${l.movesAfter.count} mouvement(s) depuis le comptage (non inclus dans l'écart).` : ""}</p>}
        {l.reason && <p className="text-xs">Motif : {l.reason}{l.decidedBy ? ` — ${l.decidedBy}` : ""}</p>}
        {st === "review" && l.status !== "approved" && l.status !== "rejected" && <div className="flex gap-2 flex-wrap"><button className="btn-ghost !py-1 text-xs" onClick={() => setAsk({ kind: "decide", title: `Approuver l'écart — ${l.name}`, needReason: true, body: { lineIds: [l.id], decision: "approve", ...(l.significant && l.round < 2 ? { forceSignificant: true } : {}) }, text: l.significant && l.round < 2 ? "Écart important sans second comptage : un motif détaillé est obligatoire (ou demandez un recomptage)." : undefined })}>Approuver</button><button className="btn-ghost !py-1 text-xs" onClick={() => setAsk({ kind: "decide", title: `Refuser l'écart — ${l.name}`, needReason: true, body: { lineIds: [l.id], decision: "reject" } })}>Refuser</button><button className="btn-ghost !py-1 text-xs" onClick={() => setAsk({ kind: "recount", title: `Recompter — ${l.name}`, needReason: true, body: { lineIds: [l.id] } })}>Recompter</button></div>}</div>)}
      {(st === "validated" || st === "closed") && d.totals && <div className="card text-sm flex flex-col gap-1"><b>Résultat</b><p>{d.totals.adjusted} ajustement(s) créé(s) · {d.totals.rejected} écart(s) refusé(s) · {d.totals.uncounted} non compté(s)</p><p>Surplus {formatFcfa(d.totals.surplusValue)} · manquants {formatFcfa(d.totals.shortageValue)} · net {formatFcfa(d.totals.netValue)}</p></div>}
      {pro && <><AnomaliesBox id={id} /><AnalysisBox id={id} />{st === "review" && <ProposalsBox id={id} onDone={reload} />}</>}
      <ReportBox id={id} pro={pro} />
    </>}
    <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Historique</h3>{manager ? d.events.map((e) => <p key={e.id} className="text-xs text-white/60 border-t border-[var(--line)] pt-1">{new Date(e.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {EVENT[e.kind] ?? e.kind}{e.by ? ` · ${e.by}` : ""}{e.kind === "count" ? ` — ${String(e.detail.name)} : ${String(e.detail.qty)}${e.detail.previous !== null && e.detail.previous !== undefined ? ` (avant : ${String(e.detail.previous)})` : ""}` : ""}{typeof e.detail.reason === "string" && e.detail.reason ? ` — « ${e.detail.reason} »` : ""}</p>) : <p className="text-xs text-white/50">Réservé au responsable.</p>}</div>
    {zones && <ZonesSheet inv={{ id, status: st }} onClose={() => setZones(false)} onDone={() => { setZones(false); reload(); }} />}
    {scan && <Scanner onCode={(c) => { setScan(false); open(c); }} onClose={() => setScan(false)} />}
    {entry && <EntrySheet inv={d} line={entry} onClose={() => setEntry(null)} onDone={() => { setEntry(null); setNote(""); reload(); }} note={note} setNote={setNote} />}
    {unknown && <Sheet title="Code inconnu" onClose={() => setUnknown("")} back><p className="text-sm">« {unknown} » ne figure pas dans cet inventaire. Vous pouvez le signaler au responsable avec la quantité vue.</p><UnknownForm id={id} code={unknown} onDone={() => { setUnknown(""); setCode(""); reload(); }} /></Sheet>}
    {ask && (ask.needReason ? <Sheet title={ask.title} onClose={() => setAsk(null)} back>{ask.text && <p className="text-sm text-amber-300">{ask.text}</p>}<Field label="Motif *"><textarea className="input" rows={2} aria-label="Motif" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={act.error} /><button className="btn" disabled={why.trim().length < 3 || act.isPending} onClick={() => act.mutate({ action: ask.kind, body: { ...ask.body, reason: why } })}>{act.isPending ? "Envoi…" : "Confirmer"}</button></Sheet> : <Confirm text={`${ask.title} ${ask.text ?? ""}`} confirmLabel="Confirmer" onYes={() => act.mutate({ action: ask.kind, body: ask.body })} onNo={() => setAsk(null)} />)}
  </Sheet>;
}

function EntrySheet({ inv, line, onClose, onDone, note, setNote }: { inv: Detail; line: Line; onClose: () => void; onDone: () => void; note: string; setNote: (n: string) => void }) {
  const { session } = useSession(); const s = session!; const [qty, setQty] = useState(""); const [unit, setUnit] = useState(""); const [replace, setReplace] = useState(false); const [key] = useState(() => rid());
  const m = useMutation({ mutationFn: () => api<{ duplicate: boolean; warning?: string }>(s, "count.entry", { id: inv.id, lineId: line.id, entryKey: key, ...(unit ? { unit, unitQty: num(qty) } : { qty }), note, replace: replace || line.status === "recount" }), onSuccess: onDone, onError: (e) => { if (/DEJA_COMPTE/.test((e as Error).message)) setReplace(true); } });
  const already = line.counted !== null && line.status !== "recount";
  return <Sheet title={line.name} onClose={onClose} back>
    <p className="text-xs text-white/50">{[line.sku, line.barcode].filter(Boolean).join(" · ")}</p>
    {already && <p className="text-sm text-amber-300">Déjà compté : {line.counted}{line.countedBy ? ` (${line.countedBy})` : ""}. Une nouvelle saisie remplace la valeur ; l'ancienne reste dans l'historique.</p>}
    <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><Field label={unit ? `Quantité (${unit})` : "Quantité constatée"}><input className="input text-2xl" inputMode="decimal" autoFocus aria-label="Quantité constatée" value={qty} onChange={(e) => setQty(e.target.value)} /></Field></div>
      {!!line.units.length && <Field label="Unité"><select className="input" aria-label="Unité" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Unité de base</option>{line.units.map((u) => <option key={u.unit} value={u.unit}>{u.unit} (×{u.factor})</option>)}</select></Field>}</div>
    <Field label="Observation"><input className="input" aria-label="Observation" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    <Err e={m.error} />
    <button className="btn" disabled={qty.trim() === "" || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Enregistrement…" : replace ? "Confirmer le remplacement" : "Enregistrer"}</button>
  </Sheet>;
}
function UnknownForm({ id, code, onDone }: { id: string; code: string; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [qty, setQty] = useState("1"); const [key] = useState(() => rid()); const m = useMutation({ mutationFn: () => api(s, "count.entry", { id, code, qty, entryKey: key }), onSuccess: onDone });
  return <><Field label="Quantité vue"><input className="input" inputMode="decimal" aria-label="Quantité vue" value={qty} onChange={(e) => setQty(e.target.value)} /></Field><Err e={m.error} /><button className="btn" disabled={m.isPending} onClick={() => m.mutate()}>Signaler ce code</button></>;
}

function ReportBox({ id, pro }: { id: string; pro?: boolean }) {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["count-report", id, !!pro], retry: 1, queryFn: () => api<Report>(s, pro ? "scount.report" : "count.report", { id }) }); const [fmt, setFmt] = useState<string | null>(null); const [err, setErr] = useState("");
  const r = q.data; if (q.error) return /après la fin/.test((q.error as Error).message) ? null : <Err e={q.error} />; if (!r) return <div className="card h-20 animate-pulse bg-white/5" aria-busy="true" />;
  const exp = async (f: ExportFormat) => { setFmt(f); setErr(""); try { await exportReport(r.export, f); } catch (e) { setErr((e as Error).message); } finally { setFmt(null); } };
  return <div className="card flex flex-col gap-2 text-sm"><b>Rapport</b>
    <div className="grid grid-cols-2 gap-2"><p>Comptés : <b>{r.counted}</b></p><p>Non comptés : <b>{r.uncounted}</b></p><p>Écarts +/− : <b>{r.positive}/{r.negative}</b></p><p>Écart net : <b>{formatFcfa(r.netValue)}</b></p><p className="text-emerald-300">Surplus : {formatFcfa(r.surplusValue)}</p><p className="text-red-300">Manquants : {formatFcfa(r.shortageValue)}</p></div>
    {r.byCategory.map((c) => <p key={c.category} className="flex justify-between text-xs border-t border-[var(--line)] pt-1"><span>{c.category} · {c.counted} comptés · {c.gaps} écart(s)</span><span>{formatFcfa(c.surplusValue + c.shortageValue)}</span></p>)}
    {!!r.recount.length && <div><b className="text-amber-300">À recompter</b>{r.recount.map((x) => <p key={x.lineId} className="text-xs">{x.name} — {x.reason}</p>)}</div>}
    <p className="text-xs text-white/50">{r.note}</p>
    <div className="flex gap-2">{(["pdf", "xlsx", "csv"] as ExportFormat[]).map((f) => <button key={f} className="btn-ghost !py-1 text-xs" disabled={fmt !== null} onClick={() => void exp(f)}>{fmt === f ? "…" : f.toUpperCase()}</button>)}</div><Err e={err ? new Error(err) : null} /></div>;
}
