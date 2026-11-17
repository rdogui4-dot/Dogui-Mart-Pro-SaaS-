/** Journal d'activité (cahier §12) : lecture seule des traces déjà enregistrées (audit_log) de la boutique active. Réservé au propriétaire et au gérant ; aucune trace d'une autre boutique ni de la plateforme. */
import { HttpError, need, type Ctx, type Store } from "./store";

const MODULE_LABEL: Record<string, string> = { article: "Articles", stock: "Stock", sale: "Ventes", cash: "Caisse", pos: "Caisse", refund: "Remboursements", expense: "Dépenses", purch: "Achats", promotion: "Promotions", promo: "Promotions", crm: "Clients", crmpro: "Clients", fin: "Finance", ic: "Comptabilité", icp: "Comptabilité", inv: "Investissements", ip: "Investissements", staff: "Équipe", shop: "Boutique", sub: "Abonnement", subscription: "Abonnement", md: "MASTER DOGUI", count: "Inventaires", inventory: "Inventaires", lot: "Lots", serial: "Séries", bundle: "Bundles", kit: "Kits", payments: "Paiements" };
const moduleOf = (action: string) => action.split(".")[0] ?? "";

export async function activityList(store: Store, ctx: Ctx, b: { module?: string; limit?: number } = {}) {
  need(ctx, "manager");
  if (!ctx.shopId) throw new HttpError(400, "Boutique requise");
  const rows = (await store.scan("audit_log", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 5000 })).rows;
  const names = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)]));
  try { for (const o of await store.listOwners(ctx.tenantId)) names.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible : identifiant affiché */ }
  const at = (r: Record<string, unknown>) => String(r.$createdAt ?? r.at ?? "");
  const sorted = rows.sort((x, y) => at(y).localeCompare(at(x)));
  const mods = [...new Set(sorted.map((r) => moduleOf(String(r.action))))].filter(Boolean).sort().map((id) => ({ id, label: MODULE_LABEL[id] ?? id }));
  const filtered = b.module ? sorted.filter((r) => moduleOf(String(r.action)) === b.module) : sorted;
  const limit = Math.min(500, Math.max(1, Number(b.limit) || 200));
  const entries = filtered.slice(0, limit).map((r) => ({ id: String(r.$id), at: at(r), action: String(r.action), module: MODULE_LABEL[moduleOf(String(r.action))] ?? moduleOf(String(r.action)), detail: String(r.detail ?? "").slice(0, 300), by: names.get(String(r.userId)) ?? (r.userId ? String(r.userId) : "Système") }));
  return { entries, count: filtered.length, shown: entries.length, modules: mods, note: "Traces enregistrées par l'application pour cette boutique (lecture seule). Les plus récentes en premier." };
}
