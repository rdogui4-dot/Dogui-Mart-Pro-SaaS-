/** Dépenses et sorties de caisse (Business) : constantes et règles pures, partagées par le serveur et l'interface. */
export const DEFAULT_CATEGORIES = [
  { id: "transport", label: "Transport" }, { id: "loyer", label: "Loyer" }, { id: "electricite", label: "Électricité" }, { id: "eau", label: "Eau" }, { id: "internet", label: "Internet" },
  { id: "entretien", label: "Entretien" }, { id: "salaires", label: "Salaires" }, { id: "fournitures", label: "Fournitures" }, { id: "communication", label: "Communication" }, { id: "taxes", label: "Taxes" }, { id: "autres", label: "Autres" },
] as const;
export const METHODS = [{ id: "cash", label: "Espèces" }, { id: "mobile", label: "Mobile Money" }, { id: "transfer", label: "Virement" }, { id: "other", label: "Autre moyen" }] as const;
export const SOURCES = [{ id: "till", label: "Payée depuis la caisse" }, { id: "external", label: "Payée depuis un compte externe" }] as const;
export const EXPENSE_RIGHTS = ["view", "create", "modify", "approve", "cancel"] as const;
export type ExpenseRight = (typeof EXPENSE_RIGHTS)[number];
export const EXPENSE_RIGHT_LABEL: Record<ExpenseRight, string> = { view: "Consulter toutes les dépenses de la boutique", create: "Enregistrer une dépense", modify: "Modifier une dépense", approve: "Valider ou rejeter, sans validation préalable", cancel: "Annuler une dépense" };
/** Par défaut : propriétaire et gérant ont tous les droits ; le caissier peut enregistrer (et voit ses propres dépenses). */
export const DEFAULT_EXPENSE_RIGHTS: Record<string, readonly ExpenseRight[]> = { owner: EXPENSE_RIGHTS, manager: EXPENSE_RIGHTS, cashier: ["create"] };
export const SENSITIVE_DEFAULT = ["salaires", "taxes"];
export const STATUS_LABEL: Record<string, string> = { pending: "En attente de validation", approved: "Validée", rejected: "Rejetée", cancelled: "Annulée" };
export const categoryLabel = (id: string, custom: string[] = []): string => DEFAULT_CATEGORIES.find((c) => c.id === id)?.label ?? (custom.includes(id) ? id : id);
export const methodLabel = (id: string): string => METHODS.find((m) => m.id === id)?.label ?? id;
/** Une dépense doit-elle être validée par un responsable ? (catégorie sensible ou montant au-dessus du seuil ; seuil 0 = désactivé) */
export const needsApproval = (o: { category: string; amount: number; threshold: number; sensitive: string[]; canApprove: boolean }): boolean => !o.canApprove && (o.sensitive.includes(o.category) || (o.threshold > 0 && o.amount >= o.threshold));
/** La date de dépense est un jour civil ; on la stocke à midi UTC pour qu'elle reste le même jour quel que soit le fuseau (UTC−11 à UTC+11). */
export const dayToStored = (day: string): string => `${day}T12:00:00.000Z`;
export const storedToDay = (iso: string): string => String(iso).slice(0, 10);
export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Code de validation d'une dépense (remplace le justificatif) : 8 caractères sans ambiguïté (ni 0/O ni 1/I), saisi en majuscules. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_TTL_MS = 12 * 3_600_000; export const CODE_MAX_FAILS = 5;
export const normalizeCode = (s: unknown): string => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (c: string): string => `${c.slice(0, 4)}-${c.slice(4)}`;
export const isCodeShape = (c: string): boolean => c.length === 8 && [...c].every((x) => CODE_ALPHABET.includes(x));
