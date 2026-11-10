import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MAX_AMOUNT } from "../../../src/domain/articles";
import { CODE_ALPHABET, CODE_MAX_FAILS, CODE_TTL_MS, formatCode, isCodeShape, normalizeCode, DEFAULT_CATEGORIES, DEFAULT_EXPENSE_RIGHTS, EXPENSE_RIGHTS, EXPENSE_RIGHT_LABEL, METHODS, SENSITIVE_DEFAULT, SOURCES, dayToStored, isDay, needsApproval, storedToDay, type ExpenseRight } from "../../../src/domain/expenses";
import type { ReportData } from "../../../src/domain/exports";
import { lineTotal } from "../../../src/domain/money";
import { boundsOf, todayIn } from "../../../src/domain/overview";
import { DEFAULT_TIMEZONE, isTimezone } from "../../../src/domain/promotions";
import { needFeature } from "./articles";
import { openSessionOf, sessionTotals } from "./cashier";
import { nextLevel, type Approval, type Tier } from "../../../src/domain/expenses-pro";
import { applyProCreate, expensesProOn, proPrecheck, type ProPre } from "./expenses-pro";
import { isProPos, ledgerWrite, secret } from "./pos-pro";
import { HttpError, needModule, roleOf, type BatchOp, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const DAY = 864e5;
const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
const oneLine = (v: unknown, max: number): string => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// ------------------------------------------------------------------ droits
export async function expenseRights(store: Store, ctx: Ctx): Promise<readonly ExpenseRight[]> {
  const role = roleOf(ctx.roles); if (role === "owner") return EXPENSE_RIGHTS;
  const st = await store.get("staff", ctx.userId); if (st && st.tenantId === ctx.tenantId && st.expenseRights != null && String(st.expenseRights) !== "") return parse<string[]>(st.expenseRights, []).filter((r): r is ExpenseRight => (EXPENSE_RIGHTS as readonly string[]).includes(r));
  return DEFAULT_EXPENSE_RIGHTS[role] ?? [];
}
const needR = async (store: Store, ctx: Ctx, r: ExpenseRight) => { if (!(await expenseRights(store, ctx)).includes(r)) throw new HttpError(403, `Droit manquant : ${EXPENSE_RIGHT_LABEL[r]}`); };
const gate = async (store: Store, ctx: Ctx) => { needModule(ctx, "pos"); await needFeature(store, ctx, "expenses"); };
export async function myExpenseRights(store: Store, ctx: Ctx) { await gate(store, ctx); return { rights: await expenseRights(store, ctx), labels: EXPENSE_RIGHT_LABEL }; }
export async function setExpenseRights(store: Store, ctx: Ctx, b: { userId?: string; rights?: unknown }) {
  await gate(store, ctx); if (roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Réservé au propriétaire");
  const st = await store.get("staff", String(b.userId ?? "")); if (!st || st.tenantId !== ctx.tenantId) throw new HttpError(404, "Employé introuvable");
  if (!Array.isArray(b.rights) || b.rights.some((r) => !(EXPENSE_RIGHTS as readonly string[]).includes(String(r)))) throw new HttpError(400, "Droit inconnu"); const rights = [...new Set((b.rights as string[]).map(String))];
  await store.update("staff", st.$id, { expenseRights: JSON.stringify(rights) }); await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "expense.rights", detail: `${st.$id} ${rights.join(",")}` }); return { userId: st.$id, rights };
}

// ------------------------------------------------------------------ réglages et catégories
async function settings(store: Store, ctx: Ctx) { const sh = await store.get("shops", ctx.shopId.slice(0, 36)); return { codeRequired: sh?.expenseCodeRequired !== false, threshold: Math.max(0, Number(sh?.expenseThreshold ?? 0)), sensitive: sh?.expenseSensitive != null && String(sh.expenseSensitive) !== "" ? parse<string[]>(sh.expenseSensitive, SENSITIVE_DEFAULT) : SENSITIVE_DEFAULT, tz: sh?.promoTz && isTimezone(String(sh.promoTz)) ? String(sh.promoTz) : DEFAULT_TIMEZONE }; }
const customCats = async (store: Store, ctx: Ctx) => (await store.list("expense_categories", { tenantId: ctx.tenantId }, 200)).filter((c) => c.active !== false).map((c) => String(c.name));
export async function expenseCategories(store: Store, ctx: Ctx) { await gate(store, ctx); const s = await settings(store, ctx); return { predefined: DEFAULT_CATEGORIES, custom: await customCats(store, ctx), methods: METHODS, sources: SOURCES, threshold: s.threshold, sensitive: s.sensitive, codeRequired: s.codeRequired }; }
export async function saveExpenseCategory(store: Store, ctx: Ctx, b: { name?: string; active?: boolean }) {
  await gate(store, ctx); await needR(store, ctx, "approve"); const name = oneLine(b.name, 40); if (name.length < 2) throw new HttpError(400, "Nom de catégorie : 2 caractères au moins");
  if (DEFAULT_CATEGORIES.some((c) => c.id === name.toLowerCase() || c.label.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "Cette catégorie existe déjà (catégorie prédéfinie)");
  const id = `ec${sha(`${ctx.tenantId}|${name.toLowerCase()}`).slice(0, 28)}`; const cur = await store.get("expense_categories", id);
  if (cur && cur.tenantId === ctx.tenantId) { if (b.active === false) { await store.update("expense_categories", id, { active: false }); return { name, active: false }; } if (cur.active !== false) throw new HttpError(409, "Cette catégorie existe déjà"); await store.update("expense_categories", id, { active: true }); return { name, active: true }; } // une catégorie utilisée n'est jamais supprimée : seulement archivée
  await store.create("expense_categories", id, ctx.tenantId, { tenantId: ctx.tenantId, name, active: true, createdBy: ctx.userId }); return { name, active: true };
}
export async function saveExpenseSettings(store: Store, ctx: Ctx, b: { threshold?: unknown; sensitive?: unknown; codeRequired?: unknown }) {
  await gate(store, ctx); if (roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Réservé au propriétaire");
  const data: Record<string, unknown> = {};
  if (b.threshold !== undefined) { const t = Number(b.threshold); if (!Number.isInteger(t) || t < 0 || t > MAX_AMOUNT) throw new HttpError(400, "Seuil invalide (entier en FCFA ; 0 = aucun seuil)"); data.expenseThreshold = t; }
  if (b.sensitive !== undefined) { if (!Array.isArray(b.sensitive)) throw new HttpError(400, "Catégories sensibles invalides"); const custom = await customCats(store, ctx); const ok = new Set([...DEFAULT_CATEGORIES.map((c) => c.id as string), ...custom]); const l = [...new Set(b.sensitive.map(String))]; if (l.some((x) => !ok.has(x))) throw new HttpError(400, "Catégorie inconnue"); data.expenseSensitive = JSON.stringify(l); }
  if (b.codeRequired !== undefined) data.expenseCodeRequired = b.codeRequired !== false;
  if (!Object.keys(data).length) throw new HttpError(400, "Rien à enregistrer"); await store.update("shops", ctx.shopId.slice(0, 36), data); await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "expense.settings", detail: JSON.stringify(data).slice(0, 500) }); return { ok: true, ...(await settings(store, ctx)) };
}

// ------------------------------------------------------------------ lecture
const nameMap = async (store: Store, ctx: Ctx) => { const m = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)])); try { for (const o of await store.listOwners(ctx.tenantId)) m.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible */ } return m; };
/** Montant payé : dépense « immédiate » validée = payée en totalité (comportement Business inchangé) ; dépense différée = somme des paiements enregistrés. */
export const paidOf = (r: Row): number => (String(r.payMode ?? "immediate") === "deferred" ? Number(r.paidAmount ?? 0) : r.status === "approved" ? Number(r.amount) : 0);
export const lifecycleOf = (r: Row): string => { const st = String(r.status); if (st !== "approved") return st; const p = paidOf(r); return p >= Number(r.amount) ? "paid" : p > 0 ? "partial" : "committed"; };
const view = (r: Row, names: Map<string, string>) => { const meta = parse<Record<string, unknown>>(r.meta, {}); return { id: r.$id, number: String(r.number), label: String(r.label), description: String(r.description ?? ""), category: String(r.category), amount: Number(r.amount), spentOn: storedToDay(String(r.spentOn)), recordedAt: iso(r.$createdAt) || iso(meta.recordedAt), method: String(r.method), methodLabel: String(meta.methodLabel ?? ""), reference: String(r.reference ?? ""), beneficiary: String(r.beneficiary ?? ""), supplierId: String(r.supplierId ?? ""), source: String(r.source), sessionId: String(r.sessionId ?? ""), receipts: parse<{ fileId: string; name: string; mime: string; at: string }[]>(r.receipts, []), status: String(r.status), createdBy: String(r.createdBy), author: names.get(String(r.createdBy)) ?? "", decidedBy: r.decidedBy ? names.get(String(r.decidedBy)) ?? "" : "", shopId: String(r.shopId), movementId: String(r.movementId ?? ""), overdraft: meta.overdraft ?? null, decisionNote: String(meta.decisionNote ?? ""), cancelReason: String(meta.cancelReason ?? ""), awaitingCode: r.status === "pending" && meta.awaitingCode === true, codeExpiresAt: meta.awaitingCode === true ? String(meta.codeExpiresAt ?? "") : "", codeFailsLeft: meta.awaitingCode === true ? Math.max(0, CODE_MAX_FAILS - Number(meta.codeFails ?? 0)) : null, validatedByCode: meta.validatedByCode === true, dueOn: r.dueOn ? storedToDay(String(r.dueOn)) : "", payMode: String(r.payMode ?? "immediate"), service: String(r.service ?? ""), recurringId: String(r.recurringId ?? ""), paid: paidOf(r), remaining: Math.max(0, Number(r.amount) - paidOf(r)), lifecycle: lifecycleOf(r), levels: parse<string[]>(JSON.stringify(meta.levels ?? ["manager"]), ["manager"]), approvals: (parse<Approval[]>(JSON.stringify(meta.approvals ?? []), [])).map((a) => ({ ...a, name: names.get(a.by) ?? "" })), reasons: (meta.proReasons as string[] | undefined) ?? [], flags: (meta.flags as string[] | undefined) ?? [], allocations: (meta.allocations as { shopId: string; amount: number }[] | undefined) ?? [], override: meta.override ?? null }; };
async function shopScope(store: Store, ctx: Ctx, shopId?: string): Promise<string[]> { // le propriétaire peut consulter une autre de ses boutiques ; les autres, uniquement la leur
  if (!shopId || shopId === ctx.shopId) return [ctx.shopId]; if (roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Boutique non autorisée");
  if (shopId === "all") return (await store.list("shops", { tenantId: ctx.tenantId }, 100)).map((s) => s.$id); const sh = await store.get("shops", shopId); if (!sh || sh.tenantId !== ctx.tenantId) throw new HttpError(404, "Boutique introuvable"); return [shopId];
}
export async function listExpenses(store: Store, ctx: Ctx, b: { from?: string; to?: string; q?: string; category?: string; userId?: string; method?: string; status?: string; source?: string; shopId?: string; limit?: number } = {}) {
  await gate(store, ctx); const all = (await expenseRights(store, ctx)).includes("view"); const shops = await shopScope(store, ctx, b.shopId);
  const to = b.to && isDay(b.to) ? b.to : new Date(Date.now() + DAY).toISOString().slice(0, 10); const from = b.from && isDay(b.from) ? b.from : new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const names = await nameMap(store, ctx); const q = oneLine(b.q, 80).toLowerCase(); let rows: Row[] = [];
  for (const sh of shops) rows.push(...(await store.scan("expenses", { tenantId: ctx.tenantId, shopId: sh }, { range: { field: "spentOn", from: dayToStored(from), to: `${to}T23:59:59.999Z` }, maxRows: 5000 })).rows);
  rows = rows.filter((r) => (all || r.createdBy === ctx.userId) && (!b.category || r.category === b.category) && (!b.userId || r.createdBy === b.userId) && (!b.method || r.method === b.method) && (!b.status || r.status === b.status) && (!b.source || r.source === b.source) && (!q || [r.label, r.beneficiary, r.reference, r.number].some((x) => String(x ?? "").toLowerCase().includes(q))));
  rows.sort((a, c) => String(c.spentOn).localeCompare(String(a.spentOn)) || iso(c.$createdAt).localeCompare(iso(a.$createdAt))); const lim = Math.max(1, Math.min(500, Number(b.limit ?? 200)));
  return { expenses: rows.slice(0, lim).map((r) => view(r, names)), total: rows.length, from, to, restricted: !all };
}
export async function getExpense(store: Store, ctx: Ctx, b: { id?: string }) {
  await gate(store, ctx); const r = await store.get("expenses", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Dépense introuvable");
  if (!(await expenseRights(store, ctx)).includes("view") && r.createdBy !== ctx.userId) throw new HttpError(403, "Vous ne pouvez consulter que vos propres dépenses");
  const names = await nameMap(store, ctx); const ev = (await store.list("expense_events", { expenseId: r.$id }, 500)).sort((a, c) => String(a.$id).localeCompare(String(c.$id)));
  return { ...view(r, names), events: ev.map((e) => { const detail = parse<Record<string, unknown>>(e.detail, {}); const who = e.kind === "approve" && detail.method === "code" && detail.approver ? String(detail.approver) : String(e.userId); return { id: e.$id, kind: String(e.kind), by: names.get(who) ?? "", at: iso(e.at), detail, ...(who !== String(e.userId) ? { enteredBy: names.get(String(e.userId)) ?? "" } : {}) }; }) };
}

// ------------------------------------------------------------------ écriture
type Input = { requestId?: string; label?: string; description?: string; category?: string; amount?: unknown; spentOn?: string; method?: string; methodLabel?: string; reference?: string; beneficiary?: string; supplierId?: string; source?: string; allowOverdraft?: boolean; overdraftReason?: string; confirmDuplicate?: boolean; /* Pro */ dueOn?: string; payMode?: string; service?: string; allocations?: { shopId: string; pct?: number; amount?: number }[]; overrideBudget?: boolean; overrideReason?: string; recurringId?: string };
async function clean(store: Store, ctx: Ctx, b: Input, partial = false) {
  const out: Record<string, unknown> = {}; const has = (k: keyof Input) => !partial || b[k] !== undefined;
  if (has("label")) { const v = oneLine(b.label, 120); if (v.length < 2) throw new HttpError(400, "Libellé obligatoire (2 caractères au moins)"); out.label = v; }
  if (has("description") && b.description !== undefined) out.description = oneLine(b.description, 500);
  if (has("category")) { const c = oneLine(b.category, 40); const ok = DEFAULT_CATEGORIES.some((x) => x.id === c) || (await customCats(store, ctx)).includes(c); if (!ok) throw new HttpError(400, "Catégorie inconnue"); out.category = c; }
  if (has("amount")) { const n = Number(String(b.amount ?? "").replace(/\s/g, "")); if (!Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) throw new HttpError(400, "Montant invalide (entier en FCFA, supérieur à 0)"); out.amount = n; }
  if (has("spentOn")) { if (!isDay(b.spentOn)) throw new HttpError(400, "Date de dépense invalide (AAAA-MM-JJ)"); const t = Date.parse(`${b.spentOn}T00:00:00Z`); if (t > Date.now() + DAY) throw new HttpError(400, "La date de dépense ne peut pas être dans le futur"); if (t < Date.now() - 400 * DAY) throw new HttpError(400, "Date de dépense trop ancienne (400 jours maximum)"); out.spentOn = dayToStored(b.spentOn!); }
  if (has("method")) { if (!METHODS.some((m) => m.id === b.method)) throw new HttpError(400, "Moyen de paiement inconnu"); out.method = b.method; }
  if (b.reference !== undefined) out.reference = oneLine(b.reference, 64);
  if (b.beneficiary !== undefined) out.beneficiary = oneLine(b.beneficiary, 120);
  if (b.supplierId !== undefined) { const id = String(b.supplierId); if (id) { const s = await store.get("suppliers", id); if (!s || s.tenantId !== ctx.tenantId) throw new HttpError(404, "Fournisseur introuvable"); out.beneficiary = out.beneficiary || String(s.name); } out.supplierId = id; }
  if (has("source")) { if (!SOURCES.some((s) => s.id === b.source)) throw new HttpError(400, "Origine du paiement inconnue"); out.source = b.source; }
  return out;
}
let evSeq = 0;
const ev = (ctx: Ctx, expenseId: string, kind: string, detail: unknown, at = new Date().toISOString(), key = ""): BatchOp => ({ kind: "create", table: "expense_events", id: `ev${String(Date.now()).padStart(13, "0")}${String(++evSeq % 1000).padStart(3, "0")}${sha(`${expenseId}|${kind}|${key || newId()}`).slice(0, 16)}`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, expenseId, kind, userId: ctx.userId, at, detail: JSON.stringify(detail).slice(0, 3900) } }); // identifiant = horodage + rang : l'ordre de l'historique est stable
const aud = (ctx: Ctx, action: string, detail: string): BatchOp => ({ kind: "create", table: "audit_log", id: newId(), tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) } });
const moveOp = (ctx: Ctx, e: { id: string; number: string; label: string; beneficiary: string; amount: number }, sessionId: string, kind: "out" | "in", reason: string, key: string, authorizedBy = ctx.userId): BatchOp => ({ kind: "create", table: "cash_movements", id: `cm${sha(`${e.id}|${key}`).slice(0, 28)}`, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, sessionId, kind, amount: e.amount, reason: reason.slice(0, 200), status: "authorized", userId: ctx.userId, authorizedBy, at: new Date().toISOString(), expenseId: e.id, beneficiary: e.beneficiary.slice(0, 120) } });
/** Contrôle du solde : une sortie ne dépasse pas le solde théorique de la session, sauf dépassement explicite, motivé, par quelqu'un qui a le droit de valider (tracé dans la dépense et l'audit). */
async function checkBalance(store: Store, ctx: Ctx, sess: Row, amount: number, b: { allowOverdraft?: boolean; overdraftReason?: string }, canApprove: boolean) {
  const t = await sessionTotals(store, ctx, sess); if (amount <= t.theoreticalCash) return null;
  if (!b.allowOverdraft) throw new HttpError(409, `Solde de caisse insuffisant : ${fcfa(t.theoreticalCash)} disponibles pour une sortie de ${fcfa(amount)}`);
  if (!canApprove) throw new HttpError(403, "Seul un responsable ayant le droit de valider peut autoriser une sortie supérieure au solde");
  const why = oneLine(b.overdraftReason, 200); if (why.length < 5) throw new HttpError(400, "Motif obligatoire (5 caractères au moins) pour dépasser le solde de caisse");
  return { reason: why, by: ctx.userId, balanceBefore: t.theoreticalCash, excess: amount - t.theoreticalCash };
}

export async function createExpense(store: Store, ctx: Ctx, b: Input) {
  await gate(store, ctx); await needR(store, ctx, "create"); const rid = oneLine(b.requestId, 64); if (rid.length < 8) throw new HttpError(400, "requestId invalide (8 caractères au moins)");
  const id = `ex${sha(`${ctx.tenantId}|${rid}`).slice(0, 28)}`; const prior = await store.get("expenses", id);
  if (prior) { if (prior.tenantId !== ctx.tenantId || prior.shopId !== ctx.shopId) throw new HttpError(409, "Identifiant déjà utilisé"); return { id, number: String(prior.number), status: String(prior.status), duplicate: true, awaitingCode: parse<Record<string, unknown>>(prior.meta, {}).awaitingCode === true }; }
  const wantsPro = b.dueOn !== undefined || b.payMode !== undefined || b.service !== undefined || b.allocations !== undefined || b.overrideBudget !== undefined || b.recurringId !== undefined; const proOn = await expensesProOn(store, ctx);
  if (wantsPro && !proOn) throw new HttpError(402, "« Dépenses Pro » est réservé à la formule Pro ou supérieure.");
  const f = await clean(store, ctx, b); const amount = Number(f.amount); let source = String(f.source); const method = String(f.method);
  const st = await settings(store, ctx); const rights = await expenseRights(store, ctx); const canApprove = rights.includes("approve"); const owner = roleOf(ctx.roles) === "owner";
  const pre: ProPre | null = proOn ? await proPrecheck(store, ctx, { f, amount, b, canApprove, owner }) : null; const deferred = pre?.deferred === true; if (deferred) source = "external"; // paiement différé : l'origine du paiement se choisit à chaque paiement
  if (source === "till" && method !== "cash") throw new HttpError(400, "Une dépense payée depuis la caisse est forcément en espèces");
  const human = !!pre && (pre.reasons.length > 0 || pre.levels.length > 0); // une autorisation humaine est requise : jamais de validation automatique
  let override: { reasons: string[]; reason: string } | null = null;
  if (pre && pre.reasons.length) { if (pre.block && !owner) throw new HttpError(403, `BUDGET_BLOQUANT : ${pre.reasons.join(" ; ")}. Seul le propriétaire peut passer outre.`);
    if (owner) { const why = oneLine(b.overrideReason, 200); if (!(b.overrideBudget === true && why.length >= 5)) throw new HttpError(409, `BUDGET_DEPASSE : ${pre.reasons.join(" ; ")}. Confirmez le dépassement avec un motif (5 caractères min.).`); override = { reasons: pre.reasons, reason: why }; } }
  const ownerAuto = owner && human; // le propriétaire est l'autorité finale : il franchit tous les niveaux, tracé
  const awaitingCode = st.codeRequired && !canApprove; // le code d'un responsable remplace le justificatif : toute dépense saisie sans droit de valider l'attend
  const pending = !ownerAuto && (awaitingCode || human || needsApproval({ category: String(f.category), amount, threshold: st.threshold, sensitive: st.sensitive, canApprove }));
  let sess: Row | null = null; if (source === "till") { sess = await openSessionOf(store, ctx); if (!sess) throw new HttpError(409, "Ouvrez la caisse avant d'enregistrer une dépense payée depuis la caisse"); }
  let overdraft: Awaited<ReturnType<typeof checkBalance>> = null; if (sess && !pending) overdraft = await checkBalance(store, ctx, sess, amount, b, canApprove);
  if (!b.confirmDuplicate) { // même dépense saisie deux fois (requestId différent) : confirmation explicite exigée
    const since = Date.now() - 10 * 60_000; const rows = (await store.scan("expenses", { tenantId: ctx.tenantId, shopId: ctx.shopId, createdBy: ctx.userId }, { maxRows: 300 })).rows;
    const twin = rows.find((r) => r.status !== "cancelled" && r.status !== "rejected" && Number(r.amount) === amount && String(r.spentOn) === f.spentOn && String(r.label).toLowerCase() === String(f.label).toLowerCase() && String(r.beneficiary ?? "").toLowerCase() === String(f.beneficiary ?? "").toLowerCase() && Date.parse(iso(r.$createdAt) || new Date().toISOString()) >= since);
    if (twin) throw new HttpError(409, `DOUBLON_POSSIBLE : une dépense identique (${twin.number}) vient d'être enregistrée. Confirmez si c'est une autre dépense.`);
  }
  const now = new Date().toISOString(); const number = `D-${now.slice(0, 10).replace(/-/g, "")}-${id.slice(2, 8).toUpperCase()}`; const status = pending ? "pending" : "approved";
  const levels: Tier[] = pre?.levels.length ? pre.levels : ["manager"]; const approvals: Approval[] = ownerAuto ? levels.map(() => ({ by: ctx.userId, tier: "owner" as const, at: now, via: "decision" as const })) : [];
  const meta: Record<string, unknown> = { recordedAt: now, levels, approvals, ...(b.methodLabel ? { methodLabel: oneLine(b.methodLabel, 40) } : {}), ...(overdraft ? { overdraft } : {}), ...(override ? { override } : {}), ...(pre?.reasons.length ? { proReasons: pre.reasons } : {}), ...(pre?.flags.length ? { flags: pre.flags } : {}), ...(pre?.allocations ? { allocations: pre.allocations, allocRule: pre.allocRule } : {}),
    ...(awaitingCode ? { awaitingCode: true, codeSeq: 0, codeFails: 0, codeExpiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), approvalReason: "code de validation du responsable" } : pending ? { approvalReason: pre?.reasons.length ? "budget ou plafond dépassé" : human ? "circuit d'approbation" : st.sensitive.includes(String(f.category)) ? "catégorie sensible" : `montant ≥ seuil (${fcfa(st.threshold)})` } : { autoApproved: canApprove }) };
  const row = { ...f, source, tenantId: ctx.tenantId, shopId: ctx.shopId, number, status, createdBy: ctx.userId, sessionId: sess?.$id ?? "", receipts: "[]", meta: JSON.stringify(meta), ...(!pending ? { decidedBy: ctx.userId } : {}), ...(sess && !pending ? { movementId: `cm${sha(`${id}|out`).slice(0, 28)}` } : {}), ...(pre ? applyProCreate(pre, f) : {}) };
  const ops: BatchOp[] = [{ kind: "create", table: "expenses", id, tenantId: ctx.tenantId, data: row }, ev(ctx, id, "create", { amount, category: f.category, source, status, ...(deferred ? { payMode: "deferred", dueOn: pre?.dueOn } : {}), ...(pre?.reasons.length ? { reasons: pre.reasons } : {}), ...(overdraft ? { overdraft } : {}) }, now, "create"), aud(ctx, "expense.create", `${number} ${amount} ${String(f.label)} (${status})`)];
  if (!pending) ops.push(ev(ctx, id, "approve", { auto: !ownerAuto, ...(ownerAuto ? { levels: levels.length, override } : {}), by: ctx.userId }, now, "approve"));
  if (sess && !pending) ops.push(moveOp(ctx, { id, number, label: String(f.label), beneficiary: String(f.beneficiary ?? ""), amount }, sess.$id, "out", `Dépense ${number} — ${String(f.label)}`, "out"));
  try { await store.batch(ops); } catch (e) { const again = await store.get("expenses", id); if (again && again.tenantId === ctx.tenantId) return { id, number: String(again.number), status: String(again.status), duplicate: true }; throw e; }
  if (sess && !pending && (await isProPos(store, ctx))) await ledgerWrite(store, ctx, { kind: "cash_out", ref: `${number}`, key: `${id}|out`, amount: -amount, at: now, sessionId: sess.$id, payload: { expense: number, label: String(f.label) } });
  return { id, number, status, duplicate: false, awaitingCode, ...(awaitingCode ? { codeExpiresAt: (meta as { codeExpiresAt?: string }).codeExpiresAt } : {}), ...(overdraft ? { overdraft } : {}), ...(pre ? { alerts: pre.alerts, levels } : {}) };
}

const SNAP = ["label", "description", "category", "amount", "spentOn", "method", "reference", "beneficiary", "supplierId", "source"] as const;
export async function updateExpense(store: Store, ctx: Ctx, b: Input & { id?: string }) {
  await gate(store, ctx); const r = await store.get("expenses", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Dépense introuvable");
  const rights = await expenseRights(store, ctx); const own = r.createdBy === ctx.userId;
  if (r.status === "rejected" || r.status === "cancelled") throw new HttpError(409, "Une dépense rejetée ou annulée ne se modifie plus (son historique est conservé)");
  if (r.status === "pending" ? !(own || rights.includes("modify")) : !rights.includes("modify")) throw new HttpError(403, r.status === "pending" ? "Seul l'auteur ou un responsable peut modifier cette dépense" : "Droit manquant : Modifier une dépense");
  const patch = await clean(store, ctx, b, true); delete patch.source; const locked = ["amount", "spentOn", "method"] as const;
  if (r.status === "approved") { for (const k of locked) if (patch[k] !== undefined && String(patch[k]) !== String(r[k])) throw new HttpError(409, "Le montant, la date et le moyen de paiement d'une dépense validée ne se modifient pas : annulez-la puis enregistrez-en une nouvelle"); }
  if (patch.method !== undefined && r.source === "till" && patch.method !== "cash") throw new HttpError(400, "Une dépense payée depuis la caisse est en espèces");
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; for (const k of SNAP) if (patch[k] !== undefined && String(patch[k]) !== String(r[k] ?? "")) { before[k] = r[k] ?? ""; after[k] = patch[k]; }
  if (b.methodLabel !== undefined) { const meta = parse<Record<string, unknown>>(r.meta, {}); meta.methodLabel = oneLine(b.methodLabel, 40); (patch as Record<string, unknown>).meta = JSON.stringify(meta); }
  if (!Object.keys(after).length && patch.meta === undefined) return { id: r.$id, unchanged: true };
  const now = new Date().toISOString(); const data = { ...patch }; for (const k of Object.keys(data)) if (!(SNAP as readonly string[]).includes(k) && k !== "meta") delete data[k];
  await store.batch([{ kind: "update", table: "expenses", id: r.$id, data }, ev(ctx, r.$id, "update", { before, after }, now), aud(ctx, "expense.update", `${r.number} ${Object.keys(after).join(",")}`)]); return { id: r.$id, changed: Object.keys(after) };
}

export async function decideExpense(store: Store, ctx: Ctx, b: { id?: string; approve?: boolean; note?: string; allowOverdraft?: boolean; overdraftReason?: string }) {
  await gate(store, ctx); await needR(store, ctx, "approve"); const r = await store.get("expenses", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Dépense introuvable");
  if (r.status !== "pending") throw new HttpError(409, `Dépense déjà ${r.status === "approved" ? "validée" : r.status === "rejected" ? "rejetée" : "annulée"}`);
  if (r.createdBy === ctx.userId && roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Vous ne pouvez pas valider votre propre dépense");
  const note = oneLine(b.note, 200); const now = new Date().toISOString(); const meta = parse<Record<string, unknown>>(r.meta, {}); const amount = Number(r.amount);
  if (b.approve === false) { if (note.length < 3) throw new HttpError(400, "Motif du rejet obligatoire (3 caractères au moins)"); meta.decisionNote = note;
    await store.batch([{ kind: "update", table: "expenses", id: r.$id, data: { status: "rejected", decidedBy: ctx.userId, meta: JSON.stringify(meta) } }, ev(ctx, r.$id, "reject", { note }, now), aud(ctx, "expense.reject", `${r.number} ${note}`)]); return { id: r.$id, status: "rejected" }; }
  return advance(store, ctx, r, meta, { id: ctx.userId, tier: roleOf(ctx.roles) === "owner" ? "owner" : "manager" }, "decision", note, b);
}
/** Franchit un niveau du circuit d'approbation (un seul niveau par défaut). Tant que tous les niveaux ne sont pas validés, la dépense reste en attente : aucun effet sur la caisse. Le propriétaire franchit tous les niveaux restants (tracé). */
async function advance(store: Store, ctx: Ctx, r: Row, meta: Record<string, unknown>, who: { id: string; tier: Tier }, via: "decision" | "code", note: string, od: { allowOverdraft?: boolean; overdraftReason?: string }) {
  const levels = (meta.levels as Tier[] | undefined) ?? ["manager"]; const approvals = (meta.approvals as Approval[] | undefined) ?? []; const nl = nextLevel(levels, approvals, who); if ("error" in nl) throw new HttpError(403, nl.error);
  const now = new Date().toISOString(); const add = who.tier === "owner" ? levels.length - approvals.length : 1; const next = [...approvals, ...Array.from({ length: add }, () => ({ by: who.id, tier: who.tier, at: now, via }))]; meta.approvals = next;
  if (next.length < levels.length) { await store.batch([{ kind: "update", table: "expenses", id: r.$id, data: { meta: JSON.stringify(meta) } }, ev(ctx, r.$id, "approve_level", { level: next.length, of: levels.length, approver: who.id, via, note }, now), aud(ctx, "expense.approve.level", `${r.number} ${next.length}/${levels.length}`)]); return { id: r.$id, status: "pending", level: next.length, of: levels.length }; }
  return approveRow(store, ctx, r, meta, note, od, via === "code", who.id);
}
/** Validation effective (par décision d'un responsable ou par saisie de son code) : même écriture atomique dans les deux cas. */
async function approveRow(store: Store, ctx: Ctx, r: Row, meta: Record<string, unknown>, note: string, od: { allowOverdraft?: boolean; overdraftReason?: string }, byCode: boolean, approver = "") {
  const now = new Date().toISOString(); const amount = Number(r.amount); const ops: BatchOp[] = []; let overdraft: Awaited<ReturnType<typeof checkBalance>> = null; let movementId = "";
  if (r.source === "till" && String(r.payMode ?? "immediate") !== "deferred") { // la sortie n'entre dans la caisse qu'à la validation, dans la session d'origine, si elle est encore ouverte
    const sess = await store.get("cash_sessions", String(r.sessionId)); if (!sess || sess.status !== "open") throw new HttpError(409, "La session de caisse de cette dépense est fermée : rejetez-la et faites-la ressaisir, ou annulez-la");
    overdraft = await checkBalance(store, ctx, sess, amount, byCode ? {} : od, !byCode); const mv = moveOp(ctx, { id: r.$id, number: String(r.number), label: String(r.label), beneficiary: String(r.beneficiary ?? ""), amount }, sess.$id, "out", `Dépense ${r.number} — ${r.label}`, "out", byCode ? approver : ctx.userId); movementId = mv.id; ops.push(mv);
  }
  if (note) meta.decisionNote = note; if (overdraft) meta.overdraft = overdraft; if (byCode) { meta.validatedByCode = true; meta.validatedAt = now; } delete meta.awaitingCode;
  ops.unshift({ kind: "update", table: "expenses", id: r.$id, data: { status: "approved", decidedBy: byCode ? approver : ctx.userId, ...(movementId ? { movementId } : {}), meta: JSON.stringify(meta) } }); ops.push(ev(ctx, r.$id, "approve", { method: byCode ? "code" : "decision", ...(byCode ? { approver } : {}), note, ...(overdraft ? { overdraft } : {}) }, now), aud(ctx, byCode ? "expense.approve.code" : "expense.approve", `${r.number} ${amount}`));
  await store.batch(ops); // conflit (double validation simultanée) → 409 : une seule sortie de caisse
  if (movementId && (await isProPos(store, ctx))) await ledgerWrite(store, ctx, { kind: "cash_out", ref: String(r.number), key: `${r.$id}|out`, amount: -amount, at: now, sessionId: String(r.sessionId), payload: { expense: r.number, label: r.label, ...(byCode ? { validatedBy: approver, via: "code" } : {}) } });
  return { id: r.$id, status: "approved", ...(overdraft ? { overdraft } : {}) };
}

// ------------------------------------------------------------------ code de validation (remplace le justificatif)
/** Code dérivé par le serveur (HMAC) : propre à CHAQUE responsable (son identifiant entre dans le calcul, donc le code saisi dit qui a validé) et lié à CETTE dépense (montant, libellé, catégorie, origine, auteur) et à son numéro d'émission. Jamais stocké, jamais renvoyé au vendeur : seul un responsable (droit « valider ») peut le lire. Modifier la dépense, ou le renouveler, change le code. */
export function expenseCode(tenantId: string, r: { id: string; amount: unknown; category: unknown; label: unknown; source: unknown; createdBy: unknown }, seq: number, approverId: string): string {
  const h = createHmac("sha256", secret()).update(`EXPCODE|${tenantId}|${r.id}|${Number(r.amount)}|${String(r.category)}|${String(r.label)}|${String(r.source)}|${String(r.createdBy)}|${seq}|${approverId}`).digest(); return Array.from({ length: 8 }, (_, i) => CODE_ALPHABET[h[i]! % 32]).join("");
}
/** Responsables habilités à valider dans cette boutique (propriétaires + employés avec le droit « valider »), hors auteur (sauf propriétaire). */
async function approverIds(store: Store, ctx: Ctx, creator: string): Promise<Map<string, Tier>> {
  const out = new Map<string, Tier>(); try { for (const o of await store.listOwners(ctx.tenantId)) out.set(o.userId, "owner"); } catch { /* annuaire indisponible */ }
  for (const st of (await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows) { if (st.active === false || !parse<string[]>(st.shopIds, []).includes(ctx.shopId)) continue; const rights = st.expenseRights != null && String(st.expenseRights) !== "" ? parse<string[]>(st.expenseRights, []) : [...(DEFAULT_EXPENSE_RIGHTS[String(st.role)] ?? [])]; if (rights.includes("approve") && !out.has(String(st.userId))) out.set(String(st.userId), "manager"); }
  const owners = new Set<string>(); try { for (const o of await store.listOwners(ctx.tenantId)) owners.add(o.userId); } catch { /* idem */ } if (!owners.has(creator)) out.delete(creator); return out;
}
const awaiting = async (store: Store, ctx: Ctx, id: unknown) => {
  const r = await store.get("expenses", String(id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Dépense introuvable"); const meta = parse<Record<string, unknown>>(r.meta, {});
  if (r.status !== "pending" || meta.awaitingCode !== true) throw new HttpError(409, "Cette dépense n'attend pas de code de validation"); return { r, meta };
};
/** Le responsable consulte le code (pour le communiquer au vendeur). Qui l'a consulté est tracé ; l'auteur de la dépense ne peut pas voir son propre code (sauf propriétaire). */
export async function showExpenseCode(store: Store, ctx: Ctx, b: { id?: string }) {
  await gate(store, ctx); await needR(store, ctx, "approve"); const { r, meta } = await awaiting(store, ctx, b.id);
  if (r.createdBy === ctx.userId && roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Vous ne pouvez pas consulter le code de votre propre dépense");
  const seq = Number(meta.codeSeq ?? 0); const exp = String(meta.codeExpiresAt ?? ""); const expired = !!exp && Date.parse(exp) < Date.now(); const failsLeft = Math.max(0, CODE_MAX_FAILS - Number(meta.codeFails ?? 0));
  if (expired || failsLeft === 0) return { usable: false, reason: expired ? "Code expiré : renouvelez-le" : "Trop d'essais incorrects : renouvelez le code", expiresAt: exp, failsLeft };
  const seen = (await store.list("expense_events", { expenseId: r.$id, kind: "code_viewed" }, 200)).some((e) => e.userId === ctx.userId && parse<{ seq?: number }>(e.detail, {}).seq === seq);
  if (!seen) await store.batch([ev(ctx, r.$id, "code_viewed", { seq }), aud(ctx, "expense.code.view", `${r.number}`)]);
  return { usable: true, code: formatCode(expenseCode(ctx.tenantId, { id: r.$id, amount: r.amount, category: r.category, label: r.label, source: r.source, createdBy: r.createdBy }, seq, ctx.userId)), expiresAt: exp, failsLeft, number: String(r.number) };
}
/** Nouveau code (l'ancien devient invalide) : expiration repartie, compteur d'essais remis à zéro. */
export async function renewExpenseCode(store: Store, ctx: Ctx, b: { id?: string }) {
  await gate(store, ctx); await needR(store, ctx, "approve"); const { r, meta } = await awaiting(store, ctx, b.id);
  if (r.createdBy === ctx.userId && roleOf(ctx.roles) !== "owner") throw new HttpError(403, "Vous ne pouvez pas renouveler le code de votre propre dépense");
  meta.codeSeq = Number(meta.codeSeq ?? 0) + 1; meta.codeFails = 0; meta.codeExpiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await store.batch([{ kind: "update", table: "expenses", id: r.$id, data: { meta: JSON.stringify(meta) } }, ev(ctx, r.$id, "code_renewed", { seq: meta.codeSeq }), aud(ctx, "expense.code.renew", `${r.number}`)]); return { id: r.$id, expiresAt: meta.codeExpiresAt };
}
/** Le vendeur saisit le code que lui a donné le responsable : la dépense est validée (et la sortie de caisse écrite) dans la même transaction que pour une validation en ligne. */
export async function validateExpenseCode(store: Store, ctx: Ctx, b: { id?: string; code?: string }) {
  await gate(store, ctx); await needR(store, ctx, "create"); const { r, meta } = await awaiting(store, ctx, b.id);
  if (r.createdBy !== ctx.userId) throw new HttpError(403, "Seul l'auteur de la dépense peut saisir son code de validation");
  const exp = String(meta.codeExpiresAt ?? ""); if (exp && Date.parse(exp) < Date.now()) throw new HttpError(409, "Code expiré : demandez au responsable de le renouveler");
  const fails = Number(meta.codeFails ?? 0); if (fails >= CODE_MAX_FAILS) throw new HttpError(409, "Trop d'essais incorrects : demandez au responsable de renouveler le code");
  const given = normalizeCode(b.code); const seq = Number(meta.codeSeq ?? 0); let approver = ""; let approverTier: Tier = "manager";
  if (isCodeShape(given)) for (const [uid, tr] of await approverIds(store, ctx, String(r.createdBy))) { const good = expenseCode(ctx.tenantId, { id: r.$id, amount: r.amount, category: r.category, label: r.label, source: r.source, createdBy: r.createdBy }, seq, uid); if (timingSafeEqual(Buffer.from(given), Buffer.from(good)) && !approver) { approver = uid; approverTier = tr; } } // tous les candidats sont comparés (temps constant par comparaison)
  if (!approver) { meta.codeFails = fails + 1; await store.batch([{ kind: "update", table: "expenses", id: r.$id, data: { meta: JSON.stringify(meta) } }, ev(ctx, r.$id, "code_failed", { left: CODE_MAX_FAILS - fails - 1 }), aud(ctx, "expense.code.fail", `${r.number}`)]); throw new HttpError(403, `Code incorrect (${CODE_MAX_FAILS - fails - 1} essai(s) restant(s))`); }
  meta.validatedBy = approver; // le responsable dont le code a été saisi : connu et tracé
  return advance(store, ctx, r, meta, { id: approver, tier: approverTier }, "code", "", {});
}

/** Annulation = opération corrective tracée : la dépense passe « annulée » (jamais supprimée) ; si elle avait sorti des espèces d'une session encore ouverte, une entrée de régularisation est écrite dans cette session. */
export async function cancelExpense(store: Store, ctx: Ctx, b: { id?: string; reason?: string }) {
  await gate(store, ctx); const r = await store.get("expenses", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Dépense introuvable");
  const rights = await expenseRights(store, ctx); if (!(rights.includes("cancel") || (r.status === "pending" && r.createdBy === ctx.userId))) throw new HttpError(403, "Droit manquant : Annuler une dépense");
  const reason = oneLine(b.reason, 200); if (reason.length < 3) throw new HttpError(400, "Motif d'annulation obligatoire (3 caractères au moins)");
  if (r.status === "cancelled") throw new HttpError(409, "Dépense déjà annulée"); if (String(r.payMode ?? "immediate") === "deferred" && Number(r.paidAmount ?? 0) > 0) throw new HttpError(409, "Des paiements ont déjà été enregistrés sur cette dépense : elle ne peut plus être annulée (le solde restant peut être soldé ou la dépense corrigée)"); if (r.status === "rejected") throw new HttpError(409, "Une dépense rejetée est déjà sans effet");
  const meta = parse<Record<string, unknown>>(r.meta, {}); meta.cancelReason = reason; const now = new Date().toISOString(); const ops: BatchOp[] = []; let refund: string | null = null;
  if (r.status === "approved" && r.source === "till" && r.movementId) { const sess = await store.get("cash_sessions", String(r.sessionId)); if (sess && sess.status === "open") { const mv = moveOp(ctx, { id: r.$id, number: String(r.number), label: String(r.label), beneficiary: String(r.beneficiary ?? ""), amount: Number(r.amount) }, sess.$id, "in", `Annulation dépense ${r.number} — ${reason}`, "cancel"); ops.push(mv); refund = mv.id; } else meta.noCashReturn = "session fermée : aucun mouvement de caisse automatique"; }
  ops.unshift({ kind: "update", table: "expenses", id: r.$id, data: { status: "cancelled", meta: JSON.stringify({ ...meta, cancelledBy: ctx.userId, cancelledAt: now }) } }); ops.push(ev(ctx, r.$id, "cancel", { reason, previous: r.status, cashReturned: !!refund, ...(meta.noCashReturn ? { note: meta.noCashReturn } : {}) }, now, "cancel"), aud(ctx, "expense.cancel", `${r.number} ${reason}`));
  await store.batch(ops); if (refund && (await isProPos(store, ctx))) await ledgerWrite(store, ctx, { kind: "cash_in", ref: String(r.number), key: `${r.$id}|cancel`, amount: Number(r.amount), at: now, sessionId: String(r.sessionId), payload: { cancel: r.number, reason } });
  return { id: r.$id, status: "cancelled", cashReturned: !!refund, ...(meta.noCashReturn ? { note: String(meta.noCashReturn) } : {}) };
}

/** Les justificatifs (photo/PDF) sont REMPLACÉS par le code de validation du responsable : plus aucune nouvelle pièce jointe. Les pièces déjà enregistrées restent lisibles dans le détail (l'historique financier n'est jamais supprimé). */
export async function addReceipt(store: Store, ctx: Ctx, _b: { id?: string; name?: string; data?: string }) {
  await gate(store, ctx); throw new HttpError(410, "Les justificatifs sont remplacés par le code de validation du responsable : aucune nouvelle pièce jointe. Les justificatifs déjà enregistrés restent consultables.");
}

// ------------------------------------------------------------------ rapport
const sumBy = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => { const m = new Map<string, { total: number; count: number }>(); for (const r of rows) { const k = key(r); const a = m.get(k) ?? { total: 0, count: 0 }; a.total += val(r); a.count++; m.set(k, a); } return m; };
export async function expenseReport(store: Store, ctx: Ctx, b: { from?: string; to?: string; shopId?: string } = {}) {
  await gate(store, ctx); await needR(store, ctx, "view"); const st = await settings(store, ctx); const shops = await shopScope(store, ctx, b.shopId); const today = todayIn(new Date(), st.tz);
  const to = b.to && isDay(b.to) ? b.to : today; const from = b.from && isDay(b.from) ? b.from : `${today.slice(0, 8)}01`; const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  if (span < 1 || span > 366) throw new HttpError(400, "Période invalide (366 jours maximum)"); const prevTo = new Date(Date.parse(`${from}T00:00:00Z`) - DAY).toISOString().slice(0, 10); const prevFrom = new Date(Date.parse(`${prevTo}T00:00:00Z`) - (span - 1) * DAY).toISOString().slice(0, 10);
  const shopRows = new Map<string, Row>(); for (const id of shops) { const s = await store.get("shops", id.slice(0, 36)); if (s) shopRows.set(id, s); }
  const load = async (f: string, t: string) => { const rows: Row[] = []; for (const sh of shops) rows.push(...(await store.scan("expenses", { tenantId: ctx.tenantId, shopId: sh }, { range: { field: "spentOn", from: dayToStored(f), to: `${t}T23:59:59.999Z` }, maxRows: 10_000 })).rows); return rows; };
  const rows = await load(from, to); const prev = await load(prevFrom, prevTo); const ok = rows.filter((r) => r.status === "approved"); const okPrev = prev.filter((r) => r.status === "approved"); const total = ok.reduce((a, r) => a + Number(r.amount), 0); const totalPrev = okPrev.reduce((a, r) => a + Number(r.amount), 0);
  const month = today.slice(0, 7); const allShopRows: Row[] = []; for (const sh of shops) allShopRows.push(...(await store.scan("expenses", { tenantId: ctx.tenantId, shopId: sh, status: "approved" }, { range: { field: "spentOn", from: dayToStored(`${month}-01`), to: `${today}T23:59:59.999Z` }, maxRows: 10_000 })).rows);
  const todayTotal = allShopRows.filter((r) => storedToDay(String(r.spentOn)) === today).reduce((a, r) => a + Number(r.amount), 0); const monthTotal = allShopRows.reduce((a, r) => a + Number(r.amount), 0);
  const pend = rows.filter((r) => r.status === "pending"); const pendAll: Row[] = []; for (const sh of shops) pendAll.push(...(await store.scan("expenses", { tenantId: ctx.tenantId, shopId: sh, status: "pending" }, { maxRows: 2000 })).rows);
  const names = await nameMap(store, ctx); const cat = [...sumBy(ok, (r) => String(r.category), (r) => Number(r.amount))].map(([k, v]) => ({ key: k, ...v })).sort((a, c) => c.total - a.total);
  const meth = [...sumBy(ok, (r) => String(r.method), (r) => Number(r.amount))].map(([k, v]) => ({ key: k, ...v })).sort((a, c) => c.total - a.total); const src = [...sumBy(ok, (r) => String(r.source), (r) => Number(r.amount))].map(([k, v]) => ({ key: k, ...v }));
  const byShop = [...sumBy(ok, (r) => String(r.shopId), (r) => Number(r.amount))].map(([k, v]) => ({ shopId: k, shop: String(shopRows.get(k)?.name ?? k), ...v })).sort((a, c) => c.total - a.total);
  const byDay = [...sumBy(ok, (r) => storedToDay(String(r.spentOn)), (r) => Number(r.amount))].map(([day, v]) => ({ day, ...v })).sort((a, c) => a.day.localeCompare(c.day));
  // sorties d'espèces par session de caisse (dépenses : sorties moins annulations)
  const mv: Row[] = []; for (const sh of shops) mv.push(...(await store.scan("cash_movements", { tenantId: ctx.tenantId, shopId: sh }, { range: { field: "at", from: boundsOf(from, to, st.tz).gte, to: boundsOf(from, to, st.tz).lt }, maxRows: 20_000 })).rows);
  const sessMap = new Map<string, { sessionId: string; expenseOut: number; otherOut: number; cashIn: number }>(); for (const m of mv) { if (m.status !== "authorized") continue; const a = sessMap.get(String(m.sessionId)) ?? { sessionId: String(m.sessionId), expenseOut: 0, otherOut: 0, cashIn: 0 }; const amt = Number(m.amount); if (m.kind === "out") (m.expenseId ? (a.expenseOut += amt) : (a.otherOut += amt)); else if (m.expenseId) a.expenseOut -= amt; else a.cashIn += amt; sessMap.set(a.sessionId, a); }
  const sessions = []; for (const a of sessMap.values()) { const s = await store.get("cash_sessions", a.sessionId); sessions.push({ ...a, seller: names.get(String(s?.userId)) ?? "", register: String(s?.register ?? ""), openedAt: iso(s?.openedAt), status: String(s?.status ?? "") }); } sessions.sort((a, c) => c.openedAt.localeCompare(a.openedAt));
  // résultat : jamais présenté sans les données nécessaires
  const { gte, lt } = boundsOf(from, to, st.tz); const sales: Row[] = []; for (const sh of shops) sales.push(...(await store.scan("sales", { tenantId: ctx.tenantId, shopId: sh, status: "paid" }, { range: { field: "soldAt", from: gte, to: lt }, maxRows: 50_000 })).rows);
  let revenueTtc = 0, vat = 0, costKnown = 0, netKnown = 0, netAll = 0; for (const s of sales) { revenueTtc += Number(s.total); vat += Number(s.vat ?? 0); for (const l of parse<{ productId: string; name: string; unitPrice: number; qty: number; discountPct?: number; amount?: number; unitCost?: number }[]>(s.lines, [])) { const n = lineTotal(l as never); netAll += n; if (l.unitCost) { netKnown += n; costKnown += Math.round(l.unitCost * l.qty); } } }
  const reasons: string[] = []; if (!sales.length) reasons.push("aucune vente sur la période"); if (netAll > 0 && netKnown < netAll) reasons.push(`coût d'achat inconnu pour ${Math.round((1 - netKnown / netAll) * 100)} % du chiffre d'affaires`); if (pend.length) reasons.push(`${pend.length} dépense(s) en attente de validation`);
  const marginHt = Math.round(netKnown - costKnown - (netAll > 0 ? (vat * netKnown) / netAll : 0)); const net = reasons.length ? { available: false, reasons, value: null as number | null } : { available: true, reasons: [] as string[], value: marginHt - total };
  const report = { from, to, previous: { from: prevFrom, to: prevTo }, totals: { today: todayTotal, month: monthTotal, period: total, previousPeriod: totalPrev, deltaPct: totalPrev > 0 ? Math.round(((total - totalPrev) / totalPrev) * 1000) / 10 : null, count: ok.length, cancelled: rows.filter((r) => r.status === "cancelled").length, rejected: rows.filter((r) => r.status === "rejected").length }, pending: { count: pendAll.length, amount: pendAll.reduce((a, r) => a + Number(r.amount), 0) }, byCategory: cat, byMethod: meth, bySource: src, byShop, byDay, cashSessions: sessions,
    figures: { revenueTtc, encaissements: null, expenses: total, grossMarginHt: reasons.some((x) => x.startsWith("coût")) || !sales.length ? null : marginHt }, net, notes: ["Dépenses = dépenses VALIDÉES à leur date de dépense ; les dépenses en attente, rejetées ou annulées ne sont pas comptées.", "Chiffre d'affaires, dépenses, marge brute et résultat sont des notions distinctes : le résultat = marge brute HT − dépenses, affiché seulement si le coût d'achat de toutes les ventes est connu et qu'aucune dépense n'est en attente.", "Les montants de dépenses sont pris tels que saisis (TVA non séparée). Les achats de marchandises sont déjà dans le coût de la marge."] };
  const label = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.label ?? id; const mlab = (id: string) => METHODS.find((m) => m.id === id)?.label ?? id;
  const exportData: ReportData = { title: "Dépenses", generatedAt: new Date().toLocaleString("fr-FR"), tz: st.tz, period: { from, to }, scope: [...shopRows.values()].map((s) => String(s.name)), filters: {}, notes: report.notes, sections: [
    { name: "Synthèse", columns: ["Indicateur", "Montant (FCFA)"], rows: [["Dépenses validées sur la période", total], ["Période précédente", totalPrev], ["Dépenses en attente (hors total)", report.pending.amount]] },
    { name: "Par catégorie", columns: ["Catégorie", "Nombre", "Montant (FCFA)"], rows: cat.map((c) => [label(c.key), c.count, c.total]) }, { name: "Par moyen de paiement", columns: ["Moyen", "Nombre", "Montant (FCFA)"], rows: meth.map((c) => [mlab(c.key), c.count, c.total]) },
    { name: "Par boutique", columns: ["Boutique", "Nombre", "Montant (FCFA)"], rows: byShop.map((c) => [c.shop, c.count, c.total]) }, { name: "Sorties d'espèces par session", columns: ["Session", "Vendeur", "Caisse", "Dépenses payées en caisse", "Autres sorties"], rows: sessions.map((s) => [s.openedAt.slice(0, 16).replace("T", " "), s.seller, s.register, s.expenseOut, s.otherOut]) },
    { name: "Détail", columns: ["N°", "Date", "Libellé", "Catégorie", "Bénéficiaire", "Moyen", "Origine", "Statut", "Montant (FCFA)"], rows: rows.sort((a, c) => String(a.spentOn).localeCompare(String(c.spentOn))).map((r) => [String(r.number), storedToDay(String(r.spentOn)), String(r.label), label(String(r.category)), String(r.beneficiary ?? ""), mlab(String(r.method)), String(r.source) === "till" ? "Caisse" : "Compte externe", String(r.status), Number(r.amount)]) }] };
  return { ...report, export: exportData };
}

export { sha, newId, parse, iso, oneLine, fcfa, gate, needR, nameMap, view, settings, shopScope, ev, aud, moveOp, checkBalance, clean };
