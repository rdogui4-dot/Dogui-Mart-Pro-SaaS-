import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, RouterProvider, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { routerBasepath } from "@/lib/basepath";
import { SessionProvider, can, useSession } from "@/lib/session";
import { Layout } from "@/components/Layout";
import { AuthPage } from "@/routes/auth";
import { CreateTenantPage } from "@/routes/tenant-setup";
import { PosPage } from "@/routes/pos";
import { StockPage } from "@/routes/stock";
import { ClientsPage } from "@/routes/simple";
import { AchatsPage } from "@/routes/achats";
import { ComptaPage } from "@/routes/compta";
import { SettingsPage } from "@/routes/settings";

function Guard({ perm, children }: { perm: Parameters<typeof can>[1]; children: React.ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <p className="p-6 text-white/50">Chargement…</p>;
  if (!session) return <AuthPage />;
  if (session.needsTenant) return <CreateTenantPage />;
  return can(session.role, perm) ? <>{children}</> : <Navigate to="/pos" />;
}
const root = createRootRoute({ component: () => <Guard perm="sell"><Layout /></Guard> });
const r = (path: string, perm: Parameters<typeof can>[1], C: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => root, path, component: () => <Guard perm={perm}><C /></Guard> });
const tree = root.addChildren([
  // Redirection du routeur (et non d'un composant) : un composant d'accueil se monterait brièvement pendant un changement de page et renverrait à la caisse.
  createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/pos" }); } }),
  r("/pos", "sell", PosPage), r("/stock", "stock", StockPage), r("/clients", "sell", ClientsPage),
  r("/achats", "purchase", AchatsPage), r("/compta", "accounting", ComptaPage), r("/reglages", "settings", SettingsPage),
]);
const router = createRouter({ routeTree: tree, basepath: routerBasepath(import.meta.env.BASE_URL) });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={new QueryClient()}><SessionProvider><RouterProvider router={router} /></SessionProvider></QueryClientProvider></StrictMode>,
);
