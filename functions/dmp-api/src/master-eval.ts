/** MASTER DOGUI — lot 2 : coûts de l'IA (panneau administrateur) et jeu de référence (§18.1).
 *  Le jeu de référence tourne sur des DONNÉES SYNTHÉTIQUES construites en mémoire à chaque appel : aucune donnée d'entreprise n'est lue ni transmise. Seuls les appels au fournisseur sont réels. */
import { MODULES } from "../../../src/domain/access";
import { GUIDED, matchQuestion } from "../../../src/domain/master-chat";
import { aiConfig, aiStatus, geminiJson } from "./ai-gemini";
import { MemoryStore } from "./memory-store";
import { TOOLS, addGlobalTokens, aiClassifyVia, aiWriteVia, globalTokensToday, type Caller, type Env } from "./master-chat";
import { HttpError, type Ctx, type Row, type Store } from "./store";

const adminOnly = (ctx: Ctx) => { if (!ctx.admin) throw new HttpError(403, "Réservé à l'administrateur de la plateforme"); };
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ données synthétiques
class EvalStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
export const EVAL_TENANT = "evaltenant01";
export async function evalDataset(): Promise<{ store: EvalStore; ctx: Ctx; shop: Row }> {
  const st = new EvalStore(); const T = EVAL_TENANT; await st.grant(T, "eval-owner", ["owner"], []);
  const ago = (d: number) => new Date(Date.now() - d * 864e5 - 1000).toISOString(); const fut = (d: number) => new Date(Date.now() + d * 864e5).toISOString(); const A = "evalshopa01"; const B = "evalshopb01"; const mk = (table: string, id: string, data: Record<string, unknown>, shop = A) => st.create(table, id, T, { tenantId: T, shopId: shop, ...data });
  await st.create("shops", A, T, { tenantId: T, name: "Boutique de référence", varianceTolerance: 100 }); await st.create("shops", B, T, { tenantId: T, name: "Seconde boutique" }); await st.create("subscriptions", T, T, { tenantId: T, plan: "business", period: "month", status: "paid", startedAt: ago(10), renewsAt: fut(20) });
  await mk("products", "p1", { name: "Eau", price: 500, cost: 300 }); await mk("products", "p2", { name: "Riz", price: 500, cost: 300 });
  const pay = (m: string, a: number) => JSON.stringify([{ method: m, amount: a }]); const sale = (id: string, total: number, ago_: number, m: string, lines: object[]) => mk("sales", id, { number: id, total, status: "paid", cashierId: "x", payments: pay(m, total), lines: JSON.stringify(lines), soldAt: ago(ago_) });
  await sale("s1", 4500, 1, "cash", [{ productId: "p1", qty: 9, amount: 4500, unitCost: 300 }]); await sale("s2", 1500, 2, "mobile", [{ productId: "p2", qty: 3, amount: 1500, unitCost: 300 }]); await sale("s4", 3000, 3, "cash", [{ productId: "p1", qty: 6, amount: 3000, unitCost: 300 }]); await sale("s3", 3000, 10, "cash", []);
  await mk("sale_returns", "r1", { status: "done", amount: 500, at: ago(1) });
  for (const [i, v] of [0, 50, -500].entries()) await mk("cash_sessions", `cs${i}`, { userId: "x", status: "closed", openedAt: ago(1), closedAt: ago(1), variance: v });
  await mk("customers", "c1", { name: "Client A", creditLimit: 1000, creditBalance: 1000 }); await mk("customers", "c2", { name: "Client B", creditLimit: 5000, creditBalance: 200 });
  const ex = (id: string, amount: number, ago_: number, status: string, o: Record<string, unknown> = {}) => mk("expenses", id, { number: id, label: id, category: "Divers", amount, spentOn: ago(ago_), status, payMode: "immediate", ...o });
  await ex("e1", 2000, 1, "approved", { category: "Transport" }); await ex("e2", 3000, 2, "approved", { category: "Loyer" }); await ex("e3", 4000, 3, "approved", { category: "Achats", payMode: "deferred", paidAmount: 1000 }); await ex("e4", 500, 1, "pending"); await ex("e5", 5000, 10, "approved", { category: "Loyer" });
  await mk("purchase_orders", "po1", { number: "CF-1", supplierId: "s", status: "ordered", total: 1000, deliveryOn: ago(5) }); await mk("purchase_orders", "po2", { number: "CF-2", supplierId: "s", status: "partial", total: 2000, deliveryOn: fut(5) }); await mk("purchase_orders", "po3", { number: "CF-3", supplierId: "s", status: "received", total: 9999 }); await mk("purchase_orders", "po4", { number: "CF-4", supplierId: "s", status: "cancelled", total: 1 });
  await mk("invoices", "i1", { number: "F1", kind: "supplier", partyId: "s", total: 5000, paid: 0, status: "unpaid", dueAt: ago(3), disputed: true }); await mk("invoices", "i2", { number: "F2", kind: "supplier", partyId: "s", total: 3000, paid: 1000, status: "partial", dueAt: fut(9) }); await mk("invoices", "i3", { number: "F3", kind: "supplier", partyId: "s", total: 800, paid: 800, status: "paid" });
  await mk("fin_accounts", "fa1", { name: "Caisse principale", kind: "cash", methods: JSON.stringify(["cash"]), openingBalance: 10_000, openingDate: ago(40).slice(0, 10), active: true });
  await mk("crm_leads", "l1", { name: "P1", stage: "new" }); await mk("crm_leads", "l2", { name: "P2", stage: "won" }); await mk("crm_opps", "o1", { title: "A", stage: "qualified", value: 1000 }); await mk("crm_opps", "o2", { title: "B", stage: "proposal", value: 2000 }); await mk("crm_opps", "o3", { title: "C", stage: "won", value: 9999 });
  await mk("crm_tasks", "t1", { title: "x", status: "open", dueAt: ago(2) }); await mk("crm_tasks", "t2", { title: "y", status: "open", dueAt: fut(1) }); await mk("crm_tasks", "t3", { title: "z", status: "done", dueAt: ago(5) });
  await mk("promotions", "pr1", { name: "Active", kind: "pct", scope: "all", status: "active", startAt: ago(2), endAt: fut(5) }); await mk("promotions", "pr2", { name: "Future", kind: "pct", scope: "all", status: "active", startAt: fut(3), endAt: fut(9) }); await mk("promotions", "pr3", { name: "Brouillon", kind: "pct", scope: "all", status: "draft", startAt: ago(2), endAt: fut(5) });
  await mk("promotion_usage", "u1", { promotionId: "pr1", saleId: "s1", discount: 100, usedAt: ago(1) }); await mk("promotion_usage", "u2", { promotionId: "pr1", saleId: "s2", discount: 200, usedAt: ago(2) }); await mk("promotion_usage", "u3", { promotionId: "pr1", saleId: "s3", discount: 999, usedAt: ago(20) });
  for (const [i, s] of ["draft", "in_progress", "counted", "review", "validated", "closed"].entries()) await mk("inventories", `v${i}`, { number: `I${i}`, status: s, validatedAt: s === "validated" ? ago(4) : null });
  await mk("transfers", "x1", { toShopId: B, number: "T1", status: "shipped", dueAt: ago(2) }); await mk("transfers", "x2", { toShopId: B, number: "T2", status: "partial", dueAt: fut(1) }); await mk("transfers", "x3", { toShopId: B, number: "T3", status: "received" }); await mk("transfers", "x4", { toShopId: B, number: "T4", status: "draft" }); await mk("transfers", "x5", { toShopId: A, number: "T5", status: "shipped", dueAt: ago(1) }, B);
  await mk("inv_items", "n1", { kind: "project", name: "Magasin", status: "in_progress", budget: 5_000_000 }); await mk("inv_items", "n2", { kind: "project", name: "Camion", status: "study", budget: 1_000_000 }); await mk("inv_items", "n3", { kind: "project", name: "Annulé", status: "abandoned", budget: 777 }); await mk("inv_items", "n4", { kind: "placement", name: "Fonds", status: "active", budget: 0 });
  const month = dayStr(new Date()).slice(0, 7); for (const [i, s] of ["pending", "pending", "draft", "rejected", "validated", "validated"].entries()) await mk("acct_entries", `a${i}`, { journal: "OD", date: `${month}-01`, period: i === 5 ? "2020-01" : month, status: s, total: 1 });
  for (const [i, r] of ["manager", "cashier", "cashier"].entries()) await st.create("staff", `eu${i}`, T, { tenantId: T, userId: `eu${i}`, name: `S${i}`, role: r, active: true });
  const ctx: Ctx = { userId: "eval-owner", tenantId: T, shopId: "", roles: ["owner"], shopIds: "all", modules: [...MODULES] }; return { store: st, ctx, shop: (await st.get("shops", A))! };
}

// ------------------------------------------------------------------ jeu de référence (≥ 25 questions, chiffres attendus sur les données ci-dessus)
type Expect = Record<string, number | string>;
export type RefQ = { id: string; text: string; qid: string; days: number; expect: Expect; free: boolean };
const E: Record<string, Expect> = {
  sales: { "Nombre de ventes": 3, "Total des ventes (FCFA)": 9000, "Remboursements (FCFA)": 500, "Espèces (FCFA)": 7500, "Mobile money (FCFA)": 1500, "Période précédente (FCFA)": 3000, "Marge brute (FCFA)": 3600, "Taux de marge (%)": 40 },
  top: { "Eau (FCFA)": 7500, "Riz (FCFA)": 1500 }, cash: { "Sessions clôturées": 3, "Sessions avec écart": 2, "Hors tolérance": 1, "Cumul des écarts (FCFA)": -450 },
  credit: { "Clients avec encours": 2, "Encours total (FCFA)": 1200, "Au plafond de crédit": 1 }, customers: { "Clients actifs": 2, "Nouveaux clients (période)": 2, "Clients avec un crédit en cours": 2 },
  expenses: { "Dépenses approuvées (nombre)": 3, "Dépenses approuvées (FCFA)": 9000, "En attente d'approbation (nombre)": 1, "En attente d'approbation (FCFA)": 500, "Reste à payer sur dépenses différées (FCFA)": 3000, "Période précédente (FCFA)": 5000 },
  purchases: { "Commandes ouvertes (passées ou partielles)": 2, "Montant des commandes ouvertes (FCFA)": 3000, "En retard de livraison": 1, "Reçues": 1 }, payables: { "Factures non soldées": 2, "Reste à payer (FCFA)": 7000, "Dont échues (nombre)": 1, "Dont échues (FCFA)": 5000, "Factures en litige": 1 },
  treasury: { "Solde des comptes configurés (FCFA)": 10_000 }, pipeline: { "Prospects actifs": 1, "Opportunités ouvertes": 2, "Valeur des opportunités ouvertes (FCFA)": 3000, "Tâches ouvertes": 2, "Tâches en retard": 1 },
  promos: { "Promotions actives": 1, "Promotions programmées": 1, "Utilisations (période)": 2, "Remises accordées (FCFA)": 300 }, inventories: { "Brouillons": 1, "En comptage": 1, "À vérifier (comptés ou en revue)": 2, "Validés ou clôturés": 2 },
  transfers: { "En transit (expédiés ou partiels)": 3, "En retard": 2, "Reçus ou clôturés": 1, "En préparation": 1 }, invest: { "Budget des projets non abandonnés (FCFA)": 6_000_000, "Projets · En cours": 1, "Projets · En étude": 1, "Placements · En cours": 1 },
  accounting: { "Écritures à valider": 2, "Brouillons": 1, "Rejetées": 1, "Validées (total)": 2, "Validées (mois en cours)": 1 }, team: { "Propriétaires": 1, "Gérants": 1, "Caissiers": 2 },
};
const FREE: [string, string][] = [["Quel est le montant total de mes ventes cette semaine ?", "sales"], ["Qu'est-ce qui part le mieux dans ma boutique ?", "top"], ["Qui me doit encore de l'argent ?", "credit"], ["Ai-je des commandes qui tardent à arriver ?", "purchases"], ["Quelles factures n'ai-je pas encore réglées ?", "payables"], ["Combien de monde travaille avec moi ?", "team"], ["Mes rentrées et sorties d'argent sont-elles équilibrées ?", "treasury"], ["Combien de personnes m'ont rejoint comme clients récemment ?", "customers"], ["Où en est le suivi de mes contacts commerciaux ?", "pipeline"]];
export const REFERENCE: RefQ[] = [...Object.keys(E).map((qid) => ({ id: `b-${qid}`, text: GUIDED.find((g) => g.id === qid)!.label, qid, days: 7, expect: E[qid]!, free: false })), ...FREE.map(([text, qid], i) => ({ id: `f-${i + 1}`, text, qid, days: 7, expect: E[qid]!, free: true }))];

export type RefResult = { id: string; text: string; expected: string; matcher: string | null; ai: string | null; routed: string | null; classOk: boolean; factsOk: boolean; mismatches: string[]; written: "retenue" | "écartée" | "non tentée" | "erreur"; reason: string; invented: boolean; tokens: number; ms: number };
const budgetMs = 20_000;
/** Évalue un lot de questions (la fonction dispose de 30 s : le client rappelle avec `next` jusqu'à la fin). Exige l'IA active ; coûte de vrais jetons, comptés dans le plafond global. */
export async function evalRun(store: Store, ctx: Ctx, b: { from?: unknown; count?: unknown } = {}) {
  adminOnly(ctx); const cfg = aiConfig(); if (!cfg) throw new HttpError(409, "IA non active (variables MASTER_AI_ENABLED, MASTER_AI_BILLING_CONFIRMED, GEMINI_API_KEY, GEMINI_MODEL) : rien à évaluer.");
  if ((await globalTokensToday(store)) >= cfg.globalDailyTokens) throw new HttpError(429, "Plafond global de jetons du jour atteint : évaluation suspendue.");
  const from = Math.max(0, Math.min(REFERENCE.length, Math.trunc(Number(b.from ?? 0)) || 0)); const count = Math.max(1, Math.min(5, Math.trunc(Number(b.count ?? 3)) || 3)); const t0 = Date.now(); let tin = 0; let tout = 0;
  const data = await evalDataset(); const results: RefResult[] = []; let i = from;
  for (; i < Math.min(REFERENCE.length, from + count); i++) {
    const left0 = budgetMs - (Date.now() - t0); if (results.length && left0 < 9000) break; const q = REFERENCE[i]!; const q0 = Date.now(); let tokens = 0;
    const call: Caller = async (system, user) => { const left = budgetMs - (Date.now() - t0); if (left < 3000) throw new Error("budget de temps épuisé"); const r = await geminiJson({ ...cfg, timeoutMs: Math.min(cfg.timeoutMs, left - 500) }, system, user); tin += r.tokensIn; tout += r.tokensOut; tokens += r.tokensIn + r.tokensOut; return r.text; };
    const m = matchQuestion(q.text); const matcher = m.kind === "match" ? m.id : null; let ai: string | null = null; let aiFailed = false;
    if (q.free) { try { const c = await aiClassifyVia(call, q.text); ai = c ? c.qid : "illisible"; aiFailed = !c; } catch (e) { ai = `erreur : ${(e as Error).message}`.slice(0, 60); aiFailed = true; } }
    // même routage qu'en production : bouton = sujet explicite ; question saisie = choix de l'IA, mots-clés en repli seulement si l'IA échoue
    const routed = !q.free ? q.qid : aiFailed ? matcher : ai && ai !== "none" ? ai : null; const classOk = routed === q.qid;
    const res: RefResult = { id: q.id, text: q.text, expected: q.qid, matcher, ai, routed, classOk, factsOk: false, mismatches: [], written: "non tentée", reason: "", invented: false, tokens: 0, ms: 0 };
    if (!routed || !TOOLS[routed]) res.mismatches.push("sujet non reconnu"); else {
      const env: Env = { store: data.store, ctx: data.ctx, shop: data.shop, days: q.days };
      try { let a = await TOOLS[routed]!(env); const got = Object.fromEntries(a.facts.map((f) => [f.label, f.value])); if (routed !== q.qid) res.mismatches.push(`sujet ${routed} au lieu de ${q.qid}`); else for (const [k, v] of Object.entries(q.expect)) if (got[k] !== v) res.mismatches.push(`${k} : attendu ${v}, obtenu ${got[k] ?? "absent"}`); res.factsOk = routed === q.qid && res.mismatches.length === 0;
        if (a.facts.length && routed !== "profile") { try { const w = await aiWriteVia(call, a, q.text); if (w.answer) res.written = "retenue"; else { res.written = "écartée"; res.reason = w.reason; res.invented = w.reason.startsWith("nombre non vérifié"); } } catch (e) { res.written = "erreur"; res.reason = (e as Error).message.slice(0, 80); } }
      } catch (e) { res.mismatches.push(`outil en erreur : ${(e as Error).message}`.slice(0, 80)); }
    }
    res.tokens = tokens; res.ms = Date.now() - q0; results.push(res);
  }
  if (tin || tout) await addGlobalTokens(store, tin, tout).catch(() => undefined);
  return { total: REFERENCE.length, from, results, next: i < REFERENCE.length ? i : null, tokens: { in: tin, out: tout }, model: cfg.model, style: cfg.style };
}

// ------------------------------------------------------------------ coûts de l'IA (administrateur)
export async function aiUsage(store: Store, ctx: Ctx, b: { days?: unknown } = {}) {
  adminOnly(ctx); const n = Math.max(1, Math.min(14, Math.trunc(Number(b.days ?? 7)) || 7)); const cfg = aiConfig(); const cap = cfg?.globalDailyTokens ?? Number(process.env.MASTER_AI_GLOBAL_DAILY_TOKENS ?? 1_000_000); const out = [];
  for (let k = 0; k < n; k++) {
    const day = dayStr(new Date(Date.now() - k * 864e5)); const rows = (await store.scan("md_usage", { day }, { maxRows: 20_000 })).rows.filter((r) => r.tenantId !== "platform"); const by = new Map<string, number>(); let tin = 0; let tout = 0;
    for (const r of rows) { const a = Number(r.tokensIn ?? 0); const o = Number(r.tokensOut ?? 0); tin += a; tout += o; by.set(String(r.tenantId), (by.get(String(r.tenantId)) ?? 0) + a + o); }
    const top = await Promise.all([...by].sort((x, y) => y[1] - x[1]).slice(0, 5).map(async ([tenantId, tokens]) => ({ tenantId, name: String((await store.list("shops", { tenantId }, 1))[0]?.name ?? "—"), tokens })));
    const fb = rows.reduce((s, r) => s + Number(r.fallback ?? 0), 0); const ai = rows.reduce((s, r) => s + Number(r.aiUsed ?? 0), 0); const globalTokens = await globalTokensToday(store, day);
    out.push({ day, questions: rows.length, aiAnswers: ai, fallbacks: fb, tokensIn: tin, tokensOut: tout, globalTokens, tenants: by.size, top });
  }
  const today = out[0]!; const alerts: string[] = []; if (today.globalTokens >= cap * 0.8) alerts.push(`Consommation du jour à ${Math.round((today.globalTokens / cap) * 100)} % du plafond global.`); const attempts = today.aiAnswers + today.fallbacks; if (attempts >= 10 && today.fallbacks / attempts > 0.3) alerts.push(`${Math.round((today.fallbacks / attempts) * 100)} % de replis aujourd'hui : vérifier le fournisseur.`);
  return { status: aiStatus(), globalCap: cap, days: out, alerts };
}
