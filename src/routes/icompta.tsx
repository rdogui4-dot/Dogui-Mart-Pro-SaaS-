import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { JOURNALS, STATUS_LABEL } from "@/domain/icompta";
import { exportReport, type ExportFormat } from "@/lib/report-export";
import type { ReportData } from "@/domain/exports";

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const fmtDay = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatFcfa(n));
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px] text-white/40">{children}</p>;
const Kpi = ({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) => <div className="card"><div className="text-white/50 text-xs">{label}</div><div className={`font-semibold text-lg ${tone}`}>{value}</div></div>;
const useQ = <T,>(action: string, payload: object = {}, enabled = true) => { const { session } = useSession(); const s = session!; return useQuery({ queryKey: ["ic", action, s.shopId, payload], enabled, retry: 1, queryFn: () => api<T>(s, action, payload) }); };
const useAct = (action: string, onOk?: (r: any) => void) => { const { session } = useSession(); const s = session!; const qc = useQueryClient(); return useMutation({ mutationFn: (b: object) => api<any>(s, action, b), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["ic"] }); onOk?.(r); } }); };

type Line = { account: string; debit: number; credit: number; label?: string };
type Ent = { id: string; number: string; seq: number | null; journal: string; date: string; label: string; lines: Line[]; total: number; status: "draft" | "pending" | "validated" | "rejected"; statusLabel: string; kind: string; kindLabel: string; originRef: string; pieces: { ref: string }[]; by: string; validator: string; rejecter: string; rejectReason: string; reversalOf: string; reversedBy: string; correctionOf: string; selfValidated: boolean; hash: string; prevHash: string; note: string };
type Tab = "syn" | "ent" | "prop" | "books" | "third" | "per" | "plan" | "rep";
const ST_TONE: Record<string, string> = { draft: "text-white/60", pending: "text-amber-300", validated: "text-emerald-300", rejected: "text-red-300" };

export function IComptaPage() {
  const { session } = useSession(); const s = session!; const mgr = s.role === "owner" || s.role === "manager"; const [tab, setTab] = useState<Tab>("syn");
  const tabs: [Tab, string][] = [["syn", "Synthèse"], ["ent", "Écritures"], ["prop", "Propositions"], ["books", "Grand livre"], ["third", "Tiers"], ["per", "Périodes"], ["plan", "Plan de comptes"], ["rep", "Rapports"]];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">ICompta</h1>
      <p className="text-xs text-white/50">Suivi comptable par boutique. Les écritures validées sont immuables et chaînées : toute modification ou suppression est détectée. Paramétrage et règles à faire confirmer par un expert-comptable.</p>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sections ICompta">{tabs.map(([k, l]) => <button key={k} role="tab" className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "syn" && <Synthese onTab={setTab} />}{tab === "ent" && <Entries mgr={mgr} />}{tab === "prop" && <Proposals />}{tab === "books" && <Books />}{tab === "third" && <Third />}{tab === "per" && <Periods mgr={mgr} owner={s.role === "owner"} />}{tab === "plan" && <Plan mgr={mgr} owner={s.role === "owner"} />}{tab === "rep" && <Reports />}
    </div>
  );
}

function Synthese({ onTab }: { onTab: (t: Tab) => void }) {
  const q = useQ<{ counts: Record<string, number>; proposals: { ready: number; blocked: number }; setup: { accounts: number; unconfirmed: number; unmappedCategories: number; deferredPayable: boolean; methodsMapped: boolean }; integrity: { ok: boolean; head: string; validated: number }; alerts: { level: string; text: string }[]; note: string }>("ic.overview"); const v = useQ<{ ok: boolean; head: string; validatedCount: number; issues: { level: string; text: string }[]; alerts: { level: string; text: string }[]; note: string }>("ic.verify");
  if (q.error) return <Err e={q.error} />; if (!q.data) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />; const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2"><Kpi label="Écritures validées" value={d.counts.validated ?? 0} tone="text-emerald-300" /><Kpi label="À valider" value={d.counts.pending ?? 0} tone={d.counts.pending ? "text-amber-300" : ""} /><Kpi label="Brouillons" value={d.counts.draft ?? 0} /><Kpi label="Propositions prêtes" value={d.proposals.ready} /></div>
      <div className={`card text-sm ${d.integrity.ok ? "text-emerald-300" : "text-red-300"}`} role="status">{d.integrity.ok ? `Intégrité vérifiée : ${d.integrity.validated} écriture(s) validée(s), aucune anomalie.` : "ANOMALIE D'INTÉGRITÉ DÉTECTÉE : voir ci-dessous."}</div>
      {[...(v.data?.issues ?? []), ...(v.data?.alerts ?? []), ...d.alerts.filter((a) => !(v.data?.issues ?? []).some((i) => i.text === a.text))].map((a, i) => <p key={i} className={`card text-sm ${a.level === "critical" ? "text-red-300" : "text-amber-300"}`}>{a.text}</p>)}
      <div className="card text-sm flex flex-col gap-1"><b>Paramétrage</b><p>{d.setup.accounts === 0 ? <span className="text-amber-300">Plan de comptes vide : importez celui de votre expert-comptable.</span> : <>{d.setup.accounts} compte(s) au plan, dont <span className={d.setup.unconfirmed ? "text-amber-300" : ""}>{d.setup.unconfirmed} non confirmé(s) par un professionnel</span>.</>}</p>{!d.setup.methodsMapped && <p className="text-amber-300">Comptes des espèces et de la banque non paramétrés.</p>}<p>{d.setup.unmappedCategories} catégorie(s) de dépenses sans compte de charge.{!d.setup.deferredPayable && " Compte des dettes à payer non défini."}</p><button className="btn-ghost self-start" onClick={() => onTab("plan")}>Compléter le paramétrage</button></div>
      {d.integrity.head && d.integrity.head !== "GENESIS" && <Note>Empreinte de tête de la chaîne : <span className="font-mono break-all">{d.integrity.head}</span>. Notez-la : elle prouve l'état de la comptabilité à cette date.</Note>}
      <Note>{d.note}</Note>
    </div>
  );
}

function EntryForm({ onDone, correct }: { onDone: () => void; correct?: { id: string; lines: Line[]; label: string } }) {
  const [f, setF] = useState({ journal: "OD", date: day(), label: correct?.label ?? "", piece: "", note: "" }); const [lines, setLines] = useState<{ account: string; debit: string; credit: string }[]>(correct ? correct.lines.map((l) => ({ account: l.account, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" })) : [{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]); const [key] = useState(rid);
  const m = useAct(correct ? "ic.entry.correct" : "ic.entry.save", onDone); const d = lines.reduce((s, l) => s + Number(l.debit || 0), 0), c = lines.reduce((s, l) => s + Number(l.credit || 0), 0); const set = (i: number, p: object) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const body = { requestKey: key, ...(correct ? { id: correct.id, reason: f.note, date: f.date, label: f.label } : { journal: f.journal, date: f.date, label: f.label, pieces: f.piece ? [{ ref: f.piece }] : [], note: f.note }), lines: lines.map((l) => ({ account: l.account, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })) };
  return (
    <div className="flex flex-col gap-3 p-3">
      {correct && <p className="text-xs text-amber-300">La correction contrepasse l'écriture d'origine (à valider) et crée l'écriture corrective ci-dessous (brouillon). L'originale reste intacte.</p>}
      <div className="grid grid-cols-2 gap-2">{!correct && <Field label="Journal"><select className="input" aria-label="Journal" value={f.journal} onChange={(e) => setF({ ...f, journal: e.target.value })}>{Object.entries(JOURNALS).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}</select></Field>}<Field label="Date"><input className="input" type="date" aria-label="Date de l'écriture" max={day()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field></div>
      <Field label="Libellé"><input className="input" aria-label="Libellé de l'écriture" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={200} /></Field>
      {lines.map((l, i) => <div key={i} className="grid grid-cols-3 gap-2"><input className="input" aria-label={`Compte ${i + 1}`} placeholder="Compte" inputMode="numeric" value={l.account} onChange={(e) => set(i, { account: e.target.value.replace(/\D/g, "") })} /><input className="input" aria-label={`Débit ${i + 1}`} placeholder="Débit" inputMode="numeric" value={l.debit} onChange={(e) => set(i, { debit: e.target.value.replace(/\D/g, ""), credit: "" })} /><input className="input" aria-label={`Crédit ${i + 1}`} placeholder="Crédit" inputMode="numeric" value={l.credit} onChange={(e) => set(i, { credit: e.target.value.replace(/\D/g, ""), debit: "" })} /></div>)}
      <button className="btn-ghost self-start" onClick={() => setLines([...lines, { account: "", debit: "", credit: "" }])}>Ajouter une ligne</button>
      <p className={`text-sm ${d === c && d > 0 ? "text-emerald-300" : "text-amber-300"}`}>Débit {money(d)} · Crédit {money(c)} {d === c && d > 0 ? "· équilibrée" : "· à équilibrer"}</p>
      {!correct && <Field label="Pièce justificative (référence obligatoire pour soumettre)"><input className="input" aria-label="Pièce justificative" value={f.piece} onChange={(e) => setF({ ...f, piece: e.target.value })} maxLength={64} /></Field>}
      <Field label={correct ? "Motif de la correction (obligatoire)" : "Note (facultative)"}><input className="input" aria-label={correct ? "Motif de la correction" : "Note"} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></Field>
      <Err e={m.error} /><button className="btn" disabled={m.isPending || f.label.trim().length < 3 || d !== c || d === 0 || (!!correct && f.note.trim().length < 5)} onClick={() => m.mutate(body)}>{correct ? "Créer la correction" : "Enregistrer le brouillon"}</button>
    </div>
  );
}

function EntrySheet({ id, onClose, mgr }: { id: string; onClose: () => void; mgr: boolean }) {
  const q = useQ<{ entry: Ent; trail: { at: string; action: string; by: string; detail: string }[] }>("ic.entry", { id }); const [mode, setMode] = useState<"" | "reject" | "reverse" | "correct">(""); const [why, setWhy] = useState(""); const done = () => { setMode(""); setWhy(""); };
  const submit = useAct("ic.entry.submit"); const validate = useAct("ic.entry.validate"); const reject = useAct("ic.entry.reject", done); const reverse = useAct("ic.entry.reverse", () => { done(); onClose(); }); const [rk] = useState(rid); const e = q.data?.entry;
  return (
    <Sheet title={e?.number || "Écriture"} onClose={onClose} back>
      <Err e={q.error} />{e && <div className="flex flex-col gap-3 p-3">
        <div className="card flex flex-col gap-1 text-sm"><div className="flex justify-between"><b>{e.label}</b><b className={ST_TONE[e.status]}>{STATUS_LABEL[e.status]}</b></div><p className="text-xs text-white/50">{fmtDay(e.date)} · journal {e.journal} · {e.kindLabel}{e.originRef ? ` · ${e.originRef}` : ""} · saisi par {e.by || "—"}{e.validator ? ` · validé par ${e.validator}` : ""}{e.selfValidated ? " · AUTO-VALIDÉE" : ""}</p>{e.pieces.length > 0 && <p className="text-xs text-white/50">Pièces : {e.pieces.map((p) => p.ref).join(", ")}</p>}{e.rejectReason && <p className="text-xs text-red-300">Rejet : {e.rejectReason}</p>}{e.reversedBy && <p className="text-xs text-amber-300">Contrepassée</p>}</div>
        <table className="w-full text-sm"><thead className="text-white/50 text-xs"><tr><th className="text-left">Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead><tbody>{e.lines.map((l, i) => <tr key={i} className="border-t border-white/10"><td>{l.account}</td><td className="text-right">{l.debit ? money(l.debit) : ""}</td><td className="text-right">{l.credit ? money(l.credit) : ""}</td></tr>)}</tbody></table>
        <Err e={submit.error ?? validate.error} />
        <div className="flex gap-2 flex-wrap">{e.status === "draft" && <button className="btn" disabled={submit.isPending} onClick={() => submit.mutate({ id })}>Soumettre pour validation</button>}{e.status === "pending" && mgr && <button className="btn" disabled={validate.isPending} onClick={() => validate.mutate({ id })}>Valider</button>}{(e.status === "pending" || e.status === "draft") && <button className="btn-ghost" onClick={() => setMode("reject")}>{e.status === "draft" ? "Abandonner" : "Rejeter"}</button>}{e.status === "validated" && !e.reversedBy && !e.reversalOf && <><button className="btn-ghost" onClick={() => setMode("reverse")}>Contrepasser</button><button className="btn-ghost" onClick={() => setMode("correct")}>Corriger…</button></>}</div>
        {mode === "reject" && <div className="card flex flex-col gap-2"><input className="input" aria-label="Motif du rejet" placeholder="Motif" value={why} onChange={(x) => setWhy(x.target.value)} /><Err e={reject.error} /><button className="btn" disabled={why.trim().length < 3 || reject.isPending} onClick={() => reject.mutate({ id, reason: why })}>Confirmer</button></div>}
        {mode === "reverse" && <div className="card flex flex-col gap-2"><p className="text-xs text-white/60">Crée une écriture inverse « à valider ». L'écriture d'origine n'est jamais modifiée.</p><input className="input" aria-label="Motif de la contrepassation" placeholder="Motif (5 caractères au moins)" value={why} onChange={(x) => setWhy(x.target.value)} /><Err e={reverse.error} /><button className="btn" disabled={why.trim().length < 5 || reverse.isPending} onClick={() => reverse.mutate({ id, requestKey: rk, reason: why })}>Contrepasser</button></div>}
        {mode === "correct" && <EntryForm correct={{ id, lines: e.lines, label: e.label }} onDone={() => { done(); onClose(); }} />}
        {e.hash && <Note>Empreinte : <span className="font-mono break-all">{e.hash}</span><br />Précédente : <span className="font-mono break-all">{e.prevHash}</span></Note>}
        <b className="text-sm">Piste d'audit</b>{q.data!.trail.map((t, i) => <p key={i} className="text-xs text-white/60 border-t border-white/10 pt-1">{new Date(t.at).toLocaleString("fr-FR")} · {t.by} · {t.action.replace("icompta.", "")} · {t.detail}</p>)}
      </div>}
    </Sheet>
  );
}

function Entries({ mgr }: { mgr: boolean }) {
  const [status, setStatus] = useState(""); const [q, setQ] = useState(""); const list = useQ<{ entries: Ent[]; count: number; counts: Record<string, number>; note: string }>("ic.entries", { status: status || undefined, q: q || undefined }); const [open, setOpen] = useState<string | null>(null); const [nw, setNw] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button className="btn" onClick={() => setNw(true)}>Nouvelle écriture</button>
      <div className="flex gap-2 flex-wrap">{["", "draft", "pending", "validated", "rejected"].map((s) => <button key={s || "all"} className="chip" aria-current={status === s} onClick={() => setStatus(s)}>{s ? STATUS_LABEL[s as keyof typeof STATUS_LABEL] : "Toutes"}{s && list.data ? ` (${list.data.counts[s] ?? 0})` : ""}</button>)}</div>
      <input className="input" aria-label="Rechercher une écriture" placeholder="Rechercher (n°, libellé, pièce)" value={q} onChange={(e) => setQ(e.target.value)} /><Err e={list.error} />
      {list.data?.entries.map((e) => <button key={e.id} className="card text-left flex justify-between gap-2 text-sm" onClick={() => setOpen(e.id)}><span>{e.number || "—"} · {e.label}<span className="block text-xs text-white/50">{fmtDay(e.date)} · {e.journal} · {e.kindLabel}</span></span><span className="text-right"><b>{money(e.total)}</b><span className={`block text-xs ${ST_TONE[e.status]}`}>{e.statusLabel}</span></span></button>)}
      {list.data?.entries.length === 0 && <p className="text-sm text-white/50">Aucune écriture.</p>}{list.data && <Note>{list.data.note}</Note>}
      {nw && <Sheet title="Nouvelle écriture" onClose={() => setNw(false)} back><EntryForm onDone={() => setNw(false)} /></Sheet>}{open && <EntrySheet id={open} mgr={mgr} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Proposals() {
  const q = useQ<{ proposals: { key: string; kind: string; date: string; label: string; amount: number; ready: boolean; blocked: string; journal: string; lines: Line[] }[]; ready: number; blocked: number; note: string }>("ic.proposals"); const [sel, setSel] = useState<Set<string>>(new Set()); const m = useAct("ic.proposal.create", () => setSel(new Set()));
  if (q.error) return <Err e={q.error} />; if (!q.data) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />;
  return (
    <div className="flex flex-col gap-3"><p className="text-sm text-white/70">Événements réels sans écriture comptable (dépenses, paiements de dépenses, mouvements de caisse). Une proposition devient un <b>brouillon</b> ; rien n'est comptabilisé automatiquement.</p>
      {q.data.proposals.length === 0 && <p className="text-sm text-white/50">Aucun événement en attente.</p>}
      {q.data.proposals.map((p) => <div key={p.key} className="card flex flex-col gap-1 text-sm"><div className="flex justify-between gap-2"><span>{p.label}<span className="block text-xs text-white/50">{fmtDay(p.date)} · journal {p.journal}</span></span><b>{money(p.amount)}</b></div>
        {p.ready ? <label className="flex gap-2 text-xs"><input type="checkbox" aria-label={`Choisir ${p.label}`} checked={sel.has(p.key)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })} />Débit {p.lines[0]?.account} / crédit {p.lines[1]?.account}</label> : <p className="text-xs text-amber-300">Bloquée : {p.blocked}</p>}</div>)}
      <Err e={m.error} />{m.data && m.data.skipped?.length > 0 && <p className="text-xs text-amber-300">{m.data.skipped.length} proposition(s) non créée(s).</p>}
      <button className="btn" disabled={m.isPending || sel.size === 0} onClick={() => m.mutate({ keys: [...sel] })}>Créer {sel.size} brouillon(s)</button><Note>{q.data.note}</Note></div>
  );
}

function Books() {
  const [mode, setMode] = useState<"ledger" | "balance">("balance"); const [f, setF] = useState({ account: "571", from: `${day().slice(0, 4)}-01-01`, to: day() });
  const led = useQ<{ account: string; label: string; opening: number; rows: { date: string; ref: string; label: string; debit: number; credit: number; balance: number; source: string; number: string }[]; debit: number; credit: number; closing: number; note: string }>("ic.ledger", f, mode === "ledger" && /^\d{2,8}$/.test(f.account)); const bal = useQ<{ rows: { account: string; label: string; debit: number; credit: number; solde: number; inPlan: boolean }[]; totals: { debit: number; credit: number; balanced: boolean }; outOfPlan: number; note: string }>("ic.balance", { from: f.from, to: f.to }, mode === "balance");
  return (
    <div className="flex flex-col gap-3"><div className="flex gap-2"><button className="chip" aria-current={mode === "balance"} onClick={() => setMode("balance")}>Balance</button><button className="chip" aria-current={mode === "ledger"} onClick={() => setMode("ledger")}>Grand livre d'un compte</button></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Du"><input className="input" type="date" aria-label="Livre du" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Au"><input className="input" type="date" aria-label="Livre au" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
      {mode === "ledger" && <Field label="Compte"><input className="input" aria-label="Compte du grand livre" inputMode="numeric" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value.replace(/\D/g, "") })} /></Field>}
      <Err e={led.error ?? bal.error} />
      {mode === "balance" && bal.data && <><div className={`card text-sm ${bal.data.totals.balanced ? "text-emerald-300" : "text-red-300"}`}>Débits {money(bal.data.totals.debit)} · Crédits {money(bal.data.totals.credit)} · {bal.data.totals.balanced ? "équilibrée" : "NON ÉQUILIBRÉE"}</div>{bal.data.rows.map((r) => <p key={r.account} className="card flex justify-between text-sm"><span>{r.account} · {r.label}{!r.inPlan && <span className="text-amber-300"> (hors plan)</span>}<span className="block text-xs text-white/50">D {money(r.debit)} · C {money(r.credit)}</span></span><b>{money(r.solde)}</b></p>)}<Note>{bal.data.note}</Note></>}
      {mode === "ledger" && led.data && <><p className="text-sm">{led.data.account} · {led.data.label || "compte"} — ouverture {money(led.data.opening)} · clôture <b>{money(led.data.closing)}</b></p>{led.data.rows.slice(-200).map((r, i) => <p key={i} className="card flex justify-between text-xs"><span>{fmtDay(r.date)} · {r.ref} · {r.label}<span className="block text-white/40">{r.source}{r.number ? ` ${r.number}` : ""}</span></span><span className="text-right">{r.debit ? `D ${money(r.debit)}` : `C ${money(r.credit)}`}<span className="block text-white/50">{money(r.balance)}</span></span></p>)}<Note>{led.data.note}</Note></>}
    </div>
  );
}

function Third() {
  const [kind, setKind] = useState<"customer" | "supplier">("customer"); const q = useQ<{ account: string; parties: { id: string; name: string; invoiced: number; paid: number; remaining: number; invoices: { number: string; date: string; total: number; paid: number; due: string }[] }[]; totals: { invoiced: number; paid: number; remaining: number }; note: string }>("ic.third", { kind });
  return (
    <div className="flex flex-col gap-3"><div className="flex gap-2"><button className="chip" aria-current={kind === "customer"} onClick={() => setKind("customer")}>Clients (411)</button><button className="chip" aria-current={kind === "supplier"} onClick={() => setKind("supplier")}>Fournisseurs (401)</button></div><Err e={q.error} />
      {q.data && <><div className="card text-sm">Facturé {money(q.data.totals.invoiced)} · réglé {money(q.data.totals.paid)} · <b>reste {money(q.data.totals.remaining)}</b></div>{q.data.parties.map((p) => <details key={p.id} className="card text-sm"><summary className="cursor-pointer flex justify-between"><span>{p.name}</span><b>{money(p.remaining)}</b></summary>{p.invoices.map((i) => <p key={i.number} className="text-xs text-white/60 border-t border-white/10 pt-1 mt-1">{i.number} · {fmtDay(i.date)} · {money(i.total)} · réglé {money(i.paid)}{i.due ? ` · échéance ${fmtDay(i.due)}` : ""}</p>)}</details>)}<Note>{q.data.note}</Note></>}</div>
  );
}

function Periods({ mgr, owner }: { mgr: boolean; owner: boolean }) {
  const [year, setYear] = useState(new Date().getUTCFullYear()); const q = useQ<{ periods: { key: string; status: string; closedBy: string; closedAt: string; entries: number; pending: number; reopened: number }[]; note: string }>("ic.periods", { year }); const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3"><Field label="Exercice (année civile)"><input className="input" aria-label="Exercice" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field><Err e={q.error} />
      {q.data?.periods.map((p) => <button key={p.key} className="card text-left flex justify-between text-sm" onClick={() => setSel(p.key)}><span>{p.key}<span className="block text-xs text-white/50">{p.entries} écriture(s){p.pending ? ` · ${p.pending} à traiter` : ""}{p.reopened ? ` · rouverte ${p.reopened}×` : ""}</span></span><b className={p.status === "closed" ? "text-emerald-300" : "text-amber-300"}>{p.status === "closed" ? "Clôturée" : "Ouverte"}</b></button>)}
      {q.data && <Note>{q.data.note}</Note>}{sel && <PeriodSheet pkey={sel} mgr={mgr} owner={owner} onClose={() => setSel(null)} />}</div>
  );
}
function PeriodSheet({ pkey, mgr, owner, onClose }: { pkey: string; mgr: boolean; owner: boolean; onClose: () => void }) {
  const q = useQ<{ controls: { id: string; label: string; ok: boolean; blocking: boolean; detail: string; items?: string[] }[]; canClose: boolean; closed: boolean }>("ic.period.controls", { key: pkey }); const close = useAct("ic.period.close", onClose); const reopen = useAct("ic.period.reopen", onClose); const [why, setWhy] = useState(""); const [ro, setRo] = useState(false);
  return (
    <Sheet title={`Période ${pkey}`} onClose={onClose} back><div className="flex flex-col gap-3 p-3"><Err e={q.error} />
      {q.data?.controls.map((c) => <div key={c.id} className="card flex flex-col gap-1 text-sm"><p className={c.ok ? "text-emerald-300" : c.blocking ? "text-red-300" : "text-amber-300"}>{c.ok ? "✓" : c.blocking ? "✗" : "!"} {c.label}</p><p className="text-xs text-white/60">{c.detail}</p>{c.items?.map((x, i) => <p key={i} className="text-[11px] text-white/40">• {x}</p>)}</div>)}
      <Err e={close.error} />{q.data && !q.data.closed && mgr && <button className="btn" disabled={close.isPending || !q.data.canClose} onClick={() => close.mutate({ key: pkey })}>{q.data.canClose ? "Clôturer la période" : "Clôture bloquée : corrigez les contrôles en rouge"}</button>}
      {q.data?.closed && owner && <><button className="btn-ghost" onClick={() => setRo(true)}>Rouvrir (propriétaire)</button>{ro && <div className="card flex flex-col gap-2"><p className="text-xs text-amber-300">Une réouverture est tracée et signalée dans les alertes d'intégrité.</p><input className="input" aria-label="Motif de réouverture" placeholder="Motif détaillé (10 caractères au moins)" value={why} onChange={(e) => setWhy(e.target.value)} /><Err e={reopen.error} /><button className="btn" disabled={why.trim().length < 10 || reopen.isPending} onClick={() => reopen.mutate({ key: pkey, reason: why })}>Confirmer la réouverture</button></div>}</>}</div></Sheet>
  );
}

function Plan({ mgr, owner }: { mgr: boolean; owner: boolean }) {
  const a = useQ<{ accounts: { code: string; label: string; active: boolean; confirmed: boolean; confirmedBy: string }[]; used: { code: string; entries: number; debit: number; credit: number; inPlan: boolean }[]; empty: boolean; note: string }>("ic.accounts"); const c = useQ<{ config: { categories: Record<string, string>; methods: { cash?: string; transfer?: string; mobile?: string; other?: string }; deferredPayable: string; cashMoveIn: string; cashMoveOut: string }; categories: string[]; unmappedCategories: string[]; note: string }>("ic.config");
  const [nw, setNw] = useState({ code: "", label: "" }); const save = useAct("ic.account.save", () => setNw({ code: "", label: "" })); const [imp, setImp] = useState(""); const im = useAct("ic.account.import", () => setImp("")); const [adopt, setAdopt] = useState<Record<string, string>>({}); const [cfg, setCfg] = useState<Record<string, string>>({}); const cs = useAct("ic.config.save", () => setCfg({}));
  const cur = (k: string, v: string) => cfg[k] ?? v; const buildCfg = () => { const d = c.data!.config; const cats: Record<string, string> = {}; for (const n of c.data!.categories) cats[n] = cur(`cat:${n}`, d.categories[n] ?? ""); return { categories: cats, methods: { cash: cur("cash", d.methods.cash ?? ""), transfer: cur("transfer", d.methods.transfer ?? ""), mobile: cur("mobile", d.methods.mobile ?? ""), other: cur("other", d.methods.other ?? "") }, deferredPayable: cur("dp", d.deferredPayable), cashMoveIn: cur("cin", d.cashMoveIn), cashMoveOut: cur("cout", d.cashMoveOut) }; };
  const inp = (k: string, v: string, label: string) => <Field key={k} label={label}><input className="input" aria-label={label} inputMode="numeric" disabled={!mgr} value={cur(k, v)} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value.replace(/\D/g, "") })} /></Field>;
  return (
    <div className="flex flex-col gap-3"><Err e={a.error} />
      {a.data && <><p className="card text-sm text-amber-300">{a.data.note}</p>
        <b className="text-sm">Mon plan de comptes ({a.data.accounts.length})</b>{a.data.empty && <p className="text-sm text-white/50">Aucun compte. Importez le plan de votre expert-comptable ci-dessous.</p>}
        {a.data.accounts.map((x) => <div key={x.code} className={`card flex justify-between text-sm ${x.active ? "" : "opacity-50"}`}><span>{x.code} · {x.label}</span><span className={`text-xs ${x.confirmed ? "text-emerald-300" : "text-amber-300"}`}>{x.confirmed ? `Confirmé (${x.confirmedBy})` : "À confirmer"}{owner && !x.confirmed && <button className="btn-ghost ml-2 !py-1" onClick={() => save.mutate({ code: x.code, confirm: true })}>Confirmer</button>}</span></div>)}
        {mgr && <div className="card flex flex-col gap-2"><b className="text-sm">Importer un plan (un compte par ligne : numéro;libellé)</b><textarea className="input min-h-24 font-mono text-xs" aria-label="Plan de comptes à importer" placeholder={"ex.\n571;Caisse\n701;Ventes de marchandises"} value={imp} onChange={(e) => setImp(e.target.value)} /><Err e={im.error} />{im.data && <p className="text-xs text-white/60">{im.data.created} compte(s) importé(s){im.data.skipped.length ? `, ${im.data.skipped.length} ligne(s) ignorée(s)` : ""}.</p>}<button className="btn" disabled={im.isPending || imp.trim().length < 3} onClick={() => im.mutate({ text: imp })}>Importer</button></div>}
        {mgr && <div className="card flex flex-col gap-2"><b className="text-sm">Ajouter un compte</b><div className="grid grid-cols-3 gap-2"><input className="input" aria-label="Numéro du nouveau compte" placeholder="N°" inputMode="numeric" value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value.replace(/\D/g, "") })} /><input className="input col-span-2" aria-label="Libellé du nouveau compte" placeholder="Libellé" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} /></div><Err e={save.error} /><button className="btn" disabled={save.isPending || nw.code.length < 2 || nw.label.trim().length < 2} onClick={() => save.mutate(nw)}>Ajouter</button></div>}
        <b className="text-sm">Codes utilisés par l'application (réels)</b><p className="text-xs text-white/50">Numéros employés par les écritures automatiques (ventes, achats, paiements), avec leurs montants réels. Ce sont des choix techniques de l'application : faites-les valider par votre expert-comptable, puis reprenez-les dans votre plan avec leur vrai libellé.</p>
        {a.data.used.length === 0 && <p className="text-sm text-white/50">Aucune écriture automatique pour le moment.</p>}
        {a.data.used.map((u) => <div key={u.code} className="card flex flex-col gap-1 text-sm"><div className="flex justify-between"><span>{u.code} <span className="text-xs text-white/50">· {u.entries} ligne(s)</span></span><span className={`text-xs ${u.inPlan ? "text-emerald-300" : "text-amber-300"}`}>{u.inPlan ? "Dans votre plan" : "Absent de votre plan"}</span></div><p className="text-xs text-white/50">Débit {money(u.debit)} · Crédit {money(u.credit)}</p>{mgr && !u.inPlan && <div className="flex gap-2"><input className="input" aria-label={`Libellé du compte ${u.code}`} placeholder="Libellé selon votre expert-comptable" value={adopt[u.code] ?? ""} onChange={(e) => setAdopt({ ...adopt, [u.code]: e.target.value })} /><button className="btn-ghost" disabled={(adopt[u.code] ?? "").trim().length < 2} onClick={() => save.mutate({ code: u.code, label: adopt[u.code] })}>Reprendre</button></div>}</div>)}</>}
      <b className="text-sm">Correspondances de comptes (aucun compte n'est supposé)</b>
      {c.data && <div className="card flex flex-col gap-2">{inp("cash", c.data.config.methods.cash ?? "", "Compte des espèces (caisse)")}{inp("transfer", c.data.config.methods.transfer ?? "", "Compte de la banque (virements)")}{inp("mobile", c.data.config.methods.mobile ?? "", "Compte « mobile money »")}{inp("other", c.data.config.methods.other ?? "", "Compte « autre moyen »")}{c.data.categories.map((n) => inp(`cat:${n}`, c.data!.config.categories[n] ?? "", `Charge — catégorie « ${n} »`))}{inp("dp", c.data.config.deferredPayable, "Dettes à payer (dépenses différées)")}{inp("cin", c.data.config.cashMoveIn, "Contrepartie des apports de caisse")}{inp("cout", c.data.config.cashMoveOut, "Contrepartie des retraits de caisse")}<Err e={cs.error} />{mgr && <button className="btn" disabled={cs.isPending || Object.keys(cfg).length === 0} onClick={() => cs.mutate({ config: buildCfg() })}>Enregistrer les correspondances</button>}<Note>{c.data.note}</Note></div>}
    </div>
  );
}

function Reports() {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ section: "journal", from: `${day().slice(0, 4)}-01-01`, to: day() }); const [busy, setBusy] = useState(""); const [err, setErr] = useState<unknown>(null);
  const go = async (fmt: ExportFormat) => { setBusy(fmt); setErr(null); try { await exportReport(await api<ReportData>(s, "ic.report", f), fmt); } catch (e) { setErr(e); } finally { setBusy(""); } };
  return (
    <div className="card flex flex-col gap-3"><Field label="Rapport"><select className="input" aria-label="Rapport ICompta" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}><option value="journal">Journal des écritures validées</option><option value="balance">Balance générale</option><option value="ledger">Grand livre (tous comptes)</option><option value="third">Comptes clients et fournisseurs</option></select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Du"><input className="input" type="date" aria-label="Rapport du" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Au"><input className="input" type="date" aria-label="Rapport au" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
      <Err e={err} /><div className="flex gap-2">{(["pdf", "xlsx", "csv"] as const).map((x) => <button key={x} className="btn-ghost" disabled={!!busy} onClick={() => void go(x)}>{busy === x ? "…" : x === "xlsx" ? "Excel" : x.toUpperCase()}</button>)}</div><Note>Chaque export est journalisé. Ces états sont opérationnels, non réglementaires : à faire valider par un expert-comptable.</Note></div>
  );
}
