import { openDB } from "idb";
import { create } from "./data";
import { saleJournal } from "@/domain/accounting";
import type { CartLine, Payment } from "@/domain/money";
import type { Session } from "./session";

export type PendingSale = {
  clientId: string; total: number; vatRatePct: number; lines: CartLine[]; payments: Payment[];
  customerId?: string; soldAt: string; session: Session;
};

const db = () => openDB("dmp-offline", 1, { upgrade(d) { d.createObjectStore("sales", { keyPath: "clientId" }); } });

export async function queueSale(s: PendingSale) { await (await db()).put("sales", s); }
export async function pendingCount(): Promise<number> { return (await db()).count("sales"); }

/** Envoie une vente : ligne vente (clientId unique = idempotent), mouvements de stock, écritures comptables. */
async function pushSale(p: PendingSale) {
  const { session: s } = p;
  const number = `V-${p.soldAt.slice(0, 10).replace(/-/g, "")}-${p.clientId.slice(0, 6).toUpperCase()}`;
  const vat = p.total - Math.round(p.total / (1 + p.vatRatePct / 100));
  try {
    await create("sales", s, {
      number, total: p.total, vat, customerId: p.customerId ?? "", cashierId: s.userId, status: "paid",
      payments: JSON.stringify(p.payments), lines: JSON.stringify(p.lines), clientId: p.clientId, soldAt: p.soldAt,
    }, p.clientId.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 36));
  } catch (e: unknown) {
    if ((e as { code?: number }).code === 409) return; // déjà synchronisée
    throw e;
  }
  for (const l of p.lines) await create("stock_moves", s, { productId: l.productId, qty: l.qty, kind: "sale", refId: number, userId: s.userId });
  const j = saleJournal({ ref: number, date: p.soldAt, totalTtc: p.total, vatRatePct: p.vatRatePct, payments: p.payments });
  for (const e of j.entries) await create("journal_entries", s, { ref: number, account: e.account, debit: e.debit, credit: e.credit, label: e.label, date: p.soldAt });
}

let syncing = false;
export async function syncPending(): Promise<number> {
  if (syncing || !navigator.onLine) return 0;
  syncing = true;
  let done = 0;
  try {
    const d = await db();
    for (const p of (await d.getAll("sales")) as PendingSale[]) {
      try { await pushSale(p); await d.delete("sales", p.clientId); done++; } catch { break; }
    }
  } finally { syncing = false; }
  return done;
}
