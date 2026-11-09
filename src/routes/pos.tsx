import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanLine, Minus, Plus } from "lucide-react";
import { cartTotal, formatFcfa, settle, isQrMethod, type CartLine, type Payment, type PaymentMethod } from "@/domain/money";
import { getShop, list, qtyOf, stockLevels, variantQty, type Product, type Customer, type UnitRow, type VariantRow, type RuleRow } from "@/lib/data";
import { Query } from "@/lib/appwrite";
import { convertQty, formatQty, fromScaled, qtyFor, scaleOf, scaledInt } from "@/domain/quantity";
import { unitLabel } from "@/domain/articles";
import { planAllows } from "@/domain/features";
import { resolvePrice, ruleFromRow, categoryLabel, KIND_LABEL } from "@/domain/pricing";
import { useSubscription } from "./subscription";
import { useStockLevels } from "@/lib/queries";
import { queueSale, syncPending } from "@/lib/offline";
import { useSession } from "@/lib/session";
import { trackingOf } from "@/domain/tracking";
import { Scanner } from "@/components/Scanner";
import { QrPay } from "@/components/QrPay";
import { receiptModel, type ReceiptSale } from "@/domain/documents";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { canExtendCredit } from "@/domain/credit";


/** Ligne du panier : quantité de base (pour le prix et le stock) + unité vendue si un conditionnement est choisi. */
type PosLine = CartLine & { key: string; scale: number; basePrice: number; unit?: string; unitQty?: number; factor?: number; variantId?: string; serials?: string[] };
const keyOf = (productId: string, unit?: string, variantId?: string) => `${productId}|${unit ?? ""}|${variantId ?? ""}`;
const plus = (a: number, b: number, scale: number) => fromScaled(scaledInt(a, scale) + scaledInt(b, scale), scale);

export function PosPage() {
  const { session } = useSession(); const s = session!;
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500), staleTime: 60_000 });
  const stock = useStockLevels();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const unitsQ = useQuery({ queryKey: ["units-all", s.shopId], queryFn: () => list<UnitRow>("article_units", s, [Query.equal("active", true)], 500), staleTime: 60_000 });
  const variantsQ = useQuery({ queryKey: ["variants-all", s.shopId], queryFn: () => list<VariantRow>("article_variants", s, [Query.equal("archived", false)], 500), staleTime: 60_000 });
  const variantsOf = (id: string) => (variantsQ.data ?? []).filter((v) => v.productId === id);
  const [pickVar, setPickVar] = useState<(Product & { $id: string }) | null>(null);
  const unitsOf = (id: string) => (unitsQ.data ?? []).filter((u) => u.productId === id);
  const [cart, setCart] = useState<PosLine[]>([]); const [pick, setPick] = useState<{ p: Product & { $id: string }; v?: VariantRow } | null>(null);
  const [q, setQ] = useState(""); const [scan, setScan] = useState(false);
  const [pay, setPay] = useState<PaymentMethod>("cash"); const [given, setGiven] = useState("");
  const [customerId, setCustomerId] = useState(""); const [qr, setQr] = useState(false);
  const [msg, setMsg] = useState("");
  const [last, setLast] = useState<ReceiptSale | null>(null);
  const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s), staleTime: 300_000 });

  /** Ajoute `qty` (dans l'unité `unit`, base par défaut) au panier. Lève une Error lisible si la quantité n'est pas valable pour cet article. */
  function addLine(p: Product & { $id: string }, qtyInput: string | number, unit = "", v?: VariantRow) {
    const scale = scaleOf(p); const key = keyOf(p.$id, unit, v?.$id);
    const u = unit ? unitsOf(p.$id).find((x) => x.unit === unit) : undefined; if (unit && !u) throw new Error("Unité inconnue");
    const entered = unit ? qtyFor(qtyInput, 3) : qtyFor(qtyInput, scale);
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      const unitQty = unit ? plus(ex?.unitQty ?? 0, entered, 3) : undefined;
      const qty = unit ? convertQty(unitQty!, u!.factor, scale) : plus(ex?.qty ?? 0, entered, scale);
      const line: PosLine = { key, productId: p.$id, name: v ? `${p.name} — ${v.label}` : p.name, unitPrice: v ? v.price : p.price, basePrice: v ? v.price : p.price, qty, scale, ...(v ? { variantId: v.$id } : {}), ...(unit ? { unit, unitQty, factor: u!.factor } : {}) };
      return ex ? c.map((l) => (l.key === key ? line : l)) : [...c, line];
    });
  }
  /** Article simple (entier, sans conditionnement) : ajout direct ; sinon on demande la quantité et l'unité. */
  const add = (p: Product & { $id: string }, v?: VariantRow) => { if (p.hasVariants && !v) { setPickVar(p); return; } if (trackingOf(p) === "serial" && cart.some((l) => l.serials && l.productId === p.$id && (l.variantId ?? "") === (v?.$id ?? ""))) { setMsg("Cet article est saisi par numéro de série : scannez l'étiquette de chaque unité (ou retirez la ligne pour une attribution automatique)."); return; } if (scaleOf(p) > 0 || unitsOf(p.$id).length) { setPick({ p, v }); return; } try { addLine(p, 1, "", v); } catch (e) { setMsg((e as Error).message); } };
  /** Article à numéro de série : une ligne par article/variante, quantité = nombre de numéros saisis ; le serveur vérifie qu'ils existent et sont disponibles. */
  function addSerials(p: Product & { $id: string }, v: VariantRow | undefined, list: string[]) {
    const key = `${keyOf(p.$id, "", v?.$id)}|serial`;
    setCart((c) => { c = c.filter((l) => !(l.productId === p.$id && (l.variantId ?? "") === (v?.$id ?? "") && !l.serials)); const ex = c.find((l) => l.key === key); const all = [...new Set([...(ex?.serials ?? []), ...list])];
      const line: PosLine = { key, productId: p.$id, name: v ? `${p.name} — ${v.label}` : p.name, unitPrice: v ? v.price : p.price, basePrice: v ? v.price : p.price, qty: all.length, scale: 0, serials: all, ...(v ? { variantId: v.$id } : {}) };
      return ex ? c.map((l) => (l.key === key ? line : l)) : [...c, line]; });
  }
  const step = (key: string, d: 1 | -1) => setCart((c) => c.flatMap((l) => {
    if (l.key !== key) return [l];
    const next = l.unit ? plus(l.unitQty!, d, 3) : plus(l.qty, d, l.scale);
    if (!(next > 0)) return [];
    try { return [l.unit ? { ...l, unitQty: next, qty: convertQty(next, l.factor!, l.scale) } : { ...l, qty: next }]; } catch { return [l]; }
  }));
  /** Code scanné = numéro de série d'une unité précise (étiquette collée sur l'appareil) : cette unité est ajoutée au panier. */
  async function bySerial(code: string) {
    try {
      const r = await list<{ productId: string; variantId?: string; serial: string; status: string }>("article_serials", s, [Query.equal("serial", code.trim().toUpperCase())], 5);
      const hit = r[0]; const p = hit && products.data?.find((x) => x.$id === hit.productId);
      if (!hit || !p) return setMsg(`Code inconnu : ${code}`);
      if (hit.status !== "available") return setMsg(`Numéro de série ${hit.serial} indisponible (${hit.status === "sold" ? "déjà vendu" : hit.status})`);
      addSerials(p as Product & { $id: string }, variantsQ.data?.find((v) => v.$id === hit.variantId), [hit.serial]);
    } catch { setMsg(`Code inconnu : ${code}`); }
  }
  const byCode = (code: string) => {
    const v = variantsQ.data?.find((x) => x.barcode === code || x.sku === code); const vp = v && products.data?.find((x) => x.$id === v.productId && !x.archived);
    if (v && vp) add(vp as Product & { $id: string }, v);
    else { const p = products.data?.find((x) => !x.archived && (x.barcode === code || x.sku === code)); if (p) add(p as Product & { $id: string }); else void bySerial(code); }
    setScan(false);
  };
  const shown = useMemo(() => (products.data ?? []).filter((p) => !p.archived && [p.name, p.sku, p.barcode].some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 40), [products.data, q]);
  const customer = customers.data?.find((c) => c.$id === customerId);
  // Tarifs avancés (Pro) : mêmes règles et même moteur que le serveur, évalués à l'instant de la vente. Le serveur recalcule et fait foi.
  const tiered = planAllows(useSubscription().data?.entitlement.plan.id, "tieredPricing");
  const rulesQ = useQuery({ queryKey: ["rules-all", s.shopId], enabled: tiered, queryFn: () => list<RuleRow>("article_price_rules", s, [], 500), staleTime: 60_000 });
  const pricedAt = (at: string) => cart.map((l) => {
    const rules = tiered ? (rulesQ.data ?? []).filter((r) => r.productId === l.productId && (r.variantId ?? "") === (l.variantId ?? "")).map((r) => ruleFromRow(r as never)) : [];
    const res = resolvePrice(rules, { basePrice: l.basePrice, unit: l.unit ?? "", factor: l.factor, qty: l.unit ? l.unitQty! : l.qty, baseQty: l.qty, customerCategory: customer?.category ?? "", at });
    return { ...l, unitPrice: res.unitPrice, amount: res.amount, source: res.source };
  });
  const priced = pricedAt(new Date().toISOString());
  const total = cartTotal(priced); const cashGiven = Number(given.replace(/\s/g, "")) || 0;

  /** linkId : lien QR déjà confirmé. Le serveur revérifie prix, stock, plafond de crédit et lien. */
  async function submit(linkId?: string) {
    setMsg("");
    const clientId = crypto.randomUUID(); const soldAt = new Date().toISOString();
    const linesAt = pricedAt(soldAt); const tot = cartTotal(linesAt); // prix évalués à la date de la vente envoyée au serveur
    if (pay === "cash" && !(Number(given.replace(/\s/g, "")) > 0)) return setMsg("Saisissez le montant reçu du client avant de valider");
    const amount = pay === "cash" ? Number(given.replace(/\s/g, "")) : tot;
    const payments: (Payment & { linkId?: string })[] = [{ method: pay, amount, linkId }];
    const r = settle(tot, payments);
    if (!r.ok) return setMsg(r.error);
    if (pay === "credit") {
      if (!customer) return setMsg("Choisissez un client pour la vente à crédit");
      const c = canExtendCredit({ balance: customer.creditBalance ?? 0, limit: customer.creditLimit ?? 0 }, tot);
      if (!c.ok) return setMsg(c.error);
    }
    await queueSale({ clientId, soldAt, customerId: customerId || undefined, lines: cart.map((l) => ({ productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), ...(l.serials ? { qty: l.serials.length, serials: l.serials } : l.unit ? { qty: l.unitQty!, unit: l.unit } : { qty: l.qty }) })), payments, session: s });
    // Même formule de numéro que le serveur : le ticket imprimé hors ligne porte le bon numéro.
    setLast({ number: `V-${soldAt.slice(0, 10).replace(/-/g, "")}-${clientId.slice(0, 6).toUpperCase()}`, soldAt, total: tot, change: r.change, lines: linesAt.map((l) => ({ name: l.unit ? `${l.name} (${formatQty(l.unitQty!)} ${unitLabel(l.unit).toLowerCase()})` : l.name, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount })), payments: payments.map((p) => ({ method: p.method, amount: p.amount })) });
    setCart([]); setGiven(""); setQr(false); setMsg(r.change ? `Vente enregistrée · monnaie ${formatFcfa(r.change)}` : "Vente enregistrée");
    void syncPending().then((n) => { if (n) { void stock.refetch(); void customers.refetch(); } });
  }
  const checkout = () => (isQrMethod(pay) ? (navigator.onLine ? setQr(true) : setMsg("Le paiement QR nécessite une connexion")) : void submit());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="input" placeholder="Nom, référence, code-barres" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {shown.map((p) => {
          const n = qtyOf(stock.data, p);
          return (
            <button key={p.$id} onClick={() => add(p as Product & { $id: string })} className="card text-left active:scale-[.98]">
              <div className="font-medium leading-tight">{p.name}</div>
              <div className="text-[var(--gold)]">{p.hasVariants ? `dès ${formatFcfa(Math.min(...(variantsOf(p.$id).length ? variantsOf(p.$id).map((v) => v.price) : [p.price])))}` : formatFcfa(p.price)}</div>{p.hasVariants && <div className="text-xs text-white/50">{variantsOf(p.$id).length} variantes</div>}
              <div className={`text-xs ${n <= (p.minStock ?? 0) ? "text-red-400" : "text-white/50"}`}>Stock {formatQty(n)}{(p.unit ?? "piece") !== "piece" ? ` ${unitLabel(p.unit).toLowerCase()}` : ""}</div>
            </button>
          );
        })}
        {!products.isLoading && shown.length === 0 && <p className="col-span-2 text-white/50 text-center py-6">Aucun produit. Ajoutez-en dans Stock.</p>}
      </div>
      {cart.length > 0 && (
        <section className="card flex flex-col gap-2">
          {priced.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2">
              <span className="flex-1 min-w-0"><span className="block truncate">{l.name}</span><span className="text-xs text-white/50">{l.unit ? `${formatQty(l.unitQty!)} ${unitLabel(l.unit).toLowerCase()} = ${formatQty(l.qty)} · ` : ""}{formatFcfa(l.amount)}{l.source !== "base" && <b className="ml-1 text-emerald-300">· {l.source === "promo" ? "Promo" : l.source === "category" ? `Tarif ${categoryLabel(customer?.category).toLowerCase()}` : "Prix par quantité"}</b>}</span></span>
              {l.serials ? <><span className="text-xs text-white/60 max-w-[8rem] truncate" title={l.serials.join(", ")}>N° {l.serials.join(", ")}</span><button className="btn-ghost !p-2" aria-label="Retirer" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}><Minus size={16} /></button></> : <>
              <button className="btn-ghost !p-2" aria-label="Moins" onClick={() => step(l.key, -1)}><Minus size={16} /></button>
              <span className="min-w-8 text-center">{formatQty(l.unit ? l.unitQty! : l.qty)}</span>
              <button className="btn-ghost !p-2" aria-label="Plus" onClick={() => step(l.key, 1)}><Plus size={16} /></button></>}
            </div>
          ))}
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Client comptoir</option>
            {customers.data?.map((c) => <option key={c.$id} value={c.$id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-4 gap-1 text-sm">
            {(["cash", "wave", "orange", "credit"] as const).map((m) => (
              <button key={m} onClick={() => setPay(m)} className={`${pay === m ? "btn" : "btn-ghost"} !py-2 !px-1 text-[13px]`}>{{ cash: "Espèces", wave: "Wave", orange: "Orange", card: "Carte", credit: "Crédit" }[m]}</button>
            ))}
          </div>
          {pay === "cash" && <>
            <input className="input" inputMode="numeric" required aria-required="true" aria-label="Montant reçu" placeholder="Montant reçu (obligatoire)" value={given} onChange={(e) => { setGiven(e.target.value); setMsg(""); }} />
            {given.trim() !== "" && <p className={`text-sm ${cashGiven >= total ? "text-emerald-300" : "text-amber-300"}`} role="status">{cashGiven >= total ? `Monnaie à rendre : ${formatFcfa(cashGiven - total)}` : `Il manque ${formatFcfa(total - cashGiven)}`}</p>}
          </>}
          <button className="btn text-lg disabled:opacity-40" disabled={pay === "cash" && !(cashGiven >= total && cashGiven > 0)} onClick={checkout}>Encaisser {formatFcfa(total)}</button>
        </section>
      )}
      {msg && <p className="text-center text-amber-300">{msg}</p>}
      {last && cart.length === 0 && <button className="btn-ghost" onClick={() => void pdfBlob(receiptModel(last, shop.data ?? null, customer?.name)).then((b) => deliverPdf(b, `${last.number}.pdf`))}>Ticket PDF / Partager</button>}
      {qr && isQrMethod(pay) && <QrPay session={s} provider={pay} amount={total} onPaid={(id) => void submit(id)} onCancel={() => setQr(false)} />}
      {pickVar && <VariantDialog p={pickVar} variants={variantsOf(pickVar.$id)} levels={stock.data} onClose={() => setPickVar(null)} onPick={(v) => { const p = pickVar; setPickVar(null); add(p, v); }} />}
      {pick && <QtyDialog p={pick.p} v={pick.v} units={unitsOf(pick.p.$id)} onClose={() => setPick(null)} onAdd={(q, unit) => { addLine(pick.p, q, unit, pick.v); setPick(null); }} />}
      {scan && <Scanner onCode={byCode} onClose={() => setScan(false)} />}
    </div>
  );
}

/** Quantité et unité d'un article décimal ou conditionné (kilo, litre, carton…). Le prix de la ligne est calculé par le même code que le serveur. */
function QtyDialog({ p, v, units, onClose, onAdd }: { p: Product & { $id: string }; v?: VariantRow; units: UnitRow[]; onClose: () => void; onAdd: (qty: string, unit: string) => void }) {
  const [unit, setUnit] = useState(""); const [qty, setQty] = useState(""); const [err, setErr] = useState("");
  const scale = scaleOf(p); const u = units.find((x) => x.unit === unit);
  let base = 0, ok = false;
  try { const e = unit ? qtyFor(qty, 3) : qtyFor(qty, scale); base = unit ? convertQty(e, u!.factor, scale) : e; ok = true; } catch { /* saisie incomplète */ }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4" role="dialog" aria-modal="true" aria-label="Quantité">
      <form className="card w-full max-w-sm flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); try { onAdd(qty, unit); } catch (x) { setErr((x as Error).message); } }}>
        <b>{v ? `${p.name} — ${v.label}` : p.name}</b>
        {units.length > 0 && <div className="flex gap-2 flex-wrap">{[{ unit: "", label: unitLabel(p.unit) }, ...units.map((x) => ({ unit: x.unit, label: unitLabel(x.unit) }))].map((x) => <button type="button" key={x.unit} className="chip" aria-current={unit === x.unit} onClick={() => setUnit(x.unit)}>{x.label}</button>)}</div>}
        <input className="input" inputMode="decimal" autoFocus placeholder={`Quantité en ${unitLabel(unit ? unit : p.unit).toLowerCase()}`} value={qty} onChange={(e) => { setQty(e.target.value); setErr(""); }} />
        {ok && <p className="text-sm text-white/60">{unit ? `= ${formatQty(base)} ${unitLabel(p.unit).toLowerCase()} · ` : ""}{formatFcfa(Math.round((v ? v.price : p.price) * base * 1e6) / 1e6)}</p>}
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        <div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={onClose}>Annuler</button><button className="btn flex-1" disabled={!ok}>Ajouter</button></div>
      </form>
    </div>
  );
}

/** Choix de la variante d'un article décliné : prix et stock de chacune, les ruptures restent visibles mais non vendables. */
function VariantDialog({ p, variants, levels, onClose, onPick }: { p: Product & { $id: string }; variants: VariantRow[]; levels?: Map<string, number>; onClose: () => void; onPick: (v: VariantRow) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4" role="dialog" aria-modal="true" aria-label="Variante">
      <div className="card w-full max-w-sm flex flex-col gap-2 max-h-[80vh] overflow-y-auto">
        <b>{p.name}</b><p className="text-sm text-white/60">Choisissez la variante :</p>
        {variants.length === 0 && <p className="text-sm text-white/50">Aucune variante active.</p>}
        {variants.map((v) => { const n = variantQty(levels, v, scaleOf(p)); return (
          <button key={v.$id} className="btn-ghost flex justify-between items-center text-left !py-3 disabled:opacity-40" disabled={n <= 0} onClick={() => onPick(v)}>
            <span><span className="block font-medium">{v.label}</span><span className="text-xs text-white/50">{n > 0 ? `${formatQty(n)} en stock` : "Rupture"}</span></span><span className="gold-text font-bold">{formatFcfa(v.price)}</span>
          </button>); })}
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}
