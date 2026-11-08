import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Query } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { getShop, list, type Customer, type Row } from "@/lib/data";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { dueOf, paidOf, type Payment } from "@/domain/purchasing";
import { invoiceModel, type InvoiceDoc } from "@/domain/documents";
import { deliverPdf, pdfBlob } from "@/lib/pdf";

type JE = { ref: string; account: string; debit: number; credit: number; label: string; date: string };
type Inv = { number: string; partyId: string; total: number; paid: number; vat?: number; status: string; dueAt?: string; saleId?: string; ref?: string; lines?: string; payments?: string };
type Sale = { number: string; total: number; soldAt: string; customerId?: string; status: string };

export function ComptaPage() {
  const [tab, setTab] = useState<"invoices" | "journal">("invoices");
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Compta & factures</h1>
      <div className="grid grid-cols-2 gap-1 text-sm">
        <button className={tab === "invoices" ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setTab("invoices")}>Factures clients</button>
        <button className={tab === "journal" ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setTab("journal")}>Journal SYSCOHADA</button>
      </div>
      {tab === "invoices" ? <CustomerInvoices /> : <Journal />}
    </div>
  );
}

function Journal() {
  const { session } = useSession(); const s = session!;
  const rows = useQuery({ queryKey: ["journal"], queryFn: () => list<JE>("journal_entries", s, [], 1000) });
  const by = new Map<string, { d: number; c: number }>();
  for (const r of rows.data ?? []) { const a = by.get(r.account) ?? { d: 0, c: 0 }; a.d += r.debit; a.c += r.credit; by.set(r.account, a); }
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="card"><div className="text-xs text-white/50">Ventes HT (701)</div><b>{formatFcfa(by.get("701")?.c ?? 0)}</b></div>
        <div className="card"><div className="text-xs text-white/50">Achats HT (601)</div><b>{formatFcfa(by.get("601")?.d ?? 0)}</b></div>
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Balance des comptes</h2>
        <table className="w-full text-sm"><thead className="text-white/50"><tr><th className="text-left">Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead>
          <tbody>{[...by.entries()].sort().map(([a, v]) => <tr key={a}><td>{a}</td><td className="text-right">{formatFcfa(v.d)}</td><td className="text-right">{formatFcfa(v.c)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}

const parse = <T,>(v: unknown, fb: T): T => { try { return JSON.parse(String(v)) as T; } catch { return fb; } };
const LABEL: Record<string, string> = { unpaid: "À encaisser", partial: "Partiel", paid: "Payée" };

function CustomerInvoices() {
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
          <input className="input !px-2" placeholder="Désignation" required value={r.description} onChange={(e) => set(i, { description: e.target.value })} />
          <input className="input !px-2" inputMode="numeric" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          <input className="input !px-2" inputMode="numeric" placeholder="Prix HT" required value={r.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => setRows([...rows, { description: "", qty: "1", unitPrice: "" }])}>+ Ligne</button>
      <input className="input" placeholder="Référence / note (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
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
