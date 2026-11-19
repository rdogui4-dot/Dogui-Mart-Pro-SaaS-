/** Équipe & Permissions (kit) : indicateurs réels, membres (dernière connexion et 2FA lues dans l'annuaire), matrice des droits tirée des règles du serveur,
 *  invitations par lien à usage unique, journal de l'équipe, sécurité, constats MASTER et rapport de sécurité PDF. Réservé au propriétaire. */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, Copy, Download, KeyRound, Link2, Lock, Minus, Pencil, RefreshCw, Send, ShieldCheck, Trash2, UserPlus, Users, Layers, Clock, Eye, LayoutGrid } from "lucide-react";
import { ErrorState, FilterBar, FilterSelect, InsightCard, KitTable, KpiRow, KpiTile, LoadingState, Panel, PillTabs, RowAction, StatusBadge, type PillTab } from "@/components/kit";
import { Sheet } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { MODULE_LABEL, ROLE_PRESETS, STAFF_ROLES, isCustomAccess, modulesFor, type Module, type StaffRole } from "@/domain/access";
import { MATRIX_LABEL, MATRIX_ROLES, RESERVED, moduleMatrix, type Cell, type Member, type MatrixRole, type TeamInsight } from "@/domain/team-kit";
import { AccessPicker, NewStaff, ShopChecks } from "./team";

type Invite = { id: string; name: string; role: StaffRole; roleLabel: string; modules: Module[]; shopIds: string[]; status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: string; createdAt: string; acceptedAt?: string };
export type TeamData = {
  members: Member[]; invites: Invite[]; activity: { id: string; at: string; action: string; label: string; detail: string; by: string }[]; shops: { id: string; name: string }[];
  counts: { members: number; active: number; roles: number; logins24h: number | null; mfa: number | null; pendingInvites: number }; securityAvailable: boolean; insights: TeamInsight[]; note: string;
};
type Tab = "ov" | "members" | "roles" | "invites" | "activity" | "security";
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Jamais");
const d = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const INV_LABEL = { pending: "En attente", accepted: "Acceptée", revoked: "Annulée", expired: "Expirée" } as const;
const INV_TONE = { pending: "warn", accepted: "ok", revoked: "muted", expired: "bad" } as const;
const inviteLink = (token: string) => `${window.location.origin}${import.meta.env.BASE_URL}invitation?t=${token}`;

export function StaffSection() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const q = useQuery({ queryKey: ["team", s.tenantId], queryFn: () => api<TeamData>(s, "team.overview"), staleTime: 30_000 });
  const [tab, setTab] = useState<Tab>("ov"); const [adding, setAdding] = useState<"" | "invite" | "direct">(""); const [edit, setEdit] = useState<Member | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["team", s.tenantId] });
  if (q.isLoading) return <LoadingState label="Chargement de l'équipe" />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const t = q.data; const c = t.counts;
  const tabs: PillTab<Tab>[] = [{ key: "ov", label: "Vue d'ensemble", icon: LayoutGrid }, { key: "members", label: "Membres de l'équipe", icon: Users, count: c.members }, { key: "roles", label: "Rôles & Permissions", icon: ShieldCheck }, { key: "invites", label: "Invitations", icon: Send, count: c.pendingInvites }, { key: "activity", label: "Activités & Journaux", icon: Activity }, { key: "security", label: "Sécurité", icon: Lock }];
  const addBtn = <button type="button" className="btn !min-h-10" onClick={() => setAdding("invite")}><UserPlus size={18} aria-hidden="true" /> Ajouter un membre</button>;
  return (
    <>
      <KpiRow>
        <KpiTile icon={Users} tint="blue" label="Membres de l'équipe" value={c.members} sub="propriétaire inclus" />
        <KpiTile icon={Layers} tint="violet" label="Rôles utilisés" value={c.roles} sub={`sur ${MATRIX_ROLES.length} rôles`} />
        <KpiTile icon={KeyRound} tint="green" label="Comptes actifs" value={`${c.active} / ${c.members}`} sub={`${Math.round((c.active / Math.max(1, c.members)) * 100)} %`} />
        <KpiTile icon={Clock} tint="cyan" label="Connexions (24 h)" value={c.logins24h ?? "—"} sub={c.logins24h === null ? "annuaire indisponible" : "sessions ouvertes"} />
        <KpiTile icon={ShieldCheck} tint="amber" label="Comptes avec 2FA" value={c.mfa === null ? "—" : `${c.mfa} / ${c.active}`} sub={c.mfa === null ? "annuaire indisponible" : "double authentification"} />
      </KpiRow>
      <PillTabs idBase="team" label="Sections Équipe & Permissions" value={tab} onChange={setTab} items={tabs} />

      {tab === "ov" && <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title={`Membres de l'équipe (${c.members})`} icon={Users} action={addBtn}><MembersTable t={t} rows={t.members.slice(0, 8)} onEdit={setEdit} compact />{t.members.length > 8 && <button type="button" className="text-sm font-semibold text-accent-text mt-2" onClick={() => setTab("members")}>Voir les {t.members.length} membres</button>}</Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title={`Invitations en attente (${c.pendingInvites})`} icon={Send} action={<button type="button" className="text-sm font-semibold text-accent-text" onClick={() => setTab("invites")}>Voir tout</button>}><InviteList rows={t.invites.filter((i) => i.status === "pending").slice(0, 3)} onChange={refresh} compact /></Panel>
            <Panel title="Activités récentes" icon={Activity} action={<button type="button" className="text-sm font-semibold text-accent-text" onClick={() => setTab("activity")}>Voir tout</button>}><ActivityList rows={t.activity.slice(0, 4)} /></Panel>
          </div>
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Rôles & Permissions" icon={ShieldCheck} action={<button type="button" className="text-sm font-semibold text-accent-text" onClick={() => setTab("roles")}>Matrice complète</button>}>
            <RoleCounts t={t} /><Matrix rows={moduleMatrix().slice(0, 4)} />
          </Panel>
          <InsightCard module="Équipe" items={t.insights} source="membres, rôles, accès, invitations et annuaire des connexions" />
          <SecurityReport t={t} />
        </div>
      </div>}

      {tab === "members" && <Members t={t} onEdit={setEdit} addBtn={addBtn} />}
      {tab === "roles" && <Panel title="Rôles & Permissions" icon={ShieldCheck}>
        <RoleCounts t={t} />
        <h3 className="font-semibold mt-3">Accès aux modules (préréglage de chaque rôle)</h3><Matrix rows={moduleMatrix()} />
        <h3 className="font-semibold mt-4">Actions réservées (contrôlées par rôle, quels que soient les modules)</h3><Matrix rows={RESERVED} />
        <ul className="grid gap-2 sm:grid-cols-2 mt-4 text-sm">{STAFF_ROLES.map((r) => <li key={r} className="rounded-xl border border-line p-3"><b>{ROLE_PRESETS[r].label}</b><p className="text-soft">{ROLE_PRESETS[r].description}</p></li>)}</ul>
        <p className="text-xs text-muted mt-2">Ces règles sont celles que le serveur applique à chaque action. Le propriétaire peut personnaliser les modules de chaque membre ; un Consultant reste en consultation seule.</p>
      </Panel>}
      {tab === "invites" && <Panel title="Invitations" icon={Send} action={<button type="button" className="btn !min-h-10" onClick={() => setAdding("invite")}><Link2 size={18} aria-hidden="true" /> Nouvelle invitation</button>}>
        <InviteList rows={t.invites} onChange={refresh} />
        <p className="text-xs text-muted mt-2">Lien à usage unique valable 7 jours, à transmettre vous-même (copie ou QR code). Aucun e-mail n'est envoyé. « Renvoyer » crée un nouveau lien : l'ancien ne fonctionne plus.</p>
      </Panel>}
      {tab === "activity" && <Panel title="Activités & Journaux de l'équipe" icon={Activity}><ActivityList rows={t.activity} /><p className="text-xs text-muted mt-2">Ajouts, modifications, invitations, réinitialisations et nouvelles boutiques (toutes boutiques). Le journal complet d'une boutique est dans « Journal d'activité ».</p></Panel>}
      {tab === "security" && <Security t={t} />}

      {adding && <Sheet title={adding === "invite" ? "Inviter un membre" : "Créer un compte directement"} onClose={() => setAdding("")} size="modal">
        <div role="tablist" aria-label="Mode d'ajout" className="grid grid-cols-2 gap-1 mb-3">{([["invite", "Lien d'invitation"], ["direct", "Création directe"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={adding === k} className="chip !py-2 text-sm" onClick={() => setAdding(k)}>{l}</button>)}</div>
        {adding === "invite" ? <NewInvite onDone={refresh} /> : <NewStaff onDone={refresh} />}
      </Sheet>}
      {edit && <MemberEditor m={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(); }} />}
    </>
  );
}

const roleBadge = (r: MatrixRole) => <StatusBadge tone={r === "owner" ? "progress" : r === "viewer" ? "muted" : "info"} icon={null}>{MATRIX_LABEL[r]}</StatusBadge>;
const shopNames = (t: TeamData, ids: string[], role: MatrixRole) => (role === "owner" ? "Toutes les boutiques" : ids.map((id) => t.shops.find((x) => x.id === id)?.name ?? "?").join(", ") || "Aucune");
const mfaCell = (m: Member) => (m.mfa === null ? <span className="text-muted">—</span> : m.mfa ? <StatusBadge tone="ok">Activée</StatusBadge> : <StatusBadge tone="muted">Non activée</StatusBadge>);

function MembersTable({ t, rows, onEdit, compact }: { t: TeamData; rows: Member[]; onEdit: (m: Member) => void; compact?: boolean }) {
  return <KitTable label="Membres de l'équipe" rows={rows} rowKey={(m) => m.userId}
    columns={[
      { key: "n", label: "Membre", cell: (m) => <span><b>{m.name}</b><br /><span className="text-xs text-muted">{m.login}</span></span> },
      { key: "r", label: "Rôle", cell: (m) => <span className="inline-flex items-center gap-1">{roleBadge(m.role)}{m.role !== "owner" && isCustomAccess(m.role, m.modules) && <span className="text-xs text-muted">perso.</span>}</span> },
      ...(compact ? [] : [{ key: "b", label: "Boutique(s)", hideBelow: "lg" as const, cell: (m: Member) => shopNames(t, m.shopIds, m.role) }]),
      { key: "s", label: "Statut", cell: (m) => <StatusBadge tone={m.active ? "ok" : "muted"}>{m.active ? "Actif" : "Désactivé"}</StatusBadge> },
      { key: "l", label: "Dernière connexion", hideBelow: "md", nowrap: true, cell: (m) => (t.securityAvailable ? dt(m.lastLogin) : "—") },
    ]}
    actions={(m) => (m.role === "owner" ? <span className="inline-flex size-10 items-center justify-center text-muted" title="Propriétaire : tous les droits" aria-label="Propriétaire : tous les droits"><Lock size={16} aria-hidden="true" /></span> : <RowAction icon={Pencil} label={`Modifier ${m.name}`} onClick={() => onEdit(m)} />)}
    renderCard={(m) => <div className="flex items-start justify-between gap-2"><span className="min-w-0"><b>{m.name}</b> {roleBadge(m.role)}<br /><span className="text-xs text-muted">{shopNames(t, m.shopIds, m.role)} · {t.securityAvailable ? dt(m.lastLogin) : "—"}</span></span>{m.role !== "owner" && <RowAction icon={Pencil} label={`Modifier ${m.name}`} onClick={() => onEdit(m)} />}</div>} />;
}

function Members({ t, onEdit, addBtn }: { t: TeamData; onEdit: (m: Member) => void; addBtn: React.ReactNode }) {
  const [qq, setQ] = useState(""); const [role, setRole] = useState<"all" | MatrixRole>("all"); const [st, setSt] = useState<"all" | "on" | "off">("all");
  const rows = t.members.filter((m) => (role === "all" || m.role === role) && (st === "all" || (st === "on") === m.active) && (`${m.name} ${m.login}`.toLowerCase().includes(qq.trim().toLowerCase())));
  return <Panel title={`Membres de l'équipe (${t.members.length})`} icon={Users} action={addBtn}>
    <FilterBar query={qq} onQuery={setQ} placeholder="Rechercher un membre (nom, identifiant)">
      <FilterSelect label="Rôle" value={role} onChange={setRole} options={[{ value: "all", label: "Tous les rôles" }, ...MATRIX_ROLES.map((r) => ({ value: r, label: MATRIX_LABEL[r] }))]} />
      <FilterSelect label="Statut" value={st} onChange={setSt} options={[{ value: "all", label: "Tous" }, { value: "on", label: "Actifs" }, { value: "off", label: "Désactivés" }]} />
    </FilterBar>
    <div className="mt-3">{rows.length ? <MembersTable t={t} rows={rows} onEdit={onEdit} /> : <p className="text-sm text-muted">Aucun membre ne correspond.</p>}</div>
  </Panel>;
}

function RoleCounts({ t }: { t: TeamData }) {
  return <ul className="grid grid-cols-3 gap-2" aria-label="Membres par rôle">{MATRIX_ROLES.map((r) => <li key={r} className="rounded-xl border border-line p-2 text-center text-sm"><span className="block font-semibold truncate">{MATRIX_LABEL[r]}</span><span className="text-muted">{t.members.filter((m) => m.role === r).length}</span></li>)}</ul>;
}
const CellIcon = ({ v }: { v: Cell }) => (v === "full" ? <Check size={18} className="text-ok mx-auto" aria-label="Autorisé" /> : v === "read" ? <Eye size={18} className="text-info mx-auto" aria-label="Consultation seule" /> : <Minus size={18} className="text-muted mx-auto" aria-label="Non autorisé" />);
function Matrix({ rows }: { rows: { id: string; label: string; cells: Record<MatrixRole, Cell> }[] }) {
  return <div className="overflow-x-auto mt-2"><table className="w-full text-sm min-w-[34rem]" aria-label="Matrice des permissions">
    <thead><tr className="border-b border-line"><th scope="col" className="text-left py-2 pr-2">Permission</th>{MATRIX_ROLES.map((r) => <th key={r} scope="col" className="py-2 px-1 text-xs font-semibold">{MATRIX_LABEL[r]}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-line/60"><th scope="row" className="text-left font-normal py-1.5 pr-2">{row.label}</th>{MATRIX_ROLES.map((r) => <td key={r} className="py-1.5"><CellIcon v={row.cells[r]} /></td>)}</tr>)}</tbody>
  </table><p className="text-xs text-muted mt-1 flex flex-wrap gap-3"><span className="inline-flex items-center gap-1"><Check size={14} className="text-ok" />Autorisé</span><span className="inline-flex items-center gap-1"><Eye size={14} className="text-info" />Consultation seule</span><span className="inline-flex items-center gap-1"><Minus size={14} />Non autorisé</span></p></div>;
}

function ActivityList({ rows }: { rows: TeamData["activity"] }) {
  if (!rows.length) return <p className="text-sm text-muted">Aucune activité d'équipe enregistrée.</p>;
  return <ul className="flex flex-col divide-y divide-[var(--line)]">{rows.map((a) => <li key={a.id} className="py-2 text-sm"><b>{a.label}</b> : {a.detail}<br /><span className="text-xs text-muted">{dt(a.at)} · par {a.by}</span></li>)}</ul>;
}

function LinkBox({ token }: { token: string }) {
  const link = inviteLink(token); const cv = useRef<HTMLCanvasElement>(null); const [copied, setCopied] = useState(false);
  useEffect(() => { if (cv.current) void QRCode.toCanvas(cv.current, link, { width: 180, margin: 1 }); }, [link]);
  return <div className="rounded-xl border border-accent/50 p-3 flex flex-col gap-2 items-center" role="status">
    <p className="text-sm font-semibold">Lien d'invitation (affiché une seule fois)</p>
    <canvas ref={cv} className="rounded-lg bg-white" />
    <input aria-label="Lien d'invitation" readOnly className="input w-full text-xs" value={link} onFocus={(e) => e.target.select()} />
    <button type="button" className="btn-ghost !min-h-9 text-sm" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false)); }}><Copy size={16} aria-hidden="true" /> {copied ? "Copié" : "Copier le lien"}</button>
    <p className="text-xs text-muted text-center">Transmettez-le vous-même à la personne invitée. Valable 7 jours, utilisable une seule fois.</p>
  </div>;
}

function NewInvite({ onDone }: { onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const [name, setName] = useState(""); const [role, setRole] = useState<StaffRole>("cashier"); const [modules, setModules] = useState<Module[]>(modulesFor("cashier")); const [shopIds, setShopIds] = useState<string[]>([s.shopId].filter(Boolean));
  const id = useRef(crypto.randomUUID()); const [token, setToken] = useState(""); const [err, setErr] = useState("");
  const m = useMutation({ mutationFn: () => api<{ token: string | null }>(s, "staff.invite.create", { inviteId: id.current, name, role, access: modules, shopIds }), onSuccess: (r) => { setErr(""); if (r.token) setToken(r.token); onDone(); }, onError: (e) => setErr((e as Error).message) });
  if (token) return <LinkBox token={token} />;
  return <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
    <input aria-label="Nom de la personne invitée" className="input" placeholder="Nom de la personne invitée" required value={name} onChange={(e) => setName(e.target.value)} />
    <AccessPicker role={role} modules={modules} onChange={(r, mm) => { setRole(r); setModules(mm); }} />
    <ShopChecks value={shopIds} onChange={setShopIds} />
    <button className="btn" disabled={m.isPending || !shopIds.length || !modules.length}>Créer le lien d'invitation</button>
    {err && <p role="alert" className="text-bad text-sm">{err}</p>}
  </form>;
}

function InviteList({ rows, onChange, compact }: { rows: Invite[]; onChange: () => void; compact?: boolean }) {
  const { session } = useSession(); const s = session!; const [token, setToken] = useState<{ id: string; t: string } | null>(null); const [err, setErr] = useState("");
  const run = async (fn: () => Promise<unknown>) => { setErr(""); try { await fn(); onChange(); } catch (e) { setErr((e as Error).message); } };
  if (!rows.length) return <p className="text-sm text-muted">Aucune invitation{compact ? " en attente" : ""}.</p>;
  return <>
    <ul className="flex flex-col divide-y divide-[var(--line)]">{rows.map((i) => <li key={i.id} className="py-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0"><b>{i.name}</b> · {i.roleLabel}<br /><span className="text-xs text-muted">{i.status === "accepted" && i.acceptedAt ? `Acceptée le ${d(i.acceptedAt)}` : `Expire le ${d(i.expiresAt)}`}</span></span>
        <span className="flex items-center gap-1 shrink-0">{!compact && <StatusBadge tone={INV_TONE[i.status]}>{INV_LABEL[i.status]}</StatusBadge>}
          {i.status !== "accepted" && <RowAction icon={RefreshCw} label={`Renvoyer un nouveau lien à ${i.name}`} onClick={() => void run(async () => { const r = await api<{ token: string }>(s, "staff.invite.renew", { inviteId: i.id }); setToken({ id: i.id, t: r.token }); })} />}
          {(i.status === "pending" || i.status === "expired") && <RowAction danger icon={Trash2} label={`Annuler l'invitation de ${i.name}`} onClick={() => confirm(`Annuler l'invitation de ${i.name} ? Le lien ne fonctionnera plus.`) && void run(() => api(s, "staff.invite.revoke", { inviteId: i.id }))} />}
        </span></div>
      {token?.id === i.id && <LinkBox token={token.t} />}
    </li>)}</ul>
    {err && <p role="alert" className="text-bad text-sm">{err}</p>}
  </>;
}

function MemberEditor({ m, onClose, onDone }: { m: Member; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const [role, setRole] = useState<StaffRole>(m.role as StaffRole); const [modules, setModules] = useState<Module[]>(m.modules); const [shopIds, setShopIds] = useState(m.shopIds);
  const [pwd, setPwd] = useState(""); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string, close = false) => { setBusy(true); setErr(""); setMsg(""); try { await fn(); setMsg(ok); if (close) onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return <Sheet title={`Modifier ${m.name}`} onClose={onClose} size="modal"><div className="flex flex-col gap-3">
    <p className="text-sm text-muted">Identifiant : {m.login} · {m.active ? "actif" : "désactivé"}</p>
    <AccessPicker role={role} modules={modules} onChange={(r, mm) => { setRole(r); setModules(mm); }} />
    <ShopChecks value={shopIds} onChange={setShopIds} />
    <button type="button" className="btn" disabled={busy || !shopIds.length || !modules.length} onClick={() => void run(() => api(s, "staff.update", { userId: m.userId, role, shopIds, access: modules }), "Modifications enregistrées.", true)}>Enregistrer rôle, accès et boutiques</button>
    <div className="border-t border-line pt-3 flex flex-col gap-2">
      <label className="text-sm">Nouveau mot de passe (8 caractères min.)<input className="input mt-1" type="text" autoComplete="off" minLength={8} value={pwd} onChange={(e) => setPwd(e.target.value)} /></label>
      <button type="button" className="btn-ghost" disabled={busy || pwd.length < 8} onClick={() => void run(() => api(s, "staff.resetPassword", { userId: m.userId, password: pwd }), "Mot de passe réinitialisé : communiquez-le en personne.")}>Réinitialiser le mot de passe</button>
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => confirm(m.active ? `Désactiver ${m.name} ? Il ne pourra plus se connecter ni lire aucune donnée.` : `Réactiver ${m.name} ?`) && void run(() => api(s, "staff.update", { userId: m.userId, active: !m.active }), m.active ? "Compte désactivé." : "Compte réactivé.", true)}>{m.active ? "Désactiver le compte" : "Réactiver le compte"}</button>
    </div>
    {msg && <p role="status" className="text-ok text-sm">{msg}</p>}{err && <p role="alert" className="text-bad text-sm">{err}</p>}
    <p className="text-xs text-muted">Accès actuels : {m.modules.map((x) => MODULE_LABEL[x]).join(", ")}.</p>
  </div></Sheet>;
}

function Security({ t }: { t: TeamData }) {
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
    <Panel title="Connexions et double authentification" icon={Lock}>
      <KitTable label="Sécurité des comptes" rows={t.members} rowKey={(m) => m.userId} columns={[
        { key: "n", label: "Membre", cell: (m) => <span><b>{m.name}</b><br /><span className="text-xs text-muted">{MATRIX_LABEL[m.role]}</span></span> },
        { key: "l", label: "Dernière connexion", nowrap: true, cell: (m) => (t.securityAvailable ? dt(m.lastLogin) : "—") },
        { key: "c", label: "Sessions (24 h)", align: "right", hideBelow: "md", cell: (m) => (t.securityAvailable ? m.sessions24h : "—") },
        { key: "f", label: "2FA", cell: mfaCell },
        { key: "s", label: "Statut", cell: (m) => <StatusBadge tone={m.active ? "ok" : "muted"}>{m.active ? "Actif" : "Désactivé"}</StatusBadge> },
      ]} />
      <p className="text-xs text-muted mt-2">{t.note}</p>
    </Panel>
    <div className="flex flex-col gap-4">
      <Panel title="Règles appliquées" icon={ShieldCheck}><ul className="flex flex-col gap-1.5 text-sm list-disc pl-5">
        <li>Chaque action est vérifiée par le serveur : rôle, modules accordés et boutiques affectées.</li>
        <li>Un compte désactivé ne peut plus se connecter et ne lit plus aucune donnée.</li>
        <li>Mot de passe : 8 caractères minimum ; seul le propriétaire peut le réinitialiser.</li>
        <li>Le Consultant ne peut que consulter : toute écriture est refusée.</li>
        <li>Double authentification : état lu dans l'annuaire ; sa mise en place fera l'objet d'un lot dédié.</li>
      </ul></Panel>
      <SecurityReport t={t} />
    </div>
  </div>;
}

function SecurityReport({ t }: { t: TeamData }) {
  const { session } = useSession(); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function go() { setBusy(true); setErr(""); try { const { teamReportPdf } = await import("@/lib/team-pdf"); const { deliverPdf } = await import("@/lib/pdf"); await deliverPdf(await teamReportPdf(t, session!.shops.find((x) => x.id === session!.shopId)?.name ?? ""), `rapport-securite-${new Date().toISOString().slice(0, 10)}.pdf`); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  return <div className="flex flex-col gap-1"><button type="button" className="btn" disabled={busy} onClick={() => void go()}><Download size={18} aria-hidden="true" /> Rapport de sécurité (PDF)</button>
    <p className="text-xs text-muted">État réel de l'équipe : membres, rôles, accès, connexions, 2FA, invitations et constats. Aucune action n'est lancée.</p>{err && <p role="alert" className="text-bad text-sm">{err}</p>}</div>;
}
