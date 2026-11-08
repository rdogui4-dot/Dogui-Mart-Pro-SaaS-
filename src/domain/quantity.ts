/** Quantités : décimales de 0 à 3 chiffres, stockées en ENTIERS dans la plus petite sous-unité (échelle de l'article).
 *  Exemple : un article au kilo avec échelle 3 stocke 1,5 kg sous la forme 1500 (grammes). Aucune addition ni soustraction de nombres à virgule. */
export const SCALES = [0, 1, 2, 3] as const;
export type Scale = (typeof SCALES)[number];
export const MAX_QTY = 10_000_000;
export const scaleLabel = (s: number): string => (s === 0 ? "Entière (pièces)" : `${s} décimale${s > 1 ? "s" : ""} (ex. ${(1.5).toFixed(Math.min(s, 3))})`);

const DEC = /^\d+(\.\d{1,3})?$/;
/** Lit un nombre positif à 3 décimales au plus ; null sinon. */
export function parseDecimal(x: unknown): number | null {
  if (typeof x !== "string" && typeof x !== "number") return null;
  const t = String(x).trim().replace(",", ".");
  if (!DEC.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_QTY ? n : null;
}
export const isScale = (s: unknown): s is Scale => s === 0 || s === 1 || s === 2 || s === 3;
export const scaleOf = (p: object | null | undefined): Scale => { const n = Number((p as { qtyScale?: unknown } | null)?.qtyScale ?? 0); return isScale(n) ? n : 0; };
const decimalsOf = (n: number): number => { const t = String(n); const i = t.indexOf("."); return i < 0 ? 0 : t.length - i - 1; };

/** Quantité saisie pour un article d'échelle donnée : positive, avec au plus `scale` décimales. */
export function qtyFor(x: unknown, scale: number): number {
  const n = parseDecimal(x);
  if (n === null) throw new Error("Quantité invalide");
  if (decimalsOf(n) > scale) throw new Error(scale === 0 ? "Cet article se vend à l'unité entière" : `Cet article se vend avec ${scale} décimale${scale > 1 ? "s" : ""} au maximum`);
  return n;
}
/** Valeur stockée : entier exact. */
export const scaledInt = (qty: number, scale: number): number => Math.round(qty * 10 ** scale);
/** Valeur lisible à partir de l'entier stocké. */
export const fromScaled = (n: number, scale: number): number => (scale === 0 ? n : Math.round(n) / 10 ** scale);

/** Quantité de l'unité de base correspondant à `unitQty` d'une unité de conversion (ex. 2 cartons × 12 = 24 pièces). Erreur si le résultat n'est pas représentable à l'échelle de l'article. */
export function convertQty(unitQty: number, factor: number, scale: number): number {
  const base = Math.round(unitQty * factor * 1e6) / 1e6;
  if (!(base > 0) || base > MAX_QTY) throw new Error("Quantité invalide");
  if (decimalsOf(base) > scale) throw new Error("Cette quantité ne correspond pas à un nombre entier de la plus petite unité de l'article");
  return base;
}
/** Un coefficient de conversion est valide s'il est positif et exprimable à l'échelle de l'article. */
export function validFactor(factor: unknown, scale: number): factor is number {
  const n = parseDecimal(factor);
  return n !== null && n <= 1_000_000 && decimalsOf(n) <= scale;
}
export const formatQty = (n: number): string => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
/** Montant d'une ligne : prix par unité de base × quantité décimale, arrondi au franc sans dérive de virgule flottante. */
export const amountOf = (price: number, qty: number): number => Math.round(Math.round(price * qty * 1e6) / 1e6);

/** Identifiant de la ligne « conditionnement » : stable, unique par (article, unité), et dans la limite de 36 caractères d'Appwrite. */
export const unitRowId = (productId: string, unit: string): string => `${productId.slice(0, 24)}_${unit}`;
