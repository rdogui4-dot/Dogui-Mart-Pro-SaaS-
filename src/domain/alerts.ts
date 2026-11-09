import { EXPIRY_WARN_DAYS, daysUntil, expiryState } from "./tracking";

/** Alertes du tableau de bord Articles (Pro) : calcul pur à partir de l'état du stock ; la même fonction sert au serveur et aux tests. */
export type AlertType = "stock_out" | "stock_low" | "lot_expired" | "lot_expiring" | "margin_negative" | "bundle_blocked";
export type Severity = "critical" | "warning" | "info";
export type Alert = { id: string; type: AlertType; severity: Severity; productId: string; refId: string; label: string; detail: string };

export const ALERT_LABEL: Record<AlertType, string> = { stock_out: "Rupture de stock", stock_low: "Stock bas", lot_expired: "Lot périmé", lot_expiring: "Péremption proche", margin_negative: "Vente à perte", bundle_blocked: "Bundle non vendable" };
const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export type StockItem = { productId: string; variantId?: string; label: string; qty: number; minStock: number; bundle?: boolean };
export type LotItem = { lotId: string; productId: string; lotNo: string; label: string; qty: number; expiresAt?: string | null };
export type PriceItem = { productId: string; variantId?: string; label: string; price: number; cost: number };

/** Clé fonctionnelle d'une alerte : (type, objet concerné, jour). Une même situation ne produit qu'une alerte par jour. */
export const alertKey = (type: AlertType, refId: string, day: string): string => `${type}|${refId}|${day}`;

export function buildAlerts(input: { day: string; stock: StockItem[]; lots: LotItem[]; prices: PriceItem[]; warnDays?: number }): Omit<Alert, "id">[] {
  const out: Omit<Alert, "id">[] = []; const warn = input.warnDays ?? EXPIRY_WARN_DAYS;
  for (const s of input.stock) {
    const ref = s.variantId ?? s.productId;
    if (s.bundle) { if (s.qty <= 0) out.push({ type: "bundle_blocked", severity: "warning", productId: s.productId, refId: ref, label: s.label, detail: "Un composant manque : ce bundle ne peut plus être vendu." }); continue; }
    if (s.qty <= 0) out.push({ type: "stock_out", severity: "critical", productId: s.productId, refId: ref, label: s.label, detail: "Stock épuisé." });
    else if (s.minStock > 0 && s.qty <= s.minStock) out.push({ type: "stock_low", severity: "warning", productId: s.productId, refId: ref, label: s.label, detail: `Il reste ${s.qty} (seuil ${s.minStock}).` });
  }
  for (const l of input.lots) {
    if (!(l.qty > 0)) continue; const st = expiryState(l.expiresAt ?? null, input.day, warn);
    if (st === "expired") out.push({ type: "lot_expired", severity: "critical", productId: l.productId, refId: l.lotId, label: `${l.label} · lot ${l.lotNo}`, detail: `${l.qty} en stock, périmé depuis ${-daysUntil(String(l.expiresAt), input.day)} jour(s).` });
    else if (st === "soon") out.push({ type: "lot_expiring", severity: "warning", productId: l.productId, refId: l.lotId, label: `${l.label} · lot ${l.lotNo}`, detail: `${l.qty} en stock, expire dans ${daysUntil(String(l.expiresAt), input.day)} jour(s).` });
  }
  for (const p of input.prices) if (p.cost > 0 && p.price < p.cost) out.push({ type: "margin_negative", severity: "warning", productId: p.productId, refId: p.variantId ?? p.productId, label: p.label, detail: `Prix de vente ${p.price} inférieur au coût ${p.cost}.` });
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.type.localeCompare(b.type) || a.label.localeCompare(b.label, "fr"));
}
