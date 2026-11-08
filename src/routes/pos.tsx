import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanLine, Minus, Plus } from "lucide-react";
import { cartTotal, formatFcfa, settle, isQrMethod, type CartLine, type Payment, type PaymentMethod } from "@/domain/money";
import { getShop, list, qtyOf, stockLevels, type Product, type Customer, type UnitRow } from "@/lib/data";
import { Query } from "@/lib/appwrite";
import { convertQty, formatQty, fromScaled, qtyFor, scaleOf, scaledInt } from "@/domain/quantity";
import { unitLabel } from "@/domain/articles";
import { queueSale, syncPending } from "@/lib/offline";
import { useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { QrPay } from "@/components/QrPay";
import { receiptModel, type ReceiptSale } from "@/domain/documents";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { canExtendCredit } from "@/domain/credit";


/** Ligne du panier : quantité de base (pour le prix et le stock) + unité vendue si un conditionnement est choisi. */
type PosLine = CartLine & { key: string; scale: number; unit?: string; unitQty?: number; factor?: number };
const keyOf = (productId: string, unit?: string) => `${productId}|${unit ?? ""}`;
const plus = (a: number, b: number, scale: number) => fromScaled(scaledInt(a, scale) + scaledInt(b, scale), scale);

export function PosPage() {
  const { session } = useSession(); const s = session!;
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500), staleTime: 60_000 });
  const stock = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const unitsQ = useQuery({ queryKey: ["units-all", s.shopId], queryFn: () => list<UnitRow>("article_units", s, [Query.equal("active", true)], 500), staleTime: 60_000 });
  const unitsOf = (id: string) => (unitsQ.data ?? []).filter((u) => u.productId === id);
  const [cart, setCart] = useState<PosLine[]>([]); const [pick, setPick] = useState<Product & { $id: string } | null>(null);
  const [q, setQ] = useState(""); const [scan, setScan] = useState(false);
  const [pay, setPay] = useState<PaymentMethod>("cash"); const [given, setGiven] = useState("");
  const [customerId, setCustomerId] = useState(""); const [qr, setQr] = useState(false);
  const [msg, setMsg] = useState("");
  const [last, setLast] = useState<ReceiptSale | null>(null);
  const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s), staleTime: 300_000 });
  const total = cartTotal(cart);

  /** Ajoute `qty` (dans l'unité `unit`, base par défaut) au panier. Lève une Error lisible si la quantité n'est pas valable pour cet article. */
  function addLine(p: Product & { $id: string }, qtyInput: string | number, unit = "") {
    const scale = scaleOf(p); const key = keyOf(p.$id, unit);
    const u = unit ? unitsOf(p.$id).find((x) => x.unit === unit) : undefined; if (unit && !u) throw new Error("Unité inconnue");
    const entered = unit ? qtyFor(qtyInput, 3) : qtyFor(qtyInput, scale);
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      const unitQty = unit ? plus(ex?.unitQty ?? 0, entered, 3) : undefined;
      const qty = unit ? convertQty(unitQty!, u!.factor, scale) : plus(ex?.qty ?? 0, entered, scale);
      const line: PosLine = { key, productId: p.$id, name: p.name, unitPrice: p.price, qty, scale, ...(unit ? { unit, unitQty, factor: u!.factor } : {}) };
      return ex ? c.map((l) => (l.key === key ? line : l)) : [...c, line];
    });
  }
  /** Article simple (entier, sans conditionnement) : ajout direct ; sinon on demande la quantité et l'unité. */
  const add = (p: Product & { $id: string }) => { if (scaleOf(p) > 0 || unitsOf(p.$id).length) { setPick(p); return; } try { addLine(p, 1); } catch (e) { setMsg((e as Error).message); } };
  const step = (key: string, d: 1 | -1) => setCart((c) => c.flatMap((l) => {
    if (l.key !== key) return [l];
    const next = l.unit ? plus(l.unitQty!, d, 3) : plus(l.qty, d, l.scale);
    if (!(next > 0)) return [];
    try { return [l.unit ? { ...l, unitQty: next, qty: convertQty(next, l.factor!, l.scale) } : { ...l, qty: next }]; } catch { return [l]; }
  }));
  const byCode = (code: string) => { const p = products.data?.find((x) => !x.archived && (x.barcode === code || x.sku === code)); if (p) add(p as Product & { $id: string }); else setMsg(`Code inconnu : ${code}`); setScan(false); };
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
    const clientId = crypto.randomUUID(); const soldAt = new Date().toISOString();
    await queueSale({ clientId, soldAt, customerId: customerId || undefined, lines: cart.map((l) => (l.unit ? { productId: l.productId, qty: l.unitQty!, unit: l.unit } : { productId: l.productId, qty: l.qty })), payments, session: s });
    // Même formule de numéro que le serveur : le ticket imprimé hors ligne porte le bon numéro.
    setLast({ number: `V-${soldAt.slice(0, 10).replace(/-/g, "")}-${clientId.slice(0, 6).toUpperCase()}`, soldAt, total, change: r.change, lines: cart.map((l) => ({ name: l.unit ? `${l.name} (${formatQty(l.unitQty!)} ${unitLabel(l.unit).toLowerCase()})` : l.name, qty: l.qty, unitPrice: l.unitPrice })), payments: payments.map((p) => ({ method: p.method, amount: p.amount })) });
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
          const n = qtyOf(stock.data, p);
          return (
            <button key={p.$id} onClick={() => add(p as Product & { $id: string })} className="card text-left active:scale-[.98]">
              <div className="font-medium leading-tight">{p.name}</div>
              <div className="text-[var(--gold)]">{formatFcfa(p.price)}</div>
              <div className={`text-xs ${n <= (p.minStock ?? 0) ? "text-red-400" : "text-white/50"}`}>Stock {formatQty(n)}{(p.unit ?? "piece") !== "piece" ? ` ${unitLabel(p.unit).toLowerCase()}` : ""}</div>
            </button>
          );
        })}
        {!products.isLoading && shown.length === 0 && <p className="col-span-2 text-white/50 text-center py-6">Aucun produit. Ajoutez-en dans Stock.</p>}
      </div>
      {cart.length > 0 && (
        <section className="card flex flex-col gap-2">
          {cart.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2">
              <span className="flex-1 min-w-0"><span className="block truncate">{l.name}</span>{l.unit && <span className="text-xs text-white/50">{formatQty(l.unitQty!)} {unitLabel(l.unit).toLowerCase()} = {formatQty(l.qty)}</span>}</span>
              <button className="btn-ghost !p-2" aria-label="Moins" onClick={() => step(l.key, -1)}><Minus size={16} /></button>
              <span className="min-w-8 text-center">{formatQty(l.unit ? l.unitQty! : l.qty)}</span>
              <button className="btn-ghost !p-2" aria-label="Plus" onClick={() => step(l.key, 1)}><Plus size={16} /></button>
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
      {last && cart.length === 0 && <button className="btn-ghost" onClick={() => void pdfBlob(receiptModel(last, shop.data ?? null, customer?.name)).then((b) => deliverPdf(b, `${last.number}.pdf`))}>Ticket PDF / Partager</button>}
      {qr && isQrMethod(pay) && <QrPay session={s} provider={pay} amount={total} onPaid={(id) => void submit(id)} onCancel={() => setQr(false)} />}
      {pick && <QtyDialog p={pick} units={unitsOf(pick.$id)} onClose={() => setPick(null)} onAdd={(q, unit) => { addLine(pick, q, unit); setPick(null); }} />}
      {scan && <Scanner onCode={byCode} onClose={() => setScan(false)} />}
    </div>
  );
}

/** Quantité et unité d'un article décimal ou conditionné (kilo, litre, carton…). Le prix de la ligne est calculé par le même code que le serveur. */
function QtyDialog({ p, units, onClose, onAdd }: { p: Product & { $id: string }; units: UnitRow[]; onClose: () => void; onAdd: (qty: string, unit: string) => void }) {
  const [unit, setUnit] = useState(""); const [qty, setQty] = useState(""); const [err, setErr] = useState("");
  const scale = scaleOf(p); const u = units.find((x) => x.unit === unit);
  let base = 0, ok = false;
  try { const e = unit ? qtyFor(qty, 3) : qtyFor(qty, scale); base = unit ? convertQty(e, u!.factor, scale) : e; ok = true; } catch { /* saisie incomplète */ }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4" role="dialog" aria-modal="true" aria-label="Quantité">
      <form className="card w-full max-w-sm flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); try { onAdd(qty, unit); } catch (x) { setErr((x as Error).message); } }}>
        <b>{p.name}</b>
        {units.length > 0 && <div className="flex gap-2 flex-wrap">{[{ unit: "", label: unitLabel(p.unit) }, ...units.map((x) => ({ unit: x.unit, label: unitLabel(x.unit) }))].map((x) => <button type="button" key={x.unit} className="chip" aria-current={unit === x.unit} onClick={() => setUnit(x.unit)}>{x.label}</button>)}</div>}
        <input className="input" inputMode="decimal" autoFocus placeholder={`Quantité en ${unitLabel(unit ? unit : p.unit).toLowerCase()}`} value={qty} onChange={(e) => { setQty(e.target.value); setErr(""); }} />
        {ok && <p className="text-sm text-white/60">{unit ? `= ${formatQty(base)} ${unitLabel(p.unit).toLowerCase()} · ` : ""}{formatFcfa(Math.round(p.price * base * 1e6) / 1e6)}</p>}
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        <div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={onClose}>Annuler</button><button className="btn flex-1" disabled={!ok}>Ajouter</button></div>
      </form>
    </div>
  );
}
