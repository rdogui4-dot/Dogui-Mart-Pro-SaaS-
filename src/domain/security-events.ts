/** Journal de sécurité : définitions pures (liste fermée d'événements, chaînage SHA-256, vérification).
 *  Aucun texte libre : chaque événement est décrit par des champs courts et contrôlés, pour qu'aucune donnée personnelle ou secret n'y entre par accident. */
import { createHash } from "node:crypto";

export type Severity = "info" | "warning" | "critical";
export type Outcome = "accepted" | "denied" | "failed";
export type EventSource = "cloud" | "poste";

/** Liste fermée : un événement hors liste est refusé à l'écriture. */
export const EVENT_KINDS = {
  "access.denied.unauthenticated": { severity: "warning", label: "Appel sans identité refusé", scope: "platform" },
  "access.denied.not_member": { severity: "warning", label: "Accès refusé : compte étranger au commerce", scope: "platform" },
  "access.denied.platform": { severity: "warning", label: "Accès refusé à l'administration de la plateforme", scope: "platform" },
  "access.denied.shop": { severity: "warning", label: "Accès refusé : boutique non affectée ou inconnue", scope: "tenant" },
  "access.denied.readonly": { severity: "info", label: "Action refusée : compte en consultation seule", scope: "tenant" },
  "access.denied.forbidden": { severity: "warning", label: "Action refusée : droits insuffisants", scope: "tenant" },
  "staff.create": { severity: "info", label: "Employé créé", scope: "tenant" },
  "staff.update": { severity: "info", label: "Employé modifié (rôle, boutiques, état)", scope: "tenant" },
  "staff.rights": { severity: "warning", label: "Droits d'un employé modifiés", scope: "tenant" },
  "staff.resetPassword": { severity: "warning", label: "Mot de passe d'un employé réinitialisé", scope: "tenant" },
  "staff.invite.create": { severity: "info", label: "Invitation créée", scope: "tenant" },
  "staff.invite.renew": { severity: "info", label: "Invitation renouvelée", scope: "tenant" },
  "staff.invite.revoke": { severity: "info", label: "Invitation révoquée", scope: "tenant" },
  "host.claim": { severity: "warning", label: "Un poste devient la référence du commerce", scope: "tenant" },
  "host.release": { severity: "warning", label: "Le commerce est rendu au cloud", scope: "tenant" },
  "backup.export": { severity: "warning", label: "Sauvegarde chiffrée exportée", scope: "tenant" },
  "backup.restore": { severity: "critical", label: "Sauvegarde restaurée", scope: "tenant" },
  "station.attach": { severity: "warning", label: "Poste rattaché au cloud", scope: "tenant" },
  "sync.conflict": { severity: "info", label: "Conflit de synchronisation à examiner", scope: "tenant" },
  "hook.rejected": { severity: "warning", label: "Notification de paiement rejetée (jeton invalide)", scope: "platform" },
  "hook.accepted": { severity: "info", label: "Notification de paiement reçue", scope: "platform" },
  "hook.duplicate": { severity: "info", label: "Notification de paiement en double ignorée", scope: "platform" },
  "platform.subscription.grant": { severity: "warning", label: "Abonnement accordé par la plateforme", scope: "platform" },
  "platform.subscription.lifetime": { severity: "warning", label: "Accès à vie accordé", scope: "platform" },
  "platform.master.activate": { severity: "warning", label: "Licence MASTER activée par la plateforme", scope: "platform" },
  "platform.settings.save": { severity: "warning", label: "Réglages de la plateforme modifiés", scope: "platform" },
  "platform.master.hook.rotate": { severity: "critical", label: "Jeton du webhook de paiement renouvelé", scope: "platform" },
  "platform.master.hook.save": { severity: "warning", label: "Configuration du webhook de paiement modifiée", scope: "platform" },
  "platform.payment.review": { severity: "info", label: "Paiement examiné par la plateforme", scope: "platform" },
} as const satisfies Record<string, { severity: Severity; label: string; scope: "tenant" | "platform" }>;
export type EventKind = keyof typeof EVENT_KINDS;
export const isEventKind = (k: unknown): k is EventKind => typeof k === "string" && Object.hasOwn(EVENT_KINDS, k);

/** Actions réussies de `dmp-api` qui produisent un événement (le nom de l'action est aussi le nom de l'événement). */
export const SUCCESS_ACTIONS: readonly EventKind[] = ["staff.create", "staff.update", "staff.rights", "staff.resetPassword", "staff.invite.create", "staff.invite.renew", "staff.invite.revoke", "host.claim", "host.release",
  "platform.subscription.grant", "platform.subscription.lifetime", "platform.master.activate", "platform.settings.save", "platform.master.hook.rotate", "platform.master.hook.save", "platform.payment.review"];

export const GENESIS = "0".repeat(64);
export type EventFields = { tenantId: string; seq: number; at: string; kind: string; severity: string; outcome: string; actorId: string; actorRole: string; target: string; requestId: string; source: string };
/** Empreinte d'un événement : liée à celle du précédent. `count` et `lastAt` (compteurs de regroupement) n'en font volontairement pas partie. */
export const eventHash = (prevHash: string, e: EventFields): string =>
  createHash("sha256").update(JSON.stringify([prevHash, e.tenantId, e.seq, e.at, e.kind, e.severity, e.outcome, e.actorId, e.actorRole, e.target, e.requestId, e.source])).digest("hex");

/** Cible : champ court et contrôlé (identifiants et noms d'action seulement). */
export const cleanTarget = (prefix: string, v: unknown): string => { const s = String(v ?? ""); return `${prefix}:${/^[A-Za-z0-9._-]{1,64}$/.test(s) ? s : "invalide"}`; };

export type ChainRow = EventFields & { prevHash: string; hash: string };
export type ChainReport = { ok: boolean; checked: number; firstSeq: number | null; lastSeq: number | null; problems: string[]; /** vrai si la lecture part du début (événement n° 1) */ fromStart: boolean };
/** Vérifie une suite d'événements d'un même commerce : numéros consécutifs, empreinte recalculée, liaison avec le précédent. Une suite qui ne commence pas à 1 n'est vérifiée qu'à partir de son premier élément. */
export function verifyChain(rows: ChainRow[], head?: { seq: number; hash: string } | null): ChainReport {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq); const problems: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!; if (r.hash !== eventHash(r.prevHash, r)) problems.push(`n°${r.seq} : empreinte invalide (ligne modifiée)`);
    if (i === 0) { if (r.seq === 1 && r.prevHash !== GENESIS) problems.push("n°1 : origine invalide"); }
    else { const p = sorted[i - 1]!; if (r.seq !== p.seq + 1) problems.push(`rupture : n°${p.seq + 1} à ${r.seq - 1} absents (supprimés ?)`); else if (r.prevHash !== p.hash) problems.push(`n°${r.seq} : ne suit pas n°${p.seq}`); }
  }
  const last = sorted[sorted.length - 1];
  if (head && last && last.seq <= head.seq) { if (last.seq < head.seq) problems.push(`événements n°${last.seq + 1} à ${head.seq} absents (supprimés ?)`); else if (last.hash !== head.hash) problems.push("dernier événement différent du pointeur de chaîne"); }
  if (head && !last && head.seq > 0) problems.push(`tous les événements (n°1 à ${head.seq}) sont absents`);
  return { ok: problems.length === 0, checked: sorted.length, firstSeq: sorted[0]?.seq ?? null, lastSeq: last?.seq ?? null, problems, fromStart: sorted[0]?.seq === 1 };
}
