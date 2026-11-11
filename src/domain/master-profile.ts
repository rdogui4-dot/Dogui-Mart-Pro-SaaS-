/** MASTER DOGUI : profil d'entreprise (cahier §5, §5.1). Domaine pur : catalogue FERMÉ des faits, validation, qualification.
 *  Un fait « vérifié » n'est jamais stocké (il est lu dans les modules à l'affichage). Les faits stockés sont déclarés, hypothèse ou estimation. */
export type FactKind = "declared" | "hypothesis" | "estimate";
export const KINDS: FactKind[] = ["declared", "hypothesis", "estimate"];
export const KIND_LABEL: Record<FactKind | "verified", string> = { verified: "Vérifié (module)", declared: "Déclaré", hypothesis: "Hypothèse", estimate: "Estimation" };
type Opt = [string, string];
export type FactDef = { key: string; label: string; type: "enum" | "multi" | "text" | "months"; options?: Opt[]; max?: number; maxLen?: number; shop: boolean; ownerOnlyRead?: boolean; help?: string };
const GOALS: Opt[] = [["marge", "Améliorer la marge"], ["volume", "Augmenter le volume de ventes"], ["tresorerie", "Sécuriser la trésorerie"], ["croissance", "Croissance / nouvelles boutiques"]];
export const FACTS: FactDef[] = [
  { key: "sector", label: "Secteur d'activité", type: "enum", shop: false, options: [["alimentation", "Alimentation"], ["boissons", "Boissons"], ["pharmacie", "Pharmacie / parapharmacie"], ["habillement", "Habillement / chaussures"], ["cosmetique", "Cosmétique / beauté"], ["electronique", "Électronique / téléphonie"], ["quincaillerie", "Quincaillerie / bâtiment"], ["papeterie", "Papeterie / fournitures"], ["restauration", "Restauration"], ["services", "Services"], ["autre", "Autre"]] },
  { key: "form", label: "Forme d'activité", type: "enum", shop: false, options: [["detail", "Commerce de détail"], ["gros", "Commerce de gros"], ["mixte", "Détail et gros"]] },
  { key: "size", label: "Taille (nombre de personnes)", type: "enum", shop: false, options: [["1-2", "1 à 2"], ["3-5", "3 à 5"], ["6-10", "6 à 10"], ["11-25", "11 à 25"], ["26+", "Plus de 25"]] },
  { key: "country", label: "Pays", type: "text", shop: false, maxLen: 60 },
  { key: "goal", label: "Objectif principal", type: "enum", shop: true, options: GOALS },
  { key: "priorities", label: "Priorités (3 au plus)", type: "multi", shop: true, max: 3, options: [...GOALS, ["stock", "Maîtriser le stock"], ["clients", "Fidéliser les clients"], ["depenses", "Réduire les dépenses"], ["fournisseurs", "Optimiser les achats"]] },
  { key: "constraints", label: "Contraintes", type: "text", shop: false, maxLen: 300, ownerOnlyRead: true, help: "Texte court, jamais interprété comme une consigne." },
  { key: "peakMonths", label: "Mois de forte activité", type: "months", shop: true },
  { key: "hours", label: "Horaires d'ouverture", type: "text", shop: true, maxLen: 120 },
  { key: "remarks", label: "Remarques", type: "text", shop: true, maxLen: 300, help: "Texte court, jamais interprété comme une consigne." },
];
export const factDef = (key: string): FactDef | undefined => FACTS.find((f) => f.key === key);
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
/** Valide et normalise une valeur ; renvoie la chaîne à stocker ou une erreur lisible. Aucune valeur hors catalogue. */
export function normalizeValue(def: FactDef, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (def.type === "text") { const v = clean(String(raw ?? "")); if (!v) return { ok: false, error: "Valeur vide" }; if (v.length > (def.maxLen ?? 120)) return { ok: false, error: `Maximum ${def.maxLen} caractères` }; return { ok: true, value: v }; }
  if (def.type === "enum") { const v = String(raw ?? ""); return def.options!.some(([k]) => k === v) ? { ok: true, value: v } : { ok: false, error: "Valeur non autorisée" }; }
  const arr = Array.isArray(raw) ? raw.map(String) : []; const uniq = [...new Set(arr)];
  if (!uniq.length) return { ok: false, error: "Choisissez au moins une valeur" };
  if (def.type === "months") return uniq.every((m) => /^(1[0-2]|[1-9])$/.test(m)) ? { ok: true, value: JSON.stringify(uniq.map(Number).sort((a, b) => a - b)) } : { ok: false, error: "Mois invalide" };
  if (uniq.length > (def.max ?? 3)) return { ok: false, error: `${def.max} choix au plus` };
  return uniq.every((v) => def.options!.some(([k]) => k === v)) ? { ok: true, value: JSON.stringify(uniq) } : { ok: false, error: "Valeur non autorisée" };
}
/** Texte lisible d'une valeur stockée. */
export function labelOf(def: FactDef, value: string): string {
  const one = (v: string) => def.options?.find(([k]) => k === v)?.[1] ?? v;
  if (def.type === "multi") { try { return (JSON.parse(value) as string[]).map(one).join(", "); } catch { return value; } }
  if (def.type === "months") { try { return (JSON.parse(value) as number[]).map((m) => ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."][m - 1]).join(", "); } catch { return value; } }
  return one(value);
}
/** Règles de promotion : une hypothèse ou une estimation ne devient « déclarée » que par confirmation explicite d'un utilisateur autorisé. */
export const canConfirm = (kind: string): boolean => kind === "hypothesis" || kind === "estimate";
