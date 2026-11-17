import { Link } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { planAllows } from "@/domain/features";
import { useSubscription } from "@/routes/subscription";

/** Les écrans de la caisse forment un seul module : mêmes adresses qu'avant, un onglet par écran selon la formule. */
export function CaisseTabs({ current }: { current: "/pos" | "/ventes" | "/caisse" | "/caisse-pro" | "/avoirs" }) {
  const { session } = useSession();
  const plan = useSubscription().data?.entitlement.plan.id;
  const tabs = [
    { to: "/pos", label: "Encaisser", on: true },
    { to: "/ventes", label: "Ventes", on: planAllows(plan, "smartPos") },
    { to: "/caisse", label: "Session de caisse", on: planAllows(plan, "smartPos") },
    { to: "/caisse-pro", label: "Caisse Pro", on: planAllows(plan, "smartPosPro") },
    { to: "/avoirs", label: "Avoirs", on: planAllows(plan, "smartPosPro") && (session?.role === "owner" || session?.role === "manager") },
  ].filter((t) => t.on);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Écrans de la caisse" className="scroll-x">
      {tabs.map((t) => <Link key={t.to} to={t.to} className="chip max-sm:!min-h-9 max-sm:!py-1 max-sm:!px-3 max-sm:text-sm" aria-current={current === t.to}>{t.label}</Link>)}
    </nav>
  );
}
