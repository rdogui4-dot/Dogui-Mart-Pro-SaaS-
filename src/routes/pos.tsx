import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanLine, Minus, Plus } from "lucide-react";
import { cartTotal, formatFcfa, settle, isQrMethod, type CartLine, type Payment, type PaymentMethod } from "@/domain/money";
import { list, stockLevels, type Product, type Customer } from "@/lib/data";
import { queueSale, syncPending } from "@/lib/offline";
import { useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { QrPay } from "@/components/QrPay";
import { canExtendCredit } from "@/domain/credit";


export function PosPage() {
  const { session } = useSession(); const s = session!;
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500), staleTime: 60_000 });
  const stock = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [q, setQ] = useState(""); const [scan, setScan] = useState(false);
  const [pay, setPay] = useState<PaymentMethod>("cash"); const [given, setGiven] = useState("");
  const [customerId, setCustomerId] = useState(""); const [qr, setQr] = useState(false);
  const [msg, setMsg] = useState("");
  const total = cartTotal(cart);

  const add = (p: { $id: string; name: string; price: number }) =>
    setCart((c) => c.some((l) => l.productId === p.$id) ? c.map((l) => l.productId === p.$id ? { ...l, qty: l.qty + 1 } : l) : [...c, { productId: p.$id, name: p.name, unitPrice: p.price, qty: 1 }]);
  const byCode = (code: string) => { const p = products.data?.find((x) => x.barcode === code || x.sku === code); if (p) add(p); else setMsg(`Code inconnu : ${code}`); setScan(false); };
  const shown = useMemo(() => (products.data ?? []).filter((p) => !p.archived && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40), [products.data, q]);
  const customer = customers.data?.find((c) => c.$id === customerId);

  /** linkId : lien QR déjà confirmé. Le serveur revérifie prix, stock, plafond de crédit et lien. */
  async function submit(linkId?: string) {
    setMsg("");
    const amount = pay === "cash" ? Number(given) || total : total;
    const payments: (Payment & { linkId?: string })[] = [{ method: pay, amount, linkId }];
    const r = settle(total, payments);
    if (!r.ok) return setMsg(r.error);
    if (pay === "credit") {
      if (!customer) return setMsg("Choisissez un client pour la vente à crédit");
      const c = canExtendCredit({ balance: customer.creditBalance ?? 0, limit: customer.creditLimit ?? 0 }, total);
      if (!c.ok) return setMsg(c.error);
    }
    await queueSale({ clientId: crypto.randomUUID(), soldAt: new Date().toISOString(), customerId: customerId || undefined, lines: cart.map((l) => ({ productId: l.productId, qty: l.qty })), payments, session: s });
    setCart([]); setGiven(""); setQr(false); setMsg(r.change ? `Vente enregistrée · monnaie ${formatFcfa(r.change)}` : "Vente enregistrée");
    void syncPending().then((n) => { if (n) { void stock.refetch(); void customers.refetch(); } });
  }
  const checkout = () => (isQrMethod(pay) ? (navigator.onLine ? setQr(true) : setMsg("Le paiement QR nécessite une connexion")) : void submit());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="input" placeholder="Rechercher un produit" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {shown.map((p) => {
          const n = stock.data?.get(p.$id) ?? 0;
          return (
            <button key={p.$id} onClick={() => add(p)} className="card text-left active:scale-[.98]">
              <div className="font-medium leading-tight">{p.name}</div>
              <div className="text-[var(--gold)]">{formatFcfa(p.price)}</div>
              <div className={`text-xs ${n <= (p.minStock ?? 0) ? "text-red-400" : "text-white/50"}`}>Stock {n}</div>
            </button>
          );
        })}
        {!products.isLoading && shown.length === 0 && <p className="col-span-2 text-white/50 text-center py-6">Aucun produit. Ajoutez-en dans Stock.</p>}
      </div>
      {cart.length > 0 && (
        <section className="card flex flex-col gap-2">
          {cart.map((l) => (
            <div key={l.productId} className="flex items-center justify-between gap-2">
              <span className="flex-1 truncate">{l.name}</span>
              <button className="btn-ghost !p-2" onClick={() => setCart((c) => c.flatMap((x) => x.productId === l.productId ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x]))}><Minus size={16} /></button>
              <span className="w-6 text-center">{l.qty}</span>
              <button className="btn-ghost !p-2" onClick={() => setCart((c) => c.map((x) => x.productId === l.productId ? { ...x, qty: x.qty + 1 } : x))}><Plus size={16} /></button>
            </div>
          ))}
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Client comptoir</option>
            {customers.data?.map((c) => <option key={c.$id} value={c.$id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-4 gap-1 text-sm">
            {(["cash", "wave", "orange", "credit"] as const).map((m) => (
              <button key={m} onClick={() => setPay(m)} className={pay === m ? "btn !py-2" : "btn-ghost !py-2"}>{{ cash: "Espèces", wave: "Wave", orange: "Orange", card: "Carte", credit: "Crédit" }[m]}</button>
            ))}
          </div>
          {pay === "cash" && <input className="input" inputMode="numeric" placeholder="Montant reçu" value={given} onChange={(e) => setGiven(e.target.value)} />}
          <button className="btn text-lg" onClick={checkout}>Encaisser {formatFcfa(total)}</button>
        </section>
      )}
      {msg && <p className="text-center text-amber-300">{msg}</p>}
      {qr && isQrMethod(pay) && <QrPay session={s} provider={pay} amount={total} onPaid={(id) => void submit(id)} onCancel={() => setQr(false)} />}
      {scan && <Scanner onCode={byCode} onClose={() => setScan(false)} />}
    </div>
  );
}
