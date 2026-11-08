/** Isolation des LECTURES par boutique (et par rôle). Les écritures, elles, passent toutes par la fonction serveur.
 *
 *  Principe : chaque ligne reçoit à sa création une liste de rôles autorisés à la lire.
 *   - le propriétaire du commerce lit tout (rôle d'équipe « owner ») ;
 *   - les employés lisent via des ÉTIQUETTES posées sur leur compte par le serveur :
 *       `s<shopId>` = affecté à la boutique (caissier ou gérant) ; `g<shopId>` = gérant de la boutique ;
 *   - les données sensibles (achats, factures, compta, fournisseurs) exigent l'étiquette gérant. */
export type Role = string;

/** Étiquettes Appwrite : alphanumériques, 36 caractères max. On échoue bruyamment plutôt que de créer une étiquette invalide. */
function label(prefix: "s" | "g", shopId: string): string {
  const l = `${prefix}${shopId}`;
  if (!/^[A-Za-z0-9]{2,36}$/.test(l)) throw new Error(`Identifiant de boutique incompatible avec une étiquette : ${shopId}`);
  return l;
}
export const staffLabel = (shopId: string) => label("s", shopId);
export const managerLabel = (shopId: string) => label("g", shopId);

/** Étiquettes d'un employé : actif uniquement ; le gérant reçoit en plus l'étiquette gérant de chaque boutique. */
export function labelsFor(role: "manager" | "cashier", shopIds: string[], active: boolean): string[] {
  if (!active) return [];
  return [...new Set(shopIds.flatMap((id) => (role === "manager" ? [staffLabel(id), managerLabel(id)] : [staffLabel(id)])))];
}

type Row = Record<string, unknown>;
const owner = (tenantId: string) => `team:${tenantId}/owner`;
const shopOf = (d: Row) => String(d.shopId ?? "");

/** Politique par table. TOUTE table du schéma doit y figurer (un test le vérifie). */
const POLICY: Record<string, (tenantId: string, d: Row, id: string) => Role[] | null> = {
  // Données d'une boutique, lisibles par tous ses employés
  products: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  stock_moves: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  customers: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  sales: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  payment_settings: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  payment_links: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  // Données sensibles d'une boutique : gérants seulement
  suppliers: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`],
  purchase_orders: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`],
  invoices: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`],
  journal_entries: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`],
  audit_log: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`],
  // Un transfert concerne deux boutiques : les gérants des deux
  transfers: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`, `label:${managerLabel(String(d.toShopId ?? ""))}`],
  // La fiche d'une boutique (identifiant = id de ligne) n'est visible que de ses employés
  shops: (t, _d, id) => [owner(t), `label:${staffLabel(id)}`],
  // Fiche employé : le propriétaire, et l'employé lui-même
  staff: (t, d) => [owner(t), `user:${String(d.userId ?? "")}`],
  // Abonnement : propriétaire seulement
  subscriptions: (t) => [owner(t)],
  subscription_payments: (t) => [owner(t)],
  // Réglages de plateforme : aucune lecture client (clé serveur uniquement)
  platform_settings: () => [],
};
export const POLICY_TABLES = Object.keys(POLICY);

/** Rôles autorisés à lire la ligne. Lève pour une table sans politique : jamais de lecture ouverte par défaut. */
export function readRoles(table: string, tenantId: string, data: Row, id: string): Role[] {
  const p = POLICY[table]; if (!p) throw new Error(`Aucune politique de lecture pour la table « ${table} »`);
  // Un commerce vide (donnée de plateforme) n'a aucun lecteur côté client.
  if (!tenantId) return [];
  return [...new Set(p(tenantId, data, id) ?? [])];
}
