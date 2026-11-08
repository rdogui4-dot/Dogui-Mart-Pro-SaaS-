import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { listTenant, type Row } from "@/lib/data";
import { useSession } from "@/lib/session";

type StaffRow = { userId: string; name: string; username?: string; email?: string; role: "manager" | "cashier"; shopIds?: string; active?: boolean };
type ShopRow = { name: string; city?: string; phone?: string };
const ROLE = { manager: "Gérant", cashier: "Caissier" } as const;
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
        <input className="input" placeholder="Nom de la boutique" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Ville" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          <input className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <button className="btn" disabled={add.isPending}>Créer la boutique</button>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <p className="text-xs text-white/50">Le catalogue, le stock et les caisses sont propres à chaque boutique. Pour déplacer du stock : Stock → Transférer.</p>
      </form>
      {(shops.data ?? []).map((x) => (
        <div key={x.$id} className="card flex justify-between"><span>{x.name}<br /><span className="text-xs text-white/50">{[x.city, x.phone].filter(Boolean).join(" · ")}</span></span>{x.$id === s.shopId && <span className="text-xs text-[var(--gold)]">active</span>}</div>
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
      <NewStaff onDone={refresh} />
      {(staff.data ?? []).map((m) => <StaffCard key={m.$id} m={m} onChange={refresh} />)}
      {staff.data?.length === 0 && <p className="text-center text-white/50 py-4">Aucun employé pour le moment.</p>}
    </>
  );
}

function ShopChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { session } = useSession();
  return (
    <div className="flex flex-wrap gap-2">
      {session!.shops.map((x) => (
        <label key={x.id} className={`rounded-xl border px-3 py-2 text-sm ${value.includes(x.id) ? "border-[var(--gold)] text-[var(--gold)]" : "border-white/15"}`}>
          <input type="checkbox" className="mr-2" checked={value.includes(x.id)} onChange={(e) => onChange(e.target.checked ? [...value, x.id] : value.filter((v) => v !== x.id))} />{x.name}
        </label>
      ))}
    </div>
  );
}

function NewStaff({ onDone }: { onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const [f, setF] = useState({ name: "", username: "", password: "", role: "cashier" as "cashier" | "manager" });
  const [shopIds, setShopIds] = useState<string[]>([s.shopId].filter(Boolean)); const [err, setErr] = useState(""); const [created, setCreated] = useState("");
  const add = useMutation({
    mutationFn: () => api<{ login: string }>(s, "staff.create", { ...f, shopIds }),
    onSuccess: (r) => { setCreated(r.login); setErr(""); setF({ name: "", username: "", password: "", role: "cashier" }); onDone(); },
    onError: (e) => { setCreated(""); setErr((e as Error).message); },
  });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <h2 className="font-semibold">Nouvel employé</h2>
      <input className="input" placeholder="Nom complet" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" autoCapitalize="none" placeholder="Identifiant de connexion (ex. awa.ndiaye)" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <input className="input" type="text" autoComplete="off" placeholder="Mot de passe initial (8 caractères min.)" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "cashier" | "manager" })}>
        <option value="cashier">Caissier (caisse, clients)</option><option value="manager">Gérant (stock, achats, factures, compta)</option>
      </select>
      <ShopChecks value={shopIds} onChange={setShopIds} />
      <button className="btn" disabled={add.isPending || !shopIds.length}>Créer le compte</button>
      {created && <p className="text-sm text-emerald-400">Compte créé. Identifiant : <b>{created}</b>. Communiquez-lui le mot de passe en personne.</p>}
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </form>
  );
}

function StaffCard({ m, onChange }: { m: Row<StaffRow>; onChange: () => void }) {
  const { session } = useSession(); const s = session!;
  const [edit, setEdit] = useState(false); const [role, setRole] = useState(m.role); const [shopIds, setShopIds] = useState(ids(m.shopIds));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setBusy(true); setErr(""); try { await fn(); after?.(); onChange(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const shopNames = ids(m.shopIds).map((id) => s.shops.find((x) => x.id === id)?.name ?? "?").join(", ");
  return (
    <div className={`card flex flex-col gap-2 ${m.active === false ? "opacity-60" : ""}`}>
      <div className="flex justify-between"><b>{m.name}</b><span className="text-sm text-white/60">{ROLE[m.role]}{m.active === false && " · désactivé"}</span></div>
      <div className="text-sm text-white/60">Connexion : {m.username || m.email} · {shopNames || "aucune boutique"}</div>
      {edit && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as "manager" | "cashier")}><option value="cashier">Caissier</option><option value="manager">Gérant</option></select>
          <ShopChecks value={shopIds} onChange={setShopIds} />
          <button className="btn" disabled={busy || !shopIds.length} onClick={() => void run(() => api(s, "staff.update", { userId: m.userId, role, shopIds }), () => setEdit(false))}>Enregistrer</button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button className="btn-ghost !py-2" onClick={() => setEdit(!edit)}>{edit ? "Fermer" : "Rôle & boutiques"}</button>
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => { const p = prompt(`Nouveau mot de passe pour ${m.name} (8 caractères min.)`); if (p) void run(() => api(s, "staff.resetPassword", { userId: m.userId, password: p })); }}>Mot de passe</button>
        <button className="btn-ghost !py-2" disabled={busy} onClick={() => confirm(m.active === false ? `Réactiver ${m.name} ?` : `Désactiver ${m.name} ? Il ne pourra plus se connecter.`) && void run(() => api(s, "staff.update", { userId: m.userId, active: m.active === false }))}>{m.active === false ? "Réactiver" : "Désactiver"}</button>
      </div>
      {err && <p className="text-red-400 text-sm">{err}</p>}
    </div>
  );
}
