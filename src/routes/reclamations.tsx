import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const fmtDay = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;

export type Claim = { id: string; receipt: string; supplierId: string; supplier: string; kind: string; kindLabel: string; productId: string; name: string; qty: number; unitCost: number; value: number; status: string; decision: string; decisionLabel: string; reason: string; decidedBy: string; creditId: string; at: string };
type ClaimList = { claims: Claim[]; openCount: number; openQty: number; openValue: number; lostValue: number; note: string };
type Credit = { id: string; number: string; supplierId: string; supplier: string; amount: number; applied: number; refunded: number; remaining: number; status: string; reason: string; claims: number; applications: { invoice?: string; amount: number; at: string }[]; refunds: { amount: number; method: string; source: string; date: string; reference: string }[]; by: string; at: string };
type Inv = { id: string; number: string; supplierId: string; remaining: number; state: string; provisional: boolean };
const CREDIT_LABEL: Record<string, string> = { open: "Ouvert", partial: "Partiellement utilisé", settled: "Soldé", cancelled: "Annulé" };
const METHODS: Record<string, string> = { card: "Banque / virement", wave: "Wave", orange: "Orange Money", cash: "Espèces (hors caisse)" };

const useAct = (action: string, onOk?: (r?: any) => void) => { const { session } = useSession(); const s = session!; const qc = useQueryClient(); return useMutation({ mutationFn: (b: object) => api<any>(s, action, b), onSuccess: (r) => { void qc.invalidateQueries({ predicate: (q) => ["claims", "credits", "purch", "stock", "art-moves", "fin"].some((k) => String(q.queryKey[0]).startsWith(k)) }); onOk?.(r); } }); };

/** Bloc de la fiche article : unités endommagées/refusées/retournées de CET article et ce qu'elles sont devenues. */
export function ClaimsBlock({ productId }: { productId: string }) {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["claims", s.shopId, productId], retry: 1, queryFn: () => api<ClaimList>(s, "claim.list", { productId }) });
  if (!q.data || q.data.claims.length === 0) return null;
  return (
    <div className="card flex flex-col gap-1"><h3 className="font-semibold">Unités endommagées, refusées ou retournées</h3>
      <p className="text-xs text-white/50">Elles ne sont pas dans le stock vendable. {q.data.openCount > 0 ? `${q.data.openQty} unité(s) attendent une décision (${formatFcfa(q.data.openValue)}).` : "Toutes ont reçu une décision."}</p>
      {q.data.claims.map((c) => <p key={c.id} className="text-xs text-white/70 border-t border-[var(--line)] pt-1"><span className="text-white/50">{fmtDay(c.at)}</span> · {c.kindLabel} · <b className="text-amber-300">{c.qty}</b> · {c.receipt} · {c.status === "open" ? <span className="text-amber-300">À décider</span> : c.decisionLabel}{c.creditId ? " · avoir créé" : ""}{c.reason ? ` · ${c.reason}` : ""}</p>)}
    </div>
  );
}

function DecideSheet({ c, onClose }: { c: Claim; onClose: () => void }) {
  const [decision, setDecision] = useState(c.kind === "refused" ? "return" : "return"); const [reason, setReason] = useState(""); const m = useAct("claim.decide", onClose);
  const opts = c.kind === "refused" ? [["return", "Renvoyé au fournisseur"]] : [["return", "Renvoyer au fournisseur (avoir possible)"], ["writeoff", "Mettre au rebut (perte)"], ["restock", "Remettre en stock après contrôle"]];
  return (
    <Sheet title={`Décision · ${c.name}`} onClose={onClose} back><div className="flex flex-col gap-3 p-3">
      <p className="text-sm">{c.kindLabel} · {c.qty} unité(s) · valeur {formatFcfa(c.value)} · réception {c.receipt}</p>
      <Field label="Décision"><select className="input" aria-label="Décision" value={decision} onChange={(e) => setDecision(e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {decision === "restock" && <p className="text-xs text-amber-300">Le stock augmentera de {c.qty} : à n'utiliser que si l'article est bien vendable.</p>}
      <Field label="Motif"><input className="input" aria-label="Motif de la décision" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      <Err e={m.error} /><button className="btn" disabled={m.isPending || reason.trim().length < 3} onClick={() => m.mutate({ id: c.id, decision, reason })}>Enregistrer la décision</button>
    </div></Sheet>
  );
}

function CreditCreateSheet({ claims, onClose }: { claims: Claim[]; onClose: () => void }) {
  const [key] = useState(rid); const [reason, setReason] = useState(""); const max = claims.reduce((a, c) => a + c.value, 0); const [amount, setAmount] = useState(String(max)); const m = useAct("credit.create", onClose);
  return (
    <Sheet title={`Avoir fournisseur · ${claims[0]?.supplier ?? ""}`} onClose={onClose} back><div className="flex flex-col gap-3 p-3">
      {claims.map((c) => <p key={c.id} className="text-sm">{c.name} × {c.qty} · {c.receipt} · {formatFcfa(c.value)}</p>)}
      <Field label={`Montant de l'avoir (FCFA, au plus ${max})`}><input className="input" aria-label="Montant de l'avoir" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></Field>
      <Field label="Motif"><input className="input" aria-label="Motif de l'avoir" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      <Err e={m.error} /><button className="btn" disabled={m.isPending || reason.trim().length < 3 || !amount} onClick={() => m.mutate({ requestKey: key, claimIds: claims.map((c) => c.id), reason, amount: Number(amount) })}>Créer l'avoir</button>
    </div></Sheet>
  );
}

function CreditSheet({ credit, onClose }: { credit: Credit; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const inv = useQuery({ queryKey: ["purch-inv-credit", s.shopId, credit.supplierId], queryFn: () => api<{ invoices: Inv[] }>(s, "purch.invoice.list", { supplierId: credit.supplierId }) });
  const due = (inv.data?.invoices ?? []).filter((i) => i.remaining > 0 && !i.provisional);
  const [mode, setMode] = useState<"" | "deduct" | "refund" | "cancel">(""); const [invoiceId, setInvoiceId] = useState(""); const [amount, setAmount] = useState(String(credit.remaining)); const [method, setMethod] = useState("card"); const [till, setTill] = useState(false); const [why, setWhy] = useState(""); const [key, setKey] = useState(rid);
  const done = () => { setMode(""); setKey(rid()); onClose(); };
  const [warn, setWarn] = useState(""); const apply = useAct("credit.apply", done); const refund = useAct("credit.refund", (r) => { if (r?.treasuryWarning) { setWarn(String(r.treasuryWarning)); setMode(""); setKey(rid()); } else done(); }); const cancel = useAct("credit.cancel", done); const open = credit.status === "open" || credit.status === "partial";
  const chosen = due.find((i) => i.id === invoiceId);
  return (
    <Sheet title={`Avoir ${credit.number}`} onClose={onClose} back><div className="flex flex-col gap-3 p-3">
      <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>{credit.supplier}</b><b>{formatFcfa(credit.amount)}</b></div><p className="text-xs text-white/50">{CREDIT_LABEL[credit.status]} · déduit {formatFcfa(credit.applied)} · remboursé {formatFcfa(credit.refunded)} · reste {formatFcfa(credit.remaining)}</p><p className="text-xs text-white/50">{credit.reason}</p></div>
      {warn && <p className="card text-sm text-amber-300" role="alert">{warn}</p>}
      {credit.applications.map((a, i) => <p key={i} className="text-xs text-white/70">Déduit {formatFcfa(a.amount)} sur {a.invoice || "facture"} · {fmtDay(a.at)}</p>)}
      {credit.refunds.map((r, i) => <p key={i} className="text-xs text-white/70">Remboursé {formatFcfa(r.amount)} · {r.source === "till" ? "en caisse" : METHODS[r.method] ?? r.method} · {fmtDay(r.date)}</p>)}
      {open && <div className="flex gap-2 flex-wrap"><button className="btn-ghost" onClick={() => { setMode("deduct"); setAmount(String(credit.remaining)); }}>Déduire d'une facture</button><button className="btn-ghost" onClick={() => { setMode("refund"); setAmount(String(credit.remaining)); }}>Enregistrer un remboursement</button>{credit.applied + credit.refunded === 0 && <button className="btn-ghost" onClick={() => setMode("cancel")}>Annuler l'avoir</button>}</div>}
      {mode === "deduct" && <div className="flex flex-col gap-2">{due.length === 0 && <p className="text-sm text-white/60">Aucune facture impayée de ce fournisseur : demandez plutôt un remboursement.</p>}
        <Field label="Facture à réduire"><select className="input" aria-label="Facture à réduire" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); const f = due.find((i) => i.id === e.target.value); if (f) setAmount(String(Math.min(f.remaining, credit.remaining))); }}><option value="">Choisir</option>{due.map((i) => <option key={i.id} value={i.id}>{i.number} · reste {i.remaining}</option>)}</select></Field>
        <Field label="Montant déduit (FCFA)"><input className="input" aria-label="Montant déduit" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></Field>{chosen && <p className="text-xs text-white/50">Reste dû après déduction : {formatFcfa(Math.max(0, chosen.remaining - Number(amount || 0)))}</p>}
        <Err e={apply.error} /><button className="btn" disabled={apply.isPending || !invoiceId || !amount} onClick={() => apply.mutate({ id: credit.id, invoiceId, amount: Number(amount), requestKey: key })}>Déduire de la facture</button></div>}
      {mode === "refund" && <div className="flex flex-col gap-2">
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={till} onChange={(e) => setTill(e.target.checked)} />Espèces encaissées dans la caisse ouverte</label>
        {!till && <Field label="Moyen de remboursement"><select className="input" aria-label="Moyen de remboursement" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
        <Field label="Montant remboursé (FCFA)"><input className="input" aria-label="Montant remboursé" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></Field>
        <Err e={refund.error} /><button className="btn" disabled={refund.isPending || !amount} onClick={() => refund.mutate({ id: credit.id, amount: Number(amount), source: till ? "till" : "external", method: till ? "cash" : method, requestKey: key })}>Enregistrer le remboursement reçu</button>
        <p className="text-[11px] text-white/40">À n'enregistrer que lorsque l'argent est réellement reçu : il entre alors dans la trésorerie (Finance).</p></div>}
      {mode === "cancel" && <div className="flex flex-col gap-2"><Field label="Motif de l'annulation"><input className="input" aria-label="Motif d'annulation de l'avoir" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={cancel.error} /><button className="btn" disabled={cancel.isPending || why.trim().length < 3} onClick={() => cancel.mutate({ id: credit.id, reason: why })}>Annuler l'avoir</button></div>}
    </div></Sheet>
  );
}

/** Onglet Achats : réclamations (unités à décider) et avoirs fournisseur. */
export function ClaimsTab() {
  const { session } = useSession(); const s = session!; const mgr = s.role === "owner" || s.role === "manager";
  const cl = useQuery({ queryKey: ["claims", s.shopId, "all"], retry: 1, queryFn: () => api<ClaimList>(s, "claim.list", {}) }); const cr = useQuery({ queryKey: ["credits", s.shopId], retry: 1, queryFn: () => api<{ credits: Credit[]; openAmount: number; note: string }>(s, "credit.list", {}) });
  const [decide, setDecide] = useState<Claim | null>(null); const [sel, setSel] = useState<Set<string>>(new Set()); const [creating, setCreating] = useState(false); const [credit, setCredit] = useState<Credit | null>(null);
  if (cl.error) return <Err e={cl.error} />; if (!cl.data) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />;
  const toCredit = cl.data.claims.filter((c) => c.decision === "return" && !c.creditId); const chosen = toCredit.filter((c) => sel.has(c.id)); const sameSupplier = chosen.length > 0 && chosen.every((c) => c.supplierId === chosen[0]!.supplierId);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2"><div className="card"><div className="text-xs text-white/50">À décider</div><div className="font-semibold">{cl.data.openCount} · {formatFcfa(cl.data.openValue)}</div></div><div className="card"><div className="text-xs text-white/50">Avoirs à utiliser</div><div className="font-semibold">{formatFcfa(cr.data?.openAmount ?? 0)}</div></div></div>
      <h2 className="text-sm font-semibold">Unités endommagées, refusées ou retournées</h2>
      {cl.data.claims.length === 0 && <p className="text-sm text-white/50">Aucune réclamation : tout ce qui a été reçu a été accepté.</p>}
      {cl.data.claims.map((c) => <div key={c.id} className="card flex flex-col gap-1 text-sm"><div className="flex justify-between gap-2"><span><b>{c.name}</b> × {c.qty}</span><span>{formatFcfa(c.value)}</span></div>
        <p className="text-xs text-white/50">{c.kindLabel} · {c.receipt} · {c.supplier || "Fournisseur"} · {fmtDay(c.at)}</p>
        {c.status === "open" ? <div className="flex items-center gap-2"><span className="text-amber-300 text-xs">À décider</span>{mgr && <button className="btn-ghost !py-1" onClick={() => setDecide(c)}>Décider</button>}</div> : <p className="text-xs text-white/70">{c.decisionLabel}{c.reason ? ` · ${c.reason}` : ""}{c.creditId ? " · avoir créé" : ""}</p>}
        {mgr && c.decision === "return" && !c.creditId && <label className="flex gap-2 text-xs"><input type="checkbox" aria-label={`Inclure ${c.name} dans l'avoir`} checked={sel.has(c.id)} onChange={() => setSel((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />Inclure dans un avoir</label>}</div>)}
      {mgr && toCredit.length > 0 && <><button className="btn" disabled={!sameSupplier} onClick={() => setCreating(true)}>Créer un avoir fournisseur ({chosen.length})</button>{chosen.length > 0 && !sameSupplier && <p className="text-xs text-amber-300">Un avoir ne couvre qu'un seul fournisseur.</p>}</>}
      <h2 className="text-sm font-semibold">Avoirs fournisseur</h2>
      {cr.data?.credits.length === 0 && <p className="text-sm text-white/50">Aucun avoir.</p>}
      {cr.data?.credits.map((c) => <button key={c.id} className="card text-left flex justify-between text-sm" onClick={() => setCredit(c)}><span>{c.number} · {c.supplier}<span className="block text-xs text-white/50">{CREDIT_LABEL[c.status]} · {fmtDay(c.at)}</span></span><span>{c.status === "cancelled" ? "—" : `reste ${formatFcfa(c.remaining)}`}</span></button>)}
      <p className="text-[11px] text-white/40">{cl.data.note}</p>
      {decide && <DecideSheet c={decide} onClose={() => setDecide(null)} />}
      {creating && sameSupplier && <CreditCreateSheet claims={chosen} onClose={() => { setCreating(false); setSel(new Set()); }} />}
      {credit && <CreditSheet credit={cr.data?.credits.find((x) => x.id === credit.id) ?? credit} onClose={() => setCredit(null)} />}
    </div>
  );
}
