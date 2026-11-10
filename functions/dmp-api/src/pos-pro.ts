import { createHash, createHmac } from "node:crypto";
import { needFeature } from "./articles";
import { planAllows } from "../../../src/domain/features";
import { entitlementOf } from "./subscriptions";
import { HttpError, needModule, roleOf, type BatchOp, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });

// ------------------------------------------------------------------ droits distincts
export const RIGHTS = ["open", "close", "discount", "cancel", "refund", "approve", "authorize", "transfer", "correct"] as const;
export type Right = (typeof RIGHTS)[number];
export const RIGHT_LABEL: Record<Right, string> = { open: "Ouvrir une caisse", close: "Fermer une caisse", discount: "Accorder une remise manuelle", cancel: "Annuler une vente", refund: "Rembourser", approve: "Valider (écarts, marges, approbations)", authorize: "Autoriser les sorties de caisse", transfer: "Transférer une session", correct: "Corriger une session" };
const DEFAULTS: Record<string, readonly Right[]> = { owner: RIGHTS, manager: RIGHTS, cashier: ["open", "close"] };
/** Droits de l'utilisateur : le propriétaire a tout ; sinon la liste fixée par le propriétaire (`staff.posRights`), à défaut celle du rôle (gérant : tout, caissier : ouvrir/fermer). */
export async function rightsOf(store: Store, ctx: Ctx): Promise<readonly Right[]> {
  const role = roleOf(ctx.roles); if (role === "owner") return RIGHTS;
  const staff = await store.get("staff", ctx.userId); if (staff && staff.tenantId === ctx.tenantId && staff.posRights != null && String(staff.posRights) !== "") return parse<string[]>(staff.posRights, []).filter((r): r is Right => (RIGHTS as readonly string[]).includes(r));
  return DEFAULTS[role] ?? [];
}
export const hasRight = async (store: Store, ctx: Ctx, r: Right): Promise<boolean> => (await rightsOf(store, ctx)).includes(r);
export async function needRight(store: Store, ctx: Ctx, r: Right): Promise<void> { if (!(await hasRight(store, ctx, r))) throw new HttpError(403, `Droit manquant : ${RIGHT_LABEL[r]}`); }
/** Propriétaire : fixe les droits de caisse d'un employé. */
export async function setStaffRights(store: Store, ctx: Ctx, b: { userId?: string; rights?: unknown }) {
  needModule(ctx, "pos"); if (roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Réservé au propriétaire"); await needFeature(store, ctx, "smartPosPro");
  const st = await store.get("staff", String(b.userId ?? "")); if (!st || st.tenantId !== ctx.tenantId) throw new HttpError(404, "Employé introuvable");
  if (!Array.isArray(b.rights) || b.rights.some((r) => !(RIGHTS as readonly string[]).includes(String(r)))) throw new HttpError(400, "Droit inconnu"); const rights = [...new Set((b.rights as string[]).map(String))];
  await store.update("staff", st.$id, { posRights: JSON.stringify(rights) }); await audit(store, ctx, "staff.posRights", `${st.$id} ${rights.join(",")}`); return { userId: st.$id, rights };
}
export async function myRights(store: Store, ctx: Ctx) { needModule(ctx, "pos"); return { rights: await rightsOf(store, ctx), labels: RIGHT_LABEL }; }

// ------------------------------------------------------------------ approbations hiérarchiques
export const APPROVAL_KINDS = ["margin", "discount", "refund", "cancel"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
const TTL_MS = 15 * 60_000;
export async function requestApproval(store: Store, ctx: Ctx, b: { kind?: string; details?: unknown; amount?: unknown; refId?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro"); if (!(APPROVAL_KINDS as readonly string[]).includes(String(b.kind))) throw new HttpError(400, "Type d'approbation inconnu");
  const id = newId(); const now = Date.now(); await store.create("pos_approvals", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, kind: String(b.kind), status: "pending", refId: String(b.refId ?? "").slice(0, 64), details: JSON.stringify(b.details ?? {}).slice(0, 4000), amount: Math.round(Number(b.amount ?? 0)) || 0, requestedBy: ctx.userId, requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL_MS).toISOString() });
  await audit(store, ctx, "approval.request", `${b.kind} ${id}`); return { id, expiresAt: new Date(now + TTL_MS).toISOString() };
}
const nameMap = async (store: Store, ctx: Ctx) => { const m = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)])); try { for (const o of await store.listOwners(ctx.tenantId)) m.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible */ } return m; };
/** Le responsable voit les demandes de sa boutique ; le vendeur, les siennes (avec leur issue). */
export async function listApprovals(store: Store, ctx: Ctx, b: { status?: string } = {}) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro"); const mgr = await hasRight(store, ctx, "approve"); const where: Record<string, string> = { tenantId: ctx.tenantId, shopId: ctx.shopId }; if (!mgr) where.requestedBy = ctx.userId; if (b.status) where.status = String(b.status);
  const rows = (await store.scan("pos_approvals", where, { maxRows: 500 })).rows.filter((r) => !String(r.$id).endsWith("_use")).sort((a, c) => iso(c.requestedAt).localeCompare(iso(a.requestedAt))).slice(0, 100); const nm = await nameMap(store, ctx); const now = Date.now();
  return { canDecide: mgr, approvals: rows.map((r) => ({ id: r.$id, kind: String(r.kind), status: String(r.status) === "pending" && Date.parse(iso(r.expiresAt)) < now ? "expired" : String(r.status), amount: Number(r.amount ?? 0), details: parse(r.details, {}), requestedBy: nm.get(String(r.requestedBy)) ?? "", requestedById: String(r.requestedBy), requestedAt: iso(r.requestedAt), decidedBy: r.decidedBy ? nm.get(String(r.decidedBy)) ?? "" : "", expiresAt: iso(r.expiresAt), note: String(r.note ?? "") })) };
}
export async function decideApproval(store: Store, ctx: Ctx, b: { id?: string; approve?: boolean; note?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro"); await needRight(store, ctx, "approve");
  const r = await store.get("pos_approvals", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Demande introuvable");
  if (r.status !== "pending") throw new HttpError(409, "Demande déjà traitée"); if (Date.parse(iso(r.expiresAt)) < Date.now()) throw new HttpError(409, "Demande expirée : le vendeur doit la renouveler");
  if (r.requestedBy === ctx.userId && roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Vous ne pouvez pas valider votre propre demande");
  await store.update("pos_approvals", r.$id, { status: b.approve === false ? "rejected" : "approved", decidedBy: ctx.userId, decidedAt: new Date().toISOString(), note: String(b.note ?? "").slice(0, 200) }); await audit(store, ctx, b.approve === false ? "approval.reject" : "approval.approve", `${r.kind} ${r.$id}`); return { id: r.$id, status: b.approve === false ? "rejected" : "approved" };
}
/** Consomme une approbation : valide (même boutique, même demandeur, bon type, approuvée, non expirée, non utilisée) et renvoie les écritures à joindre à l'opération — une ligne « claim » à identifiant fixe garantit qu'une approbation ne sert qu'une fois, même en cas de ventes simultanées. */
export async function claimApproval(store: Store, ctx: Ctx, id: string, kind: ApprovalKind, usedBy: string, fp?: string): Promise<BatchOp[]> {
  const r = await store.get("pos_approvals", id); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId || r.kind !== kind) throw new HttpError(409, "Approbation invalide pour cette opération");
  if (fp && r.refId && r.refId !== fp) throw new HttpError(409, "Cette approbation a été accordée pour un autre panier");
  if (r.requestedBy !== ctx.userId) throw new HttpError(403, "Cette approbation a été accordée à un autre vendeur");
  if (r.status === "used") throw new HttpError(409, "Approbation déjà utilisée"); if (r.status !== "approved") throw new HttpError(409, "Approbation non accordée"); if (Date.parse(iso(r.expiresAt)) < Date.now()) throw new HttpError(409, "Approbation expirée");
  return [{ kind: "create", table: "pos_approvals", id: `${id}_use`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, kind, status: "claim", refId: id, usedBy, requestedBy: ctx.userId } }, { kind: "update", table: "pos_approvals", id, data: { status: "used", usedBy } }];
}
/** Message structuré lu par l'interface pour proposer la demande d'approbation. */
export const approvalNeeded = (kind: ApprovalKind, why: string, fp = "") => new HttpError(403, `APPROBATION_REQUISE:${kind}:${fp} — ${why}`);

// ------------------------------------------------------------------ journal immuable des opérations financières
export type LedgerEntry = { kind: string; ref: string; amount: number; method?: string; userId?: string; at: string; sessionId?: string; payload?: unknown; /** identifiant de rejeu (par défaut la référence) */ key?: string };
const canon = (ctx: Ctx, e: { kind: string; ref: string; amount: number; method?: string; userId?: string; at: string; sessionId?: string }, payload: string) => `${ctx.tenantId}|${ctx.shopId}|${e.kind}|${e.ref.slice(0, 64)}|${Math.round(e.amount)}|${(e.method ?? "").slice(0, 60)}|${e.userId ?? ""}|${iso(e.at)}|${e.sessionId ?? ""}|${payload}`;
export const ledgerHash = (c: string) => createHash("sha256").update(c).digest("hex");
/** Écriture du journal financier : ajout seul (aucune API de modification ni de suppression, aucune écriture client), empreinte SHA-256 du contenu, identifiant déterministe par (type, référence) donc rejouable sans doublon. */
export function ledgerOp(ctx: Ctx, e0: LedgerEntry): BatchOp {
  const e = { ...e0, userId: e0.userId ?? ctx.userId, sessionId: e0.sessionId ?? "" }; const payload = JSON.stringify(e.payload ?? null).slice(0, 4000);
  const id = `lg${sha(`${ctx.tenantId}|${ctx.shopId}|${e.kind}|${e.key ?? e.ref}`).slice(0, 28)}`;
  return { kind: "create", table: "finance_ledger", id, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, kind: e.kind, ref: e.ref.slice(0, 64), amount: Math.round(e.amount), method: (e.method ?? "").slice(0, 60), userId: e.userId, at: iso(e.at), sessionId: e.sessionId, payload, hash: ledgerHash(canon(ctx, e, payload)) } };
}
/** Écrit une entrée du journal (rejouable : l'identifiant est déterministe, un doublon est ignoré). */
export async function ledgerWrite(store: Store, ctx: Ctx, e: LedgerEntry): Promise<void> { const o = ledgerOp(ctx, e); if (o.kind === "create") await store.create(o.table, o.id, ctx.tenantId, o.data); }
/** La formule Pro est-elle active pour ce commerce ? */
export async function isProPos(store: Store, ctx: Ctx): Promise<boolean> { return planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "smartPosPro"); }
/** Contrôle d'intégrité : recalcule chaque empreinte (contenu modifié ?), vérifie que chaque vente terminée a son écriture de journal du bon montant et signale les écritures sans vente. Gérant (droit « valider »). */
export async function verifyLedger(store: Store, ctx: Ctx, b: { from?: string; to?: string } = {}) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro"); await needRight(store, ctx, "approve");
  const day = /^\d{4}-\d{2}-\d{2}$/; const from = b.from && day.test(b.from) ? `${b.from}T00:00:00.000Z` : new Date(Date.now() - 30 * 864e5).toISOString(); const to = b.to && day.test(b.to) ? new Date(Date.parse(`${b.to}T00:00:00Z`) + 864e5).toISOString() : new Date(Date.now() + 864e5).toISOString();
  const where = { tenantId: ctx.tenantId, shopId: ctx.shopId }; const ledger = (await store.scan("finance_ledger", where, { range: { field: "at", from, to }, maxRows: 50_000 })).rows; const sales = (await store.scan("sales", { ...where, status: "paid" }, { range: { field: "soldAt", from, to }, maxRows: 20_000 })).rows;
  const tampered: { id: string; ref: string; kind: string }[] = []; for (const r of ledger) { const e: LedgerEntry = { kind: String(r.kind), ref: String(r.ref), amount: Number(r.amount), method: String(r.method ?? ""), userId: String(r.userId ?? ""), at: String(r.at), sessionId: String(r.sessionId ?? "") }; if (ledgerHash(canon(ctx, e, String(r.payload ?? "null"))) !== r.hash) tampered.push({ id: r.$id, ref: e.ref, kind: e.kind }); }
  const firstAt = ledger.filter((r) => r.kind === "sale").map((r) => iso(r.at)).sort()[0] ?? ""; const saleKey = (r: Row) => String(parse<{ saleId?: string }>(r.payload, {}).saleId ?? r.ref); const bySale = new Map(ledger.filter((r) => r.kind === "sale").map((r) => [saleKey(r), r])); const missing: { number: string; total: number; reason: string }[] = [];
  for (const s of sales) { const l = bySale.get(String(s.$id)); if (!l) { if (firstAt && iso(s.soldAt) >= firstAt) missing.push({ number: String(s.number), total: Number(s.total), reason: "écriture de journal absente" }); } else if (Number(l.amount) !== Number(s.total)) missing.push({ number: String(s.number), total: Number(s.total), reason: `montant du journal différent (${l.amount})` }); }
  const known = new Set(sales.map((s) => String(s.$id))); const orphans = ledger.filter((r) => r.kind === "sale" && !known.has(saleKey(r))).map((r) => ({ ref: String(r.ref), amount: Number(r.amount) }));
  return { checked: ledger.length, salesChecked: sales.length, ok: !tampered.length && !missing.length && !orphans.length, tampered, missing, orphans, note: "Le journal est en ajout seul (aucune modification ou suppression possible par l'application) ; ce contrôle détecte une altération faite hors application." };
}

// ------------------------------------------------------------------ références de paiement et bons d'achat
export const refClaimOp = (ctx: Ctx, method: string, reference: string, saleId: string, amount: number): BatchOp => ({ kind: "create", table: "payment_refs", id: `pr${sha(`${ctx.tenantId}|${method}|${reference.trim().toUpperCase()}`).slice(0, 28)}`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, saleId, method, reference: reference.trim().slice(0, 64), amount } });
/** Une référence de transaction ne peut servir qu'à UNE vente (doublon de paiement) : message explicite avec la vente d'origine. */
export async function assertRefFree(store: Store, ctx: Ctx, method: string, reference: string, saleId: string): Promise<void> {
  const op = refClaimOp(ctx, method, reference, saleId, 0); const r = await store.get("payment_refs", op.id);
  if (r && r.tenantId === ctx.tenantId && r.saleId !== saleId) { const s = await store.get("sales", String(r.saleId)); throw new HttpError(409, `Référence « ${reference.trim()} » déjà utilisée pour un paiement ${method}${s ? ` (vente ${s.number})` : ""} : doublon de paiement refusé`); }
}
export type Voucher = { uses: number; id: string; code: string; initial: number; balance: number; status: string; expiresAt: string; customerId: string };
export async function voucherByCode(store: Store, ctx: Ctx, rawCode: string): Promise<Voucher | null> {
  const code = rawCode.trim().toUpperCase(); const v = (await store.list("customer_vouchers", { tenantId: ctx.tenantId, code, kind: "voucher" }, 2))[0]; if (!v) return null;
  const usesRows = await store.list("customer_vouchers", { tenantId: ctx.tenantId, code, kind: "use" }, 5000); const used = usesRows.reduce((a, u) => a + Number(u.amount), 0);
  return { uses: usesRows.length, id: v.$id, code, initial: Number(v.amount), balance: Number(v.amount) - used, status: String(v.status), expiresAt: v.expiresAt ? iso(v.expiresAt) : "", customerId: String(v.customerId ?? "") };
}
export async function checkVoucher(store: Store, ctx: Ctx, b: { code?: string; customerId?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro"); const v = await voucherByCode(store, ctx, String(b.code ?? "")); if (!v) throw new HttpError(404, "Bon d'achat inconnu");
  const expired = !!v.expiresAt && Date.parse(v.expiresAt) < Date.now(); const reason = v.status !== "active" ? "bon désactivé" : expired ? "bon expiré" : v.balance <= 0 ? "solde épuisé" : v.customerId && v.customerId !== b.customerId ? "bon nominatif : identifiez son titulaire" : ""; return { ...v, usable: !reason, reason };
}
/** Code d'avoir dérivé d'une graine (identifiant d'opération) : un remboursement rejoué recrée le MÊME bon, jamais deux. */
export const voucherCodeFor = (seed: string): string => { const h = createHash("sha256").update(seed).digest(); return `AV-${Array.from({ length: 8 }, (_, i) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[h[i]! % 32]).join("")}`; };
export function newVoucherOps(ctx: Ctx, amount: number, ref: string, customerId?: string, code0?: string): { code: string; ops: BatchOp[] } {
  const code = code0 ?? voucherCodeFor(`${ctx.tenantId}|${ref}|${Date.now()}|${Math.random()}`); const exp = new Date(Date.now() + 365 * 864e5).toISOString();
  return { code, ops: [{ kind: "create", table: "customer_vouchers", id: `vc${sha(`${ctx.tenantId}|${code}`).slice(0, 28)}`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, kind: "voucher", code, customerId: customerId ?? "", amount, status: "active", expiresAt: exp, createdBy: ctx.userId, createdAt: new Date().toISOString(), ref } }] };
}
/** Identifiant = (bon, rang d'utilisation) : deux ventes simultanées visent le même rang, une seule réussit — le solde ne peut pas être dépensé deux fois. */
export const voucherUseOp = (ctx: Ctx, code: string, amount: number, saleId: string, slot: number): BatchOp => ({ kind: "create", table: "customer_vouchers", id: `vu${sha(`${ctx.tenantId}|${code}|${slot}`).slice(0, 28)}`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, kind: "use", code, amount, status: "used", createdBy: ctx.userId, createdAt: new Date().toISOString(), ref: saleId } });

// ------------------------------------------------------------------ code de vérification du ticket (QR)
export const secret = () => process.env.DMP_RECEIPT_KEY || process.env.APPWRITE_API_KEY || "dmp-dev-receipt-key";
/** Signature HMAC du ticket : le QR imprimé permet de vérifier, dans l'application, que le ticket correspond à une vente réelle de ce commerce (un ticket falsifié ne se vérifie pas). */
export const receiptCode = (tenantId: string, number: string, total: number, soldAt: string): string => `DMP1.${number}.${Math.round(total)}.${createHmac("sha256", secret()).update(`${tenantId}|${number}|${Math.round(total)}|${iso(soldAt)}`).digest("hex").slice(0, 16)}`;
export async function verifyReceipt(store: Store, ctx: Ctx, b: { code?: string }) {
  needModule(ctx, "pos"); const m = /^DMP1\.([A-Za-z0-9-]+)\.(\d+)\.([0-9a-f]{16})$/.exec(String(b.code ?? "").trim()); if (!m) return { authentic: false, reason: "Code illisible" };
  const cands = await store.list("sales", { tenantId: ctx.tenantId, number: m[1]! }, 50); const sale = cands.find((c) => receiptCode(ctx.tenantId, String(c.number), Number(c.total), String(c.soldAt)) === m[0]) ?? cands[0]; if (!sale) return { authentic: false, reason: "Aucune vente de ce commerce ne porte ce numéro" };
  const ok = receiptCode(ctx.tenantId, String(sale.number), Number(sale.total), String(sale.soldAt)) === m[0]; if (!ok) return { authentic: false, reason: "Signature invalide : le ticket ne correspond pas à la vente enregistrée" };
  return { authentic: true, number: String(sale.number), total: Number(sale.total), soldAt: iso(sale.soldAt), status: String(sale.status), shopId: String(sale.shopId) };
}
void ledgerOp;
export type { Row };
