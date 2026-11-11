/** MASTER DOGUI — étape 1 : licence indépendante de l'abonnement DOGUI MART PRO (essai unique, période payante, mode consultation).
 *  Aucune IA ici. Toute activation est faite par la plateforme, idempotente et journalisée. Les autres modules ne dépendent jamais de cette licence. */
import { createHash } from "node:crypto";
import { MASTER, applyPurchase, phoneKey, reminderOf, startTrial, viewOf, type Lic, type Purchase } from "../../../src/domain/master";
import { roleKind } from "./fin-rules";
import { HttpError, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const h256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const audit = (store: Store, ctx: Ctx, tenantId: string, action: string, detail: string) => store.create("audit_log", newId(), tenantId, { tenantId, shopId: "platform", userId: ctx.userId, action, detail: detail.slice(0, 500) });
const adminOnly = (ctx: Ctx) => { if (!ctx.admin) throw new HttpError(403, "Réservé à l'administrateur de la plateforme"); };
type Hist = { id: string; kind: string; count?: number; amount: number; from: string; to: string; at: string; by: string; note: string };
const licOf = (r: Row | null): Lic => (r ? { trialStartedAt: r.trialStartedAt ? new Date(String(r.trialStartedAt)).toISOString() : undefined, trialEndsAt: r.trialEndsAt ? new Date(String(r.trialEndsAt)).toISOString() : undefined, firstPaidAt: r.firstPaidAt ? new Date(String(r.firstPaidAt)).toISOString() : undefined, paidUntil: r.paidUntil ? new Date(String(r.paidUntil)).toISOString() : undefined } : {});
const histOf = (r: Row | null): Hist[] => { try { const v = JSON.parse(String(r?.history ?? "[]")); return Array.isArray(v) ? v : []; } catch { return []; } };
const own = (r: Row | null, tenantId: string): Row | null => (r && r.tenantId === tenantId ? r : null);

/** État de la licence d'une entreprise (lecture seule, sans effet de bord). */
export async function masterEntitlement(store: Store, tenantId: string, now = new Date()) { const r = own(await store.get("md_licenses", tenantId), tenantId); return { ...viewOf(licOf(r), now), lic: licOf(r) }; }
/** Garde des futures analyses MASTER DOGUI : refuse hors essai ou période payante. Ne conditionne AUCUN autre module. */
export async function needMaster(store: Store, ctx: Ctx): Promise<void> { const e = await masterEntitlement(store, ctx.tenantId); if (!e.canAnalyze) throw new HttpError(402, e.state === "none" ? "MASTER DOGUI : démarrez l'essai gratuit de 14 jours pour lancer des analyses" : "MASTER DOGUI : licence expirée. L'historique reste consultable ; renouvelez pour lancer de nouvelles analyses"); }

export async function license(store: Store, ctx: Ctx) {
  if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants");
  const r = own(await store.get("md_licenses", ctx.tenantId), ctx.tenantId); const v = viewOf(licOf(r), new Date());
  return { ...v, reminder: reminderOf(v), trialDays: MASTER.trialDays, canStartTrial: roleKind(ctx) === "owner" && v.state === "none" && !v.trialUsed, isOwner: roleKind(ctx) === "owner", history: histOf(r).slice(-20).reverse(), notes: ["La licence MASTER DOGUI est indépendante de votre formule (Starter, Business, Pro) et rattachée à l'entreprise.", "L'activation est confirmée par notre équipe après vérification du paiement.", "Aucun débit automatique : à l'échéance, la licence passe en mode consultation."] };
}
const trialKeys = async (store: Store, tenantId: string): Promise<{ email: string; phone: string }> => { const email = await ownerKey(store, tenantId); const shop = (await store.list("shops", { tenantId }, 20)).sort((a, c) => String(a.$createdAt ?? "").localeCompare(String(c.$createdAt ?? "")))[0]; const pk = phoneKey(shop?.phone); return { email, phone: pk ? `mp${h256(`master-trial-phone|${pk}`).slice(0, 30)}` : "" }; };
const ownerKey = async (store: Store, tenantId: string): Promise<string> => { const o = (await store.listOwners(tenantId))[0]; const email = String(o?.email ?? "").trim().toLowerCase(); return email ? `mt${h256(`master-trial|${email}`).slice(0, 30)}` : ""; };
export async function trialStart(store: Store, ctx: Ctx) {
  if (roleKind(ctx) !== "owner") throw new HttpError(403, "Seul le propriétaire démarre l'essai MASTER DOGUI");
  const cur = own(await store.get("md_licenses", ctx.tenantId), ctx.tenantId); if (cur?.trialStartedAt || cur?.firstPaidAt) return { duplicate: true, ...viewOf(licOf(cur), new Date()) };
  const now = new Date(); const keys = await trialKeys(store, ctx.tenantId); if (!keys.phone) throw new HttpError(400, "Renseignez le numéro de téléphone de votre boutique (Réglages) avant de démarrer l'essai : il sert à garantir un essai unique par entreprise.");
  const made: string[] = []; for (const k of [keys.email, keys.phone].filter(Boolean)) { const ok = await store.create("md_trials", k, ctx.tenantId, { tenantId: ctx.tenantId, startedAt: now.toISOString() }); if (ok) { made.push(k); continue; } const prev = await store.get("md_trials", k); if (prev && prev.tenantId !== ctx.tenantId) { for (const m of made) await store.remove("md_trials", m); await audit(store, ctx, ctx.tenantId, "master.trial.refused", "essai déjà utilisé (e-mail ou téléphone du propriétaire)"); throw new HttpError(409, "Un essai MASTER DOGUI a déjà été utilisé avec ce propriétaire ou ce numéro de téléphone (une seule fois par entreprise). Contactez le support pour une activation payante ou une exception."); } }
  const key = keys.email;
  const lic = startTrial(now); const data = { tenantId: ctx.tenantId, status: "trial", trialStartedAt: lic.trialStartedAt, trialEndsAt: lic.trialEndsAt, trialKey: key.slice(0, 64), updatedBy: ctx.userId };
  try { if (cur) await store.update("md_licenses", ctx.tenantId, data); else await store.create("md_licenses", ctx.tenantId, ctx.tenantId, data); } catch (e) { const again = own(await store.get("md_licenses", ctx.tenantId), ctx.tenantId); if (again?.trialStartedAt) return { duplicate: true, ...viewOf(licOf(again), new Date()) }; throw e; }
  await audit(store, ctx, ctx.tenantId, "master.trial.start", `essai du ${lic.trialStartedAt} au ${lic.trialEndsAt}`); return { duplicate: false, ...viewOf(lic, now) };
}

// ------------------------------------------------------------------ plateforme
export async function platformActivate(store: Store, ctx: Ctx, b: { grantId?: string; tenantId?: string; kind?: string; count?: unknown; note?: string }) {
  adminOnly(ctx); const gid = String(b.grantId ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36); if (gid.length < 8) throw new HttpError(400, "grantId invalide (8 caractères au moins)"); const tenantId = String(b.tenantId ?? ""); if (!(await store.list("shops", { tenantId }, 1)).length) throw new HttpError(404, "Commerce introuvable");
  if (b.kind !== "first" && b.kind !== "month") throw new HttpError(400, "Type : première période (first) ou mois de renouvellement (month)");
  return applyActivation(store, ctx, tenantId, gid, b.kind, b.kind === "first" ? 1 : Number(b.count), String(b.note ?? ""));
}
/** Cœur de l'activation (administrateur ou confirmation automatique de paiement) : idempotent par identifiant d'opération, journalisé, historisé. */
export async function applyActivation(store: Store, ctx: Ctx, tenantId: string, gid: string, kind: "first" | "month", count: number, note: string) {
  const claim = `mdg${sha(`${tenantId}|${gid}`).slice(0, 28)}`; const row = own(await store.get("md_licenses", tenantId), tenantId); if (histOf(row).some((h) => h.id === gid)) return { duplicate: true, ...viewOf(licOf(row), new Date()) };
  if (!(await store.create("payment_refs", claim, tenantId, { tenantId, shopId: "platform", saleId: tenantId, method: "master-grant", reference: gid, amount: 0 }))) { const again = own(await store.get("md_licenses", tenantId), tenantId); if (histOf(again).some((h) => h.id === gid)) return { duplicate: true, ...viewOf(licOf(again), new Date()) }; throw new HttpError(409, "Activation en cours de traitement : réessayez"); }
  let ap; try { ap = applyPurchase(licOf(row), { kind, count: kind === "first" ? 1 : count } as Purchase, new Date()); } catch (e) { await store.remove("payment_refs", claim); throw new HttpError(409, (e as Error).message); }
  const hist: Hist[] = [...histOf(row), { id: gid, kind, ...(kind === "month" ? { count } : {}), amount: ap.amount, from: ap.from, to: ap.to, at: new Date().toISOString(), by: ctx.userId, note: note.slice(0, 120) }].slice(-60);
  const data = { tenantId, status: "paid", firstPaidAt: ap.lic.firstPaidAt, paidUntil: ap.lic.paidUntil, history: JSON.stringify(hist), updatedBy: ctx.userId };
  try { if (row) await store.update("md_licenses", tenantId, data); else await store.create("md_licenses", tenantId, tenantId, data); } catch (e) { await store.remove("payment_refs", claim); throw e; }
  await audit(store, ctx, tenantId, "master.activate", `${kind}${kind === "month" ? ` ×${count}` : ""} ${ap.amount} FCFA du ${ap.from.slice(0, 10)} au ${ap.to.slice(0, 10)} (${gid})`); return { duplicate: false, amount: ap.amount, ...viewOf(ap.lic, new Date()) };
}
/** Exception administrative : accorde l'essai à une entreprise dont le propriétaire l'a déjà utilisé (geste commercial ou erreur). Journalisé. */
export async function platformTrial(store: Store, ctx: Ctx, b: { tenantId?: string; note?: string }) {
  adminOnly(ctx); const tenantId = String(b.tenantId ?? ""); if (!(await store.list("shops", { tenantId }, 1)).length) throw new HttpError(404, "Commerce introuvable"); const note = String(b.note ?? "").trim(); if (note.length < 5) throw new HttpError(400, "Motif obligatoire (5 caractères au moins)");
  const row = own(await store.get("md_licenses", tenantId), tenantId); if (row?.trialStartedAt || row?.firstPaidAt) throw new HttpError(409, "Cette entreprise a déjà eu un essai ou une période payante"); const lic = startTrial(new Date());
  const data = { tenantId, status: "trial", trialStartedAt: lic.trialStartedAt, trialEndsAt: lic.trialEndsAt, updatedBy: ctx.userId }; if (row) await store.update("md_licenses", tenantId, data); else await store.create("md_licenses", tenantId, tenantId, data);
  await audit(store, ctx, tenantId, "master.trial.override", `exception administrative : ${note}`); return { ...viewOf(lic, new Date()) };
}
export async function platformList(store: Store, ctx: Ctx) {
  adminOnly(ctx); const rows = await store.list("md_licenses", {}, 300); const now = new Date();
  return { licenses: rows.map((r) => { const v = viewOf(licOf(r), now); return { tenantId: String(r.tenantId), state: v.state, phase: v.phase, endsAt: v.endsAt, daysLeft: v.daysLeft }; }).sort((a, c) => (a.endsAt ?? "").localeCompare(c.endsAt ?? "")) };
}
