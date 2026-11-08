import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DATABASE_ID, Query, account, tables, teams } from "./appwrite";
import { api } from "./api";

export type Role = "owner" | "manager" | "cashier";
export type ShopInfo = { id: string; name: string };
/** shopId vaut "" tant qu'aucune boutique n'est affectée à l'employé. */
export type Session = {
  userId: string; name: string; tenantId: string; shopId: string; role: Role; shops: ShopInfo[];
  /** Renseigné si la première boutique n'a pas pu être créée (service serveur indisponible) : l'utilisateur entre quand même et voit pourquoi. */
  setupError?: string;
  /** Compte connecté mais sans commerce (inscription interrompue) : l'application propose de le créer. */
  needsTenant?: boolean;
};
type Ctx = { session: Session | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; switchShop: (id: string) => void };
const C = createContext<Ctx>(null as never);
export const useSession = () => useContext(C);

const KEY = (userId: string) => `dmp.shop.${userId}`;
const remembered = (userId: string): string | null => { try { return localStorage.getItem(KEY(userId)); } catch { return null; } };
const remember = (userId: string, id: string) => { try { localStorage.setItem(KEY(userId), id); } catch { /* navigation privée : on s'en passe */ } };

async function listShops(tenantId: string): Promise<ShopInfo[]> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: "shops", queries: [Query.equal("tenantId", tenantId), Query.limit(50)] });
  return r.rows.map((x) => ({ id: x.$id, name: String((x as unknown as { name?: string }).name ?? x.$id) }));
}

async function load(): Promise<Session | null> {
  try {
    const me = await account.get();
    const team = (await teams.list()).teams[0];
    if (!team) return { userId: me.$id, name: me.name, tenantId: "", shopId: "", role: "owner", shops: [], needsTenant: true };
    const m = await teams.listMemberships({ teamId: team.$id });
    const mine = m.memberships.find((x) => x.userId === me.$id);
    const role = (mine?.roles.find((r) => r === "owner" || r === "manager" || r === "cashier") ?? "cashier") as Role;
    let shops = await listShops(team.$id);
    let setupError: string | undefined;
    if (role === "owner" && shops.length === 0) { // première connexion du propriétaire : le serveur crée la boutique principale
      try {
        await api({ userId: me.$id, name: me.name, tenantId: team.$id, shopId: "", role, shops: [] }, "tenant.init", { name: team.name });
        shops = await listShops(team.$id);
      } catch (e) { setupError = (e as Error).message || "Service indisponible"; } // ne plus renvoyer silencieusement à l'écran de connexion
    }
    if (role !== "owner") { // un employé ne voit que les boutiques qui lui sont affectées
      let ids: string[] = [];
      try { const st = (await tables.getRow({ databaseId: DATABASE_ID, tableId: "staff", rowId: me.$id })) as unknown as { shopIds?: string; active?: boolean }; ids = st.active === false ? [] : JSON.parse(st.shopIds ?? "[]"); } catch { /* pas de fiche : aucun accès */ }
      shops = shops.filter((s) => ids.includes(s.id));
    }
    const want = remembered(me.$id);
    const shopId = shops.find((s) => s.id === want)?.id ?? shops[0]?.id ?? "";
    return { userId: me.$id, name: me.name, tenantId: team.$id, shopId, role, shops, setupError };
  } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => { setSession(await load()); setLoading(false); };
  useEffect(() => { void refresh(); }, []);
  const logout = async () => { await account.deleteSession({ sessionId: "current" }); qc.clear(); setSession(null); };
  const switchShop = (id: string) => {
    setSession((s) => { if (!s || !s.shops.some((x) => x.id === id)) return s; remember(s.userId, id); return { ...s, shopId: id }; });
    qc.clear(); // les données en cache appartiennent à l'ancienne boutique
  };
  return <C.Provider value={{ session, loading, refresh, logout, switchShop }}>{children}</C.Provider>;
}

export const can = (role: Role | undefined, action: "sell" | "stock" | "purchase" | "accounting" | "settings") => {
  if (role === "owner") return true;
  if (role === "manager") return action !== "settings";
  return action === "sell";
};
