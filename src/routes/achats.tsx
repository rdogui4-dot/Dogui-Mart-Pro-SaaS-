import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Query } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { list, saveEntity, type Product, type Row, type Supplier } from "@/lib/data";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { purchaseOrderModel } from "@/domain/documents";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { getShop } from "@/lib/data";
import { dueOf, paidOf, toInvoice, toReceive, type Payment, type PoLine } from "@/domain/purchasing";

type Po = { number: string; supplierId: string; lines: string; total: number; status: string };
type Inv = { number: string; partyId: string; total: number; paid: number; status: string; dueAt?: string; ref?: string; payments?: string };
const lines = (po: Row<Po>): PoLine[] => { try { return JSON.parse(po.lines); } catch { return []; } };
const LABEL: Record<string, string> = { ordered: "Commandé", partial: "Reçu en partie", received: "Reçu", cancelled: "Annulé", unpaid: "À payer", paid: "Payée" };
const tone = (s: string) => (s === "received" || s === "paid" ? "text-emerald-400" : s === "cancelled" ? "text-white/40" : "text-amber-300");

export function AchatsPage() {
  const [tab, setTab] = useState<"orders" | "invoices" | "suppliers">("orders");
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Achats</h1>
      <div className="grid grid-cols-3 gap-1 text-sm">
        {([["orders", "Commandes"], ["invoices", "Factures"], ["suppliers", "Fournisseurs"]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "orders" ? <Orders /> : tab === "invoices" ? <Invoices /> : <Suppliers />}
    </div>
  );
}

function useRefresh() { const qc = useQueryClient(); return () => void qc.invalidateQueries(); }

function Suppliers() {
  const { session } = useSession(); const s = session!; const refresh = useRefresh();
  const rows = useQuery({ queryKey: ["suppliers"], queryFn: () => list<Supplier>("suppliers", s, [], 500) });
  const invoices = useQuery({ queryKey: ["inv-supplier"], queryFn: () => list<Inv>("invoices", s, [Query.equal("kind", "supplier")], 500) });
  const [f, setF] = useState({ name: "", phone: "" });
  const add = useMutation({ mutationFn: () => saveEntity(s, "suppliers", f), onSuccess: () => { setF({ name: "", phone: "" }); refresh(); } });
  const owed = (id: string) => (invoices.data ?? []).filter((i) => i.partyId === id).reduce((a, i) => a + Math.max(0, i.total - i.paid), 0);
  return (
    <>
      <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <input className="input" placeholder="Fournisseur" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <button className="btn">Ajouter le fournisseur</button>
        {add.error && <p className="text-red-400 text-sm">{(add.error as Error).message}</p>}
      </form>
      {(rows.data ?? []).map((x) => (
        <div key={x.$id} className="card flex justify-between"><span>{x.name}<br /><span className="text-xs text-white/50">{x.phone}</span></span>
          <span className={owed(x.$id) ? "text-red-400" : "text-white/50"}>{owed(x.$id) ? `Dû ${formatFcfa(owed(x.$id))}` : "Soldé"}</span></div>
      ))}
    </>
  );
}

function Orders() {
  const { session } = useSession(); const s = session!; const refresh = useRefresh();
  const pos = useQuery({ queryKey: ["pos"], queryFn: () => list<Po>("purchase_orders", s, [], 200) });
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: () => list<Supplier>("suppliers", s, [], 500) });
  const prods = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500) });
  const [creating, setCreating] = useState(false);
  const supName = (id: string) => sups.data?.find((x) => x.$id === id)?.name ?? "—";
  return (
    <>
      <button className="btn" onClick={() => setCreating(!creating)}>{creating ? "Fermer" : "Nouvelle commande"}</button>
      {creating && <NewPo suppliers={sups.data ?? []} products={prods.data ?? []} onDone={() => { setCreating(false); refresh(); }} />}
      {(pos.data ?? []).map((po) => <PoCard key={po.$id} po={po} supplier={supName(po.supplierId)} onChange={refresh} />)}
      {pos.data?.length === 0 && <p className="text-center text-white/50 py-6">Aucune commande.</p>}
    </>
  );
}

function NewPo({ suppliers, products, onDone }: { suppliers: Row<Supplier>[]; products: Row<Product>[]; onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const clientId = useRef(crypto.randomUUID()); // même identifiant en cas de nouvel essai : jamais deux commandes
  const [supplierId, setSupplierId] = useState("");
  const [rows, setRows] = useState<{ productId: string; qty: string; unitCost: string }[]>([{ productId: "", qty: "", unitCost: "" }]);
  const [err, setErr] = useState("");
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.unitCost) || 0), 0);
  const submit = useMutation({
    mutationFn: () => api(s, "po.create", { clientId: clientId.current, supplierId, lines: rows.filter((r) => r.productId).map((r) => ({ productId: r.productId, qty: Number(r.qty), unitCost: Number(r.unitCost) })) }),
    onSuccess: onDone, onError: (e) => setErr((e as Error).message),
  });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setErr(""); submit.mutate(); }}>
      <select className="input" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
        <option value="">Fournisseur…</option>{suppliers.map((x) => <option key={x.$id} value={x.$id}>{x.name}</option>)}
      </select>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_4.5rem_6rem] gap-1">
          <select className="input !px-2" value={r.productId} onChange={(e) => set(i, { productId: e.target.value, unitCost: String(products.find((p) => p.$id === e.target.value)?.cost ?? "") })}>
            <option value="">Produit…</option>{products.map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}
          </select>
          <input className="input !px-2" inputMode="numeric" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          <input className="input !px-2" inputMode="numeric" placeholder="Prix HT" value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => setRows([...rows, { productId: "", qty: "", unitCost: "" }])}>+ Ligne</button>
      <button className="btn" disabled={submit.isPending || !supplierId}>Commander · {formatFcfa(total)} HT</button>
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </form>
  );
}

function PoCard({ po, supplier, onChange }: { po: Row<Po>; supplier: string; onChange: () => void }) {
  const { session } = useSession(); const s = session!;
  const sharePdf = async () => deliverPdf(await pdfBlob(purchaseOrderModel({ number: po.number, createdAt: po.$createdAt, lines: lines(po) }, await getShop(s), { name: supplier })), `${po.number}.pdf`);
  const ls = lines(po);
  const [open, setOpen] = useState(false); const [qty, setQty] = useState<Record<string, string>>({});
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const receiptId = useRef(crypto.randomUUID()); const invoiceId = useRef(crypto.randomUUID());
  const canReceive = po.status === "ordered" || po.status === "partial";
  const canInvoice = po.status !== "cancelled" && ls.some((l) => toInvoice(l) > 0);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setErr("");
    try { await fn(); after?.(); onChange(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const startReceive = () => { setQty(Object.fromEntries(ls.map((l) => [l.productId, String(toReceive(l))]))); setOpen(true); };
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex justify-between"><b>{po.number}</b><span className={`text-sm ${tone(po.status)}`}>{LABEL[po.status] ?? po.status}</span></div>
      <div className="text-sm text-white/60">{supplier} · {formatFcfa(po.total)} HT</div>
      <ul className="text-sm">{ls.map((l) => <li key={l.productId} className="flex justify-between"><span>{l.name}</span><span className="text-white/60">{l.received}/{l.qty} reçus · {l.invoiced} facturés</span></li>)}</ul>
      {open && (
        <div className="flex flex-col gap-1 border-t border-white/10 pt-2">
          {ls.filter((l) => toReceive(l) > 0).map((l) => (
            <label key={l.productId} className="flex items-center justify-between gap-2 text-sm">{l.name} (reste {toReceive(l)})
              <input className="input !w-20 !py-2" inputMode="numeric" value={qty[l.productId] ?? ""} onChange={(e) => setQty({ ...qty, [l.productId]: e.target.value })} /></label>
          ))}
          <button className="btn" disabled={busy} onClick={() => void run(
            () => api(s, "po.receive", { poId: po.$id, receiptId: receiptId.current, lines: Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([productId, v]) => ({ productId, qty: Number(v) })) }),
            () => { setOpen(false); receiptId.current = crypto.randomUUID(); })}>Confirmer la réception</button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {canReceive && !open && <button className="btn-ghost !py-2" onClick={startReceive}>Réceptionner</button>}
        {canInvoice && <button className="btn-ghost !py-2" disabled={busy} onClick={() => {
          const ref = prompt("N° de la facture du fournisseur (optionnel)") ?? undefined;
          void run(() => api(s, "invoice.supplier.create", { poId: po.$id, invoiceId: invoiceId.current, supplierRef: ref }), () => { invoiceId.current = crypto.randomUUID(); });
        }}>Enregistrer la facture</button>}
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => void run(sharePdf)}>PDF / Partager</button>
        {po.status === "ordered" && <button className="btn-ghost !py-2" disabled={busy} onClick={() => confirm("Annuler cette commande ?") && void run(() => api(s, "po.cancel", { poId: po.$id }))}>Annuler</button>}
      </div>
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </div>
  );
}

function Invoices() {
  const { session } = useSession(); const s = session!; const refresh = useRefresh();
  const inv = useQuery({ queryKey: ["inv-supplier"], queryFn: () => list<Inv>("invoices", s, [Query.equal("kind", "supplier")], 200) });
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: () => list<Supplier>("suppliers", s, [], 500) });
  const totalDue = (inv.data ?? []).reduce((a, i) => a + Math.max(0, i.total - i.paid), 0);
  return (
    <>
      <div className="card">Dettes fournisseurs : <b className="text-red-400">{formatFcfa(totalDue)}</b></div>
      {(inv.data ?? []).map((i) => <InvoiceCard key={i.$id} inv={i} supplier={sups.data?.find((x) => x.$id === i.partyId)?.name ?? "—"} onChange={() => { refresh(); void inv.refetch(); }} />)}
      {inv.data?.length === 0 && <p className="text-center text-white/50 py-6">Aucune facture. Réceptionnez une commande puis enregistrez sa facture.</p>}
    </>
  );
}

function InvoiceCard({ inv, supplier, onChange }: { inv: Row<Inv>; supplier: string; onChange: () => void }) {
  const { session } = useSession(); const s = session!;
  const payments: Payment[] = (() => { try { return JSON.parse(inv.payments ?? "[]"); } catch { return []; } })();
  const due = dueOf(inv.total, payments);
  const [open, setOpen] = useState(false); const [amount, setAmount] = useState(""); const [method, setMethod] = useState<Payment["method"]>("cash");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const paymentId = useRef(crypto.randomUUID());
  const overdue = due > 0 && inv.dueAt && new Date(inv.dueAt).getTime() < Date.now();
  async function pay() {
    setBusy(true); setErr("");
    try { await api(s, "invoice.supplier.pay", { invoiceId: inv.$id, paymentId: paymentId.current, amount: Number(amount), method }); paymentId.current = crypto.randomUUID(); setOpen(false); setAmount(""); onChange(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex justify-between"><b>{inv.number}</b><span className={`text-sm ${tone(inv.status)}`}>{LABEL[inv.status] ?? inv.status}{overdue && " · en retard"}</span></div>
      <div className="text-sm text-white/60">{supplier}{inv.ref ? ` · réf. ${inv.ref}` : ""} · échéance {inv.dueAt?.slice(0, 10)}</div>
      <div className="text-sm">Total {formatFcfa(inv.total)} · payé {formatFcfa(paidOf(payments))} · <b className={due ? "text-red-400" : ""}>reste {formatFcfa(due)}</b></div>
      {due > 0 && !open && <button className="btn-ghost !py-2" onClick={() => { setAmount(String(due)); setOpen(true); }}>Régler</button>}
      {open && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
            <option value="cash">Espèces</option><option value="wave">Wave</option><option value="orange">Orange Money</option><option value="card">Banque</option>
          </select>
          <button className="btn" disabled={busy || !(Number(amount) > 0)} onClick={() => void pay()}>Enregistrer le règlement</button>
        </div>
      )}
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </div>
  );
}
