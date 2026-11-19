/** Tableau de bord (kit écran 08) : comparaisons avec la période précédente et clients actifs. Calculs purs, aucune valeur présumée :
 *  un écart n'existe que si la période de comparaison a un chiffre d'affaires strictement positif. */
import { addDays, dayKeyer, daysIn, monthStart, type SaleIn } from "./overview";

/** Écart en % arrondi au dixième ; null si la référence est nulle (rien à comparer). */
export const pctDelta = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
export type Span = { from: string; to: string };
/** Mois précédent sur le même nombre de jours que le mois en cours à ce jour (borné à la fin du mois précédent). */
export function prevMonthSpan(today: string): Span {
  const prevLast = addDays(monthStart(today), -1); const prevFirst = monthStart(prevLast); const to = addDays(prevFirst, Number(today.slice(8, 10)) - 1);
  return { from: prevFirst, to: to > prevLast ? prevLast : to };
}
/** Période immédiatement précédente, de même durée. */
export const previousSpan = (p: { from: string; days: number }): Span => ({ from: addDays(p.from, -p.days), to: addDays(p.from, -1) });
/** Nombre de clients distincts ayant au moins une vente terminée rattachée à leur fiche sur la période. Les ventes au comptoir (sans fiche) ne comptent pas. */
export function activeCustomers(rows: (SaleIn & { customerId?: string })[], tz: string, span: Span): number {
  const key = dayKeyer(tz); const ids = new Set<string>();
  for (const r of rows) if (r.status === "paid" && r.customerId) { const d = key(r.soldAt); if (d >= span.from && d <= span.to) ids.add(r.customerId); }
  return ids.size;
}
export type TrendRange = "7" | "30" | "month";
export type Trend = { current: { date: string; revenue: number; count: number }[]; previous: { date: string; revenue: number }[]; currentSpan: Span; previousSpan: Span };
/** Courbe d'évolution : 7 jours, 30 jours ou mois en cours, avec la période précédente alignée jour à jour (pour le tracé en pointillé). */
export function trendSpans(range: TrendRange, today: string): { cur: Span; prev: Span } {
  if (range === "month") return { cur: { from: monthStart(today), to: today }, prev: prevMonthSpan(today) };
  const n = range === "7" ? 7 : 30; const from = addDays(today, -(n - 1)); return { cur: { from, to: today }, prev: { from: addDays(from, -n), to: addDays(from, -1) } };
}
export const spanDays = (s: Span) => daysIn(s.from, s.to);
