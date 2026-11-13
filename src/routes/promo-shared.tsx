import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Family, Promo, PromoStatus } from "@/domain/promotions";

/** Campagne telle que la renvoie `promotions.list` (le serveur fait foi : statut effectif, gel Pro, résultats réels). */
export type PromoView = Promo & { requireRefs: { productId: string; qty: number }[]; comboRefs: { productId: string; qty: number }[]; effective: PromoStatus; describe: string; advanced: boolean; frozen: boolean; foreign: boolean; uses: number; discountTotal: number; revenue: number; budgetUsed: number; budgetUsedHere: number; couponCount: number; localEnabled: boolean; localValue?: number; localBudget?: number };
export type PromoSettings = { tz: string; minMarginPct: number; maxLinePct: number | null; maxCartPct: number | null; strategy: "best" | "priority"; typeRank: string[] };
export type ListData = { pro: boolean; tz: string; settings: PromoSettings; promos: PromoView[]; overlaps: { a: string; b: string; why: string }[]; expiringSoon: { id: string; name: string; endAt: string }[]; shops: { id: string; name: string }[]; now: string };

export const usePromoList = (enabled: boolean) => { const { session } = useSession(); const s = session!; return useQuery({ queryKey: ["promotions-list", s.shopId], enabled, queryFn: () => api<ListData>(s, "promotions.list") }); };
export const TONE: Record<PromoStatus, string> = { draft: "bg-subtle text-soft", scheduled: "bg-info-bg text-info", active: "bg-ok-bg text-ok", suspended: "bg-warn-bg text-warn", ended: "bg-subtle text-muted" };
export const fmtDate = (iso: string, tz: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso: string, tz: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: tz, weekday: "short", day: "2-digit", month: "short" });
export const FAMILY_LABEL: Record<Family, string> = { simple: "Remise simple", tiers: "Prix dégressifs", bogo: "Achetez X, obtenez Y", combo: "Pack", requires: "Conditionnée", cart: "Panier" };

/** Carte « fonction Pro » proposée en mise à niveau (aucun accès côté serveur sans la formule). */
export function ProLock({ what }: { what: string }) {
  return <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Pro</span><span className="text-muted">{what}</span>
    <button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`)}>Passer à Pro</button></div>;
}

type P = { $id: string; name: string; price: number; category?: string; archived?: boolean; kind?: string };
/** Sélecteur d'articles (cases à cocher, recherche), avec quantité facultative (packs, articles requis). */
export function ItemPicker({ title, products, value, onChange, qty, disabled, max = 200 }: { title: string; products: P[]; value: { productId: string; qty?: number }[]; onChange: (v: { productId: string; qty?: number }[]) => void; qty?: boolean; disabled?: boolean; max?: number }) {
  const [find, setFind] = useState(""); const ids = value.map((v) => v.productId);
  const pick = products.filter((p) => (!p.archived && p.kind !== "bundle") || ids.includes(p.$id)).filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div className="card flex flex-col gap-2"><b className="text-sm">{title} ({value.length})</b>
      <input className="input" placeholder="Rechercher un article" value={find} onChange={(e) => setFind(e.target.value)} aria-label={`Rechercher — ${title}`} />
      <div className="max-h-44 overflow-y-auto flex flex-col gap-1">{pick.slice(0, 80).map((p) => { const cur = value.find((v) => v.productId === p.$id); return (
        <label key={p.$id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled || (!cur && value.length >= max)} checked={!!cur} onChange={(e) => onChange(e.target.checked ? [...value, { productId: p.$id, ...(qty ? { qty: 1 } : {}) }] : value.filter((v) => v.productId !== p.$id))} />
          <span className="flex-1 truncate">{p.name}</span>{qty && cur && <input className="input !w-16 !py-1 text-center" inputMode="numeric" aria-label={`Quantité ${p.name}`} disabled={disabled} value={cur.qty ?? 1} onChange={(e) => onChange(value.map((v) => (v.productId === p.$id ? { ...v, qty: Number(e.target.value.replace(/\D/g, "")) || 1 } : v)))} />}</label>); })}</div></div>
  );
}
