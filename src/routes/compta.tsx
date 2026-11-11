import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Query } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { getShop, list, type Customer, type Row } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { dueOf, paidOf, type Payment } from "@/domain/purchasing";
import { invoiceModel, reportModel, type InvoiceDoc } from "@/domain/documents";
import type { ConsolidatedReport } from "@/domain/reports";
import { deliverPdf, pdfBlob } from "@/lib/pdf";

type JE = { ref: string; account: string; debit: number; credit: number; label: string; date: string };
type Inv = { number: string; partyId: string; total: number; paid: number; vat?: number; status: string; dueAt?: string; saleId?: string; ref?: string; lines?: string; payments?: string };
type Sale = { number: string; total: number; soldAt: string; customerId?: string; status: string };

const parse = <T,>(v: unknown, fb: T): T => { try { return JSON.parse(String(v)) as T; } catch { return fb; } };
const LABEL: Record<string, string> = { unpaid: "À encaisser", partial: "Partiel", paid: "Payée" };

/** Facturation clients (onglet « Facturation » d'ICompta). */
export function CustomerInvoices() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries();
  const inv = useQuery({ queryKey: ["inv-customer"], queryFn: () => list<Inv>("invoices", s, [Query.equal("kind", "customer")], 200) });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s) });
  const [mode, setMode] = useState<"" | "free" | "sale">("");
  const receivable = (inv.data ?? []).reduce((a, i) => a + Math.max(0, i.total - i.paid), 0);
  return (
    <>
      <div className="card">Créances sur factures : <b className="text-[var(--gold)]">{formatFcfa(receivable)}</b></div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={() => setMode(mode === "free" ? "" : "free")}>Facture libre</button>
        <button className="btn-ghost" onClick={() => setMode(mode === "sale" ? "" : "sale")}>Depuis une vente</button>
      </div>
      {mode === "free" && <FreeForm customers={customers.data ?? []} onDone={() => { setMode(""); refresh(); }} />}
      {mode === "sale" && <FromSale onDone={() => { setMode(""); refresh(); }} />}
      {(inv.data ?? []).map((i) => <InvoiceCard key={i.$id} inv={i} customer={customers.data?.find((c) => c.$id === i.partyId)} shop={shop.data ?? null} onChange={refresh} />)}
      {inv.data?.length === 0 && <p className="text-center text-white/50 py-6">Aucune facture client.</p>}
    </>
  );
}

function FreeForm({ customers, onDone }: { customers: Row<Customer>[]; onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const invoiceId = useRef(crypto.randomUUID()); // même identifiant à chaque nouvel essai : jamais deux factures
  const [customerId, setCustomerId] = useState(""); const [note, setNote] = useState(""); const [err, setErr] = useState("");
  const [rows, setRows] = useState([{ description: "", qty: "1", unitPrice: "" }]);
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const ht = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  const submit = useMutation({
    mutationFn: () => api(s, "invoice.customer.create", { invoiceId: invoiceId.current, customerId, note, lines: rows.map((r) => ({ description: r.description, qty: Number(r.qty), unitPrice: Number(r.unitPrice) })) }),
    onSuccess: onDone, onError: (e) => setErr((e as Error).message),
  });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setErr(""); submit.mutate(); }}>
      <select className="input" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">Client…</option>{customers.map((c) => <option key={c.$id} value={c.$id}>{c.name}</option>)}
      </select>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_3.5rem_6rem] gap-1">
          <input aria-label="Désignation" className="input !px-2" placeholder="Désignation" required value={r.description} onChange={(e) => set(i, { description: e.target.value })} />
          <input aria-label="Qté" className="input !px-2" inputMode="numeric" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          <input aria-label="Prix HT" className="input !px-2" inputMode="numeric" placeholder="Prix HT" required value={r.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => setRows([...rows, { description: "", qty: "1", unitPrice: "" }])}>+ Ligne</button>
      <input aria-label="Référence / note (optionnel)" className="input" placeholder="Référence / note (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" disabled={submit.isPending || !customerId}>Créer la facture · {formatFcfa(ht)} HT</button>
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </form>
  );
}

function FromSale({ onDone }: { onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const sales = useQuery({ queryKey: ["sales-recent"], queryFn: () => list<Sale>("sales", s, [Query.equal("status", "paid")], 30) });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  async function make(id: string) { setBusy(id); setErr(""); try { await api(s, "invoice.customer.fromSale", { saleId: id }); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); } }
  return (
    <div className="card flex flex-col gap-2">
      <h2 className="font-semibold">Ventes récentes</h2>
      {(sales.data ?? []).map((x) => (
        <div key={x.$id} className="flex items-center justify-between gap-2 text-sm">
          <span>{x.number}<br /><span className="text-white/50">{new Date(x.soldAt).toLocaleDateString("fr-FR")} · {formatFcfa(x.total)}</span></span>
          <button className="btn-ghost !py-2" disabled={busy === x.$id} onClick={() => void make(x.$id)}>Facturer</button>
        </div>
      ))}
      {sales.data?.length === 0 && <p className="text-white/50 text-sm">Aucune vente.</p>}
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </div>
  );
}

function InvoiceCard({ inv, customer, shop, onChange }: { inv: Row<Inv>; customer?: Row<Customer>; shop: Awaited<ReturnType<typeof getShop>>; onChange: () => void }) {
  const { session } = useSession(); const s = session!;
  const payments = parse<Payment[]>(inv.payments, []);
  const due = dueOf(inv.total, payments);
  const [open, setOpen] = useState(false); const [amount, setAmount] = useState(""); const [method, setMethod] = useState<Payment["method"]>("cash");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const paymentId = useRef(crypto.randomUUID());
  const overdue = due > 0 && inv.dueAt && new Date(inv.dueAt).getTime() < Date.now();
  async function pay() {
    setBusy(true); setErr("");
    try { await api(s, "invoice.customer.pay", { invoiceId: inv.$id, paymentId: paymentId.current, amount: Number(amount), method }); paymentId.current = crypto.randomUUID(); setOpen(false); onChange(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function pdf() {
    setBusy(true); setErr("");
    try {
      const doc: InvoiceDoc = { number: inv.number, total: inv.total, vat: inv.vat, dueAt: inv.dueAt, createdAt: inv.$createdAt, saleId: inv.saleId, lines: parse(inv.lines, []), payments };
      await deliverPdf(await pdfBlob(invoiceModel(doc, shop, customer ?? null)), `${inv.number}.pdf`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex justify-between"><b>{inv.number}</b><span className={`text-sm ${inv.status === "paid" ? "text-emerald-400" : "text-amber-300"}`}>{LABEL[inv.status] ?? inv.status}{overdue && " · en retard"}</span></div>
      <div className="text-sm text-white/60">{customer?.name ?? "Client comptoir"} · échéance {inv.dueAt?.slice(0, 10)}{inv.saleId ? " · issue d'une vente" : ""}</div>
      <div className="text-sm">Total {formatFcfa(inv.total)} · réglé {formatFcfa(paidOf(payments))} · <b className={due ? "text-red-400" : ""}>reste {formatFcfa(due)}</b></div>
      <div className="flex gap-2">
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => void pdf()}>PDF / Partager</button>
        {due > 0 && !open && <button className="btn-ghost !py-2" onClick={() => { setAmount(String(due)); setOpen(true); }}>Encaisser</button>}
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
            <option value="cash">Espèces</option><option value="wave">Wave</option><option value="orange">Orange Money</option><option value="card">Banque</option>
          </select>
          <button className="btn" disabled={busy || !(Number(amount) > 0)} onClick={() => void pay()}>Enregistrer l'encaissement</button>
        </div>
      )}
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Rapports consolidés
const METHOD_FR: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte / banque", credit: "Crédit client" };
const utc = (d: Date) => d.toISOString().slice(0, 10);
const shift = (days: number) => utc(new Date(Date.now() - days * 86_400_000));
/** Périodes proposées, en jours UTC (le serveur compte les jours en UTC). */
const RANGES: { id: string; label: string; get: () => { from: string; to: string } }[] = [
  { id: "today", label: "Aujourd'hui", get: () => ({ from: shift(0), to: shift(0) }) },
  { id: "7", label: "7 j", get: () => ({ from: shift(6), to: shift(0) }) },
  { id: "30", label: "30 j", get: () => ({ from: shift(29), to: shift(0) }) },
  { id: "month", label: "Ce mois", get: () => ({ from: `${shift(0).slice(0, 8)}01`, to: shift(0) }) },
  { id: "last", label: "Mois dernier", get: () => { const n = new Date(); const f = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)); const l = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)); return { from: utc(f), to: utc(l) }; } },
];
const money = (n: number | null) => (n === null ? "—" : formatFcfa(n));

/** Histogramme du chiffre d'affaires par jour (SVG, sans dépendance). */
function DailyChart({ daily }: { daily: ConsolidatedReport["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.revenueTtc)); const W = 300, H = 90, gap = 2;
  const bw = Math.max(2, (W - gap * (daily.length - 1)) / daily.length);
  const total = daily.reduce((s, d) => s + d.revenueTtc, 0);
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`Chiffre d'affaires par jour, total ${formatFcfa(total)} sur ${daily.length} jours`} className="w-full">
        {daily.map((d, i) => { const h = d.revenueTtc > 0 ? Math.max(2, (d.revenueTtc / max) * H) : 0; return (
          <g key={d.date}><title>{`${new Date(d.date).toLocaleDateString("fr-FR")} : ${formatFcfa(d.revenueTtc)} (${d.count} vente(s))`}</title>
            <rect x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={1.5} fill="var(--gold)" />
            {d.revenueTtc === 0 && <rect x={i * (bw + gap)} y={H - 1} width={bw} height={1} fill="currentColor" opacity={0.25} />}</g>); })}
        <text x={0} y={H + 11} fontSize={8} fill="currentColor" opacity={0.6}>{new Date(daily[0]!.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</text>
        <text x={W} y={H + 11} fontSize={8} textAnchor="end" fill="currentColor" opacity={0.6}>{new Date(daily[daily.length - 1]!.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · max {formatFcfa(max)}</text>
      </svg>
    </figure>
  );
}

/** Rapport consolidé d'activité (onglet « Rapports d'activité » d'ICompta). */
export function Reports() {
  const { session } = useSession(); const s = session!;
  const [range, setRange] = useState("7"); const [err, setErr] = useState("");
  const period = RANGES.find((r) => r.id === range)!.get();
  const q = useQuery({ queryKey: ["report", s.tenantId, period.from, period.to], queryFn: () => api<ConsolidatedReport>(s, "report.consolidated", period) });
  const r = q.data; const T = r?.totals;
  async function pdf() {
    if (!r) return; setErr("");
    try { const shop = await getShop(s); await deliverPdf(await pdfBlob(reportModel(r, shop?.name ?? "Mon commerce")), `rapport-${r.period.from}_${r.period.to}.pdf`); } catch (e) { setErr((e as Error).message); }
  }
  const card = (label: string, value: string, sub?: string) => <div className="card"><div className="text-xs text-white/50">{label}</div><div className="font-semibold">{value}</div>{sub && <div className="text-[11px] text-white/50">{sub}</div>}</div>;
  return (
    <>
      <div className="flex flex-wrap gap-1 text-xs [&>button]:flex-1">{RANGES.map((x) => <button key={x.id} className={range === x.id ? "btn !py-2 !px-2 !text-xs" : "btn-ghost !py-2 !px-2 !text-xs"} onClick={() => setRange(x.id)}>{x.label}</button>)}</div>
      <p className="text-xs text-white/50">Du {new Date(period.from).toLocaleDateString("fr-FR")} au {new Date(period.to).toLocaleDateString("fr-FR")} · jours en heure UTC</p>
      {q.isLoading && <p className="text-white/50">Calcul en cours…</p>}
      {q.error && <p className="text-red-400 text-sm">{(q.error as Error).message}</p>}
      {r && T && <>
        {r.partial && <p className="text-sm text-amber-300">Rapport partiel : le volume de ventes dépasse la limite de lecture. Choisissez une période plus courte.</p>}
        <div className="grid grid-cols-2 gap-2">
          {card("Chiffre d'affaires TTC", money(T.revenueTtc), `${T.count} vente(s) · HT ${money(T.revenueHt)}`)}
          {card("Panier moyen", money(T.avgBasket))}
          {card("Marge brute HT", T.grossMargin === null ? "—" : `${money(T.grossMargin)}${T.marginPct !== null ? ` (${T.marginPct} %)` : ""}`, T.grossMargin === null ? `Coûts manquants : connus sur ${T.costCoveragePct} % du CA${T.costedRevenueTtc > 0 ? ` · marge indicative ${money(T.indicativeMargin)}` : ""}` : undefined)}
          {card("Stock valorisé", money(T.stockValue), T.stockValue === null ? "Historique trop long pour un calcul exact" : `${T.stockouts ?? 0} produit(s) en alerte`)}
          {card("Crédits clients", money(T.openCredit), `Factures à encaisser ${money(T.receivables)}`)}
          {card("Dettes fournisseurs", money(T.payables))}
        </div>
        <div className="card"><h2 className="font-semibold mb-1">Chiffre d'affaires par jour</h2><DailyChart daily={r.daily} /></div>
        <div className="card flex flex-col gap-1 text-sm"><h2 className="font-semibold">Encaissements par mode</h2>
          {Object.entries(T.byMethod).sort((a, b) => b[1] - a[1]).map(([m, v]) => <div key={m} className="flex justify-between"><span>{METHOD_FR[m] ?? m}</span><span>{formatFcfa(v)}</span></div>)}
          {!Object.keys(T.byMethod).length && <span className="text-white/50">Aucune vente sur la période.</span>}</div>
        <div className="card flex flex-col gap-2 text-sm"><h2 className="font-semibold">Par boutique</h2>
          {r.shops.map((x) => (
            <div key={x.id} className="rounded-xl border border-white/10 p-2 flex flex-col gap-0.5">
              <div className="flex justify-between"><b>{x.name}</b><span className="text-[var(--gold)]">{money(x.revenueTtc)}</span></div>
              <div className="text-white/60">{x.count} vente(s) · panier {money(x.avgBasket)} · marge {x.grossMargin === null ? "—" : `${money(x.grossMargin)}${x.marginPct !== null ? ` (${x.marginPct} %)` : ""}`}</div>
              <div className="text-white/60">Stock {money(x.stockValue)}{x.stockouts ? ` · ${x.stockouts} alerte(s)` : ""} · crédits {money(x.openCredit)} · dettes {money(x.payables)}</div>
              {x.truncated.sales && <div className="text-amber-300 text-xs">Chiffres partiels (trop de ventes à lire).</div>}
            </div>
          ))}
          {!r.shops.length && <span className="text-white/50">Aucune boutique accessible.</span>}</div>
        <div className="card flex flex-col gap-1 text-sm"><h2 className="font-semibold">Produits les plus vendus</h2>
          {r.topProducts.map((p, i) => <div key={p.key} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {p.name}</span><span className="text-white/60 whitespace-nowrap">{p.qty} · {formatFcfa(p.revenueTtc)}</span></div>)}
          {!r.topProducts.length && <span className="text-white/50">Aucune vente sur la période.</span>}</div>
        <button className="btn-ghost" onClick={() => void pdf()}>Rapport PDF / Partager</button>
        {err && <p className="text-red-400 text-sm">{err}</p>}
      </>}
    </>
  );
}
