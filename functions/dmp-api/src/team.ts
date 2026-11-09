import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { lineKey } from "../../../src/domain/variants";
import { allocateFefo, parseSerials, trackingOf } from "../../../src/domain/tracking";
import { planAllows } from "../../../src/domain/features";
import { checkLot, ensureLot, expiredPolicyOf, lotsWithStock, serialRowId } from "./tracking";
import { refuseBundle } from "./bundles";
import { stockFor, stockScaledVariant } from "./checkout";
import { HttpError, need, type Ctx, type Store, needModule } from "./store";
import { assertQuota, entitlementOf, getSub, grantLifetime } from "./subscriptions";
import { labelsFor } from "./permissions";
import { ROLE_PRESETS, STAFF_ROLES, isStaffRole, modulesFor, parseModules, type Module, type StaffRole } from "../../../src/domain/access";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const safeId = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);
const parse = <T,>(s: unknown, fb: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fb; } };
export const STAFF_EMAIL_DOMAIN = "staff.invalid"; // TLD réservé (RFC 2606) : aucun e-mail ne peut jamais partir vers un tiers
const MAX_SHOPS = 20;

/** Première boutique d'un commerce, identifiant déterministe donc idempotente. */
export async function initTenant(store: Store, ctx: Ctx, b: { name?: string }) {
  need(ctx, "owner");
  if (ctx.admin) await grantLifetime(store, ctx.tenantId); // le commerce de l'administrateur de la plateforme a un accès à vie (idempotent, même si la boutique existe déjà)
  const id = `m${ctx.tenantId}`.slice(0, 36);
  const existing = await store.get("shops", id);
  if (existing) return { shopId: id, created: false };
  const shops = await store.list("shops", { tenantId: ctx.tenantId }, 1);
  if (shops.length) return { shopId: String(shops[0]!.$id), created: false };
  await store.create("shops", id, ctx.tenantId, { tenantId: ctx.tenantId, name: String(b.name || "Boutique principale").slice(0, 120), vatRatePct: 18 });
  await getSub(store, ctx.tenantId); // démarre l'essai gratuit à l'inscription
  return { shopId: id, created: true };
}

export async function createShop(store: Store, ctx: Ctx, b: { name: string; address?: string; city?: string; phone?: string; legal?: string; vatRatePct?: number }) {
  need(ctx, "owner");
  const name = String(b.name ?? "").trim(); if (!name) throw new HttpError(400, "Nom requis");
  const vat = b.vatRatePct === undefined ? 18 : Number(b.vatRatePct);
  if (!(vat >= 0 && vat <= 30)) throw new HttpError(400, "TVA invalide (0 à 30 %)");
  if ((await store.list("shops", { tenantId: ctx.tenantId }, MAX_SHOPS + 1)).length >= MAX_SHOPS) throw new HttpError(409, `Maximum ${MAX_SHOPS} boutiques`);
  await assertQuota(store, ctx.tenantId, "shops");
  const id = newId();
  await store.create("shops", id, ctx.tenantId, { tenantId: ctx.tenantId, name: name.slice(0, 120), address: String(b.address ?? "").slice(0, 160), city: String(b.city ?? "").slice(0, 80), phone: String(b.phone ?? "").slice(0, 32), legal: String(b.legal ?? "").slice(0, 120), vatRatePct: vat });
  await store.create("audit_log", `${id}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: id, userId: ctx.userId, action: "shop.create", detail: name });
  return { shopId: id };
}

/** Boutiques du commerce parmi `ids` ; lève si l'une n'existe pas. */
async function ownShops(store: Store, ctx: Ctx, ids: unknown): Promise<string[]> {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  if (!list.length) throw new HttpError(400, "Au moins une boutique est requise");
  for (const id of list) { const s = await store.get("shops", id); if (!s || s.tenantId !== ctx.tenantId) throw new HttpError(404, "Boutique introuvable"); }
  return list;
}
const validPassword = (p: unknown): string => { const s = String(p ?? ""); if (s.length < 8) throw new HttpError(400, "Mot de passe : 8 caractères minimum"); if (s.length > 128) throw new HttpError(400, "Mot de passe trop long"); return s; };
const validRole = (r: unknown): StaffRole => { if (!isStaffRole(r)) throw new HttpError(400, `Rôle invalide (attendu : ${STAFF_ROLES.join(", ")})`); return r; };
/** Accès demandés par le propriétaire, ou préréglage du rôle à défaut. */
const accessOf = (role: StaffRole, access: unknown): Module[] => {
  if (access === undefined) return [...ROLE_PRESETS[role].modules];
  const p = parseModules(access); if (!p.ok) throw new HttpError(400, p.error); return p.modules;
};

/** Création d'un compte employé par le propriétaire : identifiant (ou e-mail) + mot de passe initial. Rollback si une étape échoue. */
export async function createStaff(store: Store, ctx: Ctx, b: { name: string; username?: string; email?: string; password: string; role: string; access?: unknown; shopIds: string[] }) {
  need(ctx, "owner");
  const name = String(b.name ?? "").trim().slice(0, 100); if (!name) throw new HttpError(400, "Nom requis");
  const role = validRole(b.role); const password = validPassword(b.password); const modules = accessOf(role, b.access);
  const shopIds = await ownShops(store, ctx, b.shopIds);
  let email: string, username = "";
  if (b.email) { email = String(b.email).trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.endsWith(`@${STAFF_EMAIL_DOMAIN}`)) throw new HttpError(400, "E-mail invalide"); }
  else { username = String(b.username ?? "").trim().toLowerCase(); if (!/^[a-z0-9._-]{3,24}$/.test(username)) throw new HttpError(400, "Identifiant : 3 à 24 caractères (lettres, chiffres, . _ -)"); email = `${username}@${STAFF_EMAIL_DOMAIN}`; }
  await assertQuota(store, ctx.tenantId, "users");
  const userId = newId();
  await store.createUser({ userId, email, password, name }); // 409 si déjà pris
  try {
    await store.setLabels(userId, labelsFor(role, modules, shopIds, true)); // droits de lecture par boutique et par accès
    await store.addMember(ctx.tenantId, userId, [role], name);
    try { await store.create("staff", userId, ctx.tenantId, { tenantId: ctx.tenantId, userId, name, username, email: username ? "" : email, role, access: JSON.stringify(modules), shopIds: JSON.stringify(shopIds), active: true }); }
    catch (e) { await store.removeMember(ctx.tenantId, userId).catch(() => {}); throw e; }
  } catch (e) { await store.deleteUser(userId).catch(() => {}); throw e; }
  await store.create("audit_log", `${userId}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: shopIds[0]!, userId: ctx.userId, action: "staff.create", detail: `${name} (${role} : ${modules.join(", ")})` });
  return { userId, login: username || email };
}

async function ownStaff(store: Store, ctx: Ctx, userId: unknown) {
  const s = await store.get("staff", String(userId ?? ""));
  if (!s || s.tenantId !== ctx.tenantId) throw new HttpError(404, "Employé introuvable");
  return s;
}

export async function updateStaff(store: Store, ctx: Ctx, b: { userId: string; name?: string; role?: string; access?: unknown; shopIds?: string[]; active?: boolean }) {
  need(ctx, "owner");
  const s = await ownStaff(store, ctx, b.userId);
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 100); if (!n) throw new HttpError(400, "Nom requis"); patch.name = n; }
  if (b.shopIds !== undefined) patch.shopIds = JSON.stringify(await ownShops(store, ctx, b.shopIds));
  if (b.role !== undefined) { const role = validRole(b.role); if (role !== s.role) { await store.setMemberRoles(ctx.tenantId, s.$id, [role]); patch.role = role; } }
  // Accès : liste fournie > préréglage du nouveau rôle (si le rôle change) > accès actuels.
  if (b.access !== undefined) patch.access = JSON.stringify(accessOf((patch.role ?? s.role) as StaffRole, b.access));
  else if (patch.role) patch.access = JSON.stringify(ROLE_PRESETS[patch.role as StaffRole].modules);
  if (b.active !== undefined) { await store.setUserActive(s.$id, !!b.active); patch.active = !!b.active; }
  // Étiquettes recalculées à chaque changement de rôle, de boutiques ou d'état (un compte désactivé n'a plus aucune lecture).
  if (b.role !== undefined || b.access !== undefined || b.shopIds !== undefined || b.active !== undefined) {
    const role = (patch.role ?? s.role) as StaffRole; const shops = JSON.parse(String(patch.shopIds ?? s.shopIds ?? "[]")) as string[]; const active = (patch.active ?? s.active) !== false;
    await store.setLabels(s.$id, labelsFor(role, modulesFor(role, patch.access ?? s.access), shops, active));
  }
  if (Object.keys(patch).length) await store.update("staff", s.$id, patch);
  await store.create("audit_log", `${newId()}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: parse<string[]>(s.shopIds, [])[0] ?? "", userId: ctx.userId, action: "staff.update", detail: `${s.name} ${Object.keys(patch).join(",")}` });
  return { ok: true };
}

export async function resetStaffPassword(store: Store, ctx: Ctx, b: { userId: string; password: string }) {
  need(ctx, "owner");
  const s = await ownStaff(store, ctx, b.userId);
  await store.setPassword(s.$id, validPassword(b.password));
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: parse<string[]>(s.shopIds, [])[0] ?? "", userId: ctx.userId, action: "staff.password_reset", detail: String(s.name) });
  return { ok: true };
}

/** Droit d'agir dans une boutique : le propriétaire partout, les autres seulement dans celles qui leur sont affectées. */
export const allowedIn = (ctx: Ctx, shopId: string): boolean => ctx.shopIds === "all" || !!ctx.shopIds?.includes(shopId);

/** Transfert immédiat entre deux boutiques du même commerce. Les produits sont propres à chaque boutique : le produit de destination
 *  est retrouvé par code-barres ou par origine, sinon créé. Identifiants déterministes : une reprise complète les écritures manquantes.
 *  Articles suivis : lots prélevés en FEFO (recréés à l'identique dans la boutique de destination, avec leur péremption et leur coût) ; numéros de série
 *  transférés un à un (« transféré » à l'origine, « disponible » à destination), au choix de l'utilisateur ou automatiquement (les plus anciens).
 *  Un transfert avec articles suivis enregistre d'abord son plan (fiche « pending », lots et numéros figés) : une coupure se reprend sans rien doubler. */
type TLine = { productId: string; variantId?: string; qty: number | string; serials?: unknown; lots?: { lotId: string; lotNo: string; expiresAt?: string; manufacturedAt?: string; unitCost: number; supplierId: string; qty: number }[]; name?: string };
export async function transferStock(store: Store, ctx: Ctx, b: { transferId: string; toShopId: string; lines: TLine[] }) {
  needModule(ctx, "stock");
  const tid = safeId(b.transferId); if (tid.length < 8) throw new HttpError(400, "transferId invalide");
  if (!allowedIn(ctx, b.toShopId)) throw new HttpError(403, "Vous n'avez pas accès à la boutique de destination");
  if (b.toShopId === ctx.shopId) throw new HttpError(400, "La destination doit être une autre boutique");
  const dest = await store.get("shops", b.toShopId); if (!dest || dest.tenantId !== ctx.tenantId) throw new HttpError(404, "Boutique de destination introuvable");
  const existing = await store.get("transfers", tid);
  if (existing && existing.tenantId !== ctx.tenantId) throw new HttpError(409, "Identifiant déjà utilisé");
  if (existing && existing.status !== "pending") return { number: existing.number, duplicate: true };
  const pending = existing; // reprise d'un transfert d'articles suivis interrompu : le plan enregistré fait foi
  if (pending && (pending.shopId !== ctx.shopId || pending.toShopId !== b.toShopId)) throw new HttpError(409, "Identifiant déjà utilisé");
  const inputLines: TLine[] = pending ? parse<TLine[]>(pending.lines, []) : b.lines;
  if (!inputLines?.length) throw new HttpError(400, "Transfert vide");
  const base = tid.slice(0, 26);
  const resumed = !!pending || !!(await store.get("stock_moves", `${base}_o0`));
  const number = pending ? String(pending.number) : `TR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${tid.slice(0, 6).toUpperCase()}`;
  const today = new Date().toISOString().slice(0, 10); let policy: Awaited<ReturnType<typeof expiredPolicyOf>> | undefined; let trackedOk: boolean | undefined;
  const seen = new Set<string>(); const items: { src: any; variant: any; qty: number; lots?: TLine["lots"]; serials?: string[] }[] = [];
  for (const l of inputLines) {
    if (seen.has(lineKey(l))) throw new HttpError(400, "Produit en double"); seen.add(lineKey(l));
    const src = await store.get("products", l.productId);
    if (!src || src.tenantId !== ctx.tenantId || src.shopId !== ctx.shopId) throw new HttpError(404, "Produit introuvable");
    let qty: number; try { qty = qtyFor(l.qty, scaleOf(src)); } catch (e) { throw new HttpError(400, `${src.name} : ${(e as Error).message}`); }
    refuseBundle(src, "il ne se transfère pas (virtuel : son stock se déduit des composants ; kit : assemblez-le dans la boutique de destination).");
    const mode = trackingOf(src);
    if (mode) { trackedOk ??= planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, mode === "lot" ? "lots" : "serials"); if (!trackedOk) throw new HttpError(402, "Le transfert d'articles suivis par lot ou numéro de série est réservé à la formule Pro."); }
    let variant: any = null;
    if (src.hasVariants) { variant = l.variantId ? await store.get("article_variants", l.variantId) : null; if (!variant || variant.tenantId !== ctx.tenantId || variant.shopId !== ctx.shopId || variant.productId !== src.$id) throw new HttpError(400, `Choisissez une variante pour ${src.name}`); }
    else if (l.variantId) throw new HttpError(400, `${src.name} n'a pas de variantes`);
    const item: (typeof items)[number] = { src, variant, qty };
    if (mode === "lot") {
      if (pending) item.lots = l.lots ?? [];
      else {
        policy ??= await expiredPolicyOf(store, ctx);
        const stocks = (await lotsWithStock(store, ctx, src.$id, variant?.$id ?? "")).map((x) => ({ id: x.id, qty: x.qty, expiresAt: x.row.expiresAt ? String(x.row.expiresAt) : null, receivedAt: x.row.receivedAt ? String(x.row.receivedAt) : "", status: String(x.row.status ?? "active"), row: x.row }));
        const need = scaledInt(qty, scaleOf(src)), fefo = allocateFefo(stocks, need, today, policy);
        if (fefo.shortage > 0) throw new HttpError(409, `Stock insuffisant : ${src.name}${variant ? ` — ${variant.label}` : ""} (${fromScaled(need - fefo.shortage, scaleOf(src))} transférable${fefo.expiredQty ? `, ${fromScaled(fefo.expiredQty, scaleOf(src))} périmé(s)` : ""}${fefo.blockedQty ? `, ${fromScaled(fefo.blockedQty, scaleOf(src))} bloqué(s)` : ""})`);
        item.lots = fefo.allocations.map((a) => { const r = stocks.find((x) => x.id === a.lotId)!.row; return { lotId: a.lotId, lotNo: String(r.lotNo), ...(r.expiresAt ? { expiresAt: new Date(String(r.expiresAt)).toISOString() } : {}), ...(r.manufacturedAt ? { manufacturedAt: new Date(String(r.manufacturedAt)).toISOString() } : {}), unitCost: Number(r.unitCost ?? 0), supplierId: String(r.supplierId ?? ""), qty: fromScaled(a.qty, scaleOf(src)) }; });
      }
    } else if (mode === "serial") {
      if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, `${src.name} : quantité entière requise`);
      if (pending) item.serials = (l.serials as string[]) ?? [];
      else {
        let given: string[] | null = null;
        if (l.serials !== undefined && l.serials !== null && !(Array.isArray(l.serials) && !l.serials.length) && String(l.serials).trim() !== "") { try { given = parseSerials(l.serials); } catch (e) { throw new HttpError(400, `${src.name} : ${(e as Error).message}`); } }
        const vid = variant?.$id ?? "";
        if (given) {
          if (given.length !== qty) throw new HttpError(400, `${src.name} : indiquez exactement ${qty} numéro${qty > 1 ? "s" : ""} de série`);
          for (const sn of given) {
            const r = await store.get("article_serials", serialRowId(src.$id, sn));
            if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId || String(r.variantId ?? "") !== vid) throw new HttpError(404, `Numéro de série inconnu : ${sn}`);
            if (r.status !== "available") throw new HttpError(409, `Numéro de série indisponible : ${sn} (${r.status})`);
          }
          item.serials = given;
        } else {
          const pool = (await store.scan("article_serials", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: src.$id, status: "available" }, { maxRows: 5000 })).rows.filter((r) => String(r.variantId ?? "") === vid).sort((a, c) => String(a.receivedAt ?? "").localeCompare(String(c.receivedAt ?? "")) || String(a.serial).localeCompare(String(c.serial)));
          if (pool.length < qty) throw new HttpError(409, `Stock insuffisant : ${src.name}${variant ? ` — ${variant.label}` : ""} (${pool.length} unité${pool.length > 1 ? "s" : ""} disponible${pool.length > 1 ? "s" : ""})`);
          item.serials = pool.slice(0, qty).map((r) => String(r.serial));
        }
      }
    } else if (!resumed) { const have = variant ? fromScaled(await stockScaledVariant(store, variant.$id), scaleOf(src)) : await stockFor(store, src.$id, scaleOf(src)); if (have < qty) throw new HttpError(409, `Stock insuffisant : ${src.name}${variant ? ` — ${variant.label}` : ""} (${have})`); }
    items.push(item);
  }
  const tracked = items.some((x) => x.lots || x.serials);
  const tctx = { ...ctx, shopId: b.toShopId };
  // Boutique de destination : article, variante, lots et numéros déjà connus ? (résolu une fois, réutilisé par les contrôles et l'écriture)
  const resolve = async (src: any, variant: any, i: number) => {
    const origin = String(src.originId || src.$id);
    let target = (await store.list("products", { tenantId: ctx.tenantId, shopId: b.toShopId, originId: origin }, 1))[0];
    if (!target && src.barcode) target = (await store.list("products", { tenantId: ctx.tenantId, shopId: b.toShopId, barcode: String(src.barcode) }, 1))[0];
    const targetId = target?.$id ?? `${base}_p${i}`;
    if (target && scaleOf(target) !== scaleOf(src)) throw new HttpError(409, `${src.name} : la précision des quantités diffère entre les deux boutiques`);
    if (target && trackingOf(target) !== trackingOf(src)) throw new HttpError(409, `${src.name} : le mode de suivi (lot / numéro de série) diffère dans la boutique de destination`);
    let tv: any;
    if (variant && target) tv = (await store.list("article_variants", { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, attrKey: String(variant.attrKey) }, 1))[0];
    return { origin, target, targetId, tv };
  };
  if (tracked && !pending) { // contrôles AVANT toute écriture : lots et numéros en conflit dans la boutique de destination
    for (const [i, it] of items.entries()) {
      if (!it.lots && !it.serials) continue;
      const r = await resolve(it.src, it.variant, i); if (!r.target) continue;
      for (const a of it.lots ?? []) await checkLot(store, tctx, r.target, r.tv?.$id ?? "", { lotNo: a.lotNo, qty: a.qty, ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}) });
      for (const sn of it.serials ?? []) { const cur = await store.get("article_serials", serialRowId(r.targetId, sn)); if (cur && cur.status !== "transferred") throw new HttpError(409, `Numéro de série déjà enregistré dans la boutique de destination : ${sn}`); }
    }
  }
  const planLines = () => items.map((x) => ({ productId: x.src.$id, ...(x.variant ? { variantId: x.variant.$id } : {}), name: x.variant ? `${x.src.name} — ${x.variant.label}` : x.src.name, qty: x.qty, ...(x.lots ? { lots: x.lots } : {}), ...(x.serials ? { serials: x.serials } : {}) }));
  if (tracked && !pending) await store.create("transfers", tid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, toShopId: b.toShopId, number, lines: JSON.stringify(planLines()), userId: ctx.userId, status: "pending" });
  // Numéros de série : chaque sortie « réserve » son numéro par un mouvement à identifiant unique (numéro + cycle) ; conflit → tout est annulé et le plan retiré.
  if (tracked) {
    const claimed: string[] = [];
    for (const it of items) for (const sn of it.serials ?? []) {
      const rid = serialRowId(it.src.$id, sn); const cur = await store.get("article_serials", rid); const cid = `${rid}_${Number(cur?.cycle ?? 0)}`.slice(0, 36);
      const ok = await store.create("stock_moves", cid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: it.src.$id, ...(it.variant ? { variantId: it.variant.$id } : {}), serial: sn, qty: 1, kind: "transfer_out", refId: number, userId: ctx.userId });
      if (ok) claimed.push(cid);
      else if ((await store.get("stock_moves", cid))?.refId !== number) { for (const c of claimed) await store.remove("stock_moves", c); if (!pending) await store.remove("transfers", tid); throw new HttpError(409, `Numéro de série déjà vendu ou transféré : ${sn}`); }
    }
  }
  for (const [i, it] of items.entries()) {
    const { src, variant, qty } = it;
    const { origin, target, targetId, tv } = await resolve(src, variant, i);
    if (!target) await store.create("products", targetId, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, name: src.name, sku: src.sku ?? "", barcode: src.barcode ?? "", category: src.category ?? "", price: src.price, cost: src.cost ?? 0, minStock: src.minStock ?? 0, archived: false, originId: origin, description: src.description ?? "", unit: src.unit ?? "piece", qtyScale: scaleOf(src), ...(trackingOf(src) ? { tracking: trackingOf(src) } : {}), ...(src.hasVariants ? { hasVariants: true } : {}) });
    // Variante : retrouvée par sa combinaison d'attributs dans la boutique cible, sinon copiée (les stocks restent séparés par boutique).
    let targetVariantId = "";
    if (variant) {
      if (target && !target.hasVariants) throw new HttpError(409, `${src.name} : l'article de la boutique cible n'a pas de variantes`);
      targetVariantId = tv?.$id ?? `${base}_v${i}`;
      if (!tv && !(await store.get("article_variants", targetVariantId))) {
        const free = async (f: "sku" | "barcode") => (variant[f] && !(await store.list("products", { tenantId: ctx.tenantId, shopId: b.toShopId, [f]: variant[f] }, 1)).length && !(await store.list("article_variants", { tenantId: ctx.tenantId, shopId: b.toShopId, [f]: variant[f] }, 1)).length ? variant[f] : "");
        await store.create("article_variants", targetVariantId, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, attributes: variant.attributes, attrKey: variant.attrKey, label: variant.label, sku: await free("sku"), barcode: await free("barcode"), price: variant.price, cost: variant.cost ?? 0, minStock: variant.minStock ?? 0, imageFileId: "", archived: false });
      }
    }
    const vfield = (id: string) => (id ? { variantId: id } : {});
    if (it.lots) {
      for (const [k, a] of it.lots.entries()) {
        const lot = await ensureLot(store, tctx, { $id: targetId, cost: src.cost ?? 0 } as any, targetVariantId, { lotNo: a.lotNo, qty: a.qty, ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}), ...(a.manufacturedAt ? { manufacturedAt: a.manufacturedAt } : {}) }, { supplierId: a.supplierId, unitCost: a.unitCost, receivedAt: new Date().toISOString() });
        await store.create("stock_moves", `${base}_o${i}_${k}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: src.$id, ...vfield(variant?.$id ?? ""), lotId: a.lotId, qty: scaledInt(a.qty, scaleOf(src)), kind: "transfer_out", refId: number, userId: ctx.userId });
        await store.create("stock_moves", `${base}_i${i}_${k}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, ...vfield(targetVariantId), lotId: lot.$id, qty: scaledInt(a.qty, scaleOf(src)), kind: "transfer_in", refId: number, userId: ctx.userId });
      }
      continue;
    }
    if (it.serials) {
      for (const [k, sn] of it.serials.entries()) {
        const srid = serialRowId(src.$id, sn); const srow = await store.get("article_serials", srid); const trid = serialRowId(targetId, sn); const cur = await store.get("article_serials", trid);
        const info = { unitCost: Number(srow?.unitCost ?? 0), warrantyMonths: Number(srow?.warrantyMonths ?? 0), supplierId: String(srow?.supplierId ?? "") };
        if (!cur) await store.create("article_serials", trid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, ...vfield(targetVariantId), serial: sn, status: "available", receivedAt: new Date().toISOString(), ...info, saleId: "", saleRef: "", cycle: 0, entryRef: number });
        else if (cur.entryRef !== number) await store.update("article_serials", trid, { status: "available", saleId: "", saleRef: "", soldAt: null, warrantyUntil: null, cycle: Number(cur.cycle ?? 0) + 1, entryRef: number, ...info }); // numéro revenu dans une boutique où il avait déjà été
        await store.create("stock_moves", `${base}_i${i}_${k}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, ...vfield(targetVariantId), serial: sn, qty: 1, kind: "transfer_in", refId: number, userId: ctx.userId });
        if (srow && srow.status !== "transferred") await store.update("article_serials", srid, { status: "transferred" });
      }
      continue;
    }
    await store.create("stock_moves", `${base}_o${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: src.$id, ...(variant ? { variantId: variant.$id } : {}), qty: scaledInt(qty, scaleOf(src)), kind: "transfer_out", refId: number, userId: ctx.userId });
    await store.create("stock_moves", `${base}_i${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, ...(targetVariantId ? { variantId: targetVariantId } : {}), qty: scaledInt(qty, scaleOf(src)), kind: "transfer_in", refId: number, userId: ctx.userId });
  }
  if (tracked) await store.update("transfers", tid, { status: "done" });
  else await store.create("transfers", tid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, toShopId: b.toShopId, number, lines: JSON.stringify(planLines()), userId: ctx.userId });
  return { number, duplicate: false };
}
