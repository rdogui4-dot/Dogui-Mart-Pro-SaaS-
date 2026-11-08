/** Module Articles : règles de validation et de calcul partagées par l'application et la fonction serveur. */
export const UNITS = [
  { id: "piece", label: "Pièce" }, { id: "kg", label: "Kilogramme" }, { id: "l", label: "Litre" }, { id: "m", label: "Mètre" },
  { id: "carton", label: "Carton" }, { id: "sac", label: "Sac" }, { id: "boite", label: "Boîte" }, { id: "paquet", label: "Paquet" },
] as const;
export type UnitId = (typeof UNITS)[number]["id"];
export const unitLabel = (id?: string): string => UNITS.find((u) => u.id === id)?.label ?? "Pièce";

export const MAX_AMOUNT = 100_000_000; // 100 millions de FCFA : borne anti-saisie aberrante

export type ArticleInput = {
  name?: unknown; sku?: unknown; barcode?: unknown; category?: unknown; description?: unknown;
  price?: unknown; cost?: unknown; unit?: unknown; minStock?: unknown; supplierId?: unknown; archived?: unknown;
};
export type Article = {
  name: string; sku: string; barcode: string; category: string; description: string;
  price: number; cost: number; unit: UnitId; minStock: number; supplierId: string; archived: boolean;
};
/** Champs réservés à la formule Business (la fiche simple : nom, code, catégorie, prix, seuil, reste ouverte à toutes les formules). */
export const BUSINESS_FIELDS = ["description", "unit", "supplierId", "imageFileId"] as const;

const text = (v: unknown, max: number, label: string): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Error(`${label} invalide`);
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length > max) throw new Error(`${label} : ${max} caractères maximum`);
  return t;
};
const amount = (v: unknown, label: string): number => {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} invalide`);
  if (!Number.isInteger(n)) throw new Error(`${label} : montant entier en FCFA (sans décimales)`);
  if (n < 0) throw new Error(`${label} ne peut pas être négatif`);
  if (n > MAX_AMOUNT) throw new Error(`${label} trop élevé`);
  return n;
};

/** Normalise une fiche article complète (création). Lève une Error au message lisible pour l'utilisateur. */
export function normalizeArticle(raw: ArticleInput): Article {
  const name = text(raw.name, 160, "Désignation"); if (!name) throw new Error("La désignation est obligatoire");
  const barcode = text(raw.barcode, 64, "Code-barres"); if (barcode && !/^[A-Za-z0-9._\-/]+$/.test(barcode)) throw new Error("Code-barres : lettres, chiffres et . _ - / uniquement");
  const price = amount(raw.price, "Prix de vente"); const cost = amount(raw.cost, "Prix d'achat");
  const unit = raw.unit === undefined || raw.unit === "" ? "piece" : String(raw.unit);
  if (!UNITS.some((u) => u.id === unit)) throw new Error("Unité inconnue");
  const minStock = raw.minStock === undefined || raw.minStock === "" ? 0 : Number(raw.minStock);
  if (!Number.isInteger(minStock) || minStock < 0 || minStock > 1_000_000) throw new Error("Seuil d'alerte invalide (entier positif)");
  return {
    name, sku: text(raw.sku, 64, "Référence"), barcode, category: text(raw.category, 80, "Catégorie"), description: text(raw.description, 1000, "Description"),
    price, cost, unit: unit as UnitId, minStock, supplierId: text(raw.supplierId, 64, "Fournisseur"), archived: raw.archived === true,
  };
}

/** Modification partielle : seuls les champs fournis sont validés et renvoyés. */
export function normalizePatch(raw: ArticleInput): Partial<Article> {
  const out: Partial<Article> = {};
  const full = normalizeArticle({ name: "x", ...raw });
  for (const k of Object.keys(raw) as (keyof ArticleInput)[]) {
    if (raw[k] === undefined) continue;
    if (k === "name") { const n = normalizeArticle({ name: raw.name }); out.name = n.name; }
    else (out as Record<string, unknown>)[k] = (full as Record<string, unknown>)[k];
  }
  return out;
}

/** Marge brute indicative : montant et pourcentage du prix de vente (null si pas de prix de vente). */
export const marginOf = (price: number, cost: number): { amount: number; pct: number | null } => ({
  amount: price - cost, pct: price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null,
});
/** Alerte de rentabilité : vente à perte (prix de vente strictement inférieur au prix d'achat renseigné). */
export const sellsAtLoss = (price: number, cost: number): boolean => cost > 0 && price < cost;

/** Les valeurs de stock se calculent toujours à partir du journal de mouvements. */
export const stockValue = (qty: number, cost: number): number => Math.max(qty, 0) * cost;
