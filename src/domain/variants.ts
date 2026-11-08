/** Variantes d'un article : une combinaison d'attributs (Taille M, Couleur Rouge…) avec son propre SKU, ses prix et son stock. */
export const ATTRIBUTE_SUGGESTIONS = ["Taille", "Couleur", "Modèle", "Format", "Matière"] as const;
export const MAX_ATTRIBUTES = 5, MAX_VARIANTS = 200;
export type Attribute = { name: string; value: string };

const clean = (v: unknown, max: number, label: string): string => {
  if (typeof v !== "string") throw new Error(`${label} invalide`);
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) throw new Error(`${label} obligatoire`);
  if (t.length > max) throw new Error(`${label} : ${max} caractères maximum`);
  return t;
};

/** Valide la liste d'attributs d'une variante. `key` identifie la combinaison (insensible à la casse et à l'ordre) : deux variantes d'un même article ne peuvent pas l'avoir en commun. */
export function normalizeAttributes(raw: unknown): { attrs: Attribute[]; key: string; label: string } {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Indiquez au moins un attribut (ex. Taille : M)");
  if (raw.length > MAX_ATTRIBUTES) throw new Error(`${MAX_ATTRIBUTES} attributs au maximum`);
  const seen = new Set<string>(); const attrs: Attribute[] = [];
  for (const a of raw as { name?: unknown; value?: unknown }[]) {
    const name = clean(a?.name, 30, "Nom de l'attribut"), value = clean(a?.value, 40, `Valeur de « ${String(a?.name ?? "")} »`);
    if (seen.has(name.toLowerCase())) throw new Error(`Attribut en double : ${name}`);
    seen.add(name.toLowerCase()); attrs.push({ name, value });
  }
  const key = attrs.map((a) => `${a.name.toLowerCase()}=${a.value.toLowerCase()}`).sort().join("|");
  return { attrs, key, label: attrs.map((a) => a.value).join(" / ") };
}
export const parseAttributes = (json: unknown): Attribute[] => { try { const v = JSON.parse(String(json)); return Array.isArray(v) ? (v as Attribute[]) : []; } catch { return []; } };
export const variantLabel = (v: { attributes?: unknown; label?: unknown }): string => String(v.label ?? "") || parseAttributes(v.attributes).map((a) => a.value).join(" / ");
export const lineKey = (l: { productId: string; variantId?: string }): string => (l.variantId ? `${l.productId}:${l.variantId}` : l.productId);
