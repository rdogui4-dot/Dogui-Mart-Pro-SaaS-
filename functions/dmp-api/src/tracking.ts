import { createHash } from "node:crypto";
import { MAX_AMOUNT } from "../../../src/domain/articles";
import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { MAX_SERIALS_PER_OP, SERIAL_TRANSITIONS, isExpiredPolicy, normalizeDate, normalizeLotNo, parseSerials, stockEffect, trackingOf, type ExpiredPolicy, type SerialStatus } from "../../../src/domain/tracking";
import { needFeature } from "./articles";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const sha = (s: string) => createHash("sha1").update(s).digest("hex");
/** Un lot = (article, variante, numéro de lot) ; une série = (article, numéro) : identifiants déterministes, jamais de doublon. */
export const lotRowId = (productId: string, variantId: string, lotNo: string): string => `o${sha(`${productId}|${variantId}|${lotNo}`).slice(0, 30)}`;
export const serialRowId = (productId: string, serial: string): string => `n${sha(`${productId}|${serial}`).slice(0, 30)}`;
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });
const num = (v: unknown, label: string, max = MAX_AMOUNT): number | undefined => { if (v === undefined || v === null || String(v).trim() === "") return undefined; const n = Number(String(v).replace(/\s/g, "")); if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${label} invalide`); return n; };

export async function expiredPolicyOf(store: Store, ctx: Ctx): Promise<ExpiredPolicy> {
  const shop = await store.get("shops", ctx.shopId); return isExpiredPolicy(shop?.expiredPolicy) ? shop!.expiredPolicy : "block";
}

/** Lots d'un article (ou d'une variante) avec leur stock courant (entiers de sous-unités), calculé depuis le journal de mouvements. */
export async function lotsWithStock(store: Store, ctx: Ctx, productId: string, variantId = ""): Promise<{ id: string; row: Row; qty: number }[]> {
  const rows = (await store.list("article_lots", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId }, 500)).filter((l) => String(l.variantId ?? "") === variantId);
  if (!rows.length) return [];
  const { rows: moves } = await store.scan("stock_moves", { productId }, { maxRows: 200_000 });
  const by = new Map<string, number>();
  for (const m of moves) if (m.lotId) { const d = m.kind === "adjust" ? Number(m.qty) : (["sale", "loss", "transfer_out"].includes(String(m.kind)) ? -1 : 1) * Math.abs(Number(m.qty)); by.set(String(m.lotId), (by.get(String(m.lotId)) ?? 0) + d); }
  return rows.map((row) => ({ id: row.$id, row, qty: by.get(row.$id) ?? 0 }));
}

export type LotPart = { lotNo: string; qty: number; expiresAt?: string; manufacturedAt?: string };
/** Valide les lots saisis pour une quantité reçue (somme exacte, dates réelles, pas de doublon de numéro). */
export function normalizeLotParts(parts: unknown, total: number, scale: number): LotPart[] {
  if (!Array.isArray(parts) || !parts.length) throw new HttpError(400, "Article suivi par lot : indiquez les lots (numéro, quantité, péremption)");
  const seen = new Set<string>(); let sum = 0; const out: LotPart[] = [];
  for (const p of parts as Record<string, unknown>[]) {
    try {
      const lotNo = normalizeLotNo(p.lotNo); if (seen.has(lotNo)) throw new Error(`Lot en double : ${lotNo}`); seen.add(lotNo);
      const qty = qtyFor(p.qty, scale); sum += scaledInt(qty, scale);
      out.push({ lotNo, qty, ...(p.expiresAt ? { expiresAt: normalizeDate(p.expiresAt, "Date de péremption") } : {}), ...(p.manufacturedAt ? { manufacturedAt: normalizeDate(p.manufacturedAt, "Date de fabrication") } : {}) });
    } catch (e) { throw new HttpError(400, (e as Error).message); }
  }
  if (out.some((p) => p.expiresAt && p.manufacturedAt && p.manufacturedAt > p.expiresAt)) throw new HttpError(400, "La fabrication doit précéder la péremption");
  if (sum !== scaledInt(total, scale)) throw new HttpError(400, "La somme des lots doit être égale à la quantité reçue");
  return out;
}

/** Crée (ou retrouve) le lot. Un numéro de lot existant avec une autre date de péremption est refusé : on ne mélange jamais deux péremptions sous un même lot. */
export async function checkLot(store: Store, ctx: Ctx, p: Row, variantId: string, part: LotPart): Promise<Row | null> {
  const cur = await store.get("article_lots", lotRowId(p.$id, variantId, part.lotNo));
  if (!cur) return null;
  if (!mine(ctx, cur)) throw new HttpError(409, "Lot indisponible");
  const exp = cur.expiresAt ? new Date(String(cur.expiresAt)).toISOString() : undefined;
  if (part.expiresAt !== exp) throw new HttpError(409, `Le lot ${part.lotNo} existe déjà avec une autre date de péremption`);
  return cur;
}
export async function ensureLot(store: Store, ctx: Ctx, p: Row, variantId: string, part: LotPart, extra: { supplierId?: string; unitCost?: number; receivedAt?: string }): Promise<Row> {
  const id = lotRowId(p.$id, variantId, part.lotNo);
  const cur = await checkLot(store, ctx, p, variantId, part);
  if (cur) return cur;
  const data = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId, lotNo: part.lotNo, ...(part.manufacturedAt ? { manufacturedAt: part.manufacturedAt } : {}), ...(part.expiresAt ? { expiresAt: part.expiresAt } : {}), receivedAt: extra.receivedAt ?? new Date().toISOString(), supplierId: extra.supplierId ?? "", unitCost: extra.unitCost ?? Number(p.cost ?? 0), status: "active" };
  await store.create("article_lots", id, ctx.tenantId, data);
  return { ...data, $id: id } as Row;
}

async function loadTracked(store: Store, ctx: Ctx, productId: string, variantId: string | undefined, mode: "lot" | "serial") {
  const p = await store.get("products", productId);
  if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable");
  if (trackingOf(p) !== mode) throw new HttpError(400, mode === "lot" ? "Cet article n'est pas suivi par lot" : "Cet article n'est pas suivi par numéro de série");
  const vid = variantId ? String(variantId) : "";
  if (p.hasVariants) { const v = vid ? await store.get("article_variants", vid) : null; if (!v || !mine(ctx, v) || v.productId !== p.$id) throw new HttpError(400, "Choisissez la variante concernée"); }
  else if (vid) throw new HttpError(400, "Cet article n'a pas de variantes");
  return { p, vid };
}

// ------------------------------------------------------------------ lots
export type LotReceiveInput = { productId: string; variantId?: string; lotNo: unknown; qty: unknown; expiresAt?: unknown; manufacturedAt?: unknown; supplierId?: string; unitCost?: unknown; requestId?: string };
/** Entrée de stock dans un lot (stock d'ouverture, retour fournisseur, correction). Fonction Pro. */
export async function receiveLot(store: Store, ctx: Ctx, b: LotReceiveInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "lots");
  const { p, vid } = await loadTracked(store, ctx, b.productId, b.variantId, "lot");
  const scale = scaleOf(p); let qty: number; let parts: LotPart[];
  try { qty = qtyFor(b.qty, scale); } catch (e) { throw new HttpError(400, `Quantité : ${(e as Error).message}`); }
  parts = normalizeLotParts([{ lotNo: b.lotNo, qty, expiresAt: b.expiresAt, manufacturedAt: b.manufacturedAt }], qty, scale);
  if (b.supplierId) { const s = await store.get("suppliers", b.supplierId); if (!mine(ctx, s)) throw new HttpError(404, "Fournisseur introuvable dans cette boutique"); }
  const lot = await ensureLot(store, ctx, p, vid, parts[0]!, { supplierId: b.supplierId, unitCost: num(b.unitCost, "Coût") });
  const mid = `${b.requestId ? `e${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId()}`;
  const created = await store.create("stock_moves", mid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, ...(vid ? { variantId: vid } : {}), lotId: lot.$id, qty: scaledInt(qty, scale), kind: "adjust", refId: "lot-entry", userId: ctx.userId });
  if (created) await audit(store, ctx, "lot.receive", `${p.name} lot ${parts[0]!.lotNo} +${qty}${parts[0]!.expiresAt ? ` péremption ${parts[0]!.expiresAt.slice(0, 10)}` : ""}`);
  return { lotId: lot.$id, duplicate: !created };
}

/** Stock d'un article (ou d'une variante) NON affecté à un lot, en sous-unités : total du journal moins ce qui est déjà rangé dans des lots. */
export async function unassignedStock(store: Store, productId: string, variantId: string): Promise<number> {
  const { rows: moves } = await store.scan("stock_moves", { productId }, { maxRows: 200_000 }); let n = 0;
  for (const m of moves) { if (m.lotId || String(m.variantId ?? "") !== variantId) continue; n += m.kind === "adjust" ? Number(m.qty) : (["sale", "loss", "transfer_out"].includes(String(m.kind)) ? -1 : 1) * Math.abs(Number(m.qty)); }
  return n;
}

/** Fiche article : ranger du stock EXISTANT dans un lot (numéro, péremption). Le stock total ne change jamais : deux mouvements opposés (sortie hors lot, entrée dans le lot).
 *  Refusé si la quantité dépasse le stock non encore affecté à un lot : le stock ne s'augmente que par une réception, un inventaire ou un ajustement motivé. */
export async function assignLot(store: Store, ctx: Ctx, b: LotReceiveInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "lots");
  const { p, vid } = await loadTracked(store, ctx, b.productId, b.variantId, "lot");
  const scale = scaleOf(p); let qty: number; let parts: LotPart[];
  try { qty = qtyFor(b.qty, scale); } catch (e) { throw new HttpError(400, `Quantité : ${(e as Error).message}`); }
  parts = normalizeLotParts([{ lotNo: b.lotNo, qty, expiresAt: b.expiresAt, manufacturedAt: b.manufacturedAt }], qty, scale);
  const req = String(b.requestId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 26); const outId = req.length >= 8 ? `e${req}o` : newId(), inId = req.length >= 8 ? `e${req}i` : newId();
  if (req.length >= 8 && (await store.get("stock_moves", inId))) return { lotId: lotRowId(p.$id, vid, parts[0]!.lotNo), duplicate: true, stockChanged: false };
  const free = await unassignedStock(store, p.$id, vid); const want = scaledInt(qty, scale);
  if (want > free) throw new HttpError(409, `Seulement ${fromScaled(Math.max(0, free), scale)} en stock hors lot pour « ${p.name} » : on ne peut pas ranger plus que le stock existant. Pour ajouter du stock, enregistrez une réception d'achat ou un ajustement.`);
  const lot = await ensureLot(store, ctx, p, vid, parts[0]!, { supplierId: b.supplierId, unitCost: num(b.unitCost, "Coût") });
  const base = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, ...(vid ? { variantId: vid } : {}), kind: "adjust", refId: "lot-assign", userId: ctx.userId };
  await store.batch([{ kind: "create", table: "stock_moves", id: outId, tenantId: ctx.tenantId, data: { ...base, qty: -want } }, { kind: "create", table: "stock_moves", id: inId, tenantId: ctx.tenantId, data: { ...base, lotId: lot.$id, qty: want } }]);
  await audit(store, ctx, "lot.assign", `${p.name} lot ${parts[0]!.lotNo} : ${qty} unité(s) rangée(s) depuis le stock existant (stock total inchangé)`);
  return { lotId: lot.$id, duplicate: false, stockChanged: false };
}

/** Blocage / déblocage d'un lot (quarantaine, rappel fournisseur) et correction des dates. */
export async function updateLot(store: Store, ctx: Ctx, b: { id: string; status?: string; expiresAt?: unknown; manufacturedAt?: unknown }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "lots");
  const l = await store.get("article_lots", b.id); if (!mine(ctx, l)) throw new HttpError(404, "Lot introuvable");
  const patch: Record<string, unknown> = {};
  if (b.status !== undefined) { if (b.status !== "active" && b.status !== "blocked") throw new HttpError(400, "Statut de lot inconnu"); patch.status = b.status; }
  try { if (b.expiresAt !== undefined) patch.expiresAt = b.expiresAt === "" ? null : normalizeDate(b.expiresAt, "Date de péremption"); if (b.manufacturedAt !== undefined) patch.manufacturedAt = b.manufacturedAt === "" ? null : normalizeDate(b.manufacturedAt, "Date de fabrication"); } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (!Object.keys(patch).length) return { id: l.$id };
  await store.update("article_lots", l.$id, patch);
  await audit(store, ctx, "lot.update", `${l.lotNo} (${l.$id}) ${JSON.stringify(patch)}`);
  return { id: l.$id };
}

/** Mise au rebut d'un lot (périmé, cassé…) : sortie de stock tracée, motif conservé. `qty` omis ou « all » = tout le stock du lot. */
export async function writeOffLot(store: Store, ctx: Ctx, b: { lotId: string; qty?: unknown; reason?: unknown; requestId?: string }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "lots");
  const l = await store.get("article_lots", b.lotId); if (!mine(ctx, l)) throw new HttpError(404, "Lot introuvable");
  const p = await store.get("products", String(l.productId)); if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable");
  const scale = scaleOf(p); const stock = (await lotsWithStock(store, ctx, p.$id, String(l.variantId ?? ""))).find((x) => x.id === l.$id)?.qty ?? 0;
  let scaled: number;
  if (b.qty === undefined || b.qty === null || b.qty === "" || b.qty === "all") scaled = stock;
  else { try { scaled = scaledInt(qtyFor(b.qty, scale), scale); } catch (e) { throw new HttpError(400, `Quantité : ${(e as Error).message}`); } }
  if (!(scaled > 0)) throw new HttpError(409, "Ce lot n'a plus de stock à mettre au rebut");
  if (scaled > stock) throw new HttpError(409, `Quantité supérieure au stock du lot (${fromScaled(stock, scale)})`);
  const reason = String(b.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || "péremption";
  const mid = b.requestId ? `w${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId();
  const created = await store.create("stock_moves", mid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, ...(l.variantId ? { variantId: String(l.variantId) } : {}), lotId: l.$id, qty: scaled, kind: "loss", refId: `rebut:${reason}`, userId: ctx.userId });
  if (created) await audit(store, ctx, "lot.writeoff", `${p.name} lot ${l.lotNo} −${fromScaled(scaled, scale)} (${reason})`);
  return { qty: fromScaled(scaled, scale), duplicate: !created };
}

// ------------------------------------------------------------------ numéros de série
/** Crée les séries d'une entrée de stock (une ligne + un mouvement +1 par numéro). Rejouable avec le même `entryRef` ; un numéro déjà connu sous une autre entrée est refusé. */
/** Vérifie, avant toute écriture, que les numéros peuvent être enregistrés (inconnus, ou déjà enregistrés par la même saisie). */
export async function assertSerialsFree(store: Store, ctx: Ctx, p: Row, serials: string[], entryRef: string) {
  for (const sn of serials) { const cur = await store.get("article_serials", serialRowId(p.$id, sn)); if (cur && (!mine(ctx, cur) || cur.entryRef !== entryRef)) throw new HttpError(409, `Numéro de série déjà enregistré : ${sn}`); }
}
export async function createSerials(store: Store, ctx: Ctx, p: Row, variantId: string, serials: string[], opts: { entryRef: string; supplierId?: string; unitCost?: number; warrantyMonths?: number; moveBase: string; kind?: "adjust" | "purchase"; refId: string }) {
  const rows: { id: string; serial: string }[] = []; let fresh = 0;
  for (const sn of serials) {
    const id = serialRowId(p.$id, sn); const cur = await store.get("article_serials", id);
    if (cur && (!mine(ctx, cur) || cur.entryRef !== opts.entryRef)) throw new HttpError(409, `Numéro de série déjà enregistré : ${sn}`);
    if (!cur) fresh++;
    rows.push({ id, serial: sn });
  }
  const now = new Date().toISOString();
  for (const [i, r] of rows.entries()) {
    await store.create("article_serials", r.id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId, serial: r.serial, status: "available", receivedAt: now, supplierId: opts.supplierId ?? "", unitCost: opts.unitCost ?? Number(p.cost ?? 0), warrantyMonths: opts.warrantyMonths ?? 0, saleId: "", saleRef: "", cycle: 0, entryRef: opts.entryRef });
    await store.create("stock_moves", `${opts.moveBase}_${i}`.slice(0, 36), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, ...(variantId ? { variantId } : {}), serial: r.serial, qty: 1, kind: opts.kind ?? "adjust", refId: opts.refId, userId: ctx.userId });
  }
  return fresh;
}

export type SerialAddInput = { productId: string; variantId?: string; serials: unknown; supplierId?: string; unitCost?: unknown; warrantyMonths?: unknown; requestId?: string };
export async function addSerials(store: Store, ctx: Ctx, b: SerialAddInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "serials");
  const { p, vid } = await loadTracked(store, ctx, b.productId, b.variantId, "serial");
  let list: string[]; try { list = parseSerials(b.serials); } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (!list.length) throw new HttpError(400, "Saisissez au moins un numéro de série");
  if (list.length > MAX_SERIALS_PER_OP) throw new HttpError(400, `${MAX_SERIALS_PER_OP} numéros au maximum par saisie`);
  if (b.supplierId) { const s = await store.get("suppliers", b.supplierId); if (!mine(ctx, s)) throw new HttpError(404, "Fournisseur introuvable dans cette boutique"); }
  const months = num(b.warrantyMonths, "Garantie", 120);
  const entryRef = `e${b.requestId ? String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28) : newId()}`;
  const fresh = await createSerials(store, ctx, p, vid, list, { entryRef, supplierId: b.supplierId, unitCost: num(b.unitCost, "Coût"), warrantyMonths: months, moveBase: `${entryRef.slice(0, 20)}_in`, refId: "serial-entry" });
  if (fresh) await audit(store, ctx, "serial.add", `${p.name} +${list.length} (${list.slice(0, 5).join(", ")}${list.length > 5 ? "…" : ""})`);
  return { count: list.length };
}

/** Changement de statut d'un numéro de série (retour client, garantie, défectueux). La vente se fait uniquement par l'encaissement. */
export async function setSerialStatus(store: Store, ctx: Ctx, b: { id: string; status: string }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "serials");
  const sr = await store.get("article_serials", b.id); if (!mine(ctx, sr)) throw new HttpError(404, "Numéro de série introuvable");
  const from = String(sr.status) as SerialStatus, to = String(b.status) as SerialStatus;
  if (!(SERIAL_TRANSITIONS[from] ?? []).includes(to)) throw new HttpError(409, `Passage de « ${from} » à « ${to} » impossible`);
  const eff = stockEffect(from, to); const patch: Record<string, unknown> = { status: to };
  if (to === "available") { patch.saleId = ""; patch.saleRef = ""; patch.soldAt = null; patch.warrantyUntil = null; patch.cycle = Number(sr.cycle ?? 0) + 1; }
  await store.update("article_serials", sr.$id, patch);
  if (eff !== 0) await store.create("stock_moves", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: String(sr.productId), ...(sr.variantId ? { variantId: String(sr.variantId) } : {}), serial: String(sr.serial), qty: 1, kind: eff > 0 ? "adjust" : "loss", refId: eff > 0 ? "retour-série" : "série-défectueuse", userId: ctx.userId });
  await audit(store, ctx, "serial.status", `${sr.serial} ${from} → ${to}`);
  return { id: sr.$id, status: to };
}
