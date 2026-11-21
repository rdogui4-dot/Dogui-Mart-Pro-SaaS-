import { HttpError, need, type Ctx, type Store } from "./store";

/** Hébergement d'un commerce par un poste local : tant qu'un poste héberge le commerce, le cloud en garde le miroir (lecture, abonnement, paiements) mais refuse les écritures d'exploitation,
 *  pour qu'une vente ne soit jamais saisie deux fois (poste et cloud). L'état est porté par la ligne d'abonnement du commerce (`hostedBy`, décidée côté cloud : jamais envoyée par un poste). */
export type Host = { name: string; since: string; by: string };
export const parseHost = (v: unknown): Host | null => { try { const h = JSON.parse(String(v ?? "")); return h && typeof h === "object" && typeof h.name === "string" ? (h as Host) : null; } catch { return null; } };

/** Actions qui restent permises au cloud pendant l'hébergement : synchronisation, hébergement, abonnement et paiements, licence MASTER (tables décidées par le cloud). Les lectures (rapports, tableaux de bord) sont déjà permises. */
export const HOST_ALLOWED = new Set(["security.status", "security.events", "host.status", "host.claim", "host.release", "tenant.init", "report.consolidated", "md.license", "md.pay.request", "md.pay.list", "md.trial.start"]);
export const isHostAllowed = (action: string): boolean => HOST_ALLOWED.has(action) || action.startsWith("sync.") || action.startsWith("subscription.");
export const hostedMessage = (h: Host) => `Ce commerce est hébergé par le poste « ${h.name} » depuis le ${h.since.slice(0, 10)} : saisissez vos opérations sur ce poste (les rapports restent consultables ici). Le propriétaire peut reprendre l'hébergement dans Paramètres.`;

const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 36), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId || "commerce", userId: ctx.userId, action, detail: detail.slice(0, 500) }); // action de niveau commerce : étiquette « commerce », lisible du seul propriétaire
const subOf = async (store: Store, tenantId: string) => { const s = await store.get("subscriptions", tenantId); if (!s || s.tenantId !== tenantId) throw new HttpError(409, "Abonnement introuvable : ouvrez d'abord le commerce dans l'application"); return s; };

export async function hostStatus(store: Store, ctx: Ctx) { need(ctx, "owner"); return { host: parseHost((await subOf(store, ctx.tenantId)).hostedBy) }; }
/** Un poste devient l'hébergeur du commerce (refusé si un autre poste l'est déjà). Rejouable pour le même poste. */
export async function hostClaim(store: Store, ctx: Ctx, b: { name?: string; force?: boolean }) {
  need(ctx, "owner"); const name = String(b.name ?? "").trim().slice(0, 60); if (!name) throw new HttpError(400, "Nom du poste requis");
  const sub = await subOf(store, ctx.tenantId); const cur = parseHost(sub.hostedBy);
  if (cur && cur.name !== name && !b.force) throw new HttpError(409, `Ce commerce est déjà hébergé par le poste « ${cur.name} » : reprenez d'abord l'hébergement ou confirmez le remplacement`);
  const host: Host = cur && cur.name === name ? cur : { name, since: new Date().toISOString(), by: ctx.userId }; await store.update("subscriptions", ctx.tenantId, { hostedBy: JSON.stringify(host) });
  if (!cur || cur.name !== name) await audit(store, ctx, "host.claim", `hébergement confié au poste « ${name} »${cur ? ` (remplace « ${cur.name} »)` : ""}`); return { host };
}
/** Le cloud reprend l'hébergement (appelé par le poste après sa dernière synchronisation, ou par le propriétaire avec `force` si le poste est perdu : ce qui n'a pas été synchronisé est alors perdu). */
export async function hostRelease(store: Store, ctx: Ctx, b: { force?: boolean }) {
  need(ctx, "owner"); const sub = await subOf(store, ctx.tenantId); const cur = parseHost(sub.hostedBy); if (!cur) return { host: null };
  await store.update("subscriptions", ctx.tenantId, { hostedBy: "" }); await audit(store, ctx, "host.release", `hébergement repris par le cloud (poste « ${cur.name} »${b.force ? ", reprise forcée" : ""})`); return { host: null };
}
