import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLine, Minus, Plus, Search, X } from "lucide-react";
import { cartTotal, formatFcfa, type CartLine } from "@/domain/money";
import { evaluatePay, METHOD_LABEL, type PayLine } from "@/domain/pay";
import { PayPanel, newPayLine } from "@/components/PayPanel";
import { Confirm, Thumb } from "@/components/ui";
import { getShop, list, qtyOf, variantQty, type Product, type Customer, type UnitRow, type VariantRow, type RuleRow } from "@/lib/data";
import { Query } from "@/lib/appwrite";
import { convertQty, formatQty, fromScaled, qtyFor, scaleOf, scaledInt } from "@/domain/quantity";
import { unitLabel } from "@/domain/articles";
import { planAllows } from "@/domain/features";
import { resolvePrice, ruleFromRow, categoryLabel } from "@/domain/pricing";
import { useSubscription } from "./subscription";
import { useStockLevels } from "@/lib/queries";
import { onSyncResult, queueSale, syncPending, type SyncResult } from "@/lib/offline";
import { FavStar, SimPanel, SuggestStrip, useDensity, useFavorites, useShortcuts, type ApprovalKind, type Sim, type Suggest } from "@/components/PosPro";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { trackingOf } from "@/domain/tracking";
import { Scanner } from "@/components/Scanner";
import { QrPay } from "@/components/QrPay";
import { receiptModel, type ReceiptSale } from "@/domain/documents";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { isVirtualBundle } from "@/domain/bundles";


/** Ligne du panier : quantité de base (pour le prix et le stock) + unité vendue si un conditionnement est choisi. */
type Preview = { total: number; discountTotal: number; promotions: { promoId: string; name: string; code?: string; discount: number }[]; decisions?: { promoId: string; name: string; outcome: "applied" | "refused"; message: string; reason: string }[]; notes?: string[]; pro?: boolean; coupon?: { ok: boolean; code: string; message: string; applied: boolean }; lines: { amount: number; baseAmount?: number; promo?: { name: string; code?: string; discount: number }; promos?: { name: string; discount: number }[] }[] };
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
  const favs = useFavorites(s.shopId); const dens = useDensity(); const searchRef = useRef<HTMLInputElement>(null); const [favOnly, setFavOnly] = useState(false);
  const [payLines, setPayLines] = useState<PayLine[]>(() => [newPayLine("cash")]); const [confirm, setConfirm] = useState(false); const [qrLine, setQrLine] = useState<string | null>(null); const [cat, setCat] = useState(""); const [custQ, setCustQ] = useState(""); const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [msg, setMsg] = useState(""); const [couponIn, setCouponIn] = useState(""); const [coupon, setCoupon] = useState("");
  const [last, setLast] = useState<ReceiptSale | null>(null); const [lastName, setLastName] = useState<string | undefined>();
  const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s), staleTime: 300_000 });
  const smart = planAllows(useSubscription().data?.entitlement.plan.id, "smartPos"); const manager = s.role === "owner" || s.role === "manager"; const qc = useQueryClient();
  const cashQ = useQuery({ queryKey: ["cash-current", s.shopId], enabled: smart && navigator.onLine, staleTime: 15_000, retry: 1, queryFn: () => api<{ session: { id: string; openedAt: string } | null; required: boolean }>(s, "cash.current") });
  const needSession = !!cashQ.data?.required && !cashQ.data.session;
  const payCfg = useQuery({ queryKey: ["pay-settings", s.shopId], enabled: navigator.onLine, staleTime: 300_000, queryFn: () => list<{ waveTemplate?: string; orangeTemplate?: string }>("payment_settings", s, [], 1) });
  const qrConfigured = { wave: !!payCfg.data?.[0]?.waveTemplate, orange: !!payCfg.data?.[0]?.orangeTemplate };

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
  const categories = useMemo(() => [...new Set((products.data ?? []).filter((p) => !p.archived).map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr")), [products.data]);
  const shown = useMemo(() => (products.data ?? []).filter((p) => !p.archived && (!cat || p.category === cat) && (!favOnly || favs.ids.includes(p.$id)) && [p.name, p.sku, p.barcode].some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 60), [products.data, q, cat, favOnly, favs.ids]);
  const customer = customers.data?.find((c) => c.$id === customerId);
  // Tarifs avancés (Pro) : mêmes règles et même moteur que le serveur, évalués à l'instant de la vente. Le serveur recalcule et fait foi.
  const tiered = planAllows(useSubscription().data?.entitlement.plan.id, "tieredPricing");
  const rulesQ = useQuery({ queryKey: ["rules-all", s.shopId], enabled: tiered, queryFn: () => list<RuleRow>("article_price_rules", s, [], 500), staleTime: 60_000 });
  const pricedAt = (at: string) => cart.map((l) => {
    const rules = tiered ? (rulesQ.data ?? []).filter((r) => r.productId === l.productId && (r.variantId ?? "") === (l.variantId ?? "")).map((r) => ruleFromRow(r as never)) : [];
    const res = resolvePrice(rules, { basePrice: l.basePrice, unit: l.unit ?? "", factor: l.factor, qty: l.unit ? l.unitQty! : l.qty, baseQty: l.qty, customerCategory: customer?.category ?? "", at });
    return { ...l, unitPrice: res.unitPrice, amount: res.amount, source: res.source, discountPct: manager || pro ? l.discountPct : 0 };
  });
  const priced = pricedAt(new Date().toISOString());
  // Promotions (Business) : le SERVEUR calcule remises et total (aperçu = même calcul qu'une vraie vente, rien n'est écrit) ; hors ligne, elles sont appliquées à la synchronisation.
  const promoOn = planAllows(useSubscription().data?.entitlement.plan.id, "promotions"); 
  const apiLines = cart.map((l) => ({ productId: l.productId, ...((manager || pro) && (l.discountPct ?? 0) > 0 ? { discountPct: l.discountPct } : {}), ...(l.variantId ? { variantId: l.variantId } : {}), ...(l.serials ? { qty: l.serials.length, serials: l.serials } : l.unit ? { qty: l.unitQty!, unit: l.unit } : { qty: l.qty }) }));
  const proOn = planAllows(useSubscription().data?.entitlement.plan.id, "promotionsPro"); const pro = planAllows(useSubscription().data?.entitlement.plan.id, "smartPosPro");
  const [approvals, setApprovals] = useState<Partial<Record<ApprovalKind, string>>>({}); const [asked, setAsked] = useState<Partial<Record<ApprovalKind, string>>>({}); const [askBusy, setAskBusy] = useState(false);
  const cartSig = JSON.stringify(apiLines) + customerId + coupon; useEffect(() => { setApprovals({}); setAsked({}); }, [cartSig]); // une approbation ne vaut que pour CE panier
  const sugg = useQuery({ queryKey: ["pos-suggest", s.shopId, [...new Set(cart.map((l) => l.productId))].sort().join(","), customerId], enabled: pro && navigator.onLine, staleTime: 60_000, retry: 0, queryFn: () => api<Suggest>(s, "pos.suggest", { productIds: [...new Set(cart.map((l) => l.productId))], customerId: customerId || undefined }) });
  const sim = useQuery({ queryKey: ["pos-sim", s.shopId, cartSig], enabled: pro && cart.length > 0 && navigator.onLine, retry: 0, staleTime: 0, queryFn: () => api<Sim>(s, "pos.simulate", { lines: apiLines, customerId: customerId || undefined, ...(coupon ? { couponCode: coupon } : {}) }) });
  const simD = sim.data && !sim.isFetching ? sim.data : undefined; const blockedSim = pro && !!simD && (!simD.ok || ((simD.needsApproval.margin && !approvals.margin) || (simD.needsApproval.discount && !approvals.discount)));
  const pendingIds = Object.values(asked).filter(Boolean); const apprQ = useQuery({ queryKey: ["pos-approvals", s.shopId, pendingIds.join(",")], enabled: pendingIds.length > 0, refetchInterval: 4000, queryFn: () => api<{ approvals: { id: string; status: string }[] }>(s, "approval.list", {}) });
  useEffect(() => { for (const k of ["margin", "discount"] as const) { const id = asked[k]; const r = id ? apprQ.data?.approvals.find((a) => a.id === id) : undefined; if (r?.status === "approved") { setApprovals((a) => ({ ...a, [k]: id })); setAsked((a) => ({ ...a, [k]: undefined })); } else if (r && (r.status === "rejected" || r.status === "expired")) { setMsg(`Demande d'approbation ${r.status === "rejected" ? "refusée" : "expirée"}`); setAsked((a) => ({ ...a, [k]: undefined })); } } }, [apprQ.data]);
  async function requestApproval(kind: ApprovalKind) { if (!simD?.ok) return; setAskBusy(true); try { const r = await api<{ id: string }>(s, "approval.request", { kind, refId: simD.fp, amount: simD.total, details: { total: simD.total, alertes: simD.alerts.map((a) => a.message).slice(0, 5) } }); setAsked((a) => ({ ...a, [kind]: r.id })); setMsg("Demande envoyée : un responsable doit l'approuver dans Caisse Pro › Approbations"); } catch (e) { setMsg((e as Error).message); } finally { setAskBusy(false); } }
  const [lastId, setLastId] = useState(""); const [lastSync, setLastSync] = useState<SyncResult | undefined>();
  useEffect(() => onSyncResult((r) => { if (r.clientId === lastId) setLastSync(r); }), [lastId]);
  const preview = useQuery({ queryKey: ["promo-preview", s.shopId, JSON.stringify(apiLines), customerId, coupon], enabled: promoOn && cart.length > 0 && navigator.onLine, retry: 0, staleTime: 0, queryFn: () => api<Preview>(s, "promotions.preview", { lines: apiLines, customerId: customerId || undefined, ...(coupon ? { couponCode: coupon } : {}) }) });
  const pv = promoOn && preview.data && !preview.isFetching ? preview.data : undefined; const waiting = promoOn && cart.length > 0 && navigator.onLine && preview.isFetching;
  const total = pv ? pv.total : cartTotal(priced);
  const payState = evaluatePay(total, payLines, { hasCustomer: !!customer, credit: customer ? { balance: customer.creditBalance ?? 0, limit: customer.creditLimit ?? 0 } : undefined });
  const resetPay = () => setPayLines([newPayLine("cash")]);

  /** Validation définitive (après confirmation explicite). Le serveur revérifie prix, remises, stock, plafond de crédit, références et idempotence (clientId) ; la vente est mise en file locale puis envoyée. */
  async function submit() {
    setMsg(""); if (!payState.ok) return setMsg(payState.errors[0] ?? "Paiement incohérent"); setBusy(true);
    try {
      const clientId = crypto.randomUUID(); const soldAt = new Date().toISOString();
      const linesAt = pricedAt(soldAt).map((l, i) => (pv?.lines[i] ? { ...l, amount: pv.lines[i]!.amount, name: pv.lines[i]!.promo ? `${l.name} (promo ${pv.lines[i]!.promo!.name})` : l.name } : l)); const tot = pv ? pv.total : cartTotal(linesAt); // prix évalués à la date de la vente envoyée au serveur
      const st2 = evaluatePay(tot, payLines, { hasCustomer: !!customer, credit: customer ? { balance: customer.creditBalance ?? 0, limit: customer.creditLimit ?? 0 } : undefined }); if (!st2.ok) return setMsg(st2.errors[0] ?? "Paiement incohérent");
      await queueSale({ clientId, soldAt, customerId: customerId || undefined, ...(coupon && pv?.coupon?.ok ? { couponCode: coupon } : {}), lines: apiLines, payments: st2.payments, ...(approvals.margin || approvals.discount ? { approvals } : {}), session: s }); setLastId(clientId); setLastSync(undefined);
      // Même formule de numéro que le serveur : le ticket imprimé hors ligne porte le bon numéro.
      setLast({ number: `V-${soldAt.slice(0, 10).replace(/-/g, "")}-${clientId.slice(0, 6).toUpperCase()}`, soldAt, total: tot, change: st2.change, lines: linesAt.map((l) => ({ name: l.unit ? `${l.name} (${formatQty(l.unitQty!)} ${unitLabel(l.unit).toLowerCase()})` : l.name, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, discountPct: l.discountPct })), payments: st2.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })) });
      setLastName(customer?.name); setCart([]); resetPay(); setConfirm(false); setCoupon(""); setCouponIn(""); setMsg((st2.change ? `Vente enregistrée · monnaie à rendre ${formatFcfa(st2.change)}` : "Vente enregistrée") + " · en attente de confirmation du serveur");
      void syncPending().then((n) => { if (n) { void stock.refetch(); void customers.refetch(); void qc.invalidateQueries({ queryKey: ["cash-current"] }); } });
    } finally { setBusy(false); setConfirm(false); }
  }
  useShortcuts(pro ? { F2: () => searchRef.current?.focus(), F4: () => { if (cart.length && payState.ok && !busy) checkout(); }, F8: () => { if (cart.length) { setCart([]); resetPay(); } } } : {});
  const checkout = () => { setMsg(""); if (blockedSim) return setMsg(simD && !simD.ok ? simD.blocked : "Approbation d'un responsable requise avant de valider"); if (needSession) return setMsg("Ouvrez la caisse avant de vendre (session de caisse obligatoire)"); if (!payState.ok) return setMsg(payState.errors[0] ?? "Paiement incohérent"); setConfirm(true); };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Caisse</h1>
      {smart && cashQ.data && (cashQ.data.session
        ? <Link to="/caisse" className="card !py-2 flex items-center justify-between text-xs border border-ok/30"><span className="text-ok">● Caisse ouverte depuis {new Date(cashQ.data.session.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span><span className="text-muted">Gérer ›</span></Link>
        : <Link to="/caisse" className="card !py-2 flex items-center justify-between text-xs border border-warn/30"><span className="text-warn">○ Caisse fermée{cashQ.data.required ? " — ouverture obligatoire pour vendre" : ""}</span><span className="text-muted">Ouvrir ›</span></Link>)}
      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input ref={searchRef} className="input !pl-9" aria-label="Rechercher" placeholder="Nom, référence, code-barres" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { const hit = (products.data ?? []).find((p) => !p.archived && (p.barcode === q.trim() || p.sku === q.trim())); if (hit) { add(hit as Product & { $id: string }); setQ(""); } else if (shown.length === 1) { add(shown[0] as Product & { $id: string }); setQ(""); } } }} />{q && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted" aria-label="Effacer la recherche" onClick={() => setQ("")}><X size={16} /></button>}</div>
        <button className="btn" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine /></button>
      </div>
      {pro && <div className="flex items-center gap-2 text-xs text-muted"><button className="chip" aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)}>★ Favoris ({favs.ids.length})</button><button className="chip" onClick={dens.toggle}>{dens.density === "compact" ? "Cartes larges" : "Cartes compactes"}</button><span className="hidden sm:inline">F2 recherche · F4 encaisser · F8 vider</span></div>}
      {pro && <SuggestStrip data={sugg.data} hasCart={cart.length > 0} onAdd={(id) => { const p = (products.data ?? []).find((x) => x.$id === id); if (p) add(p as Product & { $id: string }); }} />}
      {categories.length > 0 && <div className="scroll-x"><button className="chip" aria-current={!cat} onClick={() => setCat("")}>Tout</button>{categories.map((c) => <button key={c} className="chip" aria-current={cat === c} onClick={() => setCat(cat === c ? "" : c)}>{c}</button>)}</div>}
      {products.isLoading && <div className="grid grid-cols-2 gap-2" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-24 animate-pulse bg-subtle" />)}</div>}
      {products.error && <p className="text-bad text-sm" role="alert">Impossible de charger le catalogue : {(products.error as Error).message} <button className="underline" onClick={() => void products.refetch()}>Réessayer</button></p>}
      <div className={`grid gap-2 ${dens.density === "compact" ? "grid-cols-3" : "grid-cols-2"}`}>
        {shown.map((p) => {
          const n = qtyOf(stock.data, p); const tracked = !p.hasVariants && !isVirtualBundle(p); const out = tracked && n <= 0;
          return (
            <button key={p.$id} disabled={out} onClick={() => add(p as Product & { $id: string })} className="card text-left flex gap-2 items-start disabled:opacity-40">
              <Thumb id={p.imageFileId} size={48} className="shrink-0" />
              <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-1 font-medium leading-tight"><span>{p.name}</span>{pro && <FavStar on={favs.ids.includes(p.$id)} name={p.name} onClick={() => favs.toggle(p.$id)} />}</span>
              <span className="block text-accent-text">{p.hasVariants ? `dès ${formatFcfa(Math.min(...(variantsOf(p.$id).length ? variantsOf(p.$id).map((v) => v.price) : [p.price])))}` : formatFcfa(p.price)}</span>{p.hasVariants && <span className="block text-xs text-muted">Choisir une variante</span>}
              <span className={`block text-xs ${out ? "text-bad" : n <= (p.minStock ?? 0) ? "text-warn" : "text-muted"}`}>{out ? "Rupture" : `Stock ${formatQty(n)}${(p.unit ?? "piece") !== "piece" ? ` ${unitLabel(p.unit).toLowerCase()}` : ""}`}</span></span>
            </button>
          );
        })}
        {!products.isLoading && shown.length === 0 && <p className="col-span-2 text-muted text-center py-6">{(products.data ?? []).length ? "Aucun article ne correspond à la recherche." : "Aucun produit. Ajoutez-en dans Stock."}</p>}
      </div>
      {cart.length > 0 && (
        <section className="card flex flex-col gap-2">
          {priced.map((l, i) => (
            <div key={l.key} className="flex items-center justify-between gap-2">
              <span className="flex-1 min-w-0"><span className="block truncate">{l.name}</span><span className="text-xs text-muted">{l.unit ? `${formatQty(l.unitQty!)} ${unitLabel(l.unit).toLowerCase()} = ${formatQty(l.qty)} · ` : ""}{pv?.lines[i]?.promo ? <><s className="text-muted">{formatFcfa(pv.lines[i]!.baseAmount ?? 0)}</s> <b className="text-ok">−{formatFcfa(pv.lines[i]!.promo!.discount)} → {formatFcfa(pv.lines[i]!.amount)}</b></> : formatFcfa(l.amount)}{pv?.lines[i]?.promo && <span className="block text-ok">Promotion : {pv.lines[i]!.promo!.name}{pv.lines[i]!.promo!.code ? ` (${pv.lines[i]!.promo!.code})` : ""}</span>}{l.source !== "base" && <b className="ml-1 text-ok">· {l.source === "promo" ? "Promo" : l.source === "category" ? `Tarif ${categoryLabel(customer?.category).toLowerCase()}` : "Prix par quantité"}</b>}</span></span>
              {l.serials ? <><span className="text-xs text-muted max-w-[8rem] truncate" title={l.serials.join(", ")}>N° {l.serials.join(", ")}</span><button className="btn-ghost !p-2" aria-label="Retirer" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}><Minus size={16} /></button></> : <>
              <button className="btn-ghost !p-2" aria-label="Moins" onClick={() => step(l.key, -1)}><Minus size={16} /></button>
              <span className="min-w-8 text-center">{formatQty(l.unit ? l.unitQty! : l.qty)}</span>
              <button className="btn-ghost !p-2" aria-label="Plus" onClick={() => step(l.key, 1)}><Plus size={16} /></button>{(manager || pro) && <input className="input !w-14 !py-1 !px-1 text-center text-xs" inputMode="numeric" aria-label={`Remise ${l.name} (%)`} placeholder="%" value={l.discountPct ? String(l.discountPct) : ""} onChange={(e) => { const v = Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0); setCart((c) => c.map((x) => (x.key === l.key ? { ...x, discountPct: v } : x))); }} />}</>}
            </div>
          ))}
          {promoOn && <>
            {pv && pv.discountTotal > 0 && <p className="text-sm text-ok" role="status">Remises : −{formatFcfa(pv.discountTotal)} ({pv.promotions.map((p) => (p.code ? `${p.name} · ${p.code}` : p.name)).join(", ")})</p>}
            {proOn && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setCoupon(couponIn.trim().toUpperCase()); }}><input className="input flex-1 !py-2" aria-label="Coupon" autoCapitalize="characters" placeholder="Coupon (facultatif)" value={couponIn} onChange={(e) => setCouponIn(e.target.value)} /><button className="btn-ghost !py-2" type="submit">Appliquer</button>{coupon && <button className="btn-ghost !py-2" type="button" onClick={() => { setCoupon(""); setCouponIn(""); }}>Retirer</button>}</form>}
            {pv?.coupon && <p className={`text-xs ${pv.coupon.ok && pv.coupon.applied ? "text-ok" : "text-warn"}`} role="status">{pv.coupon.ok && !pv.coupon.applied ? `${pv.coupon.message}, mais la campagne liée ne s'applique pas à ce panier` : pv.coupon.message}</p>}
            {pv && !!pv.decisions?.length && <details className="text-xs text-muted"><summary className="cursor-pointer">Pourquoi ces remises ? ({pv.decisions.length})</summary><ul className="pt-1 flex flex-col gap-0.5">{pv.decisions.map((d) => <li key={d.promoId + d.outcome}><span className={d.outcome === "applied" ? "text-ok" : "text-muted"}>{d.outcome === "applied" ? "✓" : "✗"} {d.name}</span> — {d.message}</li>)}{(pv.notes ?? []).map((n) => <li key={n}>ℹ {n}</li>)}</ul></details>}
            {preview.isError && <p className="text-xs text-warn">Aperçu des promotions indisponible : {(preview.error as Error).message}</p>}
          </>}
          {pro && <SimPanel sim={simD} manager={manager} approvals={approvals} pending={asked} onRequest={(k) => void requestApproval(k)} busy={askBusy} />}
          <CustomerPick customers={customers.data ?? []} value={customerId} onChange={(id) => { setCustomerId(id); setMsg(""); }} q={custQ} setQ={setCustQ} loading={customers.isLoading} />
          <PayPanel total={total} lines={payLines} onChange={(l) => { setPayLines(l); setMsg(""); }} voucherOk={pro} onCheckVoucher={(code) => api<{ balance: number; usable: boolean; reason: string }>(s, "voucher.check", { code, customerId: customerId || undefined }).then((v) => (v.usable ? `Bon valable : solde ${formatFcfa(v.balance)}` : `Bon inutilisable : ${v.reason}`)).catch((e: Error) => e.message)} hasCustomer={!!customer} credit={customer ? { balance: customer.creditBalance ?? 0, limit: customer.creditLimit ?? 0 } : undefined} qrConfigured={qrConfigured} onQr={(id) => (navigator.onLine ? setQrLine(id) : setMsg("Le QR nécessite une connexion"))} disabled={busy} />
          <button className="btn text-lg disabled:opacity-40" disabled={waiting || busy || !payState.ok || needSession || blockedSim} onClick={checkout}>{waiting ? "Calcul des remises…" : `Encaisser ${formatFcfa(total)}`}</button>
          {needSession && <p className="text-xs text-warn text-center">Caisse fermée : <Link to="/caisse" className="underline">ouvrir la caisse</Link> pour vendre.</p>}
        </section>
      )}
      {msg && <p className="text-center text-warn">{msg}</p>}
      {lastId && cart.length === 0 && <p className={`text-center text-sm ${lastSync?.status === "synced" ? "text-ok" : lastSync?.status === "rejected" ? "text-bad" : "text-warn"}`} role="status" data-sync={lastSync?.status ?? "pending"}>{lastSync?.status === "synced" ? `✓ Vente confirmée par le serveur${lastSync.number ? ` (n° ${lastSync.number})` : ""}` : lastSync?.status === "rejected" ? `✗ Vente refusée par le serveur : ${lastSync.error} — voir les ventes en attente` : navigator.onLine ? "⏳ En attente de synchronisation : le serveur n'a pas encore confirmé cette vente" : "⏳ Hors ligne — vente conservée sur cet appareil, en attente de synchronisation"}</p>}
      {last && cart.length === 0 && <div className="grid grid-cols-2 gap-2">{([80, 58] as const).map((w) => <button key={w} className="btn-ghost text-sm" onClick={() => void pdfBlob(receiptModel(last, shop.data ?? null, lastName, { verifyCode: lastSync?.status === "synced" ? lastSync.verifyCode : undefined, pending: lastSync?.status !== "synced" }), w).then((b) => deliverPdf(b, `${last.number}-${w}mm.pdf`))}>Ticket {w} mm</button>)}</div>}
      {qrLine && (() => { const ln = payLines.find((x) => x.id === qrLine); return ln && (ln.method === "wave" || ln.method === "orange") ? <QrPay session={s} provider={ln.method} amount={Number(ln.amount.replace(/\s/g, ""))} onPaid={(id) => { setPayLines((ls) => ls.map((x) => (x.id === qrLine ? { ...x, linkId: id } : x))); setQrLine(null); }} onCancel={() => setQrLine(null)} /> : null; })()}
      {confirm && <Confirm text={`Valider la vente de ${formatFcfa(total)} ? ${payLines.map((l) => `${METHOD_LABEL[l.method]} ${formatFcfa(Number(l.amount.replace(/\s/g, "")) || 0)}`).join(" + ")}${payState.change ? ` · monnaie à rendre ${formatFcfa(payState.change)}` : ""}${customer ? ` · client ${customer.name}` : ""}. Le stock sera décrémenté à la confirmation.`} confirmLabel={busy ? "Validation…" : "Valider la vente"} onNo={() => setConfirm(false)} onYes={() => void submit()} />}
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
    <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-end justify-center p-4" role="dialog" aria-modal="true" aria-label="Quantité">
      <form className="card w-full max-w-sm flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); try { onAdd(qty, unit); } catch (x) { setErr((x as Error).message); } }}>
        <b>{v ? `${p.name} — ${v.label}` : p.name}</b>
        {units.length > 0 && <div className="flex gap-2 flex-wrap">{[{ unit: "", label: unitLabel(p.unit) }, ...units.map((x) => ({ unit: x.unit, label: unitLabel(x.unit) }))].map((x) => <button type="button" key={x.unit} className="chip" aria-current={unit === x.unit} onClick={() => setUnit(x.unit)}>{x.label}</button>)}</div>}
        <input className="input" inputMode="decimal" autoFocus placeholder={`Quantité en ${unitLabel(unit ? unit : p.unit).toLowerCase()}`} value={qty} onChange={(e) => { setQty(e.target.value); setErr(""); }} />
        {ok && <p className="text-sm text-muted">{unit ? `= ${formatQty(base)} ${unitLabel(p.unit).toLowerCase()} · ` : ""}{formatFcfa(Math.round((v ? v.price : p.price) * base * 1e6) / 1e6)}</p>}
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}
        <div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={onClose}>Annuler</button><button className="btn flex-1" disabled={!ok}>Ajouter</button></div>
      </form>
    </div>
  );
}

/** Choix de la variante d'un article décliné : prix et stock de chacune, les ruptures restent visibles mais non vendables. */
function VariantDialog({ p, variants, levels, onClose, onPick }: { p: Product & { $id: string }; variants: VariantRow[]; levels?: Map<string, number>; onClose: () => void; onPick: (v: VariantRow) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-end justify-center p-4" role="dialog" aria-modal="true" aria-label="Variante">
      <div className="card w-full max-w-sm flex flex-col gap-2 max-h-[80vh] overflow-y-auto">
        <b>{p.name}</b><p className="text-sm text-muted">Choisissez la variante :</p>
        {variants.length === 0 && <p className="text-sm text-muted">Aucune variante active.</p>}
        {variants.map((v) => { const n = variantQty(levels, v, scaleOf(p)); return (
          <button key={v.$id} className="btn-ghost flex justify-between items-center text-left !py-3 disabled:opacity-40" disabled={n <= 0} onClick={() => onPick(v)}>
            <span><span className="block font-medium">{v.label}</span><span className="text-xs text-muted">{n > 0 ? `${formatQty(n)} en stock` : "Rupture"}</span></span><span className="text-accent-text font-bold">{formatFcfa(v.price)}</span>
          </button>); })}
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}

/** Recherche d'un client existant (nom ou téléphone) ; « Client comptoir » par défaut. */
function CustomerPick({ customers, value, onChange, q, setQ, loading }: { customers: (Customer & { $id: string })[]; value: string; onChange: (id: string) => void; q: string; setQ: (v: string) => void; loading: boolean }) {
  const cur = customers.find((c) => c.$id === value); const hits = q.trim() ? customers.filter((c) => `${c.name} ${c.phone ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 5) : [];
  return (
    <div className="flex flex-col gap-1">
      {cur ? <div className="card !py-2 flex items-center justify-between text-sm"><span>Client : <b>{cur.name}</b>{cur.phone ? <span className="text-muted"> · {cur.phone}</span> : null}{(cur.creditBalance ?? 0) > 0 ? <span className="text-warn block text-xs">Dette actuelle {formatFcfa(cur.creditBalance ?? 0)}</span> : null}</span><button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => { onChange(""); setQ(""); }}>Retirer</button></div>
        : <input className="input" aria-label="Rechercher un client" placeholder={loading ? "Chargement des clients…" : "Client comptoir — rechercher un client (nom, téléphone)"} value={q} onChange={(e) => setQ(e.target.value)} />}
      {!cur && hits.map((c) => <button key={c.$id} className="btn-ghost !py-2 text-left text-sm flex justify-between" onClick={() => { onChange(c.$id); setQ(""); }}><span>{c.name}</span><span className="text-muted text-xs">{c.phone ?? ""}</span></button>)}
      {!cur && q.trim() && !hits.length && <p className="text-xs text-muted">Aucun client trouvé.</p>}
    </div>
  );
}
