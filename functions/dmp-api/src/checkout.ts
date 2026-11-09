import { createHash } from "node:crypto";
import { cartTotal, isQrMethod, settle, toFcfa, type CartLine, type Payment, type PaymentMethod } from "../../../src/domain/money";
import { canExtendCredit } from "../../../src/domain/credit";
import { DEFAULT_RULES, earnedPoints, redeemablePoints, tierFor } from "../../../src/domain/loyalty";
import { saleJournal } from "../../../src/domain/accounting";
import { stockOf, type StockMove } from "../../../src/domain/stock";
import { convertQty, fromScaled, qtyFor, scaleOf, scaledInt, unitRowId } from "../../../src/domain/quantity";
import { planAllows } from "../../../src/domain/features";
import { entitlementOf } from "./subscriptions";
import { resolvePrice } from "../../../src/domain/pricing";
import { loadRules } from "./pricing";
import { allocateFefo, parseSerials, trackingOf, warrantyEnd } from "../../../src/domain/tracking";
import { expiredPolicyOf, lotsWithStock, serialRowId } from "./tracking";
import { isVirtualBundle } from "../../../src/domain/bundles";
import { loadComponents } from "./bundles";
import { evaluateForSale, recordUsage, releaseUsage, useCoupon, releaseCoupon, logInvalidCoupon, type CouponCheck } from "./promotions";
import type { Decision, EvalResult, Promo } from "../../../src/domain/promotions";
import { HttpError, need, type Ctx, type Row, type Store, needModule } from "./store";

type PromoPart = { id: string; name: string; code?: string; kind: string; value: number; family?: string; discount: number };
type PromoSnap = PromoPart;
export type CheckoutInput = {
  clientId: string; soldAt?: string; customerId?: string; redeemPoints?: number;
  lines: { productId: string; variantId?: string; qty: number | string; unit?: string; discountPct?: number; serials?: unknown }[];
  payments: (Payment & { linkId?: string })[];
  /** Aperçu : calcule prix, promotions et total comme une vraie vente, sans rien écrire. */ dryRun?: boolean; /** Coupon saisi à la caisse (Pro). */ couponCode?: string;
};
const moveId = (saleId: string, ...parts: number[]): string => `m${createHash("sha1").update(`${saleId}|${parts.join("|")}`).digest("hex").slice(0, 30)}`; // identifiant déterministe ≤ 36 caractères
const MAX_FUTURE_MS = 10 * 60_000, MAX_AGE_MS = 45 * 86_400_000;
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);

/** Somme brute des mouvements : entiers à l'échelle de l'article (sous-unités). */
export async function stockScaled(store: Store, productId: string): Promise<number> {
  const { rows: moves } = await store.scan("stock_moves", { productId }, { maxRows: 200_000 }); // lecture paginée : jamais tronquée en silence
  return stockOf(moves.map((m) => ({ productId, qty: Number(m.qty), kind: m.kind as StockMove["kind"] })));
}
/** Stock brut d'UNE variante (entiers de sous-unités). */
export async function stockScaledVariant(store: Store, variantId: string): Promise<number> {
  const { rows } = await store.scan("stock_moves", { variantId }, { maxRows: 200_000 });
  return stockOf(rows.map((m) => ({ productId: variantId, qty: Number(m.qty), kind: m.kind as StockMove["kind"] })));
}
/** Stock lisible (décimal) d'un article. `scale` évite une lecture si l'appelant a déjà la fiche. */
export async function stockFor(store: Store, productId: string, scale?: number): Promise<number> {
  const sc = scale ?? scaleOf(await store.get("products", productId));
  return fromScaled(await stockScaled(store, productId), sc);
}

/** Vente atomique côté serveur : prix et stock lus en base, jamais fournis par le client. */
export async function checkout(store: Store, ctx: Ctx, input: CheckoutInput) {
  needModule(ctx, "pos");
  if (!input.lines?.length) throw new HttpError(400, "Panier vide");
  if (input.dryRun) input = { ...input, clientId: `dry${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 36), payments: [] };
  if (!input.clientId) throw new HttpError(400, "Panier vide");
  const saleId = safeId(input.clientId);
  if (saleId.length < 8) throw new HttpError(400, "clientId invalide");

  const existing = await store.get("sales", saleId);
  if (existing && existing.status === "paid") return { saleId, number: existing.number, duplicate: true };
  if (existing && (existing.tenantId !== ctx.tenantId || existing.shopId !== ctx.shopId)) throw new HttpError(409, "Identifiant déjà utilisé");

  // La date vient du téléphone (vente faite hors ligne) : on la borne pour qu'elle ne puisse fausser ni les rapports ni la comptabilité.
  const nowMs = Date.now();
  let soldAt = existing?.soldAt ? new Date(String(existing.soldAt)).toISOString() : new Date(nowMs).toISOString(); // reprise : on garde la date d'origine (les tarifs en dépendent)
  if (input.soldAt && !existing) {
    const ms = Date.parse(input.soldAt);
    if (Number.isNaN(ms) || ms > nowMs + MAX_FUTURE_MS || ms < nowMs - MAX_AGE_MS) throw new HttpError(400, "Date de vente invalide (ni dans le futur, ni de plus de 45 jours)");
    soldAt = new Date(ms).toISOString();
  }
  // Client (catégorie tarifaire) : lu avant les lignes, car le prix d'une ligne en dépend
  const customer = input.customerId ? await store.get("customers", input.customerId) : null;
  if (input.customerId && (!customer || customer.tenantId !== ctx.tenantId || customer.shopId !== ctx.shopId)) throw new HttpError(404, "Client introuvable");
  const category = String(customer?.category ?? "");
  let tiered: boolean | undefined; // tarifs avancés : fonction Pro (retour en Business : on repasse au prix de base)

  // 1) Prix et stock vérifiés en base
  const lines: (CartLine & { unitCost?: number; unit?: string; unitQty?: number; factor?: number; variantId?: string; priceSource?: string; priceRuleId?: string; basePrice?: number; lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[]; components?: { productId: string; variantId?: string; name: string; qty: number; perBundle: number; unitCost: number; lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[] }[]; promo?: PromoSnap; promos?: PromoPart[]; couponRef?: { id: string; code: string }; baseAmount?: number })[] = [];
  const pcat = new Map<string, string>(); const psku = new Map<string, string>(); const scales = new Map<string, number>(); const seenKeys = new Set<string>();
  let packagingOk: boolean | undefined; let promoOn: boolean | undefined;
  const demand = new Map<string, number>(); const takenSerials = new Set<string>(); let bundlesOk: boolean | undefined;
  const prevLines: { lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[]; components?: { productId: string; variantId?: string; name: string; qty: number; perBundle: number; unitCost: number; lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[] }[] }[] = (() => { try { return existing ? JSON.parse(String(existing.lines)) : []; } catch { return []; } })();
  const today = soldAt.slice(0, 10); let policy: Awaited<ReturnType<typeof expiredPolicyOf>> | undefined; const reserved = new Map<string, number>(); const serialRows = new Map<string, Row>();
  /** Affecte le stock d'un article (ou variante) pour `qty` unités lisibles : lots en FEFO, numéros de série (donnés ou les plus anciens disponibles), ou simple vérification du stock.
   *  `demand` cumule les besoins de toute la vente (lignes et composants de bundles) ; une reprise (`existing`) réutilise l'affectation déjà enregistrée. */
  const allocate = async (p: Row, v: Row | null, variantId: string, qty: number, scale: number, prev: { lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[] } | undefined, givenSerials: unknown, soldUnit: string): Promise<{ lots?: { lotId: string; lotNo: string; qty: number; unitCost: number }[]; serials?: string[]; trackedCost?: number }> => {
    const mode = trackingOf(p); let lots: { lotId: string; lotNo: string; qty: number; unitCost: number }[] | undefined; let serials: string[] | undefined; let trackedCost: number | undefined;
    const dkey = `${p.$id}|${variantId}`;
    if (mode === "lot") {
      if (existing) lots = (prev?.lots ?? []).map((x) => ({ ...x, unitCost: 0 }));
      else {
        policy ??= await expiredPolicyOf(store, ctx);
        const stocks = (await lotsWithStock(store, ctx, p.$id, variantId)).map((x) => ({ id: x.id, qty: x.qty - (reserved.get(x.id) ?? 0), expiresAt: x.row.expiresAt ? String(x.row.expiresAt) : null, receivedAt: x.row.receivedAt ? String(x.row.receivedAt) : "", status: String(x.row.status ?? "active"), lotNo: String(x.row.lotNo), cost: Number(x.row.unitCost ?? 0) }));
        const need = scaledInt(qty, scale), fefo = allocateFefo(stocks, need, today, policy);
        if (fefo.shortage > 0) { const avail = fromScaled(need - fefo.shortage, scale); throw new HttpError(409, `Stock insuffisant : ${p.name}${v ? ` — ${v.label}` : ""} (${avail} vendable${fefo.expiredQty ? `, ${fromScaled(fefo.expiredQty, scale)} périmé(s)` : ""}${fefo.blockedQty ? `, ${fromScaled(fefo.blockedQty, scale)} bloqué(s)` : ""})`); }
        lots = fefo.allocations.map((a) => { const st = stocks.find((x) => x.id === a.lotId)!; reserved.set(a.lotId, (reserved.get(a.lotId) ?? 0) + a.qty); return { lotId: a.lotId, lotNo: st.lotNo, qty: fromScaled(a.qty, scale), unitCost: st.cost }; });
        const tot = lots.reduce((a, x) => a + x.qty, 0), known = lots.reduce((a, x) => a + x.qty * (x.unitCost > 0 ? x.unitCost : Number((v ?? p).cost ?? 0)), 0);
        if (tot > 0 && known > 0) trackedCost = known / tot; // coût figé = coût moyen des lots réellement sortis
      }
    } else if (mode === "serial") {
      if (soldUnit) throw new HttpError(400, `${p.name} : un article suivi par numéro de série se vend à l'unité`);
      const given = (() => { if (existing || givenSerials === undefined || givenSerials === null || (Array.isArray(givenSerials) && !givenSerials.length) || String(givenSerials).trim() === "") return null; try { return parseSerials(givenSerials); } catch (e) { throw new HttpError(400, `${p.name} : ${(e as Error).message}`); } })();
      if (existing) serials = prev?.serials ?? [];
      else if (given) serials = given;
      else { // attribution automatique : les plus anciennes unités disponibles d'abord (le caissier n'a rien à mémoriser)
        if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, `${p.name} : quantité invalide`);
        const taken = takenSerials;
        const pool = (await store.scan("article_serials", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, status: "available" }, { maxRows: 5000 })).rows
          .filter((r) => String(r.variantId ?? "") === variantId && !taken.has(String(r.serial))).sort((a, b) => String(a.receivedAt ?? "").localeCompare(String(b.receivedAt ?? "")) || String(a.serial).localeCompare(String(b.serial)));
        if (pool.length < qty) throw new HttpError(409, `Stock insuffisant : ${p.name}${v ? ` — ${v.label}` : ""} (${pool.length} unité${pool.length > 1 ? "s" : ""} disponible${pool.length > 1 ? "s" : ""})`);
        serials = pool.slice(0, qty).map((r) => String(r.serial));
      }
      if (serials.length !== qty) throw new HttpError(400, `${p.name} : indiquez exactement ${qty} numéro${qty > 1 ? "s" : ""} de série`);
      if (!existing) {
        let sum = 0;
        for (const sn of serials) {
          const row = await store.get("article_serials", serialRowId(p.$id, sn));
          if (!row || row.tenantId !== ctx.tenantId || row.shopId !== ctx.shopId || row.productId !== p.$id || String(row.variantId ?? "") !== variantId) throw new HttpError(404, `Numéro de série inconnu : ${sn}`);
          if (row.status !== "available") throw new HttpError(409, `Numéro de série indisponible : ${sn} (${row.status})`);
          serialRows.set(sn, row); sum += Number(row.unitCost ?? 0) > 0 ? Number(row.unitCost) : Number((v ?? p).cost ?? 0);
        }
        if (sum > 0) trackedCost = sum / serials.length;
      }
      for (const sn of serials) takenSerials.add(sn);
    } else if (!existing) { // le stock a déjà été décrémenté lors d'une reprise
      const have = v ? fromScaled(await stockScaledVariant(store, v.$id), scale) : await stockFor(store, p.$id, scale);
      const already = demand.get(dkey) ?? 0; // le même article peut figurer sur plusieurs lignes ou dans des bundles : cumul
      if (have < already + qty) throw new HttpError(409, `Stock insuffisant : ${p.name}${v ? ` — ${v.label}` : ""} (${have})`);
      demand.set(dkey, already + qty);
    }
    return { lots, serials, trackedCost };
  };
  for (const [li, l] of input.lines.entries()) {
    const p = await store.get("products", l.productId);
    if (!p || p.tenantId !== ctx.tenantId || p.shopId !== ctx.shopId || p.archived) throw new HttpError(404, "Produit introuvable");
    pcat.set(p.$id, String(p.category ?? "")); if (p.sku) psku.set(p.$id, String(p.sku));
    if (isVirtualBundle(p)) { // bundle virtuel : prix propre, sort ses composants du stock (aucun stock propre)
      if (l.variantId) throw new HttpError(400, `${p.name} n'a pas de variantes`);
      if (l.unit && l.unit !== (p.unit || "piece")) throw new HttpError(400, `${p.name} : un bundle se vend à la pièce`);
      bundlesOk ??= planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "bundles");
      if (!bundlesOk) throw new HttpError(402, "Les bundles sont réservés à la formule Pro.");
      const bkey = `${p.$id}||`; if (seenKeys.has(bkey)) throw new HttpError(400, `Ligne en double : ${p.name}`); seenKeys.add(bkey);
      let bq: number; try { bq = qtyFor(l.qty, 0); } catch (e) { throw new HttpError(400, `${p.name} : ${(e as Error).message}`); }
      type Comp = { productId: string; variantId?: string; name: string; qty: number; perBundle: number; unitCost: number; lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[] };
      let comps: Comp[];
      if (existing) comps = (prevLines[li]?.components ?? []) as Comp[]; // reprise : la composition et les affectations figées à la vente font foi
      else {
        const defs = await loadComponents(store, ctx, p.$id);
        if (!defs.length) throw new HttpError(409, `${p.name} : bundle sans composants`);
        comps = [];
        for (const d of defs) { // chaque composant passe par la même affectation qu'une ligne de vente : variante, lots FEFO, numéros de série, stock cumulé
          const cp = d.product, cv = d.variant;
          if (!cp || cp.archived || (d.variantId && (!cv || cv.archived))) throw new HttpError(409, `${p.name} : un composant n'est plus disponible (modifiez le bundle)`);
          const csc = scaleOf(cp); scales.set(cp.$id, csc); const total = fromScaled(d.qtyScaled * bq, csc);
          const al = await allocate(cp, cv, d.variantId, total, csc, undefined, undefined, "").catch((e) => { throw e instanceof HttpError && e.status === 409 ? new HttpError(409, `${p.name} : composant — ${e.message}`) : e; });
          comps.push({ productId: cp.$id, ...(d.variantId ? { variantId: d.variantId } : {}), name: cv ? `${cp.name} — ${cv.label}` : String(cp.name), qty: total, perBundle: d.qty, unitCost: al.trackedCost ?? Number((cv ?? cp).cost ?? 0), ...(al.lots?.length ? { lots: al.lots.map((x) => ({ lotId: x.lotId, lotNo: x.lotNo, qty: x.qty })) } : {}), ...(al.serials?.length ? { serials: al.serials } : {}) });
        }
      }
      const bDisc = Number(l.discountPct ?? 0); if (bDisc > 0) need(ctx, "manager");
      const bcost = Math.round(comps.reduce((a, c) => a + c.unitCost * c.perBundle, 0));
      tiered ??= planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "tieredPricing");
      const brules = tiered ? await loadRules(store, ctx, p.$id, "") : [];
      const bprice = resolvePrice(brules, { basePrice: Number(p.price), unit: "", factor: undefined, qty: bq, baseQty: bq, customerCategory: category, at: soldAt });
      lines.push({ productId: p.$id, name: String(p.name), unitPrice: bprice.unitPrice, amount: bprice.amount, qty: bq, discountPct: bDisc, ...(bcost > 0 ? { unitCost: bcost } : {}), components: comps, ...(bprice.source !== "base" ? { priceSource: bprice.source, priceRuleId: bprice.ruleId, basePrice: Number(p.price) } : {}) });
      continue;
    }
    const scale = scaleOf(p); scales.set(p.$id, scale);
    // Article décliné : la vente porte sur UNE variante (prix, coût, stock propres). Les ventes d'un article simple ne peuvent pas citer de variante.
    const variantId = l.variantId ? String(l.variantId) : "";
    let v: Awaited<ReturnType<Store["get"]>> = null;
    if (p.hasVariants) {
      if (!variantId) throw new HttpError(400, `Choisissez une variante pour ${p.name}`);
      v = await store.get("article_variants", variantId);
      if (!v || v.tenantId !== ctx.tenantId || v.shopId !== ctx.shopId || v.productId !== p.$id || v.archived) throw new HttpError(404, `Variante introuvable : ${p.name}`);
    } else if (variantId) throw new HttpError(400, `${p.name} n'a pas de variantes`);
    // Quantité : dans l'unité de vente choisie (l'unité de base par défaut) ; convertie en unité de base, sans reste.
    const soldUnit = l.unit && l.unit !== (p.unit || "piece") ? String(l.unit) : "";
    let qty: number, unitQty: number | undefined, factor: number | undefined;
    try {
      if (soldUnit) {
        // Conditionnements : fonction Pro. Après un retour à Business, la vente à l'unité de base reste possible, pas les conversions.
        packagingOk ??= planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "packaging");
        if (!packagingOk) throw new HttpError(402, "Les conditionnements (carton, paquet…) sont réservés à la formule Pro.");
        const u = await store.get("article_units", unitRowId(p.$id, soldUnit));
        if (!u || u.productId !== p.$id || u.active === false) throw new HttpError(400, `Unité « ${soldUnit} » non définie pour ${p.name}`);
        unitQty = qtyFor(l.qty, 3); factor = Number(u.factor); qty = convertQty(unitQty, factor, scale);
      } else qty = qtyFor(l.qty, scale);
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, `${p.name} : ${(e as Error).message}`); }
    const key = `${p.$id}|${soldUnit}|${variantId}`; if (seenKeys.has(key)) throw new HttpError(400, `Ligne en double : ${p.name}`); seenKeys.add(key);
    const al = await allocate(p, v, variantId, qty, scale, prevLines[li], l.serials, soldUnit);
    const lots = al.lots, serials = al.serials, trackedCost = al.trackedCost;
    // Remise > 0 réservée aux managers
    const discountPct = Number(l.discountPct ?? 0);
    if (discountPct > 0) need(ctx, "manager");
    // Le coût du moment est figé sur la vente (la marge d'un rapport ne bouge pas quand le coût moyen change plus tard).
    // Un coût non renseigné (0) n'est PAS figé : sinon la marge afficherait 100 % sur ce produit.
    const cost = trackedCost ?? Number((v ?? p).cost ?? 0);
    // Prix : base de l'article/variante, ou règle de tarification gagnante. Le prix retenu et sa source sont figés dans la ligne.
    tiered ??= planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "tieredPricing");
    const rules = tiered ? await loadRules(store, ctx, p.$id, v?.$id ?? "") : [];
    const price = resolvePrice(rules, { basePrice: Number((v ?? p).price), unit: soldUnit, factor, qty: soldUnit ? unitQty! : qty, baseQty: qty, customerCategory: category, at: soldAt });
    lines.push({ productId: p.$id, name: v ? `${p.name} — ${v.label}` : p.name, unitPrice: price.unitPrice, amount: price.amount, qty, ...(v ? { variantId: v.$id } : {}), discountPct, ...(cost > 0 ? { unitCost: cost } : {}), ...(soldUnit ? { unit: soldUnit, unitQty, factor } : {}), ...(lots?.length ? { lots: lots.map((x) => ({ lotId: x.lotId, lotNo: x.lotNo, qty: x.qty })) } : {}), ...(serials?.length ? { serials } : {}), ...(price.source !== "base" ? { priceSource: price.source, priceRuleId: price.ruleId, basePrice: Number((v ?? p).price) } : {}) });
  }
  // Promotions : calculées ICI, à la date de la vente, par le moteur partagé (Business : remises simples ; Pro : familles avancées, cumul, coupon, ciblage, budgets).
  // Jamais cumulées avec un prix de tarification spécial ni une remise manuelle. Une reprise réutilise l'instantané déjà figé dans la vente : une vente confirmée n'est jamais recalculée.
  type Applied = EvalResult["applied"][number];
  let promoApplied: Applied[] = []; let promoMeta: Map<string, { id: string; usageLimit?: number; usageCount: number; code?: string; budget?: number; storeBudget?: number }> = new Map();
  let promoDecisions: Decision[] = []; let promoNotes: string[] = []; let couponInfo: (CouponCheck & { coupon?: Record<string, unknown> & { $id: string } }) | undefined; const promoById = new Map<string, Promo>(); let couponRef: { id: string; code: string } | undefined; let promoPro = false;
  const metaOf = (pr: Record<string, unknown> | null | undefined, id: string, code?: string, storeBudget?: number) => ({ id, usageLimit: pr?.usageLimit == null ? undefined : Number(pr.usageLimit), usageCount: Number(pr?.usageCount ?? 0), code, budget: pr?.budget == null ? undefined : Number(pr.budget), storeBudget });
  if (existing) {
    for (const [i, l] of lines.entries()) { const pr = (prevLines[i] as { promo?: PromoSnap; promos?: PromoPart[]; couponRef?: { id: string; code: string }; baseAmount?: number; amount?: number } | undefined); if (pr?.promo) { l.promo = pr.promo; l.promos = pr.promos ?? [pr.promo]; l.baseAmount = pr.baseAmount; l.amount = pr.amount; if (pr.couponRef) couponRef = pr.couponRef; } }
    const by = new Map<string, Applied>();
    for (const [i, l] of lines.entries()) for (const pt of l.promos ?? []) { const a = by.get(pt.id) ?? { promoId: pt.id, name: pt.name, ...(pt.code ? { code: pt.code } : {}), family: (pt.family ?? "simple") as Applied["family"], discount: 0, lineIndexes: [] }; a.discount += pt.discount; a.lineIndexes.push(i); by.set(pt.id, a); }
    promoApplied = [...by.values()];
    for (const a of promoApplied) { const pr = await store.get("promotions", a.promoId); promoMeta.set(a.promoId, metaOf(pr, a.promoId, a.code)); }
  } else {
    const planId = (await entitlementOf(store, ctx.tenantId)).plan.id; promoOn ??= planAllows(planId, "promotions"); promoPro = planAllows(planId, "promotionsPro");
    if (input.couponCode && !promoPro) throw new HttpError(402, "Les coupons sont réservés à la formule Pro.");
    if (promoOn) {
      const ev = await evaluateForSale(store, ctx, lines.map((l, i) => ({ index: i, productId: l.productId, keys: [...(l.variantId ? [l.variantId] : []), ...(psku.get(l.productId) ? [`sku:${psku.get(l.productId)}`] : [])], category: pcat.get(l.productId), qty: l.qty, baseAmount: Number(l.amount ?? Math.round(l.unitPrice * l.qty)), unitCost: l.unitCost, eligible: !(Number(l.discountPct ?? 0) > 0) && (!l.priceSource || l.priceSource === "base") })), { customerId: customer?.$id, now: new Date(soldAt), couponCode: input.couponCode, pro: promoPro });
      couponInfo = ev.coupon; for (const p of ev.promos) promoById.set(p.id, p);
      if (input.couponCode && ev.coupon && !ev.coupon.ok && !input.dryRun) { await logInvalidCoupon(store, ctx, ev.coupon, customer?.$id); throw new HttpError(409, ev.coupon.message); }
      for (const r of ev.lines) if (r.discount > 0 && r.parts.length) { const l = lines[r.index]!; const base = Number(l.amount ?? Math.round(l.unitPrice * l.qty)); l.baseAmount = base; l.amount = base - r.discount;
        l.promos = r.parts.map((pt) => { const pr = promoById.get(pt.promoId)!; return { id: pr.id, name: pr.name, ...(pr.code ? { code: pr.code } : {}), kind: pr.kind, value: pr.value, family: pr.family ?? "simple", discount: pt.discount }; }); l.promo = { ...l.promos[0]!, discount: r.discount }; }
      promoApplied = ev.applied; promoDecisions = ev.decisions; promoNotes = ev.notes;
      promoMeta = new Map(ev.promos.map((x) => [x.id, metaOf({ usageLimit: x.usageLimit, usageCount: x.usageCount, budget: x.budget }, x.id, x.code, x.storeOverrides?.[ctx.shopId]?.budget)]));
      if (ev.coupon?.ok && promoApplied.some((a) => a.promoId === ev.coupon!.promotionId)) { couponRef = { id: ev.coupon.couponId!, code: ev.coupon.code }; for (const l of lines) if (l.promos?.length) l.couponRef = couponRef; }
    }
  }
  let total = cartTotal(lines);
  if (input.dryRun) return { dryRun: true as const, total, discountTotal: lines.reduce((a, l) => a + (l.promo?.discount ?? 0), 0), promotions: promoApplied, decisions: promoDecisions, notes: promoNotes, pro: promoPro,
    coupon: couponInfo ? { ok: couponInfo.ok, code: couponInfo.code, message: couponInfo.message, applied: !!couponRef } : undefined,
    lines: lines.map((l) => ({ productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), name: l.name, qty: l.qty, amount: l.amount ?? Math.round(l.unitPrice * l.qty), ...(l.promo ? { baseAmount: l.baseAmount, promo: l.promo, promos: l.promos } : {}) })) };

  // 2) Client, points
  let redeem = 0;
  if (input.redeemPoints && customer) {
    redeem = Math.min(Math.floor(input.redeemPoints), redeemablePoints(Number(customer.points ?? 0), total));
    total -= redeem * DEFAULT_RULES.redeemCfaPerPoint;
  }

  // 3) Paiements : QR = lien confirmé, montant exact, non déjà utilisé
  const links: Record<string, unknown>[] = [];
  for (const p of input.payments) {
    if (isQrMethod(p.method)) {
      const link = p.linkId ? await store.get("payment_links", p.linkId) : null;
      if (!link || link.tenantId !== ctx.tenantId || link.shopId !== ctx.shopId) throw new HttpError(400, "Lien de paiement introuvable");
      if (link.status !== "paid") throw new HttpError(402, "Paiement QR non confirmé");
      if (link.provider !== p.method || Number(link.amount) !== toFcfa(p.amount)) throw new HttpError(400, "Lien de paiement incompatible");
      if (link.saleId && link.saleId !== saleId) throw new HttpError(409, "Lien déjà utilisé");
      links.push(link);
    }
  }
  const credit = input.payments.filter((p) => p.method === "credit").reduce((s, p) => s + toFcfa(p.amount), 0);
  if (credit > 0) {
    if (!customer) throw new HttpError(400, "Client requis pour un crédit");
    const ok = canExtendCredit({ balance: Number(customer.creditBalance ?? 0), limit: Number(customer.creditLimit ?? 0) }, credit);
    if (!ok.ok && !existing) throw new HttpError(409, ok.error);
  }
  const payments: Payment[] = input.payments.map((p) => ({ method: p.method as PaymentMethod, amount: toFcfa(p.amount) }));
  const s = settle(total, payments);
  if (!s.ok) throw new HttpError(402, s.error);

  const number = existing?.number ?? `V-${soldAt.slice(0, 10).replace(/-/g, "")}-${saleId.slice(0, 6).toUpperCase()}`;
  // Numéros de série : chaque vente « réserve » son numéro par un mouvement à identifiant unique (numéro + cycle) ; le deuxième vendeur échoue, quel que soit le moment.
  const claimed: string[] = [];
  const serialEntries = lines.flatMap((l) => (l.components ? l.components.map((c) => ({ productId: c.productId, variantId: c.variantId, serials: c.serials })) : [{ productId: l.productId, variantId: l.variantId, serials: l.serials }])); // séries des lignes ET des composants de bundles
  for (const l of serialEntries) for (const sn of l.serials ?? []) {
    const rid = serialRowId(l.productId, sn); const cur = serialRows.get(sn) ?? (await store.get("article_serials", rid));
    const cid = `${rid}_${Number(cur?.cycle ?? 0)}`.slice(0, 36);
    const ok = await store.create("stock_moves", cid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), serial: sn, qty: 1, kind: "sale", refId: number, userId: ctx.userId });
    if (ok) claimed.push(cid);
    else if ((await store.get("stock_moves", cid))?.refId !== number) { for (const c of claimed) await store.remove("stock_moves", c); throw new HttpError(409, `Numéro de série déjà vendu : ${sn}`); }
  }

  // Promotions : chaque utilisation est réservée (limite globale et budget atomiques) et liée à CETTE vente, avec l'instantané des règles ; en cas d'échec, séries, promotions et coupon sont annulés.
  const usageCreated: { promoId: string; id: string }[] = []; let couponUsage: { couponId: string; id: string } | undefined;
  const ruleSnap = (p?: Promo) => (p ? { name: p.name, code: p.code, family: p.family ?? "simple", kind: p.kind, value: p.value, scope: p.scope, category: p.category, tiers: p.tiers, bogo: p.bogo, comboItems: p.comboItems, requireItems: p.requireItems, stackable: p.stackable, priority: p.priority, minQty: p.minQty, minCart: p.minCart, maxLinePct: p.maxLinePct, maxCartDiscount: p.maxCartDiscount, budget: p.budget, minMarginPct: p.minMarginPct, startAt: p.startAt, endAt: p.endAt, storeScope: p.storeScope, homeShopId: p.homeShopId, requiresCoupon: p.requiresCoupon, customerRules: p.customerRules, allowBelowMargin: p.allowBelowMargin } : {});
  try {
    for (const a of promoApplied) {
      const id = await recordUsage(store, ctx, promoMeta.get(a.promoId)!, { saleId, saleNumber: number, customerId: customer?.$id, discount: a.discount, usedAt: soldAt, baseAmount: a.lineIndexes.reduce((s, i) => s + (lines[i]!.baseAmount ?? 0), 0), family: a.family, rules: ruleSnap(promoById.get(a.promoId)), decisions: promoDecisions.slice(0, 40),
        ...(couponRef && couponInfo?.promotionId === a.promoId ? { couponId: couponRef.id } : {}),
        lines: a.lineIndexes.map((i) => ({ index: i, productId: lines[i]!.productId, name: lines[i]!.name, category: pcat.get(lines[i]!.productId) ?? "", qty: lines[i]!.qty, base: lines[i]!.baseAmount, discount: lines[i]!.promos?.find((x) => x.id === a.promoId)?.discount ?? 0, cost: lines[i]!.unitCost ? Math.round(lines[i]!.unitCost! * lines[i]!.qty) : null })) });
      if (id) usageCreated.push({ promoId: a.promoId, id });
    }
    if (couponRef && !input.dryRun) {
      const crow = couponInfo?.coupon ?? (await store.get("promotion_coupons", couponRef.id)); if (crow) { const cu = await useCoupon(store, ctx, crow as never, { saleId, customerId: customer?.$id, usedAt: soldAt }); if (cu) couponUsage = { couponId: couponRef.id, id: cu }; }
    }
  } catch (e) { for (const c of claimed) await store.remove("stock_moves", c); for (const u of usageCreated) await releaseUsage(store, u.promoId, u.id); if (couponUsage) await releaseCoupon(store, couponUsage.couponId, couponUsage.id); throw e; }

  // 4) Écritures idempotentes : la vente passe "pending" -> "posted" -> "paid"
  const shop = await store.get("shops", ctx.shopId);
  const vatRatePct = Number(shop?.vatRatePct ?? 18);
  const vat = total - Math.round(total / (1 + vatRatePct / 100));
  await store.create("sales", saleId, ctx.tenantId, {
    tenantId: ctx.tenantId, shopId: ctx.shopId, number, total, vat, customerId: customer?.$id ?? "", cashierId: ctx.userId,
    payments: JSON.stringify(payments), lines: JSON.stringify(lines), status: "pending", clientId: saleId, soldAt,
  });
  const base = saleId.slice(0, 28);
  for (const [i, l] of lines.entries()) { // mouvements en entiers de sous-unités ; l'unité vendue est tracée sur le mouvement
    if (l.components?.length) { // bundle : un mouvement de vente par composant (et par lot) ; les séries sont déjà tracées par leurs réservations
      for (const [k, c] of l.components.entries()) {
        if (c.serials?.length) continue;
        const csc = scales.get(c.productId) ?? 0; const cm = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: c.productId, kind: "sale", refId: number, userId: ctx.userId, ...(c.variantId ? { variantId: c.variantId } : {}) };
        if (c.lots?.length) for (const [m, a] of c.lots.entries()) await store.create("stock_moves", moveId(saleId, i, k, m), ctx.tenantId, { ...cm, lotId: a.lotId, qty: scaledInt(a.qty, csc) });
        else await store.create("stock_moves", moveId(saleId, i, k), ctx.tenantId, { ...cm, qty: scaledInt(c.qty, csc) });
      }
      continue;
    }
    if (l.serials?.length) continue; // les séries sont déjà tracées par leurs mouvements de réservation
    const scale = scales.get(l.productId) ?? 0; const common = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, kind: "sale", refId: number, userId: ctx.userId, ...(l.variantId ? { variantId: l.variantId } : {}) };
    if (l.lots?.length) { for (const [k, a] of l.lots.entries()) await store.create("stock_moves", `${base}_m${i}_${k}`, ctx.tenantId, { ...common, lotId: a.lotId, qty: scaledInt(a.qty, scale), ...(l.unit ? { unit: l.unit, unitQty: l.unitQty } : {}) }); continue; }
    await store.create("stock_moves", `${base}_m${i}`, ctx.tenantId, { ...common, qty: scaledInt(l.qty, scale), ...(l.unit ? { unit: l.unit, unitQty: l.unitQty } : {}) });
  }
  // Les numéros vendus passent « vendu », avec la référence de vente et la fin de garantie.
  for (const l of serialEntries) for (const sn of l.serials ?? []) {
    const rid = serialRowId(l.productId, sn); const row = await store.get("article_serials", rid); if (!row) continue;
    const months = Number(row.warrantyMonths ?? 0);
    await store.update("article_serials", rid, { status: "sold", saleId, saleRef: number, soldAt, ...(months > 0 ? { warrantyUntil: warrantyEnd(soldAt, months) } : {}) });
  }
  const j = saleJournal({ ref: number, date: soldAt, totalTtc: total, vatRatePct, payments });
  for (const [i, e] of j.entries.entries())
    await store.create("journal_entries", `${base}_j${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: number, account: e.account, debit: e.debit, credit: e.credit, label: e.label, date: soldAt });
  await store.update("sales", saleId, { status: "posted" });

  // 5) Client : crédit, points, cumul annuel (appliqué une seule fois, puis la vente passe "paid")
  const current = await store.get("sales", saleId);
  if (current?.status === "posted") {
    if (customer) {
      const spend = Number(customer.annualSpend ?? 0) + total;
      const pts = Number(customer.points ?? 0) - redeem + earnedPoints(total, tierFor(spend));
      await store.update("customers", customer.$id, { creditBalance: Number(customer.creditBalance ?? 0) + credit, points: pts, annualSpend: spend });
    }
    for (const l of links) await store.update("payment_links", l.$id as string, { saleId });
    await store.update("sales", saleId, { status: "paid" });
  }
  await store.create("audit_log", `${base}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "sale.checkout", detail: `${number} ${total}` });
  return { saleId, number, total, change: s.change, duplicate: false };
}
