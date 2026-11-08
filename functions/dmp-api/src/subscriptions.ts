import { buildPaymentUrl, linkRef } from "../../../src/domain/payment-links";
import {
  MAX_COUNT, PERIODS, TRIAL, addPeriod, canAdd, entitlement, mergePlans, planById, priceFor, renewal, validCount,
  type Entitlement, type Period, type Plan, type PlanId, type Sub,
} from "../../../src/domain/subscriptions";
import { HttpError, need, type Ctx, type Row, type Store } from "./store";

const safeId = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const must = <T,>(v: T | null | undefined, msg: string, status = 404): T => { if (v == null) throw new HttpError(status, msg); return v; };
const PLATFORM = "main";

// ---------- lecture de l'état ----------
export async function loadPlans(store: Store): Promise<Plan[]> {
  const s = await store.get("platform_settings", PLATFORM);
  try { return mergePlans(s?.plans ? JSON.parse(String(s.plans)) : null); } catch { return mergePlans(null); } // une surcharge corrompue ne doit jamais bloquer les ventes
}

const toSub = (r: Row): Sub => ({ plan: r.plan as PlanId, period: r.period as Period, status: r.status === "trial" ? "trial" : "paid", renewsAt: String(r.renewsAt) });

/** Abonnement du commerce ; crée l'essai gratuit à la première lecture (identifiant = tenantId : idempotent). */
export async function getSub(store: Store, tenantId: string, now = new Date()): Promise<Sub> {
  const row = await store.get("subscriptions", tenantId);
  if (row) return toSub(row);
  const sub: Sub = { plan: TRIAL.plan, period: "day", status: "trial", renewsAt: new Date(now.getTime() + TRIAL.days * 86_400_000).toISOString() };
  await store.create("subscriptions", tenantId, tenantId, { tenantId, plan: sub.plan, period: sub.period, status: "trial", startedAt: now.toISOString(), renewsAt: sub.renewsAt });
  return (await store.get("subscriptions", tenantId).then((r) => (r ? toSub(r) : sub)));
}

export async function entitlementOf(store: Store, tenantId: string, now = new Date()): Promise<Entitlement> {
  return entitlement(await getSub(store, tenantId, now), await loadPlans(store), now);
}

/** Verrou : un abonnement expiré (hors délai de grâce) interdit toute action d'écriture. */
export async function assertWritable(store: Store, tenantId: string): Promise<Entitlement> {
  const e = await entitlementOf(store, tenantId);
  if (!e.writable) throw new HttpError(402, "Abonnement expiré : renouvelez-le pour continuer (Réglages → Abonnement)");
  return e;
}

export type Usage = { shops: number; users: number; products: number };
export async function usageOf(store: Store, tenantId: string, caps: Entitlement["limits"]): Promise<Usage> {
  const shops = await store.list("shops", { tenantId }, 100);
  const staff = await store.list("staff", { tenantId }, 1000);
  const cap = caps.maxProducts < 0 ? 5000 : caps.maxProducts + 1; // inutile de compter au-delà du plafond
  const products = await store.list("products", { tenantId }, Math.max(cap, 1));
  return { shops: shops.length, users: 1 + staff.filter((s) => s.active !== false).length, products: products.filter((p) => !p.archived).length };
}

export type QuotaKind = "shops" | "users" | "products";
/** Lève 402 si l'ajout dépasse le quota de la formule. `add` = nombre d'éléments à ajouter. */
export async function assertQuota(store: Store, tenantId: string, kind: QuotaKind, add = 1): Promise<void> {
  const e = await assertWritable(store, tenantId);
  const max = { shops: e.limits.maxShops, users: e.limits.maxUsers, products: e.limits.maxProducts }[kind];
  if (max < 0) return;
  const used = (await usageOf(store, tenantId, e.limits))[kind];
  if (!canAdd(used + add - 1, max)) {
    const what = { shops: "boutiques", users: "utilisateurs", products: "produits" }[kind];
    throw new HttpError(402, `Limite de la formule ${e.plan.name} atteinte : ${max} ${what}. Passez à une formule supérieure.`);
  }
}

// ---------- côté commerçant ----------
export async function subscriptionGet(store: Store, ctx: Ctx) {
  need(ctx, "cashier");
  const [e, plans, platform] = await Promise.all([entitlementOf(store, ctx.tenantId), loadPlans(store), store.get("platform_settings", PLATFORM)]);
  const usage = await usageOf(store, ctx.tenantId, e.limits);
  const mine = ctx.roles.includes("owner") ? (await store.list("subscription_payments", { tenantId: ctx.tenantId }, 30)).map((p) => ({ id: p.$id, plan: p.plan, period: p.period, count: p.count, amount: p.amount, provider: p.provider, status: p.status, reference: p.reference, url: p.status === "awaiting_payment" ? p.url : undefined, note: p.note, endsAt: p.endsAt, createdAt: p.$createdAt })) : [];
  return { entitlement: e, plans, usage, providers: { wave: !!platform?.waveTemplate, orange: !!platform?.orangeTemplate }, payments: mine };
}

/** Crée un lien de paiement vers le compte Wave / Orange Business de la plateforme. Idempotent par requestId. */
export async function subscriptionCheckout(store: Store, ctx: Ctx, b: { requestId: string; plan: string; period: string; count: number; provider: string }) {
  need(ctx, "owner");
  const id = safeId(b.requestId); if (id.length < 8) throw new HttpError(400, "requestId invalide");
  const existing = await store.get("subscription_payments", id);
  if (existing) { if (existing.tenantId !== ctx.tenantId) throw new HttpError(409, "Identifiant déjà utilisé"); return { id, url: existing.url, reference: existing.reference, amount: existing.amount, duplicate: true }; }
  const plans = await loadPlans(store);
  const plan = must(planById(plans, String(b.plan)), "Formule inconnue", 400);
  if (!PERIODS.includes(b.period as Period)) throw new HttpError(400, "Période invalide");
  const period = b.period as Period;
  if (!validCount(period, b.count)) throw new HttpError(400, `Quantité invalide (1 à ${MAX_COUNT[period]})`);
  if (b.provider !== "wave" && b.provider !== "orange") throw new HttpError(400, "Opérateur invalide");
  const platform = must(await store.get("platform_settings", PLATFORM), "Paiement par abonnement non configuré", 409);
  const template = String(b.provider === "wave" ? platform.waveTemplate : platform.orangeTemplate ?? "");
  if (!template) throw new HttpError(409, `Paiement ${b.provider} non disponible pour le moment`);
  const amount = priceFor(plan, period, b.count);
  if (!(amount > 0)) throw new HttpError(409, "Tarif non configuré");
  const open = (await store.list("subscription_payments", { tenantId: ctx.tenantId }, 50)).filter((p) => p.status === "awaiting_payment" || p.status === "pending_review").length;
  if (open >= 10) throw new HttpError(429, "Trop de demandes en attente : finalisez ou attendez la validation des précédentes");
  const reference = linkRef(id).replace("DMP-", "ABO-");
  const url = buildPaymentUrl(template, { amount, ref: reference });
  const shops = await store.list("shops", { tenantId: ctx.tenantId }, 1);
  await store.create("subscription_payments", id, ctx.tenantId, { tenantId: ctx.tenantId, tenantName: String(shops[0]?.name ?? ctx.tenantId).slice(0, 120), plan: plan.id, period, count: b.count, amount, provider: b.provider, reference, url, status: "awaiting_payment", txRef: "", requestedBy: ctx.userId });
  return { id, url, reference, amount, duplicate: false };
}

/** Le commerçant déclare avoir payé et fournit l'ID de transaction. L'activation reste soumise à la validation de la plateforme. */
export async function subscriptionSubmitProof(store: Store, ctx: Ctx, b: { paymentId: string; txRef: string }) {
  need(ctx, "owner");
  const p = must(await store.get("subscription_payments", String(b.paymentId)), "Demande introuvable");
  if (p.tenantId !== ctx.tenantId) throw new HttpError(403, "Accès refusé");
  const txRef = String(b.txRef ?? "").trim().toUpperCase();
  if (txRef.length < 6) throw new HttpError(400, "ID de transaction requis (6 caractères min.)");
  if (p.status === "pending_review" && p.txRef === txRef) return { status: "pending_review" };
  if (p.status !== "awaiting_payment") throw new HttpError(409, `Demande déjà ${p.status === "approved" ? "validée" : p.status === "rejected" ? "refusée" : "traitée"}`);
  const dup = (await store.list("subscription_payments", { txRef }, 2)).filter((x) => x.$id !== p.$id);
  if (dup.length) throw new HttpError(409, "Cet ID de transaction a déjà été utilisé");
  await store.update("subscription_payments", p.$id, { status: "pending_review", txRef });
  return { status: "pending_review" };
}

// ---------- côté plateforme (administrateur) ----------
async function applySubscription(store: Store, tenantId: string, plan: PlanId, period: Period, startsAt: string, endsAt: string) {
  const row = await store.get("subscriptions", tenantId);
  const data = { tenantId, plan, period, status: "paid", startedAt: startsAt, renewsAt: endsAt };
  if (!row) { await store.create("subscriptions", tenantId, tenantId, data); return; }
  // Idempotent : une reprise ne doit jamais raccourcir un abonnement déjà prolongé par un paiement plus récent.
  if (row.plan === plan && new Date(String(row.renewsAt)).getTime() >= new Date(endsAt).getTime() && row.status === "paid") return;
  await store.update("subscriptions", tenantId, data);
}
const audit = (store: Store, ctx: Ctx, tenantId: string, action: string, detail: string) =>
  store.create("audit_log", newId(), tenantId, { tenantId, shopId: "platform", userId: ctx.userId, action, detail: detail.slice(0, 500) });

export async function platformMe(_s: Store, ctx: Ctx) { return { admin: !!ctx.admin }; }
const adminOnly = (ctx: Ctx) => { if (!ctx.admin) throw new HttpError(403, "Réservé à l'administrateur de la plateforme"); };

export async function platformPayments(store: Store, ctx: Ctx, b: { status?: string }) {
  adminOnly(ctx);
  const status = ["pending_review", "approved", "rejected", "awaiting_payment"].includes(String(b.status)) ? String(b.status) : "pending_review";
  const rows = await store.list("subscription_payments", { status }, 100);
  return { payments: rows.map((p) => ({ id: p.$id, tenantId: p.tenantId, tenantName: p.tenantName, plan: p.plan, period: p.period, count: p.count, amount: p.amount, provider: p.provider, reference: p.reference, txRef: p.txRef, status: p.status, note: p.note, createdAt: p.$createdAt })) };
}

export async function platformReview(store: Store, ctx: Ctx, b: { paymentId: string; approve: boolean; note?: string }) {
  adminOnly(ctx);
  const p = must(await store.get("subscription_payments", String(b.paymentId)), "Demande introuvable");
  const note = String(b.note ?? "").slice(0, 200);
  if (!b.approve) {
    if (p.status === "approved") throw new HttpError(409, "Déjà validée : impossible de refuser");
    if (p.status !== "rejected") { await store.update("subscription_payments", p.$id, { status: "rejected", reviewedBy: ctx.userId, note }); await audit(store, ctx, String(p.tenantId), "subscription.reject", `${p.reference} ${note}`); }
    return { status: "rejected" };
  }
  if (p.status !== "pending_review" && p.status !== "approved") throw new HttpError(409, p.status === "rejected" ? "Demande refusée" : "Le commerçant n'a pas encore fourni d'ID de transaction");
  const tenantId = String(p.tenantId);
  if (p.status === "pending_review") {
    const cur = await store.get("subscriptions", tenantId);
    const r = renewal(cur ? toSub(cur) : null, p.plan as PlanId, p.period as Period, Number(p.count), new Date());
    // Les bornes sont figées sur la demande AVANT de toucher l'abonnement : une reprise réapplique les mêmes dates.
    await store.update("subscription_payments", p.$id, { status: "approved", reviewedBy: ctx.userId, note, startsAt: r.start.toISOString(), endsAt: r.end.toISOString() });
    p.startsAt = r.start.toISOString(); p.endsAt = r.end.toISOString();
    await audit(store, ctx, tenantId, "subscription.approve", `${p.reference} ${p.plan}/${p.period}x${p.count} ${p.amount}`);
  }
  await applySubscription(store, tenantId, p.plan as PlanId, p.period as Period, String(p.startsAt), String(p.endsAt));
  return { status: "approved", endsAt: p.endsAt };
}

/** Attribution manuelle (paiement en espèces, geste commercial). Laisse une trace comme un paiement validé. Idempotente par grantId. */
export async function platformGrant(store: Store, ctx: Ctx, b: { grantId: string; tenantId: string; plan: string; period: string; count: number; note?: string }) {
  adminOnly(ctx);
  const id = safeId(b.grantId); if (id.length < 8) throw new HttpError(400, "grantId invalide");
  const existing = await store.get("subscription_payments", id);
  const plan = must(planById(await loadPlans(store), String(b.plan)), "Formule inconnue", 400);
  if (!PERIODS.includes(b.period as Period)) throw new HttpError(400, "Période invalide");
  const period = b.period as Period;
  if (!validCount(period, b.count)) throw new HttpError(400, `Quantité invalide (1 à ${MAX_COUNT[period]})`);
  const tenantId = String(b.tenantId ?? "");
  const shops = await store.list("shops", { tenantId }, 1);
  if (!shops.length) throw new HttpError(404, "Commerce introuvable");
  if (!existing) {
    const cur = await store.get("subscriptions", tenantId);
    const r = renewal(cur ? toSub(cur) : null, plan.id, period, b.count, new Date());
    await store.create("subscription_payments", id, tenantId, { tenantId, tenantName: String(shops[0]!.name ?? tenantId).slice(0, 120), plan: plan.id, period, count: b.count, amount: 0, provider: "manual", reference: "MANUEL", url: "", status: "approved", txRef: "", requestedBy: ctx.userId, reviewedBy: ctx.userId, note: String(b.note ?? "").slice(0, 200), startsAt: r.start.toISOString(), endsAt: r.end.toISOString() });
  }
  const p = must(await store.get("subscription_payments", id), "Introuvable");
  if (p.tenantId !== tenantId) throw new HttpError(409, "Identifiant déjà utilisé");
  await applySubscription(store, tenantId, plan.id, period, String(p.startsAt), String(p.endsAt));
  if (!existing) await audit(store, ctx, tenantId, "subscription.grant", `${plan.id}/${period}x${b.count} ${String(b.note ?? "")}`);
  return { endsAt: p.endsAt, duplicate: !!existing };
}

export async function platformSettingsSave(store: Store, ctx: Ctx, b: { waveTemplate?: string; orangeTemplate?: string; plans?: unknown }) {
  adminOnly(ctx);
  for (const t of [b.waveTemplate, b.orangeTemplate]) if (t) buildPaymentUrl(t, { amount: 1, ref: "TEST" });
  let plans: string | undefined;
  if (b.plans !== undefined) { try { mergePlans(b.plans); } catch (e) { throw new HttpError(400, (e as Error).message); } plans = JSON.stringify(b.plans ?? []); }
  const prev = await store.get("platform_settings", PLATFORM);
  const data = { waveTemplate: b.waveTemplate ?? prev?.waveTemplate ?? "", orangeTemplate: b.orangeTemplate ?? prev?.orangeTemplate ?? "", plans: plans ?? prev?.plans ?? "" };
  if (!(await store.create("platform_settings", PLATFORM, "", data))) await store.update("platform_settings", PLATFORM, data);
  return { ok: true };
}
export async function platformSettingsGet(store: Store, ctx: Ctx) {
  adminOnly(ctx);
  const s = await store.get("platform_settings", PLATFORM);
  return { wave: !!s?.waveTemplate, orange: !!s?.orangeTemplate, plans: await loadPlans(store) }; // les modèles de lien ne sont jamais renvoyés
}
export { addPeriod };
