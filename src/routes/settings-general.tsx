/** Paramètres généraux (kit) — vue « Général » : informations de l'entreprise (logo, raison sociale, régime fiscal), paramètres de la boutique, modules ouverts par la formule,
 *  paiements & encaissements, sécurité & traçabilité, paramétrage intelligent MASTER (liste de vérification réelle, aucune action automatique). */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Camera, CheckCircle2, Circle, CreditCard, Image as ImageIcon, Layers, Lock, ShieldCheck, Store, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { KpiRow, KpiTile, Panel, StatusBadge } from "@/components/kit";
import { api } from "@/lib/api";
import { compressImage, useArticleImage } from "@/lib/articles";
import { useSession } from "@/lib/session";
import { Users, ClipboardCheck, Activity } from "lucide-react";

export type Overview = { plan: { id: string; name: string; state: string }; shops: number; users: number; modules: { list: { key: string; label: string; active: boolean; to: string }[]; active: number; total: number }; master: { state: string; active: boolean }; actions7: number; payments: { wave: boolean; orange: boolean }; finAccounts: number | null;
  checklist: { items: { id: string; label: string; done: boolean; hint: string; tab: string }[]; done: number; total: number }; shop: { name: string; address: string; city: string; phone: string; legal: string; companyName: string; taxRegime: string; promoTz: string; vatRatePct: number | null; logoFileId: string }; canEdit: boolean };
export const useOverview = () => { const { session } = useSession(); const s = session!; return useQuery({ queryKey: ["settings-overview", s.shopId], retry: 1, queryFn: () => api<Overview>(s, "settings.overview", {}) }); };
const TZ = ["Africa/Abidjan", "Africa/Dakar", "Africa/Bamako", "Africa/Ouagadougou", "Africa/Lome", "Africa/Porto-Novo", "Africa/Niamey", "Africa/Bissau", "Africa/Douala", "Africa/Libreville", "Africa/Lagos", "Africa/Accra", "Africa/Casablanca", "Europe/Paris"];
const ok = (t: string) => /^Enregistr|^Logo/.test(t);
const Msg = ({ t }: { t: string }) => (t ? <p className={`text-sm ${ok(t) ? "text-ok" : "text-bad"}`} role={ok(t) ? "status" : "alert"}>{ok(t) ? "✓ " : ""}{t}</p> : null);

export function SettingsKpis() {
  const q = useOverview(); const d = q.data;
  return <KpiRow cols={5}>
    <KpiTile icon={Store} tint="amber" label="Boutiques configurées" loading={q.isLoading} value={d ? d.shops : "—"} />
    <KpiTile icon={Users} tint="blue" label="Utilisateurs actifs" loading={q.isLoading} value={d ? d.users : "—"} sub="vous et l'équipe active" />
    <KpiTile icon={Layers} tint="green" label="Modules ouverts" loading={q.isLoading} value={d ? `${d.modules.active} / ${d.modules.total}` : "—"} sub={d ? `formule ${d.plan.name}` : undefined} />
    <KpiTile icon={ClipboardCheck} tint="violet" label="Paramétrage complet" loading={q.isLoading} value={d ? `${d.checklist.done} / ${d.checklist.total}` : "—"} sub="points renseignés" />
    <KpiTile icon={Activity} tint="cyan" label="Actions journalisées" loading={q.isLoading} value={d ? d.actions7 : "—"} sub="7 derniers jours" />
  </KpiRow>;
}

export function GeneralSection({ onTab }: { onTab: (t: string) => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useOverview(); const d = q.data;
  const [co, setCo] = useState({ name: "", companyName: "", legal: "", taxRegime: "", phone: "", address: "", city: "" }); const [bo, setBo] = useState({ promoTz: "", vatRatePct: "" });
  const [coMsg, setCoMsg] = useState(""); const [boMsg, setBoMsg] = useState(""); const [logoMsg, setLogoMsg] = useState(""); const [busy, setBusy] = useState("");
  useEffect(() => { if (d) { setCo({ name: d.shop.name, companyName: d.shop.companyName, legal: d.shop.legal, taxRegime: d.shop.taxRegime, phone: d.shop.phone, address: d.shop.address, city: d.shop.city }); setBo({ promoTz: d.shop.promoTz, vatRatePct: d.shop.vatRatePct === null ? "" : String(d.shop.vatRatePct) }); } }, [d]);
  const logo = useArticleImage(d?.shop.logoFileId || undefined, 240);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["settings-overview"] }); void qc.invalidateQueries({ queryKey: ["shop"] }); };
  const saveCo = async (e: React.FormEvent) => { e.preventDefault(); setCoMsg(""); setBusy("co"); try { await api(s, "shop.save", co); setCoMsg("Enregistré"); refresh(); } catch (x) { setCoMsg((x as Error).message); } finally { setBusy(""); } };
  const saveBo = async (e: React.FormEvent) => { e.preventDefault(); setBoMsg(""); setBusy("bo"); try { await api(s, "shop.save", { ...(bo.promoTz ? { promoTz: bo.promoTz } : {}), vatRatePct: Number(bo.vatRatePct) }); setBoMsg("Enregistré"); refresh(); } catch (x) { setBoMsg((x as Error).message); } finally { setBusy(""); } };
  const putLogo = async (file: File | null) => { setLogoMsg(""); setBusy("logo"); try { await api(s, "shop.logo", { data: file ? await compressImage(file) : null }); setLogoMsg(file ? "Logo enregistré : il apparaîtra sur les tickets et factures." : "Logo retiré."); refresh(); } catch (x) { setLogoMsg((x as Error).message); } finally { setBusy(""); } };
  if (q.error) return <p className="text-bad text-sm" role="alert">{(q.error as Error).message}</p>; if (!d) return <div className="card h-40 animate-pulse bg-subtle" aria-busy="true" />;
  const edit = d.canEdit; const set = (k: keyof typeof co) => (e: React.ChangeEvent<HTMLInputElement>) => setCo({ ...co, [k]: e.target.value });
  const lbl = (t: string, el: React.ReactNode, req = false) => <label className="text-xs text-muted flex flex-col gap-1">{t}{req && <span className="sr-only"> (obligatoire)</span>}{el}</label>;
  return <div className="flex flex-col gap-4">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel title="Informations de l'entreprise" icon={Building2}><form className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]" onSubmit={saveCo}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-32 h-32 rounded-2xl border border-[var(--line)] bg-subtle flex items-center justify-center overflow-hidden">{logo ? <img src={logo} alt="Logo de l'entreprise" className="w-full h-full object-contain" /> : <ImageIcon size={36} className="text-muted" aria-hidden="true" />}</div>
          {edit && <div className="flex gap-1"><label className="btn-ghost !p-2 cursor-pointer" title="Photo"><Camera size={16} /><span className="sr-only">Prendre une photo du logo</span><input type="file" accept="image/*" capture="environment" className="sr-only" disabled={!!busy} onChange={(e) => void putLogo(e.target.files?.[0] ?? null)} /></label>
            <label className="btn-ghost !p-2 cursor-pointer" title="Galerie"><ImageIcon size={16} /><span className="sr-only">Choisir un logo dans la galerie</span><input type="file" accept="image/*" className="sr-only" aria-label="Logo de l'entreprise" disabled={!!busy} onChange={(e) => void putLogo(e.target.files?.[0] ?? null)} /></label>
            {d.shop.logoFileId && <button type="button" className="btn-ghost !p-2 !text-bad" aria-label="Retirer le logo" disabled={!!busy} onClick={() => void putLogo(null)}><Trash2 size={16} /></button>}</div>}
          <Msg t={logoMsg} />
        </div>
        <div className="flex flex-col gap-2">
          {lbl("Nom commercial *", <input className="input" aria-label="Nom commercial" required maxLength={120} disabled={!edit} value={co.name} onChange={set("name")} />, true)}
          {lbl("Raison sociale", <input className="input" aria-label="Raison sociale" maxLength={160} disabled={!edit} value={co.companyName} onChange={set("companyName")} />)}
          <div className="grid grid-cols-2 gap-2">{lbl("N° RCCM / NINEA", <input className="input" aria-label="NINEA / RCCM (mentions légales)" maxLength={120} disabled={!edit} value={co.legal} onChange={set("legal")} />)}{lbl("Régime fiscal", <input className="input" aria-label="Régime fiscal" maxLength={80} placeholder="À confirmer avec votre comptable" disabled={!edit} value={co.taxRegime} onChange={set("taxRegime")} />)}</div>
          <div className="grid grid-cols-2 gap-2">{lbl("Téléphone", <input className="input" aria-label="Téléphone" inputMode="tel" maxLength={32} disabled={!edit} value={co.phone} onChange={set("phone")} />)}{lbl("Ville", <input className="input" aria-label="Ville" maxLength={80} disabled={!edit} value={co.city} onChange={set("city")} />)}</div>
          {lbl("Adresse", <input className="input" aria-label="Adresse" maxLength={160} disabled={!edit} value={co.address} onChange={set("address")} />)}
          {edit ? <button className="btn self-start" disabled={busy === "co"}>{busy === "co" ? "Enregistrement…" : "Enregistrer"}</button> : <p className="text-xs text-muted">Lecture seule : seul le propriétaire modifie ces informations.</p>}<Msg t={coMsg} />
        </div></form></Panel>
      <Panel title="Paramètres de la boutique" icon={Store}><form className="flex flex-col gap-2" onSubmit={saveBo}>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 items-center text-sm"><span className="text-muted">Devise</span><span>XOF — Franc CFA (UEMOA)</span><span className="text-muted">Langue</span><span>Français</span></div>
        {lbl("Fuseau horaire", <select className="input" aria-label="Fuseau horaire" disabled={!edit} value={bo.promoTz} onChange={(e) => setBo({ ...bo, promoTz: e.target.value })}><option value="">— Choisir —</option>{[...new Set([...(bo.promoTz && !TZ.includes(bo.promoTz) ? [bo.promoTz] : []), ...TZ])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</select>)}
        {lbl("Taux de TVA (%)", <input className="input" aria-label="TVA (%)" inputMode="numeric" disabled={!edit} value={bo.vatRatePct} onChange={(e) => setBo({ ...bo, vatRatePct: e.target.value })} />)}
        <p className="text-xs text-muted">Le fuseau horaire définit les journées des rapports et des promotions. La devise et la langue sont fixes dans cette version.</p>
        {edit && <button className="btn self-start" disabled={busy === "bo"}>{busy === "bo" ? "Enregistrement…" : "Enregistrer"}</button>}<Msg t={boMsg} /></form></Panel>
      <Panel title="Modules de la plateforme" icon={Layers} action={<StatusBadge tone={d.modules.active === d.modules.total ? "ok" : "info"}>{d.modules.active} / {d.modules.total} ouverts</StatusBadge>}>
        <ul className="grid grid-cols-2 gap-1.5">{d.modules.list.map((m) => <li key={m.key}>{m.active ? <Link to={m.to as never} className="flex items-center justify-between gap-1 rounded-xl border border-[var(--line)] px-2.5 py-2 text-xs hover:bg-subtle"><span className="truncate">{m.label}</span><CheckCircle2 size={14} className="text-ok shrink-0" aria-label="Actif" /></Link> : <span className="flex items-center justify-between gap-1 rounded-xl border border-dashed border-[var(--line)] px-2.5 py-2 text-xs text-muted"><span className="truncate">{m.label}</span><Lock size={13} className="shrink-0" aria-label="Formule supérieure" /></span>}</li>)}</ul>
        <p className="text-xs text-muted mt-2">MASTER DOGUI : licence {d.master.active ? "active" : "inactive"} (indépendante de la formule). Les modules dépendent de votre formule ; aucun n'est désactivé manuellement.</p></Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel title="Paiements & encaissements" icon={CreditCard}><ul className="flex flex-col gap-1.5 text-sm">
        <li className="flex justify-between gap-2"><span>Espèces, mobile money, crédit client (en caisse)</span><StatusBadge tone="ok">Disponible</StatusBadge></li>
        <li className="flex justify-between gap-2"><span>Lien de paiement QR Wave</span><StatusBadge tone={d.payments.wave ? "ok" : "muted"}>{d.payments.wave ? "Configuré" : "Non configuré"}</StatusBadge></li>
        <li className="flex justify-between gap-2"><span>Lien de paiement QR Orange</span><StatusBadge tone={d.payments.orange ? "ok" : "muted"}>{d.payments.orange ? "Configuré" : "Non configuré"}</StatusBadge></li>
        <li className="flex justify-between gap-2"><span>Carte bancaire, paiement en ligne</span><StatusBadge tone="muted">Non disponible</StatusBadge></li></ul>
        <button type="button" className="btn-ghost self-start mt-2 text-sm" onClick={() => onTab("payments")}>Configurer les liens QR</button></Panel>
      <Panel title="Sécurité & traçabilité" icon={ShieldCheck}><ul className="flex flex-col gap-1.5 text-sm">
        <li className="flex justify-between gap-2"><span>Rôles et accès par membre</span><Link to={"/reglages" as never} search={{ onglet: "equipe" } as never} className="text-accent-text underline text-xs">Équipe & accès</Link></li>
        <li className="flex justify-between gap-2"><span>Actions sensibles journalisées</span><button type="button" className="text-accent-text underline text-xs" onClick={() => onTab("activity")}>Voir le journal</button></li>
        <li className="flex justify-between gap-2"><span>Données isolées par commerce et par boutique</span><StatusBadge tone="ok">Actif</StatusBadge></li></ul></Panel>
      <section aria-label="MASTER DOGUI — Paramétrage intelligent" className="card flex flex-col gap-2 border border-[color-mix(in_srgb,var(--gold)_45%,var(--line))]">
        <h2 className="font-semibold">MASTER DOGUI — Paramétrage intelligent</h2>
        <p className="text-xs text-muted">{d.checklist.done} point(s) sur {d.checklist.total} renseignés, vérifiés sur vos données. Rien n'est modifié automatiquement.</p>
        <ul className="flex flex-col gap-1">{d.checklist.items.map((i) => <li key={i.id} className="flex items-start gap-2 text-sm">{i.done ? <CheckCircle2 size={16} className="text-ok shrink-0 mt-0.5" aria-label="Fait" /> : <Circle size={16} className="text-warn shrink-0 mt-0.5" aria-label="À faire" />}<span className="min-w-0"><span className={i.done ? "" : "font-medium"}>{i.label}</span>{!i.done && <span className="block text-xs text-muted">{i.hint}{i.tab !== "general" && <> · {i.tab === "fin" ? <Link to={"/finance" as never} className="underline">FinI</Link> : i.tab === "team" ? <Link to={"/reglages" as never} search={{ onglet: "equipe" } as never} className="underline">Équipe</Link> : <button type="button" className="underline" onClick={() => onTab(i.tab)}>Ouvrir</button>}</>}</span>}</span></li>)}</ul>
      </section>
    </div>
  </div>;
}
