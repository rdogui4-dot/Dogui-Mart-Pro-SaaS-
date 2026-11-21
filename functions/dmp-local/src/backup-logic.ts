/** Logique pure des sauvegardes (noms, rotation, alerte) : sans accès disque, testable partout. */
export type BackupKind = "auto" | "manuel" | "avant-restauration";
export const BACKUP_KEEP = 7, BACKUP_KEEP_MIN = 3, BACKUP_KEEP_MAX = 60, MANUAL_KEEP = 20, PRE_RESTORE_KEEP = 5, ALERT_HOURS = 48;
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
export const backupName = (d: Date, kind: BackupKind = "auto"): string => kind === "auto" ? `auto-${d.toISOString().slice(0, 10)}.sqlite` : kind === "manuel" ? `manuel-${stamp(d)}.sqlite` : `avant-restauration-${stamp(d)}.sqlite`;
export const kindOf = (name: string): BackupKind | null => /^auto-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name) ? "auto" : /^manuel-[\dT-]{19}\.sqlite$/.test(name) ? "manuel" : /^avant-restauration-[\dT-]{19}\.sqlite$/.test(name) ? "avant-restauration" : null;
/** Une copie automatique par jour (date UTC). */
export const needsDaily = (names: string[], now: Date): boolean => !names.includes(backupName(now, "auto"));
/** Noms à supprimer pour ne garder que les plus récentes de CHAQUE famille ; les noms inconnus ne sont jamais touchés. */
export function backupsToDelete(names: string[], keep = BACKUP_KEEP): string[] {
  const k = Math.min(BACKUP_KEEP_MAX, Math.max(BACKUP_KEEP_MIN, Math.round(keep)));
  const pick = (kind: BackupKind, n: number) => { const l = names.filter((x) => kindOf(x) === kind).sort(); return l.slice(0, Math.max(0, l.length - n)); };
  return [...pick("auto", k), ...pick("manuel", MANUAL_KEEP), ...pick("avant-restauration", PRE_RESTORE_KEEP)];
}
/** Phrase secrète des exports : 8 caractères au moins (jamais enregistrée). */
export const validPassphrase = (p: unknown): p is string => typeof p === "string" && p.length >= 8 && p.length <= 200;

export type BackupAlert = { level: "none" | "warn" | "bad"; title: string; detail: string };
/** Quand prévenir le propriétaire : aucune sauvegarde VALIDE récente. `lastOkAt` = dernière sauvegarde vérifiée (auto ou manuelle). */
export function backupAlert(a: { lastOkAt?: string | null; hasBackups: boolean; lastFailed?: boolean; externalError?: string | null; now: number; thresholdHours?: number }): BackupAlert {
  const limit = a.thresholdHours ?? ALERT_HOURS; const t = Date.parse(a.lastOkAt ?? ""); const h = Number.isFinite(t) ? Math.max(0, (a.now - t) / 36e5) : null;
  if (h === null) return { level: "bad", title: "Aucune sauvegarde valide", detail: a.hasBackups ? "Les sauvegardes existantes n'ont pas pu être vérifiées. Lancez « Sauvegarder maintenant »." : "Aucune sauvegarde n'a encore été faite. Lancez « Sauvegarder maintenant »." };
  if (h >= limit) return { level: "bad", title: `Dernière sauvegarde valide il y a ${h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " jours"}`, detail: "Les sauvegardes automatiques ne se font pas : vérifiez l'espace disque, puis lancez « Sauvegarder maintenant »." };
  if (a.externalError) return { level: "warn", title: "La copie externe n'a pas pu être faite", detail: a.externalError };
  return { level: "none", title: "", detail: "" };
}
