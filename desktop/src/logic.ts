/** Logique pure de l'application Windows (aucune dépendance Electron : testable partout). */
export type Mode = "main" | "secondary";
export type DesktopConfig = { mode?: Mode; port: number; autostart: boolean; /** poste secondaire : adresse du poste principal (origine https) */ mainOrigin?: string; /** poste secondaire : empreinte SHA-256 du certificat du poste principal, validée par l'utilisateur */ pinnedFingerprint?: string; lastBackupAt?: string };
export const DEFAULT_PORT = 8443;
export const DEFAULT_CONFIG: DesktopConfig = { port: DEFAULT_PORT, autostart: true };

/** Relit la configuration enregistrée : toute valeur douteuse retombe sur le défaut (un fichier abîmé ne doit jamais empêcher de démarrer). */
export function parseConfig(raw: unknown): DesktopConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>; const out: DesktopConfig = { ...DEFAULT_CONFIG };
  if (o.mode === "main" || o.mode === "secondary") out.mode = o.mode;
  if (Number.isInteger(o.port) && (o.port as number) >= 1024 && (o.port as number) <= 65535) out.port = o.port as number;
  if (typeof o.autostart === "boolean") out.autostart = o.autostart;
  if (typeof o.mainOrigin === "string" && normalizeAddress(o.mainOrigin).ok) out.mainOrigin = (normalizeAddress(o.mainOrigin) as { ok: true; origin: string }).origin;
  if (typeof o.pinnedFingerprint === "string" && isFingerprint(o.pinnedFingerprint)) out.pinnedFingerprint = o.pinnedFingerprint.toUpperCase();
  if (typeof o.lastBackupAt === "string" && Number.isFinite(Date.parse(o.lastBackupAt))) out.lastBackupAt = o.lastBackupAt;
  if (out.mode === "secondary" && (!out.mainOrigin || !out.pinnedFingerprint)) { delete out.mode; delete out.mainOrigin; delete out.pinnedFingerprint; } // poste secondaire incomplet : on redemande
  return out;
}

export const isFingerprint = (s: string): boolean => /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(s);
/** Comparaison d'empreintes (insensible à la casse) ; une empreinte absente ou mal formée ne correspond jamais. */
export const samePin = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && isFingerprint(a) && isFingerprint(b) && a.toUpperCase() === b.toUpperCase();

const PRIVATE_V4 = (h: string): boolean => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); if (!m) return false; const p = m.slice(1).map(Number); if (p.some((n) => n > 255)) return false; return p[0] === 10 || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || p[0] === 127; };
/** Adresse saisie pour le poste principal → origine https. Réseau local uniquement (adresses privées, noms « .local » ou sans point) : jamais une adresse d'Internet. */
export function normalizeAddress(input: string): { ok: true; origin: string; host: string; port: number } | { ok: false; error: string } {
  let s = String(input ?? "").trim(); if (!s) return { ok: false, error: "Saisissez l'adresse du poste principal (par exemple 192.168.1.20 ou dogui.local)" };
  if (/^http:\/\//i.test(s)) return { ok: false, error: "Le poste principal doit être joint en HTTPS (https://…)" };
  if (!/^https:\/\//i.test(s)) s = `https://${s}`;
  let u: URL; try { u = new URL(s); } catch { return { ok: false, error: "Adresse invalide" }; }
  if (u.username || u.password) return { ok: false, error: "Adresse invalide (pas d'identifiant dans l'adresse)" }; if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return { ok: false, error: "Saisissez seulement l'adresse du poste (sans chemin)" };
  const host = u.hostname.toLowerCase(); const local = PRIVATE_V4(host) || host.endsWith(".local") || (!host.includes(".") && !host.includes(":") && /^[a-z0-9-]+$/.test(host));
  if (!local) return { ok: false, error: "Cette adresse n'est pas une adresse du réseau local : le poste principal doit être sur le même réseau (adresse commençant par 192.168., 10., ou nom en .local)" };
  const port = u.port ? Number(u.port) : DEFAULT_PORT; if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: "Port invalide" };
  return { ok: true, origin: `https://${host}:${port}`, host, port };
}

/** Navigation autorisée dans la fenêtre : uniquement l'origine du poste (jamais un autre site dans cette fenêtre). */
export const isAllowedNavigation = (url: string, origin: string): boolean => { try { return new URL(url).origin === new URL(origin).origin; } catch { return false; } };
/** Liens externes (WhatsApp, e-mail…) : ouverts dans le navigateur du système, en https seulement. */
export const isSafeExternal = (url: string): boolean => { try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "mailto:" || u.protocol === "tel:"; } catch { return false; } };

/** Sauvegarde automatique quotidienne : une copie par jour, 7 conservées. */
export const BACKUP_KEEP = 7;
export const backupName = (d: Date): string => `auto-${d.toISOString().slice(0, 10)}.sqlite`;
export const needsBackup = (lastIso: string | undefined, now: Date): boolean => !lastIso || lastIso.slice(0, 10) !== now.toISOString().slice(0, 10);
/** Noms à supprimer pour ne garder que les `keep` plus récentes sauvegardes automatiques (les autres fichiers, notamment « avant-restauration-… », ne sont jamais touchés). */
export function backupsToDelete(names: string[], keep = BACKUP_KEEP): string[] {
  const auto = names.filter((n) => /^auto-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort(); return auto.slice(0, Math.max(0, auto.length - keep));
}
