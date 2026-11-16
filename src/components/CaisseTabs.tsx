import { Link } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { planAllows } from "@/domain/features";
import { useSubscription } from "@/routes/subscription";

/** Les quatre écrans de la caisse forment un seul module : mêmes adresses qu'avant, un onglet par écran selon la formule. */
export function CaisseTabs({ current }: { current: "/pos" | "/ventes" | "/caisse" | "/caisse-pro" }) {
  const { session } = useSession();
  const plan = useSubscription().data?.entitlement.plan.id;
  void session;
  const tabs = [
    { to: "/pos", label: "Encaisser", on: true },
    { to: "/ventes", label: "Ventes", on: planAllows(plan, "smartPos") },
    { to: "/caisse", label: "Session de caisse", on: planAllows(plan, "smartPos") },
    { to: "/caisse-pro", label: "Caisse Pro", on: planAllows(plan, "smartPosPro") },
  ].filter((t) => t.on);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Écrans de la caisse" className="scroll-x">
      {tabs.map((t) => <Link key={t.to} to={t.to} className="chip" aria-current={current === t.to}>{t.label}</Link>)}
    </nav>
  );
}
