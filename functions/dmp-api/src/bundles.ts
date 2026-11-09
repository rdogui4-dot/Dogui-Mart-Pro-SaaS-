import { createHash } from "node:crypto";
import { bundleModeOf, kindOf, normalizeComponents, type Component } from "../../../src/domain/bundles";
import { scaleOf } from "../../../src/domain/quantity";
import { stockOf, type StockMove } from "../../../src/domain/stock";
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
export const refuseBundle = (p: Row, what: string, opts: { allowKit?: boolean } = {}) => { if (kindOf(p) === "bundle" && !(opts.allowKit && bundleModeOf(p) === "kit")) throw new HttpError(409, `${p.name} est un bundle (sans stock propre) : ${what}`); };

const stockUnits = async (store: Store, ctx: Ctx, productId: string): Promise<number> =>
  stockOf((await store.scan("stock_moves", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId }, { maxRows: 200_000 })).rows.map((m) => ({ productId, qty: Number(m.qty), kind: m.kind as StockMove["kind"] })));

export type AssembleInput = { requestId: string; bundleId: string; qty: unknown; type?: "assemble" | "disassemble" };
/** Ordre d'assemblage (ou de démontage) d'un kit physique, fonction Pro. Assemblage : les composants sortent du stock (assembly_out), le kit entre (assembly_in) et son coût
 *  devient le coût moyen pondéré (stock + coût des composants). Démontage : l'inverse. L'ordre est enregistré d'abord (« pending ») avec sa composition figée, puis les mouvements
 *  à identifiants fixes, puis « done » : une reprise après coupure complète sans rien doubler. */
export async function assembleKit(store: Store, ctx: Ctx, b: AssembleInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "bundles");
  const rid = String(b.requestId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 28); if (rid.length < 8) throw new HttpError(400, "requestId invalide");
  const type = b.type === "disassemble" ? "disassemble" : "assemble"; const id = `k${rid}`;
  const kit = await store.get("products", b.bundleId);
  if (!mine(ctx, kit)) throw new HttpError(404, "Kit introuvable");
  if (kindOf(kit) !== "bundle" || bundleModeOf(kit) !== "kit") throw new HttpError(409, "Cet article n'est pas un kit physique (un bundle virtuel n'a pas d'assemblage)");
  if (kit.archived) throw new HttpError(409, "Kit archivé : restaurez-le avant de l'assembler");
  const prior = await store.get("assembly_orders", id);
  let lines: { productId: string; name: string; qty: number; unitCost: number }[]; let qty: number; let number: string; let unitCost: number;
  if (prior) {
    if (!mine(ctx, prior) || prior.bundleId !== kit.$id || prior.type !== type) throw new HttpError(409, "Demande déjà utilisée");
    if (prior.status === "done") return { id, number: prior.number, duplicate: true };
    lines = JSON.parse(String(prior.lines)); qty = Number(prior.qty); number = String(prior.number); unitCost = Number(prior.unitCost ?? 0);
  } else {
    qty = Number(String(b.qty ?? "").replace(",", ".")); if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new HttpError(400, "Quantité invalide (entier de 1 à 9999)");
    const defs = await loadComponents(store, ctx, kit.$id); if (!defs.length) throw new HttpError(409, `${kit.name} : kit sans composants`);
    lines = []; unitCost = 0;
    for (const c of defs) {
      const cp = await store.get("products", c.productId);
      if (!mine(ctx, cp) || cp.archived) throw new HttpError(409, `${kit.name} : un composant n'est plus disponible (modifiez le kit)`);
      if (type === "assemble") { const have = await stockUnits(store, ctx, cp.$id); if (have < c.qty * qty) throw new HttpError(409, `Stock insuffisant pour assembler : ${cp.name} (${have} en stock, ${c.qty * qty} nécessaires)`); }
      lines.push({ productId: cp.$id, name: String(cp.name), qty: c.qty, unitCost: Number(cp.cost ?? 0) }); unitCost += Number(cp.cost ?? 0) * c.qty;
    }
    if (type === "disassemble") { const have = await stockUnits(store, ctx, kit.$id); if (have < qty) throw new HttpError(409, `Stock du kit insuffisant pour démonter (${have} en stock)`); }
    number = `${type === "assemble" ? "AS" : "DS"}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${rid.slice(0, 6).toUpperCase()}`;
    if (!(await store.create("assembly_orders", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, number, bundleId: kit.$id, type, qty, unitCost, lines: JSON.stringify(lines), status: "pending", userId: ctx.userId }))) throw new HttpError(409, "Demande déjà utilisée");
  }
  const base = { tenantId: ctx.tenantId, shopId: ctx.shopId, refId: number, userId: ctx.userId };
  const [out, inn] = type === "assemble" ? ["assembly_out", "assembly_in"] : ["assembly_in", "assembly_out"]; // composants : (assemblage) sortent / (démontage) reviennent
  for (const [k, l] of lines.entries()) await store.create("stock_moves", `${id}_c${k}`, ctx.tenantId, { ...base, productId: l.productId, kind: out, qty: l.qty * qty });
  const before = await stockUnits(store, ctx, kit.$id);
  const kitMove = await store.create("stock_moves", `${id}_k`, ctx.tenantId, { ...base, productId: kit.$id, kind: inn, qty });
  if (kitMove && type === "assemble" && unitCost > 0) { // coût moyen pondéré du kit (le stock d'avant comptait déjà l'ancien coût) ; appliqué une seule fois, à la création du mouvement
    const old = Number(kit.cost ?? 0); const newCost = before > 0 ? Math.round((before * old + qty * unitCost) / (before + qty)) : unitCost;
    if (newCost !== old) await store.update("products", kit.$id, { cost: newCost });
  }
  await store.update("assembly_orders", id, { status: "done" });
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: type === "assemble" ? "kit.assemble" : "kit.disassemble", detail: `${kit.name} ×${qty} (${number})`.slice(0, 1000) });
  return { id, number, duplicate: false };
}
