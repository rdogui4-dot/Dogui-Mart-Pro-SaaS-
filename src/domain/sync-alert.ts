/** Alerte de synchronisation du poste (version Windows) : quand faut-il prévenir le propriétaire ? Fonction pure, sans horloge cachée. */
export type HostStatus = { hosted: boolean; stationName?: string; cloudEmail?: string; attachedAt?: string; lastSyncOkAt?: string; lastError?: string; pending: number; conflicts: number; sessionOk: boolean; alertHours: number; failures: number; nextTryAt?: string };
export type SyncAlert = { level: "none" | "warn" | "bad"; title: string; detail: string };

const hoursSince = (iso: string | undefined, now: number): number | null => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? Math.max(0, (now - t) / 36e5) : null; };
export const sinceText = (iso: string | undefined, now: number): string => {
  const h = hoursSince(iso, now); if (h === null) return "jamais"; const m = Math.round(h * 60); if (m < 1) return "à l'instant"; if (m < 60) return `il y a ${m} min`; if (h < 48) return `il y a ${Math.round(h)} h`; return `il y a ${Math.round(h / 24)} jours`;
};
export function syncAlert(s: HostStatus | null | undefined, now: number): SyncAlert {
  const none: SyncAlert = { level: "none", title: "", detail: "" }; if (!s || !s.hosted) return none;
  if (!s.sessionOk) return { level: "bad", title: "Ce poste n'est plus connecté au cloud", detail: "Reconnectez-le (Paramètres → Synchronisation) : tant qu'il ne l'est pas, rien n'est envoyé et les données du cloud ne sont pas à jour." };
  const h = hoursSince(s.lastSyncOkAt ?? s.attachedAt, now); const limit = s.alertHours > 0 ? s.alertHours : 24;
  if (h !== null && h >= limit) return { level: "bad", title: `Pas de synchronisation réussie depuis ${sinceText(s.lastSyncOkAt ?? s.attachedAt, now).replace("il y a ", "")}`, detail: `${s.pending > 0 ? `${s.pending} élément${s.pending > 1 ? "s" : ""} en attente d'envoi. ` : ""}${s.lastError ? `Dernière erreur : ${s.lastError}. ` : ""}Vérifiez la connexion Internet de ce poste.` };
  if (s.failures >= 3) return { level: "warn", title: "La synchronisation échoue à répétition", detail: `${s.lastError ?? "Erreur inconnue"}. Les ventes restent enregistrées sur ce poste et partiront dès que la connexion reviendra.` };
  return none;
}
