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
import { HttpError, type Ctx, type Row, type Store } from "./store";

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
const TOOLS: Record<string, (e: Env) => Promise<Answer>> = { sales: toolSales, top: toolTop, stock: toolStock, cash: toolCash, credit: toolCredit, recos: toolRecos, profile: toolProfile };

const fail = (qid: string, msg: string): Answer => ({ ...base(qid, "Accès refusé"), conclusion: msg, confidence: "low", limits: ["Aucun chiffre n'est présenté : votre accès ou votre formule ne le permet pas."] });
const guide = (note: string, aiOn = false): Answer => ({ ...base("none", "Question non comprise"), conclusion: note, confidence: "low", observations: GUIDED.map((g) => `• ${g.label}`), limits: [aiOn ? "Cette question ne correspond à aucun sujet que MASTER DOGUI sait calculer (liste ci-dessus). L'IA ne répond qu'à partir de résultats calculés, jamais de sa propre connaissance : rien n'est improvisé." : "Mode guidé : l'assistant répond aux questions de la liste. Aucun fournisseur d'IA n'est configuré, donc aucune réponse n'est improvisée."] });

const quotaDay = () => dayKey();
async function quotaUsed(store: Store, tenantId: string): Promise<number> { return (await store.scan("md_usage", { tenantId, day: quotaDay() }, { maxRows: LIMITS.daily + 5 })).rows.length; }
async function tokensToday(store: Store, tenantId: string): Promise<number> { return (await store.scan("md_usage", { tenantId, day: quotaDay() }, { maxRows: LIMITS.daily + 5 })).rows.reduce((s, r) => s + Number(r.tokensIn ?? 0) + Number(r.tokensOut ?? 0), 0); }
async function claimQuota(store: Store, ctx: Ctx): Promise<string> { const day = quotaDay(); let n = (await quotaUsed(store, ctx.tenantId)) + 1; for (; n <= LIMITS.daily; n++) { const id = `us${sha(`${ctx.tenantId}|${day}|${n}`).slice(0, 28)}`; if (await store.create("md_usage", id, ctx.tenantId, { tenantId: ctx.tenantId, day, n, userId: ctx.userId })) return id; } throw new HttpError(429, `Plafond atteint : ${LIMITS.daily} questions par jour pour l'entreprise. Revenez demain.`); }

const aiMode = () => { const s = aiStatus(); return s.active ? { ai: true, label: "Mode IA : la rédaction est confiée à un modèle de langage (Gemini) ; les chiffres restent calculés par MASTER DOGUI et vérifiés. Sont transmis : votre question et des résultats agrégés, jamais de noms de clients ni de données de paiement.", ...s } : { ai: false, label: "Mode guidé : réponses calculées par MASTER DOGUI, aucune donnée envoyée à un service externe.", ...s }; };
const view = (m: Row) => ({ id: m.$id, role: String(m.role), text: String(m.text), answer: m.data ? parse<Answer | null>(m.data, null) : null, mode: String(m.mode ?? ""), createdAt: String(m.createdAt ?? "") });
const mine = async (store: Store, ctx: Ctx, chatId: unknown): Promise<Row> => { const c = await store.get("md_chats", String(chatId ?? "")); if (!c || c.tenantId !== ctx.tenantId || c.userId !== ctx.userId) throw new HttpError(404, "Conversation introuvable"); return c; };

export async function chatList(store: Store, ctx: Ctx) {
  reader(ctx); const rows = (await store.scan("md_chats", { tenantId: ctx.tenantId, userId: ctx.userId }, { maxRows: 500 })).rows; const cut = retentionCutoff(); const old = rows.filter((c) => String(c.updatedAt ?? c.createdAt ?? "") < cut).slice(0, 50);
  for (const c of old) await purge(store, c); const keep = rows.filter((c) => !old.includes(c)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
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
  let text: string; let qid = ""; let days = 7;
  if (b.qid) { const g = GUIDED.find((x) => x.id === b.qid); if (!g) throw new HttpError(400, "Question inconnue"); qid = g.id; text = g.label; const d = Number(b.days ?? 7); days = [1, 7, 30].includes(d) ? d : 7; }
  else { const c = cleanQuestion(b.text); if (!c.ok) throw new HttpError(400, c.error); text = c.text; const m = matchQuestion(text); if (m.kind === "match") { qid = m.id; days = m.days; } }
  const m = qid || b.qid ? null : matchQuestion(text); let answer: Answer; let claim = ""; let mode = "guided"; const tok = { in: 0, out: 0 }; const notes: string[] = [];
  const chatId = b.chatId ? String((await mine(store, ctx, b.chatId)).$id) : `ch${sha(`${ctx.tenantId}|${ctx.userId}|${rk}|c`).slice(0, 28)}`; const t = nowIso();
  const cfg = aiConfig(); let ai: AiConfig | null = null; if (cfg) { if ((await tokensToday(store, ctx.tenantId)) < cfg.dailyTokens) ai = cfg; else notes.push("Plafond de coût IA du jour atteint : réponse calculée sans rédaction par IA."); }
  const callAi = async (system: string, user: string) => { const r = await geminiJson(ai!, system, user); tok.in += r.tokensIn; tok.out += r.tokensOut; return r.text; };
  if (!qid && ai && !b.qid) { // question hors catalogue : l'IA ne fait que CHOISIR un sujet connu (la question seule est transmise) ; la demande consomme le quota, car elle coûte un appel
    claim = await claimQuota(store, ctx); try { const c = parseClassify(await callAi(CLASSIFY_SYSTEM, classifyInput(text))); if (c && c.qid !== "none") { qid = c.qid; days = c.days; } else if (!c) notes.push("Classement par IA illisible : question non comprise."); } catch (e) { notes.push(e instanceof AiError ? `${e.message} : question non comprise.` : "IA indisponible."); }
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
