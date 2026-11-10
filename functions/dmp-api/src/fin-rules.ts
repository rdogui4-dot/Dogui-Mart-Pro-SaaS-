import { createHash } from "node:crypto";
import { planAllows } from "../../../src/domain/features";
import { DEFAULT_RULES, LEVEL_LABEL, canAt, normRules, requiredLevel, type Rules } from "../../../src/domain/fin-pro";
import { entitlementOf } from "./subscriptions";
import { HttpError, roleOf, type Ctx, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
export const rulesId = (ctx: Ctx) => `fz${sha(`${ctx.tenantId}|${ctx.shopId}|rules`).slice(0, 30)}`;
export async function rulesOf(store: Store, ctx: Ctx): Promise<Rules> { const r = await store.get("fin_rules", rulesId(ctx)); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) return DEFAULT_RULES; try { return normRules(JSON.parse(String(r.data))); } catch { return DEFAULT_RULES; } }
export const roleKind = (ctx: Ctx): "owner" | "manager" | "other" => { const r = roleOf(ctx.roles); return r === "owner" ? "owner" : r === "manager" ? "manager" : "other"; };
/** Workflow de validation Pro : au-dessus des seuils configurés, seul le niveau requis (gérant ou propriétaire) peut agir. Sans formule Pro ou sans seuil, aucune règle n'est appliquée. */
export async function enforce(store: Store, ctx: Ctx, which: "transfer" | "refund" | "plan", amount: number): Promise<void> {
  if (!planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "finPro")) return; const level = requiredLevel(amount, (await rulesOf(store, ctx))[which]);
  if (!canAt(level, roleKind(ctx))) throw new HttpError(403, `Ce montant (${amount}) exige l'approbation de : ${LEVEL_LABEL[level]}`);
}
