/** Bundles virtuels (Pro) : un article « bundle » n'a pas de stock propre ; il est vendu à son prix et sort ses composants du stock. */
export const MAX_COMPONENTS = 20, MAX_COMPONENT_QTY = 9999;
export type Kind = "simple" | "bundle";
export const kindOf = (p: object | null | undefined): Kind => ((p as { kind?: unknown } | null)?.kind === "bundle" ? "bundle" : "simple");
/** Un bundle est « virtuel » (pas de stock propre, composants sortis à la vente) ou un « kit » physique (assemblé à l'avance par ordre d'assemblage, stock propre). */
export type BundleMode = "virtual" | "kit";
export const bundleModeOf = (p: object | null | undefined): BundleMode => ((p as { bundleMode?: unknown } | null)?.bundleMode === "kit" ? "kit" : "virtual");
export const isVirtualBundle = (p: object | null | undefined): boolean => kindOf(p) === "bundle" && bundleModeOf(p) === "virtual";
export const isKit = (p: object | null | undefined): boolean => kindOf(p) === "bundle" && bundleModeOf(p) === "kit";
/** Composant : un article (et sa variante s'il est décliné) en quantité lisible (décimale possible pour un article au kilo / au litre). */
export type Component = { productId: string; variantId?: string; qty: number };
export const componentKey = (c: { productId: string; variantId?: string }): string => `${c.productId}:${c.variantId ?? ""}`;

/** Valide la composition saisie : 1 à 20 composants distincts (article + variante), quantités positives (3 décimales au plus). Renvoie la liste nettoyée. */
export function normalizeComponents(raw: unknown, selfId = ""): Component[] {
  if (!Array.isArray(raw)) throw new Error("Composition invalide");
  if (!raw.length) throw new Error("Ajoutez au moins un composant");
  if (raw.length > MAX_COMPONENTS) throw new Error(`${MAX_COMPONENTS} composants au maximum`);
  const seen = new Set<string>(); const out: Component[] = [];
  for (const c of raw as { productId?: unknown; variantId?: unknown; qty?: unknown }[]) {
    const productId = String(c?.productId ?? "").trim(); if (!productId) throw new Error("Composant sans article");
    if (productId === selfId) throw new Error("Un bundle ne peut pas se contenir lui-même");
    const variantId = String(c?.variantId ?? "").trim(); const key = componentKey({ productId, variantId });
    if (seen.has(key)) throw new Error("Composant en double : regroupez les quantités sur une seule ligne");
    seen.add(key);
    const txt = String(c?.qty ?? "").trim().replace(",", ".");
    if (!/^\d+(\.\d{1,3})?$/.test(txt)) throw new Error(`Quantité de composant invalide (nombre positif, 3 décimales au plus)`);
    const qty = Number(txt); if (!(qty > 0) || qty > MAX_COMPONENT_QTY) throw new Error(`Quantité de composant invalide (de 0,001 à ${MAX_COMPONENT_QTY})`);
    out.push({ productId, ...(variantId ? { variantId } : {}), qty });
  }
  return out;
}
const milli = (n: number): number => Math.round(n * 1000); // calcul en millièmes : aucune erreur d'arrondi sur les décimales
/** Nombre de bundles vendables (ou de kits assemblables) avec le stock actuel des composants : le composant le plus limitant décide. */
export function bundleAvailable(components: Component[], stockOf: (productId: string, variantId?: string) => number): number {
  if (!components.length) return 0;
  return Math.max(0, Math.min(...components.map((c) => Math.floor(milli(stockOf(c.productId, c.variantId)) / milli(c.qty)))));
}
/** Quantités de composants à sortir pour `qty` bundles vendus. */
export const componentNeeds = (components: Component[], qty: number): Component[] => components.map((c) => ({ ...c, qty: milli(c.qty) * qty / 1000 }));
/** Kits assemblables = même calcul que la disponibilité d'un bundle virtuel. */
export const maxAssemblable = bundleAvailable;
