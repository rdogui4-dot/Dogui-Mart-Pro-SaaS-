import { type Module } from "../../../src/domain/access";
/** Isolation des LECTURES par boutique et par accès. Les écritures, elles, passent toutes par la fonction serveur.
 *
 *  Principe : chaque ligne reçoit à sa création une liste de rôles autorisés à la lire.
 *   - le propriétaire du commerce lit tout (rôle d'équipe « owner ») ;
 *   - les employés lisent via des ÉTIQUETTES posées sur leur compte par le serveur, une par boutique affectée et par accès :
 *       `s` = affecté à la boutique (produits, stock, clients, ventes) ; `g` = gérant (journal d'audit) ;
 *       `k` = module Stock (transferts) ; `u` = module Achats (fournisseurs, commandes) ;
 *       `i` = module Factures clients ; `a` = module Comptabilité (journal, factures fournisseurs).
 *   Les modules Caisse, Clients et Rapports n'ont pas d'étiquette propre : la caisse et les clients lisent avec `s`,
 *   et les rapports sont calculés par le serveur (contrôle d'accès dans la fonction). */
export type Role = string;
type Kind = "s" | "g" | "k" | "u" | "i" | "a";

/** Étiquettes Appwrite : alphanumériques, 36 caractères max. On échoue bruyamment plutôt que de créer une étiquette invalide. */
function label(prefix: Kind, shopId: string): string {
  const l = `${prefix}${shopId}`;
  if (!/^[A-Za-z0-9]{2,36}$/.test(l)) throw new Error(`Identifiant de boutique incompatible avec une étiquette : ${shopId}`);
  return l;
}
export const staffLabel = (shopId: string) => label("s", shopId);
export const managerLabel = (shopId: string) => label("g", shopId);
const MODULE_KIND: Partial<Record<Module, Kind>> = { stock: "k", purchases: "u", invoices: "i", accounting: "a" };
export const moduleLabel = (m: Module, shopId: string): string | null => (MODULE_KIND[m] ? label(MODULE_KIND[m]!, shopId) : null);

/** Étiquettes d'un employé : actif uniquement. Pour chaque boutique affectée : `s`, `g` si gérant, et celle de chaque module accordé. */
export function labelsFor(role: string, modules: Module[], shopIds: string[], active: boolean): string[] {
  if (!active) return [];
  return [...new Set(shopIds.flatMap((id) => [staffLabel(id), ...(role === "manager" ? [managerLabel(id)] : []), ...modules.map((m) => moduleLabel(m, id)).filter((l): l is string => !!l)]))];
}

type Row = Record<string, unknown>;
const owner = (tenantId: string) => `team:${tenantId}/owner`;
const shopOf = (d: Row) => String(d.shopId ?? "");

/** Politique par table. TOUTE table du schéma doit y figurer (un test le vérifie). */
const POLICY: Record<string, (tenantId: string, d: Row, id: string) => Role[] | null> = {
  // Données d'une boutique, lisibles par tous ses employés
  products: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  // Historique des prix : module Stock de la boutique
  price_history: (t, d) => [owner(t), `label:${moduleLabel("stock", shopOf(d))}`],
  // Conditionnements : lisibles par les employés de la boutique (la caisse en a besoin)
  article_units: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  stock_moves: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  customers: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  sales: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  payment_settings: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  payment_links: (t, d) => [owner(t), `label:${staffLabel(shopOf(d))}`],
  // Données sensibles d'une boutique : réservées aux employés qui ont le module correspondant
  suppliers: (t, d) => [owner(t), `label:${moduleLabel("purchases", shopOf(d))}`],
  purchase_orders: (t, d) => [owner(t), `label:${moduleLabel("purchases", shopOf(d))}`],
  invoices: (t, d) => [owner(t), `label:${moduleLabel("invoices", shopOf(d))}`, `label:${moduleLabel("accounting", shopOf(d))}`], // factures clients et fournisseurs
  journal_entries: (t, d) => [owner(t), `label:${moduleLabel("accounting", shopOf(d))}`],
  audit_log: (t, d) => [owner(t), `label:${managerLabel(shopOf(d))}`],
  // Un transfert concerne deux boutiques : le module Stock des deux
  transfers: (t, d) => [owner(t), `label:${moduleLabel("stock", shopOf(d))}`, `label:${moduleLabel("stock", String(d.toShopId ?? ""))}`],
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
