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
import { kindOf } from "../../../src/domain/bundles";
import { loadComponents } from "./bundles";
import { HttpError, need, type Ctx, type Row, type Store, needModule } from "./store";

export type CheckoutInput = {
  clientId: string; soldAt?: string; customerId?: string; redeemPoints?: number;
  lines: { productId: string; variantId?: string; qty: number | string; unit?: string; discountPct?: number; serials?: unknown }[];
  payments: (Payment & { linkId?: string })[];
};
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
  if (!input.clientId || !input.lines?.length) throw new HttpError(400, "Panier vide");
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
  const lines: (CartLine & { unitCost?: number; unit?: string; unitQty?: number; factor?: number; variantId?: string; priceSource?: string; priceRuleId?: string; basePrice?: number; lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[]; components?: { productId: string; name: string; qty: number; unitCost: number }[] })[] = [];
  const scales = new Map<string, number>(); const seenKeys = new Set<string>();
  let packagingOk: boolean | undefined;
  const compDemand = new Map<string, number>(); let bundlesOk: boolean | undefined;
  const prevLines: { lots?: { lotId: string; lotNo: string; qty: number }[]; serials?: string[]; components?: { productId: string; name: string; qty: number; unitCost: number }[] }[] = (() => { try { return existing ? JSON.parse(String(existing.lines)) : []; } catch { return []; } })();
  const today = soldAt.slice(0, 10); let policy: Awaited<ReturnType<typeof expiredPolicyOf>> | undefined; const reserved = new Map<string, number>(); const serialRows = new Map<string, Row>();
  for (const [li, l] of input.lines.entries()) {
    const p = await store.get("products", l.productId);
    if (!p || p.tenantId !== ctx.tenantId || p.shopId !== ctx.shopId || p.archived) throw new HttpError(404, "Produit introuvable");
    if (kindOf(p) === "bundle") { // bundle virtuel : prix propre, sort ses composants du stock (aucun stock propre)
      if (l.variantId) throw new HttpError(400, `${p.name} n'a pas de variantes`);
      if (l.unit && l.unit !== (p.unit || "piece")) throw new HttpError(400, `${p.name} : un bundle se vend à la pièce`);
      bundlesOk ??= planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "bundles");
      if (!bundlesOk) throw new HttpError(402, "Les bundles sont réservés à la formule Pro.");
      const bkey = `${p.$id}||`; if (seenKeys.has(bkey)) throw new HttpError(400, `Ligne en double : ${p.name}`); seenKeys.add(bkey);
      let bq: number; try { bq = qtyFor(l.qty, 0); } catch (e) { throw new HttpError(400, `${p.name} : ${(e as Error).message}`); }
      let comps: { productId: string; name: string; qty: number; unitCost: number }[];
      if (existing) comps = prevLines[li]?.components ?? []; // reprise : la composition figée à la vente fait foi
      else {
        const defs = await loadComponents(store, ctx, p.$id);
        if (!defs.length) throw new HttpError(409, `${p.name} : bundle sans composants`);
        comps = [];
        for (const c of defs) {
          const cp = await store.get("products", c.productId);
          if (!cp || cp.tenantId !== ctx.tenantId || cp.shopId !== ctx.shopId || cp.archived) throw new HttpError(409, `${p.name} : un composant n'est plus disponible (modifiez le bundle)`);
          const need = c.qty * bq, used = compDemand.get(cp.$id) ?? 0, plain = lines.filter((x) => x.productId === cp.$id && !x.components).reduce((a, x) => a + x.qty, 0);
          const have = await stockFor(store, cp.$id, 0);
          if (have < used + plain + need) throw new HttpError(409, `Stock insuffisant : ${p.name} (composant ${cp.name} : ${have} en stock)`);
          compDemand.set(cp.$id, used + need); comps.push({ productId: cp.$id, name: String(cp.name), qty: c.qty, unitCost: Number(cp.cost ?? 0) });
        }
      }
      const bDisc = Number(l.discountPct ?? 0); if (bDisc > 0) need(ctx, "manager");
      const bcost = comps.reduce((a, c) => a + c.unitCost * c.qty, 0);
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
    // Articles suivis (Pro) : le stock vendable est celui des lots (FEFO) ou des numéros de série disponibles. Une reprise réutilise l'affectation déjà enregistrée dans la vente.
    const mode = trackingOf(p); let lots: { lotId: string; lotNo: string; qty: number; unitCost: number }[] | undefined; let serials: string[] | undefined; let trackedCost: number | undefined;
    if (mode === "lot") {
      if (existing) lots = (prevLines[li]?.lots ?? []).map((x) => ({ ...x, unitCost: 0 }));
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
      const given = (() => { if (existing || l.serials === undefined || l.serials === null || (Array.isArray(l.serials) && !l.serials.length) || String(l.serials).trim() === "") return null; try { return parseSerials(l.serials); } catch (e) { throw new HttpError(400, `${p.name} : ${(e as Error).message}`); } })();
      if (existing) serials = prevLines[li]?.serials ?? [];
      else if (given) serials = given;
      else { // attribution automatique : les plus anciennes unités disponibles d'abord (le caissier n'a rien à mémoriser)
        if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, `${p.name} : quantité invalide`);
        const taken = new Set([...serialRows.keys()]); for (const x of lines) for (const sn of x.serials ?? []) taken.add(sn);
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
    } else if (!existing) { // le stock a déjà été décrémenté lors d'une reprise
      const have = v ? fromScaled(await stockScaledVariant(store, v.$id), scale) : await stockFor(store, p.$id, scale);
      const already = lines.filter((x) => x.productId === p.$id && (x.variantId ?? "") === variantId).reduce((a, x) => a + x.qty, 0) + (compDemand.get(p.$id) ?? 0); // deux unités du même article : cumul
      if (have < already + qty) throw new HttpError(409, `Stock insuffisant : ${p.name}${v ? ` — ${v.label}` : ""} (${have})`);
    }
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
  let total = cartTotal(lines);

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
  for (const l of lines) for (const sn of l.serials ?? []) {
    const rid = serialRowId(l.productId, sn); const cur = serialRows.get(sn) ?? (await store.get("article_serials", rid));
    const cid = `${rid}_${Number(cur?.cycle ?? 0)}`.slice(0, 36);
    const ok = await store.create("stock_moves", cid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), serial: sn, qty: 1, kind: "sale", refId: number, userId: ctx.userId });
    if (ok) claimed.push(cid);
    else if ((await store.get("stock_moves", cid))?.refId !== number) { for (const c of claimed) await store.remove("stock_moves", c); throw new HttpError(409, `Numéro de série déjà vendu : ${sn}`); }
  }

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
    if (l.components?.length) { for (const [k, c] of l.components.entries()) await store.create("stock_moves", `${base}_m${i}_c${k}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: c.productId, kind: "sale", refId: number, userId: ctx.userId, qty: c.qty * l.qty }); continue; } // bundle : un mouvement par composant
    if (l.serials?.length) continue; // les séries sont déjà tracées par leurs mouvements de réservation
    const scale = scales.get(l.productId) ?? 0; const common = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, kind: "sale", refId: number, userId: ctx.userId, ...(l.variantId ? { variantId: l.variantId } : {}) };
    if (l.lots?.length) { for (const [k, a] of l.lots.entries()) await store.create("stock_moves", `${base}_m${i}_${k}`, ctx.tenantId, { ...common, lotId: a.lotId, qty: scaledInt(a.qty, scale), ...(l.unit ? { unit: l.unit, unitQty: l.unitQty } : {}) }); continue; }
    await store.create("stock_moves", `${base}_m${i}`, ctx.tenantId, { ...common, qty: scaledInt(l.qty, scale), ...(l.unit ? { unit: l.unit, unitQty: l.unitQty } : {}) });
  }
  // Les numéros vendus passent « vendu », avec la référence de vente et la fin de garantie.
  for (const l of lines) for (const sn of l.serials ?? []) {
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
