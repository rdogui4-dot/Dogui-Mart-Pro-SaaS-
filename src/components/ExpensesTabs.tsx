import { Link } from "@tanstack/react-router";
import { useSubscription } from "@/routes/subscription";
import { planAllows } from "@/domain/features";

/** Dépenses et Dépenses Pro forment un seul module : mêmes adresses qu'avant, un onglet par écran selon la formule. */
export function ExpensesTabs({ current }: { current: "/depenses" | "/depenses-pro" }) {
  const plan = useSubscription().data?.entitlement.plan.id;
  const tabs = [{ to: "/depenses", label: "Dépenses", on: true }, { to: "/depenses-pro", label: "Budgets et prévisions", on: planAllows(plan, "expensesPro") }].filter((t) => t.on);
  if (tabs.length < 2) return null;
  return <nav aria-label="Écrans des dépenses" className="scroll-x">{tabs.map((t) => <Link key={t.to} to={t.to} className="chip" aria-current={current === t.to}>{t.label}</Link>)}</nav>;
}
