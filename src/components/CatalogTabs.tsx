import { Link } from "@tanstack/react-router";
import { Boxes, Package } from "lucide-react";

/** Onglets du module Articles & Catalogue (seuls les écrans existants). */
export function CatalogTabs({ current, articles, bundles }: { current: "articles" | "bundles"; articles?: number; bundles?: number }) {
  const t = (key: "articles" | "bundles", to: string, label: string, n: number | undefined, I: typeof Package) => <Link key={key} to={to as never} role="tab" aria-selected={current === key} className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[0.95rem] font-semibold border transition-colors ${current === key ? "bg-[var(--accent)] text-white border-transparent shadow-[var(--shadow-card)]" : "bg-[var(--surface)] border-[var(--line)] hover:bg-subtle"}`}><I size={18} aria-hidden="true" />{label}{n !== undefined ? ` (${n.toLocaleString("fr-FR")})` : ""}</Link>;
  return <div role="tablist" aria-label="Sections du catalogue" className="scroll-x !gap-2 md:flex-wrap md:overflow-x-visible">{t("articles", "/articles", "Tous les articles", articles, Package)}{t("bundles", "/bundles", "Bundles / Lots", bundles, Boxes)}</div>;
}

