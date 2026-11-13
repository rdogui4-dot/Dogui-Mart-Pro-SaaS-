import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Printer, RotateCcw, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { getShop } from "@/lib/data";
import { useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { receiptModel } from "@/domain/documents";
import { formatFcfa } from "@/domain/money";
import { METHOD_LABEL } from "@/domain/pay";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { useSubscription } from "./subscription";

type Pay = { method: string; amount: number; reference?: string; verified?: boolean };
type SaleRow = { id: string; number: string; total: number; status: string; soldAt: string; seller: string; customer: string; payments: Pay[]; refunded: number; returns: number };
type Detail = SaleRow & { vat: number; lines: { name: string; qty: number; unitPrice: number; discountPct: number; amount: number; unit: string; unitQty: number | null }[]; refundable: { lines: { index: number; name: string; qty: number; remainingQty: number; remainingNet: number; blocked: string }[]; remainingTotal: number }; returnsDetail: { id: string; kind: string; amount: number; reason: string; at: string; status: string; refunds: Pay[]; user: string }[] };
const STATUS: Record<string, { l: string; c: string }> = { paid: { l: "Payée", c: "bg-ok-bg text-ok" }, cancelled: { l: "Annulée", c: "bg-bad-bg text-bad" }, refunded: { l: "Remboursée", c: "bg-warn-bg text-warn" }, pending: { l: "En cours", c: "bg-subtle text-muted" }, posted: { l: "Non finalisée", c: "bg-subtle text-muted" } };
const dt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-bad text-sm" role="alert">{(e as Error).message}</p> : null);
const today = () => new Date().toISOString().slice(0, 10);

/** Historique des ventes : recherche, détail (lignes, paiements et références), réimpression du ticket 58/80 mm sans aucune écriture de vente ou de stock, annulation et remboursement tracés (gérant). */
export function VentesPage() {
  const { session } = useSession(); const s = session!; const allowed = planAllows(useSubscription().data?.entitlement.plan.id, "smartPos"); const manager = s.role === "owner" || s.role === "manager";
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["sales-list", s.shopId, from, to, status], enabled: allowed && !!from && !!to && from <= to, retry: 1, queryFn: () => api<{ sales: SaleRow[]; totals: { count: number; paid: number; refunded: number }; truncated: boolean; period: { tz: string } }>(s, "sales.list", { from, to, status: status || undefined }) });
  const shown = useMemo(() => (list.data?.sales ?? []).filter((x) => !q.trim() || `${x.number} ${x.customer} ${x.seller}`.toLowerCase().includes(q.trim().toLowerCase())), [list.data, q]);
  if (!allowed) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Ventes</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Business</span><span className="text-muted">Historique, remboursements et réimpression des tickets.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div></div>;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Ventes</h1>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted">Du<input className="input mt-1" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-muted">Au<input className="input mt-1" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
      <input className="input" aria-label="Rechercher une vente" placeholder="N° de vente, client ou vendeur" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="scroll-x">{([["", "Toutes"], ["paid", "Payées"], ["refunded", "Remboursées"], ["cancelled", "Annulées"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {(!navigator.onLine || list.error) && <div className="card border border-warn/40 text-sm flex gap-2" role="alert"><WifiOff size={16} className="text-warn shrink-0 mt-0.5" /><span>{navigator.onLine ? `Impossible de charger : ${(list.error as Error).message}` : "Hors ligne : l'historique a besoin d'une connexion."} <button className="underline text-accent-text" onClick={() => void list.refetch()}>Réessayer</button></span></div>}
      {list.isLoading && <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-16 animate-pulse bg-subtle" />)}</div>}
      {list.data && <p className="text-xs text-muted">{list.data.totals.count} vente(s) · {formatFcfa(list.data.totals.paid)} encaissés{list.data.totals.refunded ? ` · ${formatFcfa(list.data.totals.refunded)} remboursés` : ""}{list.data.truncated ? " · liste tronquée (affinez la période)" : ""}</p>}
      {list.data && !shown.length && <p className="text-center text-muted text-sm py-6">Aucune vente sur cette période.</p>}
      {shown.map((x) => <button key={x.id} className="card text-left flex justify-between gap-2" onClick={() => setOpen(x.id)}><span className="min-w-0"><b>{x.number}</b><span className="text-xs text-muted block truncate">{dt(x.soldAt)} · {x.seller || "—"}{x.customer ? ` · ${x.customer}` : ""}</span><span className="text-xs text-muted">{x.payments.map((p) => METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method).join(" + ")}</span></span><span className="text-right shrink-0"><b>{formatFcfa(x.total)}</b><span className={`block text-xs rounded-full px-2 mt-0.5 ${STATUS[x.status]?.c ?? ""}`}>{STATUS[x.status]?.l ?? x.status}{x.refunded && x.status === "paid" ? ` · −${formatFcfa(x.refunded)}` : ""}</span></span></button>)}
      {open && <SaleSheet id={open} manager={manager} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SaleSheet({ id, manager, onClose }: { id: string; manager: boolean; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [refund, setRefund] = useState<null | "refund" | "cancel">(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const d = useQuery({ queryKey: ["sale", id], retry: 1, queryFn: () => api<Detail>(s, "sale.get", { saleId: id }) }); const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s), staleTime: 300_000 });
  async function reprint(w: 58 | 80) {
    setBusy(String(w)); setErr("");
    try { const x = await api<Detail>(s, "sale.get", { saleId: id, reprint: true }); const m = receiptModel({ number: x.number, soldAt: x.soldAt, total: x.total, lines: x.lines.map((l) => ({ name: l.unit ? `${l.name} (${l.unitQty ?? ""} ${l.unit})` : l.name, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount })), payments: x.payments }, shop.data ?? null, x.customer || undefined, { duplicate: true, refunded: x.refunded }); await deliverPdf(await pdfBlob(m, w), `${x.number}-duplicata-${w}mm.pdf`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  const x = d.data;
  return (
    <Sheet title={x ? `Vente ${x.number}` : "Vente"} onClose={onClose} back>
      {d.isLoading && <div className="card h-24 animate-pulse bg-subtle" />}<Err e={d.error} />
      {x && <>
        <div className="card flex flex-col gap-1 text-sm"><div className="flex justify-between"><span className="text-muted">Date</span><span>{dt(x.soldAt)}</span></div><div className="flex justify-between"><span className="text-muted">Vendeur</span><span>{x.seller || "—"}</span></div>{x.customer && <div className="flex justify-between"><span className="text-muted">Client</span><span>{x.customer}</span></div>}<div className="flex justify-between"><span className="text-muted">Statut</span><span className={`rounded-full px-2 text-xs ${STATUS[x.status]?.c ?? ""}`}>{STATUS[x.status]?.l ?? x.status}</span></div><div className="flex justify-between font-semibold"><span>Total TTC</span><span>{formatFcfa(x.total)}</span></div>{x.refunded > 0 && <div className="flex justify-between text-warn"><span>Remboursé</span><span>−{formatFcfa(x.refunded)}</span></div>}</div>
        <h3 className="font-semibold text-sm">Lignes</h3>{x.lines.map((l, i) => <div key={i} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span className="truncate">{l.qty} × {l.name}{l.discountPct ? ` (−${l.discountPct} %)` : ""}</span><span>{formatFcfa(l.amount)}</span></div>)}
        <h3 className="font-semibold text-sm">Paiements</h3>{x.payments.map((p, i) => <div key={i} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method}{p.reference ? <span className="text-xs text-muted block">Réf. {p.reference} · non vérifiée par l'application</span> : null}</span><span>{formatFcfa(p.amount)}</span></div>)}
        {!!x.returnsDetail.length && <><h3 className="font-semibold text-sm">Annulations et remboursements</h3>{x.returnsDetail.map((r) => <div key={r.id} className="card text-sm flex flex-col"><span className="flex justify-between"><b>{r.kind === "cancel" ? "Annulation" : "Remboursement"}</b><b className="text-warn">−{formatFcfa(r.amount)}</b></span><span className="text-xs text-muted">{dt(r.at)} · {r.user} · {r.reason}</span><span className="text-xs text-muted">{r.refunds.map((f) => `${METHOD_LABEL[f.method as keyof typeof METHOD_LABEL] ?? f.method} ${formatFcfa(f.amount)}${f.reference ? ` (réf. ${f.reference})` : ""}`).join(" · ")}</span></div>)}</>}
        <Err e={err ? new Error(err) : null} />
        <div className="grid grid-cols-2 gap-2">{([80, 58] as const).map((w) => <button key={w} className="btn-ghost text-sm flex items-center justify-center gap-1" disabled={!!busy} onClick={() => void reprint(w)}><Printer size={14} />{busy === String(w) ? "…" : `Duplicata ${w} mm`}</button>)}</div>
        <p className="text-xs text-muted">La réimpression est tracée ; elle ne crée aucune nouvelle vente ni aucun mouvement de stock.</p>
        {manager && x.status === "paid" && x.refundable.remainingTotal > 0 && <div className="grid grid-cols-2 gap-2"><button className="btn-ghost text-sm flex items-center justify-center gap-1" onClick={() => setRefund("refund")}><RotateCcw size={14} />Rembourser</button>{!x.returnsDetail.length && <button className="btn-ghost !text-bad text-sm" onClick={() => setRefund("cancel")}>Annuler la vente</button>}</div>}
        {refund && <RefundSheet d={x} mode={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); void qc.invalidateQueries({ queryKey: ["sale", id] }); void qc.invalidateQueries({ queryKey: ["sales-list"] }); void qc.invalidateQueries({ queryKey: ["cash-current"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); }} />}
      </>}
    </Sheet>
  );
}

type RLine = { id: string; method: string; amount: string; reference: string };
function RefundSheet({ d, mode, onClose, onDone }: { d: Detail; mode: "refund" | "cancel"; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const returnId = useState(() => crypto.randomUUID())[0];
  const [qty, setQty] = useState<Record<number, string>>({}); const [reason, setReason] = useState(""); const [ask, setAsk] = useState(false);
  const chosen = mode === "cancel" ? d.refundable.lines.filter((l) => l.remainingQty > 0).map((l) => ({ index: l.index, qty: l.remainingQty })) : d.refundable.lines.flatMap((l) => { const n = Number((qty[l.index] ?? "").replace(",", ".")); return n > 0 ? [{ index: l.index, qty: n }] : []; });
  const pv = useQuery({ queryKey: ["refund-preview", d.id, JSON.stringify(chosen), mode], enabled: chosen.length > 0, retry: 0, queryFn: () => api<{ amount: number }>(s, "sale.refund", { preview: true, saleId: d.id, kind: mode, lines: chosen }) });
  const amount = pv.data?.amount ?? 0; const firstMethod = d.payments.find((p) => p.method !== "credit")?.method ?? "cash";
  const [rl, setRl] = useState<RLine[]>([{ id: "r1", method: firstMethod, amount: "", reference: "" }]);
  const sum = rl.reduce((a, r) => a + (Number(r.amount.replace(/\s/g, "")) || 0), 0); const refsOk = rl.every((r) => !["wave", "orange", "card"].includes(r.method) || r.reference.trim().length >= 4);
  const ok = amount > 0 && sum === amount && refsOk && reason.trim().length >= 3 && rl.every((r) => Number(r.amount.replace(/\s/g, "")) > 0);
  const run = useMutation({ mutationFn: () => api(s, "sale.refund", { returnId, saleId: d.id, kind: mode, lines: chosen, reason, refunds: rl.map((r) => ({ method: r.method, amount: Number(r.amount.replace(/\s/g, "")), ...(r.reference.trim() ? { reference: r.reference.trim() } : {}) })) }), onSuccess: onDone, onError: () => setAsk(false) });
  const setR = (id: string, p: Partial<RLine>) => setRl(rl.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <Sheet title={mode === "cancel" ? "Annuler la vente" : "Rembourser"} onClose={onClose} back>
      <p className="text-xs text-muted">{mode === "cancel" ? "Toute la vente est annulée : le stock est remis, la vente reste dans l'historique (statut « annulée »)." : "Choisissez les quantités à rembourser. Le montant est calculé par le serveur d'après les prix et remises de la vente."}</p>
      {mode === "refund" && d.refundable.lines.map((l) => <div key={l.index} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{l.name}<span className="text-xs text-muted block">{l.blocked ? l.blocked : `reste ${l.remainingQty} · ${formatFcfa(l.remainingNet)}`}</span></span><input className="input !w-20 !py-1 text-center" inputMode="decimal" aria-label={`Quantité à rembourser ${l.name}`} disabled={!!l.blocked || l.remainingQty <= 0} placeholder="0" value={qty[l.index] ?? ""} onChange={(e) => setQty({ ...qty, [l.index]: e.target.value })} /></div>)}
      <div className="card flex justify-between"><span>Montant à rembourser</span><b className="text-accent-text" aria-live="polite">{pv.isFetching ? "…" : formatFcfa(amount)}</b></div><Err e={pv.error} />
      <label className="text-sm flex flex-col gap-1"><span className="text-muted">Motif *</span><input className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <b className="text-sm">Remboursé en</b>
      {rl.map((r, i) => <div key={r.id} className="card !p-2 flex flex-col gap-1.5"><div className="flex gap-1.5"><select className="input !py-2 w-32" aria-label={`Moyen de remboursement ${i + 1}`} value={r.method} onChange={(e) => setR(r.id, { method: e.target.value })}>{["cash", "wave", "orange", "card", ...(d.customer ? ["credit"] : [])].map((m) => <option key={m} value={m}>{m === "credit" ? "Sur le compte client" : METHOD_LABEL[m as keyof typeof METHOD_LABEL]}</option>)}</select><input className="input !py-2 flex-1" inputMode="numeric" aria-label={`Montant remboursé ${i + 1}`} placeholder="Montant" value={r.amount} onChange={(e) => setR(r.id, { amount: e.target.value })} />{rl.length > 1 && <button className="btn-ghost !px-2" aria-label="Retirer" onClick={() => setRl(rl.filter((x) => x.id !== r.id))}>✕</button>}</div>
        {["wave", "orange", "card"].includes(r.method) && <input className="input !py-2" aria-label={`Référence du remboursement ${i + 1}`} placeholder="Référence (obligatoire, non vérifiée)" value={r.reference} onChange={(e) => setR(r.id, { reference: e.target.value })} />}</div>)}
      <div className="flex gap-2"><button className="btn-ghost !py-1 text-sm" onClick={() => setRl([...rl, { id: `r${rl.length + 1}`, method: "cash", amount: "", reference: "" }])}>+ Autre moyen</button>{amount > 0 && sum !== amount && <button className="btn-ghost !py-1 text-sm" onClick={() => setRl(rl.length === 1 ? [{ ...rl[0]!, amount: String(amount) }] : rl)}>Tout en {rl[0] ? "1re ligne" : ""}</button>}</div>
      <p className={`text-xs ${sum === amount && amount > 0 ? "text-ok" : "text-warn"}`}>Réparti : {formatFcfa(sum)} / {formatFcfa(amount)}</p>
      <Err e={run.error} /><button className="btn" disabled={!ok || run.isPending} onClick={() => setAsk(true)}>{run.isPending ? "Enregistrement…" : mode === "cancel" ? "Annuler la vente" : "Valider le remboursement"}</button>
      {ask && <Confirm danger text={`${mode === "cancel" ? "Annuler" : "Rembourser"} ${formatFcfa(amount)} sur la vente ${d.number} ? L'opération est tracée et irréversible ; le stock est remis.`} confirmLabel="Confirmer" onNo={() => setAsk(false)} onYes={() => run.mutate()} />}
    </Sheet>
  );
}
