/** Équipe & Permissions : membres (propriétaires + employés) avec dernière connexion et 2FA lues dans l'annuaire Appwrite, invitations, activité de l'équipe, constats MASTER.
 *  Réservé au propriétaire. Si l'annuaire ne peut pas être lu, les connexions et la 2FA sont signalées « indisponibles », jamais inventées. */
import { MODULES, modulesFor, type Module, type StaffRole } from "../../../src/domain/access";
import { teamInsights, type Member } from "../../../src/domain/team-kit";
import { inviteList } from "./invites";
import { need, type Ctx, type Store, type UserSecurity } from "./store";

const parse = <T,>(s: unknown, fb: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fb; } };
const TEAM_ACTIONS = /^(staff\.|invite\.|shop\.create)/;
const LABEL: Record<string, string> = { "staff.create": "Ajout d'un membre", "staff.update": "Modification d'un membre", "staff.password_reset": "Réinitialisation du mot de passe", "invite.create": "Invitation créée", "invite.renew": "Invitation renvoyée", "invite.revoke": "Invitation annulée", "invite.accept": "Invitation acceptée", "shop.create": "Nouvelle boutique" };

const FIELD: Record<string, string> = { name: "nom", shopIds: "boutiques", role: "rôle", access: "accès", active: "statut" };
/** « Kouamé shopIds,role,access » → « Kouamé : boutiques, rôle, accès » (noms de champs techniques traduits). */
const humanDetail = (d: string) => d.replace(/\s((?:name|shopIds|role|access|active)(?:,(?:name|shopIds|role|access|active))*)$/, (_m, f: string) => ` : ${f.split(",").map((x) => FIELD[x] ?? x).join(", ")}`);

export async function teamOverview(store: Store, ctx: Ctx) {
  need(ctx, "owner");
  const [staffRows, owners, shops, inv, logs] = await Promise.all([
    store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 }).then((r) => r.rows), store.listOwners(ctx.tenantId).catch(() => []),
    store.list("shops", { tenantId: ctx.tenantId }, 100), inviteList(store, ctx), store.scan("audit_log", { tenantId: ctx.tenantId }, { maxRows: 5000 }).then((r) => r.rows),
  ]);
  const shopIds = shops.map((s) => String(s.$id));
  let securityOk = true;
  const sec = async (id: string): Promise<UserSecurity | null> => { try { return await store.userSecurity(id); } catch { securityOk = false; return null; } };
  const members: Member[] = [];
  for (const o of owners) { const s = await sec(o.userId); members.push({ userId: o.userId, name: o.name || "Propriétaire", login: o.email, role: "owner", active: true, modules: [...MODULES], shopIds, lastLogin: s?.lastLogin ?? null, sessions24h: s?.sessions24h ?? 0, mfa: s ? s.mfa : null, createdAt: "" }); }
  for (const r of staffRows) { const s = await sec(String(r.userId)); members.push({ userId: String(r.userId), name: String(r.name), login: String(r.username || r.email), role: r.role as StaffRole, active: r.active !== false, modules: modulesFor(r.role, r.access) as Module[], shopIds: parse<string[]>(r.shopIds, []), lastLogin: s?.lastLogin ?? null, sessions24h: s?.sessions24h ?? 0, mfa: s ? s.mfa : null, createdAt: String(r.$createdAt ?? "") }); }
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const at = (r: Record<string, unknown>) => String(r.$createdAt ?? "");
  const activity = logs.filter((r) => TEAM_ACTIONS.test(String(r.action))).sort((a, b) => at(b).localeCompare(at(a))).slice(0, 30)
    .map((r) => ({ id: String(r.$id), at: at(r), action: String(r.action), label: LABEL[String(r.action)] ?? String(r.action), detail: humanDetail(String(r.detail ?? "")), by: names.get(String(r.userId)) ?? "—" }));
  const active = members.filter((m) => m.active);
  const pending = inv.invites.filter((i) => i.status === "pending").length, expired = inv.invites.filter((i) => i.status === "expired").length;
  return {
    members, invites: inv.invites, activity, shops: shops.map((s) => ({ id: String(s.$id), name: String(s.name) })),
    counts: { members: members.length, active: active.length, roles: new Set(members.map((m) => m.role)).size, logins24h: securityOk ? members.reduce((n, m) => n + m.sessions24h, 0) : null, mfa: securityOk ? active.filter((m) => m.mfa).length : null, pendingInvites: pending },
    securityAvailable: securityOk,
    insights: teamInsights(members, shops.length, { mfaKnown: securityOk, pendingInvites: pending, expiredInvites: expired }),
    note: securityOk ? "Connexions et double authentification lues dans l'annuaire Appwrite." : "Annuaire des connexions indisponible : dernières connexions et 2FA non affichées.",
  };
}
