import { openDB } from "idb";
import { api, ApiError } from "./api";
import type { Payment } from "@/domain/money";
import type { Session } from "./session";

/** Ce que le caissier a saisi. Les prix, le stock et la comptabilité sont recalculés par le serveur. */
export type PendingSale = {
  clientId: string; soldAt: string; customerId?: string; redeemPoints?: number;
  lines: { productId: string; qty: number }[];
  payments: (Payment & { linkId?: string })[];
  session: Session;
  error?: string; // refus définitif du serveur (stock, plafond…) : à traiter par un humain
};

const db = () => openDB("dmp-offline", 2, { upgrade(d) { if (!d.objectStoreNames.contains("sales")) d.createObjectStore("sales", { keyPath: "clientId" }); } });

export async function queueSale(s: PendingSale) { await (await db()).put("sales", s); }
export async function pendingCount(): Promise<number> { return (await db()).count("sales"); }
export async function rejectedSales(): Promise<PendingSale[]> { return ((await (await db()).getAll("sales")) as PendingSale[]).filter((x) => x.error); }

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
        await api(session, "checkout", payload);
        await d.delete("sales", p.clientId); done++;
      } catch (e) {
        // Refus métier (4xx) : on garde la vente marquée en erreur au lieu de boucler indéfiniment.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) await d.put("sales", { ...p, error: e.message });
        else break; // réseau / 5xx : on réessaiera
      }
    }
  } finally { syncing = false; }
  return done;
}
