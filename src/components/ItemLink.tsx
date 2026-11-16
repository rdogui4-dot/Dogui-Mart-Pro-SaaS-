import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { NavItem } from "@/lib/nav";
import { useMasterModal } from "@/lib/master-modal";

/** Lien d'un module : une fenêtre (MASTER DOGUI) s'ouvre sur place, les autres modules changent de page. */
export function ItemLink({ item, className, children, current }: { item: NavItem; className?: string; children: ReactNode; current?: boolean }) {
  const m = useMasterModal();
  if (item.modal) return <button type="button" className={`${className ?? ""} text-left`} aria-haspopup="dialog" onClick={() => m.open()}>{children}</button>;
  return <Link to={item.to} className={className} aria-current={current ? "page" : undefined}>{children}</Link>;
}
