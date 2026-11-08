import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BookOpen, Boxes, Receipt, ScanLine, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { can, useSession } from "@/lib/session";
import { pendingCount, syncPending } from "@/lib/offline";

const NAV = [
  { to: "/pos", label: "Caisse", icon: ScanLine, perm: "sell" },
  { to: "/stock", label: "Stock", icon: Boxes, perm: "stock" },
  { to: "/clients", label: "Clients", icon: Users, perm: "sell" },
  { to: "/achats", label: "Achats", icon: Receipt, perm: "purchase" },
  { to: "/compta", label: "Compta", icon: BookOpen, perm: "accounting" },
  { to: "/reglages", label: "Réglages", icon: Settings, perm: "settings" },
] as const;

export function Layout() {
  const { session, switchShop, logout } = useSession();
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
      {session && session.shops.length > 1 && (
        <div className="px-4 pt-3">
          <select aria-label="Boutique" className="input !py-2" value={session.shopId} onChange={(e) => switchShop(e.target.value)}>
            {session.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {session?.shopId ? <Outlet key={session.shopId} /> : <div className="text-center text-white/60 py-10 flex flex-col gap-3 items-center"><p>Aucune boutique ne vous est affectée. Contactez le propriétaire.</p><button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>}
      </main>
      <nav className="fixed bottom-0 inset-x-0 bg-[#111] border-t border-white/10 grid grid-flow-col auto-cols-fr pb-[env(safe-area-inset-bottom)]">
        {NAV.filter((n) => can(session?.role, n.perm)).map(({ to, label, icon: I }) => (
          <Link key={to} to={to} className={`flex flex-col items-center py-2 text-xs ${path.startsWith(to) ? "text-[var(--gold)]" : "text-white/60"}`}>
            <I size={22} />{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
