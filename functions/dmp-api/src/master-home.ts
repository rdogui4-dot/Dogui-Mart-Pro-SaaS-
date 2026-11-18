/** MASTER DOGUI — vue d'ensemble (kit écran 20) : santé de l'activité (règles publiées), alertes, recommandations ouvertes, insights et synthèse du mois.
 *  Réservée à la licence MASTER active (propriétaire et gérants). Chaque section est calculée séparément ; une section inaccessible (rôle, formule) est signalée, jamais inventée. */
import { lineTotal } from "../../../src/domain/money";
import { healthDims, healthScore, type HealthIn } from "../../../src/domain/master-home";
import { needFeature } from "./articles";
import { MIN, parse } from "./crm";
import { accountsView, dues, perfData, view as finView } from "./fin";
import { roleKind } from "./fin-rules";
import { masterEntitlement, needMaster } from "./master";
import { aiMode } from "./master-chat";
import { recoList } from "./master-reco";
import { shopStock } from "./stock-biz";
import { HttpError, type Ctx, type Store } from "./store";

type Unavailable = { section: string; reason: string };
type Alert = { id: string; level: "critical" | "warning" | "info"; text: string; link: string };
const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");

export async function home(store: Store, ctx: Ctx) {
  if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); if (!ctx.shopId) throw new HttpError(400, "Choisissez une boutique");
  const lic = await masterEntitlement(store, ctx.tenantId);
  if (!lic.canAnalyze) return { licensed: false, state: lic.state, ai: aiMode() };
  await needMaster(store, ctx); const unavailable: Unavailable[] = [];
  const sect = async <T,>(name: string, f: () => Promise<T>, opts: { module?: string; feature?: Parameters<typeof needFeature>[2] } = {}): Promise<T | null> => {
    try { if (opts.module && !ctx.modules?.includes(opts.module as never)) throw new Error(`module non accessible avec votre rôle`); if (opts.feature) await needFeature(store, ctx, opts.feature); return await f(); }
    catch (e) { unavailable.push({ section: name, reason: String((e as Error).message ?? e).slice(0, 140) }); return null; }
  };

  const perf = await sect("Synthèse du mois", () => perfData(store, ctx), { module: "reports" });
  const stock = await sect("Stocks", async () => { const { items } = await shopStock(store, ctx); return { articles: items.length, out: items.filter((i) => i.qty <= 0).map((i) => i.name), low: items.filter((i) => i.qty > 0 && i.min > 0 && i.qty <= i.min).map((i) => i.name) }; }, { module: "stock" });
  const treasury = await sect("Trésorerie", async () => { const v = accountsView(await finView(store, ctx)); const acc = v.accounts.filter((a) => a.configured && a.balance !== null); return acc.length ? { balance: acc.reduce((s, a) => s + (a.balance ?? 0), 0), accounts: acc.length } : null; }, { module: "accounting", feature: "finBusiness" });
  const debts = await sect("Échéances", async () => { const d = await dues(store, ctx); return { overdue: d.payables.overdue, dueSoon: d.payables.dueSoon }; }, { module: "accounting", feature: "finBusiness" });
  const pendingExp = await sect("Dépenses", async () => (await store.scan("expenses", { ...MIN(ctx), status: "pending" }, { maxRows: 2000 })).rows.length, { feature: "expenses" });
  const top = await sect("Meilleur article", async () => { const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString(); const sales = (await store.scan("sales", { ...MIN(ctx), status: "paid" }, { range: { field: "soldAt", from, to: new Date(Date.now() + 864e5).toISOString() }, maxRows: 50_000 })).rows;
    const by = new Map<string, { name: string; revenue: number; cost: number; costKnown: boolean }>(); for (const s of sales) for (const l of parse<{ productId?: string; name?: string; qty: number; unitPrice: number; unitCost?: number }[]>(s.lines, [])) { const k = String(l.productId ?? l.name ?? ""); if (!k) continue; const e = by.get(k) ?? { name: String(l.name ?? k), revenue: 0, cost: 0, costKnown: true }; e.revenue += lineTotal(l as never); if (l.unitCost) e.cost += l.unitCost * l.qty; else e.costKnown = false; by.set(k, e); }
    const best = [...by.values()].sort((a, b) => b.revenue - a.revenue)[0]; return best ? { name: best.name, revenue: Math.round(best.revenue), marginPct: best.costKnown && best.revenue > 0 ? Math.round(((best.revenue - best.cost) / best.revenue) * 1000) / 10 : null } : null; }, { module: "reports" });
  const recos = await sect("Recommandations", async () => { const r = await recoList(store, ctx, { status: "new", shopId: ctx.shopId, limit: 3 }); return { items: r.recos.map((x) => ({ id: x.id, prio: x.prio, title: x.title, reason: x.reason, module: x.module })), total: r.counts.new ?? r.total }; });

  const cur = perf?.current ?? null, prev = perf?.previous ?? null;
  const hin: HealthIn = { revenue: cur?.revenue ?? null, prevRevenue: prev && prev.sales ? prev.revenue : null, articles: stock?.articles ?? null, out: stock ? stock.out.length : null, low: stock ? stock.low.length : null,
    cashBalance: treasury?.balance ?? null, payablesSoon: debts ? debts.overdue + debts.dueSoon : null, expenses: cur?.expenses ?? null, prevExpenses: prev ? prev.expenses : null, netMarginPct: cur?.netMarginPct ?? null, prevNetMarginPct: prev?.netMarginPct ?? null };
  const dims = healthDims(hin); const score = healthScore(dims);

  const alerts: Alert[] = [];
  if (stock?.out.length) alerts.push({ id: "out", level: "critical", text: `Rupture : ${stock.out.slice(0, 3).join(", ")}${stock.out.length > 3 ? ` et ${stock.out.length - 3} autre(s)` : ""}.`, link: "/stock" });
  if (stock?.low.length) alerts.push({ id: "low", level: "warning", text: `Stock faible : ${stock.low.slice(0, 3).join(", ")}${stock.low.length > 3 ? ` et ${stock.low.length - 3} autre(s)` : ""}.`, link: "/stock" });
  if (debts && debts.overdue > 0) alerts.push({ id: "overdue", level: "critical", text: `Dettes fournisseurs et dépenses en retard : ${fr(debts.overdue)} F.`, link: "/finance" });
  if (debts && debts.dueSoon > 0) alerts.push({ id: "soon", level: "warning", text: `Échéances à payer sous 30 jours : ${fr(debts.dueSoon)} F.`, link: "/finance" });
  if (cur && prev && prev.expenses > 0 && cur.expenses > prev.expenses * 1.05) alerts.push({ id: "exp", level: "info", text: `Dépenses en hausse : +${fr(((cur.expenses - prev.expenses) / prev.expenses) * 100)} % par rapport au mois précédent.`, link: "/depenses" });
  if (pendingExp) alerts.push({ id: "pending", level: "info", text: `${pendingExp} dépense(s) en attente de validation.`, link: "/depenses" });

  const insights: string[] = [];
  if (cur && prev && prev.revenue > 0) { const d = ((cur.revenue - prev.revenue) / prev.revenue) * 100; insights.push(`Vos ventes ont ${d >= 0 ? "augmenté" : "baissé"} de ${Math.abs(Math.round(d * 10) / 10).toLocaleString("fr-FR")} % par rapport au mois précédent.`); }
  if (cur?.netMarginPct != null) insights.push(`La marge nette du mois est de ${cur.netMarginPct.toLocaleString("fr-FR")} %${prev?.netMarginPct != null ? ` (${cur.netMarginPct - prev.netMarginPct >= 0 ? "+" : ""}${(Math.round((cur.netMarginPct - prev.netMarginPct) * 10) / 10).toLocaleString("fr-FR")} point(s))` : ""}.`);
  else if (cur?.reasons?.length) insights.push(`Marge nette du mois non calculable : ${cur.reasons.join(", ")}.`);
  if (top) insights.push(`Article le plus vendu du mois : « ${top.name} » (${fr(top.revenue)} F${top.marginPct !== null ? `, marge brute ${top.marginPct.toLocaleString("fr-FR")} %` : ""}).`);

  const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
  return { licensed: true, state: lic.state, ai: aiMode(), generatedAt: new Date().toISOString(),
    health: { dims, ...score, method: "Bon = 20 points, à surveiller = 10, à traiter = 0 ; score = points obtenus ÷ points possibles × 100, sur les seuls indicateurs disposant de données (au moins 3)." },
    alerts, recos, insights,
    month: cur ? { month: cur.month, revenue: cur.revenue, revenueDelta: prev && prev.sales ? delta(cur.revenue, prev.revenue) : null, expenses: cur.expenses, expensesDelta: delta(cur.expenses, prev?.expenses), net: cur.net, netDelta: delta(cur.net, prev?.net), netMarginPct: cur.netMarginPct, marginPts: cur.netMarginPct != null && prev?.netMarginPct != null ? Math.round((cur.netMarginPct - prev.netMarginPct) * 10) / 10 : null, reasons: cur.reasons } : null,
    unavailable, note: "Analyses calculées à partir des données réelles de la boutique ; aucune action n'est exécutée automatiquement." };
}
