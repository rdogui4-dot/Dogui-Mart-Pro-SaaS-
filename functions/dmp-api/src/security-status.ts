import { UNMEASURED, evaluateStatus, scoreOf, type StatusInput } from "../../../src/domain/security-status";
import { normAt } from "../../../src/domain/security-events";
import { parseHost } from "./hosting";
import { PLATFORM_JOURNAL, purgeSecurityEvents, readJournal, recordSecurityEvent } from "./security-log";
import { HttpError, need, type Ctx, type Store } from "./store";

/** Centre de sécurité : état MESURÉ du commerce (propriétaire seulement). Chaque lecture qui échoue donne « inconnu », jamais « ok ». */
export async function securityStatus(store: Store, ctx: Ctx) {
  need(ctx, "owner"); const now = new Date().toISOString();
  const [sub, owners, journal] = await Promise.all([store.get("subscriptions", ctx.tenantId).catch(() => null), store.listOwners(ctx.tenantId).then((l) => l, () => null), readJournal(store, ctx.tenantId).catch(() => null)]);
  const mfas = owners ? await Promise.all(owners.map(async (o) => ({ userId: o.userId, mfa: ctx.probe?.noMfa ? null : await store.userSecurity(o.userId).then((u) => u.mfa, () => null) as boolean | null }))) : null;
  const since = Date.parse(now) - 24 * 3_600_000;
  const denied24h = journal ? journal.rows.filter((r) => String(r.kind).startsWith("access.denied.") && Date.parse(normAt(String(r.at))) >= since).reduce((n, r) => n + Number(r.count ?? 1), 0) : 0;
  const mine = sub && sub.tenantId === ctx.tenantId ? sub : null;
  const input: StatusInput = {
    now, owners: mfas, subscription: mine ? { status: String(mine.status), renewsAt: mine.renewsAt ? String(mine.renewsAt) : undefined } : null,
    host: mine ? (() => { const h = parseHost(mine.hostedBy); return { hosted: !!h, name: h?.name }; })() : null,
    station: ctx.probe?.station?.() ?? null, backups: ctx.probe?.backups?.() ?? null,
    journal: journal ? { denied24h, total: journal.total } : null,
    chain: journal ? { ok: journal.chain.ok, checked: journal.chain.checked, problems: journal.chain.problems, fromStart: journal.chain.fromStart && !journal.truncated } : null,
  };
  const checks = evaluateStatus(input);
  return { measuredAt: now, checks, ...scoreOf(checks), limits: [...UNMEASURED] };
}

/** Administrateur de la plateforme : purge de rétention (13 mois minimum) du journal d'un commerce ou de celui de la plateforme. Action explicite, journalisée. */
export async function platformSecurityPurge(store: Store, ctx: Ctx, b: { tenantId?: string; months?: number }) {
  if (!ctx.admin) throw new HttpError(403, "Réservé à l'administrateur de la plateforme");
  const tenantId = b.tenantId === undefined || b.tenantId === "" ? PLATFORM_JOURNAL : String(b.tenantId); if (!/^[A-Za-z0-9_-]{1,36}$/.test(tenantId)) throw new HttpError(400, "Identifiant de commerce invalide");
  const r = await purgeSecurityEvents(store, tenantId, { months: b.months });
  if (r.purged > 0) await recordSecurityEvent(store, { tenantId, kind: "security.purge", outcome: "accepted", actorId: ctx.userId, actorRole: "platform", target: `purge:${r.purged}`, source: "cloud" });
  return r;
}

/** Ferme toutes les sessions d'un EMPLOYÉ du commerce (jamais un propriétaire, jamais un compte d'un autre commerce). Action explicite du propriétaire, journalisée (journal de sécurité + journal d'activité). */
export async function revokeStaffSessions(store: Store, ctx: Ctx, b: { userId?: string }) {
  need(ctx, "owner"); const userId = String(b.userId ?? "");
  const s = userId ? await store.get("staff", userId) : null; if (!s || s.tenantId !== ctx.tenantId) throw new HttpError(404, "Employé introuvable");
  const revoked = await store.revokeUserSessions(userId);
  await recordSecurityEvent(store, { tenantId: ctx.tenantId, kind: "staff.sessions.revoke", outcome: "accepted", actorId: ctx.userId, actorRole: "owner", target: "compte:employé", source: ctx.source ?? "cloud" });
  const shopId = (() => { try { const v = JSON.parse(String(s.shopIds ?? "[]")); return Array.isArray(v) && v[0] ? String(v[0]) : ""; } catch { return ""; } })() || String((await store.list("shops", { tenantId: ctx.tenantId }, 1))[0]?.$id ?? ""); // le journal d'activité est rangé par boutique
  await store.create("audit_log", `rv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 36), ctx.tenantId, { tenantId: ctx.tenantId, shopId, userId: ctx.userId, action: "staff.sessions.revoke", detail: `${String(s.name ?? "").slice(0, 60)} : ${revoked} session(s) fermée(s)` });
  return { revoked };
}
