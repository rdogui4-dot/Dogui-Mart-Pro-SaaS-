import { createHash } from "node:crypto";
import { kindOf, normalizeComponents, type Component } from "../../../src/domain/bundles";
import { scaleOf } from "../../../src/domain/quantity";
import { trackingOf } from "../../../src/domain/tracking";
import { needFeature } from "./articles";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
/** Un composant d'un bundle = une ligne à identifiant fixe (bundle, composant) : jamais de doublon, reprise sans risque. */
export const componentRowId = (bundleId: string, componentId: string): string => `c${createHash("sha1").update(`${bundleId}|${componentId}`).digest("hex").slice(0, 30)}`;

export async function loadComponents(store: Store, ctx: Ctx, bundleId: string): Promise<Component[]> {
  return (await store.list("article_components", { tenantId: ctx.tenantId, shopId: ctx.shopId, bundleId }, 50)).map((r) => ({ productId: String(r.componentId), qty: Number(r.qty) })).sort((a, b) => a.productId.localeCompare(b.productId));
}
/** Un article peut devenir composant s'il est simple : ni bundle, ni suivi par lot/série, ni décliné, vendu à l'unité entière. */
function assertComponentOk(p: Row) {
  if (p.archived) throw new HttpError(409, `${p.name} est archivé : choisissez un autre composant`);
  if (kindOf(p) === "bundle") throw new HttpError(409, `${p.name} est un bundle : un bundle ne peut pas contenir un autre bundle`);
  if (trackingOf(p)) throw new HttpError(409, `${p.name} est suivi par lot ou numéro de série : non pris en charge comme composant`);
  if (p.hasVariants) throw new HttpError(409, `${p.name} a des variantes : non pris en charge comme composant`);
  if (scaleOf(p) !== 0) throw new HttpError(409, `${p.name} se vend avec des décimales : non pris en charge comme composant`);
}

/** Définit la composition d'un bundle (fonction Pro) : remplace l'ensemble des composants. Le prix d'achat indicatif du bundle = somme des prix d'achat des composants. */
export async function saveComponents(store: Store, ctx: Ctx, b: { bundleId: string; components: unknown }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "bundles");
  const bundle = await store.get("products", b.bundleId);
  if (!mine(ctx, bundle)) throw new HttpError(404, "Bundle introuvable");
  if (kindOf(bundle) !== "bundle") throw new HttpError(409, "Cet article n'est pas un bundle");
  let comps: Component[]; try { comps = normalizeComponents(b.components, bundle.$id); } catch (e) { throw new HttpError(400, (e as Error).message); }
  let cost = 0;
  for (const c of comps) { const p = await store.get("products", c.productId); if (!mine(ctx, p)) throw new HttpError(404, "Composant introuvable dans cette boutique"); assertComponentOk(p); cost += Number(p.cost ?? 0) * c.qty; }
  const keep = new Set<string>();
  for (const c of comps) {
    const id = componentRowId(bundle.$id, c.productId); keep.add(id);
    if (!(await store.create("article_components", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, bundleId: bundle.$id, componentId: c.productId, qty: c.qty }))) await store.update("article_components", id, { qty: c.qty });
  }
  for (const r of await store.list("article_components", { tenantId: ctx.tenantId, shopId: ctx.shopId, bundleId: bundle.$id }, 50)) if (!keep.has(r.$id)) await store.remove("article_components", r.$id);
  if (Number(bundle.cost ?? 0) !== cost) await store.update("products", bundle.$id, { cost });
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "bundle.components", detail: `${bundle.name} (${bundle.$id}) : ${comps.map((c) => `${c.qty}×${c.productId}`).join(", ")}`.slice(0, 1000) });
  return { components: comps };
}

/** Garde commune : les articles qui portent leur propre stock refusent d'être des bundles et inversement. */
export const refuseBundle = (p: Row, what: string) => { if (kindOf(p) === "bundle") throw new HttpError(409, `${p.name} est un bundle (sans stock propre) : ${what}`); };
