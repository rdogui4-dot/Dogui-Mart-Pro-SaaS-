import { recoCfgSave as rcCfgSave, recoDecide as rcDecide, recoGenerate as rcGenerate, recoList as rcList } from "./master-reco";
import { profileConfirm as mpConfirm, profileDelete as mpDelete, profileGet as mpGet, profileSet as mpSet } from "./master-profile";
import { closingGet as mrClosing, opening as mrOpening, reportGet as mrGet, reportList as mrList } from "./master-reports";
import { eventDecide as mpEventDecide, eventsList as mpEvents, hookGet as mpHookGet, hookRotate as mpHookRotate, hookSave as mpHookSave, payList as mpPayList, payRequest as mpPayRequest } from "./master-pay";
import { license as mdLicense, platformActivate as mdActivate, platformList as mdList, platformTrial as mdPlatformTrial, trialStart as mdTrialStart } from "./master";
import { budgetRevise as ipBudgetRevise, config as ipConfig, configSave as ipConfigSave, financingArchive as ipFinArchive, financingSave as ipFinSave, itemPro as ipItemPro, placementView as ipPlacement, portfolio as ipPortfolio, projectView as ipProject, report as ipReport, trancheCancel as ipTrCancel, tranchePay as ipTrPay, trancheSave as ipTrSave, valueAdd as ipValueAdd, valueVoid as ipValueVoid } from "./invest-pro";
import { actualAdd as invActualAdd, actualVoid as invActualVoid, config as invConfig, configSave as invConfigSave, itemGet as invItemGet, itemList as invItemList, itemSave as invItemSave, itemStatus as invItemStatus, maturityDone as invMaturity, overview as invOverview, report as invReport, scenarioSave as invScenarioSave } from "./invest";
import { analytic as icpAnalytic, assetDispose as icpAssetDispose, assetList as icpAssetList, assetSave as icpAssetSave, closeGuide as icpCloseGuide, dimList as icpDimList, dimSave as icpDimSave, letterCandidates as icpLetterCandidates, letterCreate as icpLetterCreate, letterList as icpLetterList, letterUndo as icpLetterUndo, mapSave as icpMapSave, overview as icpOverview, pieceAdd as icpPieceAdd, pieceRemove as icpPieceRemove, pieceVerify as icpPieceVerify, proConfig as icpConfig, proConfigSave as icpConfigSave, proReport as icpReport, statements as icpStatements } from "./icompta-pro";
import { overview as icOverview, accounts as icAccounts, accountSave as icAccountSave, accountImport as icAccountImport, config as icConfig, configSave as icConfigSave, proposalList as icProposals, proposalCreate as icProposalCreate, entryList as icEntries, entryGet as icEntry, entrySave as icEntrySave, entrySubmit as icEntrySubmit, entryValidate as icEntryValidate, entryReject as icEntryReject, entryReverse as icEntryReverse, entryCorrect as icEntryCorrect, periodList as icPeriods, periodControls as icPeriodControls, periodClose as icPeriodClose, periodReopen as icPeriodReopen, verify as icVerify, ledger as icLedger, balance as icBalance, journal as icJournal, third as icThird, report as icReport } from "./icompta";
import { rulesGet, rulesSave, scenarioList, scenarioSave, planList, planSave, planApprove, planDone, planCancel, forecast, pbudgetSave, pbudgets, compare, ventilation, consolidated, reconcileAdvanced } from "./fin-pro";
import { claimList, claimDecide, creditList, creditCreate, creditApply, creditRefund, creditCancel } from "./purchasing-claims";
import { finAccounts, finAccountSave, finFlows, finTransfers, finTransferSave, finTransferConfirm, finTransferCancel, finReconcilePreview, finReconcileSave, finReconciliations, finDues, finBudgetSave, finBudgets, finDashboard, finReport } from "./fin";
import { stockAlerts, stockArticle, stockCorrect, stockDashboard, stockMoves, stockSettings, xferCancel, xferClose, xferGet, xferList, xferReceive, xferSave, xferShip } from "./stock-biz";
import { scountAlerts, scountAnalysis, scountAnomalies, scountAnomalyDecide, scountCampaignGet, scountCampaignList, scountCampaignSave, scountCampaignStart, scountCampaignTransfers, scountCampaignValidate, scountHistory, scountIdentify, scountPlanGenerate, scountPlanGet, scountPlanSave, scountPropose, scountReport, scountResolve, scountSecond, scountSuggest, scountZones } from "./inventory-pro";
import { supplierReturn } from "./purchasing-return";
import { inventoryAttach, inventoryCancel, inventoryClose, inventoryDecide, inventoryEntry, inventoryFinish, inventoryGet, inventoryHistory, inventoryList, inventoryRecount, inventoryReport, inventoryReview, inventorySave, inventoryStart, inventoryValidate } from "./inventory";
import { articlePurchaseView, purchasingDashboard } from "./purchasing-dash";
import { buildPaymentUrl, isExpired, isStaticTemplate, linkRef, normalizeTemplate, type QrProvider } from "../../../src/domain/payment-links";
import { toFcfa } from "../../../src/domain/money";
import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { trackingOf } from "../../../src/domain/tracking";
import { lotsWithStock } from "./tracking";
import { ACCOUNTS } from "../../../src/domain/accounting";
import { checkout, stockScaled, stockScaledVariant, type CheckoutInput } from "./checkout";
import { HttpError, need, type Ctx, type Row, type Store, needModule } from "./store";
import { createFreeInvoice, invoiceFromSale, payCustomerInvoice, saveShop } from "./invoicing";
import { consolidatedReport } from "./reports";
import { platformGrant, platformLifetime, platformMarkReminded, platformMe, platformPayments, platformRenewals, platformReview, platformSettingsGet, platformSettingsSave, subscriptionCheckout, subscriptionGet, subscriptionSubmitProof } from "./subscriptions";
import { createShop, createStaff, initTenant, resetStaffPassword, transferStock, updateStaff } from "./team";
import { saveUnits } from "./units";
import { deletePriceRule, savePriceRule } from "./pricing";
import { addSerials, assignLot, receiveLot, setSerialStatus, updateLot, writeOffLot } from "./tracking";
import { articleProfitability, deleteSupplierLink, saveSupplierLink } from "./costing";
import { archiveVariant, deleteVariant, saveVariant } from "./variants";
import { assembleKit, refuseBundle, saveComponents } from "./bundles";
import { ackAlerts, articleDashboard } from "./dashboard";
import { deletePromotion, listCoupons, promotionStats, saveCoupon, savePromoSettings, savePromotion, setPromotionStatus, setStoreRule } from "./promotions";
import { businessDashboard } from "./overview";
import { authorizeMovement, cashMovement, closeSession, currentSession, listSessions, openSession, sellerReport } from "./cashier";
import { getSale, listSales, refundSale } from "./returns";
import { decideApproval, listApprovals, myRights, requestApproval, setStaffRights, verifyLedger, checkVoucher, verifyReceipt } from "./pos-pro";
import { budgetStatus, convertPlan, generatePlans, listPayments, listPlans, payExpense, reallocateExpense, saveBudget, saveLimit, saveRecurring, saveRule, skipPlan, toggleConfig, cfgList, needPro } from "./expenses-pro";
import { proInsights, expensesProReport, saveBalance, treasuryView } from "./expenses-intel";
import { crmCustomer, crmCustomerSave, crmCustomers, crmDashboard, crmLead, crmLeadArchive, crmLeadConvert, crmLeadSave, crmLeadStage, crmLeads, crmNote, crmOwners, crmOppSave, crmOppStage, crmOpps, crmTaskCancel, crmTaskDone, crmTaskSave, crmTasks } from "./crm";
import { proAnalytics, proAssociations, proPerformance, proCampaign, proCampaignApprove, proCampaignClose, proCampaignSave, proCampaignStart, proCampaigns, proConsents, proInsight, proLoyalty, proLoyaltySave, proPortfolioAssign, proRuleSave, proRules, proRun, proRunRetry, proRuns, proSegmentPreview, proSegmentSave, proSegments, proSettings, proSettingsSave, proTargetContact, proTargetOptout, proTargetReply, proTargetRetry, proTargetSkip, proTeamSave, proTeams } from "./crm-pro";
import { proAnalysis, proAnomalies, proNetwork, proProducts, proReplenish, stockProReport, proSimulate } from "./stock-pro";
import { attach, invoiceDispute, invoiceGet, invoiceList, invoicePay, invoiceSave, invoiceConfirm, poAmend, poCancel, poClose, poGet, poList, poReject, poSave, poSubmit, poValidate, purchasingConfig, receiptCancel, receiptGet, receiptList, receiptSave, receiptValidate, supplierArchive, supplierDelete, supplierGet, supplierList, supplierSave } from "./purchasing-plus";
import { showExpenseCode, renewExpenseCode, validateExpenseCode, addReceipt, cancelExpense, createExpense, decideExpense, expenseCategories, expenseReport, getExpense, listExpenses, myExpenseRights, saveExpenseCategory, saveExpenseSettings, setExpenseRights, updateExpense } from "./expenses";
import { handover, validateVariance, correctSession, performance } from "./pos-register";
import { customerProfileSafe, insights, simulate, suggest } from "./pos-intel";
import { proDashboard, proOptions, proReport } from "./analytics";
import { listPromotions, promotionAnalytics, promotionJournal, promotionRecommendations } from "./promotions-pro";
import { isCategory } from "../../../src/domain/pricing";
import { archiveArticle, needFeature, deleteArticle, saveArticle, saveProduct, setArticleImage } from "./articles";
import { cancelPo, createPo, invoicePo, payInvoice, receivePo } from "./purchasing";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const must = <T,>(v: T | null | undefined, msg: string, status = 404): T => { if (v == null) throw new HttpError(status, msg); return v; };
const mine = (ctx: Ctx, r: Record<string, unknown> | null) => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;

// Champs modifiables par le client. creditBalance / points / annualSpend sont gérés par le serveur uniquement.
/** Actions de lecture / d'abonnement toujours permises, même quand l'abonnement est expiré. */
export const LOCK_EXEMPT = new Set(["report.consolidated", "subscription.get", "subscription.checkout", "subscription.submitProof", "tenant.init", "payments.settings.get", "payment_link.status", "md.license", "md.pay.list", "md.reports", "md.report", "md.profile", "md.reco.list"]);

const ENTITIES = {
  products: { module: "stock", fields: [] }, // géré par articles.ts
  customers: { module: "customers", fields: ["name", "phone", "creditLimit", "category"] },
  suppliers: { module: "purchases", fields: ["name", "phone", "email"] },
} as const;

export async function saveEntity(store: Store, ctx: Ctx, b: { table: keyof typeof ENTITIES; id?: string; data: Record<string, unknown> }) {
  const spec = Object.hasOwn(ENTITIES, String(b.table)) ? ENTITIES[b.table] : undefined; if (!spec) throw new HttpError(400, "Table non autorisée");
  needModule(ctx, spec.module);
  if (b.table === "customers" && b.data.creditLimit !== undefined) need(ctx, "manager"); // plafond de crédit = manager
  if (b.table === "customers" && b.data.category !== undefined) { // catégorie tarifaire (gros, revendeur) : décision de gérant, fonction Pro pour en attribuer une
    need(ctx, "manager");
    if (!isCategory(b.data.category)) throw new HttpError(400, "Catégorie de clients inconnue");
    if (b.data.category) await needFeature(store, ctx, "tieredPricing");
  }
  if (b.table === "products") return saveProduct(store, ctx, { id: b.id, data: b.data }); // un seul chemin d'écriture pour les articles
  const data: Record<string, unknown> = {};
  for (const f of spec.fields) if (f in b.data) data[f] = b.data[f];
  if (b.id) {
    const row = must(await store.get(b.table, b.id), "Introuvable");
    if (!mine(ctx, row)) throw new HttpError(403, "Accès refusé");
    await store.update(b.table, b.id, data);
    return { id: b.id };
  }
  const id = newId();
  const init = b.table === "customers" ? { creditBalance: 0, points: 0, annualSpend: 0 } : { balance: 0 };
  await store.create(b.table, id, ctx.tenantId, { ...init, ...data, tenantId: ctx.tenantId, shopId: ctx.shopId });
  return { id };
}

/** Inventaire : écrit un mouvement d'ajustement égal à l'écart, jamais un écrasement du stock. */
export async function adjustStock(store: Store, ctx: Ctx, b: { productId: string; variantId?: string; lotId?: string; counted: number | string }) {
  needModule(ctx, "stock");
  const p = must(await store.get("products", b.productId), "Produit introuvable");
  if (!mine(ctx, p)) throw new HttpError(403, "Accès refusé");
  refuseBundle(p, "son stock se déduit de ses composants, il ne se compte pas.", { allowKit: true });
  const scale = scaleOf(p);
  let counted: number;
  try { counted = String(b.counted).trim() === "0" ? 0 : qtyFor(b.counted, scale); } catch (e) { throw new HttpError(400, (e as Error).message); }
  let variant: Row | null = null;
  if (p.hasVariants) { // inventaire d'un article décliné : variante par variante
    variant = b.variantId ? await store.get("article_variants", b.variantId) : null;
    if (!variant || !mine(ctx, variant) || variant.productId !== p.$id) throw new HttpError(400, "Choisissez la variante à compter");
  } else if (b.variantId) throw new HttpError(400, "Cet article n'a pas de variantes");
  const mode = trackingOf(p); let lot: Row | null = null;
  if (mode === "serial") throw new HttpError(409, "Article suivi par numéro de série : le stock se corrige par le statut de chaque numéro (Séries)");
  if (mode === "lot") { // l'inventaire d'un article suivi par lot se fait lot par lot
    lot = b.lotId ? await store.get("article_lots", b.lotId) : null;
    if (!lot || !mine(ctx, lot) || lot.productId !== p.$id || String(lot.variantId ?? "") !== (variant?.$id ?? "")) throw new HttpError(400, "Choisissez le lot à compter");
  }
  const current = lot ? ((await lotsWithStock(store, ctx, p.$id, String(lot.variantId ?? ""))).find((x) => x.id === lot!.$id)?.qty ?? 0) : variant ? await stockScaledVariant(store, variant.$id) : await stockScaled(store, p.$id);
  const diff = scaledInt(counted, scale) - current; // écart en sous-unités : jamais un écrasement du stock
  if (diff !== 0) await store.create("stock_moves", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, ...(variant ? { variantId: variant.$id } : {}), ...(lot ? { lotId: lot.$id } : {}), qty: diff, kind: "adjust", refId: "inventaire", userId: ctx.userId });
  return { diff: fromScaled(diff, scale) };
}

export async function repayCredit(store: Store, ctx: Ctx, b: { customerId: string; amount: number; method: "cash" | "wave" | "orange"; repayId?: string }) {
  needModule(ctx, "pos");
  const c = must(await store.get("customers", b.customerId), "Client introuvable");
  if (!mine(ctx, c)) throw new HttpError(403, "Accès refusé");
  const amount = Math.min(toFcfa(b.amount), Number(c.creditBalance ?? 0));
  if (!(amount > 0)) throw new HttpError(400, "Rien à encaisser");
  const acct = { cash: ACCOUNTS.cash, wave: ACCOUNTS.wave, orange: ACCOUNTS.orange }[b.method]; if (!acct) throw new HttpError(400, "Mode invalide");
  // Identifiant fourni par l'appareil : un double appui ou un nouvel envoi après coupure n'encaisse jamais deux fois.
  const rid = String(b.repayId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 28); const id = rid.length >= 8 ? `r${rid}` : newId(); const ref = `R-${id.slice(0, 6).toUpperCase()}`, date = new Date().toISOString();
  const base = { tenantId: ctx.tenantId, shopId: ctx.shopId, ref, date };
  if (!(await store.create("journal_entries", `${id}_j0`, ctx.tenantId, { ...base, account: acct, debit: amount, credit: 0, label: `Remboursement crédit ${c.name}` }))) { const j = await store.get("journal_entries", `${id}_j0`); if (!mine(ctx, j)) throw new HttpError(409, "Demande déjà utilisée"); return { repaid: amount, balance: Number(c.creditBalance), duplicate: true }; }
  const balance = Number(c.creditBalance) - amount;
  await store.update("customers", c.$id, { creditBalance: balance });
  await store.create("journal_entries", `${id}_j1`, ctx.tenantId, { ...base, account: ACCOUNTS.customers, debit: 0, credit: amount, label: `Remboursement crédit ${c.name}` });
  return { repaid: amount, balance };
}

// ---------- Paiements par lien / QR code (Wave Business, Orange Business) ----------
export async function savePaymentSettings(store: Store, ctx: Ctx, b: { waveTemplate?: string; orangeTemplate?: string; expiryMinutes?: number }) {
  need(ctx, "owner");
  // Faute de saisie = réponse 400 claire (jamais « Erreur interne »). Un modèle accepté est testé avec un montant et une référence d'essai.
  const norm: { waveTemplate?: string; orangeTemplate?: string } = {}; const converted: string[] = [];
  for (const [key, provider, label] of [["waveTemplate", "wave", "Wave Business"], ["orangeTemplate", "orange", "Orange Business"]] as const) {
    const raw = b[key]; if (!raw) continue;
    try { const n = normalizeTemplate(raw, provider); buildPaymentUrl(n.template, { amount: 1, ref: "TEST" }, provider === "orange"); norm[key] = n.template; if (n.converted) converted.push(provider); }
    catch (e) { throw new HttpError(400, `Lien ${label} : ${(e as Error).message}`); }
  }
  const id = ctx.shopId.slice(0, 36);
  const prev = await store.get("payment_settings", id);
  // Un champ absent conserve la valeur existante ; une chaîne vide désactive l'opérateur.
  const data = {
    tenantId: ctx.tenantId, shopId: ctx.shopId,
    waveTemplate: norm.waveTemplate ?? (b.waveTemplate === "" ? "" : prev?.waveTemplate ?? ""), orangeTemplate: norm.orangeTemplate ?? (b.orangeTemplate === "" ? "" : prev?.orangeTemplate ?? ""),
    expiryMinutes: Math.min(Math.max(Number(b.expiryMinutes) || Number(prev?.expiryMinutes) || 15, 1), 1440),
  };
  if (!(await store.create("payment_settings", id, ctx.tenantId, data))) await store.update("payment_settings", id, data);
  return { ok: true, converted };
}
export async function getPaymentSettings(store: Store, ctx: Ctx) {
  needModule(ctx, "pos");
  const s = await store.get("payment_settings", ctx.shopId.slice(0, 36));
  return { wave: !!s?.waveTemplate, orange: !!s?.orangeTemplate, expiryMinutes: Number(s?.expiryMinutes ?? 15) };
}

export async function createPaymentLink(store: Store, ctx: Ctx, b: { provider: QrProvider; amount: number }) {
  needModule(ctx, "pos");
  const amount = toFcfa(b.amount); if (!(amount > 0)) throw new HttpError(400, "Montant invalide");
  if (b.provider !== "wave" && b.provider !== "orange") throw new HttpError(400, "Opérateur invalide");
  const s = must(await store.get("payment_settings", ctx.shopId.slice(0, 36)), "Paiement QR non configuré", 409);
  const template = b.provider === "wave" ? s.waveTemplate : s.orangeTemplate;
  if (!template) throw new HttpError(409, `Lien ${b.provider} non configuré dans les réglages`);
  const id = newId(), reference = linkRef(id);
  let url: string; try { url = buildPaymentUrl(template, { amount, ref: reference }, b.provider === "orange"); } catch { throw new HttpError(409, "Le lien enregistré pour cet opérateur est invalide : corrigez-le dans Réglages → Paiements QR."); }
  const expiresAt = new Date(Date.now() + Number(s.expiryMinutes ?? 15) * 60_000).toISOString();
  await store.create("payment_links", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, provider: b.provider, amount, reference, url, status: "pending", saleId: "", txRef: "", expiresAt, createdBy: ctx.userId, confirmedBy: "" });
  return { id, url, reference, amount, expiresAt, fixedLink: isStaticTemplate(String(template)) }; // le QR est dessiné côté client à partir de l'URL
}

/** Confirmation manuelle : l'opérateur saisit l'ID de transaction reçu par SMS/app Business.
 *  Unicité de l'ID par commerçant (anti-réutilisation) + journal d'audit. Sera remplacée par un webhook opérateur. */
export async function confirmPaymentLink(store: Store, ctx: Ctx, b: { linkId: string; txRef: string }) {
  needModule(ctx, "pos");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  if (link.status === "paid") return { status: "paid" };
  if (link.status !== "pending") throw new HttpError(409, `Lien ${link.status}`);
  if (isExpired(String(link.expiresAt))) { await store.update("payment_links", link.$id, { status: "expired" }); throw new HttpError(410, "Lien expiré"); }
  const txRef = String(b.txRef ?? "").trim().toUpperCase();
  if (txRef.length < 6) throw new HttpError(400, "ID de transaction requis (6 caractères min.)");
  const dup = await store.list("payment_links", { tenantId: ctx.tenantId, txRef }, 1);
  if (dup.length) throw new HttpError(409, "Cet ID de transaction a déjà servi");
  await store.update("payment_links", link.$id, { status: "paid", txRef, confirmedBy: ctx.userId });
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "payment_link.confirm", detail: `${link.reference} ${link.provider} ${link.amount} tx=${txRef}` });
  return { status: "paid" };
}
export async function cancelPaymentLink(store: Store, ctx: Ctx, b: { linkId: string }) {
  needModule(ctx, "pos");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  if (link.status !== "pending") throw new HttpError(409, `Lien ${link.status}`);
  await store.update("payment_links", link.$id, { status: "cancelled" });
  return { status: "cancelled" };
}
export async function paymentLinkStatus(store: Store, ctx: Ctx, b: { linkId: string }) {
  needModule(ctx, "pos");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  const status = link.status === "pending" && isExpired(String(link.expiresAt)) ? "expired" : link.status;
  return { status };
}

/** Actions qui ne dépendent d'aucune boutique particulière (le shopId du contexte est alors vide). */
export const TENANT_LEVEL = new Set(["md.license", "md.reco.generate", "md.reco.list", "md.reco.decide", "md.reco.cfg.save", "md.profile", "md.profile.set", "md.profile.confirm", "md.profile.delete", "md.trial.start", "md.pay.request", "md.pay.list", "report.consolidated", "subscription.get", "subscription.checkout", "subscription.submitProof", "tenant.init", "shop.create", "staff.create", "staff.update", "staff.resetPassword"]);

export const ACTIONS = {
  checkout: (s: Store, c: Ctx, b: CheckoutInput) => checkout(s, c, b),
  "entity.save": saveEntity, "article.save": saveArticle, "article.archive": archiveArticle, "article.delete": deleteArticle, "article.image": setArticleImage, "article.units.save": saveUnits, "bundle.components": saveComponents, "promotion.save": savePromotion, "promotion.status": setPromotionStatus, "promotion.delete": deletePromotion, "dashboard.business": businessDashboard, "cash.open": openSession, "cash.current": currentSession, "cash.move": cashMovement, "cash.authorize": authorizeMovement, "cash.close": closeSession, "cash.sessions": listSessions, "cash.sellers": sellerReport, "sale.refund": refundSale, "expense.create": createExpense, "expense.update": updateExpense, "expense.decide": decideExpense, "expense.cancel": cancelExpense, "expense.receipt": addReceipt, "scount.zones": scountZones, "scount.second": scountSecond, "scount.resolve": scountResolve, "scount.identify": scountIdentify, "scount.anomalies": scountAnomalies, "scount.anomaly.decide": scountAnomalyDecide, "scount.analysis": scountAnalysis, "scount.history": scountHistory, "scount.propose": scountPropose, "scount.plan.get": scountPlanGet, "scount.plan.save": scountPlanSave, "scount.suggest": scountSuggest, "scount.plan.generate": scountPlanGenerate, "scount.alerts": scountAlerts, "scount.campaign.save": scountCampaignSave, "scount.campaign.list": scountCampaignList, "scount.campaign.start": scountCampaignStart, "scount.campaign.get": scountCampaignGet, "scount.campaign.transfers": scountCampaignTransfers, "scount.campaign.validate": scountCampaignValidate, "scount.report": scountReport, "stk.dashboard": stockDashboard, "stk.article": stockArticle, "stk.moves": stockMoves, "stk.correct": stockCorrect, "stk.settings": stockSettings, "stk.alerts": stockAlerts, "crmpro.settings": proSettings, "crmpro.settings.save": proSettingsSave, "crmpro.loyalty": proLoyalty, "crmpro.loyalty.save": proLoyaltySave, "crmpro.segments": proSegments, "crmpro.segment.preview": proSegmentPreview, "crmpro.segment.save": proSegmentSave, "crmpro.insight": proInsight, "crmpro.analytics": proAnalytics, "crmpro.associations": proAssociations, "crmpro.performance": proPerformance, "crmpro.campaign.save": proCampaignSave, "crmpro.campaign.approve": proCampaignApprove, "crmpro.campaign.start": proCampaignStart, "crmpro.campaign.close": proCampaignClose, "crmpro.campaigns": proCampaigns, "crmpro.campaign": proCampaign, "crmpro.target.contact": proTargetContact, "crmpro.target.reply": proTargetReply, "crmpro.target.skip": proTargetSkip, "crmpro.target.retry": proTargetRetry, "crmpro.target.optout": proTargetOptout, "crmpro.consents": proConsents, "crmpro.rule.save": proRuleSave, "crmpro.rules": proRules, "crmpro.run": proRun, "crmpro.runs": proRuns, "crmpro.run.retry": proRunRetry, "crmpro.team.save": proTeamSave, "crmpro.teams": proTeams, "crmpro.portfolio.assign": proPortfolioAssign, "crm.customers": crmCustomers, "crm.customer": crmCustomer, "crm.customer.save": crmCustomerSave, "crm.leads": crmLeads, "crm.lead": crmLead, "crm.lead.save": crmLeadSave, "crm.lead.stage": crmLeadStage, "crm.lead.convert": crmLeadConvert, "crm.lead.archive": crmLeadArchive, "crm.opps": crmOpps, "crm.opp.save": crmOppSave, "crm.opp.stage": crmOppStage, "crm.tasks": crmTasks, "crm.task.save": crmTaskSave, "crm.task.done": crmTaskDone, "crm.task.cancel": crmTaskCancel, "crm.note": crmNote, "crm.dashboard": crmDashboard, "crm.owners": crmOwners, "stkp.analysis": proAnalysis, "stkp.replenish": proReplenish, "stkp.simulate": proSimulate, "stkp.network": proNetwork, "stkp.anomalies": proAnomalies, "stkp.products": proProducts, "stkp.report": stockProReport, "xfer.save": xferSave, "xfer.ship": xferShip, "xfer.receive": xferReceive, "xfer.close": xferClose, "xfer.cancel": xferCancel, "xfer.list": xferList, "xfer.get": xferGet, "count.save": inventorySave, "count.start": inventoryStart, "count.list": inventoryList, "count.get": inventoryGet, "count.entry": inventoryEntry, "count.finish": inventoryFinish, "count.review": inventoryReview, "count.recount": inventoryRecount, "count.decide": inventoryDecide, "count.validate": inventoryValidate, "count.close": inventoryClose, "count.cancel": inventoryCancel, "count.report": inventoryReport, "count.history": inventoryHistory, "count.attach": inventoryAttach, "purch.return": supplierReturn, "purch.config": purchasingConfig, "purch.dashboard": purchasingDashboard, "purch.article": articlePurchaseView, "purch.supplier.save": supplierSave, "purch.supplier.archive": supplierArchive, "purch.supplier.delete": supplierDelete, "purch.supplier.list": supplierList, "purch.supplier.get": supplierGet, "purch.po.save": poSave, "purch.po.submit": poSubmit, "purch.po.validate": poValidate, "purch.po.reject": poReject, "purch.po.cancel": poCancel, "purch.po.close": poClose, "purch.po.amend": poAmend, "purch.po.list": poList, "purch.po.get": poGet, "purch.receipt.save": receiptSave, "purch.receipt.validate": receiptValidate, "purch.receipt.cancel": receiptCancel, "purch.receipt.list": receiptList, "purch.receipt.get": receiptGet, "purch.invoice.save": invoiceSave, "purch.invoice.confirm": invoiceConfirm, "purch.invoice.dispute": invoiceDispute, "purch.invoice.pay": invoicePay, "purch.invoice.list": invoiceList, "purch.invoice.get": invoiceGet, "purch.attach": attach, "exppro.budget.save": saveBudget, "exppro.limit.save": saveLimit, "exppro.rule.save": saveRule, "exppro.toggle": toggleConfig, "exppro.recurring.save": saveRecurring, "exppro.plans.generate": generatePlans, "exppro.plans.list": listPlans, "exppro.plan.convert": convertPlan, "exppro.plan.skip": skipPlan, "exppro.budgets": budgetStatus, "expense.pay": payExpense, "expense.payments": listPayments, "expense.reallocate": reallocateExpense, "exppro.insights": proInsights, "exppro.report": expensesProReport, "treasury.balance.save": saveBalance, "treasury.view": treasuryView, "exppro.config": async (st: Store, c: Ctx) => { await needPro(st, c); const [budgets, limits, rules, recurring] = await Promise.all([cfgList(st, c, "budget"), cfgList(st, c, "limit"), cfgList(st, c, "rule"), cfgList(st, c, "recurring")]); return { budgets, limits, rules, recurring }; }, "expense.code": showExpenseCode, "expense.code.renew": renewExpenseCode, "expense.code.validate": validateExpenseCode, "expense.list": listExpenses, "expense.get": getExpense, "expense.categories": expenseCategories, "expense.category.save": saveExpenseCategory, "expense.settings": saveExpenseSettings, "expense.rights": setExpenseRights, "expense.myRights": myExpenseRights, "expense.report": expenseReport, "approval.request": requestApproval, "approval.list": listApprovals, "approval.decide": decideApproval, "ledger.verify": verifyLedger, "voucher.check": checkVoucher, "staff.rights": setStaffRights, "my.rights": myRights, "sale.verify": verifyReceipt, "cash.handover": handover, "cash.validate": validateVariance, "cash.correct": correctSession, "cash.performance": performance, "pos.suggest": suggest, "pos.simulate": simulate, "pos.insights": insights, "customer.profile": customerProfileSafe, "sales.list": listSales, "sale.get": getSale, "dashboard.pro": proDashboard, "dashboard.report": proReport, "dashboard.options": proOptions, "promotions.list": listPromotions, "promotions.settings": savePromoSettings, "promotion.storeRule": setStoreRule, "coupon.save": saveCoupon, "coupons.list": listCoupons, "promotions.analytics": promotionAnalytics, "promotions.recommendations": promotionRecommendations, "promotions.journal": promotionJournal, "promotions.stats": promotionStats, "promotions.preview": (s: Store, c: Ctx, b: any) => checkout(s, c, { ...b, dryRun: true }), "kit.assemble": assembleKit, "articles.dashboard": articleDashboard, "alerts.ack": ackAlerts, "lot.receive": receiveLot, "lot.assign": assignLot, "lot.update": updateLot, "lot.writeoff": writeOffLot, "serial.add": addSerials, "serial.status": setSerialStatus, "supplier.link.save": saveSupplierLink, "supplier.link.delete": deleteSupplierLink, "article.profitability": articleProfitability, "price.rule.save": savePriceRule, "price.rule.delete": deletePriceRule, "variant.save": saveVariant, "variant.archive": archiveVariant, "variant.delete": deleteVariant, "stock.adjust": adjustStock, "credit.repay": repayCredit, "claim.list": claimList, "claim.decide": claimDecide, "credit.list": creditList, "credit.create": creditCreate, "credit.apply": creditApply, "credit.refund": creditRefund, "credit.cancel": creditCancel, "finpro.rules": rulesGet, "finpro.rules.save": rulesSave, "finpro.scenarios": scenarioList, "finpro.scenario.save": scenarioSave, "finpro.plans": planList, "finpro.plan.save": planSave, "finpro.plan.approve": planApprove, "finpro.plan.done": planDone, "finpro.plan.cancel": planCancel, "finpro.forecast": forecast, "finpro.budget.save": pbudgetSave, "finpro.budgets": pbudgets, "finpro.compare": compare, "finpro.ventilation": ventilation, "finpro.consolidated": consolidated, "finpro.reconcile.preview": reconcileAdvanced, "ic.overview": icOverview, "ic.accounts": icAccounts, "ic.account.save": icAccountSave, "ic.account.import": icAccountImport, "ic.config": icConfig, "ic.config.save": icConfigSave, "ic.proposals": icProposals, "ic.proposal.create": icProposalCreate, "ic.entries": icEntries, "ic.entry": icEntry, "ic.entry.save": icEntrySave, "ic.entry.submit": icEntrySubmit, "ic.entry.validate": icEntryValidate, "ic.entry.reject": icEntryReject, "ic.entry.reverse": icEntryReverse, "ic.entry.correct": icEntryCorrect, "ic.periods": icPeriods, "ic.period.controls": icPeriodControls, "ic.period.close": icPeriodClose, "ic.period.reopen": icPeriodReopen, "ic.verify": icVerify, "ic.ledger": icLedger, "ic.balance": icBalance, "ic.journal": icJournal, "ic.third": icThird, "ic.report": icReport, "inv.overview": invOverview, "inv.config": invConfig, "inv.config.save": invConfigSave, "inv.items": invItemList, "inv.item": invItemGet, "inv.item.save": invItemSave, "inv.item.status": invItemStatus, "inv.maturity": invMaturity, "inv.scenario.save": invScenarioSave, "inv.actual.add": invActualAdd, "inv.actual.void": invActualVoid, "inv.report": invReport, "md.license": mdLicense, "md.reco.generate": rcGenerate, "md.reco.list": rcList, "md.reco.decide": rcDecide, "md.reco.cfg.save": rcCfgSave, "md.profile": mpGet, "md.profile.set": mpSet, "md.profile.confirm": mpConfirm, "md.profile.delete": mpDelete, "md.trial.start": mdTrialStart, "platform.master.activate": mdActivate, "platform.master.trial": mdPlatformTrial, "platform.master.list": mdList, "md.opening": mrOpening, "md.closing": mrClosing, "md.reports": mrList, "md.report": mrGet, "md.pay.request": mpPayRequest, "md.pay.list": mpPayList, "platform.master.hook.get": mpHookGet, "platform.master.hook.save": mpHookSave, "platform.master.hook.rotate": mpHookRotate, "platform.master.events": mpEvents, "platform.master.event.decide": mpEventDecide, "ip.config": ipConfig, "ip.config.save": ipConfigSave, "ip.item.pro": ipItemPro, "ip.project": ipProject, "ip.placement": ipPlacement, "ip.portfolio": ipPortfolio, "ip.budget.revise": ipBudgetRevise, "ip.financing.save": ipFinSave, "ip.financing.archive": ipFinArchive, "ip.tranche.save": ipTrSave, "ip.tranche.cancel": ipTrCancel, "ip.tranche.pay": ipTrPay, "ip.value.add": ipValueAdd, "ip.value.void": ipValueVoid, "ip.report": ipReport, "icp.overview": icpOverview, "icp.config": icpConfig, "icp.config.save": icpConfigSave, "icp.map.save": icpMapSave, "icp.dims": icpDimList, "icp.dim.save": icpDimSave, "icp.piece.add": icpPieceAdd, "icp.piece.remove": icpPieceRemove, "icp.piece.verify": icpPieceVerify, "icp.letter.candidates": icpLetterCandidates, "icp.letters": icpLetterList, "icp.letter.create": icpLetterCreate, "icp.letter.undo": icpLetterUndo, "icp.assets": icpAssetList, "icp.asset.save": icpAssetSave, "icp.asset.dispose": icpAssetDispose, "icp.analytic": icpAnalytic, "icp.statements": icpStatements, "icp.close.guide": icpCloseGuide, "icp.report": icpReport, "fin.accounts": finAccounts, "fin.account.save": finAccountSave, "fin.flows": finFlows, "fin.transfers": finTransfers, "fin.transfer.save": finTransferSave, "fin.transfer.confirm": finTransferConfirm, "fin.transfer.cancel": finTransferCancel, "fin.reconcile.preview": finReconcilePreview, "fin.reconcile.save": finReconcileSave, "fin.reconciliations": finReconciliations, "fin.dues": finDues, "fin.budget.save": finBudgetSave, "fin.budgets": finBudgets, "fin.dashboard": finDashboard, "fin.report": finReport,
  "payments.settings.save": savePaymentSettings, "payments.settings.get": (s: Store, c: Ctx) => getPaymentSettings(s, c),
  "payment_link.create": createPaymentLink, "payment_link.confirm": confirmPaymentLink,
  "po.create": createPo, "po.cancel": cancelPo, "po.receive": receivePo, "invoice.supplier.create": invoicePo, "invoice.supplier.pay": payInvoice,
  "shop.save": saveShop, "invoice.customer.fromSale": invoiceFromSale, "invoice.customer.create": createFreeInvoice, "invoice.customer.pay": payCustomerInvoice,
  "tenant.init": initTenant, "shop.create": createShop, "staff.create": createStaff, "staff.update": updateStaff, "staff.resetPassword": resetStaffPassword, "stock.transfer": transferStock,
  "subscription.get": subscriptionGet, "subscription.checkout": subscriptionCheckout, "subscription.submitProof": subscriptionSubmitProof,
  "platform.me": platformMe, "platform.subscription.lifetime": platformLifetime, "platform.renewals.list": platformRenewals, "platform.renewals.markReminded": platformMarkReminded, "platform.payments.list": platformPayments, "platform.payment.review": platformReview, "platform.subscription.grant": platformGrant, "platform.settings.save": platformSettingsSave, "platform.settings.get": platformSettingsGet,
  "report.consolidated": consolidatedReport,
  "payment_link.cancel": cancelPaymentLink, "payment_link.status": paymentLinkStatus,
} as const;
