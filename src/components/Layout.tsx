import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BookOpen, Boxes, Receipt, ScanLine, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { can, useSession, type Perm } from "@/lib/session";
import { pendingCount, syncPending } from "@/lib/offline";
import { SubscriptionBanner, useSubscription } from "@/routes/subscription";

const NAV = [
  { to: "/pos", label: "Caisse", icon: ScanLine, perm: "pos" },
  { to: "/stock", label: "Stock", icon: Boxes, perm: "stock" },
  { to: "/clients", label: "Clients", icon: Users, perm: "customers" },
  { to: "/achats", label: "Achats", icon: Receipt, perm: "purchases" },
  { to: "/compta", label: "Compta", icon: BookOpen, perm: "finance" },
  { to: "/reglages", label: "Réglages", icon: Settings, perm: "settings" },
] as const satisfies readonly { to: string; label: string; icon: unknown; perm: Perm }[];

export function Layout() {
  const { session, switchShop, logout, refresh } = useSession();
  const sub = useSubscription();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const refresh = () => pendingCount().then(setPending);
    const up = async () => { setOnline(true); await syncPending(); void refresh(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    void up(); const t = setInterval(() => { void syncPending().then(refresh); }, 30000);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(t); };
  }, []);
  return (
    <div className="h-full flex flex-col pt-[env(safe-area-inset-top)]">
      {(!online || pending > 0) && (
        <div className="bg-amber-500/90 text-black text-sm text-center py-1">
          {online ? "Synchronisation" : "Hors ligne"} · {pending} vente(s) en attente
        </div>
      )}
      <SubscriptionBanner />
      {session && session.shops.length > 1 && (
        <div className="px-4 pt-3">
          <select aria-label="Boutique" className="input !py-2" value={session.shopId} onChange={(e) => switchShop(e.target.value)}>
            {session.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {sub.data?.entitlement.state === "locked" && !(session?.role === "owner" && path.startsWith("/reglages"))
          ? <div className="text-center py-10 flex flex-col gap-3 items-center"><h1 className="text-xl font-bold">Abonnement expiré</h1><p className="text-white/60">L'accès à l'application est suspendu ; vos données sont conservées.{session?.role === "owner" ? " Renouvelez votre formule pour reprendre." : " Contactez le propriétaire du commerce."}</p>{session?.role === "owner" && <Link to="/reglages" className="btn">Renouveler mon abonnement</Link>}<button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>
          : session?.shopId || (session?.role === "owner" && path.startsWith("/reglages")) ? <Outlet key={session.shopId} /> : session?.setupError ? <div className="text-center py-10 flex flex-col gap-3 items-center"><h1 className="text-xl font-bold">Votre commerce n'est pas encore prêt</h1><p className="text-white/60">La première boutique n'a pas pu être créée : {session.setupError}. Si le service vient d'être mis en place, réessayez dans quelques minutes.</p><button className="btn" onClick={() => void refresh()}>Réessayer</button>{session.role === "owner" && <Link to="/reglages" className="btn-ghost">Ouvrir les réglages</Link>}<button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div> : <div className="text-center text-white/60 py-10 flex flex-col gap-3 items-center"><p>Aucune boutique ne vous est affectée. Contactez le propriétaire.</p><button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>}
      </main>
      <nav className="fixed bottom-0 inset-x-0 bg-[#111] border-t border-white/10 grid grid-flow-col auto-cols-fr pb-[env(safe-area-inset-bottom)]">
        {NAV.filter((n) => can(session, n.perm)).map(({ to, label, icon: I }) => (
          <Link key={to} to={to} className={`flex flex-col items-center py-2 text-xs ${path.startsWith(to) ? "text-[var(--gold)]" : "text-white/60"}`}>
            <I size={22} />{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
