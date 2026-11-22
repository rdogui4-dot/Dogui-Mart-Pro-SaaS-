/** Invitations d'équipe (décision K18 2a) : lien à usage unique, valable 7 jours, que le propriétaire partage lui-même (copie, QR).
 *  Aucun e-mail n'est envoyé (prestataires externes suspendus). Seule l'empreinte SHA-256 du jeton est enregistrée : le lien n'est montré qu'à la création ou au renvoi.
 *  L'invité choisit son identifiant et son mot de passe ; le compte reçoit le rôle, les accès et les boutiques fixés par le propriétaire. */
import { ROLE_PRESETS, type Module, type StaffRole } from "../../../src/domain/access";
import { accessOf, createStaffAccount, ownShops, validRole } from "./team";
import { assertQuota, assertWritable } from "./subscriptions";
import { HttpError, need, type Ctx, type Store } from "./store";

export const INVITE_DAYS = 7;
export const PUBLIC_ACTIONS: ReadonlySet<string> = new Set(["invite.peek", "invite.accept", "health.ping"]);
const safeId = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);
const parse = <T,>(s: unknown, fb: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fb; } };
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const hashToken = async (t: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const audit = (store: Store, tenantId: string, shopId: string, userId: string, action: string, detail: string) =>
  store.create("audit_log", crypto.randomUUID().replace(/-/g, "").slice(0, 30), tenantId, { tenantId, shopId, userId, action, detail: detail.slice(0, 500) });

export type InviteView = { id: string; name: string; role: StaffRole; roleLabel: string; modules: Module[]; shopIds: string[]; status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: string; createdAt: string; acceptedAt?: string };
const statusOf = (r: Record<string, unknown>, now = Date.now()): InviteView["status"] => (r.status === "pending" && new Date(String(r.expiresAt)).getTime() < now ? "expired" : (r.status as InviteView["status"]));
const view = (r: Record<string, unknown>): InviteView => ({ id: String(r.$id), name: String(r.name), role: r.role as StaffRole, roleLabel: ROLE_PRESETS[r.role as StaffRole]?.label ?? String(r.role), modules: parse<Module[]>(r.access, []), shopIds: parse<string[]>(r.shopIds, []), status: statusOf(r), expiresAt: String(r.expiresAt), createdAt: String(r.$createdAt ?? ""), acceptedAt: r.acceptedAt ? String(r.acceptedAt) : undefined });

/** Crée une invitation ; renvoie le jeton UNE seule fois. Idempotente par inviteId (une reprise ne crée pas deux invitations ; le jeton n'est pas renvoyé). */
export async function inviteCreate(store: Store, ctx: Ctx, b: { inviteId: string; name: string; role: string; access?: unknown; shopIds: string[] }) {
  need(ctx, "owner");
  const id = safeId(b.inviteId); if (id.length < 8) throw new HttpError(400, "inviteId invalide");
  const existing = await store.get("staff_invites", id);
  if (existing) { if (existing.tenantId !== ctx.tenantId) throw new HttpError(409, "Identifiant déjà utilisé"); return { invite: view(existing), token: null, duplicate: true }; }
  const name = String(b.name ?? "").trim().slice(0, 100); if (!name) throw new HttpError(400, "Nom requis");
  const role = validRole(b.role); const modules = accessOf(role, b.access); const shopIds = await ownShops(store, ctx, b.shopIds);
  await assertQuota(store, ctx.tenantId, "users");
  const token = newToken(); const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  await store.create("staff_invites", id, ctx.tenantId, { tenantId: ctx.tenantId, tokenHash: await hashToken(token), name, role, access: JSON.stringify(modules), shopIds: JSON.stringify(shopIds), expiresAt, status: "pending", createdBy: ctx.userId, acceptedUserId: "", acceptedAt: "" });
  await audit(store, ctx.tenantId, shopIds[0]!, ctx.userId, "invite.create", `${name} (${role})`);
  return { invite: view((await store.get("staff_invites", id))!), token, duplicate: false };
}

export async function inviteList(store: Store, ctx: Ctx) {
  need(ctx, "owner");
  const rows = (await store.scan("staff_invites", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows;
  return { invites: rows.map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

async function ownInvite(store: Store, ctx: Ctx, id: unknown) {
  const r = await store.get("staff_invites", String(id ?? ""));
  if (!r || r.tenantId !== ctx.tenantId) throw new HttpError(404, "Invitation introuvable");
  return r;
}

/** Renvoi : nouveau jeton (l'ancien lien ne fonctionne plus) et nouvelle échéance de 7 jours. Impossible pour une invitation acceptée. */
export async function inviteRenew(store: Store, ctx: Ctx, b: { inviteId: string }) {
  need(ctx, "owner");
  const r = await ownInvite(store, ctx, b.inviteId);
  if (r.status === "accepted") throw new HttpError(409, "Invitation déjà acceptée");
  await assertQuota(store, ctx.tenantId, "users");
  const token = newToken(); const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  await store.update("staff_invites", r.$id, { tokenHash: await hashToken(token), expiresAt, status: "pending" });
  await audit(store, ctx.tenantId, parse<string[]>(r.shopIds, [])[0] ?? "", ctx.userId, "invite.renew", String(r.name));
  return { invite: view((await store.get("staff_invites", r.$id))!), token };
}

export async function inviteRevoke(store: Store, ctx: Ctx, b: { inviteId: string }) {
  need(ctx, "owner");
  const r = await ownInvite(store, ctx, b.inviteId);
  if (r.status === "accepted") throw new HttpError(409, "Invitation déjà acceptée : désactivez le compte depuis la liste des membres");
  if (r.status !== "revoked") { await store.update("staff_invites", r.$id, { status: "revoked" }); await audit(store, ctx.tenantId, parse<string[]>(r.shopIds, [])[0] ?? "", ctx.userId, "invite.revoke", String(r.name)); }
  return { ok: true };
}

/** Invitation valide pour ce jeton, sinon refus explicite (lien inconnu, annulé, déjà utilisé, expiré). */
async function byToken(store: Store, token: unknown) {
  const t = String(token ?? ""); if (!/^[a-f0-9]{64}$/.test(t)) throw new HttpError(404, "Lien d'invitation invalide");
  const r = (await store.list("staff_invites", { tokenHash: await hashToken(t) }, 1))[0];
  if (!r) throw new HttpError(404, "Lien d'invitation invalide ou remplacé par un nouveau lien");
  const st = statusOf(r);
  if (st === "accepted") throw new HttpError(410, "Cette invitation a déjà été utilisée");
  if (st === "revoked") throw new HttpError(410, "Cette invitation a été annulée");
  if (st === "expired") throw new HttpError(410, "Cette invitation a expiré : demandez un nouveau lien");
  return r;
}

/** Public : ce que l'invité va rejoindre (aucune donnée sensible : nom proposé, rôle, boutiques, commerce, échéance). */
export async function invitePeek(store: Store, _ctx: Ctx, b: { token: string }) {
  const r = await byToken(store, b.token);
  const shops = await Promise.all(parse<string[]>(r.shopIds, []).map((id) => store.get("shops", id)));
  const names = shops.filter((s) => s && s.tenantId === r.tenantId).map((s) => String(s!.name));
  return { name: String(r.name), roleLabel: ROLE_PRESETS[r.role as StaffRole]?.label ?? String(r.role), roleDescription: ROLE_PRESETS[r.role as StaffRole]?.description ?? "", shops: names, company: String(shops.find((s) => s?.companyName)?.companyName ?? names[0] ?? ""), expiresAt: String(r.expiresAt) };
}

/** Public : l'invité choisit son identifiant (ou son e-mail) et son mot de passe ; le compte est créé avec le rôle, les accès et les boutiques de l'invitation. */
export async function inviteAccept(store: Store, _ctx: Ctx, b: { token: string; username?: string; email?: string; password: string }) {
  const r = await byToken(store, b.token);
  const tenantId = String(r.tenantId);
  await assertWritable(store, tenantId);
  const shopIds = await ownShops(store, { tenantId } as Ctx, parse<string[]>(r.shopIds, [])); // une boutique supprimée depuis : refus explicite
  const role = validRole(r.role); const modules = accessOf(role, parse<unknown>(r.access, undefined));
  // L'invitation est marquée AVANT la création : un double clic ne crée jamais deux comptes ; échec de création → elle redevient utilisable.
  await store.update("staff_invites", r.$id, { status: "accepted", acceptedAt: new Date().toISOString() });
  try {
    const acc = await createStaffAccount(store, tenantId, String(r.createdBy), { name: String(r.name), username: b.username, email: b.email, password: b.password, role, modules, shopIds }, "invite.accept");
    await store.update("staff_invites", r.$id, { acceptedUserId: acc.userId });
    return { login: acc.login };
  } catch (e) { await store.update("staff_invites", r.$id, { status: "pending", acceptedAt: "" }); throw e; }
}
