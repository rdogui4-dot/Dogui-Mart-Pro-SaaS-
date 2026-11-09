import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, RouterProvider, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { routerBasepath } from "@/lib/basepath";
import { SessionProvider, can, homePath, useSession, type Perm } from "@/lib/session";
import { Layout } from "@/components/Layout";
import { AuthPage } from "@/routes/auth";
import { CreateTenantPage } from "@/routes/tenant-setup";
import { PosPage } from "@/routes/pos";
import { StockPage } from "@/routes/stock";
import { ClientsPage } from "@/routes/simple";
import { AchatsPage } from "@/routes/achats";
import { ComptaPage } from "@/routes/compta";
import { SettingsPage } from "@/routes/settings";
import { HomePage, PlusPage } from "@/routes/home";
import { ArticlesPage } from "@/routes/articles";
import { BundlesPage } from "@/routes/bundles";
import { DashboardPage } from "@/routes/dashboard";

// Réseau mobile instable : une seule nouvelle tentative, et les écrans gardent leurs dernières données si le réseau tombe.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

function Guard({ perm, children }: { perm: Perm | null; children: React.ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <p className="p-6 text-white/50">Chargement…</p>;
  if (!session) return <AuthPage />;
  if (session.needsTenant) return <CreateTenantPage />;
  return perm === null || can(session, perm) ? <>{children}</> : <Navigate to={homePath(session)} />;
}
const root = createRootRoute({ component: () => <Guard perm={null}><Layout /></Guard> });
const r = (path: string, perm: Perm | null, C: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => root, path, component: () => <Guard perm={perm}><C /></Guard> });
const tree = root.addChildren([
  // Redirection du routeur (et non d'un composant) : un composant d'accueil se monterait brièvement pendant un changement de page et renverrait à la caisse.
  createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/accueil" }); } }),
  r("/accueil", null, HomePage), r("/plus", null, PlusPage),
  r("/pos", "pos", PosPage), r("/stock", "stock", StockPage), r("/articles", "stock", ArticlesPage), r("/bundles", "stock", BundlesPage), r("/tableau", "stock", DashboardPage), r("/clients", "customers", ClientsPage),
  r("/achats", "purchases", AchatsPage), r("/compta", "finance", ComptaPage), r("/reglages", "settings", SettingsPage),
]);
const router = createRouter({ routeTree: tree, basepath: routerBasepath(import.meta.env.BASE_URL) });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={queryClient}><SessionProvider><RouterProvider router={router} /></SessionProvider></QueryClientProvider></StrictMode>,
);
