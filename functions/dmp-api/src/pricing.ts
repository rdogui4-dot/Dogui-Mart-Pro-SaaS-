import { MAX_RULES_PER_ARTICLE, normalizeRule, type PriceRule } from "../../../src/domain/pricing";
import { unitRowId } from "../../../src/domain/quantity";
import { needFeature } from "./articles";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const iso = (v: unknown): string | undefined => { if (!v) return undefined; const ms = Date.parse(String(v)); return Number.isNaN(ms) ? undefined : new Date(ms).toISOString(); };

/** Règles d'un article (ou d'une variante) lues en base, au format du moteur de prix. Les dates Appwrite sont normalisées en ISO « Z » pour la comparaison. */
export async function loadRules(store: Store, ctx: Ctx, productId: string, variantId = ""): Promise<PriceRule[]> {
  const rows = await store.list("article_price_rules", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId }, MAX_RULES_PER_ARTICLE * 6);
  return rows.filter((r) => String(r.variantId ?? "") === variantId && r.active !== false).map((r) => ({
    id: r.$id, kind: r.kind, price: Number(r.price), unit: r.unit || undefined, minQty: Number(r.minQty) > 0 ? Number(r.minQty) : undefined,
    customerCategory: r.customerCategory || undefined, startsAt: iso(r.startsAt), endsAt: iso(r.endsAt), priority: Number(r.priority ?? 0), active: true, createdAt: iso(r.$createdAt) ?? "", label: r.label,
  }));
}

export type RuleInput = { productId: string; variantId?: string; id?: string; requestId?: string } & Record<string, unknown>;

/** Création / modification d'un tarif (promotion, prix par catégorie de clients, prix par quantité). Fonction Pro. */
export async function savePriceRule(store: Store, ctx: Ctx, b: RuleInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "tieredPricing");
  const p = await store.get("products", b.productId);
  if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable");
  const variantId = b.variantId ? String(b.variantId) : "";
  let target: Row = p;
  if (p.hasVariants) { // un prix est absolu : sur un article décliné, il vise une variante précise
    const v = variantId ? await store.get("article_variants", variantId) : null;
    if (!v || !mine(ctx, v) || v.productId !== p.$id) throw new HttpError(400, "Choisissez la variante concernée par ce tarif");
    target = v;
  } else if (variantId) throw new HttpError(400, "Cet article n'a pas de variantes");
  let rule: ReturnType<typeof normalizeRule>;
  try { rule = normalizeRule(b); } catch (e) { throw new HttpError(400, (e as Error).message); }
  let factor = 1;
  if (rule.unit) {
    const u = await store.get("article_units", unitRowId(p.$id, rule.unit));
    if (!u || u.productId !== p.$id || u.active === false) throw new HttpError(400, `Unité « ${rule.unit} » non définie pour cet article`);
    factor = Number(u.factor);
  }
  const existing = (await store.list("article_price_rules", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id }, MAX_RULES_PER_ARTICLE + 1)).filter((r) => String(r.variantId ?? "") === variantId);
  const data = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId, kind: rule.kind, price: rule.price, unit: rule.unit ?? "", minQty: rule.minQty ?? 0, customerCategory: rule.customerCategory ?? "", ...(rule.startsAt ? { startsAt: rule.startsAt } : {}), ...(rule.endsAt ? { endsAt: rule.endsAt } : {}), priority: rule.priority ?? 0, active: rule.active !== false, label: rule.label ?? "" };
  const belowCost = Number(target.cost ?? 0) > 0 && rule.price < Number(target.cost) * factor; // alerte, pas un blocage : une liquidation à perte est une décision du commerçant
  const where = `${p.name}${target !== p ? ` — ${target.label}` : ""}`;
  const audit = (action: string, id: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: `${where} : ${rule.kind} ${rule.price}${rule.unit ? `/${rule.unit}` : ""}${rule.minQty ? ` dès ${rule.minQty}` : ""}${rule.customerCategory ? ` ${rule.customerCategory}` : ""} (${id})`.slice(0, 1000) });
  if (b.id) {
    const cur = await store.get("article_price_rules", b.id);
    if (!mine(ctx, cur) || cur.productId !== p.$id || String(cur.variantId ?? "") !== variantId) throw new HttpError(403, "Accès refusé");
    // les dates absentes de la nouvelle saisie sont retirées (une règle devenue permanente n'a plus de période)
    await store.update("article_price_rules", cur.$id, { ...data, startsAt: rule.startsAt ?? null, endsAt: rule.endsAt ?? null });
    await audit("price.rule.update", cur.$id); return { id: cur.$id, belowCost };
  }
  if (existing.length >= MAX_RULES_PER_ARTICLE) throw new HttpError(409, `${MAX_RULES_PER_ARTICLE} tarifs au maximum par article`);
  const id = b.requestId ? `r${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId();
  if (!(await store.create("article_price_rules", id, ctx.tenantId, data))) {
    const prior = await store.get("article_price_rules", id); if (mine(ctx, prior) && prior.productId === p.$id) return { id, duplicate: true, belowCost };
    throw new HttpError(409, "Demande déjà utilisée");
  }
  await audit("price.rule.create", id); return { id, belowCost };
}

/** Suppression d'un tarif. Sans risque pour l'historique : chaque vente garde son propre prix et la règle appliquée. */
export async function deletePriceRule(store: Store, ctx: Ctx, b: { id: string }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "tieredPricing");
  const r = await store.get("article_price_rules", b.id);
  if (!mine(ctx, r)) throw new HttpError(404, "Tarif introuvable");
  await store.remove("article_price_rules", r.$id);
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "price.rule.delete", detail: `${r.kind} ${r.price} (${r.$id})` });
  return { id: r.$id };
}
