import { useState } from "react";
import { ID, teams } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Compte existant mais sans commerce (inscription interrompue, ou échec de création de l'équipe) : on le crée ici. */
export function CreateTenantPage() {
  const { session, refresh, logout } = useSession(); const s = session!;
  const [name, setName] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const team = await teams.create({ teamId: ID.unique(), name: name.trim(), roles: ["owner"] });
      // Si le serveur est momentanément indisponible, le commerce est créé quand même : la première boutique est recréée à la connexion suivante.
      await api({ ...s, tenantId: team.$id }, "tenant.init", { name: name.trim() }).catch(() => undefined);
      await refresh();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="min-h-full flex flex-col justify-center gap-3 p-6 max-w-sm mx-auto">
      <h1 className="text-2xl font-bold text-[var(--gold)]">Bienvenue {s.name}</h1>
      <p className="text-white/60">Votre compte est créé, mais il n'est rattaché à aucun commerce. Donnez un nom à votre commerce pour commencer (essai gratuit de 14 jours).</p>
      <input aria-label="Nom de votre commerce" className="input" placeholder="Nom de votre commerce" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <button className="btn" disabled={busy || name.trim().length < 2}>Créer mon commerce</button>
      <button type="button" className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button>
    </form>
  );
}
