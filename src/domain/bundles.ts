/** Bundles virtuels (Pro) : un article « bundle » n'a pas de stock propre ; il est vendu à son prix et sort ses composants du stock. */
export const MAX_COMPONENTS = 20, MAX_COMPONENT_QTY = 9999;
export type Kind = "simple" | "bundle";
export const kindOf = (p: object | null | undefined): Kind => ((p as { kind?: unknown } | null)?.kind === "bundle" ? "bundle" : "simple");
/** Un bundle est « virtuel » (pas de stock propre, composants sortis à la vente) ou un « kit » physique (assemblé à l'avance par ordre d'assemblage, stock propre). */
export type BundleMode = "virtual" | "kit";
export const bundleModeOf = (p: object | null | undefined): BundleMode => ((p as { bundleMode?: unknown } | null)?.bundleMode === "kit" ? "kit" : "virtual");
export const isVirtualBundle = (p: object | null | undefined): boolean => kindOf(p) === "bundle" && bundleModeOf(p) === "virtual";
export const isKit = (p: object | null | undefined): boolean => kindOf(p) === "bundle" && bundleModeOf(p) === "kit";
/** Nombre maximal de kits assemblables avec le stock actuel des composants. */
export type Component = { productId: string; qty: number };

/** Valide la composition saisie : 1 à 20 composants distincts, quantités entières positives. Renvoie la liste nettoyée. */
export function normalizeComponents(raw: unknown, selfId = ""): Component[] {
  if (!Array.isArray(raw)) throw new Error("Composition invalide");
  if (!raw.length) throw new Error("Ajoutez au moins un composant");
  if (raw.length > MAX_COMPONENTS) throw new Error(`${MAX_COMPONENTS} composants au maximum`);
  const seen = new Set<string>(); const out: Component[] = [];
  for (const c of raw as { productId?: unknown; qty?: unknown }[]) {
    const productId = String(c?.productId ?? "").trim(); if (!productId) throw new Error("Composant sans article");
    if (productId === selfId) throw new Error("Un bundle ne peut pas se contenir lui-même");
    if (seen.has(productId)) throw new Error("Composant en double : regroupez les quantités sur une seule ligne");
    seen.add(productId);
    const qty = Number(String(c?.qty ?? "").replace(",", "."));
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_COMPONENT_QTY) throw new Error(`Quantité de composant invalide (entier de 1 à ${MAX_COMPONENT_QTY})`);
    out.push({ productId, qty });
  }
  return out;
}
/** Nombre de bundles vendables avec le stock actuel des composants (le composant le plus limitant décide). */
export function bundleAvailable(components: Component[], stockOf: (productId: string) => number): number {
  if (!components.length) return 0;
  return Math.max(0, Math.min(...components.map((c) => Math.floor(stockOf(c.productId) / c.qty))));
}
/** Quantités de composants à sortir pour `qty` bundles vendus. */
export const componentNeeds = (components: Component[], qty: number): Component[] => components.map((c) => ({ productId: c.productId, qty: c.qty * qty }));

/** Kits assemblables = même calcul que la disponibilité d'un bundle virtuel. */
export const maxAssemblable = bundleAvailable;
