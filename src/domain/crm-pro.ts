import type { LoyaltyRules } from "./loyalty";
import { DAY, clean, type ConsentSet } from "./crm";

/** CRM Pro : règles pures et explicables. Un score est un indicateur calculé sur des données déclarées : jamais une prédiction certaine. */
const r2 = (n: number) => Math.round(n * 100) / 100;
export const SCORE_NOTE = "Indicateur calculé sur vos données (critères ci-dessous) : ce n'est ni une prédiction certaine ni une décision automatique.";

// ------------------------------------------------------------------ RFM : récence, fréquence, valeur
export type Rfm = { r: number; f: number; m: number };
export type RfmKey = "champions" | "loyal" | "big" | "promising" | "new" | "atrisk" | "lost" | "occasional" | "never";
export const RFM_LABEL: Record<RfmKey, string> = { champions: "Champions", loyal: "Fidèles", big: "Gros paniers", promising: "Prometteurs", new: "Nouveaux", atrisk: "À risque", lost: "Perdus", occasional: "Occasionnels", never: "Sans achat" };
export const RFM_HELP: Record<RfmKey, string> = { champions: "Récents, fréquents et gros acheteurs (R, F, M ≥ 4)", loyal: "Achètent souvent (F ≥ 4) et récemment (R ≥ 3)", big: "Valeur d'achat très élevée (M = 5) et récents", promising: "Achat très récent (R ≥ 4) mais peu fréquent (F ≤ 2)", new: "Premier achat il y a 30 jours ou moins", atrisk: "Réguliers (F ≥ 3) mais silencieux depuis longtemps (R ≤ 2)", lost: "Aucun achat depuis très longtemps (R = 1) et peu fréquent", occasional: "Les autres clients acheteurs", never: "Aucun achat confirmé" };
/** R : jours depuis le dernier achat (≤14 → 5 … > 120 → 1). F : achats sur 365 jours (≥10 → 5 … 1 → 1). M : dépense nette sur 365 jours relative à la médiane des acheteurs (≥3× → 5, ≥1,5× → 4, ≥0,75× → 3, ≥0,4× → 2, sinon 1). */
export const rScore = (days: number): number => (days <= 14 ? 5 : days <= 30 ? 4 : days <= 60 ? 3 : days <= 120 ? 2 : 1);
export const fScore = (n: number): number => (n >= 10 ? 5 : n >= 6 ? 4 : n >= 3 ? 3 : n === 2 ? 2 : 1);
export const mScore = (spend: number, median: number): number => { if (median <= 0) return spend > 0 ? 3 : 1; const x = spend / median; return x >= 3 ? 5 : x >= 1.5 ? 4 : x >= 0.75 ? 3 : x >= 0.4 ? 2 : 1; };
export const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
export function rfmKey(x: Rfm, i: { salesCount: number; firstSaleDays: number | null }): RfmKey {
  if (!i.salesCount) return "never"; if (i.salesCount === 1 && i.firstSaleDays !== null && i.firstSaleDays <= 30) return "new";
  if (x.r >= 4 && x.f >= 4 && x.m >= 4) return "champions"; if (x.f >= 4 && x.r >= 3) return "loyal"; if (x.m === 5 && x.r >= 3) return "big"; if (x.r >= 4 && x.f <= 2) return "promising"; if (x.r <= 2 && x.f >= 3) return "atrisk"; if (x.r === 1 && x.f <= 2) return "lost"; return "occasional";
}

// ------------------------------------------------------------------ profil et critères de segmentation (comportement réel)
export type Profile = { id: string; kind: "customer" | "lead"; name: string; phone: string; email: string; salesCount: number; total: number; spend365: number; freq365: number; recencyDays: number | null; firstSaleDays: number | null; avgBasket: number; avgGapDays: number | null; categories: string[]; usesPromo: boolean; usesCredit: boolean; creditBalance: number; rfm: Rfm | null; rfmKey: RfmKey; tags: string[]; source: string; ownerId: string; consents: ConsentSet; prefChannel: string; lastContactedAt: number | null; segment: string };
export type Criteria = { rfm?: RfmKey[]; recencyMin?: number; recencyMax?: number; freqMin?: number; freqMax?: number; valueMin?: number; valueMax?: number; category?: string; usesPromo?: boolean; usesCredit?: boolean; tag?: string; source?: string; ownerId?: string; consent?: "sms" | "email" | "whatsapp" | "call"; segment?: string; neverBought?: boolean };
const num = (v: unknown, lo: number, hi: number, label: string): number | undefined => { if (v === undefined || v === null || v === "") return undefined; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label} invalide`); return Math.round(n); };
export function normCriteria(v: unknown): Criteria {
  const o = (v ?? {}) as Record<string, unknown>; const c: Criteria = {};
  if (Array.isArray(o.rfm) && o.rfm.length) { const ok = o.rfm.filter((k): k is RfmKey => Object.hasOwn(RFM_LABEL, String(k))); if (ok.length !== o.rfm.length) throw new Error("Segment RFM inconnu"); c.rfm = [...new Set(ok)]; }
  for (const [k, lo, hi, l] of [["recencyMin", 0, 3650, "Récence minimale"], ["recencyMax", 0, 3650, "Récence maximale"], ["freqMin", 0, 1000, "Fréquence minimale"], ["freqMax", 0, 1000, "Fréquence maximale"], ["valueMin", 0, 1e10, "Valeur minimale"], ["valueMax", 0, 1e10, "Valeur maximale"]] as const) { const n = num(o[k], lo, hi, l); if (n !== undefined) c[k] = n; }
  if (c.recencyMin !== undefined && c.recencyMax !== undefined && c.recencyMin > c.recencyMax) throw new Error("Récence : minimum supérieur au maximum"); if (c.freqMin !== undefined && c.freqMax !== undefined && c.freqMin > c.freqMax) throw new Error("Fréquence : minimum supérieur au maximum"); if (c.valueMin !== undefined && c.valueMax !== undefined && c.valueMin > c.valueMax) throw new Error("Valeur : minimum supérieure au maximum");
  if (o.category) c.category = clean(o.category, 80); if (o.tag) c.tag = clean(o.tag, 24).toLowerCase(); if (o.source) c.source = clean(o.source, 24); if (o.ownerId) c.ownerId = clean(o.ownerId, 64); if (o.segment) c.segment = clean(o.segment, 12);
  if (o.usesPromo === true || o.usesPromo === false) c.usesPromo = o.usesPromo; if (o.usesCredit === true || o.usesCredit === false) c.usesCredit = o.usesCredit; if (o.neverBought === true) c.neverBought = true;
  if (o.consent !== undefined && o.consent !== "") { if (!["sms", "email", "whatsapp", "call"].includes(String(o.consent))) throw new Error("Canal de consentement inconnu"); c.consent = o.consent as Criteria["consent"]; }
  return c;
}
export function matches(c: Criteria, p: Profile): boolean {
  if (c.neverBought && p.salesCount > 0) return false; if (c.rfm && !c.rfm.includes(p.rfmKey)) return false;
  if (c.recencyMin !== undefined && (p.recencyDays === null || p.recencyDays < c.recencyMin)) return false; if (c.recencyMax !== undefined && (p.recencyDays === null || p.recencyDays > c.recencyMax)) return false;
  if (c.freqMin !== undefined && p.freq365 < c.freqMin) return false; if (c.freqMax !== undefined && p.freq365 > c.freqMax) return false; if (c.valueMin !== undefined && p.spend365 < c.valueMin) return false; if (c.valueMax !== undefined && p.spend365 > c.valueMax) return false;
  if (c.category && !p.categories.some((x) => x.toLowerCase() === c.category!.toLowerCase())) return false; if (c.usesPromo !== undefined && p.usesPromo !== c.usesPromo) return false; if (c.usesCredit !== undefined && p.usesCredit !== c.usesCredit) return false;
  if (c.tag && !p.tags.includes(c.tag)) return false; if (c.source && p.source !== c.source) return false; if (c.ownerId && p.ownerId !== c.ownerId) return false; if (c.consent && !p.consents[c.consent]) return false; if (c.segment && p.segment !== c.segment) return false; return true;
}
export const describeCriteria = (c: Criteria): string[] => [...(c.rfm ? [`Segment RFM : ${c.rfm.map((k) => RFM_LABEL[k]).join(", ")}`] : []), ...(c.neverBought ? ["Jamais acheté"] : []), ...(c.recencyMin !== undefined ? [`Dernier achat il y a ≥ ${c.recencyMin} j`] : []), ...(c.recencyMax !== undefined ? [`Dernier achat il y a ≤ ${c.recencyMax} j`] : []), ...(c.freqMin !== undefined ? [`≥ ${c.freqMin} achats sur 12 mois`] : []), ...(c.freqMax !== undefined ? [`≤ ${c.freqMax} achats sur 12 mois`] : []), ...(c.valueMin !== undefined ? [`Dépense 12 mois ≥ ${c.valueMin} FCFA`] : []), ...(c.valueMax !== undefined ? [`Dépense 12 mois ≤ ${c.valueMax} FCFA`] : []), ...(c.category ? [`A acheté la catégorie « ${c.category} »`] : []), ...(c.usesPromo !== undefined ? [c.usesPromo ? "A utilisé une promotion" : "N'a jamais utilisé de promotion"] : []), ...(c.usesCredit !== undefined ? [c.usesCredit ? "Achète à crédit" : "N'achète pas à crédit"] : []), ...(c.tag ? [`Étiquette #${c.tag}`] : []), ...(c.source ? [`Origine : ${c.source}`] : []), ...(c.ownerId ? ["Portefeuille d'un responsable"] : []), ...(c.consent ? [`Consentement ${c.consent}`] : []), ...(c.segment ? [`Segment ${c.segment}`] : [])];

// ------------------------------------------------------------------ scores explicables
export type ScorePart = { key: string; label: string; points: number; max: number; why: string };
export type Score = { score: number | null; level: "high" | "medium" | "low" | "unrated"; levelLabel: string; parts: ScorePart[]; basis: string; limits: string[]; note: string };
const LEVEL_LABEL = { high: "Élevé", medium: "Moyen", low: "Faible", unrated: "Non évaluable" } as const;
const lvl = (s: number) => (s >= 70 ? "high" : s >= 45 ? "medium" : "low") as "high" | "medium" | "low";
/** Potentiel de réachat d'un client : récence relative à son rythme d'achat, fréquence, valeur, joignabilité, fiabilité de paiement. Non évaluable en dessous de 2 achats. */
export function customerScore(p: Pick<Profile, "salesCount" | "recencyDays" | "avgGapDays" | "freq365" | "rfm" | "phone" | "email" | "consents" | "creditBalance">): Score {
  const parts: ScorePart[] = []; const limits: string[] = [];
  if (p.salesCount < 2 || p.recencyDays === null) return { score: null, level: "unrated", levelLabel: LEVEL_LABEL.unrated, parts, basis: `${p.salesCount} achat(s) confirmé(s)`, limits: ["Moins de 2 achats : l'historique ne permet pas d'estimer un potentiel de réachat."], note: SCORE_NOTE };
  const ratio = p.avgGapDays && p.avgGapDays > 0 ? p.recencyDays / p.avgGapDays : null; const rec = ratio !== null ? (ratio <= 1 ? 30 : ratio <= 1.5 ? 22 : ratio <= 2.5 ? 12 : 3) : p.recencyDays <= 30 ? 30 : p.recencyDays <= 60 ? 20 : p.recencyDays <= 120 ? 10 : 3;
  parts.push({ key: "recency", label: "Récence", points: rec, max: 30, why: ratio !== null ? `Dernier achat il y a ${p.recencyDays} j pour un rythme habituel de ${Math.round(p.avgGapDays!)} j (×${r2(ratio)})` : `Dernier achat il y a ${p.recencyDays} j` });
  const fr = p.freq365 >= 8 ? 25 : p.freq365 >= 5 ? 20 : p.freq365 >= 3 ? 14 : p.freq365 === 2 ? 8 : 3; parts.push({ key: "frequency", label: "Fréquence", points: fr, max: 25, why: `${p.freq365} achat(s) sur 12 mois` });
  const mv = (p.rfm?.m ?? 1) * 5; parts.push({ key: "value", label: "Valeur", points: mv, max: 25, why: `Niveau de dépense ${p.rfm?.m ?? 1}/5 par rapport à la médiane des acheteurs` });
  const reach = (p.phone || p.email ? 5 : 0) + (p.consents.sms || p.consents.email || p.consents.whatsapp || p.consents.call ? 5 : 0); parts.push({ key: "reach", label: "Joignabilité", points: reach, max: 10, why: `${p.phone || p.email ? "Contact renseigné" : "Aucun contact"} · ${p.consents.sms || p.consents.email || p.consents.whatsapp || p.consents.call ? "consentement enregistré" : "aucun consentement"}` });
  parts.push({ key: "payment", label: "Paiement", points: p.creditBalance > 0 ? 4 : 10, max: 10, why: p.creditBalance > 0 ? "Crédit en cours" : "Aucun crédit en cours" });
  const s = parts.reduce((a, x) => a + x.points, 0); if (p.salesCount < 5) limits.push("Moins de 5 achats : estimation peu stable.");
  return { score: s, level: lvl(s), levelLabel: LEVEL_LABEL[lvl(s)], parts, basis: `${p.salesCount} achat(s) confirmé(s)`, limits, note: SCORE_NOTE };
}
export type LeadFacts = { stage: string; phone: string; email: string; company: string; address: string; source: string; consents: ConsentSet; lastActivityDays: number | null; openOppValue: number; oppDue: boolean };
const STAGE_POINTS: Record<string, number> = { new: 5, contacted: 12, qualified: 20, proposal: 26, negotiation: 30 };
/** Maturité commerciale d'un prospect : étape, complétude de la fiche, consentement, activité récente, opportunité et origine. */
export function leadScore(l: LeadFacts): Score {
  if (!Object.hasOwn(STAGE_POINTS, l.stage)) return { score: null, level: "unrated", levelLabel: LEVEL_LABEL.unrated, parts: [], basis: "Prospect clôturé", limits: ["Un prospect gagné ou perdu n'est plus évalué."], note: SCORE_NOTE };
  const parts: ScorePart[] = [{ key: "stage", label: "Étape du pipeline", points: STAGE_POINTS[l.stage]!, max: 30, why: `Étape « ${l.stage} »` }];
  const comp = (l.phone ? 6 : 0) + (l.email ? 4 : 0) + (l.company || l.address ? 5 : 0); parts.push({ key: "profile", label: "Fiche complète", points: comp, max: 15, why: `${l.phone ? "téléphone" : "sans téléphone"}, ${l.email ? "e-mail" : "sans e-mail"}, ${l.company || l.address ? "entreprise/adresse" : "sans entreprise ni adresse"}` });
  const cons = l.consents.sms || l.consents.email || l.consents.whatsapp || l.consents.call ? 10 : 0; parts.push({ key: "consent", label: "Consentement", points: cons, max: 10, why: cons ? "Consentement de contact enregistré" : "Aucun consentement" });
  const act = l.lastActivityDays === null ? 0 : l.lastActivityDays <= 7 ? 20 : l.lastActivityDays <= 14 ? 14 : l.lastActivityDays <= 30 ? 8 : 0; parts.push({ key: "activity", label: "Activité récente", points: act, max: 20, why: l.lastActivityDays === null ? "Aucune interaction enregistrée" : `Dernière interaction il y a ${l.lastActivityDays} j` });
  const opp = (l.openOppValue > 0 ? 10 : 0) + (l.openOppValue > 0 && l.oppDue ? 5 : 0); parts.push({ key: "opp", label: "Opportunité", points: opp, max: 15, why: l.openOppValue > 0 ? `Opportunité ouverte de ${l.openOppValue} FCFA${l.oppDue ? " avec échéance" : " sans échéance"}` : "Aucune opportunité ouverte" });
  const src = l.source === "referral" || l.source === "walkin" ? 10 : l.source ? 5 : 0; parts.push({ key: "source", label: "Origine", points: src, max: 10, why: l.source ? `Origine « ${l.source} »` : "Origine non renseignée" });
  const s = parts.reduce((a, x) => a + x.points, 0); return { score: s, level: lvl(s), levelLabel: LEVEL_LABEL[lvl(s)], parts, basis: "Fiche, étape et activité du prospect", limits: ["Le poids de chaque critère est fixé par convention (affiché ci-dessus), pas appris d'un historique de conversion."], note: SCORE_NOTE };
}

// ------------------------------------------------------------------ campagnes : canaux, éligibilité, attribution, résultats
export type Channel = "call" | "store" | "whatsapp" | "sms" | "email";
export const CHANNELS: Record<Channel, string> = { call: "Appel", store: "En boutique (caisse)", whatsapp: "WhatsApp", sms: "SMS", email: "E-mail" };
/** Canaux passant par un prestataire externe (WhatsApp, SMS, e-mail) : suspendus jusqu'à nouvel ordre. Aucun connecteur n'existe ; seuls l'appel par l'équipe et l'offre en boutique (coupon présenté en caisse) restent actifs. */
export const SUSPENDED_CHANNELS: Channel[] = ["whatsapp", "sms", "email"];
export const isSuspended = (c: unknown): boolean => SUSPENDED_CHANNELS.includes(c as Channel);
export const SUSPENDED_MSG = "Les envois par prestataire externe (WhatsApp, SMS, e-mail) sont suspendus jusqu'à nouvel ordre : utilisez l'appel ou l'offre en boutique.";
export const isChannel = (v: unknown): v is Channel => Object.hasOwn(CHANNELS, String(v));
export type CampaignStatus = "draft" | "approved" | "running" | "completed" | "cancelled";
export const CAMPAIGN_LABEL: Record<CampaignStatus, string> = { draft: "Brouillon", approved: "Autorisée", running: "En cours", completed: "Terminée", cancelled: "Annulée" };
export const CAMPAIGN_NEXT: Record<CampaignStatus, CampaignStatus[]> = { draft: ["approved", "cancelled"], approved: ["running", "draft", "cancelled"], running: ["completed", "cancelled"], completed: [], cancelled: [] };
export type TargetStatus = "pending" | "contacted" | "replied" | "skipped" | "optout" | "failed";
export const TARGET_LABEL: Record<TargetStatus, string> = { pending: "À contacter", contacted: "Contacté", replied: "A répondu", skipped: "Écarté", optout: "Désabonné", failed: "Échec" };
export type Skip = "no_contact" | "no_consent" | "frequency" | "unreachable" | "preference";
export const SKIP_LABEL: Record<Skip, string> = { no_contact: "Pas de coordonnée pour ce canal", no_consent: "Pas de consentement pour ce canal (ou désabonné)", frequency: "Contacté récemment (limite de fréquence)", preference: "Canal préféré différent (préférence de contact)", unreachable: "Contact indisponible" };
export function eligibility(i: { channel: Channel; phone: string; email: string; consents: ConsentSet; prefChannel?: string; lastContactedAt: number | null; now: number; freqDays: number }): { ok: true } | { ok: false; reason: Skip } {
  if (i.channel === "store") return i.lastContactedAt !== null && i.now - i.lastContactedAt < i.freqDays * DAY ? { ok: false, reason: "frequency" } : { ok: true };
  const has = i.channel === "email" ? !!i.email : !!i.phone; if (!has) return { ok: false, reason: "no_contact" };
  if (!i.consents[i.channel]) return { ok: false, reason: "no_consent" }; if (i.prefChannel && i.prefChannel !== i.channel) return { ok: false, reason: "preference" }; if (i.lastContactedAt !== null && i.now - i.lastContactedAt < i.freqDays * DAY) return { ok: false, reason: "frequency" }; return { ok: true };
}
/** Plafonds : contacts déjà enregistrés aujourd'hui (jour UTC) et ce mois-ci (mois civil UTC), toutes campagnes confondues. */
export function quotaState(contactedAts: number[], now: number, cap: { dailyCap: number; monthlyCap: number }): { ok: boolean; reason?: "daily" | "monthly"; daily: number; monthly: number } {
  const d = new Date(now); const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), mon0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); const daily = contactedAts.filter((t) => t >= day0).length, monthly = contactedAts.filter((t) => t >= mon0).length;
  return daily >= cap.dailyCap ? { ok: false, reason: "daily", daily, monthly } : monthly >= cap.monthlyCap ? { ok: false, reason: "monthly", daily, monthly } : { ok: true, daily, monthly };
}
/** Heures calmes (UTC, fenêtre [from, to[ pouvant passer minuit ; from = to : aucune) : aucun contact enregistré pendant ce créneau. */
export const inQuietHours = (now: number, from: number, to: number): boolean => { if (from === to) return false; const h = new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60; return from < to ? h >= from && h < to : h >= from || h < to; };
export const fillTemplate = (t: string, name: string): string => t.replace(/\{(?:nom|prénom|prenom)\}/gi, clean(name, 80).split(" ")[0] ?? "");
/** Ventes du client dans la fenêtre qui suit le contact : corrélation temporelle, pas une preuve de causalité. */
export const attribute = (contactedAt: number, windowDays: number, sales: { at: number; net: number }[]): { count: number; amount: number } => { const end = contactedAt + windowDays * DAY; const s = sales.filter((x) => x.at > contactedAt && x.at <= end); return { count: s.length, amount: s.reduce((a, x) => a + x.net, 0) }; };
export function campaignStats(targets: { status: TargetStatus; attributed?: number; converted?: boolean }[], budget: number) {
  const n = (s: TargetStatus) => targets.filter((t) => t.status === s).length; const contacted = n("contacted") + n("replied"); const revenue = targets.reduce((a, t) => a + (t.attributed ?? 0), 0); const converted = targets.filter((t) => t.converted).length;
  return { total: targets.length, pending: n("pending"), contacted, replied: n("replied"), skipped: n("skipped"), optout: n("optout"), failed: n("failed"), converted, replyRate: contacted ? Math.round((n("replied") / contacted) * 100) : null, conversionRate: contacted ? Math.round((converted / contacted) * 100) : null, optoutRate: targets.length ? r2((n("optout") / targets.length) * 100) : null, revenue, budget, roi: budget > 0 ? r2(revenue / budget) : null };
}

// ------------------------------------------------------------------ analyses : rétention, valeur, prévisions
export function retention(custs: { saleAts: number[] }[], now: number) {
  const bought = (c: { saleAts: number[] }, from: number, to: number) => c.saleAts.some((t) => t > from && t <= to); const base = custs.filter((c) => bought(c, now - 180 * DAY, now - 90 * DAY)); const kept = base.filter((c) => bought(c, now - 90 * DAY, now));
  const repeat = (d: number) => { const el = custs.filter((c) => c.saleAts.length && now - Math.min(...c.saleAts) >= d * DAY); const ok = el.filter((c) => { const s = [...c.saleAts].sort((a, b) => a - b); return s.length > 1 && s[1]! - s[0]! <= d * DAY; }); return { eligible: el.length, repeat: ok.length, rate: el.length ? Math.round((ok.length / el.length) * 100) : null }; };
  return { retention90: { base: base.length, kept: kept.length, rate: base.length ? Math.round((kept.length / base.length) * 100) : null }, repeat30: repeat(30), repeat60: repeat(60), repeat90: repeat(90) };
}
export function cohorts(custs: { saleAts: number[] }[], now: number, months = 6) {
  const out: { month: string; size: number; repeat90: number; eligible: number; rate: number | null }[] = []; const d = new Date(now);
  for (let k = months - 1; k >= 0; k--) { const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k + 1, 1); const cs = custs.filter((c) => c.saleAts.length && Math.min(...c.saleAts) >= start && Math.min(...c.saleAts) < end); const el = cs.filter((c) => now - Math.min(...c.saleAts) >= 90 * DAY); const rep = el.filter((c) => { const s = [...c.saleAts].sort((a, b) => a - b); return s.length > 1 && s[1]! - s[0]! <= 90 * DAY; }).length; out.push({ month: new Date(start).toISOString().slice(0, 7), size: cs.length, eligible: el.length, repeat90: rep, rate: el.length ? Math.round((rep / el.length) * 100) : null }); }
  return out;
}
export function valueOf(p: { salesCount: number; total: number; firstSaleDays: number | null; freq365: number; avgBasket: number }): { historic: number; projected12: number | null; method: string } {
  if (p.salesCount < 3 || !p.firstSaleDays) return { historic: p.total, projected12: null, method: "Moins de 3 achats : pas d'estimation à 12 mois." };
  const perYear = p.firstSaleDays >= 365 ? p.freq365 : (p.salesCount / Math.max(30, p.firstSaleDays)) * 365; return { historic: p.total, projected12: Math.round(perYear * p.avgBasket), method: `Estimation = panier moyen × achats par an (${r2(perYear)}) : un ordre de grandeur, pas une promesse.` };
}
export function pipelineForecast(open: { value: number; probability: number; dueOn: string }[], closed: { won: number; lost: number }) {
  const sample = closed.won + closed.lost; const winRate = sample >= 10 ? r2(closed.won / sample) : null; const by = new Map<string, { month: string; count: number; value: number; weighted: number; adjusted: number | null }>();
  for (const o of open) { const m = o.dueOn ? o.dueOn.slice(0, 7) : "sans-echeance"; const e = by.get(m) ?? { month: m, count: 0, value: 0, weighted: 0, adjusted: winRate === null ? null : 0 }; e.count++; e.value += o.value; e.weighted += Math.round((o.value * o.probability) / 100); if (e.adjusted !== null && winRate !== null) e.adjusted += Math.round(o.value * winRate); by.set(m, e); }
  const months = [...by.values()].sort((a, b) => a.month.localeCompare(b.month)); return { months, weighted: months.reduce((a, x) => a + x.weighted, 0), adjusted: winRate === null ? null : months.reduce((a, x) => a + (x.adjusted ?? 0), 0), winRate, sample, confidence: sample >= 30 ? "moyenne" : sample >= 10 ? "faible" : "insuffisante", limits: [sample >= 10 ? `Taux de gain historique ${Math.round((winRate ?? 0) * 100)} % sur ${sample} opportunités clôturées : appliqué uniformément à toutes les opportunités.` : "Moins de 10 opportunités clôturées : pas de taux de gain historique, seule la valeur pondérée déclarée est affichée.", "La valeur pondérée dépend des probabilités saisies par les commerciaux : elle est déclarative.", "Prévision indicative : elle ne remplace ni un budget ni un engagement de vente."] };
}
export function projectNext(monthly: number[]): { value: number | null; low: number | null; high: number | null; method: string } {
  if (monthly.length < 3) return { value: null, low: null, high: null, method: "Moins de 3 mois complets de ventes : pas de projection." }; if (!monthly.some((x) => x > 0)) return { value: null, low: null, high: null, method: "Aucune vente confirmée sur les mois écoulés : pas de projection." }; const last = monthly.slice(-3); return { value: Math.round(last.reduce((a, b) => a + b, 0) / 3), low: Math.min(...last), high: Math.max(...last), method: "Moyenne des 3 derniers mois complets ; fourchette = minimum et maximum de ces mois. Saisonnalité et promotions non modélisées." };
}

// ------------------------------------------------------------------ automatisations
export type Trigger = "first_sale" | "inactive" | "tier" | "lead_stale" | "opp_overdue";
export const TRIGGERS: Record<Trigger, { label: string; help: string; subject: "customer" | "lead" | "opp" }> = { first_sale: { label: "Premier achat confirmé", help: "Une vente confirmée est rattachée à un client sans achat antérieur.", subject: "customer" }, inactive: { label: "Client inactif", help: "Dernier achat confirmé plus ancien que N jours.", subject: "customer" }, tier: { label: "Niveau de fidélité atteint", help: "Le cumul annuel atteint le niveau choisi.", subject: "customer" }, lead_stale: { label: "Prospect sans activité", help: "Prospect ouvert sans interaction depuis N jours.", subject: "lead" }, opp_overdue: { label: "Opportunité en retard", help: "Échéance dépassée sur une opportunité ouverte.", subject: "opp" } };
export const isTrigger = (v: unknown): v is Trigger => Object.hasOwn(TRIGGERS, String(v));
export type RuleParams = { days?: number; tier?: "silver" | "gold"; minSpend?: number; tag?: string };
export type RuleTask = { kind: "call" | "meeting" | "task" | "followup"; title: string; dueInDays: number; owner: "portfolio" | "creator" | string; notes: string };
export function normRule(v: { trigger?: unknown; params?: unknown; task?: unknown }): { trigger: Trigger; params: RuleParams; task: RuleTask } {
  if (!isTrigger(v.trigger)) throw new Error("Déclencheur inconnu"); const p = (v.params ?? {}) as Record<string, unknown>; const t = (v.task ?? {}) as Record<string, unknown>; const params: RuleParams = {};
  if (v.trigger === "inactive" || v.trigger === "lead_stale") { const d = Number(p.days ?? (v.trigger === "inactive" ? 60 : 14)); if (!Number.isInteger(d) || d < 7 || d > 365) throw new Error("Durée invalide (7 à 365 jours)"); params.days = d; }
  if (v.trigger === "tier") { if (p.tier !== "silver" && p.tier !== "gold") throw new Error("Niveau invalide (silver ou gold)"); params.tier = p.tier; }
  if (p.minSpend !== undefined && p.minSpend !== "") { const m = Number(p.minSpend); if (!Number.isInteger(m) || m < 0 || m > 1e10) throw new Error("Dépense minimale invalide"); params.minSpend = m; } if (p.tag) params.tag = clean(p.tag, 24).toLowerCase();
  const kind = clean(t.kind || "followup", 10); if (!["call", "meeting", "task", "followup"].includes(kind)) throw new Error("Type de tâche inconnu"); const title = clean(t.title, 160); if (title.length < 3) throw new Error("Intitulé de la tâche obligatoire (3 caractères au moins)"); const due = Number(t.dueInDays ?? 1); if (!Number.isInteger(due) || due < 0 || due > 60) throw new Error("Échéance invalide (0 à 60 jours)");
  const owner = clean(t.owner || "portfolio", 64); return { trigger: v.trigger, params, task: { kind: kind as RuleTask["kind"], title, dueInDays: due, owner, notes: clean(t.notes, 300) } };
}
export const ruleKey = (trigger: Trigger, ruleId: string, subject: string, token: string) => `${trigger}|${ruleId}|${subject}|${token}`.slice(0, 120);
export const MAX_RUN_TASKS = 50; export const MAX_ATTEMPTS = 5;

// ------------------------------------------------------------------ fidélité configurable
export type LoyaltyConfig = LoyaltyRules & { perks: { bronze: string; silver: string; gold: string } };
export function normLoyalty(v: unknown, base: LoyaltyRules): LoyaltyConfig {
  const o = (v ?? {}) as Record<string, unknown>; const pick = (k: keyof LoyaltyRules, lo: number, hi: number, l: string) => { const n = o[k] === undefined || o[k] === "" ? base[k] : Number(o[k]); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${l} invalide (${lo} à ${hi})`); return n; };
  const r: LoyaltyRules = { cfaPerPoint: pick("cfaPerPoint", 10, 100_000, "Montant par point"), redeemCfaPerPoint: pick("redeemCfaPerPoint", 1, 1000, "Valeur d'un point"), maxRedeemPct: pick("maxRedeemPct", 0, 100, "Plafond d'utilisation"), silverThreshold: pick("silverThreshold", 1, 1e10, "Seuil Argent"), goldThreshold: pick("goldThreshold", 1, 1e10, "Seuil Or"), silverBonusPct: pick("silverBonusPct", 0, 100, "Bonus Argent"), goldBonusPct: pick("goldBonusPct", 0, 100, "Bonus Or") };
  if (r.silverThreshold >= r.goldThreshold) throw new Error("Le seuil Or doit dépasser le seuil Argent"); if (r.goldBonusPct < r.silverBonusPct) throw new Error("Le bonus Or ne peut pas être inférieur au bonus Argent");
  const perks = (o.perks ?? {}) as Record<string, unknown>; return { ...r, perks: { bronze: clean(perks.bronze, 120), silver: clean(perks.silver, 120), gold: clean(perks.gold, 120) } };
}
export const describeLoyalty = (c: LoyaltyConfig): string[] => [`1 point gagné par tranche de ${c.cfaPerPoint} FCFA dépensés (hors points utilisés)`, `Argent dès ${c.silverThreshold} FCFA de dépenses annuelles : +${c.silverBonusPct} % de points`, `Or dès ${c.goldThreshold} FCFA : +${c.goldBonusPct} % de points`, `1 point = ${c.redeemCfaPerPoint} FCFA de réduction, dans la limite de ${c.maxRedeemPct} % du total de la vente`, "Les nouvelles règles s'appliquent aux ventes futures : les points déjà acquis et l'historique ne sont jamais recalculés."];

// ------------------------------------------------------------------ ventes croisées : associations observées dans les paniers réels
export type Rule = { a: string; b: string; both: number; countA: number; countB: number; baskets: number; confidence: number; lift: number };
export const MIN_BASKETS = 30, MIN_SUPPORT = 3;
/** Règles A → B : confiance = P(B|A), lift = confiance ÷ P(B). Retenues seulement si A et B figurent ensemble dans ≥ MIN_SUPPORT paniers et que le corpus compte ≥ MIN_BASKETS paniers. */
export function associations(baskets: string[][], minSupport = MIN_SUPPORT): { rules: Rule[]; baskets: number; enough: boolean } {
  const n = baskets.length; const cnt = new Map<string, number>(); const pair = new Map<string, number>();
  for (const raw of baskets) { const b = [...new Set(raw)]; for (const x of b) cnt.set(x, (cnt.get(x) ?? 0) + 1); for (const x of b) for (const y of b) if (x !== y) pair.set(`${x}\u0000${y}`, (pair.get(`${x}\u0000${y}`) ?? 0) + 1); }
  const rules: Rule[] = []; for (const [k, both] of pair) { if (both < minSupport) continue; const [a, b] = k.split("\u0000") as [string, string]; const ca = cnt.get(a)!, cb = cnt.get(b)!; rules.push({ a, b, both, countA: ca, countB: cb, baskets: n, confidence: r2(both / ca), lift: r2((both / ca) / (cb / n)) }); }
  return { rules: rules.sort((x, y) => y.lift - x.lift || y.both - x.both), baskets: n, enough: n >= MIN_BASKETS };
}
/** Suggestions pour un client : produits souvent achetés avec ceux qu'il a déjà achetés (lift > 1), qu'il n'a jamais achetés. */
export function recommend(owned: Set<string>, rules: Rule[], limit = 5): { productId: string; because: string[]; bestConfidence: number; bestLift: number; support: number }[] {
  const m = new Map<string, { productId: string; because: string[]; bestConfidence: number; bestLift: number; support: number }>();
  for (const r of rules) { if (!owned.has(r.a) || owned.has(r.b) || r.lift <= 1) continue; const e = m.get(r.b) ?? { productId: r.b, because: [], bestConfidence: 0, bestLift: 0, support: 0 }; e.because.push(r.a); if (r.confidence > e.bestConfidence) { e.bestConfidence = r.confidence; e.support = r.both; } e.bestLift = Math.max(e.bestLift, r.lift); m.set(r.b, e); }
  return [...m.values()].sort((x, y) => y.bestLift - x.bestLift || y.support - x.support).slice(0, limit);
}
// ------------------------------------------------------------------ réactivation
/** Un contact « réactive » un client resté inactif (> inactiveDays au moment du contact) lorsqu'il achète dans la fenêtre qui suit. */
export function reactivation(contactedAt: number, windowDays: number, sales: { at: number; net: number }[], inactiveDays: number): { eligible: boolean; reactivated: boolean; amount: number } {
  const before = sales.filter((x) => x.at <= contactedAt).map((x) => x.at); const last = before.length ? Math.max(...before) : null; const eligible = last !== null && (contactedAt - last) / DAY > inactiveDays; const a = attribute(contactedAt, windowDays, sales);
  return { eligible, reactivated: eligible && a.count > 0, amount: eligible ? a.amount : 0 };
}
