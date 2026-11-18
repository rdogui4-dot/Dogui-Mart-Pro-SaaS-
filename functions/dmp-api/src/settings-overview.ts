/** Paramètres généraux (kit) : synthèse réelle du paramétrage — boutiques, utilisateurs actifs, modules ouverts par la formule, actions journalisées sur 7 jours, liste de vérification. Lecture seule ; propriétaire et gérants. */
import { checklist, modulesFor } from "../../../src/domain/settings-kit";
import { planAllows } from "../../../src/domain/features";
import { roleKind } from "./fin-rules";
import { masterEntitlement } from "./master";
import { entitlementOf } from "./subscriptions";
import { HttpError, type Ctx, type Store } from "./store";

export async function settingsOverview(store: Store, ctx: Ctx) {
  if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); if (!ctx.shopId) throw new HttpError(400, "Choisissez une boutique");
  const ent = await entitlementOf(store, ctx.tenantId); const plan = ent.plan.id; const id = ctx.shopId.slice(0, 36);
  const [shop, shops, staff, audit, pay, lic] = await Promise.all([store.get("shops", id), store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 200 }), store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 1000 }), store.scan("audit_log", { tenantId: ctx.tenantId }, { maxRows: 20_000 }), store.get("payment_settings", id), masterEntitlement(store, ctx.tenantId)]);
  let owners = 1; try { owners = Math.max(1, (await store.listOwners(ctx.tenantId)).length); } catch { owners = 1; }
  const activeStaff = staff.rows.filter((r) => r.active !== false).length; const since = Date.now() - 7 * 864e5;
  const actions7 = audit.rows.filter((r) => (Date.parse(String(r.$createdAt ?? r.at ?? "")) || 0) >= since).length;
  const finOn = planAllows(plan, "finBusiness"); const finAccounts = finOn ? (await store.scan("fin_accounts", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 500 })).rows.filter((a) => a.archived !== true).length : null;
  const qrLinks = Number(!!pay?.waveTemplate) + Number(!!pay?.orangeTemplate); const s = (k: string) => (shop?.[k] == null ? "" : String(shop[k]));
  const check = checklist({ name: s("name"), phone: s("phone"), legal: s("legal"), companyName: s("companyName"), taxRegime: s("taxRegime"), address: s("address"), promoTz: s("promoTz"), logoFileId: s("logoFileId"), vatSet: shop?.vatRatePct !== undefined && shop?.vatRatePct !== null, finAccounts, qrLinks, staff: activeStaff });
  const mods = modulesFor(plan);
  return { plan: { id: plan, name: ent.plan.name, state: ent.state }, shops: shops.rows.length, users: owners + activeStaff, modules: mods, master: { state: lic.state, active: lic.canAnalyze }, actions7, payments: { wave: !!pay?.waveTemplate, orange: !!pay?.orangeTemplate }, finAccounts, checklist: check,
    shop: { name: s("name"), address: s("address"), city: s("city"), phone: s("phone"), legal: s("legal"), companyName: s("companyName"), taxRegime: s("taxRegime"), promoTz: s("promoTz"), vatRatePct: shop?.vatRatePct ?? null, logoFileId: s("logoFileId") }, canEdit: roleKind(ctx) === "owner" };
}
