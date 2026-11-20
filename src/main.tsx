import "@fontsource-variable/inter";
import "./index.css";
import { apply as applyFx3d } from "@/lib/fx3d";
applyFx3d();
import { StrictMode, Suspense, lazy, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { onPlanDenied } from "@/lib/api";
import { RouterProvider, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { routerBasepath } from "@/lib/basepath";
import { SessionProvider, can, useSession, type Perm } from "@/lib/session";
import { Layout } from "@/components/Layout";
import { consumeVerifyReturn } from "@/lib/verify";
import { installLocalIfServed } from "@/lib/local-backend";
import { ErrorPage, ForbiddenPage, NotFoundPage, SpacePage } from "@/routes/shell-pages";
import { AuthPage } from "@/routes/auth";
import { InvitationPage, isInvitationPath } from "@/routes/invitation";
import { LegalPage, legalDocAt } from "@/routes/legal";
import { OnboardingPage, onboardingPending } from "@/routes/onboarding";
import { HomePage, PlusPage } from "@/routes/home";


/** Pages chargées à la demande : le premier affichage reste léger sur réseau mobile. Si le fichier est introuvable (hors ligne sur une page jamais visitée, ou nouvelle version publiée), un message clair remplace une page blanche. */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    try { return { default: (await load())[name] }; }
    catch {
      try { await new Promise((ok) => setTimeout(ok, 600)); return { default: (await load())[name] }; }
      catch { return { default: () => <div className="card flex flex-col gap-2 text-sm" role="alert"><b>Cette page n'a pas pu être chargée.</b><span className="text-muted">Vous êtes peut-être hors ligne, ou une nouvelle version vient d'être publiée. Les pages déjà ouvertes en ligne restent disponibles hors ligne.</span><button className="btn" onClick={() => window.location.reload()}>Recharger</button></div> }; }
    }
  });
}
const PosPage = lazyPage(() => import("@/routes/pos"), "PosPage");
const StockPage = lazyPage(() => import("@/routes/stock"), "StockPage");
const ClientsPage = lazyPage(() => import("@/routes/simple"), "ClientsPage");
const AchatsPage = lazyPage(() => import("@/routes/fournisseurs"), "FournisseursPage");
const SettingsPage = lazyPage(() => import("@/routes/settings"), "SettingsPage");
const ArticlesPage = lazyPage(() => import("@/routes/articles"), "ArticlesPage");
const BundlesPage = lazyPage(() => import("@/routes/bundles"), "BundlesPage");
const UiKitPage = lazyPage(() => import("@/routes/ui-kit"), "UiKitPage");
const ActivitePage = lazyPage(() => import("@/routes/activite"), "ActivitePage");
const CaissePage = lazyPage(() => import("@/routes/caisse"), "CaissePage");
const CaisseProPage = lazyPage(() => import("@/routes/caisse-pro"), "CaisseProPage");
const DepensesPage = lazyPage(() => import("@/routes/depenses"), "DepensesPage");
const InventairePage = lazyPage(() => import("@/routes/inventaire"), "InventairePage");
const FinancePage = lazyPage(() => import("@/routes/finance"), "FinancePage");
const MasterPage = lazyPage(() => import("@/routes/master-route"), "MasterRoute");
const MerciPage = lazyPage(() => import("@/routes/master-route"), "MerciRoute");
const InvestPage = lazyPage(() => import("@/routes/investissements"), "InvestPage");
const IComptaPage = lazyPage(() => import("@/routes/icompta"), "IComptaPage");
const DepensesProPage = lazyPage(() => import("@/routes/depenses-pro"), "DepensesProPage");
const VentesPage = lazyPage(() => import("@/routes/ventes"), "VentesPage");
const AvoirsPage = lazyPage(() => import("@/routes/avoirs"), "AvoirsPage");
const PilotagePage = lazyPage(() => import("@/routes/pilotage"), "PilotagePage");
const DashboardPage = lazyPage(() => import("@/routes/dashboard"), "DashboardPage");
const PromotionsPage = lazyPage(() => import("@/routes/promotions"), "PromotionsPage");

// Réseau mobile instable : une seule nouvelle tentative, et les écrans gardent leurs dernières données si le réseau tombe.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

onPlanDenied(() => void queryClient.invalidateQueries({ queryKey: ["subscription"] }));

function Guard({ perm, children }: { perm: Perm | null; children: React.ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <p className="p-6 text-muted">Chargement…</p>;
  if (!session) return <AuthPage />;
  if (session.needsTenant || onboardingPending(session.userId)) return <OnboardingPage />;
  return perm === null || can(session, perm) ? <>{children}</> : <ForbiddenPage />;
}
const root = createRootRoute({ component: () => (isInvitationPath() ? <InvitationPage /> : legalDocAt(window.location.pathname) ? <LegalPage doc={legalDocAt(window.location.pathname)!} /> : <Guard perm={null}><Layout /></Guard>), notFoundComponent: NotFoundPage, errorComponent: ({ error }) => <ErrorPage error={error} /> });
const r = (path: string, perm: Perm | null, C: ComponentType) =>
  createRoute({ getParentRoute: () => root, path, component: () => <Guard perm={perm}><Suspense fallback={<div className="card h-24 animate-pulse bg-subtle" aria-busy="true" aria-label="Chargement" />}><C /></Suspense></Guard> });
const tree = root.addChildren([
  // Redirection du routeur (et non d'un composant) : un composant d'accueil se monterait brièvement pendant un changement de page et renverrait à la caisse.
  createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/accueil" }); } }),
  r("/accueil", null, HomePage), r("/plus", null, PlusPage), r("/espace/$id", null, SpacePage),
  r("/pos", "pos", PosPage), r("/stock", "stock", StockPage), r("/articles", "stock", ArticlesPage), r("/bundles", "stock", BundlesPage), r("/inventaire", "stock", InventairePage), r("/caisse", "pos", CaissePage), r("/avoirs", "pos", AvoirsPage), r("/caisse-pro", "pos", CaisseProPage), r("/depenses", "pos", DepensesPage), r("/depenses-pro", "pos", DepensesProPage), r("/ventes", "pos", VentesPage), r("/activite", "reports", ActivitePage), r("/pilotage", "reports", PilotagePage), r("/tableau", "stock", DashboardPage), r("/promotions", "stock", PromotionsPage), r("/clients", "customers", ClientsPage),
  r("/finance", "accounting", FinancePage), r("/icompta", "finance", IComptaPage), r("/investissements", "accounting", InvestPage), r("/master", "settings", MasterPage), r("/merci", "settings", MerciPage), createRoute({ getParentRoute: () => root, path: "/compta", beforeLoad: () => { throw redirect({ to: "/icompta" }); } }), r("/achats", "purchases", AchatsPage), r("/reglages", "settings", SettingsPage), r("/ui-kit", null, UiKitPage),
]);
const router = createRouter({ routeTree: tree, basepath: routerBasepath(import.meta.env.BASE_URL) });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Une nouvelle version du service worker prend la main : on recharge une fois pour afficher l'application à jour (pas à la toute première installation).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => reg.update().catch(() => undefined)).catch(() => undefined);
}
// Préchargement discret des pages de comptoir (caisse, stock, ventes) : le service worker les met en cache pour le hors-ligne.
if (import.meta.env.PROD) window.addEventListener("load", () => setTimeout(() => { if (navigator.onLine) for (const p of [import("@/routes/pos"), import("@/routes/stock"), import("@/routes/caisse"), import("@/routes/ventes")]) void p.catch(() => undefined); }, 4000), { once: true });
installLocalIfServed(); // version Windows : le serveur local sert l'application et remplace le cloud
void consumeVerifyReturn().finally(() => createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={queryClient}><SessionProvider><RouterProvider router={router} /></SessionProvider></QueryClientProvider></StrictMode>,
));
