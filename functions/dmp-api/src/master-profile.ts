/** MASTER DOGUI — étape 3 : profil d'entreprise. Mémoire qualifiée, isolée par entreprise, journalisée.
 *  Faits stockés : déclarés / hypothèses / estimations (md_profile, une ligne par fait). Faits « vérifiés » : calculés à la lecture depuis les modules, jamais copiés. */
import { createHash } from "node:crypto";
import { FACTS, KINDS, canConfirm, factDef, labelOf, normalizeValue, type FactKind } from "../../../src/domain/master-profile";
import { roleKind } from "./fin-rules";
import { masterEntitlement, needMaster } from "./master";
import { HttpError, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const audit = (store: Store, ctx: Ctx, shopId: string, action: string, detail: string) => store.create("audit_log", crypto.randomUUID().replace(/-/g, "").slice(0, 30), ctx.tenantId, { tenantId: ctx.tenantId, shopId: shopId || "platform", userId: ctx.userId, action, detail: detail.slice(0, 500) });
const ENT = "entreprise";
const idOf = (tenantId: string, key: string, shop: string) => `pf${sha(`profile|${tenantId}|${key}|${shop}`).slice(0, 28)}`;
const reader = (ctx: Ctx) => { if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); };
const owner = (ctx: Ctx) => { if (roleKind(ctx) !== "owner") throw new HttpError(403, "Seul le propriétaire modifie le profil de l'entreprise"); };
const iso = () => new Date().toISOString();

/** Boutique autorisée pour un fait de portée boutique : appartient à l'entreprise du contexte (jamais celle fournie par le client). */
async function shopOf(store: Store, ctx: Ctx, raw: unknown): Promise<{ id: string; name: string }> {
  const id = String(raw ?? ""); if (!id || id === ENT) return { id: ENT, name: "" };
  const sh = await store.get("shops", id); if (!sh || sh.tenantId !== ctx.tenantId) throw new HttpError(404, "Boutique introuvable"); return { id, name: String(sh.name ?? "") };
}
const present = (r: Row, shops: Map<string, string>) => { const def = factDef(String(r.key))!; return { id: r.$id, key: def.key, label: def.label, shopId: r.shopId === ENT ? "" : String(r.shopId), shopName: r.shopId === ENT ? "" : shops.get(String(r.shopId)) ?? "", value: String(r.value), text: labelOf(def, String(r.value)), kind: r.kind as FactKind, source: String(r.source ?? ""), updatedAt: String(r.updatedAt ?? r.$updatedAt ?? ""), updatedBy: String(r.updatedBy ?? ""), confirmedAt: r.confirmedAt ? String(r.confirmedAt) : null }; };

/** Boutiques d'un gérant : lues dans sa fiche d'équipe (les actions de niveau entreprise ne portent pas de boutique dans le contexte). Fiche absente ou inactive : aucune. */
async function myShops(store: Store, ctx: Ctx): Promise<string[]> {
  const s = await store.get("staff", ctx.userId); if (!s || s.tenantId !== ctx.tenantId || s.active === false) return [];
  try { const v = JSON.parse(String(s.shopIds || "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

/** Faits vérifiés : lus à la demande dans les modules (jamais stockés), avec leur source et la date de lecture. */
async function verified(store: Store, ctx: Ctx, shops: Row[]) {
  const at = iso(); const t = { tenantId: ctx.tenantId }; const count = async (table: string, f?: (r: Row) => boolean) => { const r = await store.scan(table, t, { maxRows: 20_000 }); const n = (f ? r.rows.filter(f) : r.rows).length; return { n, truncated: r.truncated }; };
  const [staff, products, suppliers, customers] = await Promise.all([count("staff", (r) => r.active !== false), count("products", (r) => r.archived !== true), count("suppliers", (r) => r.archived !== true), count("customers", (r) => r.archived !== true)]);
  const f = (label: string, c: { n: number; truncated: boolean }, source: string) => ({ label, value: c.truncated ? `${c.n}+` : String(c.n), source, readAt: at });
  return [{ label: "Boutiques", value: shops.map((s) => String(s.name)).join(", ") || "—", source: "Réglages (boutiques)", readAt: at }, f("Personnes dans l'équipe (actives)", staff, "Équipe"), f("Articles au catalogue", products, "Articles"), f("Fournisseurs", suppliers, "Achats"), f("Clients", customers, "Clients")];
}

/** Lecture : propriétaire et gérants. Autorisée en mode consultation (licence expirée) ; le gérant ne voit ni les faits réservés au propriétaire ni les boutiques hors de son périmètre. */
export async function profileGet(store: Store, ctx: Ctx) {
  reader(ctx); const isOwner = roleKind(ctx) === "owner";
  const mine = isOwner ? null : await myShops(store, ctx);
  const allShops = (await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.filter((s) => !mine || mine.includes(s.$id));
  const names = new Map(allShops.map((s) => [s.$id, String(s.name)] as [string, string]));
  const rows = (await store.scan("md_profile", { tenantId: ctx.tenantId }, { maxRows: 2000 })).rows.filter((r) => { const d = factDef(String(r.key)); return d && (isOwner || !d.ownerOnlyRead) && (r.shopId === ENT || names.has(String(r.shopId))); });
  const e = await masterEntitlement(store, ctx.tenantId);
  return { canEdit: isOwner && e.canAnalyze, readOnlyReason: isOwner ? (e.canAnalyze ? null : "Licence MASTER DOGUI inactive : le profil reste consultable.") : "Seul le propriétaire modifie le profil.", catalog: FACTS.filter((d) => isOwner || !d.ownerOnlyRead), shops: allShops.map((s) => ({ id: s.$id, name: String(s.name) })), facts: rows.map((r) => present(r, names)), verified: await verified(store, ctx, allShops), kinds: KINDS };
}

export async function profileSet(store: Store, ctx: Ctx, b: { key?: string; value?: unknown; kind?: string; shopId?: string }) {
  owner(ctx); await needMaster(store, ctx); const def = factDef(String(b.key ?? "")); if (!def) throw new HttpError(400, "Information inconnue");
  const kind = (b.kind ?? "declared") as FactKind; if (!KINDS.includes(kind)) throw new HttpError(400, "Qualification invalide");
  const sh = await shopOf(store, ctx, b.shopId); if (sh.id !== ENT && !def.shop) throw new HttpError(400, "Cette information se renseigne pour toute l'entreprise"); const v = normalizeValue(def, b.value); if (!v.ok) throw new HttpError(400, v.error);
  const id = idOf(ctx.tenantId, def.key, sh.id); const data = { tenantId: ctx.tenantId, shopId: sh.id, key: def.key, value: v.value, kind, source: "owner", updatedBy: ctx.userId, updatedAt: iso(), confirmedBy: kind === "declared" ? ctx.userId : "", confirmedAt: kind === "declared" ? iso() : null };
  const prev = await store.get("md_profile", id); if (prev && prev.tenantId !== ctx.tenantId) throw new HttpError(404, "Introuvable");
  if (!(await store.create("md_profile", id, ctx.tenantId, data))) await store.update("md_profile", id, data);
  await audit(store, ctx, sh.id, prev ? "profile.update" : "profile.set", `${def.key}${sh.id !== ENT ? `@${sh.id}` : ""} · ${kind}${prev ? ` (avant : ${prev.kind})` : ""}`);
  return { id, key: def.key, kind, shopId: sh.id === ENT ? "" : sh.id };
}

/** Promotion explicite : hypothèse ou estimation -> déclaré, par le propriétaire uniquement (jamais par un automatisme). */
export async function profileConfirm(store: Store, ctx: Ctx, b: { id?: string }) {
  owner(ctx); await needMaster(store, ctx); const r = await store.get("md_profile", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId) throw new HttpError(404, "Information introuvable");
  if (!canConfirm(String(r.kind))) throw new HttpError(409, "Cette information est déjà déclarée"); await store.update("md_profile", r.$id, { kind: "declared", confirmedBy: ctx.userId, confirmedAt: iso(), updatedBy: ctx.userId, updatedAt: iso() });
  await audit(store, ctx, String(r.shopId), "profile.confirm", `${r.key} · ${r.kind} -> declared`); return { id: r.$id, kind: "declared" };
}

/** Suppression définitive d'un fait (trace dans le journal : clé et qualification, pas la valeur). Les rapports déjà produits embarquent leurs propres données et restent inchangés. */
export async function profileDelete(store: Store, ctx: Ctx, b: { id?: string }) {
  owner(ctx); const r = await store.get("md_profile", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId) throw new HttpError(404, "Information introuvable");
  await store.remove("md_profile", r.$id); await audit(store, ctx, String(r.shopId), "profile.delete", `${r.key} · ${r.kind}`); return { ok: true };
}
