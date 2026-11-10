import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { KIND_LABEL, METHOD_LABEL, SOURCE_LABEL, type AccountKind } from "@/domain/fin";
import { Analyses, Forecast, Plans, RulesTab, useFinPro } from "./finance-pro";
import { exportReport, type ExportFormat } from "@/lib/report-export";
import type { ReportData } from "@/domain/exports";

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const fmtDay = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
const Kpi = ({ label, value, tone = "", hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) => <div className="card"><div className="text-white/50 text-xs">{label}</div><div className={`font-semibold text-lg ${tone}`}>{value}</div>{hint && <div className="text-[11px] text-white/40">{hint}</div>}</div>;
const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px] text-white/40">{children}</p>;
const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatFcfa(n));

type Acc = { id: string; name: string; kind: AccountKind; kindLabel: string; methods: string[]; methodLabels: string[]; openingBalance: number | null; openingDate: string | null; active: boolean; configured: boolean; balance: number | null; inflow: number; outflow: number; transfersIn: number; transfersOut: number };
type Unassigned = { method: string; label: string; inflow: number; outflow: number; count: number };
type Accounts = { accounts: Acc[]; unassigned: Unassigned[]; totalConfigured: number; unconfigured: number; note: string };
type Flow = { key: string; source: string; sourceLabel: string; ref: string; date: string; method: string; methodLabel: string; amount: number; label: string; by: string; account: string | null };
type Transfer = { id: string; from: { id: string; name: string }; to: { id: string; name: string }; amount: number; date: string; status: string; statusLabel: string; reason: string; createdBy: string; confirmedBy: string; cancelReason: string };
type Due = { kind: string; ref: string; party: string; total: number; paid: number; remaining: number; due: string | null; note: string };
type Side = { total: number; overdue: number; dueSoon: number; aging: { key: string; label: string; amount: number }[]; items: Due[] };

const useFin = <T,>(action: string, payload: object = {}, enabled = true) => { const { session } = useSession(); const s = session!; return useQuery({ queryKey: ["fin", action, s.shopId, payload], enabled, retry: 1, queryFn: () => api<T>(s, action, payload) }); };
const useAct = (action: string, onOk?: (r: any) => void) => { const { session } = useSession(); const s = session!; const qc = useQueryClient(); return useMutation({ mutationFn: (b: object) => api<any>(s, action, b), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["fin"] }); onOk?.(r); } }); };

type Tab = "dash" | "accounts" | "flows" | "transfers" | "reco" | "dues" | "budgets" | "reports" | "fc" | "plans" | "an" | "rules";
export function FinancePage() {
  const { session } = useSession(); const s = session!; const [tab, setTab] = useState<Tab>("dash");
  const tabs: [Tab, string][] = [["dash", "Trésorerie"], ["accounts", "Comptes"], ["flows", "Flux"], ["transfers", "Virements"], ["reco", "Rapprochement"], ["dues", "Échéances"], ["budgets", "Budgets"], ["fc", "Prévisions"], ["plans", "Échéancier"], ["an", "Analyses"], ["rules", "Règles"], ["reports", "Rapports"]];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Finance</h1>
      <p className="text-xs text-white/50">Boutique active : comptes et soldes sont gérés boutique par boutique. Les montants viennent des pièces réelles (ventes, dépenses, paiements) ; aucun solde n'est inventé.</p>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sections de la finance">{tabs.map(([k, l]) => <button key={k} role="tab" className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "dash" && <Dash onTab={setTab} />}{tab === "accounts" && <Accounts />}{tab === "flows" && <Flows />}{tab === "transfers" && <Transfers />}{tab === "reco" && <Reco />}{tab === "dues" && <Dues />}{tab === "budgets" && <Budgets mgr={s.role === "owner" || s.role === "manager"} />}{tab === "reports" && <Reports />}{tab === "fc" && <Forecast canAll={s.role === "owner" || s.role === "manager"} />}{tab === "plans" && <Plans />}{tab === "an" && <Analyses canAll={s.role === "owner" || s.role === "manager"} mgr={s.role === "owner" || s.role === "manager"} />}{tab === "rules" && <RulesTab />}
    </div>
  );
}

function Dash({ onTab }: { onTab: (t: Tab) => void }) {
  const q = useFin<{ accounts: Acc[]; unassigned: Unassigned[]; totalConfigured: number; unconfigured: number; last30: { inflow: number; outflow: number; net: number }; receivables: { total: number; overdue: number; dueSoon: number }; payables: { total: number; overdue: number; dueSoon: number }; outlook30: { amount: number; basis: string }; alerts: { level: string; text: string }[] }>("fin.dashboard");
  if (q.error) return <Err e={q.error} />; const d = q.data; if (!d) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Trésorerie (comptes configurés)" value={d.accounts.some((a) => a.active && a.configured) ? money(d.totalConfigured) : "À configurer"} hint={d.unconfigured ? `${d.unconfigured} compte(s) sans solde d'ouverture` : undefined} />
        <Kpi label="Perspective à 30 jours" value={money(d.outlook30.amount)} hint="Indicatif" />
        <Kpi label="Entrées (30 j)" value={money(d.last30.inflow)} tone="text-emerald-300" /><Kpi label="Sorties (30 j)" value={money(d.last30.outflow)} tone="text-red-300" />
        <Kpi label="À encaisser" value={money(d.receivables.total)} hint={`dont échu ${money(d.receivables.overdue)}`} /><Kpi label="À payer" value={money(d.payables.total)} hint={`dont échu ${money(d.payables.overdue)}`} />
      </div>
      {d.accounts.length === 0 && <div className="card text-sm flex flex-col gap-2"><p>Aucun compte financier pour cette boutique.</p><button className="btn" onClick={() => onTab("accounts")}>Créer un compte</button></div>}
      {d.alerts.length > 0 && <div className="card flex flex-col gap-1" aria-label="Alertes">{d.alerts.map((a) => <p key={a.text} className={`text-sm ${a.level === "danger" ? "text-red-300" : "text-amber-300"}`}>{a.text}</p>)}</div>}
      <div className="card flex flex-col gap-1">{d.accounts.filter((a) => a.active).map((a) => <div key={a.id} className="flex justify-between text-sm"><span>{a.name} <span className="text-white/40 text-xs">{a.kindLabel}</span></span><span className={a.balance !== null && a.balance < 0 ? "text-red-300" : ""}>{a.configured ? money(a.balance) : "Solde d'ouverture à saisir"}</span></div>)}</div>
      <Note>{d.outlook30.basis}</Note>
    </div>
  );
}

function AccountForm({ acc, methodsTaken, onDone }: { acc?: Acc; methodsTaken: Map<string, string>; onDone: () => void }) {
  const [f, setF] = useState({ name: acc?.name ?? "", kind: (acc?.kind ?? "cash") as AccountKind, methods: acc?.methods ?? ([] as string[]), ob: acc?.openingBalance === null || acc?.openingBalance === undefined ? "" : String(acc.openingBalance), od: acc?.openingDate ?? day(), active: acc?.active ?? true }); const [key] = useState(rid);
  const m = useAct("fin.account.save", onDone); const tog = (x: string) => setF((p) => ({ ...p, methods: p.methods.includes(x) ? p.methods.filter((y) => y !== x) : [...p.methods, x] }));
  const body = { ...(acc ? { id: acc.id } : { requestKey: key }), name: f.name, kind: f.kind, methods: f.methods, active: f.active, ...(f.ob.trim() === "" ? { openingBalance: null } : { openingBalance: Number(f.ob), openingDate: f.od }) };
  return (
    <div className="flex flex-col gap-3 p-3">
      <Field label="Nom du compte"><input className="input" aria-label="Nom du compte" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
      <Field label="Type"><select className="input" aria-label="Type de compte" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })}>{(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
      <fieldset className="flex flex-col gap-1"><legend className="text-xs text-white/60">Moyens de règlement qui alimentent ce compte</legend>
        {Object.entries(METHOD_LABEL).map(([id, l]) => { const other = methodsTaken.get(id); const off = !!other && !f.methods.includes(id) && other !== acc?.name; return <label key={id} className={`flex gap-2 text-sm ${off ? "opacity-40" : ""}`}><input type="checkbox" checked={f.methods.includes(id)} disabled={off} onChange={() => tog(id)} />{l}{off && <span className="text-xs text-white/40"> (déjà sur « {other} »)</span>}</label>; })}
      </fieldset>
      <div className="grid grid-cols-2 gap-2"><Field label="Solde d'ouverture (FCFA)"><input className="input" aria-label="Solde d'ouverture" inputMode="numeric" value={f.ob} onChange={(e) => setF({ ...f, ob: e.target.value.replace(/[^0-9-]/g, "") })} /></Field><Field label="À la date du"><input className="input" type="date" aria-label="Date d'ouverture" value={f.od} max={day()} onChange={(e) => setF({ ...f, od: e.target.value })} /></Field></div>
      <Note>Sans solde d'ouverture, le compte reste « à configurer » et aucun solde n'est affiché. Les flux antérieurs à cette date sont ignorés.</Note>
      {acc && <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Compte actif</label>}
      <Err e={m.error} /><button className="btn" disabled={m.isPending || f.name.trim().length < 2} onClick={() => m.mutate(body)}>Enregistrer</button>
    </div>
  );
}

function Accounts() {
  const { session } = useSession(); const mgr = session!.role === "owner" || session!.role === "manager"; const q = useFin<Accounts & { methods: { id: string; account: string | null }[] }>("fin.accounts"); const [edit, setEdit] = useState<Acc | "new" | null>(null);
  if (q.error) return <Err e={q.error} />; const d = q.data; if (!d) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />; const taken = new Map(d.methods.filter((x) => x.account).map((x) => [x.id, x.account!]));
  return (
    <div className="flex flex-col gap-3">
      {mgr && <button className="btn" onClick={() => setEdit("new")}>Nouveau compte</button>}
      {d.accounts.length === 0 && <p className="text-sm text-white/50">Aucun compte. Créez par exemple « Caisse », « Banque », « Wave / Orange Money », « Coffre ».</p>}
      {d.accounts.map((a) => <div key={a.id} className={`card flex flex-col gap-1 ${a.active ? "" : "opacity-50"}`}><div className="flex justify-between"><b>{a.name}</b><span>{a.configured ? money(a.balance) : <span className="text-amber-300 text-sm">À configurer</span>}</span></div>
        <p className="text-xs text-white/50">{a.kindLabel} · {a.methodLabels.join(", ") || "aucun moyen rattaché"}{!a.active && " · désactivé"}</p>
        {a.configured && <p className="text-xs text-white/40">Ouverture {money(a.openingBalance)} au {fmtDay(a.openingDate!)} · entrées {money(a.inflow)} · sorties {money(a.outflow)} · virements +{money(a.transfersIn)} / −{money(a.transfersOut)}</p>}
        {mgr && <button className="btn-ghost self-start" onClick={() => setEdit(a)}>Modifier</button>}</div>)}
      {d.unassigned.length > 0 && <div className="card flex flex-col gap-1"><p className="text-sm text-amber-300">Flux non rattachés à un compte</p>{d.unassigned.map((u) => <p key={u.method} className="text-xs text-white/60">{u.label} : {u.count} flux, entrées {money(u.inflow)}, sorties {money(u.outflow)}</p>)}<Note>Rattachez ces moyens de règlement à un compte pour qu'ils comptent dans les soldes.</Note></div>}
      <Note>{d.note}</Note>
      {edit && <Sheet title={edit === "new" ? "Nouveau compte" : `Modifier ${edit.name}`} onClose={() => setEdit(null)}><AccountForm acc={edit === "new" ? undefined : edit} methodsTaken={taken} onDone={() => setEdit(null)} /></Sheet>}
    </div>
  );
}

function Flows() {
  const [f, setF] = useState({ from: day(-30), to: day(), method: "", source: "", q: "" }); const q = useFin<{ flows: Flow[]; count: number; shown: number; total: { in: number; out: number }; note: string }>("fin.flows", { ...f, from: f.from || undefined, to: f.to || undefined, method: f.method || undefined, source: f.source || undefined, q: f.q || undefined });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2"><Field label="Du"><input className="input" type="date" aria-label="Du" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Au"><input className="input" type="date" aria-label="Au" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Moyen"><select className="input" aria-label="Moyen" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">Tous</option>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Source"><select className="input" aria-label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">Toutes</option>{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field></div>
      <input className="input" placeholder="Rechercher une pièce ou un libellé" aria-label="Recherche" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      <Err e={q.error} />
      {q.data && <><div className="grid grid-cols-2 gap-2"><Kpi label="Entrées" value={money(q.data.total.in)} tone="text-emerald-300" /><Kpi label="Sorties" value={money(q.data.total.out)} tone="text-red-300" /></div>
        <p className="text-xs text-white/50">{q.data.shown} ligne(s) affichée(s) sur {q.data.count}</p>
        <ul className="flex flex-col gap-1">{q.data.flows.map((x) => <li key={x.key} className="card flex justify-between gap-2 text-sm"><div><div>{x.label || x.sourceLabel}</div><div className="text-xs text-white/50">{fmtDay(x.date)} · {x.sourceLabel}{x.ref ? ` · ${x.ref}` : ""} · {x.methodLabel} · {x.account ?? "Non affecté"}{x.by ? ` · ${x.by}` : ""}</div></div><b className={x.amount >= 0 ? "text-emerald-300" : "text-red-300"}>{x.amount >= 0 ? "+" : "−"}{money(Math.abs(x.amount))}</b></li>)}</ul>
        <Note>{q.data.note}</Note></>}
    </div>
  );
}

function Transfers() {
  const accs = useFin<Accounts>("fin.accounts"); const q = useFin<{ transfers: Transfer[] }>("fin.transfers"); const [open, setOpen] = useState(false); const [key, setKey] = useState(rid); const [f, setF] = useState({ fromId: "", toId: "", amount: "", date: day(), reason: "" }); const [ask, setAsk] = useState<{ t: Transfer; cancel: boolean } | null>(null); const [why, setWhy] = useState(""); const [force, setForce] = useState<string | null>(null);
  const save = useAct("fin.transfer.save", () => { setOpen(false); setKey(rid()); setF({ fromId: "", toId: "", amount: "", date: day(), reason: "" }); }); const confirm = useAct("fin.transfer.confirm"); const cancel = useAct("fin.transfer.cancel", () => { setAsk(null); setWhy(""); });
  const active = (accs.data?.accounts ?? []).filter((a) => a.active); const { session } = useSession(); const mgr = session!.role === "owner" || session!.role === "manager";
  return (
    <div className="flex flex-col gap-3">
      <button className="btn" disabled={active.length < 2} onClick={() => setOpen(true)}>Nouveau virement interne</button>{active.length < 2 && <Note>Il faut au moins deux comptes actifs dans cette boutique.</Note>}
      <Err e={q.error ?? confirm.error} />
      {q.data?.transfers.map((t) => <div key={t.id} className="card flex flex-col gap-1"><div className="flex justify-between text-sm"><span>{t.from.name} → {t.to.name}</span><b>{money(t.amount)}</b></div><p className="text-xs text-white/50">{fmtDay(t.date)} · {t.statusLabel} · {t.reason}{t.cancelReason ? ` · annulé : ${t.cancelReason}` : ""}</p>
        <div className="flex gap-2">{t.status === "pending" && <button className="btn" disabled={confirm.isPending} onClick={() => confirm.mutate({ id: t.id })}>Confirmer</button>}{t.status === "pending" && mgr && confirm.error && <button className="btn-ghost" onClick={() => setForce(t.id)}>Forcer…</button>}{(t.status === "pending" || (t.status === "confirmed" && mgr)) && <button className="btn-ghost" onClick={() => setAsk({ t, cancel: true })}>Annuler</button>}</div></div>)}
      {q.data && q.data.transfers.length === 0 && <p className="text-sm text-white/50">Aucun virement.</p>}
      <Note>Un virement déplace de l'argent entre deux comptes de la même boutique : il ne change pas la trésorerie totale. Il compte dans les soldes seulement une fois confirmé.</Note>
      {open && <Sheet title="Nouveau virement" onClose={() => setOpen(false)}><div className="flex flex-col gap-3 p-3">
        <Field label="Depuis"><select className="input" aria-label="Compte source" value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })}><option value="">Choisir</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Vers"><select className="input" aria-label="Compte destination" value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}><option value="">Choisir</option>{active.filter((a) => a.id !== f.fromId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Montant (FCFA)"><input className="input" aria-label="Montant du virement" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Date"><input className="input" type="date" aria-label="Date du virement" max={day()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Motif"><input className="input" aria-label="Motif du virement" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} /></Field>
        <Err e={save.error} /><button className="btn" disabled={save.isPending || !f.fromId || !f.toId || !f.amount || f.reason.trim().length < 3} onClick={() => save.mutate({ requestKey: key, ...f, amount: Number(f.amount) })}>Créer le virement</button></div></Sheet>}
      {ask && <Sheet title="Annuler le virement" onClose={() => setAsk(null)}><div className="flex flex-col gap-3 p-3"><p className="text-sm">{ask.t.from.name} → {ask.t.to.name} · {money(ask.t.amount)}</p><Field label="Motif de l'annulation"><input className="input" aria-label="Motif d'annulation" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={cancel.error} /><button className="btn" disabled={cancel.isPending || why.trim().length < 3} onClick={() => cancel.mutate({ id: ask.t.id, reason: why })}>Annuler le virement</button></div></Sheet>}
      {force && <ForceSheet id={force} onClose={() => setForce(null)} />}
    </div>
  );
}
function ForceSheet({ id, onClose }: { id: string; onClose: () => void }) { const [r, setR] = useState(""); const m = useAct("fin.transfer.confirm", onClose); return (
  <Sheet title="Forcer le virement" onClose={onClose}><div className="flex flex-col gap-3 p-3"><p className="text-sm text-amber-300">Le solde du compte source est insuffisant : le forcer le rendra négatif. Justifiez-le.</p><Field label="Motif"><input className="input" aria-label="Motif du forçage" value={r} onChange={(e) => setR(e.target.value)} /></Field><Err e={m.error} /><button className="btn" disabled={m.isPending || r.trim().length < 5} onClick={() => m.mutate({ id, force: true, forceReason: r })}>Forcer et confirmer</button></div></Sheet>); }

type Prev = { account: string; asOf: string; bookBalance: number; statementBalance: number; diff: number; suggestions: { line: number; flowKey: string; score: number; why: string }[]; unmatchedLines: { i: number; date: string; amount: number; label: string }[]; unmatchedFlows: Flow[]; openCount: number; reconciledCount: number; note: string };
function parseLines(t: string): { date: string; amount: number; label: string }[] { return t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [date = "", amount = "", ...rest] = l.split(/[;\t]/); return { date: date.trim(), amount: Number(amount.replace(/\s/g, "").replace(",", ".")), label: rest.join(" ").trim() }; }); }
function Reco() {
  const accs = useFin<Accounts>("fin.accounts"); const hist = useFin<{ reconciliations: { id: string; account: string; asOf: string; statementBalance: number; bookBalance: number; diff: number; status: string; matched: number; note: string }[] }>("fin.reconciliations");
  const [f, setF] = useState({ accountId: "", asOf: day(), balance: "", text: "", note: "" }); const [prev, setPrev] = useState<Prev | null>(null); const [sel, setSel] = useState<Set<string>>(new Set()); const [key, setKey] = useState(rid);
  const pro = useFinPro(); const [tol, setTol] = useState("3"); const run = useAct(pro ? "finpro.reconcile.preview" : "fin.reconcile.preview", (p: Prev & { groups?: { line: number; flowKeys: string[]; why: string }[] }) => { setPrev(p); setSel(new Set(p.suggestions.map((s) => `${s.line}|${s.flowKey}`))); }); const save = useAct("fin.reconcile.save", () => { setPrev(null); setKey(rid()); setF({ accountId: "", asOf: day(), balance: "", text: "", note: "" }); });
  const lines = parseLines(f.text); const body = { accountId: f.accountId, asOf: f.asOf, statementBalance: Number(f.balance), statement: lines };
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-2"><Field label="Compte"><select className="input" aria-label="Compte à rapprocher" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">Choisir</option>{(accs.data?.accounts ?? []).filter((a) => a.active && a.configured).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Arrêté au"><input className="input" type="date" aria-label="Date du relevé" value={f.asOf} max={day()} onChange={(e) => setF({ ...f, asOf: e.target.value })} /></Field><Field label="Solde du relevé (FCFA)"><input className="input" aria-label="Solde du relevé" inputMode="numeric" value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value.replace(/[^0-9-]/g, "") })} /></Field></div>
        <Field label="Lignes du relevé (facultatif) : une par ligne « AAAA-MM-JJ;montant;libellé », montant négatif pour une sortie"><textarea className="input min-h-24" aria-label="Lignes du relevé" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
        {pro && <Field label="Tolérance de dates (jours, Pro)"><input className="input" aria-label="Tolérance de dates" inputMode="numeric" value={tol} onChange={(e) => setTol(e.target.value.replace(/\D/g, ""))} /></Field>}<Err e={run.error} /><button className="btn" disabled={run.isPending || !f.accountId || f.balance === "" || f.balance === "-"} onClick={() => run.mutate({ ...body, ...(pro ? { toleranceDays: Number(tol || 3) } : {}) })}>Comparer au solde calculé</button></div>
      {prev && <div className="card flex flex-col gap-2"><div className="grid grid-cols-3 gap-2 text-center text-sm"><div><div className="text-xs text-white/50">Calculé</div>{money(prev.bookBalance)}</div><div><div className="text-xs text-white/50">Relevé</div>{money(prev.statementBalance)}</div><div><div className="text-xs text-white/50">Écart</div><b className={prev.diff === 0 ? "text-emerald-300" : "text-amber-300"}>{money(prev.diff)}</b></div></div>
        {prev.suggestions.length > 0 && <div><p className="text-sm font-medium">Correspondances proposées (à confirmer)</p>{prev.suggestions.map((s) => { const k = `${s.line}|${s.flowKey}`; const l = lines[s.line]!; const fl = prev.unmatchedFlows.find((x) => x.key === s.flowKey); return <label key={k} className="flex gap-2 text-xs py-1"><input type="checkbox" checked={sel.has(k)} onChange={() => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />Relevé {fmtDay(l.date)} {money(l.amount)} {l.label} ↔ {fl ? `${fl.label || fl.sourceLabel} ${fmtDay(fl.date)}` : s.flowKey} <span className="text-white/40">({s.why})</span></label>; })}</div>}
        {(prev as Prev & { groups?: { line: number; flowKeys: string[]; why: string }[] }).groups?.map((g) => { const ks = g.flowKeys.map((k) => `${g.line}|${k}`); const on = ks.every((k) => sel.has(k)); const l = lines[g.line]!; return <label key={`g${g.line}`} className="flex gap-2 text-xs py-1"><input type="checkbox" checked={on} onChange={() => setSel((p) => { const n = new Set(p); for (const k of ks) { if (on) n.delete(k); else n.add(k); } return n; })} />Groupe : relevé {fmtDay(l.date)} {money(l.amount)} ↔ {g.flowKeys.length} flux <span className="text-white/40">({g.why})</span></label>; })}
        {prev.unmatchedLines.length > 0 && <p className="text-xs text-amber-300">{prev.unmatchedLines.length} ligne(s) du relevé sans correspondance dans l'application.</p>}
        <p className="text-xs text-white/50">{prev.openCount} flux non encore rapprochés · {prev.reconciledCount} déjà rapprochés.</p>
        <Field label={prev.diff === 0 ? "Note (facultative)" : "Explication de l'écart (obligatoire pour clôturer)"}><input className="input" aria-label="Note de rapprochement" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></Field>
        <Err e={save.error} /><div className="flex gap-2"><button className="btn" disabled={save.isPending} onClick={() => save.mutate({ requestKey: key, ...body, matched: [...sel].map((k) => ({ line: Number(k.split("|")[0]), flowKey: k.split("|").slice(1).join("|") })), note: f.note, close: true })}>Clôturer le rapprochement</button><button className="btn-ghost" disabled={save.isPending} onClick={() => save.mutate({ requestKey: rid(), ...body, matched: [...sel].map((k) => ({ line: Number(k.split("|")[0]), flowKey: k.split("|").slice(1).join("|") })), note: f.note, close: false })}>Enregistrer en brouillon</button></div>
        <Note>{prev.note}</Note></div>}
      <p className="text-sm font-medium">Historique</p>
      {hist.data?.reconciliations.map((r) => <div key={r.id} className="card text-sm flex justify-between"><span>{r.account} · {fmtDay(r.asOf)}<span className="block text-xs text-white/50">{r.status === "closed" ? "Clôturé" : "Brouillon"} · {r.matched} ligne(s){r.note ? ` · ${r.note}` : ""}</span></span><b className={r.diff === 0 ? "text-emerald-300" : "text-amber-300"}>{money(r.diff)}</b></div>)}
    </div>
  );
}

function DueSide({ title, s }: { title: string; s: Side }) {
  return (
    <div className="card flex flex-col gap-2"><div className="flex justify-between"><b>{title}</b><b>{money(s.total)}</b></div><p className="text-xs text-white/50">Échu : {money(s.overdue)} · à 30 jours : {money(s.dueSoon)}</p>
      <div className="grid grid-cols-3 gap-1 text-[11px]">{s.aging.map((a) => <div key={a.key} className="bg-white/5 rounded p-1"><div className="text-white/50">{a.label}</div>{money(a.amount)}</div>)}</div>
      {s.items.slice(0, 40).map((i, n) => <div key={`${i.ref}${n}`} className="flex justify-between text-sm border-t border-white/10 pt-1"><span>{i.party}<span className="block text-xs text-white/50">{i.ref}{i.due ? ` · échéance ${fmtDay(i.due)}` : " · sans échéance"}{i.note ? ` · ${i.note}` : ""}</span></span><b>{money(i.remaining)}</b></div>)}
    </div>
  );
}
function Dues() { const q = useFin<{ receivables: Side; payables: Side; note: string }>("fin.dues"); if (q.error) return <Err e={q.error} />; if (!q.data) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />; return <div className="flex flex-col gap-3"><DueSide title="À encaisser (créances)" s={q.data.receivables} /><DueSide title="À payer (dettes)" s={q.data.payables} /><Note>{q.data.note}</Note></div>; }

function Budgets({ mgr }: { mgr: boolean }) {
  const [month, setMonth] = useState(day().slice(0, 7)); const q = useFin<{ month: string; rows: { category: string; budget: number | null; spent: number; remaining: number | null; pct: number | null; state: string }[]; totals: { budget: number; spent: number; unbudgeted: number }; note: string }>("fin.budgets", { month }); const [f, setF] = useState({ category: "", amount: "" }); const m = useAct("fin.budget.save", () => setF({ category: "", amount: "" }));
  const tone: Record<string, string> = { ok: "text-emerald-300", warn: "text-amber-300", over: "text-red-300", none: "text-white/50" }; const label: Record<string, string> = { ok: "OK", warn: "À surveiller", over: "Dépassé", none: "Sans budget" };
  return (
    <div className="flex flex-col gap-3">
      <Field label="Mois"><input className="input" type="month" aria-label="Mois du budget" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field><Err e={q.error} />
      {q.data && <><div className="grid grid-cols-2 gap-2"><Kpi label="Budgété" value={money(q.data.totals.budget)} /><Kpi label="Dépensé" value={money(q.data.totals.spent)} hint={`dont hors budget ${money(q.data.totals.unbudgeted)}`} /></div>
        {q.data.rows.map((r) => <div key={r.category} className="card flex justify-between text-sm"><span>{r.category}<span className="block text-xs text-white/50">Budget {r.budget === null ? "—" : money(r.budget)} · dépensé {money(r.spent)}{r.pct !== null ? ` (${r.pct} %)` : ""}</span></span><b className={tone[r.state]}>{label[r.state]}</b></div>)}
        {q.data.rows.length === 0 && <p className="text-sm text-white/50">Aucun budget ni dépense ce mois-ci.</p>}<Note>{q.data.note}</Note></>}
      {mgr && <div className="card flex flex-col gap-2"><b className="text-sm">Fixer un budget</b><input className="input" placeholder="Catégorie (comme dans les dépenses)" aria-label="Catégorie du budget" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={40} /><input className="input" placeholder="Montant (FCFA)" aria-label="Montant du budget" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} /><Err e={m.error} /><button className="btn" disabled={m.isPending || f.category.trim().length < 2 || !f.amount} onClick={() => m.mutate({ month, category: f.category, amount: Number(f.amount) })}>Enregistrer le budget</button></div>}
    </div>
  );
}

function Reports() {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ section: "flows", from: day(-30), to: day() }); const [busy, setBusy] = useState(""); const [err, setErr] = useState<unknown>(null);
  const go = async (fmt: ExportFormat) => { setBusy(fmt); setErr(null); try { const r = await api<ReportData>(s, "fin.report", f); await exportReport(r, fmt); } catch (e) { setErr(e); } finally { setBusy(""); } };
  return (
    <div className="card flex flex-col gap-3">
      <Field label="Rapport"><select className="input" aria-label="Rapport" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}><option value="flows">Flux de trésorerie</option><option value="accounts">Comptes et soldes</option><option value="dues">Créances et dettes</option><option value="transfers">Virements internes</option><option value="budgets">Budgets du mois</option></select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Du"><input className="input" type="date" aria-label="Rapport du" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Au"><input className="input" type="date" aria-label="Rapport au" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
      <Err e={err} /><div className="flex gap-2">{(["pdf", "xlsx", "csv"] as const).map((x) => <button key={x} className="btn-ghost" disabled={!!busy} onClick={() => void go(x)}>{busy === x ? "…" : x === "xlsx" ? "Excel" : x.toUpperCase()}</button>)}</div>
      <Note>Chaque export est journalisé (qui, quand, quel rapport). Il reprend la boutique et la période choisies.</Note>
    </div>
  );
}
