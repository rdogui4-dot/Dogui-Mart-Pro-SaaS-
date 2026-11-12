/** MASTER DOGUI : assistant conversationnel, socle sans fournisseur d'IA (étape 5A). Domaine pur : questions guidées, appariement déterministe,
 *  nettoyage, plafonds, contrôle de fondement (prêt pour le branchement d'un modèle de langage, qui rédigera sans jamais calculer). */
export const LIMITS = { question: 600, daily: 30, retentionMonths: 12, title: 80 } as const;
export type Conf = "high" | "medium" | "low";
export type Answer = { qid: string; title: string; conclusion: string; period: { from: string; to: string; label: string } | null; scope: string; facts: { label: string; value: string | number }[]; sources: { module: string; detail: string }[]; method: string; observations: string[]; limits: string[]; confidence: Conf; recommendations: string[] };
export type Guided = { id: string; label: string; keywords: string[]; periodic: boolean; shopLevel: boolean; need: string };
/** Catalogue fermé : chaque question correspond à un outil déterministe en lecture seule. */
export const GUIDED: Guided[] = [
  { id: "sales", label: "Quelles sont mes ventes ?", keywords: ["vente", "ventes", "chiffre", "affaires", "encaisse", "encaissement", "vendu"], periodic: true, shopLevel: true, need: "Caisse" },
  { id: "top", label: "Quels produits se vendent le plus ?", keywords: ["produit", "produits", "meilleur", "meilleurs", "top", "plus vendu", "populaire"], periodic: true, shopLevel: true, need: "Caisse" },
  { id: "stock", label: "Quels articles sont en rupture ou à risque ?", keywords: ["stock", "rupture", "manque", "risque", "reapprovisionner", "reappro", "inventaire"], periodic: false, shopLevel: true, need: "Stock" },
  { id: "cash", label: "Mes écarts de caisse ?", keywords: ["ecart", "ecarts", "caisse", "manquant", "difference"], periodic: true, shopLevel: true, need: "Caisse" },
  { id: "credit", label: "Quel est l'encours de crédit de mes clients ?", keywords: ["credit", "creance", "creances", "dette", "dettes", "impaye", "impayes", "encours"], periodic: false, shopLevel: true, need: "Clients" },
  { id: "recos", label: "Quelles recommandations sont ouvertes ?", keywords: ["recommandation", "recommandations", "conseil", "conseils", "action", "actions", "faire", "priorite", "priorites"], periodic: false, shopLevel: false, need: "MASTER DOGUI" },
  { id: "profile", label: "Que sait MASTER DOGUI de mon entreprise ?", keywords: ["profil", "entreprise", "memoire", "retenu", "sait", "connait"], periodic: false, shopLevel: false, need: "MASTER DOGUI" },
];
export const normalize = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
/** Texte de question nettoyé : caractères de contrôle et balises retirés, borné. Toujours traité comme du contenu, jamais comme une consigne. */
export function cleanQuestion(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const t = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim(); if (!t) return { ok: false, error: "Question vide" }; if (t.length > LIMITS.question) return { ok: false, error: `Question trop longue (${LIMITS.question} caractères au plus)` }; return { ok: true, text: t };
}
export type Match = { kind: "match"; id: string; days: number } | { kind: "none" } | { kind: "ambiguous"; ids: string[] };
export function periodDays(norm: string): number { if (/\b(30|mois)\b/.test(norm)) return 30; if (/\b(7|semaine)\b/.test(norm)) return 7; if (/\b(aujourd|jour)\b/.test(norm)) return 1; return 7; }
/** Appariement déterministe par mots-clés : aucune interprétation libre. Égalité de score : demander de préciser. */
export function matchQuestion(text: string): Match {
  const n = normalize(text); if (!n) return { kind: "none" }; const words = new Set(n.split(" ")); const scored = GUIDED.map((g) => ({ id: g.id, s: g.keywords.filter((k) => (k.includes(" ") ? n.includes(k) : words.has(k))).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return { kind: "none" }; const top = scored.filter((x) => x.s === scored[0]!.s); if (top.length > 1) return { kind: "ambiguous", ids: top.map((x) => x.id) }; return { kind: "match", id: top[0]!.id, days: periodDays(n) };
}
/** Nombres d'un texte (entiers et décimaux, séparateurs d'espaces/virgules ignorés). Sert au contrôle de fondement. */
export function numbersOf(text: string): number[] { return (text.match(/\d[\d\s .,]*\d|\d/g) ?? []).map((m) => Number(m.replace(/[\s ]/g, "").replace(/,/g, "."))).filter((n) => Number.isFinite(n)); }
/** Contrôle de fondement (§7, §9.2) : tout nombre rédigé doit figurer dans les résultats déterministes ; sinon la rédaction est refusée. Les années et jours de date ne sont pas des chiffres métier. */
export function groundedCheck(text: string, allowed: number[]): { ok: boolean; unknown: number[] } {
  const ok = new Set(allowed.map((n) => Math.round(n * 100) / 100)); const unknown = numbersOf(text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")).filter((n) => !ok.has(Math.round(n * 100) / 100)); return { ok: unknown.length === 0, unknown };
}
export const dayKey = (d = new Date()): string => d.toISOString().slice(0, 10);
export const retentionCutoff = (now = Date.now()): string => new Date(now - LIMITS.retentionMonths * 30.44 * 864e5).toISOString();
