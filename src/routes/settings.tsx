import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getShop } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { ShopsSection, StaffSection } from "./team";
import { PlatformSection, SubscriptionSection, useSubscription } from "./subscription";
import { parseDeepLink } from "@/domain/redirects";
import { DEFAULT_PLANS } from "@/domain/subscriptions";

export function SettingsPage() {
  const { session, logout } = useSession(); const s = session!;
  const [f, setF] = useState({ waveTemplate: "", orangeTemplate: "", expiryMinutes: "15" });
  const [msg, setMsg] = useState("");
  // Arrivée depuis Selar (URL de redirection) : on ouvre l'onglet Abonnement sur l'offre indiquée. Lu une seule fois.
  const [deep] = useState(() => parseDeepLink(window.location.search, DEFAULT_PLANS.map((p) => p.id)));
  const [tab, setTab] = useState<"general" | "shops" | "staff" | "subscription" | "platform">(deep.tab === "subscription" ? "subscription" : "general");
  const sub = useSubscription();
  const me = useQuery({ queryKey: ["platform-me"], queryFn: () => api<{ admin: boolean }>(s, "platform.me", {}), staleTime: 300_000 });
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (!opened && sub.data?.entitlement.state === "locked") { setTab("subscription"); setOpened(true); } }, [sub.data, opened]);
  const qc = useQueryClient();
  const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s) });
  const [sh, setSh] = useState({ name: "", address: "", city: "", phone: "", legal: "", vatRatePct: "18" });
  const [shMsg, setShMsg] = useState("");
  useEffect(() => { if (shop.data) setSh({ name: shop.data.name ?? "", address: shop.data.address ?? "", city: shop.data.city ?? "", phone: shop.data.phone ?? "", legal: shop.data.legal ?? "", vatRatePct: String(shop.data.vatRatePct ?? 18) }); }, [shop.data]);
  async function saveShop(e: React.FormEvent) {
    e.preventDefault(); setShMsg("");
    try { await api(s, "shop.save", { ...sh, vatRatePct: Number(sh.vatRatePct) }); setShMsg("Enregistré"); void qc.invalidateQueries({ queryKey: ["shop"] }); }
    catch (x) { setShMsg((x as Error).message); }
  }
  useEffect(() => { void api<{ expiryMinutes: number }>(s, "payments.settings.get").then((r) => setF((x) => ({ ...x, expiryMinutes: String(r.expiryMinutes) }))).catch(() => {}); }, [s]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { await api(s, "payments.settings.save", { ...(f.waveTemplate && { waveTemplate: f.waveTemplate }), ...(f.orangeTemplate && { orangeTemplate: f.orangeTemplate }), expiryMinutes: Number(f.expiryMinutes) }); setMsg("Enregistré"); setF((x) => ({ ...x, waveTemplate: "", orangeTemplate: "" })); }
    catch (x) { setMsg((x as Error).message); }
  }
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Réglages</h1>
      {can(s.role, "settings") && (
        <div className="flex flex-wrap gap-1 text-sm [&>button]:flex-1">
          {([["general", "Général"], ["shops", "Boutiques"], ["staff", "Équipe"], ["subscription", "Abonnement"], ...(me.data?.admin ? [["platform", "Plateforme"] as const] : [])] as const).map(([k, l]) => <button key={k} className={tab === k ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      )}
      {tab === "shops" && <ShopsSection />}
      {tab === "staff" && <StaffSection />}
      {tab === "subscription" && <SubscriptionSection initial={deep.plan ? { plan: deep.plan, period: deep.period } : undefined} />}
      {tab === "platform" && me.data?.admin && <PlatformSection />}
      {tab === "general" && <>
      {s.setupError && <div className="card text-sm text-amber-300">La première boutique n'a pas pu être créée ({s.setupError}). Les fonctions de gestion seront disponibles dès que le service sera prêt.</div>}
      <div className="card text-sm">Connecté : <b>{s.name}</b> · rôle {s.role}<br />Boutique : {s.shopId}<br /><span className="text-xs text-white/50">Mon identifiant : {s.userId}</span></div>
      {can(s.role, "settings") && (
        <form className="card flex flex-col gap-2" onSubmit={saveShop}>
          <h2 className="font-semibold">Ma boutique (en-tête des factures et tickets)</h2>
          <input className="input" placeholder="Nom commercial" required value={sh.name} onChange={(e) => setSh({ ...sh, name: e.target.value })} />
          <input className="input" placeholder="Adresse" value={sh.address} onChange={(e) => setSh({ ...sh, address: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Ville" value={sh.city} onChange={(e) => setSh({ ...sh, city: e.target.value })} />
            <input className="input" inputMode="tel" placeholder="Téléphone" value={sh.phone} onChange={(e) => setSh({ ...sh, phone: e.target.value })} />
          </div>
          <input className="input" placeholder="NINEA / RCCM (mentions légales)" value={sh.legal} onChange={(e) => setSh({ ...sh, legal: e.target.value })} />
          <input className="input" inputMode="numeric" placeholder="TVA (%)" value={sh.vatRatePct} onChange={(e) => setSh({ ...sh, vatRatePct: e.target.value })} />
          <button className="btn">Enregistrer</button>
          {shMsg && <p className="text-sm text-amber-300">{shMsg}</p>}
        </form>
      )}
      {can(s.role, "settings") && (
        <form className="card flex flex-col gap-2" onSubmit={save}>
          <h2 className="font-semibold">Paiement par QR code</h2>
          <p className="text-xs text-white/50">Collez le modèle de lien de votre compte Wave Business / Orange Business. Variables : <code>{"{amount}"}</code> (obligatoire) et <code>{"{ref}"}</code>. Les modèles déjà enregistrés ne sont jamais réaffichés ; un champ laissé vide reste inchangé.</p>
          <input className="input" placeholder="Modèle de lien Wave Business (https://…{amount}…)" value={f.waveTemplate} onChange={(e) => setF({ ...f, waveTemplate: e.target.value })} />
          <input className="input" placeholder="Modèle de lien Orange Business (https://…{amount}…)" value={f.orangeTemplate} onChange={(e) => setF({ ...f, orangeTemplate: e.target.value })} />
          <input className="input" inputMode="numeric" placeholder="Validité du lien (minutes)" value={f.expiryMinutes} onChange={(e) => setF({ ...f, expiryMinutes: e.target.value })} />
          <button className="btn">Enregistrer</button>
          {msg && <p className="text-sm text-amber-300">{msg}</p>}
        </form>
      )}
      <button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button>
      </>}
    </div>
  );
}
