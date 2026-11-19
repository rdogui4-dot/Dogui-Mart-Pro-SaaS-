/** Équipe & Permissions (kit écran « Équipe ») : matrice des droits tirée des MÊMES règles que le serveur, constats MASTER sur l'équipe réelle. Calculs purs. */
import { MODULES, MODULE_LABEL, READ_ONLY_ROLES, ROLE_PRESETS, STAFF_ROLES, isCustomAccess, modulesFor, type Module, type StaffRole } from "./access";

export type MatrixRole = "owner" | StaffRole;
export const MATRIX_ROLES: MatrixRole[] = ["owner", ...STAFF_ROLES];
export const MATRIX_LABEL: Record<MatrixRole, string> = { owner: "Propriétaire", ...Object.fromEntries(STAFF_ROLES.map((r) => [r, ROLE_PRESETS[r].label])) } as Record<MatrixRole, string>;
/** Valeur d'une case : accès complet, consultation seule, ou aucun accès. */
export type Cell = "full" | "read" | "none";
export type MatrixRow = { id: string; label: string; help: string; cells: Record<MatrixRole, Cell> };

/** Accès par module selon le préréglage de chaque rôle (le propriétaire a tout ; le Consultant n'a que la consultation de ses modules). */
export function moduleMatrix(): MatrixRow[] {
  return MODULES.map((m) => ({ id: m, label: MODULE_LABEL[m], help: "Préréglage du rôle ; le propriétaire peut personnaliser les accès de chaque membre.",
    cells: Object.fromEntries(MATRIX_ROLES.map((r) => [r, r === "owner" ? "full" : !ROLE_PRESETS[r].modules.includes(m) ? "none" : READ_ONLY_ROLES.includes(r) ? "read" : "full"])) as Record<MatrixRole, Cell> }));
}
const only = (roles: MatrixRole[]): Record<MatrixRole, Cell> => Object.fromEntries(MATRIX_ROLES.map((r) => [r, roles.includes(r) ? "full" : "none"])) as Record<MatrixRole, Cell>;
/** Actions réservées, contrôlées par rôle côté serveur quels que soient les modules accordés. */
export const RESERVED: MatrixRow[] = [
  { id: "team", label: "Gérer l'équipe et les invitations", help: "Création, rôles, accès, désactivation, mots de passe.", cells: only(["owner"]) },
  { id: "shops", label: "Créer des boutiques", help: "Et les informations de l'entreprise (logo).", cells: only(["owner"]) },
  { id: "billing", label: "Abonnement et paiements", help: "Payer, reçus de paiement.", cells: only(["owner"]) },
  { id: "manage", label: "Journal d'activité, remises et plafonds de crédit", help: "Pilotage quotidien de la boutique.", cells: only(["owner", "manager"]) },
];

export type Member = { userId: string; name: string; login: string; role: MatrixRole; active: boolean; modules: Module[]; shopIds: string[]; lastLogin: string | null; sessions24h: number; mfa: boolean | null; createdAt: string };
export type TeamInsight = { id: string; text: string; tone: "ok" | "warn" | "info" };
const days = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / 864e5);

/** Constats calculés sur l'équipe réelle. `mfaKnown` = false si l'annuaire n'a pas pu être lu (aucun constat 2FA inventé). */
export function teamInsights(members: Member[], shopCount: number, opts: { now?: number; mfaKnown: boolean; pendingInvites: number; expiredInvites: number }): TeamInsight[] {
  const now = opts.now ?? Date.now(); const out: TeamInsight[] = []; const staff = members.filter((m) => m.role !== "owner");
  const active = staff.filter((m) => m.active);
  const dormant = active.filter((m) => (m.lastLogin ? days(m.lastLogin, now) >= 30 : days(m.createdAt || new Date(now).toISOString(), now) >= 30));
  if (dormant.length) out.push({ id: "dormant", tone: "warn", text: `${dormant.length} compte(s) actif(s) sans connexion depuis 30 jours ou plus : ${dormant.slice(0, 3).map((m) => m.name).join(", ")}${dormant.length > 3 ? "…" : ""}. Désactivez-les s'ils ne servent plus.` });
  const custom = active.filter((m) => m.role !== "owner" && isCustomAccess(m.role, m.modules) && m.modules.some((x) => !modulesFor(m.role).includes(x)));
  if (custom.length) out.push({ id: "custom", tone: "info", text: `${custom.length} membre(s) ont des accès plus larges que leur rôle : ${custom.slice(0, 3).map((m) => m.name).join(", ")}. Vérifiez que c'est voulu.` });
  const allShops = active.filter((m) => m.role === "manager" && shopCount > 1 && m.shopIds.length >= shopCount);
  if (allShops.length) out.push({ id: "allshops", tone: "info", text: `${allShops.length} gérant(s) affecté(s) à toutes les boutiques (${shopCount}).` });
  if (opts.mfaKnown) { const no = members.filter((m) => m.active && m.mfa === false); if (no.length) out.push({ id: "mfa", tone: "info", text: `${no.length} compte(s) sur ${members.filter((m) => m.active).length} sans double authentification (2FA). Sa mise en place fera l'objet d'un lot dédié.` }); }
  if (opts.expiredInvites) out.push({ id: "expired", tone: "info", text: `${opts.expiredInvites} invitation(s) expirée(s) : renvoyez un nouveau lien ou annulez-les.` });
  if (!out.length) out.push({ id: "ok", tone: "ok", text: `Aucun point d'attention : ${active.length} employé(s) actif(s), accès conformes à leur rôle.` });
  return out;
}
