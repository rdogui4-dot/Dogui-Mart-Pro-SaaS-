/** CRM Business : règles pures partagées (étapes du pipeline, probabilités, inactivité, segments, validation). */
export const DAY = 864e5;
export type Stage = "new" | "contacted" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export const STAGES: Stage[] = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
export const OPEN_STAGES: Stage[] = ["new", "contacted", "qualified", "proposal", "negotiation"];
export const STAGE_LABEL: Record<Stage, string> = { new: "Nouveau", contacted: "Contacté", qualified: "Qualifié", proposal: "Proposition", negotiation: "Négociation", won: "Gagné", lost: "Perdu" };
/** Probabilité indicative par étape (modifiable par opportunité) : une estimation commerciale, jamais une garantie. */
export const STAGE_PROB: Record<Stage, number> = { new: 10, contacted: 20, qualified: 40, proposal: 60, negotiation: 80, won: 100, lost: 0 };
export const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);
export const isOpen = (s: Stage): boolean => OPEN_STAGES.includes(s);
/** Étapes ouvertes : tout déplacement libre entre elles (avancer ou revenir en arrière). « Gagné » d'un prospect = conversion réelle en client ; « Perdu » exige un motif ; une étape clôturée ne se rouvre que par un gérant. */
export const canMove = (from: Stage, to: Stage, manager: boolean): { ok: boolean; why?: string } => {
  if (from === to) return { ok: false, why: "Déjà à cette étape" };
  if (!isOpen(from) && !manager) return { ok: false, why: "Une étape clôturée ne se rouvre que par un gérant" };
  if (!isOpen(from) && to !== "new" && to !== "contacted" && to !== "qualified" && to !== "proposal" && to !== "negotiation") return { ok: false, why: "Rouvrez d'abord l'élément" };
  return { ok: true };
};
export const weighted = (value: number, probability: number): number => Math.round((Math.max(0, value) * Math.min(100, Math.max(0, probability))) / 100);

export const SOURCES: Record<string, string> = { walkin: "Passage en boutique", referral: "Recommandation", social: "Réseaux sociaux", whatsapp: "WhatsApp", phone: "Appel entrant", web: "Site / annonce", event: "Salon / événement", other: "Autre" };
export const TASK_KINDS: Record<string, string> = { call: "Appel", meeting: "Rendez-vous", task: "Tâche", followup: "Relance" };
export const EVENT_KINDS: Record<string, string> = { note: "Note", call: "Appel", meeting: "Rendez-vous", whatsapp: "WhatsApp", email: "E-mail", stage: "Changement d'étape", conversion: "Conversion en client", task: "Tâche", consent: "Consentements", create: "Création", lost: "Perdu", reopen: "Réouverture" };
export type TaskStatus = "open" | "done" | "cancelled";
export const TASK_LABEL: Record<TaskStatus, string> = { open: "À faire", done: "Faite", cancelled: "Annulée" };
export const isOverdue = (dueAt: number, status: TaskStatus, now: number): boolean => status === "open" && dueAt > 0 && dueAt < now;

// ------------------------------------------------------------------ clients : activité réelle déduite des ventes confirmées
export const DEFAULT_INACTIVE_DAYS = 60; export const DORMANT_DAYS = 180;
export type Segment = "new" | "active" | "loyal" | "inactive" | "dormant" | "never";
export const SEGMENT_LABEL: Record<Segment, string> = { new: "Nouveau client", active: "Actif", loyal: "Fidèle", inactive: "Inactif (à relancer)", dormant: "Dormant", never: "Sans achat" };
/** Segment d'un client à partir de ses seules ventes confirmées : jamais de segment inventé. Fidèle = ≥ 5 achats dont un récent. */
export function segmentOf(i: { salesCount: number; firstSaleAt: number | null; lastSaleAt: number | null; now: number; inactiveDays?: number }): Segment {
  if (!i.salesCount || !i.lastSaleAt) return "never"; const since = (i.now - i.lastSaleAt) / DAY; const lim = i.inactiveDays ?? DEFAULT_INACTIVE_DAYS;
  if (since > DORMANT_DAYS) return "dormant"; if (since > lim) return "inactive"; if (i.salesCount >= 5) return "loyal"; if (i.firstSaleAt && (i.now - i.firstSaleAt) / DAY <= 30) return "new"; return "active";
}
export const daysSince = (t: number | null, now: number): number | null => (t ? Math.floor((now - t) / DAY) : null);

// ------------------------------------------------------------------ validation des entrées
export const clean = (v: unknown, max: number): string => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** Téléphone : chiffres, + initial, espaces tolérés ; 6 à 15 chiffres. Renvoie la forme normalisée (sans espaces) ou null. */
export function normPhone(v: unknown): string | null { const raw = String(v ?? "").trim(); if (!raw) return ""; const digits = raw.replace(/[^\d]/g, ""); if (!/^[+\d][\d\s().-]*$/.test(raw) || digits.length < 6 || digits.length > 15) return null; return (raw.startsWith("+") ? "+" : "") + digits; }
export const normEmail = (v: unknown): string | null => { const e = String(v ?? "").trim().toLowerCase(); if (!e) return ""; return e.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null; };
export type Consents = { sms: boolean; email: boolean; whatsapp: boolean; at?: string; by?: string };
export type ConsentSet = { sms: boolean; email: boolean; whatsapp: boolean; call: boolean };
export const normConsents = (v: unknown): ConsentSet => { const o = (v ?? {}) as Record<string, unknown>; return { sms: o.sms === true, email: o.email === true, whatsapp: o.whatsapp === true, call: o.call === true }; };
export const sameConsents = (a: ConsentSet, b: ConsentSet) => a.sms === b.sms && a.email === b.email && a.whatsapp === b.whatsapp && a.call === b.call;
export const normTags = (v: unknown): string[] => { const xs = Array.isArray(v) ? v : String(v ?? "").split(","); return [...new Set(xs.map((x) => clean(x, 24).toLowerCase()).filter(Boolean))].slice(0, 12); };
export const dayOf = (v: unknown): string | null => { const s = String(v ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const t = Date.parse(`${s}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null; };
export const normProb = (v: unknown, fb: number): number | null => { if (v === undefined || v === null || v === "") return fb; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };
/** Clé de rapprochement pour détecter un doublon : téléphone ou e-mail normalisés. */
export const contactKeys = (phone: string, email: string): string[] => [...(phone ? [`p:${phone.replace(/\D/g, "").slice(-9)}`] : []), ...(email ? [`e:${email}`] : [])];
