import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { SessionProvider, can, useSession } from "@/lib/session";
import { Layout } from "@/components/Layout";
import { AuthPage } from "@/routes/auth";
import { PosPage } from "@/routes/pos";
import { StockPage } from "@/routes/stock";
import { AchatsPage, ClientsPage } from "@/routes/simple";
import { ComptaPage } from "@/routes/compta";
import { SettingsPage } from "@/routes/settings";

function Guard({ perm, children }: { perm: Parameters<typeof can>[1]; children: React.ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <p className="p-6 text-white/50">Chargement…</p>;
  if (!session) return <AuthPage />;
  return can(session.role, perm) ? <>{children}</> : <Navigate to="/pos" />;
}
const root = createRootRoute({ component: () => <Guard perm="sell"><Layout /></Guard> });
const r = (path: string, perm: Parameters<typeof can>[1], C: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => root, path, component: () => <Guard perm={perm}><C /></Guard> });
const tree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: () => <Navigate to="/pos" /> }),
  r("/pos", "sell", PosPage), r("/stock", "stock", StockPage), r("/clients", "sell", ClientsPage),
  r("/achats", "purchase", AchatsPage), r("/compta", "accounting", ComptaPage), r("/reglages", "settings", SettingsPage),
]);
const router = createRouter({ routeTree: tree });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js");
createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={new QueryClient()}><SessionProvider><RouterProvider router={router} /></SessionProvider></QueryClientProvider></StrictMode>,
);
