import { CaisseTabs } from "@/components/CaisseTabs";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Printer, RotateCcw, Undo2, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { getShop } from "@/lib/data";
import { useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { receiptModel, returnReceiptModel } from "@/domain/documents";
import { Stepper } from "@/components/kit";
import { formatFcfa } from "@/domain/money";
import { METHOD_LABEL } from "@/domain/pay";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { useSubscription } from "./subscription";

type Pay = { method: string; amount: number; reference?: string; verified?: boolean };
type SaleRow = { id: string; number: string; total: number; status: string; soldAt: string; seller: string; customer: string; payments: Pay[]; refunded: number; returns: number };
type Detail = SaleRow & { vat: number; lines: { name: string; qty: number; unitPrice: number; discountPct: number; amount: number; unit: string; unitQty: number | null }[]; refundable: { lines: { index: number; name: string; qty: number; remainingQty: number; remainingNet: number; blocked: string; kind: string; remainingSerials: string[] }[]; remainingTotal: number }; returnsDetail: { id: string; kind: string; amount: number; reason: string; at: string; status: string; refunds: Pay[]; user: string }[] };
const STATUS: Record<string, { l: string; c: string }> = { paid: { l: "Payée", c: "bg-ok-bg text-ok" }, cancelled: { l: "Annulée", c: "bg-bad-bg text-bad" }, refunded: { l: "Remboursée", c: "bg-warn-bg text-warn" }, pending: { l: "En cours", c: "bg-subtle text-muted" }, posted: { l: "Non finalisée", c: "bg-subtle text-muted" } };
const dt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-bad text-sm" role="alert">{(e as Error).message}</p> : null);
const today = () => new Date().toISOString().slice(0, 10);

/** Historique des ventes : recherche, détail (lignes, paiements et références), réimpression du ticket 58/80 mm sans aucune écriture de vente ou de stock, annulation et remboursement tracés (gérant). */
export function VentesPage() {
  const { session } = useSession(); const s = session!; const plan = useSubscription().data?.entitlement.plan.id; const allowed = planAllows(plan, "smartPos"); const pro = planAllows(plan, "smartPosPro"); const manager = s.role === "owner" || s.role === "manager";
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["sales-list", s.shopId, from, to, status], enabled: allowed && !!from && !!to && from <= to, retry: 1, queryFn: () => api<{ sales: SaleRow[]; totals: { count: number; paid: number; refunded: number }; truncated: boolean; period: { tz: string } }>(s, "sales.list", { from, to, status: status || undefined }) });
  const retour = typeof location !== "undefined" && new URLSearchParams(location.search).has("retour");
  const [ticket, setTicket] = useState(""); const [tErr, setTErr] = useState(""); const [tBusy, setTBusy] = useState(false);
  /** Retrouve une vente d'après le numéro imprimé sur le ticket (V-AAAAMMJJ-XXXXXX), saisi, scanné (lecteur clavier) ou lu dans le lien du QR. */
  async function findTicket() {
    const m = ticket.toUpperCase().match(/V-(\d{4})(\d{2})(\d{2})-[A-Z0-9]{6}/); setTErr(""); if (!m) { setTErr("Numéro attendu : V-AAAAMMJJ-XXXXXX (imprimé sur le ticket)."); return; }
    const day = (d: number) => new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + d)).toISOString().slice(0, 10);
    setTBusy(true);
    try { const r = await api<{ sales: SaleRow[] }>(s, "sales.list", { from: day(-1), to: day(1), q: m[0] }); const hit = r.sales.find((x) => x.number.toUpperCase() === m[0]); if (hit) { setOpen(hit.id); setTicket(""); } else setTErr(`Aucune vente ${m[0]} dans cette boutique.`); }
    catch (e) { setTErr((e as Error).message); } finally { setTBusy(false); }
  }
  const shown = useMemo(() => (list.data?.sales ?? []).filter((x) => !q.trim() || `${x.number} ${x.customer} ${x.seller}`.toLowerCase().includes(q.trim().toLowerCase())), [list.data, q]);
  if (!allowed) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Ventes</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Business</span><span className="text-muted">Historique, remboursements et réimpression des tickets.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div></div>;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Ventes</h1>
      <CaisseTabs current="/ventes" />
      <form className={`card flex flex-col gap-2 ${retour ? "ring-2 ring-[var(--gold)]" : ""}`} aria-label="Retour sur ticket" onSubmit={(e) => { e.preventDefault(); void findTicket(); }}>
        <span className="flex items-center gap-2 font-semibold text-sm"><Undo2 size={16} className="text-accent-text" />Retour ou annulation sur ticket</span>
        <div className="flex gap-2"><input className="input flex-1 min-w-0" autoFocus={retour} aria-label="Numéro du ticket" placeholder="N° du ticket (V-AAAAMMJJ-XXXXXX) ou scan" value={ticket} onChange={(e) => setTicket(e.target.value)} /><button className="btn !py-2 shrink-0" disabled={tBusy || !ticket.trim()}>{tBusy ? "…" : "Rechercher"}</button></div>
        {tErr ? <p className="text-bad text-xs" role="alert">{tErr}</p> : <p className="text-xs text-muted">Aucun délai de retour. Choisissez ensuite les articles repris et leur état ; un article abîmé sort du stock en perte.{manager ? "" : " La validation est réservée au gérant."}</p>}
      </form>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted">Du<input className="input mt-1" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-muted">Au<input className="input mt-1" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
      <input className="input" aria-label="Rechercher une vente" placeholder="N° de vente, client ou vendeur" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="scroll-x">{([["", "Toutes"], ["paid", "Payées"], ["refunded", "Remboursées"], ["cancelled", "Annulées"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {(!navigator.onLine || list.error) && <div className="card border border-warn/40 text-sm flex gap-2" role="alert"><WifiOff size={16} className="text-warn shrink-0 mt-0.5" /><span>{navigator.onLine ? `Impossible de charger : ${(list.error as Error).message}` : "Hors ligne : l'historique a besoin d'une connexion."} <button className="underline text-accent-text" onClick={() => void list.refetch()}>Réessayer</button></span></div>}
      {list.isLoading && <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-16 animate-pulse bg-subtle" />)}</div>}
      {list.data && <p className="text-xs text-muted">{list.data.totals.count} vente(s) · {formatFcfa(list.data.totals.paid)} encaissés{list.data.totals.refunded ? ` · ${formatFcfa(list.data.totals.refunded)} remboursés` : ""}{list.data.truncated ? " · liste tronquée (affinez la période)" : ""}</p>}
      {list.data && !shown.length && <p className="text-center text-muted text-sm py-6">Aucune vente sur cette période.</p>}
      {shown.map((x) => <button key={x.id} className="card text-left flex justify-between gap-2" onClick={() => setOpen(x.id)}><span className="min-w-0"><b>{x.number}</b><span className="text-xs text-muted block truncate">{dt(x.soldAt)} · {x.seller || "—"}{x.customer ? ` · ${x.customer}` : ""}</span><span className="text-xs text-muted">{x.payments.map((p) => METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method).join(" + ")}</span></span><span className="text-right shrink-0"><b>{formatFcfa(x.total)}</b><span className={`block text-xs rounded-full px-2 mt-0.5 ${STATUS[x.status]?.c ?? ""}`}>{STATUS[x.status]?.l ?? x.status}{x.refunded && x.status === "paid" ? ` · −${formatFcfa(x.refunded)}` : ""}</span></span></button>)}
      {open && <SaleSheet id={open} manager={manager} pro={pro} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SaleSheet({ id, manager, pro, onClose }: { id: string; manager: boolean; pro: boolean; onClose: () => void }) {
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
        {manager && x.status === "paid" && x.refundable.remainingTotal > 0 && <div className="grid grid-cols-2 gap-2"><button className="btn-ghost text-sm flex items-center justify-center gap-1" onClick={() => setRefund("refund")}><RotateCcw size={14} />Retourner des articles</button>{!x.returnsDetail.length && <button className="btn-ghost !text-bad text-sm" onClick={() => setRefund("cancel")}>Annuler la vente</button>}</div>}
        {refund && <RefundSheet d={x} mode={refund} pro={pro} onClose={() => setRefund(null)} onSaved={() => { void qc.invalidateQueries({ queryKey: ["sale", id] }); void qc.invalidateQueries({ queryKey: ["sales-list"] }); void qc.invalidateQueries({ queryKey: ["cash-current"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); }} />}
      </>}
    </Sheet>
  );
}

type RLine = { id: string; method: string; amount: string; reference: string };
type Cond = "resellable" | "damaged";
type Preview = { amount: number; lines: { index: number; qty: number; amount: number; condition: Cond; serials?: string[] }[]; effects: { name: string; qty: number; condition: Cond; serials: string[] }[]; points: number; couponReleased: boolean };
const STEPS = ["Articles", "Remboursement", "Vérification", "Ticket"];
const KIND: Record<string, string> = { serial: "N° de série", lot: "Lots", bundle: "Lot composé" };
function CondPick({ name, value, onChange }: { name: string; value: Cond; onChange: (c: Cond) => void }) {
  return <div role="group" aria-label={`État ${name}`} className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 text-xs">{([["resellable", "Revendable", "Remis en stock"], ["damaged", "Abîmé", "Sorti en perte"]] as const).map(([k, l, h]) => <button key={k} type="button" aria-pressed={value === k} className={`rounded-lg px-2 py-1.5 text-left ${value === k ? (k === "damaged" ? "bg-bad-bg text-bad font-semibold" : "bg-[var(--card)] text-brand font-semibold shadow-sm") : "text-muted"}`} onClick={() => onChange(k)}><span className="block">{l}</span><span className="block text-[11px] opacity-80">{h}</span></button>)}</div>;
}

/** Retour après vente en 4 étapes : articles (quantités, numéros de série, état revendable/abîmé), remboursement, vérification des effets calculés par le serveur, ticket de retour. Aucun délai de retour ; un article abîmé sort du stock en perte. */
function RefundSheet({ d, mode, pro, onClose, onSaved }: { d: Detail; mode: "refund" | "cancel"; pro: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const returnId = useState(() => crypto.randomUUID())[0]; const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s), staleTime: 300_000 });
  const [step, setStep] = useState(0); const [qty, setQty] = useState<Record<number, string>>({}); const [sns, setSns] = useState<Record<number, string[]>>({}); const [cond, setCond] = useState<Record<number, Cond>>({}); const [all, setAll] = useState<Cond>("resellable");
  const [reason, setReason] = useState(""); const [ask, setAsk] = useState(false); const [done, setDone] = useState<{ at: string } | null>(null); const [busy, setBusy] = useState(""); const [perr, setPerr] = useState("");
  const chosen = mode === "cancel" ? [] : d.refundable.lines.flatMap((l) => { const c = cond[l.index] ?? "resellable";
    if (l.kind === "serial") { const pick = sns[l.index] ?? []; return pick.length ? [{ index: l.index, qty: pick.length, serials: pick, condition: c }] : []; }
    const n = Number((qty[l.index] ?? "").replace(",", ".")); return n > 0 ? [{ index: l.index, qty: n, condition: c }] : []; });
  const any = mode === "cancel" || chosen.length > 0;
  const pv = useQuery({ queryKey: ["refund-preview", d.id, JSON.stringify(chosen), mode, all], enabled: any && !done, retry: 0, queryFn: () => api<Preview>(s, "sale.refund", { preview: true, saleId: d.id, kind: mode, ...(mode === "cancel" ? { condition: all } : { lines: chosen }) }) });
  const amount = pv.data?.amount ?? 0; const firstMethod = d.payments.find((p) => p.method !== "credit")?.method ?? "cash";
  const [rl, setRl] = useState<RLine[]>([{ id: "r1", method: firstMethod, amount: "", reference: "" }]);
  /** Avoirs utilisés pour payer la vente : leur part revient au même avoir (le serveur l'exige). */
  const backs = useMemo(() => { const m = new Map<string, number>(); for (const p of d.payments) if (p.method === "voucher" && p.reference) { const c = p.reference.toUpperCase(); m.set(c, (m.get(c) ?? 0) + p.amount); }
    for (const r of d.returnsDetail) if (r.status !== "failed") for (const f of r.refunds) if (f.method === "voucher" && f.reference && m.has(f.reference) && (f as Pay & { back?: boolean }).back) m.set(f.reference, m.get(f.reference)! - f.amount);
    return [...m.entries()].filter(([, v]) => v > 0).map(([code, rem]) => ({ code, rem })); }, [d]);
  const methods = [...backs.map((b) => `back:${b.code}`), "cash", "wave", "orange", "card", ...(d.customer ? ["credit"] : []), ...(pro ? ["voucher"] : [])];
  const mLabel = (m: string) => (m.startsWith("back:") ? `Rendu à l'avoir ${m.slice(5)}` : m === "voucher" ? "Nouvel avoir (bon d'achat)" : m === "credit" ? "Sur le compte client" : METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m);
  /** Répartition proposée : d'abord vers les avoirs utilisés, le reste sur le premier moyen de la vente. */
  const suggest = () => { let left = amount; const out: RLine[] = []; for (const b of backs) { const v = Math.min(left, b.rem); if (v > 0) { out.push({ id: `r${out.length + 1}`, method: `back:${b.code}`, amount: String(v), reference: "" }); left -= v; } } if (left > 0) out.push({ id: `r${out.length + 1}`, method: firstMethod === "voucher" ? "cash" : firstMethod, amount: String(left), reference: "" }); return out; };
  const num = (v: string) => Number(v.replace(/\s/g, "")) || 0; const sum = rl.reduce((a, r) => a + num(r.amount), 0); const refsOk = rl.every((r) => !["wave", "orange", "card"].includes(r.method) || r.reference.trim().length >= 4) && rl.filter((r) => r.method === "voucher").length <= 1;
  const payOk = amount > 0 && sum === amount && refsOk && reason.trim().length >= 3 && rl.every((r) => num(r.amount) > 0);
  const refunds = rl.map((r) => (r.method.startsWith("back:") ? { method: "voucher", amount: num(r.amount), reference: r.method.slice(5) } : { method: r.method, amount: num(r.amount), ...(r.reference.trim() && r.method !== "voucher" ? { reference: r.reference.trim() } : {}) }));
  const run = useMutation({ mutationFn: () => api<{ vouchers?: { code: string; amount: number; back: boolean; balance: number; expiresAt: string }[] }>(s, "sale.refund", { returnId, saleId: d.id, kind: mode, reason, refunds, ...(mode === "cancel" ? { condition: all } : { lines: chosen }) }), onSuccess: () => { setAsk(false); setDone({ at: new Date().toISOString() }); setStep(3); onSaved(); }, onError: () => setAsk(false) });
  const setR = (id: string, p: Partial<RLine>) => setRl(rl.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const creditPart = refunds.filter((r) => r.method === "credit").reduce((a, r) => a + r.amount, 0);
  async function ticket(w: 58 | 80) {
    if (!pv.data || !done) return; setBusy(String(w)); setPerr("");
    try { const lines = pv.data.lines.map((l, i) => ({ name: pv.data!.effects[i]?.name ?? "", qty: l.qty, amount: l.amount, condition: l.condition ?? "resellable", serials: l.serials ?? [] }));
      const m = returnReceiptModel({ saleNumber: d.number, at: done.at, kind: mode, amount, reason: reason.trim(), lines, refunds: (run.data?.vouchers ?? []).reduce((acc, v) => acc.map((r) => (r.method === "voucher" && (v.back ? r.reference === v.code : !r.reference) ? { ...r, reference: v.code } : r)), refunds as { method: string; amount: number; reference?: string }[]), points: pv.data.points, couponReleased: pv.data.couponReleased, vouchers: run.data?.vouchers }, shop.data ?? null, d.customer || undefined);
      await deliverPdf(await pdfBlob(m, w), `${d.number}-retour-${w}mm.pdf`); } catch (e) { setPerr((e as Error).message); } finally { setBusy(""); }
  }
  const title = mode === "cancel" ? "Annuler la vente" : "Retour d'articles";
  return (
    <Sheet title={`${title} · ${d.number}`} onClose={onClose} back>
      <Stepper compact steps={STEPS} current={done ? 4 : step} label="Étapes du retour" />
      {step === 0 && <>
        <p className="text-xs text-muted">{mode === "cancel" ? "Toute la vente est annulée : chaque article est repris, la vente reste dans l'historique (statut « annulée »)." : "Choisissez les articles repris. Aucun délai de retour. Le montant est calculé par le serveur d'après les prix et remises de la vente."}</p>
        {mode === "cancel" ? <>
          {d.refundable.lines.filter((l) => l.remainingQty > 0).map((l) => <div key={l.index} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span className="truncate">{l.remainingQty} × {l.name}</span><span>{formatFcfa(l.remainingNet)}</span></div>)}
          <span className="text-sm font-semibold">État des articles repris</span><CondPick name="des articles" value={all} onChange={setAll} />
        </> : d.refundable.lines.map((l) => { const c = cond[l.index] ?? "resellable"; const picked = l.kind === "serial" ? (sns[l.index] ?? []).length > 0 : Number((qty[l.index] ?? "").replace(",", ".")) > 0; const none = l.remainingQty <= 0; return (
          <div key={l.index} className={`card !p-3 flex flex-col gap-2 ${none ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2 text-sm"><span className="min-w-0"><b className="block truncate">{l.name}</b><span className="text-xs text-muted">vendu {l.qty} · {none ? "déjà entièrement retourné" : `reste ${l.remainingQty} · ${formatFcfa(l.remainingNet)}`}{KIND[l.kind] ? ` · ${KIND[l.kind]}` : ""}</span></span>
              {l.kind !== "serial" && <input className="input !w-20 !py-1 text-center shrink-0" inputMode="decimal" aria-label={`Quantité retournée ${l.name}`} disabled={none} placeholder="0" value={qty[l.index] ?? ""} onChange={(e) => setQty({ ...qty, [l.index]: e.target.value })} />}</div>
            {l.kind === "serial" && !none && <div className="flex flex-wrap gap-1.5">{l.remainingSerials.map((sn) => { const on = (sns[l.index] ?? []).includes(sn); return <label key={sn} className={`chip cursor-pointer ${on ? "!bg-brand !text-white" : ""}`}><input type="checkbox" className="sr-only" aria-label={`Retourner ${sn}`} checked={on} onChange={() => setSns({ ...sns, [l.index]: on ? (sns[l.index] ?? []).filter((x) => x !== sn) : [...(sns[l.index] ?? []), sn] })} />{sn}</label>; })}</div>}
            {picked && <CondPick name={l.name} value={c} onChange={(v) => setCond({ ...cond, [l.index]: v })} />}
          </div>); })}
        <div className="card flex justify-between"><span>Montant à rembourser</span><b className="text-accent-text" aria-live="polite">{pv.isFetching ? "…" : formatFcfa(amount)}</b></div><Err e={pv.error} />
        <button className="btn" disabled={!any || !pv.data || pv.isFetching || amount <= 0} onClick={() => { if (backs.length) setRl(suggest()); setStep(1); }}>Continuer</button>
      </>}
      {step === 1 && <>
        <label className="text-sm flex flex-col gap-1"><span className="text-muted">Motif *</span><input className="input" maxLength={200} value={reason} placeholder="Ex. : article défectueux, erreur de caisse…" onChange={(e) => setReason(e.target.value)} /></label>
        {!!backs.length && <p className="text-xs rounded-lg bg-[var(--gold-soft)] p-2" role="note">Vente payée par avoir : {backs.map((b) => `${formatFcfa(b.rem)} reviennent à l'avoir ${b.code}`).join(" ; ")} (jamais en espèces).</p>}
        <div className="flex justify-between text-sm"><b>Remboursé en</b><span className="text-muted">à rembourser : <b className="text-brand">{formatFcfa(amount)}</b></span></div>
        {rl.map((r, i) => <div key={r.id} className="card !p-2 flex flex-col gap-1.5"><div className="flex gap-1.5"><select className="input !py-2 w-40 min-w-0" aria-label={`Moyen de remboursement ${i + 1}`} value={r.method} onChange={(e) => setR(r.id, { method: e.target.value })}>{methods.map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}</select><input className="input !py-2 flex-1 min-w-0" inputMode="numeric" aria-label={`Montant remboursé ${i + 1}`} placeholder="Montant" value={r.amount} onChange={(e) => setR(r.id, { amount: e.target.value })} />{rl.length > 1 && <button className="btn-ghost !px-2" aria-label="Retirer" onClick={() => setRl(rl.filter((x) => x.id !== r.id))}>✕</button>}</div>
          {["wave", "orange", "card"].includes(r.method) && <input className="input !py-2" aria-label={`Référence du remboursement ${i + 1}`} placeholder="Référence (obligatoire, non vérifiée)" value={r.reference} onChange={(e) => setR(r.id, { reference: e.target.value })} />}</div>)}
        <div className="flex gap-2"><button className="btn-ghost !py-1 text-sm" onClick={() => setRl([...rl, { id: `r${rl.length + 1}`, method: "cash", amount: "", reference: "" }])}>+ Autre moyen</button>{rl.length === 1 && sum !== amount && <button className="btn-ghost !py-1 text-sm" onClick={() => setRl([{ ...rl[0]!, amount: String(amount) }])}>Tout rembourser ici</button>}</div>
        <p className={`text-xs ${sum === amount && amount > 0 ? "text-ok" : "text-warn"}`}>Réparti : {formatFcfa(sum)} / {formatFcfa(amount)}</p>
        <div className="grid grid-cols-2 gap-2"><button className="btn-ghost" onClick={() => setStep(0)}>Retour</button><button className="btn" disabled={!payOk} onClick={() => setStep(2)}>Vérifier</button></div>
      </>}
      {step === 2 && pv.data && <>
        <section aria-label="Effets du retour" className="card flex flex-col gap-2 text-sm">
          <b>Ce qui sera mis à jour</b>
          {pv.data.effects.map((e, i) => <div key={i} className="flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="min-w-0"><span className="block truncate">{e.qty} × {e.name}</span>{!!e.serials.length && <span className="text-xs text-muted">N° {e.serials.join(", ")}</span>}</span><span className={`shrink-0 text-xs font-semibold ${e.condition === "damaged" ? "text-bad" : "text-ok"}`}>{e.condition === "damaged" ? "Sorti en perte" : "Remis en stock"}</span></div>)}
          <div className="flex justify-between border-t border-[var(--line)] pt-1"><span>Chiffre d'affaires et caisse</span><b>−{formatFcfa(amount)}</b></div>
          {pv.data.points > 0 && <div className="flex justify-between"><span>Points de fidélité retirés</span><b>{pv.data.points}</b></div>}
          {creditPart > 0 && <div className="flex justify-between"><span>Dette du client réduite</span><b>−{formatFcfa(creditPart)}</b></div>}
          {pv.data.couponReleased && <p className="text-xs">Le coupon utilisé redevient disponible ; les limites de promotion sont libérées.</p>}
          <p className="text-xs text-muted">Écriture comptable de retour, journal d'audit et historique client mis à jour. La vente d'origine reste consultable.</p>
        </section>
        <div className="card text-sm flex flex-col gap-1"><b>Remboursement</b>{rl.map((r, i) => <div key={i} className="flex justify-between"><span>{mLabel(r.method)}{r.reference.trim() && ["wave", "orange", "card"].includes(r.method) ? ` (réf. ${r.reference.trim()})` : ""}</span><b>{formatFcfa(num(r.amount))}</b></div>)}<span className="text-xs text-muted">Motif : {reason}</span></div>
        <Err e={run.error} />
        <div className="grid grid-cols-2 gap-2"><button className="btn-ghost" disabled={run.isPending} onClick={() => setStep(1)}>Retour</button><button className="btn" disabled={run.isPending} onClick={() => setAsk(true)}>{run.isPending ? "Enregistrement…" : mode === "cancel" ? "Annuler la vente" : "Valider le retour"}</button></div>
        {ask && <Confirm danger text={`${mode === "cancel" ? "Annuler la vente" : "Valider le retour"} : ${formatFcfa(amount)} remboursés sur la vente ${d.number} ? L'opération est tracée et irréversible.`} confirmLabel="Confirmer" onNo={() => setAsk(false)} onYes={() => run.mutate()} />}
      </>}
      {step === 3 && done && <>
        <div className="card flex flex-col gap-1 text-sm" role="status"><b className="text-ok">{mode === "cancel" ? "Vente annulée" : "Retour enregistré"}</b><span>{formatFcfa(amount)} remboursés · stock, caisse, comptabilité et fidélité mis à jour.</span>{(run.data?.vouchers ?? []).map((v) => <span key={v.code} className="block font-semibold text-brand">{v.back ? "Rendu à l'avoir" : "Nouvel avoir"} {v.code} : {formatFcfa(v.amount)} · solde {formatFcfa(v.balance)}{v.expiresAt ? ` · valable jusqu'au ${new Date(v.expiresAt).toLocaleDateString("fr-FR")}` : ""}</span>)}</div>
        <div className="grid grid-cols-2 gap-2">{([80, 58] as const).map((w) => <button key={w} className="btn-ghost text-sm flex items-center justify-center gap-1" disabled={!!busy} onClick={() => void ticket(w)}><Printer size={14} />{busy === String(w) ? "…" : `Ticket de retour ${w} mm`}</button>)}</div>
        <Err e={perr ? new Error(perr) : null} />
        <button className="btn" onClick={onClose}>Terminer</button>
      </>}
    </Sheet>
  );
}
