import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getShop } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { ShopsSection, StaffSection } from "./team";
import { PlatformSection, SubscriptionSection, useSubscription } from "./subscription";
import { parseDeepLink } from "@/domain/redirects";
import { DEFAULT_PLANS } from "@/domain/subscriptions";
import { COST_METHODS, isCostMethod, methodLabel } from "@/domain/costing";
import { planAllows } from "@/domain/features";
import { EXPIRED_POLICIES, isExpiredPolicy } from "@/domain/tracking";
import { ModuleHeader, PillTabs, type PillTab } from "@/components/kit";
import { Building2, CreditCard, Scale, ScrollText, Settings as SettingsIcon, Store, UserCog } from "lucide-react";
import { GeneralSection, SettingsKpis } from "./settings-general";
import { ActivityLog } from "./activity-log";
import { readFxPref, writeFxPref, useFxLevel, type FxPref } from "@/lib/fx3d";

const FX_TXT = { full: "3D complète (relief, inclinaison, graphiques 3D)", lite: "3D allégée (relief sans inclinaison au pointeur)", flat: "affichage plat (aucun effet 3D)" } as const;
/** Préférence « Effets 3D » de cet appareil : automatique (selon l'appareil et le réglage « réduire les animations »), activée ou désactivée. */
function FxPrefCard() {
  const [pref, setPref] = useState<FxPref>(readFxPref()); const level = useFxLevel();
  return <div className="card flex flex-col gap-2 md:max-w-2xl"><h2 className="font-semibold">Effets 3D</h2><label className="text-xs text-muted flex flex-col gap-1">Sur cet appareil<select className="input" aria-label="Effets 3D" value={pref} onChange={(e) => { const v = e.target.value as FxPref; setPref(v); writeFxPref(v); }}><option value="auto">Automatique (recommandé)</option><option value="on">Activés</option><option value="off">Désactivés</option></select></label><p className="text-xs text-muted" role="status">Actuellement : {FX_TXT[level]}. Si votre appareil demande de réduire les animations, l'affichage reste plat.</p></div>;
}

type STab = "general" | "profile" | "shop" | "rules" | "shops" | "staff" | "payments" | "subscription" | "activity" | "platform";
const MAIN_SET: PillTab<STab>[] = [{ key: "general", label: "Général", icon: SettingsIcon }, { key: "shop", label: "Boutique", icon: Store }, { key: "rules", label: "Règles de gestion", icon: Scale }, { key: "shops", label: "Boutiques", icon: Building2 }, { key: "payments", label: "Paiements", icon: CreditCard }, { key: "activity", label: "Journal d'activité", icon: ScrollText }];
/** Message après enregistrement : succès en vert (statut), erreur en rouge (alerte). */
const Msg = ({ text }: { text: string }) => (!text ? null : /^(Enregistr|Méthode enregistr|Politique enregistr|Marge minimale enregistr|Lien retiré)/.test(text) ? <p className="d3-saved text-sm text-ok font-medium self-start rounded-lg bg-ok-bg px-3 py-1.5" role="status">✓ {text}</p> : <p className="text-sm text-bad" role="alert">{text}</p>);

export function SettingsPage() {
  const { session, logout } = useSession(); const s = session!;
  const [f, setF] = useState({ waveTemplate: "", orangeTemplate: "", expiryMinutes: "15" });
  const [msg, setMsg] = useState("");
  const pay = useQuery({ queryKey: ["pay-settings", s.shopId], enabled: can(s, "settings"), queryFn: () => api<{ wave: boolean; orange: boolean }>(s, "payments.settings.get", {}) });
  // Arrivée depuis Selar (URL de redirection) : on ouvre l'onglet Abonnement sur l'offre indiquée. Lu une seule fois.
  const [deep] = useState(() => parseDeepLink(window.location.search, DEFAULT_PLANS.map((p) => p.id)));
  const [tab, setTab] = useState<STab>(deep.tab === "profile" || !can(s, "settings") ? "profile" : deep.tab ?? "general");
  const sub = useSubscription();
  const me = useQuery({ queryKey: ["platform-me"], queryFn: () => api<{ admin: boolean }>(s, "platform.me", {}), staleTime: 300_000 });
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (!opened && sub.data?.entitlement.state === "locked") { setTab("subscription"); setOpened(true); } }, [sub.data, opened]);
  const qc = useQueryClient();
  const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s) });
  const [sh, setSh] = useState({ name: "", address: "", city: "", phone: "", legal: "", vatRatePct: "18" });
  const [shMsg, setShMsg] = useState("");
  const costMethod = (isCostMethod((shop.data as { costMethod?: string } | null)?.costMethod) ? (shop.data as { costMethod: string }).costMethod : "cmup");
  const [costMsg, setCostMsg] = useState(""); const [costBusy, setCostBusy] = useState(false);
  const expiredPolicy = isExpiredPolicy((shop.data as { expiredPolicy?: string } | null)?.expiredPolicy) ? (shop.data as { expiredPolicy: string }).expiredPolicy : "block";
  const [polMsg, setPolMsg] = useState("");
  const [mm, setMm] = useState(""); const [mmMsg, setMmMsg] = useState("");
  useEffect(() => { setMm(String((shop.data as { minMarginPct?: number } | null)?.minMarginPct ?? 0)); }, [shop.data]);
  async function saveMargin() { setMmMsg(""); try { await api(s, "shop.save", { minMarginPct: Number(mm) }); setMmMsg("Marge minimale enregistrée."); await qc.invalidateQueries({ queryKey: ["shop"] }); } catch (x) { setMmMsg((x as Error).message); } }
  async function savePolicy(v: string) {
    setPolMsg("");
    try { await api(s, "shop.save", { expiredPolicy: v }); setPolMsg("Politique enregistrée."); await qc.invalidateQueries({ queryKey: ["shop"] }); } catch (x) { setPolMsg((x as Error).message); }
  }
  async function saveMethod(m: string) {
    setCostMsg(""); setCostBusy(true);
    try { await api(s, "shop.save", { costMethod: m }); setCostMsg("Méthode enregistrée."); await qc.invalidateQueries({ queryKey: ["shop"] }); }
    catch (x) { setCostMsg((x as Error).message); } finally { setCostBusy(false); }
  }
  useEffect(() => { if (shop.data) setSh({ name: shop.data.name ?? "", address: shop.data.address ?? "", city: shop.data.city ?? "", phone: shop.data.phone ?? "", legal: shop.data.legal ?? "", vatRatePct: String(shop.data.vatRatePct ?? 18) }); }, [shop.data]);
  async function saveShop(e: React.FormEvent) {
    e.preventDefault(); setShMsg("");
    try { await api(s, "shop.save", { ...sh, vatRatePct: Number(sh.vatRatePct) }); setShMsg("Enregistré"); void qc.invalidateQueries({ queryKey: ["shop"] }); }
    catch (x) { setShMsg((x as Error).message); }
  }
  useEffect(() => { void api<{ expiryMinutes: number }>(s, "payments.settings.get").then((r) => setF((x) => ({ ...x, expiryMinutes: String(r.expiryMinutes) }))).catch(() => {}); }, [s]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try {
      const r = await api<{ converted?: string[] }>(s, "payments.settings.save", { ...(f.waveTemplate && { waveTemplate: f.waveTemplate }), ...(f.orangeTemplate && { orangeTemplate: f.orangeTemplate }), expiryMinutes: Number(f.expiryMinutes) });
      setMsg(r.converted?.length ? `Enregistré. Le montant de votre lien ${r.converted.map((p) => (p === "wave" ? "Wave" : "Orange")).join(" et ")} a été remplacé par {amount} : le vrai montant sera inséré à chaque vente.` : "Enregistré");
      setF((x) => ({ ...x, waveTemplate: "", orangeTemplate: "" })); void pay.refetch();
    } catch (x) { setMsg((x as Error).message); }
  }
  async function removeLink(p: "wave" | "orange") {
    if (!confirm(`Retirer le lien ${p === "wave" ? "Wave" : "Orange"} Business ? Les ventes ne pourront plus se payer par ce QR code.`)) return;
    setMsg("");
    try { await api(s, "payments.settings.save", { [p === "wave" ? "waveTemplate" : "orangeTemplate"]: "" }); setMsg("Lien retiré"); void pay.refetch(); } catch (x) { setMsg((x as Error).message); }
  }
  return (
    <div className="flex flex-col gap-3">
      <ModuleHeader icon={tab === "staff" ? UserCog : tab === "subscription" ? CreditCard : SettingsIcon} title={tab === "staff" ? "Équipe & Permissions" : tab === "subscription" ? "Abonnement & Facturation" : "Paramètres généraux"} subtitle={tab === "staff" ? "Membres, rôles, accès et boutiques autorisées." : tab === "subscription" ? "Votre formule, vos paiements et vos échéances." : "Configurez et personnalisez DOGUI MART PRO selon vos besoins."} />
      {can(s, "settings") && <>
        {tab !== "staff" && tab !== "subscription" && <SettingsKpis />}
        <PillTabs idBase="set" label="Sections des paramètres" value={MAIN_SET.some((t) => t.key === tab) ? tab : ("" as STab)} onChange={setTab} items={MAIN_SET} />
        <div role="tablist" aria-label="Autres sections" className="scroll-x !gap-1.5 -mt-1 md:flex-wrap md:overflow-x-visible">{([["profile", "Mon profil"], ["staff", "Équipe & accès"], ["subscription", "Abonnement"], ...(me.data?.admin ? [["platform", "Plateforme"]] : [])] as [STab, string][]).map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} className="chip !min-h-8 !py-1 !px-3 text-sm" onClick={() => setTab(k)}>{l}</button>)}</div>
      </>}
      <div key={tab} className="d3-settings flex flex-col gap-3">
      {tab === "general" && can(s, "settings") && <GeneralSection onTab={(t) => setTab(t as STab)} />}
      {tab === "shops" && <ShopsSection />}
      {tab === "staff" && <StaffSection />}
      {tab === "subscription" && <SubscriptionSection initial={deep.plan ? { plan: deep.plan, period: deep.period } : undefined} />}
      {tab === "platform" && me.data?.admin && <PlatformSection />}
      {tab === "activity" && can(s, "settings") && <ActivityLog />}
      {(tab === "shop" || tab === "payments" || tab === "rules" || tab === "profile") && <>
      {s.setupError && <div className="card text-sm text-warn">La première boutique n'a pas pu être créée ({s.setupError}). Les fonctions de gestion seront disponibles dès que le service sera prêt.</div>}
      {tab === "profile" && <div className="card text-sm">Connecté : <b>{s.name}</b> · {s.role === "owner" ? "gérant principal" : s.role}<br />Boutique : {s.shops.find((x) => x.id === s.shopId)?.name ?? "—"}<br /><span className="text-xs text-muted">Mon identifiant : {s.userId}</span></div>}
      {tab === "shop" && can(s, "settings") && (
        <form className="card flex flex-col gap-3 md:max-w-2xl" onSubmit={saveShop}>
          <h2 className="font-semibold">Ma boutique (en-tête des factures et tickets)</h2>
          <label className="text-xs text-muted flex flex-col gap-1">Nom commercial<input aria-label="Nom commercial" className="input" placeholder="Nom commercial" required value={sh.name} onChange={(e) => setSh({ ...sh, name: e.target.value })} /></label>
          <label className="text-xs text-muted flex flex-col gap-1">Adresse<input aria-label="Adresse" className="input" placeholder="Adresse" value={sh.address} onChange={(e) => setSh({ ...sh, address: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted flex flex-col gap-1">Ville<input aria-label="Ville" className="input" placeholder="Ville" value={sh.city} onChange={(e) => setSh({ ...sh, city: e.target.value })} /></label>
            <label className="text-xs text-muted flex flex-col gap-1">Téléphone (sert aussi à l'essai MASTER DOGUI)<input aria-label="Téléphone" className="input" inputMode="tel" placeholder="Téléphone" value={sh.phone} onChange={(e) => setSh({ ...sh, phone: e.target.value })} /></label>
          </div>
          <label className="text-xs text-muted flex flex-col gap-1">NINEA / RCCM (mentions légales)<input aria-label="NINEA / RCCM (mentions légales)" className="input" placeholder="NINEA / RCCM (mentions légales)" value={sh.legal} onChange={(e) => setSh({ ...sh, legal: e.target.value })} /></label>
          <label className="text-xs text-muted flex flex-col gap-1">Taux de TVA (%)<input aria-label="TVA (%)" className="input" inputMode="numeric" placeholder="TVA (%)" value={sh.vatRatePct} onChange={(e) => setSh({ ...sh, vatRatePct: e.target.value })} /></label>
          <button className="btn md:self-start md:px-8">Enregistrer</button>
          <Msg text={shMsg} />
        </form>
      )}
      {tab === "rules" && can(s, "settings") && (
        <div className="card flex flex-col gap-2">
          <h2 className="font-semibold">Valorisation du stock</h2>
          <p className="text-xs text-muted">Une seule méthode par boutique. Elle s'applique aux réceptions suivantes ; les ventes passées gardent le coût figé au moment de la vente.</p>
          <select className="input" aria-label="Méthode de valorisation" value={costMethod} disabled={costBusy} onChange={(e) => void saveMethod(e.target.value)}>{COST_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <p className="text-xs text-muted">{COST_METHODS.find((m) => m.id === costMethod)?.help}</p>
          {!planAllows(sub.data?.entitlement.plan.id, "costing") && <p className="text-xs text-warn">Le choix de la méthode est réservé à la formule Pro (méthode actuelle : {methodLabel(costMethod)}).</p>}
          <Msg text={costMsg} />
        </div>
      )}
      {tab === "rules" && can(s, "settings") && (
        <div className="card flex flex-col gap-2">
          <h2 className="font-semibold">Lots périmés</h2>
          <p className="text-xs text-muted">Pour les articles suivis par lot : que faire à la caisse d'un lot dont la date de péremption est dépassée ?</p>
          <select className="input" aria-label="Politique des lots périmés" value={expiredPolicy} disabled={!planAllows(sub.data?.entitlement.plan.id, "lots")} onChange={(e) => void savePolicy(e.target.value)}>{EXPIRED_POLICIES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          {!planAllows(sub.data?.entitlement.plan.id, "lots") && <p className="text-xs text-warn">Les lots et dates d'expiration sont réservés à la formule Pro.</p>}
          <Msg text={polMsg} />
        </div>
      )}
      {tab === "rules" && can(s, "settings") && planAllows(sub.data?.entitlement.plan.id, "promotions") && (
        <div className="card flex flex-col gap-2">
          <h2 className="font-semibold">Promotions : marge minimale</h2>
          <p className="text-xs text-muted">Une promotion est refusée à la création, et ignorée à la caisse, si le prix final passe sous « coût × (1 + marge) ». 0 = seulement interdire de vendre sous le coût.</p>
          <div className="flex gap-2"><input className="input" inputMode="numeric" aria-label="Marge minimale (%)" value={mm} onChange={(e) => setMm(e.target.value)} /><button className="btn" onClick={() => void saveMargin()}>Enregistrer</button></div>
          <Msg text={mmMsg} />
        </div>
      )}
      {tab === "payments" && can(s, "settings") && (
        <form className="card flex flex-col gap-2" onSubmit={save}>
          <h2 className="font-semibold">Paiement par QR code</h2>
          <p className="text-xs text-muted">Collez un lien de paiement généré par votre compte Wave Business / Orange Business pour un montant d'essai (ex. 1000) : l'application remplace ce montant par le vrai montant de chaque vente. Vous pouvez aussi écrire vous-même <code>{"{amount}"}</code> (et <code>{"{ref}"}</code>) dans le lien. Un lien déjà enregistré n'est jamais réaffiché ; un champ laissé vide reste inchangé.</p>
          <div className="flex gap-2 flex-wrap text-xs">{(["wave", "orange"] as const).map((p) => <span key={p} className="flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1">{p === "wave" ? "Wave" : "Orange"} : {pay.data ? (pay.data[p] ? <><b className="text-ok">configuré</b><button type="button" className="text-bad underline" onClick={() => void removeLink(p)}>retirer</button></> : "non configuré") : "…"}</span>)}</div>
          <input aria-label="Modèle de lien Wave Business (https://…{amount}…)" className="input" placeholder="Modèle de lien Wave Business (https://…{amount}…)" value={f.waveTemplate} onChange={(e) => setF({ ...f, waveTemplate: e.target.value })} />
          <input aria-label="Modèle de lien Orange Business (https://…{amount}…)" className="input" placeholder="Modèle de lien Orange Business (https://…{amount}…)" value={f.orangeTemplate} onChange={(e) => setF({ ...f, orangeTemplate: e.target.value })} />
          <input aria-label="Validité du lien (minutes)" className="input" inputMode="numeric" placeholder="Validité du lien (minutes)" value={f.expiryMinutes} onChange={(e) => setF({ ...f, expiryMinutes: e.target.value })} />
          <button className="btn">Enregistrer</button>
          <Msg text={msg} />
        </form>
      )}
      {tab === "profile" && <FxPrefCard />}
      {tab === "profile" && <button className="btn-ghost md:self-start" onClick={() => void logout()}>Se déconnecter</button>}
      </>}
      </div>
    </div>
  );
}
