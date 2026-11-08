/** Abonnements SaaS : formules, périodes (jour → année), quotas et état d'accès. Logique pure, partagée client / serveur. */
export type Period = "day" | "week" | "month" | "quarter" | "year";
export const PERIODS: Period[] = ["day", "week", "month", "quarter", "year"];
export const PERIOD_LABEL: Record<Period, string> = { day: "Jour", week: "Semaine", month: "Mensuel", quarter: "Trimestre", year: "Annuel" };
/** Durées fixes et prévisibles (pas de mois calendaires) : 30 j, 90 j, 365 j. */
export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
/** Délai de grâce après l'échéance : écriture encore permise (jour : aucun, pour ne pas offrir 4 jours pour 1). */
export const GRACE_DAYS: Record<Period, number> = { day: 0, week: 1, month: 3, quarter: 3, year: 3 };
/** Nombre maximum d'unités achetables en une fois. */
export const MAX_COUNT: Record<Period, number> = { day: 31, week: 8, month: 12, quarter: 4, year: 3 };
export const TRIAL = { days: 14, plan: "business" as const };
export const EXPIRING_SOON_DAYS = 3;

export type PlanId = "starter" | "business" | "pro";
/** -1 = illimité. */
export type Limits = { maxShops: number; maxUsers: number; maxProducts: number };
export type Plan = { id: PlanId; name: string; limits: Limits; prices: Record<Period, number> };

/** TARIFS PAR DÉFAUT À VALIDER : ce sont des valeurs de départ, modifiables sans redéploiement par l'administrateur de la plateforme. */
export const DEFAULT_PLANS: Plan[] = [
  { id: "starter", name: "Starter", limits: { maxShops: 1, maxUsers: 2, maxProducts: 200 }, prices: { day: 500, week: 2_500, month: 7_500, quarter: 20_000, year: 70_000 } },
  { id: "business", name: "Business", limits: { maxShops: 3, maxUsers: 10, maxProducts: 2_000 }, prices: { day: 1_000, week: 5_000, month: 15_000, quarter: 40_000, year: 140_000 } },
  { id: "pro", name: "Pro", limits: { maxShops: 20, maxUsers: 100, maxProducts: -1 }, prices: { day: 2_500, week: 12_500, month: 40_000, quarter: 105_000, year: 380_000 } },
];

const isInt = (n: unknown, min: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min;

/** Applique une surcharge validée sur les formules par défaut ; lève si la surcharge est invalide (jamais d'ignorance silencieuse). */
export function mergePlans(override: unknown): Plan[] {
  if (override == null || (Array.isArray(override) && override.length === 0)) return structuredClone(DEFAULT_PLANS);
  if (!Array.isArray(override)) throw new Error("Tarifs invalides");
  const plans = structuredClone(DEFAULT_PLANS);
  for (const o of override as Partial<Plan>[]) {
    const p = plans.find((x) => x.id === o?.id); if (!p) throw new Error(`Formule inconnue : ${String(o?.id)}`);
    if (o.name !== undefined) { if (typeof o.name !== "string" || !o.name.trim() || o.name.length > 40) throw new Error("Nom de formule invalide"); p.name = o.name.trim(); }
    if (o.prices) for (const k of PERIODS) if (o.prices[k] !== undefined) { if (!isInt(o.prices[k], 0)) throw new Error(`Prix invalide (${p.id}/${k})`); p.prices[k] = o.prices[k]; }
    if (o.limits) for (const k of ["maxShops", "maxUsers", "maxProducts"] as const) if (o.limits[k] !== undefined) { if (!isInt(o.limits[k], -1) || o.limits[k] === 0) throw new Error(`Limite invalide (${p.id}/${k})`); p.limits[k] = o.limits[k]; }
  }
  return plans;
}

export const planById = (plans: Plan[], id: string): Plan | undefined => plans.find((p) => p.id === id);
export const priceFor = (plan: Plan, period: Period, count: number): number => plan.prices[period] * count;
export const validCount = (period: Period, count: unknown): count is number => isInt(count, 1) && count <= MAX_COUNT[period];

export function addPeriod(from: Date, period: Period, count: number): Date {
  return new Date(from.getTime() + PERIOD_DAYS[period] * count * 86_400_000);
}

/** « lifetime » : accès à vie accordé par la plateforme (jamais d'échéance, aucune limite, toutes les fonctions présentes et futures). */
export type Sub = { plan: PlanId; period: Period; status: "trial" | "paid" | "lifetime"; renewsAt: string };
export const LIFETIME_END = "9999-12-31T23:59:59.000Z";
export const UNLIMITED: Limits = { maxShops: -1, maxUsers: -1, maxProducts: -1 };
export type AccessState = "active" | "expiring" | "grace" | "locked";
export type Entitlement = { state: AccessState; plan: Plan; period: Period; trial: boolean; lifetime: boolean; endsAt: string; daysLeft: number; limits: Limits; writable: boolean };

export function entitlement(sub: Sub, plans: Plan[], now: Date = new Date()): Entitlement {
  if (sub.status === "lifetime") { // accès à vie : ne dépend ni des dates, ni du catalogue, ni des futures formules
    const top = planById(plans, "pro") ?? plans[plans.length - 1]!;
    return { state: "active", plan: { ...top, name: "À vie", limits: UNLIMITED }, period: "year", trial: false, lifetime: true, endsAt: LIFETIME_END, daysLeft: 99_999, limits: UNLIMITED, writable: true };
  }
  const plan = planById(plans, sub.plan) ?? plans[0]!;
  const ends = new Date(sub.renewsAt).getTime();
  const trial = sub.status === "trial";
  const grace = trial ? 0 : GRACE_DAYS[sub.period];
  const left = (ends - now.getTime()) / 86_400_000;
  const state: AccessState = left > EXPIRING_SOON_DAYS ? "active" : left > 0 ? "expiring" : now.getTime() <= ends + grace * 86_400_000 ? "grace" : "locked";
  return { state, plan, period: sub.period, trial, lifetime: false, endsAt: sub.renewsAt, daysLeft: Math.max(0, Math.ceil(left)), limits: plan.limits, writable: state !== "locked" };
}

/** `max` = -1 : illimité. `count` = nombre déjà utilisé. */
export const canAdd = (count: number, max: number): boolean => max < 0 || count < max;

/** Nouvelle échéance après un paiement : prolonge à partir de l'échéance si même formule encore active, sinon repart de maintenant
 *  (changer de formule en cours de route ne reporte pas le temps restant de l'ancienne). */
export function renewal(current: Sub | null, plan: PlanId, period: Period, count: number, now: Date): { start: Date; end: Date; extended: boolean } {
  const active = !!current && current.plan === plan && new Date(current.renewsAt).getTime() > now.getTime();
  const start = active ? new Date(current!.renewsAt) : now;
  return { start, end: addPeriod(start, period, count), extended: active };
}
