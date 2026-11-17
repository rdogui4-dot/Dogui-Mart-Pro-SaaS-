/** Paniers mis en attente à la caisse (lot K3). Conservés sur CET appareil uniquement (navigateur), par boutique.
 *  Règles : rien n'est envoyé au serveur ; le stock n'est pas réservé ; les prix et promotions sont recalculés à la reprise ;
 *  au plus MAX_HELD paniers ; un panier repris est retiré de la liste. */
export const MAX_HELD = 10;
export type HeldCart<L> = { id: string; at: string; label: string; lines: L[]; customerId: string; coupon: string };
const key = (shopId: string) => `dmp.pos.held.${shopId}`;
type Store = Pick<Storage, "getItem" | "setItem">;
const ls = (): Store | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function loadHeld<L>(shopId: string, st: Store | null = ls()): HeldCart<L>[] {
  try { const v = JSON.parse(st?.getItem(key(shopId)) ?? "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && Array.isArray(x.lines)) : []; } catch { return []; }
}
function save<L>(shopId: string, list: HeldCart<L>[], st: Store | null): boolean {
  try { if (!st) return false; st.setItem(key(shopId), JSON.stringify(list)); return true; } catch { return false; }
}
/** Ajoute un panier. Refuse (ok:false + raison) un panier vide, la limite atteinte ou un stockage indisponible : le panier en cours n'est alors pas vidé. */
export function holdCart<L>(shopId: string, cart: Omit<HeldCart<L>, "id" | "at">, now = new Date(), st: Store | null = ls(), id = `h${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`): { ok: true; list: HeldCart<L>[] } | { ok: false; reason: string } {
  if (!cart.lines.length) return { ok: false, reason: "Le panier est vide." };
  const list = loadHeld<L>(shopId, st);
  if (list.length >= MAX_HELD) return { ok: false, reason: `Déjà ${MAX_HELD} paniers en attente : reprenez-en ou supprimez-en un.` };
  const next = [...list, { ...cart, id, at: now.toISOString() }];
  return save(shopId, next, st) ? { ok: true, list: next } : { ok: false, reason: "Stockage de l'appareil indisponible : le panier reste en cours." };
}
export function removeHeld<L>(shopId: string, id: string, st: Store | null = ls()): HeldCart<L>[] {
  const next = loadHeld<L>(shopId, st).filter((x) => x.id !== id); save(shopId, next, st); return next;
}
