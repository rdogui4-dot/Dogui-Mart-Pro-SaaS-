/** MASTER DOGUI — étape 5A : assistant conversationnel, socle SANS fournisseur d'IA. Outils déterministes en lecture seule, questions guidées,
 *  conversations privées, quota quotidien, journal. Aucune donnée n'est transmise à un service externe dans ce mode. */
import { createHash } from "node:crypto";
import { addDays, boundsOf, todayIn } from "../../../src/domain/overview";
import { DEFAULT_TIMEZONE, isTimezone } from "../../../src/domain/promotions";
import { AI_QIDS, PROMPT_VERSION, CLASSIFY_SYSTEM, GUIDED, LIMITS, WRITE_SYSTEM, checkWrite, classifyInput, cleanQuestion, dayKey, matchQuestion, parseClassify, parseWrite, retentionCutoff, writeInput, type Answer } from "../../../src/domain/master-chat";
import { AiError, aiConfig, aiStatus, geminiJson, type AiConfig } from "./ai-gemini";
import { MIN, iso, parse } from "./crm";
import { roleKind } from "./fin-rules";
import { needMaster } from "./master";
import { profileGet } from "./master-profile";
import { recoList } from "./master-reco";
import { stockAlerts } from "./stock-biz";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";
import { needFeature } from "./articles";
import { finDashboard } from "./fin";
import { shopStock } from "./stock-biz";
import { OPEN_STAGES, STAGE_LABEL } from "../../../src/domain/crm";
import { PLACEMENT_STATUS, PROJECT_STATUS } from "../../../src/domain/invest";
import { promoStatus } from "../../../src/domain/promotions";
import type { FeatureKey } from "../../../src/domain/features";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const nowIso = () => new Date().toISOString();
const reader = (ctx: Ctx) => { if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); };
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", crypto.randomUUID().replace(/-/g, "").slice(0, 30), ctx.tenantId, { tenantId: ctx.tenantId, shopId: "platform", userId: ctx.userId, action, detail: detail.slice(0, 500) });
const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
const tzOf = (shop: Row | null) => (shop?.promoTz && isTimezone(String(shop.promoTz)) ? String(shop.promoTz) : DEFAULT_TIMEZONE);
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

async function myShops(store: Store, ctx: Ctx): Promise<string[] | "all"> {
  if (roleKind(ctx) === "owner") return "all"; const s = await store.get("staff", ctx.userId); if (!s || s.tenantId !== ctx.tenantId || s.active === false) return [];
  try { const v = JSON.parse(String(s.shopIds || "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
const methodsOf = (s: Row): Record<string, number> => { const pays = parse<{ method: string; amount: number }[]>(s.payments, []); if (!pays.length) return { cash: Number(s.total) }; const o: Record<string, number> = {}; for (const p of pays) o[p.method] = (o[p.method] ?? 0) + Number(p.amount); return o; };
const METHOD: Record<string, string> = { cash: "Espèces", mobile: "Mobile money", card: "Carte", credit: "Crédit client", transfer: "Virement" };

type Env = { store: Store; ctx: Ctx; shop: Row; days: number };
const base = (qid: string, title: string): Answer => ({ qid, title, conclusion: "", period: null, scope: "", facts: [], sources: [], method: "", observations: [], limits: [], confidence: "high", recommendations: [] });
const window = (e: Env) => { const tz = tzOf(e.shop); const to = todayIn(new Date(), tz); const from = addDays(to, -(e.days - 1)); const b = boundsOf(from, to, tz); const pf = addDays(from, -e.days); const pb = boundsOf(pf, addDays(from, -1), tz); return { from, to, b, pb, label: e.days === 1 ? "aujourd'hui" : `${e.days} derniers jours` }; };
const salesIn = async (e: Env, b: { gte: string; lt: string }) => (await e.store.scan("sales", { ...MIN({ ...e.ctx, shopId: e.shop.$id }), status: "paid" }, { range: { field: "soldAt", from: b.gte, to: b.lt }, maxRows: 20_000 })).rows.filter((x) => iso(x.soldAt) >= b.gte && iso(x.soldAt) < b.lt);

async function toolSales(e: Env): Promise<Answer> {
  const w = window(e); const a = base("sales", "Ventes"); const cur = await salesIn(e, w.b); const prev = await salesIn(e, w.pb); const total = cur.reduce((t, s) => t + Number(s.total), 0); const ptotal = prev.reduce((t, s) => t + Number(s.total), 0);
  const by: Record<string, number> = {}; for (const s of cur) for (const [m, v] of Object.entries(methodsOf(s))) by[m] = (by[m] ?? 0) + v;
  const rets = (await e.store.scan("sale_returns", MIN({ ...e.ctx, shopId: e.shop.$id }), { range: { field: "at", from: w.b.gte, to: w.b.lt }, maxRows: 5000 })).rows.filter((r) => r.status !== "failed" && iso(r.at) >= w.b.gte && iso(r.at) < w.b.lt).reduce((t, r) => t + Number(r.amount), 0);
  const v = pct(total, ptotal); a.period = { from: w.from, to: w.to, label: w.label }; a.scope = String(e.shop.name); a.sources = [{ module: "Caisse", detail: "ventes encaissées et remboursements de la boutique" }]; a.method = "Somme des ventes encaissées sur la période ; comparaison avec la période précédente de même durée.";
  a.conclusion = cur.length ? `${cur.length} vente(s) pour ${fcfa(total)} (${w.label}).` : `Aucune vente encaissée (${w.label}).`;
  a.facts = [{ label: "Nombre de ventes", value: cur.length }, { label: "Total des ventes (FCFA)", value: total }, { label: "Remboursements (FCFA)", value: rets }, ...Object.entries(by).map(([m, x]) => ({ label: `${METHOD[m] ?? m} (FCFA)`, value: x })), { label: "Période précédente (FCFA)", value: ptotal }];
  a.observations = v === null ? ["Pas de ventes sur la période précédente : aucune variation calculable."] : [`Variation par rapport à la période précédente : ${v > 0 ? "+" : ""}${v} %.`];
  a.limits = ["Les remboursements sont indiqués séparément, non déduits du total.", "La marge n'est pas calculée : le coût au moment de la vente n'est pas enregistré."]; a.confidence = "high"; return a;
}
async function toolTop(e: Env): Promise<Answer> {
  const w = window(e); const a = base("top", "Produits les plus vendus"); const cur = await salesIn(e, w.b); const agg = new Map<string, { qty: number; amount: number }>();
  for (const s of cur) for (const l of parse<{ productId: string; qty: number; amount: number }[]>(s.lines, [])) { const x = agg.get(l.productId) ?? { qty: 0, amount: 0 }; x.qty += Number(l.qty); x.amount += Number(l.amount); agg.set(l.productId, x); }
  const names = new Map((await e.store.scan("products", MIN({ ...e.ctx, shopId: e.shop.$id }), { maxRows: 20_000 })).rows.map((p) => [p.$id, String(p.name)] as [string, string])); const top = [...agg].sort((x, y) => y[1].amount - x[1].amount).slice(0, 5);
  a.period = { from: w.from, to: w.to, label: w.label }; a.scope = String(e.shop.name); a.sources = [{ module: "Caisse / Articles", detail: "lignes des ventes encaissées" }]; a.method = "Cumul par article des montants vendus sur la période, classement décroissant (5 premiers).";
  a.conclusion = top.length ? `Article le plus vendu : ${names.get(top[0]![0]) ?? "article supprimé"} (${fcfa(top[0]![1].amount)}).` : `Aucune vente sur la période (${w.label}).`;
  a.facts = top.map(([id, x]) => ({ label: `${names.get(id) ?? "Article supprimé"} (FCFA)`, value: x.amount })); a.observations = top.map(([id, x]) => `${names.get(id) ?? "Article supprimé"} : quantité vendue ${x.qty}.`);
  a.limits = ["Classement par chiffre d'affaires, pas par marge (coût à la vente non enregistré)."]; return a;
}
async function toolStock(e: Env): Promise<Answer> {
  const a = base("stock", "Stock à surveiller"); const r = await stockAlerts(e.store, { ...e.ctx, shopId: e.shop.$id }); const al = r.alerts as { kind: string; title: string }[]; const bad = al.filter((x) => x.kind === "out" || x.kind === "negative"); const low = al.filter((x) => x.kind === "low");
  a.scope = String(e.shop.name); a.sources = [{ module: "Stock", detail: "alertes de stock (rupture, négatif, minimum atteint)" }]; a.method = "Lecture des alertes de stock de la boutique à l'instant de la question (seuils définis dans la fiche de stock).";
  a.conclusion = bad.length || low.length ? `${bad.length} article(s) en rupture ou négatif, ${low.length} au stock minimum.` : "Aucun article en rupture ni au stock minimum.";
  a.facts = [{ label: "Ruptures ou stock négatif", value: bad.length }, { label: "Stock minimum atteint", value: low.length }]; a.observations = [...bad, ...low].slice(0, 8).map((x) => x.title.replace(/^.* · /, "")); a.limits = ["État à l'instant de la question ; les seuils non définis ne déclenchent pas d'alerte."];
  a.recommendations = bad.length ? ["Vérifier les réceptions non saisies et réapprovisionner les articles en rupture."] : []; a.confidence = "high"; return a;
}
async function toolCash(e: Env): Promise<Answer> {
  const w = window(e); const a = base("cash", "Écarts de caisse"); const rows = (await e.store.scan("cash_sessions", MIN({ ...e.ctx, shopId: e.shop.$id }), { range: { field: "closedAt", from: w.b.gte, to: w.b.lt }, maxRows: 2000 })).rows.filter((s) => s.status === "closed"); const tol = Math.max(0, Number(e.shop.varianceTolerance ?? 0));
  const off = rows.filter((s) => Number(s.variance) !== 0); const out = rows.filter((s) => Math.abs(Number(s.variance)) > tol); const sum = off.reduce((t, s) => t + Number(s.variance), 0);
  a.period = { from: w.from, to: w.to, label: w.label }; a.scope = String(e.shop.name); a.sources = [{ module: "Caisse", detail: "sessions clôturées (compté moins théorique)" }]; a.method = "Pour chaque session clôturée : montant compté moins montant théorique ; comparaison à la tolérance de la boutique.";
  a.conclusion = rows.length ? `${rows.length} session(s) clôturée(s), ${off.length} avec écart, ${out.length} hors tolérance (${tol} FCFA).` : `Aucune session clôturée (${w.label}).`; a.facts = [{ label: "Sessions clôturées", value: rows.length }, { label: "Sessions avec écart", value: off.length }, { label: "Hors tolérance", value: out.length }, { label: "Cumul des écarts (FCFA)", value: sum }];
  a.limits = ["Un écart nul n'exclut pas une erreur compensée."]; a.confidence = rows.length >= 5 ? "high" : rows.length ? "medium" : "low"; if (rows.length && rows.length < 5) a.observations.push("Moins de 5 sessions : lecture à confirmer sur une période plus longue."); return a;
}
async function toolCredit(e: Env): Promise<Answer> {
  const a = base("credit", "Encours de crédit clients"); const rows = (await e.store.scan("customers", MIN({ ...e.ctx, shopId: e.shop.$id }), { maxRows: 20_000 })).rows.filter((c) => !c.archived && Number(c.creditBalance) > 0); const total = rows.reduce((t, c) => t + Number(c.creditBalance), 0); const atLimit = rows.filter((c) => Number(c.creditLimit) > 0 && Number(c.creditBalance) >= Number(c.creditLimit)).length;
  a.scope = String(e.shop.name); a.sources = [{ module: "Clients", detail: "solde de crédit des fiches clients" }]; a.method = "Somme des soldes de crédit positifs ; aucune donnée nominative n'est présentée.";
  a.conclusion = rows.length ? `${rows.length} client(s) avec un encours, pour ${fcfa(total)}.` : "Aucun encours de crédit client."; a.facts = [{ label: "Clients avec encours", value: rows.length }, { label: "Encours total (FCFA)", value: total }, { label: "Au plafond de crédit", value: atLimit }]; a.limits = ["Aucune date d'échéance n'est enregistrée : impossible de distinguer encours courant et impayé échu."]; return a;
}
async function toolRecos(e: Env): Promise<Answer> {
  const a = base("recos", "Recommandations ouvertes"); const l = await recoList(e.store, e.ctx, { limit: 200 }); const open = l.recos.filter((r) => r.status === "new" || r.status === "accepted" || r.status === "doing");
  a.sources = [{ module: "MASTER DOGUI", detail: "centre de recommandations" }]; a.method = "Lecture des recommandations enregistrées dans votre périmètre ; aucune n'est créée ici (utilisez « Actualiser » dans l'onglet Recommandations)."; a.conclusion = open.length ? `${open.length} recommandation(s) ouverte(s).` : "Aucune recommandation ouverte.";
  a.facts = [{ label: "Nouvelles", value: l.counts.new ?? 0 }, { label: "Acceptées ou en cours", value: (l.counts.accepted ?? 0) + (l.counts.doing ?? 0) }, { label: "Reportées", value: l.counts.snoozed ?? 0 }]; a.observations = open.slice(0, 5).map((r) => `${r.title} (${r.statusLabel})`); a.limits = ["Reflète la dernière actualisation."]; return a;
}
async function toolProfile(e: Env): Promise<Answer> {
  const a = base("profile", "Profil de l'entreprise"); const p = await profileGet(e.store, e.ctx); a.sources = [{ module: "MASTER DOGUI", detail: "profil d'entreprise (faits déclarés et lus dans les modules)" }]; a.method = "Lecture du profil ; les faits déclarés sont cités comme tels, les faits vérifiés viennent des modules.";
  a.conclusion = p.facts.length ? `${p.facts.length} information(s) mémorisée(s).` : "Aucune information mémorisée pour l'instant."; a.facts = p.verified.map((v) => ({ label: v.label, value: v.value })); a.observations = p.facts.map((f) => `${f.label}${f.shopName ? ` · ${f.shopName}` : ""} : ${f.text} (${f.kind === "declared" ? "déclaré" : f.kind === "hypothesis" ? "hypothèse" : "estimation"})`); a.limits = ["Les informations déclarées sont celles saisies par le propriétaire."]; return a;
}

// ------------------------------------------------------------------ sujets supplémentaires (lecture seule des tables des modules ; droits et formule contrôlés comme dans les modules)
const guard = async (e: Env, module: Parameters<typeof needModule>[1], feature?: FeatureKey) => { needModule(e.ctx, module); if (feature) await needFeature(e.store, e.ctx, feature); };
const cxOf = (e: Env): Ctx => ({ ...e.ctx, shopId: e.shop.$id });
const nowMs = () => Date.now();
const topN = (m: Map<string, number>, n = 5) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);

async function toolExpenses(e: Env): Promise<Answer> {
  await guard(e, "pos", "expenses"); const w = window(e); const a = base("expenses", "Dépenses"); const where = MIN(cxOf(e));
  const rows = async (b: { gte: string; lt: string }) => (await e.store.scan("expenses", where, { range: { field: "spentOn", from: b.gte, to: b.lt }, maxRows: 20_000 })).rows.filter((r) => iso(r.spentOn) >= b.gte && iso(r.spentOn) < b.lt);
  const cur = await rows(w.b); const prev = await rows(w.pb); const ok = cur.filter((r) => r.status === "approved"); const total = ok.reduce((t, r) => t + Number(r.amount), 0); const ptotal = prev.filter((r) => r.status === "approved").reduce((t, r) => t + Number(r.amount), 0);
  const pend = cur.filter((r) => r.status === "pending"); const by = new Map<string, number>(); for (const r of ok) by.set(String(r.category), (by.get(String(r.category)) ?? 0) + Number(r.amount));
  const owed = ok.filter((r) => String(r.payMode ?? "immediate") === "deferred").reduce((t, r) => t + Math.max(0, Number(r.amount) - Number(r.paidAmount ?? 0)), 0); const v = pct(total, ptotal);
  a.period = { from: w.from, to: w.to, label: w.label }; a.scope = String(e.shop.name); a.sources = [{ module: "Dépenses", detail: "dépenses approuvées, en attente et à payer" }]; a.method = "Somme des dépenses approuvées de la période, par catégorie ; comparaison avec la période précédente de même durée.";
  a.conclusion = ok.length ? `${ok.length} dépense(s) approuvée(s) pour ${fcfa(total)} (${w.label}).` : `Aucune dépense approuvée (${w.label}).`;
  a.facts = [{ label: "Dépenses approuvées (nombre)", value: ok.length }, { label: "Dépenses approuvées (FCFA)", value: total }, { label: "En attente d'approbation (nombre)", value: pend.length }, { label: "En attente d'approbation (FCFA)", value: pend.reduce((t, r) => t + Number(r.amount), 0) }, { label: "Reste à payer sur dépenses différées (FCFA)", value: owed }, { label: "Période précédente (FCFA)", value: ptotal }];
  a.observations = [...topN(by).map(([c, x]) => `Catégorie « ${c} » : ${fcfa(x)}.`), v === null ? "Pas de dépenses sur la période précédente : aucune variation calculable." : `Variation par rapport à la période précédente : ${v > 0 ? "+" : ""}${v} %.`]; a.limits = ["Seules les dépenses approuvées sont comptées dans le total ; celles en attente sont indiquées à part."]; a.recommendations = pend.length ? ["Traiter les dépenses en attente d'approbation."] : []; return a;
}
async function toolPurchases(e: Env): Promise<Answer> {
  await guard(e, "purchases", "purchasing"); const a = base("purchases", "Commandes fournisseurs"); const rows = (await e.store.scan("purchase_orders", MIN(cxOf(e)), { maxRows: 5000 })).rows; const day = todayIn(new Date(), tzOf(e.shop));
  const open = rows.filter((r) => r.status === "ordered" || r.status === "partial"); const late = open.filter((r) => r.deliveryOn && iso(r.deliveryOn).slice(0, 10) < day); const count = (s: string) => rows.filter((r) => r.status === s).length;
  a.scope = String(e.shop.name); a.sources = [{ module: "Achats", detail: "commandes fournisseurs de la boutique" }]; a.method = "Décompte des commandes par statut ; une commande ouverte est en retard si sa date de livraison prévue est dépassée.";
  a.conclusion = rows.length ? `${open.length} commande(s) ouverte(s), dont ${late.length} en retard de livraison.` : "Aucune commande fournisseur enregistrée."; a.facts = [{ label: "Commandes ouvertes (passées ou partielles)", value: open.length }, { label: "Montant des commandes ouvertes (FCFA)", value: open.reduce((t, r) => t + Number(r.total), 0) }, { label: "En retard de livraison", value: late.length }, { label: "Reçues", value: count("received") }, { label: "Annulées", value: count("cancelled") }];
  a.observations = late.slice(0, 5).map((r) => `Commande ${r.number} : livraison prévue le ${iso(r.deliveryOn).slice(0, 10)}.`); a.limits = ["Une commande sans date de livraison prévue n'est jamais comptée en retard."]; a.recommendations = late.length ? ["Relancer les fournisseurs des commandes en retard."] : []; return a;
}
async function toolPayables(e: Env): Promise<Answer> {
  await guard(e, "purchases", "purchasing"); const a = base("payables", "Dettes fournisseurs"); const rows = (await e.store.scan("invoices", { ...MIN(cxOf(e)), kind: "supplier" }, { maxRows: 10_000 })).rows.filter((r) => r.status !== "paid"); const left = (r: Row) => Math.max(0, Number(r.total) - Number(r.paid ?? 0));
  const due = rows.filter((r) => r.dueAt && nowMs() > Date.parse(iso(r.dueAt))); a.scope = String(e.shop.name); a.sources = [{ module: "Achats", detail: "factures fournisseurs non soldées" }]; a.method = "Somme des restes à payer des factures fournisseurs non soldées ; une facture est échue si sa date d'échéance est passée.";
  a.conclusion = rows.length ? `${rows.length} facture(s) fournisseur non soldée(s) : reste à payer ${fcfa(rows.reduce((t, r) => t + left(r), 0))}.` : "Aucune facture fournisseur à payer."; a.facts = [{ label: "Factures non soldées", value: rows.length }, { label: "Reste à payer (FCFA)", value: rows.reduce((t, r) => t + left(r), 0) }, { label: "Dont échues (nombre)", value: due.length }, { label: "Dont échues (FCFA)", value: due.reduce((t, r) => t + left(r), 0) }, { label: "Factures en litige", value: rows.filter((r) => r.disputed === true).length }];
  a.limits = ["Une facture sans date d'échéance n'est jamais comptée comme échue."]; a.recommendations = due.length ? ["Régler ou renégocier les factures fournisseurs échues."] : []; return a;
}
async function toolTreasury(e: Env): Promise<Answer> {
  const a = base("treasury", "Trésorerie"); const d: any = await finDashboard(e.store, cxOf(e)); a.period = { from: "", to: String(d.asOf), label: "30 derniers jours (flux)" }; a.scope = String(e.shop.name); a.sources = [{ module: "Finance", detail: "comptes, flux, créances et dettes" }]; a.method = "Soldes des comptes configurés (solde d'ouverture + flux), flux des 30 derniers jours, créances et dettes ; perspective indicative sans deviner les ventes futures.";
  a.conclusion = d.unconfigured && !d.accounts.length ? "Aucun compte de trésorerie n'est configuré." : `Solde des comptes configurés : ${fcfa(d.totalConfigured)} ; flux net sur 30 jours : ${fcfa(d.last30.net)}.`;
  a.facts = [{ label: "Solde des comptes configurés (FCFA)", value: d.totalConfigured }, { label: "Entrées sur 30 jours (FCFA)", value: d.last30.inflow }, { label: "Sorties sur 30 jours (FCFA)", value: d.last30.outflow }, { label: "Flux net sur 30 jours (FCFA)", value: d.last30.net }, { label: "Créances (FCFA)", value: d.receivables.total }, { label: "Créances échues (FCFA)", value: d.receivables.overdue }, { label: "Dettes (FCFA)", value: d.payables.total }, { label: "Dettes échues (FCFA)", value: d.payables.overdue }, { label: "Comptes sans solde d'ouverture", value: d.unconfigured }];
  a.observations = (d.alerts as { text: string }[]).slice(0, 5).map((x) => x.text); a.limits = [String(d.outlook30?.basis ?? "Indicatif."), "Un compte sans solde d'ouverture est exclu du solde total."]; a.confidence = d.unconfigured ? "medium" : "high"; return a;
}
async function toolCustomers(e: Env): Promise<Answer> {
  await guard(e, "customers"); const w = window(e); const a = base("customers", "Clients"); const rows = (await e.store.scan("customers", MIN(cxOf(e)), { maxRows: 50_000 })).rows.filter((c) => !c.archived); const fresh = rows.filter((c) => String(c.$createdAt ?? "") >= w.b.gte && String(c.$createdAt ?? "") < w.b.lt);
  a.period = { from: w.from, to: w.to, label: w.label }; a.scope = String(e.shop.name); a.sources = [{ module: "Clients", detail: "fiches clients de la boutique" }]; a.method = "Décompte des fiches clients non archivées ; nouveaux clients = fiches créées pendant la période."; a.conclusion = `${rows.length} client(s) actif(s), dont ${fresh.length} nouveau(x) (${w.label}).`;
  a.facts = [{ label: "Clients actifs", value: rows.length }, { label: "Nouveaux clients (période)", value: fresh.length }, { label: "Clients avec un crédit en cours", value: rows.filter((c) => Number(c.creditBalance) > 0).length }]; a.limits = ["Aucun nom ni coordonnée n'est présenté : seulement des totaux."]; return a;
}
async function toolPipeline(e: Env): Promise<Answer> {
  await guard(e, "customers", "crm"); const a = base("pipeline", "Pipeline commercial"); const where = MIN(cxOf(e)); const [leads, opps, tasks] = await Promise.all([e.store.scan("crm_leads", where, { maxRows: 20_000 }), e.store.scan("crm_opps", where, { maxRows: 20_000 }), e.store.scan("crm_tasks", where, { maxRows: 20_000 })]);
  const lc = leads.rows.filter((l) => !l.archived && !["won", "lost"].includes(String(l.stage))); const open = opps.rows.filter((o) => (OPEN_STAGES as string[]).includes(String(o.stage))); const tk = tasks.rows.filter((x) => x.status === "open"); const late = tk.filter((x) => x.dueAt && nowMs() > Date.parse(iso(x.dueAt))); const st = new Map<string, number>(); for (const o of open) st.set(String(o.stage), (st.get(String(o.stage)) ?? 0) + 1);
  a.scope = String(e.shop.name); a.sources = [{ module: "CRM", detail: "prospects, opportunités et tâches" }]; a.method = "Décompte des prospects actifs, des opportunités ouvertes par étape, et des tâches ouvertes ; une tâche est en retard si son échéance est passée."; a.conclusion = `${lc.length} prospect(s) actif(s), ${open.length} opportunité(s) ouverte(s) pour ${fcfa(open.reduce((t, o) => t + Number(o.value ?? 0), 0))}, ${late.length} tâche(s) en retard.`;
  a.facts = [{ label: "Prospects actifs", value: lc.length }, { label: "Opportunités ouvertes", value: open.length }, { label: "Valeur des opportunités ouvertes (FCFA)", value: open.reduce((t, o) => t + Number(o.value ?? 0), 0) }, { label: "Tâches ouvertes", value: tk.length }, { label: "Tâches en retard", value: late.length }]; a.observations = [...st].map(([s, n]) => `${STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s} : ${n} opportunité(s).`);
  a.limits = ["La valeur des opportunités est celle saisie ; la probabilité de gain n'est pas appliquée ici."]; a.recommendations = late.length ? ["Traiter les tâches de relance en retard."] : []; return a;
}
async function toolPromos(e: Env): Promise<Answer> {
  await guard(e, "stock", "promotions"); const w = window(e); const a = base("promos", "Promotions"); const where = MIN(cxOf(e)); const promos = (await e.store.scan("promotions", where, { maxRows: 5000 })).rows; const now = new Date();
  const eff = promos.map((p) => promoStatus({ status: p.status as never, startAt: String(p.startAt), endAt: String(p.endAt) }, now)); const active = eff.filter((s) => s === "active").length; const sched = eff.filter((s) => s === "scheduled").length;
  const use = (await e.store.scan("promotion_usage", where, { range: { field: "usedAt", from: w.b.gte, to: w.b.lt }, maxRows: 100_000 })).rows.filter((u) => iso(u.usedAt) >= w.b.gte && iso(u.usedAt) < w.b.lt);
  a.period = { from: w.from, to: w.to, label: w.label }; a.scope = String(e.shop.name); a.sources = [{ module: "Promotions", detail: "campagnes et utilisations" }]; a.method = "Statut effectif de chaque promotion à l'instant de la question ; utilisations et remises de la période."; a.conclusion = `${active} promotion(s) active(s), ${use.length} utilisation(s) (${w.label}) pour ${fcfa(use.reduce((t, u) => t + Number(u.discount), 0))} de remises.`;
  a.facts = [{ label: "Promotions actives", value: active }, { label: "Promotions programmées", value: sched }, { label: "Utilisations (période)", value: use.length }, { label: "Remises accordées (FCFA)", value: use.reduce((t, u) => t + Number(u.discount), 0) }]; a.limits = ["L'effet des promotions sur les ventes n'est pas attribué ici : seules les utilisations sont comptées."]; return a;
}
async function toolInventories(e: Env): Promise<Answer> {
  await guard(e, "stock", "silentCount"); const a = base("inventories", "Inventaires"); const rows = (await e.store.scan("inventories", MIN(cxOf(e)), { maxRows: 2000 })).rows; const n = (...s: string[]) => rows.filter((r) => s.includes(String(r.status))).length; const last = rows.filter((r) => r.validatedAt).map((r) => iso(r.validatedAt).slice(0, 10)).sort().at(-1);
  a.scope = String(e.shop.name); a.sources = [{ module: "Silent Count", detail: "inventaires de la boutique" }]; a.method = "Décompte des inventaires par statut ; date du dernier inventaire validé."; a.conclusion = rows.length ? `${n("in_progress", "counted", "review")} inventaire(s) en cours, ${n("validated", "closed")} validé(s) ou clôturé(s).` : "Aucun inventaire enregistré.";
  a.facts = [{ label: "Brouillons", value: n("draft") }, { label: "En comptage", value: n("in_progress") }, { label: "À vérifier (comptés ou en revue)", value: n("counted", "review") }, { label: "Validés ou clôturés", value: n("validated", "closed") }, { label: "Dernier inventaire validé", value: last ?? "aucun" }]; a.limits = ["Les écarts de chaque inventaire sont consultables dans le module Inventaire."]; a.recommendations = n("counted", "review") ? ["Vérifier et trancher les écarts des inventaires comptés."] : []; return a;
}
async function toolTransfers(e: Env): Promise<Answer> {
  await guard(e, "stock", "stockIntel"); const a = base("transfers", "Transferts de stock"); const sid = e.shop.$id; const rows = (await e.store.scan("transfers", { tenantId: e.ctx.tenantId }, { maxRows: 5000 })).rows.filter((r) => r.shopId === sid || r.toShopId === sid);
  const transit = rows.filter((r) => r.status === "shipped" || r.status === "partial"); const late = transit.filter((r) => r.dueAt && nowMs() > Date.parse(iso(r.dueAt))); a.scope = String(e.shop.name); a.sources = [{ module: "Stock", detail: "transferts entre boutiques (envoyés et reçus)" }]; a.method = "Décompte des transferts impliquant la boutique ; un transfert en transit est en retard si sa date d'arrivée prévue est passée.";
  a.conclusion = rows.length ? `${transit.length} transfert(s) en transit, dont ${late.length} en retard.` : "Aucun transfert enregistré."; a.facts = [{ label: "En préparation", value: rows.filter((r) => r.status === "draft").length }, { label: "En transit (expédiés ou partiels)", value: transit.length }, { label: "En retard", value: late.length }, { label: "Reçus ou clôturés", value: rows.filter((r) => r.status === "received" || r.status === "closed").length }]; a.limits = ["Un transfert sans date d'arrivée prévue n'est jamais compté en retard."]; return a;
}
async function toolInvest(e: Env): Promise<Answer> {
  await guard(e, "accounting", "investBusiness"); const a = base("invest", "Investissements"); const rows = (await e.store.scan("inv_items", MIN(cxOf(e)), { maxRows: 5000 })).rows; const proj = rows.filter((r) => r.kind === "project"); const plc = rows.filter((r) => r.kind === "placement");
  const live = proj.filter((r) => r.status !== "abandoned"); a.scope = String(e.shop.name); a.sources = [{ module: "IProj-Invest", detail: "projets d'investissement et placements déclarés" }]; a.method = "Décompte des projets par statut et des placements ; budget = somme des budgets des projets non abandonnés. Les rendements et risques sont ceux déclarés, sans promesse."; a.conclusion = rows.length ? `${proj.length} projet(s) et ${plc.length} placement(s) suivis ; budget des projets actifs : ${fcfa(live.reduce((t, r) => t + Number(r.budget ?? 0), 0))}.` : "Aucun projet ni placement enregistré.";
  a.facts = [...Object.entries(PROJECT_STATUS).map(([k, l]) => ({ label: `Projets · ${l}`, value: proj.filter((r) => r.status === k).length })), { label: "Budget des projets non abandonnés (FCFA)", value: live.reduce((t, r) => t + Number(r.budget ?? 0), 0) }, ...Object.entries(PLACEMENT_STATUS).map(([k, l]) => ({ label: `Placements · ${l}`, value: plc.filter((r) => r.status === k).length }))]; a.limits = ["Aucun rendement futur n'est calculé ni garanti ici."]; return a;
}
async function toolAccounting(e: Env): Promise<Answer> {
  await guard(e, "accounting", "icompta"); const a = base("accounting", "Comptabilité"); const rows = (await e.store.scan("acct_entries", MIN(cxOf(e)), { maxRows: 50_000 })).rows; const n = (s: string) => rows.filter((r) => r.status === s).length; const month = new Date().toISOString().slice(0, 7);
  a.scope = String(e.shop.name); a.sources = [{ module: "ICompta", detail: "écritures comptables de la boutique" }]; a.method = "Décompte des écritures par statut ; validées du mois en cours."; a.conclusion = rows.length ? `${n("pending")} écriture(s) à valider, ${n("draft")} brouillon(s), ${n("rejected")} rejetée(s).` : "Aucune écriture comptable enregistrée.";
  a.facts = [{ label: "Écritures à valider", value: n("pending") }, { label: "Brouillons", value: n("draft") }, { label: "Rejetées", value: n("rejected") }, { label: "Validées (total)", value: n("validated") }, { label: "Validées (mois en cours)", value: rows.filter((r) => r.status === "validated" && String(r.period) === month).length }]; a.limits = ["Pas de résultat comptable présenté ici : consultez les états financiers du module ICompta."]; a.recommendations = n("pending") ? ["Valider ou rejeter les écritures en attente."] : []; return a;
}
async function toolTeam(e: Env): Promise<Answer> {
  const a = base("team", "Équipe"); const rows = (await e.store.scan("staff", { tenantId: e.ctx.tenantId }, { maxRows: 5000 })).rows.filter((s) => s.active !== false); const owners = (await e.store.listOwners(e.ctx.tenantId)).length; const n = (r: string) => rows.filter((s) => s.role === r).length;
  a.sources = [{ module: "Équipe", detail: "fiches du personnel actives" }]; a.method = "Décompte des fiches actives par rôle ; aucun nom n'est présenté."; a.conclusion = `${rows.length} personne(s) active(s) dans l'équipe, en plus du propriétaire.`; a.facts = [{ label: "Propriétaires", value: owners }, { label: "Gérants", value: n("manager") }, { label: "Caissiers", value: n("cashier") }]; a.limits = ["Entreprise entière, pas seulement la boutique choisie."]; return a;
}
async function toolStockValue(e: Env): Promise<Answer> {
  await guard(e, "stock", "stockIntel"); const a = base("stockvalue", "Valeur du stock"); const { items } = await shopStock(e.store, cxOf(e)); const held = items.filter((i) => i.qty > 0); const costed = held.filter((i) => i.cost > 0); const value = costed.reduce((t, i) => t + i.qty * i.cost, 0); const retail = held.reduce((t, i) => t + i.qty * i.price, 0);
  a.scope = String(e.shop.name); a.sources = [{ module: "Stock / Articles", detail: "quantités en stock et coûts enregistrés" }]; a.method = "Quantité en stock × dernier coût enregistré, pour les articles en stock dont le coût est connu ; valeur au prix de vente en indication."; a.conclusion = costed.length ? `Valeur du stock au coût : ${fcfa(value)} (${costed.length} article(s) valorisé(s) sur ${held.length} en stock).` : `Aucun article en stock n'a de coût enregistré : valeur au coût non calculable.`;
  a.facts = [{ label: "Articles en stock", value: held.length }, { label: "Articles valorisés (coût connu)", value: costed.length }, { label: "Articles sans coût", value: held.length - costed.length }, { label: "Valeur au coût (FCFA)", value: value }, { label: "Valeur au prix de vente (FCFA)", value: retail }]; a.limits = ["Les articles sans coût sont exclus de la valeur au coût.", "Valorisation au dernier coût, sans méthode FIFO/CMP."]; a.confidence = held.length - costed.length > 0 ? "medium" : "high"; return a;
}

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
/** Synthèse : assemble les réponses des outils existants (aucun calcul nouveau) ; une section refusée par les droits ou la formule est signalée, jamais inventée. */
async function toolOverview(e: Env): Promise<Answer> {
  const parts: [string, (x: Env) => Promise<Answer>][] = [["Ventes", toolSales], ["Stock", toolStock], ["Caisse", toolCash], ["Crédit clients", toolCredit], ["Recommandations", toolRecos]]; const got: { name: string; r: Answer }[] = []; const missing: string[] = [];
  for (const [name, fn] of parts) { try { got.push({ name, r: await fn(e) }); } catch (err) { if (err instanceof HttpError && (err.status === 402 || err.status === 403)) missing.push(name); else throw err; } }
  if (!got.length) return fail("overview", "Aucune section de la synthèse n'est accessible avec votre rôle ou votre formule.");
  const a = base("overview", "Synthèse de l'activité"); const seen = new Set<string>(); const uniq = (xs: string[]) => xs.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  a.period = got.find((g) => g.r.period)?.r.period ?? null; a.scope = String(e.shop.name); a.conclusion = got.map((g) => `${g.name} : ${g.r.conclusion}`).join(" ");
  a.facts = got.flatMap((g) => g.r.facts.map((f) => ({ label: `${g.name} · ${f.label}`, value: f.value }))); a.observations = got.flatMap((g) => g.r.observations.slice(0, 3).map((o) => `${g.name} : ${o.replace(/^•\s*/, "")}`));
  a.sources = got.flatMap((g) => g.r.sources).filter((s, i, arr) => arr.findIndex((x) => x.module === s.module && x.detail === s.detail) === i); a.method = "Assemblage des réponses calculées par MASTER DOGUI pour la boutique et la période choisies (ventes, stock, caisse, crédit clients, recommandations) ; aucun calcul supplémentaire.";
  seen.clear(); a.limits = uniq([...got.flatMap((g) => g.r.limits), ...(missing.length ? [`Sections non affichées (droits ou formule) : ${missing.join(", ")}.`] : [])]); a.recommendations = uniq(got.flatMap((g) => g.r.recommendations)).slice(0, 5);
  a.confidence = got.map((g) => g.r.confidence).sort((x, y) => RANK[x]! - RANK[y]!)[0]!; return a;
}
const TOOLS: Record<string, (e: Env) => Promise<Answer>> = { expenses: toolExpenses, purchases: toolPurchases, payables: toolPayables, treasury: toolTreasury, customers: toolCustomers, pipeline: toolPipeline, promos: toolPromos, inventories: toolInventories, transfers: toolTransfers, invest: toolInvest, accounting: toolAccounting, team: toolTeam, stockvalue: toolStockValue, overview: toolOverview, sales: toolSales, top: toolTop, stock: toolStock, cash: toolCash, credit: toolCredit, recos: toolRecos, profile: toolProfile };

const fail = (qid: string, msg: string): Answer => ({ ...base(qid, "Accès refusé"), conclusion: msg, confidence: "low", limits: ["Aucun chiffre n'est présenté : votre accès ou votre formule ne le permet pas."] });
const guide = (note: string, aiOn = false): Answer => ({ ...base("none", "Question non comprise"), conclusion: note, confidence: "low", observations: GUIDED.map((g) => `• ${g.label}`), limits: [aiOn ? "Cette question ne correspond à aucun sujet que MASTER DOGUI sait calculer (liste ci-dessus). L'IA ne répond qu'à partir de résultats calculés, jamais de sa propre connaissance : rien n'est improvisé." : "Mode guidé : l'assistant répond aux questions de la liste. Aucun fournisseur d'IA n'est configuré, donc aucune réponse n'est improvisée."] });

const quotaDay = () => dayKey();
const envInt = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return v !== undefined && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : d; };
/** Limites par utilisateur (en plus du plafond d'entreprise) : questions par jour et délai minimal entre deux questions ; réglables par variable de la fonction. */
export const chatLimits = (env: Record<string, string | undefined> = process.env) => ({ userDaily: envInt(env.MASTER_CHAT_USER_DAILY, 15, 1, 1000), minIntervalMs: envInt(env.MASTER_CHAT_MIN_INTERVAL_MS, 5000, 0, 60_000) });
async function userGuard(store: Store, ctx: Ctx) {
  const lim = chatLimits(); const used = (await store.scan("md_usage", { tenantId: ctx.tenantId, day: quotaDay() }, { maxRows: LIMITS.daily + 5 })).rows.filter((r) => r.userId === ctx.userId).length;
  if (used >= lim.userDaily) throw new HttpError(429, `Plafond personnel atteint : ${lim.userDaily} questions par jour et par utilisateur. Revenez demain.`);
  if (lim.minIntervalMs > 0) { const last = (await store.scan("md_chats", { tenantId: ctx.tenantId, userId: ctx.userId }, { maxRows: 200 })).rows.reduce((m, c) => Math.max(m, Date.parse(String(c.updatedAt ?? c.createdAt ?? "")) || 0), 0); if (Date.now() - last < lim.minIntervalMs) throw new HttpError(429, `Une question toutes les ${Math.round(lim.minIntervalMs / 1000)} secondes : patientez un instant.`); }
}
/** Purge au fil des consultations : lignes de décompte de plus de 90 jours (60 au plus par appel). */
async function purgeUsage(store: Store, tenantId: string) { const cut = dayKey(new Date(Date.now() - 90 * 864e5)); const old = (await store.scan("md_usage", { tenantId }, { maxRows: 4000 })).rows.filter((r) => String(r.day) < cut).slice(0, 60); for (const r of old) await store.remove("md_usage", r.$id); }
async function quotaUsed(store: Store, tenantId: string): Promise<number> { return (await store.scan("md_usage", { tenantId, day: quotaDay() }, { maxRows: LIMITS.daily + 5 })).rows.length; }
async function tokensToday(store: Store, tenantId: string): Promise<number> { return (await store.scan("md_usage", { tenantId, day: quotaDay() }, { maxRows: LIMITS.daily + 5 })).rows.reduce((s, r) => s + Number(r.tokensIn ?? 0) + Number(r.tokensOut ?? 0), 0); }
async function claimQuota(store: Store, ctx: Ctx): Promise<string> { const day = quotaDay(); let n = (await quotaUsed(store, ctx.tenantId)) + 1; for (; n <= LIMITS.daily; n++) { const id = `us${sha(`${ctx.tenantId}|${day}|${n}`).slice(0, 28)}`; if (await store.create("md_usage", id, ctx.tenantId, { tenantId: ctx.tenantId, day, n, userId: ctx.userId })) return id; } throw new HttpError(429, `Plafond atteint : ${LIMITS.daily} questions par jour pour l'entreprise. Revenez demain.`); }

const aiMode = () => { const s = aiStatus(); return s.active ? { ai: true, label: "Mode IA : la rédaction est confiée à un modèle de langage (Gemini) ; les chiffres restent calculés par MASTER DOGUI et vérifiés. Sont transmis : votre question et des résultats agrégés, jamais de noms de clients ni de données de paiement.", ...s } : { ai: false, label: "Mode guidé : réponses calculées par MASTER DOGUI, aucune donnée envoyée à un service externe.", ...s }; };
const view = (m: Row) => ({ id: m.$id, role: String(m.role), text: String(m.text), answer: m.data ? parse<Answer | null>(m.data, null) : null, mode: String(m.mode ?? ""), createdAt: String(m.createdAt ?? "") });
const mine = async (store: Store, ctx: Ctx, chatId: unknown): Promise<Row> => { const c = await store.get("md_chats", String(chatId ?? "")); if (!c || c.tenantId !== ctx.tenantId || c.userId !== ctx.userId) throw new HttpError(404, "Conversation introuvable"); return c; };

export async function chatList(store: Store, ctx: Ctx) {
  reader(ctx); const rows = (await store.scan("md_chats", { tenantId: ctx.tenantId, userId: ctx.userId }, { maxRows: 500 })).rows; const cut = retentionCutoff(); const old = rows.filter((c) => String(c.updatedAt ?? c.createdAt ?? "") < cut).slice(0, 50);
  for (const c of old) await purge(store, c); try { await purgeUsage(store, ctx.tenantId); } catch { /* la consultation reste possible */ } const keep = rows.filter((c) => !old.includes(c)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
  const e = await (await import("./master")).masterEntitlement(store, ctx.tenantId); const allowed = await myShops(store, ctx); const shops = (await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 200 })).rows.filter((s) => allowed === "all" || allowed.includes(s.$id));
  return { chats: keep.map((c) => ({ id: c.$id, title: String(c.title), updatedAt: String(c.updatedAt) })), mode: aiMode(), canAsk: e.canAnalyze, quota: { limit: LIMITS.daily, used: await quotaUsed(store, ctx.tenantId) }, maxQuestion: LIMITS.question, retentionMonths: LIMITS.retentionMonths, guided: GUIDED.map((g) => ({ id: g.id, label: g.label, periodic: g.periodic, shopLevel: g.shopLevel })), shops: shops.map((s) => ({ id: s.$id, name: String(s.name) })), privacy: "Vos conversations sont privées : ni le propriétaire ni un autre utilisateur ne les consulte." };
}
async function purge(store: Store, c: Row) { for (const m of (await store.scan("md_msgs", { tenantId: String(c.tenantId), chatId: c.$id }, { maxRows: 2000 })).rows) await store.remove("md_msgs", m.$id); await store.remove("md_chats", c.$id); }
export async function chatGet(store: Store, ctx: Ctx, b: { chatId?: string }) { reader(ctx); const c = await mine(store, ctx, b.chatId); const msgs = (await store.scan("md_msgs", { tenantId: ctx.tenantId, chatId: c.$id }, { maxRows: 1000 })).rows.filter((m) => m.userId === ctx.userId).sort((a, z) => String(a.createdAt).localeCompare(String(z.createdAt))); return { id: c.$id, title: String(c.title), messages: msgs.map(view) }; }
export async function chatDelete(store: Store, ctx: Ctx, b: { chatId?: string }) { reader(ctx); const c = await mine(store, ctx, b.chatId); await purge(store, c); await audit(store, ctx, "chat.delete", c.$id); return { ok: true }; }

/** Question : soit une question guidée (qid), soit un texte apparié de façon déterministe. Idempotent par requestKey ; le quota n'est consommé que lorsqu'un outil est réellement exécuté. */
export async function chatAsk(store: Store, ctx: Ctx, b: { chatId?: string; text?: string; qid?: string; shopId?: string; days?: unknown; requestKey?: string }) {
  reader(ctx); await needMaster(store, ctx); const rk = String(b.requestKey ?? ""); if (!/^[A-Za-z0-9_-]{12,64}$/.test(rk)) throw new HttpError(400, "Identifiant de demande invalide");
  const uid = `mu${sha(`${ctx.tenantId}|${ctx.userId}|${rk}|u`).slice(0, 28)}`; const aid = `ma${sha(`${ctx.tenantId}|${ctx.userId}|${rk}|a`).slice(0, 28)}`;
  const prevU = await store.get("md_msgs", uid); if (prevU) { if (prevU.tenantId !== ctx.tenantId || prevU.userId !== ctx.userId) throw new HttpError(404, "Introuvable"); const prevA = await store.get("md_msgs", aid); return { chatId: String(prevU.chatId), user: view(prevU), assistant: prevA ? view(prevA) : null, duplicate: true }; }
  await userGuard(store, ctx);
  let text: string; let qid = ""; let days = 7;
  if (b.qid) { const g = GUIDED.find((x) => x.id === b.qid); if (!g) throw new HttpError(400, "Question inconnue"); qid = g.id; text = g.label; const d = Number(b.days ?? 7); days = [1, 7, 30].includes(d) ? d : 7; }
  else { const c = cleanQuestion(b.text); if (!c.ok) throw new HttpError(400, c.error); text = c.text; const m = matchQuestion(text); if (m.kind === "match") { qid = m.id; days = m.days; } }
  const m = qid || b.qid ? null : matchQuestion(text); let answer: Answer; let claim = ""; let mode = "guided"; const tok = { in: 0, out: 0 }; const notes: string[] = [];
  const chatId = b.chatId ? String((await mine(store, ctx, b.chatId)).$id) : `ch${sha(`${ctx.tenantId}|${ctx.userId}|${rk}|c`).slice(0, 28)}`; const t = nowIso();
  const cfg = aiConfig(); let ai: AiConfig | null = null; if (cfg) { if ((await tokensToday(store, ctx.tenantId)) < cfg.dailyTokens) ai = cfg; else notes.push("Plafond de coût IA du jour atteint : réponse calculée sans rédaction par IA."); }
  const t0 = Date.now(); // la fonction dispose de 30 s : tous les appels IA partagent un budget de 22 s, le reste sert aux lectures et écritures
  const callAi = async (system: string, user: string) => { const left = 22_000 - (Date.now() - t0); if (left < 3000) throw new AiError("fournisseur IA : délai global épuisé"); const r = await geminiJson({ ...ai!, timeoutMs: Math.min(ai!.timeoutMs, left - 500) }, system, user); tok.in += r.tokensIn; tok.out += r.tokensOut; return r.text; };
  if (!qid && ai && !b.qid) { // question hors catalogue : l'IA ne fait que CHOISIR un sujet connu (la question seule est transmise) ; la demande consomme le quota, car elle coûte un appel
    claim = await claimQuota(store, ctx); try { const c = parseClassify(await callAi(CLASSIFY_SYSTEM, classifyInput(text))); if (c && c.qid !== "none") { qid = c.qid; days = c.days; } else if (!c) notes.push("Classement par IA illisible : question non comprise."); } catch (e) { notes.push(e instanceof AiError ? `${e.message} : question non comprise. Réessayez dans un instant.` : "IA indisponible."); if (!tok.in && !tok.out) { await store.remove("md_usage", claim); claim = ""; } }
  }
  if (!qid) answer = guide(m?.kind === "ambiguous" ? "Votre question correspond à plusieurs sujets : précisez-la ou choisissez une question de la liste." : cfg ? "Cette question ne porte sur aucun des sujets que je sais calculer pour l'instant." : "Je n'ai pas de réponse calculée pour cette question en mode guidé.", !!cfg);
  else {
    const g = GUIDED.find((x) => x.id === qid)!; const allowed = await myShops(store, ctx); let shop: Row | null = null;
    if (g.shopLevel) { const sid = String(b.shopId ?? ""); if (!sid) throw new HttpError(400, "Choisissez une boutique"); shop = await store.get("shops", sid); if (!shop || shop.tenantId !== ctx.tenantId || (allowed !== "all" && !allowed.includes(sid))) throw new HttpError(404, "Boutique introuvable ou hors de votre périmètre"); }
    if (!claim) claim = await claimQuota(store, ctx);
    try { answer = await TOOLS[qid]!({ store, ctx, shop: shop ?? ({ $id: "", name: "Entreprise" } as Row), days }); }
    catch (e) { if (e instanceof HttpError && (e.status === 402 || e.status === 403)) answer = fail(qid, e.message); else { await store.remove("md_usage", claim); throw e; } }
    if (ai && AI_QIDS.includes(qid) && answer.facts.length) { // rédaction : le modèle reformule, les chiffres et les sources restent ceux de l'outil ; toute rédaction non vérifiée est écartée
      try { const w = parseWrite(await callAi(WRITE_SYSTEM, writeInput(answer, text))); const chk = w ? checkWrite(w, answer) : { ok: false, reason: "rédaction illisible" }; if (w && chk.ok) { answer = { ...answer, conclusion: w.conclusion, observations: w.observations.length ? w.observations : answer.observations, ai: { used: true } }; mode = "ai"; } else notes.push(`Rédaction par IA écartée (${chk.reason}) : réponse calculée affichée.`); }
      catch (e) { notes.push(e instanceof AiError ? `${e.message} : réponse calculée affichée.` : "Rédaction par IA indisponible : réponse calculée affichée."); }
    }
  }
  if (!answer.ai) answer = { ...answer, ai: { used: false, ...(notes.length ? { note: notes.join(" ") } : {}) } };
  if (claim && (tok.in || tok.out)) await store.update("md_usage", claim, { tokensIn: tok.in, tokensOut: tok.out });
  if (!b.chatId) await store.create("md_chats", chatId, ctx.tenantId, { tenantId: ctx.tenantId, userId: ctx.userId, title: text.slice(0, LIMITS.title), createdAt: t, updatedAt: t });
  await store.create("md_msgs", uid, ctx.tenantId, { tenantId: ctx.tenantId, chatId, userId: ctx.userId, role: "user", text, qid, mode, createdAt: t });
  await store.create("md_msgs", aid, ctx.tenantId, { tenantId: ctx.tenantId, chatId, userId: ctx.userId, role: "assistant", text: answer.conclusion.slice(0, 1000), data: JSON.stringify(answer), qid, mode, createdAt: new Date(Date.parse(t) + 1).toISOString() });
  if (b.chatId) await store.update("md_chats", chatId, { updatedAt: t });
  await audit(store, ctx, "chat.ask", mode === "ai" || tok.in || tok.out ? `${qid || "non-apparié"} · mode IA (prompt ${PROMPT_VERSION}) · transmis : question (${text.length} car.) + résultats agrégés sans donnée nominative · jetons ${tok.in}/${tok.out}${notes.length ? " · repli : " + notes.join(" ").slice(0, 150) : ""}` : `${qid || "non-apparié"} · mode guidé · aucune donnée transmise à un fournisseur externe${notes.length ? " · " + notes.join(" ").slice(0, 150) : ""}`);
  return { chatId, user: view((await store.get("md_msgs", uid))!), assistant: view((await store.get("md_msgs", aid))!), duplicate: false };
}
