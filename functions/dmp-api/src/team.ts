import { qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { stockFor } from "./checkout";
import { HttpError, need, type Ctx, type Store, needModule } from "./store";
import { assertQuota, getSub, grantLifetime } from "./subscriptions";
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
 *  est retrouvé par code-barres ou par origine, sinon créé. Identifiants déterministes : une reprise complète les écritures manquantes. */
export async function transferStock(store: Store, ctx: Ctx, b: { transferId: string; toShopId: string; lines: { productId: string; qty: number }[] }) {
  needModule(ctx, "stock");
  const tid = safeId(b.transferId); if (tid.length < 8) throw new HttpError(400, "transferId invalide");
  if (!allowedIn(ctx, b.toShopId)) throw new HttpError(403, "Vous n'avez pas accès à la boutique de destination");
  if (b.toShopId === ctx.shopId) throw new HttpError(400, "La destination doit être une autre boutique");
  const dest = await store.get("shops", b.toShopId); if (!dest || dest.tenantId !== ctx.tenantId) throw new HttpError(404, "Boutique de destination introuvable");
  const existing = await store.get("transfers", tid);
  if (existing) { if (existing.tenantId !== ctx.tenantId) throw new HttpError(409, "Identifiant déjà utilisé"); return { number: existing.number, duplicate: true }; }
  if (!b.lines?.length) throw new HttpError(400, "Transfert vide");
  const base = tid.slice(0, 26);
  const resumed = !!(await store.get("stock_moves", `${base}_o0`));
  const seen = new Set<string>(); const items: { src: any; qty: number }[] = [];
  for (const l of b.lines) {
    if (seen.has(l.productId)) throw new HttpError(400, "Produit en double"); seen.add(l.productId);
    const src = await store.get("products", l.productId);
    if (!src || src.tenantId !== ctx.tenantId || src.shopId !== ctx.shopId) throw new HttpError(404, "Produit introuvable");
    let qty: number; try { qty = qtyFor(l.qty, scaleOf(src)); } catch (e) { throw new HttpError(400, `${src.name} : ${(e as Error).message}`); }
    if (!resumed) { const have = await stockFor(store, src.$id, scaleOf(src)); if (have < qty) throw new HttpError(409, `Stock insuffisant : ${src.name} (${have})`); }
    items.push({ src, qty });
  }
  const number = `TR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${tid.slice(0, 6).toUpperCase()}`;
  for (const [i, { src, qty }] of items.entries()) {
    const origin = String(src.originId || src.$id);
    let target = (await store.list("products", { tenantId: ctx.tenantId, shopId: b.toShopId, originId: origin }, 1))[0];
    if (!target && src.barcode) target = (await store.list("products", { tenantId: ctx.tenantId, shopId: b.toShopId, barcode: String(src.barcode) }, 1))[0];
    const targetId = target?.$id ?? `${base}_p${i}`;
    if (target && scaleOf(target) !== scaleOf(src)) throw new HttpError(409, `${src.name} : la précision des quantités diffère entre les deux boutiques`);
    if (!target) await store.create("products", targetId, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, name: src.name, sku: src.sku ?? "", barcode: src.barcode ?? "", category: src.category ?? "", price: src.price, cost: src.cost ?? 0, minStock: src.minStock ?? 0, archived: false, originId: origin, description: src.description ?? "", unit: src.unit ?? "piece", qtyScale: scaleOf(src) });
    await store.create("stock_moves", `${base}_o${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: src.$id, qty: scaledInt(qty, scaleOf(src)), kind: "transfer_out", refId: number, userId: ctx.userId });
    await store.create("stock_moves", `${base}_i${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: b.toShopId, productId: targetId, qty: scaledInt(qty, scaleOf(src)), kind: "transfer_in", refId: number, userId: ctx.userId });
  }
  await store.create("transfers", tid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, toShopId: b.toShopId, number, lines: JSON.stringify(items.map((x) => ({ productId: x.src.$id, name: x.src.name, qty: x.qty }))), userId: ctx.userId });
  return { number, duplicate: false };
}
