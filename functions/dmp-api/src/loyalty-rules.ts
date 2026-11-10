import { createHash } from "node:crypto";
import { normLoyalty } from "../../../src/domain/crm-pro";
import { planAllows } from "../../../src/domain/features";
import { DEFAULT_RULES, type LoyaltyRules } from "../../../src/domain/loyalty";
import { entitlementOf } from "./subscriptions";
import type { Ctx, Store } from "./store";

export const configId = (ctx: Ctx, kind: string) => `cf${createHash("sha1").update(`${ctx.tenantId}|${ctx.shopId}|${kind}`).digest("hex").slice(0, 30)}`;
/** Règles de fidélité effectives : celles du commerce en formule Pro (CRM Pro), sinon les règles standard. Appliquées aux ventes futures seulement. */
export async function loyaltyRulesOf(store: Store, ctx: Ctx): Promise<LoyaltyRules> {
  const r = await store.get("crm_config", configId(ctx, "loyalty")); if (!r || r.tenantId !== ctx.tenantId) return DEFAULT_RULES; if (!planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "crmPro")) return DEFAULT_RULES;
  try { return normLoyalty((JSON.parse(String(r.data)) as { rules?: unknown }).rules ?? {}, DEFAULT_RULES); } catch { return DEFAULT_RULES; }
}
