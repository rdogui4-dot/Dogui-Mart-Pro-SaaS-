/** Rapports & Analyses (kit écran 21) : évolution mensuelle, projection prudente, rapports clients. Calculs purs, sans valeur présumée. */
import { linearFit, reliability, type Fact, type Reliability } from "./analytics";

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Clés « AAAA-MM » des `n` mois se terminant au mois de `today` (inclus), du plus ancien au plus récent. */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number); const out: string[] = [];
  for (let k = n - 1; k >= 0; k--) { const d = new Date(Date.UTC(y!, m! - 1 - k, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}
export type MonthRow = { month: string; revenue: number; count: number; margin: number | null; qty: number; growthPct: number | null };
/** Agrégat mensuel : CA TTC, ventes, marge brute HT (seulement si le coût de toutes les lignes du mois est connu), quantités, croissance vs mois précédent. */
export function monthly(facts: Fact[], months: string[]): MonthRow[] {
  const out: MonthRow[] = months.map((month) => ({ month, revenue: 0, count: 0, margin: 0, qty: 0, growthPct: null }));
  const at = new Map(out.map((r) => [r.month, r])); const noCost = new Set<string>();
  for (const f of facts) { const r = at.get(f.day.slice(0, 7)); if (!r) continue; r.revenue += f.total; r.count++; let ht = 0, cost = 0;
    for (const l of f.lines) { r.qty += l.qty; ht += l.revenueHt; if (l.cost === null) noCost.add(r.month); else cost += l.cost; } r.margin = (r.margin ?? 0) + ht - cost; }
  for (const r of out) { r.margin = noCost.has(r.month) || !r.count || r.margin === null ? null : Math.round(r.margin); r.qty = Math.round(r.qty * 1000) / 1000; }
  for (let i = 1; i < out.length; i++) { const p = out[i - 1]!.revenue; out[i]!.growthPct = p > 0 ? r1(((out[i]!.revenue - p) / p) * 100) : null; }
  return out;
}
export type Projection = { points: { month: string; value: number }[]; reliability: Reliability; method: string } | null;
/** Projection du CA sur `ahead` mois : régression linéaire sur les mois COMPLETS ; aucune projection si moins de 4 mois avec ventes ou fiabilité insuffisante. */
export function projectRevenue(complete: { month: string; revenue: number }[], ahead = 3): Projection {
  const vals = complete.map((c) => c.revenue); if (vals.filter((v) => v > 0).length < 4) return null;
  const fit = linearFit(vals); const rel = reliability(vals, fit.r2); if (rel === "insuffisante") return null;
  const last = complete.at(-1)!.month; const mx = (vals.length - 1) / 2; const [y, m] = last.split("-").map(Number);
  const points = Array.from({ length: ahead }, (_, k) => { const x = vals.length + k; const d = new Date(Date.UTC(y!, m! + k, 1)); return { month: d.toISOString().slice(0, 7), value: Math.max(0, Math.round(fit.mean + fit.slope * (x - mx))) }; });
  return { points, reliability: rel, method: `Régression linéaire sur ${vals.length} mois complets (R² ${fit.r2.toLocaleString("fr-FR")}) ; tendance prolongée, sans saisonnalité.` };
}

export type ClientRow = { id: string; name: string; revenue: number; count: number; basket: number; lastDay: string };
/** Rapports clients : ventes rattachées à un client (par identifiant de vente), nouveaux clients (fiche créée dans la période), clients revenus (achat dans la période ET la précédente), comptoir à part. */
export function clientsReport(facts: Fact[], prevFacts: Fact[], customerOf: Map<string, string | undefined>, customers: { id: string; name: string; createdAt: string; credit: number }[], period: { from: string; to: string }, top = 10) {
  const name = new Map(customers.map((c) => [c.id, c.name])); const by = new Map<string, ClientRow>(); let walkIn = 0, walkInCount = 0, identified = 0, identifiedCount = 0;
  for (const f of facts) { const c = customerOf.get(f.saleId); if (!c) { walkIn += f.total; walkInCount++; continue; } identified += f.total; identifiedCount++;
    const r = by.get(c) ?? { id: c, name: name.get(c) ?? "Client supprimé", revenue: 0, count: 0, basket: 0, lastDay: "" }; r.revenue += f.total; r.count++; if (f.day > r.lastDay) r.lastDay = f.day; by.set(c, r); }
  for (const r of by.values()) r.basket = Math.round(r.revenue / r.count);
  const prevBuyers = new Set(prevFacts.map((f) => customerOf.get(f.saleId)).filter((x): x is string => !!x));
  const total = identified + walkIn;
  return { buyers: by.size, identifiedRevenue: identified, identifiedSales: identifiedCount, walkInRevenue: walkIn, walkInSales: walkInCount, identifiedSharePct: total > 0 ? r1((identified / total) * 100) : null,
    basket: identifiedCount ? Math.round(identified / identifiedCount) : null, newCustomers: customers.filter((c) => c.createdAt.slice(0, 10) >= period.from && c.createdAt.slice(0, 10) <= period.to).length,
    returning: [...by.keys()].filter((k) => prevBuyers.has(k)).length, credit: customers.reduce((s, c) => s + Math.max(0, c.credit), 0), creditCustomers: customers.filter((c) => c.credit > 0).length,
    top: [...by.values()].sort((a, b) => b.revenue - a.revenue).slice(0, top) };
}
