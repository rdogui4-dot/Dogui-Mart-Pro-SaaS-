import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, ChevronDown, Home, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, UserRound, WifiOff, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { planAllows } from "@/domain/features";
import { useContext, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { SPACES, activeModuleId, itemsOf, kitModulesFor, spaceOfPath, type KitModule } from "@/lib/nav";
import { pendingCount, rejectedSales, syncPending } from "@/lib/offline";
import { SubscriptionBanner, useSubscription } from "@/routes/subscription";
import { LogoMark, MarkInline, Wordmark } from "./Logo";
import { useMasterModal } from "@/lib/master-modal";
import { ShopArt } from "./ShopArt";
import { MasterModalCtx, type MasterTab } from "@/lib/master-modal";
import { Breadcrumb, HelpButton, SearchButton } from "./Shell";
import { usePersistedState } from "@/lib/prefs";
import { can } from "@/lib/session";
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
  const nav = useNavigate(); const path = useRouterState({ select: (st) => st.location.pathname });
  const mctx = { open: (t?: MasterTab) => void nav({ to: "/master", search: { onglet: t ?? "ov" } as never }), close: () => void nav({ to: "/accueil" }), isOpen: path.endsWith("/master") };
  return <MasterModalCtx.Provider value={mctx}><LayoutInner /></MasterModalCtx.Provider>;
}

function LayoutInner() {
  const wide = useWide();
  const { session, switchShop, logout, refresh } = useSession();
  const sub = useSubscription();
  const path = useRouterState({ select: (s) => s.location.pathname }); const search = useRouterState({ select: (s) => s.location.searchStr ?? "" });
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
  const current = spaceOfPath(path); const modules = kitModulesFor(session, plan); const activeId = activeModuleId(path, search);
  const [navPref, setNavPref] = usePersistedState(`dmp.pref.${session?.tenantId ?? "x"}.nav`, { collapsed: false }); const collapsed = navPref.collapsed;
  return (
    <div className="h-full flex flex-col md:flex-row pt-[env(safe-area-inset-top)]">
      {wide && <aside aria-label="Espaces" className={`d3-rail-w flex flex-col shrink-0 bg-nav text-nav-text overflow-y-auto overflow-x-hidden ${collapsed ? "w-[4.5rem]" : "w-72"}`}>
        <Link to="/accueil" className={`flex items-center gap-2.5 py-3.5 text-white ${collapsed ? "justify-center px-2" : "px-4"}`}><MarkInline size={collapsed ? 28 : 30} />{!collapsed && <Wordmark size={17} />}<span className="sr-only">Accueil</span></Link>
        {!collapsed && <ShopCard name={shopName} online={online} pending={pending} />}
        <nav key={collapsed ? "rail" : "full"} aria-label="Navigation principale" className={`d3-unfold-x flex flex-col gap-0.5 ${collapsed ? "items-center p-2" : "p-3 min-w-[18rem]"}`}>
          {modules.map((m) => <ModuleLink key={m.id} m={m} active={activeId === m.id} collapsed={collapsed} />)}
        </nav>
        <button type="button" className={`mt-auto flex items-center gap-2 border-t border-nav-line text-nav-muted hover:text-white hover:bg-nav-hover text-sm min-h-12 ${collapsed ? "justify-center" : "px-4"}`} aria-expanded={!collapsed} aria-label={collapsed ? "Déplier le menu" : "Replier le menu"} onClick={() => setNavPref({ collapsed: !collapsed })}>{collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} />Réduire le menu</>}</button>
      </aside>}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-1.5 sm:gap-2 md:gap-3 px-3 md:px-5 py-2 border-b border-line bg-surface">
          {!wide && <Link to="/accueil" aria-label="Accueil" className="p-1.5 -m-1.5 shrink-0"><LogoMark size={34} /></Link>}
          <div className="flex-1 min-w-0">{wide ? <Breadcrumb path={path} session={session} plan={plan} /> : <span className="font-semibold truncate block">{session && session.shops.length > 1 ? "" : shopName}</span>}</div>
          {session && session.shops.length > 1 && <label className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface px-3 min-h-10 text-sm shadow-[var(--shadow-card)] min-w-0"><span className="hidden lg:inline text-soft whitespace-nowrap">Boutique :</span><select aria-label="Boutique" className="bg-transparent font-semibold outline-none max-w-[9rem] md:max-w-[14rem] truncate" value={session.shopId} onChange={(e) => switchShop(e.target.value)}>{session.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          <NetStatus online={online} pending={pending} />
          {rejected > 0 && <Link to="/plus" className="text-xs rounded-full bg-bad-bg text-bad border border-bad/40 px-3 py-1 whitespace-nowrap">{rejected} vente{rejected > 1 ? "s" : ""} à vérifier</Link>}
          {session && <SearchButton session={session} plan={plan} />}
          {session && <AlertsBell plan={plan} />}
          <HelpButton />
          {!wide && can(session, "settings") && <MasterButton />}
          {session && <ProfileMenu name={session.name} role={session.role} wide={wide} onLogout={() => void logout()} />}
        </header>
        <SubscriptionBanner />
        <div className="px-4 md:px-6 pt-3 empty:hidden mx-auto w-full max-w-[96rem]"><VerifyBanner /></div>
        <main className="flex-1 overflow-y-auto p-4 md:px-6 pb-24 md:pb-6">
          <div key={path + search.replace(/[?&](qid|q)=[^&]*/g, "")} className="page-in mx-auto w-full max-w-[96rem]">
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

/** Entrée de module (kit) : actif en or, MASTER DOGUI distingué (anneau or, symbole cerveau) ; replié : icône seule avec nom accessible. */
function ModuleLink({ m, active, collapsed }: { m: KitModule; active: boolean; collapsed: boolean }) {
  const master = useMasterModal(); const I = m.icon; const isMaster = m.id === "master";
  const cls = `flex items-center gap-3 rounded-xl text-[0.9375rem] transition-colors ${collapsed ? "justify-center w-11 h-10" : "px-3 min-h-9 w-full"} ${active ? "bg-gold text-gold-ink font-semibold shadow-[var(--shadow-card)]" : isMaster ? "my-1 text-white font-semibold ring-1 ring-[color-mix(in_srgb,var(--gold)_70%,transparent)] bg-nav-hover hover:bg-nav-active" : "text-nav-text hover:bg-nav-hover"}`;
  const icon = isMaster ? <img src={`${import.meta.env.BASE_URL}master-icon.svg`} width={22} height={22} alt="" aria-hidden="true" className="shrink-0 rounded-md" /> : <I size={20} aria-hidden="true" className="shrink-0" />;
  const body = <>{icon}{!collapsed && <span className="truncate">{m.label}</span>}</>;
  const a11y = collapsed ? { "aria-label": m.label, title: m.label } : {};
  if (m.modal) return <button type="button" className={`${cls} text-left`} aria-haspopup="dialog" onClick={() => master.open()} {...a11y} aria-label={m.label}>{body}</button>;
  return <Link to={m.to as never} search={(m.onglet ? { onglet: m.onglet } : {}) as never} className={cls} aria-current={active ? "page" : undefined} {...a11y}>{body}</Link>;
}

/** Carte boutique (haut de la barre latérale) : nom de la boutique active et état réel de la connexion. */
function ShopCard({ name, online, pending }: { name: string; online: boolean; pending: number }) {
  return (
    <div className="mx-3 mb-2 rounded-xl border border-nav-line bg-nav-hover px-3 py-2.5 flex items-center gap-3">
      <ShopArt size={48} className="shrink-0 rounded-xl" />
      <div className="min-w-0"><p className="font-semibold text-white truncate">{name}</p>
        <p className="text-xs text-nav-muted flex items-center gap-1.5"><span aria-hidden="true" className={`size-2 rounded-full ${online ? "bg-[var(--tint-green)]" : "bg-[var(--warn)]"}`} />{online ? (pending ? `Synchronisation · ${pending}` : "En ligne") : `Hors ligne${pending ? ` · ${pending} en attente` : ""}`}</p></div>
    </div>
  );
}

/** État réseau réel (navigator.onLine + file locale des ventes). */
function NetStatus({ online, pending }: { online: boolean; pending: number }) {
  if (online && !pending) return <span className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium rounded-full bg-ok-bg text-ok px-3 min-h-9 whitespace-nowrap"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--ok)]" />En ligne</span>;
  return <span className="inline-flex items-center gap-1 text-xs rounded-full bg-warn-bg text-warn border border-warn/40 px-3 py-1 whitespace-nowrap">{!online && <WifiOff size={14} aria-hidden="true" />}{online ? "Synchronisation" : "Hors ligne"} · {pending}</span>;
}

/** Fenêtre déroulante simple : Échap et clic extérieur ferment, le focus revient au bouton. */
function usePopover() {
  const [open, setOpen] = useState(false); const box = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const click = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", key); window.addEventListener("mousedown", click);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("mousedown", click); };
  }, [open]);
  return { open, setOpen, box, btn };
}

type StkAlert = { kind: string; level: "high" | "warn" | "info"; title: string; detail: string };
/** Cloche : uniquement les alertes de stock réelles calculées par le serveur (ruptures, seuils, péremptions, transferts). Masquée sans accès au stock ou hors formule. */
function AlertsBell({ plan }: { plan?: string }) {
  const { session } = useSession(); const pop = usePopover();
  const allowed = !!session && can(session, "stock") && planAllows(plan, "stockIntel");
  // Les alertes ne sont pas urgentes : lues quand le navigateur est inactif (jamais en concurrence avec le premier affichage ou un geste de caisse).
  const [idle, setIdle] = useState(false);
  useEffect(() => { const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(() => setIdle(true), { timeout: 8000 }); return () => w.cancelIdleCallback?.(id); }
    const t = setTimeout(() => setIdle(true), 4000); return () => clearTimeout(t); }, []);
  const q = useQuery({ queryKey: ["stk-alerts", session?.shopId, "bell"], enabled: allowed && idle && navigator.onLine, staleTime: 60_000, retry: 1, queryFn: () => api<{ alerts: StkAlert[]; counts: { high: number; warn: number; info: number } }>(session!, "stk.alerts") });
  if (!allowed) return null;
  const n = (q.data?.counts.high ?? 0) + (q.data?.counts.warn ?? 0); const top = (q.data?.alerts ?? []).filter((a) => a.level !== "info").slice(0, 6);
  return (
    <div ref={pop.box} className="relative">
      <button ref={pop.btn} type="button" className="btn-ghost icon-btn relative" aria-haspopup="true" aria-expanded={pop.open} aria-label={n ? `Alertes : ${n} à traiter` : "Alertes : aucune à traiter"} onClick={() => pop.setOpen(!pop.open)}>
        <Bell size={18} />{n > 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-bad text-white text-[0.6875rem] font-bold flex items-center justify-center">{n > 99 ? "99+" : n}</span>}
      </button>
      {pop.open && (
        <div role="region" aria-label="Alertes de stock" className="pop-in absolute right-0 top-full mt-2 z-40 w-[min(22rem,calc(100vw-1.5rem))] card !p-0 overflow-hidden">
          <p className="px-4 py-2.5 font-semibold border-b border-line">Alertes de stock</p>
          {q.isLoading ? <p className="px-4 py-3 text-sm text-muted">Chargement…</p> : q.isError ? <p className="px-4 py-3 text-sm text-bad">Alertes indisponibles pour le moment.</p> : !top.length ? <p className="px-4 py-3 text-sm text-soft">Aucune alerte à traiter dans cette boutique.</p>
            : <ul className="max-h-80 overflow-y-auto">{top.map((a, i) => <li key={i} className="px-4 py-2.5 border-b border-line last:border-0 text-sm"><b className={a.level === "high" ? "text-bad" : "text-warn"}>{a.title}</b><span className="block text-soft">{a.detail}</span></li>)}</ul>}
          <Link to="/stock" className="block px-4 py-2.5 text-sm font-semibold text-accent-text border-t border-line hover:bg-subtle" onClick={() => pop.setOpen(false)}>Voir toutes les alertes</Link>
        </div>)}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: "Propriétaire", manager: "Gérant", cashier: "Caissier", stockkeeper: "Magasinier", accountant: "Comptable" };
/** Profil : initiales, nom et rôle réels ; mon profil, déconnexion. */
function ProfileMenu({ name, role, wide, onLogout }: { name: string; role: string; wide: boolean; onLogout: () => void }) {
  const pop = usePopover(); const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <div ref={pop.box} className="relative pl-1 md:pl-2 md:border-l md:border-line">
      <button ref={pop.btn} type="button" className="flex items-center gap-2 rounded-xl min-h-10 px-1 hover:bg-subtle" aria-haspopup="menu" aria-expanded={pop.open} aria-label={`Profil : ${name}`} onClick={() => pop.setOpen(!pop.open)}>
        <span aria-hidden="true" className="size-9 rounded-full bg-[var(--nav-bg)] text-white text-sm font-bold flex items-center justify-center">{initials}</span>
        {wide && <span className="hidden lg:flex flex-col items-start leading-tight text-left"><span className="text-sm font-semibold max-w-36 truncate">{name}</span><span className="text-xs text-soft">{ROLE_LABEL[role] ?? role}</span></span>}
        {wide && <ChevronDown size={16} aria-hidden="true" className="hidden lg:block text-soft" />}
      </button>
      {pop.open && (
        <div role="menu" aria-label="Profil" className="pop-in absolute right-0 top-full mt-2 z-40 w-60 card !p-1.5">
          <p className="px-3 py-2 text-sm"><b className="block truncate">{name}</b><span className="text-soft">{ROLE_LABEL[role] ?? role}</span></p>
          <Link role="menuitem" to="/reglages" search={{ onglet: "profil" } as never} className="flex items-center gap-2 rounded-lg px-3 min-h-10 hover:bg-subtle text-sm" onClick={() => pop.setOpen(false)}><UserRound size={16} aria-hidden="true" />Mon profil</Link>
          <button role="menuitem" type="button" className="w-full flex items-center gap-2 rounded-lg px-3 min-h-10 hover:bg-subtle text-sm text-bad" onClick={onLogout}><LogOut size={16} aria-hidden="true" />Se déconnecter</button>
        </div>)}
    </div>
  );
}

function MasterButton() {
  const m = useContext(MasterModalCtx);
  return <button type="button" className="btn-ghost !py-1.5 !min-h-11 !min-w-11 !px-2.5 text-sm shrink-0 inline-flex items-center justify-center gap-2" aria-label="MASTER DOGUI" onClick={() => m.open()}><img src={`${import.meta.env.BASE_URL}master-icon.svg`} width={20} height={20} alt="" aria-hidden="true" className="shrink-0 rounded-[5px]" /><span className="md:hidden hidden min-[430px]:inline">MASTER</span><span className="hidden md:inline">MASTER DOGUI</span></button>;
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
