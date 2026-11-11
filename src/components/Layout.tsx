import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BookOpen, Boxes, Home, MoreHorizontal, Receipt, ScanLine, Users, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { can, useSession, type Perm } from "@/lib/session";
import { pendingCount, rejectedSales, syncPending } from "@/lib/offline";
import { SubscriptionBanner, useSubscription } from "@/routes/subscription";
import { LogoMark } from "./Logo";

/** Accueil + trois modules au choix (les premiers accessibles) + « Plus » : une barre lisible sur un petit écran, quel que soit le profil. */
const MODULE_NAV: { to: string; label: string; icon: typeof Home; perm: Perm }[] = [
  { to: "/pos", label: "Caisse", icon: ScanLine, perm: "pos" },
  { to: "/stock", label: "Stock", icon: Boxes, perm: "stock" },
  { to: "/clients", label: "Clients", icon: Users, perm: "customers" },
  { to: "/achats", label: "Achats", icon: Receipt, perm: "purchases" },
  { to: "/icompta", label: "ICompta", icon: BookOpen, perm: "finance" },
];

export function Layout() {
  const { session, switchShop, logout, refresh } = useSession();
  const sub = useSubscription();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [pending, setPending] = useState(0); const [rejected, setRejected] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const refresh = () => Promise.all([pendingCount().then(setPending), rejectedSales().then((r) => setRejected(r.length))]);
    const up = async () => { setOnline(true); await syncPending(); void refresh(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    void up(); const t = setInterval(() => { void syncPending().then(refresh); }, 30000);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(t); };
  }, []);
  return (
    <div className="h-full flex flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-[var(--line)] bg-[var(--surface)]">
        <Link to="/accueil" aria-label="Accueil" className="p-1.5 -m-1.5"><LogoMark size={34} /></Link>
        <div className="flex-1 min-w-0">
          {session && session.shops.length > 1
            ? <select aria-label="Boutique" className="bg-transparent font-semibold w-full outline-none truncate" value={session.shopId} onChange={(e) => switchShop(e.target.value)}>{session.shops.map((x) => <option key={x.id} value={x.id} className="bg-[#141416]">{x.name}</option>)}</select>
            : <span className="font-semibold truncate block">{session?.shops.find((x) => x.id === session.shopId)?.name ?? "Dogui Mart Pro"}</span>}
        </div>
        {rejected > 0 && <Link to="/plus" className="text-xs rounded-full bg-red-500 text-white px-3 py-1">{rejected} vente{rejected > 1 ? "s" : ""} à vérifier</Link>}
        {(!online || pending > 0) && <span className="flex items-center gap-1 text-xs rounded-full bg-amber-500/90 text-black px-3 py-1">{!online && <WifiOff size={14} />}{online ? "Synchronisation" : "Hors ligne"} · {pending}</span>}
      </header>
      <SubscriptionBanner />
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {sub.data?.entitlement.state === "locked" && !(session?.role === "owner" && path.startsWith("/reglages"))
          ? <div className="text-center py-10 flex flex-col gap-3 items-center"><h1 className="text-xl font-bold">Abonnement expiré</h1><p className="text-white/60">L'accès à l'application est suspendu ; vos données sont conservées.{session?.role === "owner" ? " Renouvelez votre formule pour reprendre." : " Contactez le propriétaire du commerce."}</p>{session?.role === "owner" && <Link to="/reglages" className="btn">Renouveler mon abonnement</Link>}<button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>
          : session?.shopId || (session?.role === "owner" && path.startsWith("/reglages")) ? <Outlet key={session.shopId} /> : session?.setupError ? <div className="text-center py-10 flex flex-col gap-3 items-center"><h1 className="text-xl font-bold">Votre commerce n'est pas encore prêt</h1><p className="text-white/60">La première boutique n'a pas pu être créée : {session.setupError}. Si le service vient d'être mis en place, réessayez dans quelques minutes.</p><button className="btn" onClick={() => void refresh()}>Réessayer</button>{session.role === "owner" && <Link to="/reglages" className="btn-ghost">Ouvrir les réglages</Link>}<button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div> : <div className="text-center text-white/60 py-10 flex flex-col gap-3 items-center"><p>Aucune boutique ne vous est affectée. Contactez le propriétaire.</p><button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>}
      </main>
      <nav aria-label="Navigation" className="fixed bottom-0 inset-x-0 bg-[var(--surface)] border-t border-[var(--line)] grid grid-flow-col auto-cols-fr pb-[env(safe-area-inset-bottom)]">
        {[{ to: "/accueil", label: "Accueil", icon: Home }, ...MODULE_NAV.filter((n) => can(session, n.perm)).slice(0, 3), { to: "/plus", label: "Plus", icon: MoreHorizontal }].map(({ to, label, icon: I }) => (
          <Link key={to} to={to} aria-current={path.startsWith(to) ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${path.startsWith(to) ? "text-[var(--gold)] font-semibold" : "text-white/55"}`}>
            <I size={22} />{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
