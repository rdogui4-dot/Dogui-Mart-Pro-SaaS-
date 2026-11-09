import { UNITS } from "../../../src/domain/articles";
import { scaleOf, unitRowId, validFactor } from "../../../src/domain/quantity";
import { needFeature } from "./articles";
import { refuseBundle } from "./bundles";
import { HttpError, needModule, type Ctx, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const MAX_UNITS = 8;

/** Définit les conditionnements d'un article (ex. 1 carton = 12 pièces). Fonction Pro.
 *  Une ligne par (article, unité) à identifiant fixe : jamais de doublon. Une unité retirée est désactivée, pas supprimée : les ventes passées la citent. */
export async function saveUnits(store: Store, ctx: Ctx, b: { productId: string; units: { unit: string; factor: number | string }[] }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "packaging");
  const p = await store.get("products", b.productId);
  if (!p || p.tenantId !== ctx.tenantId || p.shopId !== ctx.shopId) throw new HttpError(404, "Article introuvable");
  if (!Array.isArray(b.units) || b.units.length > MAX_UNITS) throw new HttpError(400, `${MAX_UNITS} conditionnements au maximum`);
  refuseBundle(p, "il ne peut pas avoir de conditionnements.");
  const base = String(p.unit || "piece"), scale = scaleOf(p);
  const next = new Map<string, number>();
  for (const u of b.units) {
    if (!UNITS.some((x) => x.id === u.unit)) throw new HttpError(400, "Unité inconnue");
    if (u.unit === base) throw new HttpError(400, "L'unité de base de l'article ne peut pas être un conditionnement");
    if (next.has(u.unit)) throw new HttpError(400, "Unité en double");
    if (!validFactor(Number(String(u.factor).replace(",", ".")), scale)) throw new HttpError(400, scale === 0 ? "Coefficient invalide : entier positif (article vendu à l'unité entière)" : `Coefficient invalide : positif, ${scale} décimale${scale > 1 ? "s" : ""} au maximum`);
    next.set(u.unit, Number(String(u.factor).replace(",", ".")));
  }
  const existing = await store.list("article_units", { productId: p.$id }, 50);
  for (const [unit, factor] of next) {
    const id = unitRowId(p.$id, unit); const data = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, unit, factor, active: true };
    if (!(await store.create("article_units", id, ctx.tenantId, data))) await store.update("article_units", id, { factor, active: true });
  }
  for (const e of existing) if (!next.has(String(e.unit)) && e.active !== false) await store.update("article_units", e.$id, { active: false });
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "article.units", detail: `${p.name} (${p.$id}) : ${[...next].map(([u, f]) => `1 ${u} = ${f} ${base}`).join(", ") || "aucun"}`.slice(0, 1000) });
  return { units: [...next].map(([unit, factor]) => ({ unit, factor })) };
}
