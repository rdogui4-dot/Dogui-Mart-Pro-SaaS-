import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { account, teams } from "./appwrite";

export type Role = "owner" | "manager" | "cashier";
export type Session = { userId: string; name: string; tenantId: string; shopId: string; role: Role };
type Ctx = { session: Session | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> };
const C = createContext<Ctx>(null as never);
export const useSession = () => useContext(C);

async function load(): Promise<Session | null> {
  try {
    const me = await account.get();
    const list = await teams.list();
    const team = list.teams[0];
    if (!team) return null;
    const m = await teams.listMemberships({ teamId: team.$id });
    const mine = m.memberships.find((x) => x.userId === me.$id);
    const role = (mine?.roles.find((r) => r === "owner" || r === "manager" || r === "cashier") ?? "cashier") as Role;
    const prefs = (await account.getPrefs()) as { shopId?: string };
    return { userId: me.$id, name: me.name, tenantId: team.$id, shopId: prefs.shopId ?? "default", role };
  } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => { setSession(await load()); setLoading(false); };
  useEffect(() => { void refresh(); }, []);
  const logout = async () => { await account.deleteSession({ sessionId: "current" }); setSession(null); };
  return <C.Provider value={{ session, loading, refresh, logout }}>{children}</C.Provider>;
}

export const can = (role: Role | undefined, action: "sell" | "stock" | "purchase" | "accounting" | "settings") => {
  if (role === "owner") return true;
  if (role === "manager") return action !== "settings";
  return action === "sell";
};
