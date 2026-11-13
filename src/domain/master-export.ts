/** MASTER DOGUI — exports PDF / Excel / CSV : conversion des rapports, recommandations et réponses de l'assistant vers le modèle d'export commun (`ReportData`). Fonctions pures, testées ; aucun calcul : on exporte exactement ce que l'écran affiche. */
import type { ReportData, Section } from "./exports";
import type { Answer } from "./master-chat";
import { PRIO_LABEL, type Prio, type Report } from "./master-report";

const dayOf = (iso: string) => (iso || "").slice(0, 10);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 16);
const PRIO: Record<string, string> = PRIO_LABEL;
const KIND: Record<string, string> = { fact: "Fait constaté", estimate: "Estimation" };

/** Rapport d'ouverture ou de clôture. Une section indisponible est exportée avec sa raison, jamais omise. */
export function reportToData(rep: Report, meta: { statusLabel?: string; version?: number; generatedAt?: string; tz?: string } = {}): ReportData {
  const sections: Section[] = rep.sections.map((s) => s.available ? { name: s.title, columns: ["Indicateur", "Valeur", "Note", "Source"], rows: s.items.map((i) => [i.label, i.value, i.note ?? "", s.source]) } : { name: s.title, columns: ["Indicateur", "Raison"], rows: [["Section indisponible", s.reason ?? "donnée manquante"]] });
  if (rep.alerts.length) sections.push({ name: "Alertes", columns: ["Priorité", "Alerte", "Source"], rows: rep.alerts.map((a) => [PRIO[a.prio as Prio] ?? a.prio, a.text, a.source]) });
  if (rep.recommendations.length) sections.push({ name: "Recommandations", columns: ["Priorité", "Recommandation", "Motif", "Source", "Nature"], rows: rep.recommendations.map((x) => [PRIO[x.prio as Prio] ?? x.prio, x.text, x.reason, x.source, KIND[x.kind] ?? x.kind]) });
  if (rep.missing.length) sections.push({ name: "Données manquantes", columns: ["Section", "Raison"], rows: rep.missing.map((m) => [m.section, m.reason]) });
  return { title: rep.title, generatedAt: meta.generatedAt ? meta.generatedAt.replace("T", " ").slice(0, 16) : now(), tz: meta.tz ?? "UTC", period: { from: dayOf(rep.period.from) || rep.businessDate, to: dayOf(rep.period.to) || rep.businessDate }, scope: [rep.scope], filters: {}, notes: [`Statut : ${meta.statusLabel ?? "—"}${meta.version ? ` (version ${meta.version})` : ""}`, `Méthode : ${rep.method}`, `Confiance : ${rep.confidence}`, ...rep.limits], sections };
}

export type RecoRow = { title: string; rule: string; module: string; shopName: string; prio: string; reason: string; statusLabel: string; confidenceLabel: string; kind: string; createdAt: string; statusAt: string; note: string; limits: string; followUp: { text: string } | null };
/** Liste des recommandations telle qu'affichée (filtres de l'écran respectés par l'appelant). */
export function recosToData(rows: RecoRow[], meta: { scope: string; filter: string }): ReportData {
  const d = new Date().toISOString().slice(0, 10);
  return { title: "Recommandations MASTER DOGUI", generatedAt: now(), tz: "UTC", period: { from: d, to: d }, scope: [meta.scope], filters: meta.filter ? { statut: [meta.filter] } : {}, notes: ["Chaque recommandation cite son motif et ses sources ; le suivi est un relevé daté entre deux dates, non attribué à l'action.", "Aucune promesse de résultat commercial ou financier."],
    sections: [{ name: "Recommandations", columns: ["Priorité", "Recommandation", "Règle", "Module", "Boutique", "Motif", "Statut", "Confiance", "Nature", "Créée le", "Dernière décision", "Note", "Limites", "Suivi"], rows: rows.map((r) => [PRIO[r.prio as Prio] ?? r.prio, r.title, r.rule, r.module, r.shopName || "Entreprise", r.reason, r.statusLabel, r.confidenceLabel, KIND[r.kind] ?? r.kind, dayOf(r.createdAt), dayOf(r.statusAt), r.note, r.limits, r.followUp?.text ?? ""]) }] };
}

/** Une réponse de l'assistant (chiffres, observations, sources, limites, mode de rédaction). */
export function answerToData(a: Answer, question: string): ReportData {
  const d = new Date().toISOString().slice(0, 10); const sections: Section[] = [{ name: "Chiffres", columns: ["Indicateur", "Valeur"], rows: a.facts.map((f) => [f.label, f.value]) }];
  if (a.observations.length) sections.push({ name: "Observations", columns: ["Observation"], rows: a.observations.map((o) => [o.replace(/^•\s*/, "")]) });
  if (a.recommendations.length) sections.push({ name: "Recommandations", columns: ["Recommandation"], rows: a.recommendations.map((o) => [o]) });
  sections.push({ name: "Sources", columns: ["Module", "Détail"], rows: a.sources.map((s) => [s.module, s.detail]) });
  return { title: `Assistant — ${a.title}`, generatedAt: now(), tz: "UTC", period: { from: a.period?.from || d, to: a.period?.to || d }, scope: [a.scope || "Entreprise"], filters: { question: [question] },
    notes: [`Conclusion : ${a.conclusion}`, `Méthode : ${a.method || "—"}`, `Confiance : ${a.confidence}`, a.ai?.used ? `Rédaction par IA (${a.ai.model ?? "modèle"}, prompt ${a.ai.prompt ?? "—"}) ; chiffres calculés et vérifiés par MASTER DOGUI.` : "Calculé par MASTER DOGUI, sans IA.", ...a.limits], sections };
}
