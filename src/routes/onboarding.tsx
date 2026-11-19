/** Assistant d'accueil (kit écrans 05-07) : après la création du compte — Entreprise, Boutique, puis « Votre espace est prêt ».
 *  Chaque étape est enregistrée côté serveur ; forme juridique et RCCM/ID fiscal sont facultatifs. Liste de démarrage calculée sur les données réelles (aucune case cochée à la main). */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, ChevronRight, Circle, ImagePlus, Lightbulb, MessageSquare, Package, Rocket, ShoppingCart, Store, UserPlus, X } from "lucide-react";
import { ID, teams } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { compressImage } from "@/lib/articles";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { Stepper } from "@/components/kit";
import { COUNTRIES, DAYS, DESCRIPTION_MAX, LEGAL_FORMS, SECTORS, SHOP_TYPES, companyErrors, countryOf, decodeDays, encodeDays, shopErrors } from "@/domain/signup";
import { MasterSymbol } from "./master";
import type { Overview } from "./settings-general";

const KEY = (userId: string) => `dmp.onb.${userId}`;
type Stored = "shop" | "ready" | "done" | null;
const read = (userId: string): Stored => { try { const v = localStorage.getItem(KEY(userId)); return v === "shop" || v === "ready" || v === "done" ? v : null; } catch { return null; } };
const write = (userId: string, v: Stored) => { try { if (v) localStorage.setItem(KEY(userId), v); else localStorage.removeItem(KEY(userId)); } catch { /* reprise non mémorisée : la liste de démarrage de l'accueil prend le relais */ } };
/** L'assistant reste affiché tant que l'utilisateur n'est pas arrivé à la fin (reprise après rechargement de la page). */
export const onboardingPending = (userId: string): boolean => { const v = read(userId); return v === "shop" || v === "ready"; };

const SIDE = {
  company: { title: "Configurez votre", hl: "entreprise", lead: "Dites-nous en plus sur votre activité : ces informations apparaissent sur vos factures, tickets et rapports.", points: ["Paramétrage rapide", "Modifiable à tout moment dans les Réglages", "Fuseau horaire déduit du pays", "Données isolées et sécurisées"] },
  shop: { title: "Créez votre", hl: "première boutique", lead: "Configurez votre point de vente principal pour commencer à gérer vos ventes, vos stocks et votre équipe.", points: ["Point de vente prêt pour la caisse", "Autres boutiques ajoutables plus tard", "Horaires et type modifiables ensuite", "Devise : franc CFA (XOF)"] },
  ready: { title: "Votre espace est", hl: "prêt !", lead: "Votre entreprise et votre boutique sont configurées. Il ne reste qu'à finaliser quelques réglages pour exploiter tout le potentiel de DOGUI MART PRO.", points: ["Essai gratuit de 14 jours", "Aucune action automatique", "MASTER DOGUI à votre service"] },
} as const;

function Side({ step }: { step: keyof typeof SIDE }) {
  const c = SIDE[step];
  return (
    <aside data-theme="dark" className="hidden lg:flex flex-col justify-between gap-6 p-10 text-[var(--nav-text)] bg-[radial-gradient(ellipse_at_30%_20%,#1d4ed8_0%,#0b1f3a_55%,#07142a_100%)]">
      <Logo size={44} />
      <div className="flex flex-col gap-4 max-w-sm"><MasterSymbol size={72} className="text-[var(--gold)]" /><h2 className="text-3xl font-extrabold leading-tight">{c.title} <span className="text-[var(--gold)]">{c.hl}</span></h2><p className="text-sm opacity-85">{c.lead}</p></div>
      <ul className="flex flex-col gap-2 text-sm">{c.points.map((p) => <li key={p} className="flex items-center gap-2"><CheckCircle2 size={18} className="text-[var(--gold)] shrink-0" aria-hidden="true" />{p}</li>)}</ul>
    </aside>
  );
}
const Req = () => <span className="text-bad" aria-hidden="true"> *</span>;
function Field({ label, req, err, children }: { label: string; req?: boolean; err?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="text-soft">{label}{req && <Req />}</span>{children}{err && <span role="alert" className="text-xs text-bad">{err}</span>}</label>;
}

export function OnboardingPage() {
  const { session, refresh, logout } = useSession(); const s = session!;
  const stored = read(s.userId);
  const [step, setStep] = useState<"company" | "shop" | "ready">(s.needsTenant ? "company" : stored === "ready" ? "ready" : "shop");
  const [ids, setIds] = useState<{ tenantId: string; shopId: string } | null>(s.needsTenant ? null : { tenantId: s.tenantId, shopId: s.shopId });
  const [teamId, setTeamId] = useState<string | null>(s.needsTenant ? null : s.tenantId);
  const ctx = () => ({ ...s, tenantId: ids?.tenantId ?? s.tenantId, shopId: ids?.shopId ?? s.shopId });
  const [c, setC] = useState({ companyName: "", legalForm: "", legal: "", sector: "", country: "CI", city: "", address: "", phone: "+225 ", description: "" });
  const [logo, setLogo] = useState<File | null>(null); const [logoMsg, setLogoMsg] = useState("");
  const logoUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : ""), [logo]); useEffect(() => () => { if (logoUrl) URL.revokeObjectURL(logoUrl); }, [logoUrl]);
  const [sh, setSh] = useState({ name: "", type: "", address: "", city: "", phone: "", days: decodeDays("1111110"), from: "08:00", to: "20:00" });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  // Reprise après rechargement : l'étape Boutique reprend les informations déjà enregistrées (nom, adresse, ville, téléphone) au lieu de repartir à vide.
  useEffect(() => {
    if (step !== "shop" || !ids) return; let live = true;
    void api<Overview>(ctx(), "settings.overview", {}).then((o) => { if (live) setSh((p) => ({ ...p, name: p.name || o.shop.name, address: p.address || o.shop.address, city: p.city || o.shop.city, phone: p.phone || o.shop.phone })); }).catch(() => undefined);
    return () => { live = false; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const country = countryOf(c.country);

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault(); const er = companyErrors(c); setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setErr(""); setLogoMsg("");
    try {
      const id = teamId ?? (await teams.create({ teamId: ID.unique(), name: c.companyName.trim(), roles: ["owner"] })).$id; setTeamId(id);
      const init = await api<{ shopId: string }>({ ...s, tenantId: id }, "tenant.init", { name: c.companyName.trim() });
      const cx = { ...s, tenantId: id, shopId: init.shopId }; setIds({ tenantId: id, shopId: init.shopId });
      await api(cx, "shop.save", { companyName: c.companyName.trim(), legalForm: c.legalForm, legal: c.legal.trim(), sector: c.sector, country: c.country, city: c.city.trim(), address: c.address.trim(), phone: c.phone.trim(), description: c.description.trim() });
      if (logo) { try { await api(cx, "shop.logo", { data: await compressImage(logo) }); } catch (x) { setLogoMsg(`Logo non enregistré (${(x as Error).message}) : vous pourrez l'ajouter dans Paramètres.`); } }
      setSh((p) => ({ ...p, name: p.name || c.companyName.trim(), city: p.city || c.city.trim(), address: p.address || c.address.trim(), phone: p.phone || c.phone.trim() }));
      write(s.userId, "shop"); setStep("shop");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function saveShop(e: React.FormEvent) {
    e.preventDefault(); const er = shopErrors(sh); setErrs(er); if (Object.keys(er).length) return;
    setBusy(true); setErr("");
    try {
      await api(ctx(), "shop.save", { name: sh.name.trim(), shopType: sh.type, address: sh.address.trim(), city: sh.city.trim(), phone: sh.phone.trim(), openDays: encodeDays(sh.days), openFrom: sh.from, openTo: sh.to });
      write(s.userId, "ready"); await refresh(); setStep("ready");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  /** Fin de l'assistant : l'accueil (ou la page choisie) se charge à neuf avec la session complète. */
  const finishTo = (to: string) => { write(s.userId, "done"); window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, "")}${to}`); };
  const input = (v: string, set: (x: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <input className="input w-full" value={v} onChange={(e) => set(e.target.value)} {...extra} />;
  const stepIdx = step === "company" ? 1 : step === "shop" ? 2 : 3;
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] bg-[var(--bg)]">
      <Side step={step} />
      <main className="p-4 sm:p-8 flex flex-col gap-4 max-w-4xl w-full mx-auto justify-center">
        <div className="lg:hidden flex justify-center"><Logo size={44} /></div>
        <div className="card !p-5 sm:!p-7 flex flex-col gap-5">
          <Stepper steps={["Compte", "Entreprise", "Boutique"]} current={stepIdx} label="Étapes de création du compte" compact />

          {step === "company" && <form onSubmit={saveCompany} className="flex flex-col gap-4" noValidate>
            <div><h1 className="text-2xl font-extrabold inline-flex items-center gap-2"><Building2 size={24} aria-hidden="true" />Informations sur votre entreprise</h1><p className="text-sm text-soft">Ces informations seront utilisées sur vos documents, rapports et factures. Bonjour {s.name}, bienvenue !</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom de l'entreprise" req err={errs.companyName}>{input(c.companyName, (v) => setC({ ...c, companyName: v }), { placeholder: "Ex. : DOGUI DISTRIBUTION", autoComplete: "organization", "aria-label": "Nom de l'entreprise" })}</Field>
              <Field label="Forme juridique (facultatif)" err={errs.legalForm}><select className="input w-full" aria-label="Forme juridique" value={c.legalForm} onChange={(e) => setC({ ...c, legalForm: e.target.value })}><option value="">Non renseignée</option>{LEGAL_FORMS.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Numéro RCCM / ID fiscal (facultatif)">{input(c.legal, (v) => setC({ ...c, legal: v }), { placeholder: "Ex. : CI-ABJ-2024-B-12345", maxLength: 120, "aria-label": "Numéro RCCM / ID fiscal" })}</Field>
              <Field label="Secteur d'activité" req err={errs.sector}><select className="input w-full" aria-label="Secteur d'activité" value={c.sector} onChange={(e) => setC({ ...c, sector: e.target.value })}><option value="">Choisir…</option>{SECTORS.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Pays" req err={errs.country}><select className="input w-full" aria-label="Pays" value={c.country} onChange={(e) => { const n = countryOf(e.target.value); setC({ ...c, country: e.target.value, city: "", phone: !c.phone.trim() || /^\+\d{1,3}\s?$/.test(c.phone.trim()) ? `${n?.dial ?? ""} ` : c.phone }); }}>{COUNTRIES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
              <Field label="Ville" req err={errs.city}>{input(c.city, (v) => setC({ ...c, city: v }), { list: "cities", placeholder: country?.cities[0] ?? "", autoComplete: "address-level2", "aria-label": "Ville" })}<datalist id="cities">{country?.cities.map((x) => <option key={x} value={x} />)}</datalist></Field>
              <Field label="Adresse complète" req err={errs.address}>{input(c.address, (v) => setC({ ...c, address: v }), { placeholder: "Ex. : Cocody, Angré 7e Tranche", autoComplete: "street-address", "aria-label": "Adresse complète" })}</Field>
              <Field label="Téléphone de l'entreprise" req err={errs.phone}>{input(c.phone, (v) => setC({ ...c, phone: v }), { type: "tel", inputMode: "tel", autoComplete: "tel", "aria-label": "Téléphone de l'entreprise" })}</Field>
            </div>
            <Field label="Brève description de votre activité" err={errs.description}><textarea className="input w-full min-h-20" aria-label="Brève description de votre activité" maxLength={DESCRIPTION_MAX} placeholder="Ex. : Commerce de détail de produits alimentaires, cosmétiques et articles de maison…" value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /><span className="text-xs text-muted self-end">{c.description.length} / {DESCRIPTION_MAX}</span></Field>
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3">
              {logo ? <img src={logoUrl} alt="Aperçu du logo" className="size-14 rounded-lg object-contain bg-white border border-line" /> : <span className="size-14 rounded-lg bg-subtle grid place-items-center text-muted"><ImagePlus size={24} aria-hidden="true" /></span>}
              <div className="flex-1 min-w-0 text-sm"><b>Logo de l'entreprise (facultatif)</b><p className="text-xs text-muted">PNG, JPG ou WebP ; réduit automatiquement (450 Ko maximum). Imprimé sur vos tickets et factures.</p></div>
              <label className="btn-ghost !min-h-9 text-sm cursor-pointer">{logo ? "Changer" : "Ajouter le logo"}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Ajouter le logo" onChange={(e) => { setLogo(e.target.files?.[0] ?? null); }} /></label>
              {logo && <button type="button" className="icon-btn" aria-label="Retirer le logo" onClick={() => setLogo(null)}><X size={16} /></button>}
            </div>
            {logoMsg && <p role="status" className="text-xs text-warn">{logoMsg}</p>}
            {err && <p role="alert" className="text-bad text-sm">{err}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => void logout()}><ArrowLeft size={16} aria-hidden="true" />Se déconnecter</button><button className="btn inline-flex items-center gap-2" disabled={busy}>Continuer vers la boutique <ArrowRight size={18} aria-hidden="true" /></button></div>
          </form>}

          {step === "shop" && <form onSubmit={saveShop} className="flex flex-col gap-4" noValidate>
            <div><h1 className="text-2xl font-extrabold inline-flex items-center gap-2"><Store size={24} aria-hidden="true" />Créer votre première boutique</h1><p className="text-sm text-soft">Renseignez les informations de votre point de vente principal.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom de la boutique" req err={errs.name}>{input(sh.name, (v) => setSh({ ...sh, name: v }), { placeholder: "Ex. : Dogui Mart Abidjan", "aria-label": "Nom de la boutique" })}</Field>
              <Field label="Type de boutique" req err={errs.type}><select className="input w-full" aria-label="Type de boutique" value={sh.type} onChange={(e) => setSh({ ...sh, type: e.target.value })}><option value="">Choisir…</option>{SHOP_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Adresse de la boutique" req err={errs.address}>{input(sh.address, (v) => setSh({ ...sh, address: v }), { placeholder: "Ex. : Cocody, Angré 7e Tranche", "aria-label": "Adresse de la boutique" })}</Field>
              <Field label="Ville / Commune" req err={errs.city}>{input(sh.city, (v) => setSh({ ...sh, city: v }), { list: "cities2", "aria-label": "Ville / Commune" })}<datalist id="cities2">{country?.cities.map((x) => <option key={x} value={x} />)}</datalist></Field>
              <Field label="Téléphone du point de vente" req err={errs.phone}>{input(sh.phone, (v) => setSh({ ...sh, phone: v }), { type: "tel", inputMode: "tel", "aria-label": "Téléphone du point de vente" })}</Field>
              <Field label="Devise de vente"><input className="input w-full" readOnly value="XOF — Franc CFA (Afrique de l'Ouest)" aria-label="Devise de vente" /></Field>
            </div>
            <fieldset className="flex flex-col gap-2"><legend className="text-sm text-soft">Horaires d'ouverture <Req /></legend>
              <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <label key={d} className={`chip !min-h-9 cursor-pointer ${sh.days[i] ? "border-accent text-accent-text" : ""}`}><input type="checkbox" className="sr-only" checked={sh.days[i]} onChange={(e) => setSh({ ...sh, days: sh.days.map((x, k) => (k === i ? e.target.checked : x)) })} />{d}</label>)}</div>
              <div className="grid grid-cols-2 gap-3 max-w-sm"><Field label="Ouverture">{input(sh.from, (v) => setSh({ ...sh, from: v }), { type: "time", "aria-label": "Ouverture" })}</Field><Field label="Fermeture">{input(sh.to, (v) => setSh({ ...sh, to: v }), { type: "time", "aria-label": "Fermeture" })}</Field></div>
              {errs.hours && <span role="alert" className="text-xs text-bad">{errs.hours}</span>}
            </fieldset>
            {err && <p role="alert" className="text-bad text-sm">{err}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => { setErrs({}); setStep("company"); }}><ArrowLeft size={16} aria-hidden="true" />Étape précédente</button><button className="btn inline-flex items-center gap-2" disabled={busy}>Finaliser et accéder à mon espace <CheckCircle2 size={18} aria-hidden="true" /></button></div>
          </form>}

          {step === "ready" && <Ready onBack={() => setStep("shop")} finishTo={finishTo} />}
        </div>
      </main>
    </div>
  );
}

const TAB_TO: Record<string, string> = { general: "/reglages?onglet=general", fin: "/finance", payments: "/reglages?onglet=payments", team: "/reglages?onglet=equipe" };
function Ready({ onBack, finishTo }: { onBack: () => void; finishTo: (to: string) => void }) {
  const { session } = useSession(); const s = session!;
  const q = useQuery({ queryKey: ["onboarding-overview", s.tenantId, s.shopId], retry: 1, queryFn: () => api<Overview>(s, "settings.overview", {}) });
  const cl = q.data?.checklist; const pct = cl ? Math.round((cl.done / Math.max(1, cl.total)) * 100) : 0;
  const quick: [typeof ShoppingCart, string, string, string][] = [[ShoppingCart, "Commencer à vendre", "Ouvrir la caisse", "/pos"], [Package, "Gérer mon stock", "Ajouter mes articles", "/articles"], [UserPlus, "Inviter mon équipe", "Créer des accès", "/reglages?onglet=equipe"], [MessageSquare, "Découvrir MASTER DOGUI", "Votre assistant métier", "/master"]];
  const go = finishTo;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-4 flex items-center gap-3 bg-ok-bg"><CheckCircle2 size={44} className="text-ok shrink-0" aria-hidden="true" /><div><h1 className="text-2xl font-extrabold">Configuration terminée !</h1><p className="text-sm text-soft">Bienvenue sur DOGUI MART PRO. Votre espace est prêt à l'emploi : finalisez les étapes recommandées ci-dessous pour démarrer sereinement.</p></div></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Checklist de démarrage" className="card !p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between"><h2 className="font-bold">Checklist de démarrage</h2>{cl && <span className="text-sm font-semibold rounded-full bg-subtle px-2 py-0.5">{pct} %</span>}</div>
          <div className="h-2 rounded bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progression du paramétrage"><div className="h-2 rounded bg-ok" style={{ width: `${pct}%` }} /></div>
          {q.isLoading && <p className="text-sm text-muted" aria-busy="true">Vérification de vos données…</p>}
          {q.error && <p role="alert" className="text-sm text-warn">Liste indisponible pour le moment ; elle reste consultable dans Paramètres.</p>}
          {cl && <ul className="flex flex-col divide-y divide-[var(--line)]">{cl.items.map((i) => <li key={i.id}><a className="flex items-center gap-2 py-2 text-sm" href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}${TAB_TO[i.tab] ?? "/reglages"}`} onClick={(e) => { e.preventDefault(); go(TAB_TO[i.tab] ?? "/reglages"); }}>{i.done ? <CheckCircle2 size={18} className="text-ok shrink-0" aria-label="Terminé" /> : <Circle size={18} className="text-muted shrink-0" aria-label="À faire" />}<span className="flex-1 min-w-0"><b className="block">{i.label}</b><span className="text-xs text-muted">{i.hint}</span></span>{!i.done && <ChevronRight size={16} aria-hidden="true" />}</a></li>)}</ul>}
          <p className="text-xs text-muted">Calculée sur vos données réelles ; rien n'est coché à la main ni modifié automatiquement.</p>
        </section>
        <div className="flex flex-col gap-4">
          <section aria-label="Que souhaitez-vous faire maintenant ?" className="card !p-4 flex flex-col gap-2"><h2 className="font-bold">Que souhaitez-vous faire maintenant ?</h2>
            <div className="grid gap-2 sm:grid-cols-2">{quick.map(([I, t, sub, to]) => <button key={t} type="button" className="flex items-center gap-2 rounded-xl border border-line p-3 text-left hover:bg-subtle" onClick={() => go(to)}><I size={20} className="text-accent-text shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1"><b className="block text-sm">{t}</b><span className="text-xs text-muted">{sub}</span></span><ChevronRight size={16} aria-hidden="true" /></button>)}</div></section>
          <section aria-label="Conseils pour bien démarrer" className="card !p-4 flex flex-col gap-1.5"><h2 className="font-bold inline-flex items-center gap-2"><Lightbulb size={18} className="text-[var(--gold)]" aria-hidden="true" />Conseils pour bien démarrer</h2>
            <ul className="flex flex-col gap-1 text-sm">{["Ajoutez d'abord vos articles les plus vendus.", "Vérifiez le taux de TVA et le fuseau horaire dans Paramètres.", "Créez les comptes de votre équipe avec les bons rôles.", "Posez vos questions à MASTER DOGUI dès que vous avez des ventes."].map((t) => <li key={t} className="flex gap-2"><CheckCircle2 size={16} className="text-ok shrink-0 mt-0.5" aria-hidden="true" />{t}</li>)}</ul></section>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Retour</button><button type="button" className="btn inline-flex items-center gap-2" onClick={() => go("/accueil")}><Rocket size={18} aria-hidden="true" />Accéder à mon tableau de bord <ArrowRight size={18} aria-hidden="true" /></button></div>
    </div>
  );
}
