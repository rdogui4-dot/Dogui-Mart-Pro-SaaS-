import { openDB } from "idb";
import { api, ApiError } from "./api";
import type { Payment } from "@/domain/money";
import type { Session } from "./session";

/** Ce que le caissier a saisi. Les prix, le stock et la comptabilité sont recalculés par le serveur. */
export type PendingSale = {
  clientId: string; soldAt: string; customerId?: string; redeemPoints?: number; couponCode?: string;
  lines: { productId: string; qty: number | string; unit?: string; variantId?: string; serials?: string[]; discountPct?: number }[];
  payments: (Payment & { linkId?: string; reference?: string })[]; approvals?: { discount?: string; margin?: string };
  session: Session;
  error?: string; // refus définitif du serveur (stock, plafond…) : à traiter par un humain
};

const db = () => openDB("dmp-offline", 2, { upgrade(d) { if (!d.objectStoreNames.contains("sales")) d.createObjectStore("sales", { keyPath: "clientId" }); } });

export async function queueSale(s: PendingSale) { await (await db()).put("sales", s); }
/** Ventes en attente d'envoi (hors celles que le serveur a refusées : elles attendent une décision humaine, voir rejectedSales). */
export async function pendingCount(): Promise<number> { return ((await (await db()).getAll("sales")) as PendingSale[]).filter((x) => !x.error).length; }
export async function rejectedSales(): Promise<PendingSale[]> { return ((await (await db()).getAll("sales")) as PendingSale[]).filter((x) => x.error).sort((a, b) => a.soldAt.localeCompare(b.soldAt)); }
/** Remet une vente refusée dans la file (après correction du stock, par exemple) ou l'abandonne définitivement. */
export async function retryRejected(clientId: string): Promise<void> { const d = await db(); const p = (await d.get("sales", clientId)) as PendingSale | undefined; if (p) { const { error: _e, ...rest } = p; await d.put("sales", rest); } }
export async function discardRejected(clientId: string): Promise<void> { await (await db()).delete("sales", clientId); }

/** Issue d'une vente envoyée : la vente n'est « synchronisée » que lorsque le SERVEUR l'a confirmée (numéro et code de vérification renvoyés). */
export type SyncResult = { clientId: string; status: "synced"; number: string; verifyCode?: string } | { clientId: string; status: "rejected"; error: string };
const results = new Map<string, SyncResult>(); const listeners = new Set<(r: SyncResult) => void>();
export const syncResultOf = (clientId: string): SyncResult | undefined => results.get(clientId);
export function onSyncResult(cb: (r: SyncResult) => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
const emit = (r: SyncResult) => { results.set(r.clientId, r); for (const l of listeners) l(r); };
/** État affiché pour une vente : « pending » tant que le serveur n'a pas répondu (hors ligne, coupure, file), « synced » seulement après confirmation, « rejected » après refus définitif. */
export async function saleStatus(clientId: string): Promise<"pending" | "synced" | "rejected" | "unknown"> {
  const r = results.get(clientId); if (r) return r.status; const p = (await (await db()).get("sales", clientId)) as PendingSale | undefined; return p ? (p.error ? "rejected" : "pending") : "unknown";
}

let syncing = false;
export async function syncPending(): Promise<number> {
  if (syncing || !navigator.onLine) return 0;
  syncing = true; let done = 0;
  try {
    const d = await db();
    for (const p of (await d.getAll("sales")) as PendingSale[]) {
      if (p.error) continue;
      try {
        const { session, error: _e, ...payload } = p;
        const res = await api<{ number?: string; verifyCode?: string }>(session, "checkout", payload);
        await d.delete("sales", p.clientId); done++; emit({ clientId: p.clientId, status: "synced", number: String(res?.number ?? ""), ...(res?.verifyCode ? { verifyCode: res.verifyCode } : {}) });
      } catch (e) {
        // Refus métier (4xx) : on garde la vente marquée en erreur au lieu de boucler indéfiniment.
        // Abonnement expiré : la vente reste en attente et partira après le renouvellement (ce n'est pas un refus définitif).
        if (e instanceof ApiError && e.status === 402 && e.message.startsWith("Abonnement expiré")) break;
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) { await d.put("sales", { ...p, error: e.message }); emit({ clientId: p.clientId, status: "rejected", error: e.message }); }
        else break; // réseau / 5xx : on réessaiera
      }
    }
  } finally { syncing = false; }
  return done;
}
