/** MASTER DOGUI — étape 4 : recommandations suivies. Le moteur APPELLE les calculs existants des modules (lecture seule), normalise chaque constat,
 *  l'enregistre une seule fois (empreinte des faits) et suit sa vie. Aucune action n'est exécutée automatiquement. */
import { createHash } from "node:crypto";
import { CONF_LABEL, DEFAULT_CFG, NEXT, RULES, STATUS_LABEL, cfgFrom, canMove, followDue, normalizeCfg, outcomeText, ruleOf, sortRecos, type Conf, type Measure, type Prio, type RStatus } from "../../../src/domain/master-reco";
import { MIN, parse } from "./crm";
import { roleKind } from "./fin-rules";
import { needMaster } from "./master";
import { stockAlerts } from "./stock-biz";
import { proReplenish } from "./stock-pro";
import { proInsights } from "./expenses-intel";
import { promotionRecommendations } from "./promotions-pro";
import { HttpError, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const ENT = "entreprise";
const nowIso = () => new Date().toISOString();
const audit = (store: Store, ctx: Ctx, shopId: string, action: string, detail: string) => store.create("audit_log", crypto.randomUUID().replace(/-/g, "").slice(0, 30), ctx.tenantId, { tenantId: ctx.tenantId, shopId: shopId || "platform", userId: ctx.userId, action, detail: detail.slice(0, 500) });
const reader = (ctx: Ctx) => { if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); };

export type Finding = { ruleId: string; shopId: string; subject: string; fingerprint: string; prio: Prio; title: string; reason: string; sources: { module: string; period: string; detail: string }[]; kind: "fact" | "estimate"; confidence: Conf; metric: Measure | null; limits?: string };
type Out = { findings: Finding[]; resolved?: boolean; insufficient?: string };

async function myShops(store: Store, ctx: Ctx): Promise<string[] | "all"> {
  if (roleKind(ctx) === "owner") return "all";
  const s = await store.get("staff", ctx.userId); if (!s || s.tenantId !== ctx.tenantId || s.active === false) return [];
  try { const v = JSON.parse(String(s.shopIds || "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
const cfgId = (tenantId: string) => `rc${sha(`recocfg|${tenantId}`).slice(0, 28)}`;
async function cfgOf(store: Store, tenantId: string) { const r = await store.get("md_reco_cfg", cfgId(tenantId)); return r && r.tenantId === tenantId ? cfgFrom(r.data) : DEFAULT_CFG; }
const fp = (...parts: (string | number)[]) => sha(parts.join("|")).slice(0, 20);
const unit = (ruleId: string, shopId: string, subject: string, fingerprint: string, f: Omit<Finding, "ruleId" | "shopId" | "subject" | "fingerprint">): Finding => ({ ruleId, shopId, subject, fingerprint, ...f });

// ------------------------------------------------------------------ collecteurs (un par règle ; chacun lit les fonctions des modules, jamais d'écriture)
async function stockRules(store: Store, ctx: Ctx, shop: string): Promise<{ out: Out; late: Out }> {
  const r = await stockAlerts(store, { ...ctx, shopId: shop }); const a = r.alerts as { kind: string; level: string; title: string; detail: string; productId?: string }[];
  const bad = a.filter((x) => x.kind === "out" || x.kind === "negative"); const late = a.filter((x) => x.kind === "receipt_late");
  const o1: Out = bad.length ? { findings: [unit("stock_out", shop, shop, fp(shop, ...bad.map((x) => x.productId ?? x.title).sort()), { prio: "critical", title: `${bad.length} article(s) en rupture ou à stock négatif`, reason: bad.slice(0, 6).map((x) => x.title.replace(/^.* · /, "")).join(" ; ") + (bad.length > 6 ? ` (+${bad.length - 6})` : ""), sources: [{ module: "Stock", period: "état actuel", detail: "alertes de stock (rupture, stock négatif)" }], kind: "fact", confidence: "high", metric: { label: "Articles en rupture ou négatifs", value: bad.length } })] } : { findings: [], resolved: true };
  const o2: Out = late.length ? { findings: [unit("po_late", shop, shop, fp(shop, ...late.map((x) => x.title).sort()), { prio: "high", title: `${late.length} commande(s) fournisseur en retard de réception`, reason: late.slice(0, 5).map((x) => x.title).join(" ; "), sources: [{ module: "Achats", period: "état actuel", detail: "commandes validées/envoyées dont la livraison prévue est dépassée" }], kind: "fact", confidence: "high", metric: { label: "Commandes en retard", value: late.length } })] } : { findings: [], resolved: true };
  return { out: o1, late: o2 };
}
async function replenishRule(store: Store, ctx: Ctx, shop: string): Promise<Out> {
  const r: any = await proReplenish(store, { ...ctx, shopId: shop }, { shopId: shop }); const risky = (r.items ?? []).filter((x: any) => (x.risk === "out" || x.risk === "high") && Number(x.suggestedQty) > 0);
  if (!risky.length) return Number(r.insufficient?.count) > 0 && !Number(r.total) ? { findings: [], insufficient: `${r.insufficient.count} article(s) sans historique de ventes suffisant (calcul du module Stock Pro)` } : { findings: [], resolved: true };
  return { findings: [unit("replenish", shop, shop, fp(shop, ...risky.map((x: any) => String(x.key ?? x.productId)).sort()), { prio: "high", title: `Réapprovisionnement conseillé : ${risky.length} article(s) à risque`, reason: risky.slice(0, 5).map((x: any) => `${x.name} (couverture ${x.daysToOut ?? 0} j, commande suggérée ${x.suggestedQty})`).join(" ; "), sources: [{ module: "Stock Pro", period: "ventes récentes et délais fournisseurs", detail: "point de commande = demande × délai + stock de sécurité" }], kind: "estimate", confidence: "medium", metric: { label: "Articles à risque de rupture", value: risky.length }, limits: "Estimation fondée sur l'historique de ventes ; ne tient pas compte d'un événement exceptionnel." })] };
}
async function cashRule(store: Store, ctx: Ctx, shop: string, cfg = DEFAULT_CFG): Promise<Out> {
  const from = new Date(Date.now() - cfg.cashWindowDays * 864e5).toISOString(); const sh = await store.get("shops", shop); const tol = Math.max(0, Number(sh?.varianceTolerance ?? 0));
  const rows = (await store.scan("cash_sessions", { tenantId: ctx.tenantId, shopId: shop }, { range: { field: "closedAt", from }, maxRows: 2000 })).rows.filter((s) => s.status === "closed");
  if (rows.length < cfg.cashMinSessions) return { findings: [], insufficient: `${rows.length} session(s) clôturée(s) sur ${cfg.cashWindowDays} jours (minimum ${cfg.cashMinSessions})` };
  const bad = rows.filter((s) => Math.abs(Number(s.variance)) > tol); if (bad.length < cfg.cashVarianceCount) return { findings: [], resolved: true };
  const sum = bad.reduce((t, s) => t + Number(s.variance), 0);
  return { findings: [unit("cash_variance", shop, shop, fp(shop, bad.length, ...bad.map((s) => s.$id).sort()), { prio: "high", title: `${bad.length} écarts de caisse hors tolérance en ${cfg.cashWindowDays} jours`, reason: `${bad.length} sessions sur ${rows.length} dépassent la tolérance (${tol} FCFA) ; cumul des écarts : ${sum} FCFA. Revoir la procédure de comptage ou la formation des vendeurs concernés.`, sources: [{ module: "Caisse", period: `${cfg.cashWindowDays} derniers jours`, detail: `${rows.length} sessions clôturées` }], kind: "fact", confidence: rows.length >= 10 ? "high" : "medium", metric: { label: "Écarts de caisse hors tolérance", value: bad.length } })] };
}
async function creditRule(store: Store, ctx: Ctx, shop: string, cfg = DEFAULT_CFG): Promise<Out> {
  const rows = (await store.scan("customers", { tenantId: ctx.tenantId, shopId: shop }, { maxRows: 20_000 })).rows.filter((c) => !c.archived && Number(c.creditLimit) > 0 && Number(c.creditBalance) > 0 && Number(c.creditBalance) * 100 >= Number(c.creditLimit) * cfg.creditPct);
  if (!rows.length) return { findings: [], resolved: true }; const total = rows.reduce((t, c) => t + Number(c.creditBalance), 0);
  return { findings: [unit("client_credit", shop, shop, fp(shop, ...rows.map((c) => c.$id).sort()), { prio: "medium", title: `${rows.length} client(s) proches ou au plafond de crédit`, reason: `Encours cumulé ${total} FCFA ; ${rows.slice(0, 4).map((c) => String(c.name)).join(", ")}${rows.length > 4 ? "…" : ""}. Aucune date d'échéance n'est enregistrée : la règle repose sur le plafond, pas sur un retard de paiement.`, sources: [{ module: "Clients", period: "état actuel", detail: `encours ≥ ${cfg.creditPct} % du plafond` }], kind: "fact", confidence: "high", metric: { label: "Clients au plafond de crédit", value: rows.length } })] };
}
async function expensesRule(store: Store, ctx: Ctx, shop: string): Promise<Out> {
  const r = await proInsights(store, { ...ctx, shopId: shop }); const recs = r.recommendations; if (!recs.length) return { findings: [], resolved: true };
  return { findings: recs.map((x) => unit("expenses", shop, fp(x.text), fp(shop, x.text, x.data), { prio: "medium", title: x.text.length > 90 ? `${x.text.slice(0, 87)}…` : x.text, reason: `${x.text} ${x.data}`.slice(0, 400), sources: [{ module: "Dépenses Pro", period: x.period, detail: x.data }], kind: "estimate", confidence: "medium", metric: null, limits: x.limits })) };
}
async function promoRule(store: Store, ctx: Ctx, shop: string): Promise<Out> {
  const r = await promotionRecommendations(store, { ...ctx, shopId: shop }); const list = r.recommendations; if (!list.length) return { findings: [], resolved: true };
  return { findings: list.map((x) => unit("promo", shop, x.id, fp(shop, x.id, JSON.stringify(x.data)), { prio: "opportunity", title: x.title, reason: x.why, sources: [{ module: "Promotions Pro", period: "60 derniers jours", detail: JSON.stringify(x.data).slice(0, 200) }], kind: "estimate", confidence: "medium", metric: null, limits: x.limits })) };
}

const isGate = (e: unknown) => e instanceof HttpError && (e.status === 402 || e.status === 403);

/** Génération à la demande (idempotente) : crée les nouvelles recommandations, réveille les reportées échues, met à jour la mesure des acceptées. */
export async function recoGenerate(store: Store, ctx: Ctx, b: { shopId?: string } = {}) {
  reader(ctx); await needMaster(store, ctx); const cfg = await cfgOf(store, ctx.tenantId); const allowed = await myShops(store, ctx);
  const shops = (await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 200 })).rows.filter((s) => (allowed === "all" || allowed.includes(s.$id)) && (!b.shopId || s.$id === b.shopId));
  if (b.shopId && !shops.length) throw new HttpError(404, "Boutique introuvable ou hors de votre périmètre");
  const summary = { created: 0, existing: 0, insufficient: [] as { rule: string; shop: string; reason: string }[], unavailable: [] as { rule: string; shop: string; reason: string }[], failed: [] as { rule: string; shop: string }[] };
  for (const sh of shops) {
    const name = String(sh.name); const run = async (ruleId: string, fn: () => Promise<Out>) => {
      let out: Out; try { out = await fn(); } catch (e) { if (isGate(e)) summary.unavailable.push({ rule: ruleId, shop: name, reason: (e as Error).message }); else summary.failed.push({ rule: ruleId, shop: name }); return; }
      if (out.insufficient) { summary.insufficient.push({ rule: ruleId, shop: name, reason: out.insufficient }); return; }
      for (const f of out.findings) { const r = await upsert(store, ctx, f); if (r) summary.created++; else summary.existing++; }
      await refreshOutcome(store, ctx, ruleId, sh.$id, out.findings.length ? Math.max(...out.findings.map((f) => f.metric?.value ?? 0), 0) : 0, out.findings.some((f) => f.metric) || !!out.resolved);
    };
    const st = await (async () => { try { return await stockRules(store, ctx, sh.$id); } catch (e) { const why = isGate(e) ? (e as Error).message : ""; for (const r of ["stock_out", "po_late"]) (why ? summary.unavailable : summary.failed).push({ rule: r, shop: name, ...(why ? { reason: why } : {}) } as any); return null; } })();
    if (st) { await run("stock_out", async () => st.out); await run("po_late", async () => st.late); }
    await run("replenish", () => replenishRule(store, ctx, sh.$id)); await run("cash_variance", () => cashRule(store, ctx, sh.$id, cfg)); await run("client_credit", () => creditRule(store, ctx, sh.$id, cfg)); await run("expenses", () => expensesRule(store, ctx, sh.$id)); await run("promo", () => promoRule(store, ctx, sh.$id));
  }
  await audit(store, ctx, ENT, "reco.generate", `créées ${summary.created} · existantes ${summary.existing}`); return summary;
}

const rid = (ctx: Ctx, f: Pick<Finding, "ruleId" | "shopId" | "fingerprint">) => `rc${sha(`reco|${ctx.tenantId}|${f.shopId}|${f.ruleId}|${f.fingerprint}`).slice(0, 28)}`;
/** Enregistre un constat une seule fois (clé = entreprise + boutique + règle + empreinte). Renvoie true si la ligne est nouvelle. Une reportée échue redevient « nouvelle ». */
export async function upsert(store: Store, ctx: Ctx, f: Finding): Promise<boolean> {
  const id = rid(ctx, f); const t = nowIso();
  const created = await store.create("md_recos", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: f.shopId || ENT, ruleId: f.ruleId, subject: f.subject.slice(0, 64), fingerprint: f.fingerprint, prio: f.prio, title: f.title.slice(0, 200), reason: f.reason.slice(0, 600), sources: JSON.stringify(f.sources).slice(0, 900), kind: f.kind, confidence: f.confidence, status: "new", statusAt: t, statusBy: "system", metric: f.metric ? JSON.stringify(f.metric) : "", limits: (f.limits ?? "").slice(0, 300), createdAt: t });
  if (created) return true;
  const row = await store.get("md_recos", id); if (!row || row.tenantId !== ctx.tenantId) return false;
  if (row.status === "snoozed" && row.snoozeUntil && Date.parse(String(row.snoozeUntil)) <= Date.now()) await store.update("md_recos", id, { status: "new", statusAt: t, statusBy: "system", snoozeUntil: null });
  return false;
}
/** Mesure ultérieure des recommandations acceptées de la même règle et boutique : relevé daté, jamais présenté comme un effet de l'action. */
async function refreshOutcome(store: Store, ctx: Ctx, ruleId: string, shopId: string, value: number, measurable: boolean) {
  if (!measurable) return; const rows = (await store.scan("md_recos", { tenantId: ctx.tenantId, shopId, ruleId }, { maxRows: 500 })).rows.filter((r) => (r.status === "accepted" || r.status === "doing") && r.baseline);
  for (const r of rows) await store.update("md_recos", r.$id, { outcome: JSON.stringify({ value, at: nowIso() }) });
}

const view = (r: Row, cfg = DEFAULT_CFG, shopName = "") => {
  const metric = parse<Measure | null>(r.metric, null); const base = parse<{ label: string; value: number; at: string } | null>(r.baseline, null); const out = parse<{ value: number; at: string } | null>(r.outcome, null); const rule = ruleOf(String(r.ruleId));
  return { id: r.$id, ruleId: String(r.ruleId), rule: rule?.label ?? String(r.ruleId), module: rule?.module ?? "", shopId: r.shopId === ENT ? "" : String(r.shopId), shopName, prio: String(r.prio) as Prio, title: String(r.title), reason: String(r.reason), sources: parse<unknown[]>(r.sources, []), kind: String(r.kind), confidence: String(r.confidence) as Conf, confidenceLabel: CONF_LABEL[String(r.confidence) as Conf] ?? "", status: String(r.status) as RStatus, statusLabel: STATUS_LABEL[String(r.status) as RStatus] ?? String(r.status), statusAt: String(r.statusAt ?? ""), statusBy: String(r.statusBy ?? ""), note: String(r.note ?? ""), snoozeUntil: r.snoozeUntil ? String(r.snoozeUntil) : null, createdAt: String(r.createdAt ?? ""), limits: String(r.limits ?? ""), next: NEXT[String(r.status) as RStatus] ?? [], metric,
    followUp: base ? { baseline: base, outcome: out, text: outcomeText(base, out, base.at), due: followDue(String(r.acceptedAt ?? ""), cfg.followDays) } : null };
};

export async function recoList(store: Store, ctx: Ctx, b: { status?: string; shopId?: string; limit?: unknown } = {}) {
  reader(ctx); const cfg = await cfgOf(store, ctx.tenantId); const allowed = await myShops(store, ctx); const shops = (await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 200 })).rows.filter((s) => allowed === "all" || allowed.includes(s.$id)); const names = new Map(shops.map((s) => [s.$id, String(s.name)] as [string, string]));
  let rows = (await store.scan("md_recos", { tenantId: ctx.tenantId }, { maxRows: 5000 })).rows.filter((r) => r.shopId === ENT ? allowed === "all" : names.has(String(r.shopId)));
  const t = Date.now(); for (const r of rows) if (r.status === "snoozed" && r.snoozeUntil && Date.parse(String(r.snoozeUntil)) <= t) { await store.update("md_recos", r.$id, { status: "new", statusAt: nowIso(), statusBy: "system", snoozeUntil: null }); r.status = "new"; }
  if (b.status) rows = rows.filter((r) => r.status === b.status); if (b.shopId) rows = rows.filter((r) => r.shopId === b.shopId);
  const prof = (await store.scan("md_profile", { tenantId: ctx.tenantId }, { maxRows: 200 })).rows.filter((r) => r.key === "priorities" && r.shopId === ENT); const pri = prof[0] ? parse<string[]>(prof[0].value, []) : [];
  const lim = Math.min(300, Math.max(1, Math.trunc(Number(b.limit ?? 100)) || 100)); const views = sortRecos(rows.map((r) => view(r, cfg, names.get(String(r.shopId)) ?? "")), pri);
  const e = await (await import("./master")).masterEntitlement(store, ctx.tenantId);
  return { recos: views.slice(0, lim), total: views.length, counts: Object.fromEntries((Object.keys(STATUS_LABEL) as RStatus[]).map((k) => [k, rows.filter((r) => r.status === k).length])), order: pri.length ? "Ordre : priorité, puis vos priorités du profil, puis ancienneté." : "Ordre : priorité, puis ancienneté.", canGenerate: e.canAnalyze, canDecide: e.canAnalyze, cfg, rules: RULES, shops: shops.map((s) => ({ id: s.$id, name: String(s.name) })) };
}

export async function recoDecide(store: Store, ctx: Ctx, b: { id?: string; to?: string; note?: string; snoozeDays?: unknown }) {
  reader(ctx); await needMaster(store, ctx); const cfg = await cfgOf(store, ctx.tenantId); const r = await store.get("md_recos", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId) throw new HttpError(404, "Recommandation introuvable");
  const allowed = await myShops(store, ctx); if (r.shopId === ENT ? allowed !== "all" : allowed !== "all" && !allowed.includes(String(r.shopId))) throw new HttpError(403, "Cette recommandation est hors de votre périmètre");
  const to = String(b.to ?? ""); if (!canMove(String(r.status), to)) throw new HttpError(409, `Passage impossible de « ${STATUS_LABEL[String(r.status) as RStatus] ?? r.status} » à « ${STATUS_LABEL[to as RStatus] ?? to} »`);
  const t = nowIso(); const data: Record<string, unknown> = { status: to, statusAt: t, statusBy: ctx.userId, note: String(b.note ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 200) };
  if (to === "snoozed") { const d = b.snoozeDays === undefined ? cfg.snoozeDays : Number(b.snoozeDays); if (!Number.isInteger(d) || d < 1 || d > 90) throw new HttpError(400, "Report : 1 à 90 jours"); data.snoozeUntil = new Date(Date.now() + d * 864e5).toISOString(); }
  if (to === "accepted") { const m = parse<Measure | null>(r.metric, null); data.acceptedAt = t; if (m) data.baseline = JSON.stringify({ ...m, at: t }); }
  await store.update("md_recos", r.$id, data); await audit(store, ctx, String(r.shopId), "reco.status", `${r.ruleId} ${r.status} -> ${to}`); return view({ ...r, ...data } as Row, cfg);
}

export async function recoCfgSave(store: Store, ctx: Ctx, b: { cfg?: unknown }) {
  if (roleKind(ctx) !== "owner") throw new HttpError(403, "Seul le propriétaire modifie les seuils"); await needMaster(store, ctx); const n = normalizeCfg(b.cfg); if (!n.ok) throw new HttpError(400, n.error);
  const id = cfgId(ctx.tenantId); const data = { tenantId: ctx.tenantId, data: JSON.stringify(n.cfg), updatedBy: ctx.userId, updatedAt: nowIso() }; if (!(await store.create("md_reco_cfg", id, ctx.tenantId, data))) await store.update("md_reco_cfg", id, data);
  await audit(store, ctx, ENT, "reco.cfg", JSON.stringify(n.cfg)); return { cfg: n.cfg };
}

/** Recommandations des rapports MASTER : mêmes objets suivis (règle « report », empreinte = texte exact ; une refusée n'est pas re-proposée à l'identique). Jamais bloquant. */
export async function trackReportRecos(store: Store, ctx: Ctx, recos: { prio: Prio; text: string; reason: string; source: string; kind: "fact" | "estimate" }[]) {
  try { for (const x of recos) await upsert(store, ctx, unit("report", ctx.shopId || ENT, fp(x.text), fp(ctx.shopId, x.text), { prio: x.prio, title: x.text.length > 90 ? `${x.text.slice(0, 87)}…` : x.text, reason: `${x.text} ${x.reason}`.slice(0, 500), sources: [{ module: x.source || "Rapport MASTER", period: "rapport", detail: x.reason.slice(0, 200) }], kind: x.kind, confidence: "medium", metric: null })); } catch { /* le rapport reste valide */ }
}
