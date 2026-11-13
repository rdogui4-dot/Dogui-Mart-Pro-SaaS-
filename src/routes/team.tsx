import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { listTenant, type Row } from "@/lib/data";
import { useSession } from "@/lib/session";
import { MODULES, MODULE_HELP, MODULE_LABEL, ROLE_PRESETS, STAFF_ROLES, isCustomAccess, modulesFor, type Module, type StaffRole } from "@/domain/access";

type StaffRow = { userId: string; name: string; username?: string; email?: string; role: StaffRole; shopIds?: string; access?: string; active?: boolean };
type ShopRow = { name: string; city?: string; phone?: string };
const ids = (s?: string): string[] => { try { return JSON.parse(s ?? "[]"); } catch { return []; } };

export function ShopsSection() {
  const { session, refresh } = useSession(); const s = session!;
  const qc = useQueryClient();
  const shops = useQuery({ queryKey: ["shops-all"], queryFn: () => listTenant<ShopRow>("shops", s) });
  const [f, setF] = useState({ name: "", city: "", phone: "" }); const [err, setErr] = useState("");
  const add = useMutation({
    mutationFn: () => api(s, "shop.create", f),
    onSuccess: async () => { setF({ name: "", city: "", phone: "" }); setErr(""); await refresh(); void qc.invalidateQueries({ queryKey: ["shops-all"] }); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <>
      <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <h2 className="font-semibold">Nouvelle boutique</h2>
        <input aria-label="Nom de la boutique" className="input" placeholder="Nom de la boutique" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="Ville" className="input" placeholder="Ville" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          <input aria-label="Téléphone" className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <button className="btn" disabled={add.isPending}>Créer la boutique</button>
        {err && <p className="text-bad text-sm">{err}</p>}
        <p className="text-xs text-muted">Le catalogue, le stock et les caisses sont propres à chaque boutique. Pour déplacer du stock : Stock → Transférer.</p>
      </form>
      {(shops.data ?? []).map((x) => (
        <div key={x.$id} className="card flex justify-between"><span>{x.name}<br /><span className="text-xs text-muted">{[x.city, x.phone].filter(Boolean).join(" · ")}</span></span>{x.$id === s.shopId && <span className="text-xs text-accent-text">active</span>}</div>
      ))}
    </>
  );
}

export function StaffSection() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => listTenant<StaffRow>("staff", s, 200) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["staff"] });
  return (
    <>
      <div className="card flex justify-between items-center"><span><b>{s.name}</b><br /><span className="text-xs text-muted">Propriétaire · tous les accès, boutiques, équipe et abonnement</span></span><span className="text-xs text-accent-text">Gérant principal</span></div>
      <NewStaff onDone={refresh} />
      {(staff.data ?? []).map((m) => <StaffCard key={m.$id} m={m} onChange={refresh} />)}
      {staff.data?.length === 0 && <p className="text-center text-muted py-4">Aucun employé pour le moment.</p>}
    </>
  );
}

function ShopChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { session } = useSession();
  return (
    <div className="flex flex-wrap gap-2">
      {session!.shops.map((x) => (
        <label key={x.id} className={`rounded-xl border px-3 py-2 text-sm ${value.includes(x.id) ? "border-accent text-accent-text" : "border-line"}`}>
          <input type="checkbox" className="mr-2" checked={value.includes(x.id)} onChange={(e) => onChange(e.target.checked ? [...value, x.id] : value.filter((v) => v !== x.id))} />{x.name}
        </label>
      ))}
    </div>
  );
}

/** Rôle (préréglage) + accès par module : le propriétaire peut partir d'un rôle puis cocher/décocher les modules. */
function AccessPicker({ role, modules, onChange }: { role: StaffRole; modules: Module[]; onChange: (role: StaffRole, modules: Module[]) => void }) {
  const custom = isCustomAccess(role, modules);
  return (
    <div className="flex flex-col gap-2">
      <select className="input" aria-label="Rôle" value={role} onChange={(e) => { const r = e.target.value as StaffRole; onChange(r, modulesFor(r)); }}>
        {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_PRESETS[r].label}</option>)}
      </select>
      <p className="text-xs text-muted">{ROLE_PRESETS[role].description}{custom && " Accès personnalisés ci-dessous."}</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm text-soft mb-1">Accès attribués</legend>
        {MODULES.map((m) => (
          <label key={m} className="flex gap-2 items-start text-sm">
            <input type="checkbox" className="mt-1" checked={modules.includes(m)} onChange={(e) => onChange(role, MODULES.filter((x) => (x === m ? e.target.checked : modules.includes(x))))} />
            <span><b>{MODULE_LABEL[m]}</b><br /><span className="text-xs text-muted">{MODULE_HELP[m]}</span></span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function NewStaff({ onDone }: { onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const [f, setF] = useState({ name: "", username: "", password: "", role: "cashier" as StaffRole });
  const [modules, setModules] = useState<Module[]>(modulesFor("cashier"));
  const [shopIds, setShopIds] = useState<string[]>([s.shopId].filter(Boolean)); const [err, setErr] = useState(""); const [created, setCreated] = useState("");
  const add = useMutation({
    mutationFn: () => api<{ login: string }>(s, "staff.create", { ...f, shopIds, access: modules }),
    onSuccess: (r) => { setCreated(r.login); setErr(""); setF({ name: "", username: "", password: "", role: "cashier" }); setModules(modulesFor("cashier")); onDone(); },
    onError: (e) => { setCreated(""); setErr((e as Error).message); },
  });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <h2 className="font-semibold">Nouvel employé</h2>
      <input aria-label="Nom complet" className="input" placeholder="Nom complet" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input aria-label="Identifiant de connexion (ex. awa.ndiaye)" className="input" autoCapitalize="none" placeholder="Identifiant de connexion (ex. awa.ndiaye)" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <input aria-label="Mot de passe initial (8 caractères min.)" className="input" type="text" autoComplete="off" placeholder="Mot de passe initial (8 caractères min.)" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <AccessPicker role={f.role} modules={modules} onChange={(r, m) => { setF({ ...f, role: r }); setModules(m); }} />
      <ShopChecks value={shopIds} onChange={setShopIds} />
      <button className="btn" disabled={add.isPending || !shopIds.length || !modules.length}>Créer le compte</button>
      {created && <p className="text-sm text-ok">Compte créé. Identifiant : <b>{created}</b>. Communiquez-lui le mot de passe en personne.</p>}
      {err && <p className="text-bad text-sm">{err}</p>}
    </form>
  );
}

function StaffCard({ m, onChange }: { m: Row<StaffRow>; onChange: () => void }) {
  const { session } = useSession(); const s = session!;
  const [edit, setEdit] = useState(false); const [role, setRole] = useState<StaffRole>(m.role); const [shopIds, setShopIds] = useState(ids(m.shopIds)); const [modules, setModules] = useState<Module[]>(modulesFor(m.role, m.access));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setBusy(true); setErr(""); try { await fn(); after?.(); onChange(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const shopNames = ids(m.shopIds).map((id) => s.shops.find((x) => x.id === id)?.name ?? "?").join(", ");
  return (
    <div className={`card flex flex-col gap-2 ${m.active === false ? "opacity-60" : ""}`}>
      <div className="flex justify-between"><b>{m.name}</b><span className="text-sm text-muted">{ROLE_PRESETS[m.role]?.label ?? m.role}{isCustomAccess(m.role, modulesFor(m.role, m.access)) && " (personnalisé)"}{m.active === false && " · désactivé"}</span></div>
      <div className="text-sm text-muted">Connexion : {m.username || m.email} · {shopNames || "aucune boutique"}<br />Accès : {modulesFor(m.role, m.access).map((x) => MODULE_LABEL[x]).join(", ")}</div>
      {edit && (
        <div className="flex flex-col gap-2 border-t border-line pt-2">
          <AccessPicker role={role} modules={modules} onChange={(r, mm) => { setRole(r); setModules(mm); }} />
          <ShopChecks value={shopIds} onChange={setShopIds} />
          <button className="btn" disabled={busy || !shopIds.length || !modules.length} onClick={() => void run(() => api(s, "staff.update", { userId: m.userId, role, shopIds, access: modules }), () => setEdit(false))}>Enregistrer</button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button className="btn-ghost !py-2" onClick={() => setEdit(!edit)}>{edit ? "Fermer" : "Rôle, accès & boutiques"}</button>
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => { const p = prompt(`Nouveau mot de passe pour ${m.name} (8 caractères min.)`); if (p) void run(() => api(s, "staff.resetPassword", { userId: m.userId, password: p })); }}>Mot de passe</button>
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => confirm(m.active === false ? `Réactiver ${m.name} ?` : `Désactiver ${m.name} ? Il ne pourra plus se connecter.`) && void run(() => api(s, "staff.update", { userId: m.userId, active: m.active === false }))}>{m.active === false ? "Réactiver" : "Désactiver"}</button>
      </div>
      {err && <p className="text-bad text-sm">{err}</p>}
    </div>
  );
}
