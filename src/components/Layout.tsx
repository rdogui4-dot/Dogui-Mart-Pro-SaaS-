import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Home, LogOut, MoreHorizontal, WifiOff, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { SPACES, itemsOf, spaceOfPath } from "@/lib/nav";
import { pendingCount, rejectedSales, syncPending } from "@/lib/offline";
import { SubscriptionBanner, useSubscription } from "@/routes/subscription";
import { LogoMark } from "./Logo";
import { Notice } from "./ui";
import { clearVerifyResult, sendVerification, shouldAskVerification, takeVerifyResult } from "@/lib/verify";

/** Écran large (≥ 768 px) : une seule navigation est rendue (latérale) ; sinon barre du bas. Évite deux navigations dans le DOM. */
function useWide() {
  const q = "(min-width: 768px)";
  const [w, setW] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setW(m.matches); m.addEventListener("change", f); f(); return () => m.removeEventListener("change", f); }, []);
  return w;
}

export function Layout() {
  const wide = useWide();
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
  const plan = sub.data?.entitlement.plan.id;
  const shopName = session?.shops.find((x) => x.id === session.shopId)?.name ?? "Dogui Mart Pro";
  const current = spaceOfPath(path);
  return (
    <div className="h-full flex flex-col md:flex-row pt-[env(safe-area-inset-top)]">
      {wide && <aside aria-label="Espaces" className="flex flex-col w-60 shrink-0 border-r border-line bg-surface overflow-y-auto">
        <Link to="/accueil" className="flex items-center gap-2 px-4 py-3 border-b border-line"><LogoMark size={32} /><span className="font-bold">Dogui Mart Pro</span></Link>
        <nav aria-label="Navigation principale" className="flex flex-col gap-3 p-3">
          <SideLink to="/accueil" label="Accueil" icon={Home} active={path.startsWith("/accueil")} />
          {SPACES.map((sp) => { const its = itemsOf(sp, session, plan); if (!its.length) return null; return (
            <div key={sp.id} className="flex flex-col gap-0.5">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{sp.label}</p>
              {its.map((it) => <SideLink key={it.to} to={it.to} label={it.label} active={path === it.to || path.startsWith(it.to + "/")} />)}
            </div>); })}
        </nav>
      </aside>}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 py-2 border-b border-line bg-surface">
          {!wide && <Link to="/accueil" aria-label="Accueil" className="p-1.5 -m-1.5"><LogoMark size={34} /></Link>}
          <div className="flex-1 min-w-0">
            {session && session.shops.length > 1
              ? <select aria-label="Boutique" className="bg-transparent font-semibold w-full max-w-xs outline-none truncate" value={session.shopId} onChange={(e) => switchShop(e.target.value)}>{session.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              : <span className="font-semibold truncate block">{shopName}</span>}
            {wide && current && <span className="block text-xs text-muted">{current.label}</span>}
          </div>
          {rejected > 0 && <Link to="/plus" className="text-xs rounded-full bg-bad-bg text-bad border border-bad/40 px-3 py-1">{rejected} vente{rejected > 1 ? "s" : ""} à vérifier</Link>}
          {(!online || pending > 0) && <span className="flex items-center gap-1 text-xs rounded-full bg-warn-bg text-warn border border-warn/40 px-3 py-1">{!online && <WifiOff size={14} />}{online ? "Synchronisation" : "Hors ligne"} · {pending}</span>}
          {wide && <div className="flex items-center gap-2 pl-2 border-l border-line">
            <span className="text-sm text-soft truncate max-w-40">{session?.name}</span>
            <button className="btn-ghost !py-1.5 !min-h-9 !px-3 text-sm flex items-center gap-1.5" onClick={() => void logout()}><LogOut size={15} />Quitter</button>
          </div>}
        </header>
        <SubscriptionBanner />
        <div className="px-4 pt-3 empty:hidden mx-auto w-full max-w-5xl"><VerifyBanner /></div>
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:pb-6">
          <div key={path} className="page-in mx-auto w-full max-w-5xl">
        {sub.data?.entitlement.state === "locked" && !(session?.role === "owner" && path.startsWith("/reglages"))
          ? <div className="text-center py-10 flex flex-col gap-3 items-center"><h1 className="text-xl font-bold">Abonnement expiré</h1><p className="text-muted">L'accès à l'application est suspendu ; vos données sont conservées.{session?.role === "owner" ? " Renouvelez votre formule pour reprendre." : " Contactez le propriétaire du commerce."}</p>{session?.role === "owner" && <Link to="/reglages" className="btn">Renouveler mon abonnement</Link>}<button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>
          : session?.shopId || (session?.role === "owner" && path.startsWith("/reglages")) ? <Outlet key={session.shopId} /> : session?.setupError ? <div className="text-center py-10 flex flex-col gap-3 items-center"><h1 className="text-xl font-bold">Votre commerce n'est pas encore prêt</h1><p className="text-muted">La première boutique n'a pas pu être créée : {session.setupError}. Si le service vient d'être mis en place, réessayez dans quelques minutes.</p><button className="btn" onClick={() => void refresh()}>Réessayer</button>{session.role === "owner" && <Link to="/reglages" className="btn-ghost">Ouvrir les réglages</Link>}<button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div> : <div className="text-center text-muted py-10 flex flex-col gap-3 items-center"><p>Aucune boutique ne vous est affectée. Contactez le propriétaire.</p><button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button></div>}
      
          </div>
        </main>
        {!wide && <BottomNav />}
      </div>
    </div>
  );
  function BottomNav() {
    return (
      <nav aria-label="Navigation" className="fixed bottom-0 inset-x-0 bg-surface border-t border-line grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        <NavLink to="/accueil" label="Accueil" icon={Home} active={path.startsWith("/accueil")} />
        {PHONE_SPACES.map((id) => { const sp = SPACES.find((x) => x.id === id)!; return <NavLink key={id} to={`/espace/${id}`} label={sp.label} icon={sp.icon} active={current?.id === id || path === `/espace/${id}`} disabled={itemsOf(sp, session, plan).length === 0} />; })}
        <NavLink to="/plus" label="Plus" icon={MoreHorizontal} active={path === "/plus" || (!!current && !PHONE_SPACES.includes(current.id)) || (path.startsWith("/espace/") && !PHONE_SPACES.some((id) => path === `/espace/${id}`))} />
      </nav>
    );
  }
}

const PHONE_SPACES = ["vendre", "stock", "piloter"];

function NavLink({ to, label, icon: I, active, disabled }: { to: string; label: string; icon: LucideIcon; active: boolean; disabled?: boolean }) {
  if (disabled) return <span role="link" aria-disabled="true" title="Aucun accès à cet espace avec votre profil" className="flex flex-col items-center gap-0.5 py-2 text-xs text-muted opacity-50"><I size={22} />{label}</span>;
  return <Link to={to} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active ? "text-accent-text font-semibold" : "text-muted"}`}><I size={22} />{label}</Link>;
}

function SideLink({ to, label, icon: I, active }: { to: string; label: string; icon?: LucideIcon; active: boolean }) {
  return <Link to={to} aria-current={active ? "page" : undefined} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm min-h-9 ${active ? "bg-accent-soft text-accent-text font-semibold" : "text-soft hover:bg-subtle"}`}>{I && <I size={18} />}{label}</Link>;
}

/** Rappel non bloquant : adresse e-mail non confirmée (sert à récupérer le mot de passe). Aucune fonction n'est coupée. */
export function VerifyBanner() {
  const { session, refresh } = useSession();
  const [result, setResult] = useState(takeVerifyResult()); const [sent, setSent] = useState(false); const [err, setErr] = useState(""); const [hide, setHide] = useState(false);
  useEffect(() => { if (result === "ok") { void refresh(); clearVerifyResult(); } }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  if (result === "ok") return <Notice tone="ok" title="Adresse e-mail confirmée">Merci : vous pourrez récupérer votre mot de passe par e-mail.</Notice>;
  if (result === "error") return <Notice tone="warn" title="Le lien de confirmation n'a pas fonctionné">Il a peut-être expiré. <button className="underline" onClick={() => { clearVerifyResult(); setResult(null); }}>Fermer</button> puis demandez un nouvel e-mail.</Notice>;
  if (hide || !shouldAskVerification(session?.email, session?.emailVerified)) return null;
  return (
    <Notice tone="info" title="Confirmez votre adresse e-mail">
      <span>Elle sert à récupérer votre mot de passe en cas d'oubli. {sent ? "E-mail envoyé : ouvrez le lien qu'il contient (vérifiez aussi les courriers indésirables)." : ""}{err && <b className="text-bad"> {err}</b>}</span>
      <span className="flex gap-3 pt-1">
        <button className="underline" onClick={async () => { setErr(""); try { await sendVerification(); setSent(true); } catch (e) { setErr((e as Error).message || "Envoi impossible pour le moment."); } }}>{sent ? "Renvoyer l'e-mail" : "Recevoir l'e-mail de confirmation"}</button>
        <button className="underline text-muted" onClick={() => setHide(true)}>Plus tard</button>
      </span>
    </Notice>
  );
}
