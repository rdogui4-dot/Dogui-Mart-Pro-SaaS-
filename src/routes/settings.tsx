import { useSession } from "@/lib/session";
export function SettingsPage() {
  const { session, logout } = useSession();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Réglages</h1>
      <div className="card text-sm">Connecté : <b>{session?.name}</b> · rôle {session?.role}<br />Boutique : {session?.shopId} · Tenant : {session?.tenantId}</div>
      <button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button>
    </div>
  );
}
