/** MASTER DOGUI — confirmation de paiement par notification (webhook) : récepteur, paramétrage administrateur, demandes de paiement du propriétaire, file d'examen.
 *  Le format de la notification n'est pas présumé (voir src/domain/master-pay.ts). Aucune activation automatique sans paramétrage complet ET correspondance exacte (e-mail, montant, demande unique). */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EMPTY_MAPPING, canAutoActivate, expectedAmount, mappingComplete, parseEvent, refOf, type HookMapping } from "../../../src/domain/master-pay";
import { MASTER } from "../../../src/domain/master";
import { roleKind } from "./fin-rules";
import { applyActivation } from "./master";
import { HttpError, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const h256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const adminOnly = (ctx: Ctx) => { if (!ctx.admin) throw new HttpError(403, "Réservé à l'administrateur de la plateforme"); };
const audit = (store: Store, userId: string, tenantId: string, action: string, detail: string) => store.create("audit_log", newId(), tenantId || "platform", { tenantId: tenantId || "platform", shopId: "platform", userId, action, detail: detail.slice(0, 500) });
const PLATFORM = "main"; const MAX_BODY = 20_000;
/** Forme du jeton (48 caractères hexadécimaux générés) : tout autre forme est rejetée SANS lecture de base. */
export const TOKEN_RE = /^[A-Za-z0-9]{32,64}$/;
let cfgCache: { at: number; cfg: HookCfg } | null = null;
/** Adresse publique de la fonction de réception (règle de domaine Appwrite créée pour `dmp-hooks`). */
export const DEFAULT_HOOK_URL = "https://dmp-hooks-dogui.fra.appwrite.run";
export type HookCfg = { enabled: boolean; tokenHash: string; mapping: HookMapping; links: { first: string; month: string }; baseUrl: string };
const EMPTY: HookCfg = { enabled: false, tokenHash: "", mapping: EMPTY_MAPPING, links: { first: "", month: "" }, baseUrl: "" };
async function cfgOf(store: Store): Promise<HookCfg> { const r = await store.get("platform_settings", PLATFORM); try { const j = JSON.parse(String(r?.masterHook ?? "{}")); return { ...EMPTY, ...j, mapping: { ...EMPTY_MAPPING, ...(j.mapping ?? {}) }, links: { ...EMPTY.links, ...(j.links ?? {}) } }; } catch { return EMPTY; } }
async function saveCfg(store: Store, c: HookCfg) { const data = { masterHook: JSON.stringify(c) }; if (await store.get("platform_settings", PLATFORM)) await store.update("platform_settings", PLATFORM, data); else await store.create("platform_settings", PLATFORM, PLATFORM, data); }
const cleanPath = (v: unknown) => String(v ?? "").trim().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
const cleanUrl = (v: unknown, label: string) => { const u = String(v ?? "").trim(); if (!u) return ""; if (!/^https:\/\/[^\s]+$/.test(u) || u.length > 300) throw new HttpError(400, `${label} : lien https attendu`); return u; };

// ------------------------------------------------------------------ administrateur
export async function hookGet(store: Store, ctx: Ctx) { adminOnly(ctx); const c = await cfgOf(store); return { enabled: c.enabled, tokenSet: !!c.tokenHash, mapping: c.mapping, mappingComplete: mappingComplete(c.mapping), links: c.links, baseUrl: c.baseUrl || DEFAULT_HOOK_URL, note: "Le format de la notification dépend du prestataire de paiement et n'est pas présumé : déclarez les champs ci-dessous après avoir observé une première notification dans la file d'examen. Tant que le paramétrage est incomplet, rien ne s'active automatiquement." }; }
export async function hookSave(store: Store, ctx: Ctx, b: { enabled?: unknown; mapping?: Partial<HookMapping>; links?: { first?: unknown; month?: unknown }; baseUrl?: unknown }) {
  adminOnly(ctx); const c = await cfgOf(store); const before = JSON.stringify({ ...c, tokenHash: c.tokenHash ? "***" : "" });
  if (b.mapping) { const m = b.mapping; const sv = Array.isArray(m.successValues) ? m.successValues.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 10) : c.mapping.successValues; c.mapping = { ref: cleanPath(m.ref ?? c.mapping.ref), amount: cleanPath(m.amount ?? c.mapping.amount), email: cleanPath(m.email ?? c.mapping.email), status: cleanPath(m.status ?? c.mapping.status), currency: cleanPath(m.currency ?? c.mapping.currency), successValues: sv, expectedCurrency: String(m.expectedCurrency ?? c.mapping.expectedCurrency).trim().toUpperCase().slice(0, 8) }; }
  if (b.links) { c.links = { first: b.links.first !== undefined ? cleanUrl(b.links.first, "Lien première période") : c.links.first, month: b.links.month !== undefined ? cleanUrl(b.links.month, "Lien renouvellement") : c.links.month }; }
  if (b.baseUrl !== undefined) c.baseUrl = cleanUrl(b.baseUrl, "Adresse de réception");
  if (b.enabled !== undefined) { if (b.enabled === true && !c.tokenHash) throw new HttpError(409, "Générez d'abord le jeton secret de l'adresse de réception"); c.enabled = b.enabled === true; }
  await saveCfg(store, c); await audit(store, ctx.userId, "", "master.hook.config", `${before} → ${JSON.stringify({ ...c, tokenHash: c.tokenHash ? "***" : "" })}`); return hookGet(store, ctx);
}
/** Génère (ou remplace) le jeton secret : il n'est affiché QU'UNE FOIS, seule son empreinte est conservée. */
export async function hookRotate(store: Store, ctx: Ctx) { adminOnly(ctx); const token = randomBytes(24).toString("hex"); const c = await cfgOf(store); c.tokenHash = h256(token); await saveCfg(store, c); await audit(store, ctx.userId, "", "master.hook.rotate", "jeton secret régénéré"); return { token, urlTemplate: `${(c.baseUrl || DEFAULT_HOOK_URL).replace(/\/$/, "")}/?k=${token}`, note: "Copiez cette adresse maintenant : le jeton ne sera plus affiché. Régénérer le jeton invalide l'ancienne adresse." }; }
const evOf = (r: Row) => ({ id: r.$id, status: String(r.status), tenantId: String(r.tenantId ?? ""), ref: String(r.ref ?? ""), amount: r.amount === null || r.amount === undefined ? null : Number(r.amount), email: String(r.email ?? ""), currency: String(r.currency ?? ""), note: String(r.note ?? ""), requestId: String(r.requestId ?? ""), raw: String(r.raw ?? ""), at: r.$createdAt ? new Date(String(r.$createdAt)).toISOString() : "" });
const DAY_MS = 864e5;
/** Purge au fil des consultations (pas de planificateur) : contenu brut effacé après 30 jours ; notifications décidées supprimées après 12 mois ; 100 opérations au plus par appel. Les rapprochements et l'audit ne sont pas touchés. */
export async function purgeEvents(store: Store, now = Date.now()): Promise<{ cleared: number; removed: number }> {
  let cleared = 0; let removed = 0; let budget = 100;
  for (const status of ["review", "matched", "rejected"]) for (const r of await store.list("md_events", { status }, 200)) {
    if (budget <= 0) return { cleared, removed }; const at = r.$createdAt ? Date.parse(String(r.$createdAt)) : NaN; if (!Number.isFinite(at)) continue;
    if (status !== "review" && now - at > 365 * DAY_MS) { await store.remove("md_events", r.$id); removed++; budget--; }
    else if (r.raw && now - at > 30 * DAY_MS) { await store.update("md_events", r.$id, { raw: "" }); cleared++; budget--; }
  }
  return { cleared, removed };
}
export async function eventsList(store: Store, ctx: Ctx, b: { status?: string }) { adminOnly(ctx); try { await purgeEvents(store); } catch { /* la consultation reste possible */ } const status = ["review", "matched", "rejected"].includes(String(b.status)) ? String(b.status) : "review"; const rows = await store.list("md_events", { status }, 100); return { events: rows.map(evOf).sort((a, c) => c.at.localeCompare(a.at)) }; }
export async function eventDecide(store: Store, ctx: Ctx, b: { eventId?: string; action?: string; tenantId?: string; kind?: string; count?: unknown; note?: string }) {
  adminOnly(ctx); const e = await store.get("md_events", String(b.eventId ?? "")); if (!e) throw new HttpError(404, "Notification introuvable"); const note = String(b.note ?? "").trim().slice(0, 150);
  if (e.status === "matched" || e.status === "rejected") return { id: e.$id, status: String(e.status), duplicate: true };
  if (b.action === "reject") { if (note.length < 5) throw new HttpError(400, "Motif obligatoire (5 caractères au moins)"); await store.update("md_events", e.$id, { status: "rejected", note: note.slice(0, 200), decidedBy: ctx.userId, raw: "" }); await audit(store, ctx.userId, String(e.tenantId ?? ""), "master.event.reject", `${e.$id} ${note}`); return { id: e.$id, status: "rejected", duplicate: false }; }
  if (b.action !== "approve") throw new HttpError(400, "Action : approve ou reject"); const tenantId = String(b.tenantId ?? ""); if (!(await store.list("shops", { tenantId }, 1)).length) throw new HttpError(404, "Commerce introuvable"); if (b.kind !== "first" && b.kind !== "month") throw new HttpError(400, "Type : first ou month"); if (note.length < 5) throw new HttpError(400, "Motif obligatoire (vérification effectuée)");
  const r = await applyActivation(store, ctx, tenantId, `ev${String(e.$id).slice(2, 30)}`, b.kind, Number(b.count ?? 1), `notification ${String(e.ref ?? "")} — ${note}`); await store.update("md_events", e.$id, { status: "matched", tenantId, note: `validée manuellement : ${note}`.slice(0, 200), decidedBy: ctx.userId, raw: "" }); await audit(store, ctx.userId, tenantId, "master.event.approve", `${e.$id} ${e.ref ?? ""}`); return { id: e.$id, status: "matched", duplicate: false, activation: r };
}

// ------------------------------------------------------------------ propriétaire : demande de paiement
const reqOf = (r: Row) => ({ id: r.$id, reference: String(r.reference), kind: String(r.kind), count: Number(r.count ?? 1), amount: Number(r.amount), payerEmail: String(r.payerEmail ?? ""), status: String(r.status), at: r.$createdAt ? new Date(String(r.$createdAt)).toISOString() : "" });
const ownerMail = async (store: Store, tenantId: string) => String((await store.listOwners(tenantId))[0]?.email ?? "").trim().toLowerCase();
export async function payRequest(store: Store, ctx: Ctx, b: { kind?: string; count?: unknown; payerEmail?: string }) {
  if (roleKind(ctx) !== "owner") throw new HttpError(403, "Seul le propriétaire prépare un paiement MASTER DOGUI"); if (b.kind !== "first" && b.kind !== "month") throw new HttpError(400, "Type : première période ou renouvellement");
  const lic = await store.get("md_licenses", ctx.tenantId); const hasFirst = !!(lic && lic.tenantId === ctx.tenantId && lic.firstPaidAt); if (b.kind === "first" && hasFirst) throw new HttpError(409, "La première période est déjà activée : choisissez un renouvellement"); if (b.kind === "month" && !hasFirst) throw new HttpError(409, "Activez d'abord la première période de 12 mois");
  const count = b.kind === "first" ? 1 : Number(b.count ?? 1); if (!Number.isInteger(count) || count < 1 || count > MASTER.maxMonths) throw new HttpError(400, `Nombre de mois : 1 à ${MASTER.maxMonths}`);
  const email = String(b.payerEmail ?? "").trim().toLowerCase() || (await ownerMail(store, ctx.tenantId)); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "E-mail du payeur invalide : saisissez l'e-mail que vous utiliserez lors du paiement");
  for (const r of await store.list("md_payments", { tenantId: ctx.tenantId, status: "awaiting" }, 20)) await store.update("md_payments", r.$id, { status: "cancelled" });
  const id = newId(); const amount = expectedAmount(b.kind, count, MASTER.firstPrice, MASTER.renewPrice); await store.create("md_payments", id, ctx.tenantId, { tenantId: ctx.tenantId, kind: b.kind, count, amount, payerEmail: email, status: "awaiting", reference: refOf(id), createdBy: ctx.userId });
  await audit(store, ctx.userId, ctx.tenantId, "master.pay.request", `${b.kind} ×${count} ${amount} FCFA payeur ${email.replace(/(.).*(@.*)/, "$1***$2")}`); const cfg = await cfgOf(store); const link = (b.kind === "first" ? cfg.links.first : cfg.links.month) || "";
  return { id, reference: refOf(id), kind: b.kind, count, amount, payerEmail: email, link, automatic: cfg.enabled && mappingComplete(cfg.mapping), note: cfg.enabled && mappingComplete(cfg.mapping) ? "Payez avec l'e-mail indiqué et le montant exact : l'activation est automatique dès confirmation du prestataire." : "Payez avec l'e-mail indiqué et le montant exact : l'équipe confirme et active après vérification." };
}
export async function payList(store: Store, ctx: Ctx) { if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); const rows = await store.list("md_payments", { tenantId: ctx.tenantId }, 20); return { requests: rows.map(reqOf).sort((a, c) => c.at.localeCompare(a.at)).slice(0, 10) }; }

// ------------------------------------------------------------------ récepteur public (fonction dmp-hooks)
const parseBody = (raw: string, ctype: string): unknown => { const t = raw.trim(); if (!t) return null; try { return JSON.parse(t); } catch { /* non JSON */ } if (/x-www-form-urlencoded/i.test(ctype) || /^[^{[]+=/.test(t)) { const o: Record<string, string> = {}; for (const [k, v] of new URLSearchParams(t)) o[k] = v; return o; } return null; };
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export async function processWebhook(store: Store, input: { token: string; raw: string; contentType?: string }, opts: { cacheMs?: number } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!TOKEN_RE.test(input.token)) return { status: 404, body: { ok: false } }; if (input.raw.length > MAX_BODY) return { status: 413, body: { ok: false, error: "trop volumineux" } };
  const cacheMs = Math.max(0, opts.cacheMs ?? 0); let cfg: HookCfg; if (cacheMs && cfgCache && Date.now() - cfgCache.at < cacheMs) cfg = cfgCache.cfg; else { cfg = await cfgOf(store); cfgCache = cacheMs ? { at: Date.now(), cfg } : null; }
  if (!cfg.enabled || !cfg.tokenHash || !input.token || !same(h256(input.token), cfg.tokenHash)) return { status: 404, body: { ok: false } };
  if (input.raw.length > MAX_BODY) return { status: 413, body: { ok: false, error: "trop volumineux" } }; const payload = parseBody(input.raw, input.contentType ?? ""); if (payload === null || typeof payload !== "object") return { status: 400, body: { ok: false, error: "notification illisible" } };
  const p = parseEvent(payload, cfg.mapping); const bodyHash = h256(input.raw); const id = `ev${sha(`master|${p.ref || bodyHash}`).slice(0, 28)}`; const complete = mappingComplete(cfg.mapping);
  const base = { status: "received", ref: p.ref, amount: p.amount ?? 0, email: p.email, currency: p.currency, bodyHash, raw: complete ? "" : input.raw.slice(0, 6000), note: "" };
  if (!(await store.create("md_events", id, "platform", base))) return { status: 200, body: { ok: true, duplicate: true } };
  const decide = async (status: string, note: string, extra: Record<string, unknown> = {}) => { await store.update("md_events", id, { status, note: note.slice(0, 200), ...extra }); await audit(store, "webhook", String(extra.tenantId ?? ""), `master.event.${status}`, `${id} ${p.ref} ${note}`); return { status: 200, body: { ok: true, status } }; };
  const d = canAutoActivate(p, cfg.mapping); if (!d.auto) return decide("review", d.why);
  const awaiting = (await store.list("md_payments", { status: "awaiting" }, 200)).filter((r) => String(r.payerEmail) === p.email && Number(r.amount) === p.amount);
  if (awaiting.length !== 1) return decide("review", awaiting.length ? "plusieurs demandes correspondent (même e-mail et montant) : examen manuel" : "aucune demande en attente avec cet e-mail et ce montant : examen manuel");
  const rq = awaiting[0]!; const claim = `mdq${sha(String(rq.$id)).slice(0, 28)}`; if (!(await store.create("payment_refs", claim, String(rq.tenantId), { tenantId: String(rq.tenantId), shopId: "platform", saleId: String(rq.$id), method: "master-pay", reference: p.ref.slice(0, 64), amount: Number(rq.amount) }))) return decide("review", "demande déjà en cours de traitement : examen manuel");
  try { await applyActivation(store, { userId: "webhook", tenantId: "", shopId: "", roles: [] }, String(rq.tenantId), String(rq.$id), rq.kind === "first" ? "first" : "month", Number(rq.count ?? 1), `paiement confirmé ${p.ref}`); }
  catch (e) { await store.remove("payment_refs", claim); return decide("review", `activation impossible (${(e as Error).message}) : examen manuel`); }
  await store.update("md_payments", String(rq.$id), { status: "paid", eventId: id }); return decide("matched", "paiement confirmé et licence activée automatiquement", { tenantId: String(rq.tenantId), requestId: String(rq.$id) });
}
