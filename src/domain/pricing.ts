/** Tarification avancée (Pro). Un prix de base (article ou variante) + des règles qui le remplacent selon la situation de la vente.
 *  Priorité : promotion en cours > prix par catégorie de client > palier de quantité > prix de base. À rang égal : priorité saisie, règle propre à
 *  l'unité vendue, règle réservée à une catégorie, plus grand palier atteint, règle la plus récente, identifiant (ordre toujours déterministe).
 *  Le prix retenu et sa source sont enregistrés dans la ligne de vente : modifier le catalogue plus tard ne réécrit jamais l'historique. */
import { parseDecimal } from "./quantity";
import { MAX_AMOUNT } from "./articles";

export const RULE_KINDS = ["promo", "category", "quantity"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const KIND_LABEL: Record<RuleKind, string> = { promo: "Promotion", category: "Prix par catégorie de clients", quantity: "Prix par quantité" };
export const CUSTOMER_CATEGORIES = [{ id: "", label: "Détail" }, { id: "wholesale", label: "Gros" }, { id: "reseller", label: "Revendeur" }] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number]["id"];
export const categoryLabel = (id?: string): string => CUSTOMER_CATEGORIES.find((c) => c.id === (id ?? ""))?.label ?? "Détail";
export const isCategory = (c: unknown): c is CustomerCategory => CUSTOMER_CATEGORIES.some((x) => x.id === c);
export const MAX_RULES_PER_ARTICLE = 50;
const RANK: Record<RuleKind, number> = { promo: 3, category: 2, quantity: 1 };

export type PriceRule = {
  id: string; kind: RuleKind; price: number;
  unit?: string;               // "" ou absent : prix par unité de base ; sinon prix par unité de conversion (ex. carton), pour cette unité seulement
  minQty?: number;             // palier : applicable à partir de cette quantité (dans l'unité de la règle)
  customerCategory?: string;   // "" ou absent : tous les clients
  startsAt?: string; endsAt?: string; // période [début, fin[ (promotion)
  priority?: number; active?: boolean; createdAt?: string; label?: string;
};
export type PriceInput = { basePrice: number; unit?: string; factor?: number; qty: number; baseQty: number; customerCategory?: string; at: string };
export type PriceResult = {
  /** Total de la ligne en FCFA entiers, avant remise manuelle. */
  amount: number;
  /** Prix par unité de base équivalent (amount / quantité de base) : sert à l'affichage et aux marges. */
  unitPrice: number;
  /** Prix par unité vendue (par carton si la vente est en cartons). */
  soldUnitPrice: number;
  source: "base" | RuleKind; ruleId?: string;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export const amountFor = (price: number, qty: number): number => Math.round(round6(price * qty));

/** Une règle est-elle applicable à cette vente ? */
export function applies(r: PriceRule, i: PriceInput): boolean {
  if (r.active === false) return false;
  const soldUnit = i.unit ?? "";
  const ruleUnit = r.unit ?? "";
  if (ruleUnit && ruleUnit !== soldUnit) return false;
  const qty = ruleUnit ? i.qty : i.baseQty; // palier d'une règle « carton » = nombre de cartons ; sinon quantité de base
  if (r.minQty && qty < r.minQty) return false;
  if (r.customerCategory && r.customerCategory !== (i.customerCategory ?? "")) return false;
  if (r.startsAt && i.at < r.startsAt) return false;
  if (r.endsAt && i.at >= r.endsAt) return false;
  return true;
}
const sortKey = (r: PriceRule): [number, number, number, number, number, string, string] =>
  [RANK[r.kind], r.priority ?? 0, r.unit ? 1 : 0, r.customerCategory ? 1 : 0, r.minQty ?? 0, r.createdAt ?? "", r.id];
const better = (a: PriceRule, b: PriceRule): boolean => { const x = sortKey(a), y = sortKey(b); for (let k = 0; k < x.length; k++) if (x[k]! !== y[k]!) return x[k]! > y[k]!; return false; };

/** Prix applicable à une ligne de vente. `rules` = toutes les règles de l'article ou de la variante. */
export function resolvePrice(rules: PriceRule[], i: PriceInput): PriceResult {
  let win: PriceRule | null = null;
  for (const r of rules) if (applies(r, i) && (!win || better(r, win))) win = r;
  if (win) {
    if (win.unit) { const amount = amountFor(win.price, i.qty); return { amount, unitPrice: i.baseQty ? amount / i.baseQty : win.price, soldUnitPrice: win.price, source: win.kind, ruleId: win.id }; }
    const amount = amountFor(win.price, i.baseQty);
    return { amount, unitPrice: win.price, soldUnitPrice: round6(win.price * (i.factor ?? 1)), source: win.kind, ruleId: win.id };
  }
  const amount = amountFor(i.basePrice, i.baseQty);
  return { amount, unitPrice: i.basePrice, soldUnitPrice: round6(i.basePrice * (i.factor ?? 1)), source: "base" };
}

/** Validation d'une règle saisie (formes, bornes, cohérence des champs). Lève une Error au message lisible. */
export function normalizeRule(raw: Record<string, unknown>): Omit<PriceRule, "id" | "createdAt"> {
  const kind = String(raw.kind ?? ""); if (!(RULE_KINDS as readonly string[]).includes(kind)) throw new Error("Type de tarif inconnu");
  const price = typeof raw.price === "string" ? Number(raw.price.replace(/\s/g, "")) : Number(raw.price);
  if (!Number.isInteger(price) || price < 0 || price > MAX_AMOUNT) throw new Error("Prix invalide : montant entier en FCFA");
  const unit = raw.unit === undefined || raw.unit === null ? "" : String(raw.unit);
  let minQty: number | undefined;
  if (raw.minQty !== undefined && raw.minQty !== null && String(raw.minQty).trim() !== "") { const q = parseDecimal(raw.minQty); if (q === null) throw new Error("Quantité minimale invalide"); minQty = q; }
  const customerCategory = raw.customerCategory === undefined || raw.customerCategory === null ? "" : String(raw.customerCategory);
  if (!isCategory(customerCategory)) throw new Error("Catégorie de clients inconnue");
  const date = (v: unknown, label: string): string | undefined => { if (v === undefined || v === null || v === "") return undefined; const ms = Date.parse(String(v)); if (Number.isNaN(ms)) throw new Error(`${label} invalide`); return new Date(ms).toISOString(); };
  const startsAt = date(raw.startsAt, "Date de début"), endsAt = date(raw.endsAt, "Date de fin");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("La date de fin doit suivre la date de début");
  const priority = raw.priority === undefined || raw.priority === "" ? 0 : Number(raw.priority);
  if (!Number.isInteger(priority) || priority < -100 || priority > 100) throw new Error("Priorité invalide (-100 à 100)");
  if (kind === "category" && !customerCategory) throw new Error("Choisissez la catégorie de clients (Gros ou Revendeur)");
  if (kind === "quantity" && !minQty) throw new Error("Indiquez la quantité à partir de laquelle ce prix s'applique");
  if (kind === "promo" && (!startsAt || !endsAt)) throw new Error("Une promotion a une date de début et une date de fin");
  if (kind !== "promo" && (startsAt || endsAt)) throw new Error("Les dates ne concernent que les promotions");
  const label = String(raw.label ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  return { kind: kind as RuleKind, price, unit: unit || undefined, minQty, customerCategory: customerCategory || undefined, startsAt, endsAt, priority, active: raw.active !== false, label };
}

const isoOf = (v: unknown): string | undefined => { if (!v) return undefined; const ms = Date.parse(String(v)); return Number.isNaN(ms) ? undefined : new Date(ms).toISOString(); };
/** Ligne de la table `article_price_rules` → règle du moteur (dates Appwrite « +00:00 » normalisées en ISO « Z » pour la comparaison). */
export function ruleFromRow(r: Record<string, unknown> & { $id: string }): PriceRule {
  return {
    id: r.$id, kind: r.kind as RuleKind, price: Number(r.price), unit: (r.unit as string) || undefined, minQty: Number(r.minQty) > 0 ? Number(r.minQty) : undefined,
    customerCategory: (r.customerCategory as string) || undefined, startsAt: isoOf(r.startsAt), endsAt: isoOf(r.endsAt), priority: Number(r.priority ?? 0),
    active: r.active !== false, createdAt: isoOf(r.$createdAt) ?? "", label: r.label as string | undefined,
  };
}
