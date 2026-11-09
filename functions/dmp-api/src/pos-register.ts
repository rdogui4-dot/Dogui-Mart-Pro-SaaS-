import { createHash } from "node:crypto";
import { needFeature } from "./articles";
import { closeSession, sessionTotals, type Totals } from "./cashier";
import { hasRight, ledgerWrite, needRight } from "./pos-pro";
import { HttpError, needModule, roleOf, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });
const pro = (store: Store, ctx: Ctx) => needFeature(store, ctx, "smartPosPro");

/** Transfert CONTRÔLÉ d'une session : le vendeur sortant (ou un responsable) compte la caisse ; la session se ferme avec son écart, et une nouvelle s'ouvre au nom du vendeur entrant avec le montant compté comme fond — sur la même caisse. Droit « transférer ». */
export async function handover(store: Store, ctx: Ctx, b: { sessionId?: string; toUserId?: string; counted?: unknown; note?: string; requestId?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); await pro(store, ctx); await needRight(store, ctx, "transfer");
  const s = b.sessionId ? await store.get("cash_sessions", b.sessionId) : null; if (!s || s.tenantId !== ctx.tenantId || s.shopId !== ctx.shopId) throw new HttpError(404, "Session introuvable"); if (s.status !== "open") throw new HttpError(409, "Cette session est déjà fermée");
  const to = String(b.toUserId ?? ""); if (!to || to === s.userId) throw new HttpError(400, "Choisissez le vendeur qui reprend la caisse");
  const st = await store.get("staff", to); const isOwner = (await store.listOwners(ctx.tenantId).catch(() => [])).some((o) => o.userId === to);
  if (!isOwner && (!st || st.tenantId !== ctx.tenantId || st.active === false || !parse<string[]>(st.shopIds, []).includes(ctx.shopId))) throw new HttpError(404, "Vendeur introuvable dans cette boutique");
  if ((await store.list("cash_sessions", { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: to, status: "open" }, 2)).length) throw new HttpError(409, "Ce vendeur a déjà une session ouverte");
  const rid = b.requestId ? `cs${sha(`handover|${s.$id}|${b.requestId}`).slice(0, 28)}` : `cs${sha(`handover|${s.$id}`).slice(0, 28)}`; const counted = Number(String(b.counted ?? "").replace(/\s/g, "")); if (!Number.isInteger(counted) || counted < 0) throw new HttpError(400, "Montant compté invalide");
  const closed = await closeSession(store, ctx, { sessionId: s.$id, counted, note: b.note });
  const newSess = { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: to, openedAt: new Date(Date.parse(iso((await store.get("cash_sessions", s.$id))?.closedAt)) + 1).toISOString(), status: "open", openingFloat: counted, note: String(b.note ?? "").slice(0, 200), register: String(s.register ?? ""), handoverFrom: s.$id };
  await store.create("cash_sessions", rid, ctx.tenantId, newSess);
  await ledgerWrite(store, ctx, { kind: "handover", ref: s.$id, amount: counted, at: newSess.openedAt, sessionId: rid, userId: ctx.userId, payload: { from: s.userId, to, variance: (closed as { variance?: number }).variance ?? 0 } });
  await audit(store, ctx, "cash.handover", `${s.$id} → ${rid} (${s.userId} → ${to}) compté ${counted}`); return { closedId: s.$id, openedId: rid, variance: (closed as { variance?: number }).variance ?? 0 };
}

/** Validation hiérarchique d'un écart de caisse (droit « valider » ; on ne valide pas son propre écart, sauf le propriétaire). */
export async function validateVariance(store: Store, ctx: Ctx, b: { sessionId?: string; approve?: boolean; note?: string }) {
  needModule(ctx, "pos"); await pro(store, ctx); await needRight(store, ctx, "approve");
  const s = await store.get("cash_sessions", String(b.sessionId ?? "")); if (!s || s.tenantId !== ctx.tenantId || s.shopId !== ctx.shopId) throw new HttpError(404, "Session introuvable");
  if (s.status !== "closed") throw new HttpError(409, "La session doit être fermée"); if (s.varianceStatus !== "pending") throw new HttpError(409, s.varianceStatus === "ok" ? "Aucun écart à valider" : "Écart déjà traité");
  if (s.userId === ctx.userId && roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Vous ne pouvez pas valider votre propre écart de caisse");
  const note = String(b.note ?? "").trim(); if (b.approve === false && note.length < 3) throw new HttpError(400, "Motif du refus obligatoire");
  const status = b.approve === false ? "rejected" : "validated"; await store.update("cash_sessions", s.$id, { varianceStatus: status, validatedBy: ctx.userId, validatedAt: new Date().toISOString() });
  await ledgerWrite(store, ctx, { kind: "variance_" + status, ref: s.$id, amount: Number(s.variance), at: new Date().toISOString(), sessionId: s.$id, payload: { note: note.slice(0, 200) } }); await audit(store, ctx, `cash.variance.${status}`, `${s.$id} ${s.variance} ${note}`.slice(0, 500)); return { id: s.$id, status };
}

/** Correction du montant compté d'une session FERMÉE (droit « corriger ») : motif obligatoire ; l'écart est recalculé, l'ancien montant reste dans le journal financier et l'audit. */
export async function correctSession(store: Store, ctx: Ctx, b: { sessionId?: string; counted?: unknown; reason?: string }) {
  needModule(ctx, "pos"); await pro(store, ctx); await needRight(store, ctx, "correct");
  const s = await store.get("cash_sessions", String(b.sessionId ?? "")); if (!s || s.tenantId !== ctx.tenantId || s.shopId !== ctx.shopId) throw new HttpError(404, "Session introuvable"); if (s.status !== "closed") throw new HttpError(409, "Seule une session fermée se corrige");
  const counted = Number(String(b.counted ?? "").replace(/\s/g, "")); if (!Number.isInteger(counted) || counted < 0) throw new HttpError(400, "Montant compté invalide"); const reason = String(b.reason ?? "").trim(); if (reason.length < 5 || reason.length > 200) throw new HttpError(400, "Motif obligatoire (5 à 200 caractères)");
  if (counted === Number(s.countedCash)) throw new HttpError(400, "Le montant est déjà celui enregistré");
  const variance = counted - Number(s.theoreticalCash); const n = (await store.list("finance_ledger", { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: s.$id, kind: "correction" }, 500)).length;
  await ledgerWrite(store, ctx, { kind: "correction", ref: s.$id, key: `${s.$id}#${n + 1}`, amount: counted - Number(s.countedCash), at: new Date().toISOString(), sessionId: s.$id, payload: { before: Number(s.countedCash), after: counted, reason } });
  await store.update("cash_sessions", s.$id, { countedCash: counted, variance, varianceStatus: variance === 0 ? "ok" : "pending", validatedBy: "", note: String(s.note ?? "") }); await audit(store, ctx, "cash.correct", `${s.$id} ${s.countedCash} → ${counted} ${reason}`.slice(0, 500)); return { id: s.$id, variance };
}

/** Comparaison des performances par caisse, vendeur et boutique (chiffres réels). Le propriétaire voit toutes ses boutiques, le responsable la sienne. */
export async function performance(store: Store, ctx: Ctx, b: { from?: string; to?: string } = {}) {
  needModule(ctx, "pos"); await pro(store, ctx); await needRight(store, ctx, "approve");
  const day = /^\d{4}-\d{2}-\d{2}$/; const from = b.from && day.test(b.from) ? `${b.from}T00:00:00.000Z` : new Date(Date.now() - 30 * 864e5).toISOString(); const to = b.to && day.test(b.to) ? new Date(Date.parse(`${b.to}T00:00:00Z`) + 864e5).toISOString() : new Date(Date.now() + 864e5).toISOString();
  const owner = roleOf(ctx.roles) === "owner"; const shops: Row[] = owner ? await store.list("shops", { tenantId: ctx.tenantId }, 100) : [(await store.get("shops", ctx.shopId.slice(0, 36)))!].filter(Boolean);
  const names = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)])); try { for (const o of await store.listOwners(ctx.tenantId)) names.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible */ }
  const out = []; const sellers = new Map<string, { userId: string; seller: string; shop: string; count: number; total: number; refunds: number }>(); const registers = new Map<string, { register: string; shop: string; sessions: number; salesTotal: number; variance: number; pendingVariances: number }>();
  for (const sh of shops) {
    const w = { tenantId: ctx.tenantId, shopId: sh.$id }; const sales = (await store.scan("sales", { ...w, status: "paid" }, { range: { field: "soldAt", from, to }, maxRows: 50_000 })).rows;
    const rets = (await store.scan("sale_returns", w, { range: { field: "at", from, to }, maxRows: 10_000 })).rows.filter((r) => r.status !== "failed"); const sess = (await store.scan("cash_sessions", w, { range: { field: "openedAt", from, to }, maxRows: 2_000 })).rows;
    const total = sales.reduce((a, s) => a + Number(s.total), 0); const refunds = rets.reduce((a, r) => a + Number(r.amount), 0);
    for (const s of sales) { const k = `${sh.$id}|${s.cashierId}`; const a = sellers.get(k) ?? { userId: String(s.cashierId), seller: names.get(String(s.cashierId)) ?? "", shop: String(sh.name ?? sh.$id), count: 0, total: 0, refunds: 0 }; a.count++; a.total += Number(s.total); sellers.set(k, a); }
    for (const r of rets) { const k = `${sh.$id}|${r.userId}`; const a = sellers.get(k) ?? { userId: String(r.userId), seller: names.get(String(r.userId)) ?? "", shop: String(sh.name ?? sh.$id), count: 0, total: 0, refunds: 0 }; a.refunds += Number(r.amount); sellers.set(k, a); }
    let variance = 0; for (const s of sess) { const name = String(s.register ?? "") || "(sans nom)"; const k = `${sh.$id}|${name}`; const t = s.status === "closed" ? parse<Totals | null>(s.summary, null) : await sessionTotals(store, ctx, { ...s, shopId: sh.$id } as Row);
      const a = registers.get(k) ?? { register: name, shop: String(sh.name ?? sh.$id), sessions: 0, salesTotal: 0, variance: 0, pendingVariances: 0 }; a.sessions++; a.salesTotal += t?.sales.total ?? 0; if (s.status === "closed") { a.variance += Number(s.variance ?? 0); variance += Number(s.variance ?? 0); if (s.varianceStatus === "pending") a.pendingVariances++; } registers.set(k, a); }
    out.push({ shopId: sh.$id, shop: String(sh.name ?? sh.$id), sales: sales.length, total, avgBasket: sales.length ? Math.round(total / sales.length) : 0, refunds, refundRate: total > 0 ? Math.round((refunds / total) * 1000) / 10 : 0, variance, sessions: sess.length });
  }
  return { from, to, shops: out.sort((a, c) => c.total - a.total), sellers: [...sellers.values()].map((x) => ({ ...x, avgBasket: x.count ? Math.round(x.total / x.count) : 0 })).sort((a, c) => c.total - a.total), registers: [...registers.values()].sort((a, c) => c.salesTotal - a.salesTotal), note: "Chiffres tirés des ventes, remboursements et sessions enregistrés ; écart = compté − théorique sur les sessions fermées." };
}
void hasRight;
