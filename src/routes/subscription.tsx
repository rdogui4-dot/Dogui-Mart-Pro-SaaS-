import { CalendarClock, Check, CreditCard, Download, FileText, Layers, Receipt, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { ErrorState, InsightCard, LoadingState, Panel, PillTabs, StatusBadge, type PillTab } from "@/components/kit";
import { subscriptionInsights, perMonth, type Receipt as ReceiptData } from "@/domain/subscription-kit";
import { PLATFORM_MODULES, modulesFor } from "@/domain/settings-kit";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { PERIODS, PERIOD_DAYS, PERIOD_LABEL, TRIAL, priceFor, type Entitlement, type Period, type Plan, type PlanId } from "@/domain/subscriptions";
import { selarOptionLabel } from "@/domain/selar";
import { bannerMessage, stateLabel, whatsappNumber, type ReminderLevel } from "@/domain/reminders";

export type SubInfo = {
  entitlement: Entitlement; plans: Plan[]; usage: { shops: number; users: number; products: number };
  /** Formules dont la plateforme a configuré le lien Selar (un produit Selar par formule ; la période se choisit sur la page Selar). */
  available: Record<string, boolean>;
  payments: { id: string; plan: string; period: Period; count: number; amount: number; provider: string; status: string; reference: string; url?: string; note?: string; endsAt?: string; createdAt: string }[];
};
export const useSubscription = () => {
  const { session } = useSession(); const s = session!;
  return useQuery({ queryKey: ["subscription", s.tenantId], queryFn: () => api<SubInfo>(s, "subscription.get"), staleTime: 60_000, enabled: !!s });
};

const STATE_LABEL = { active: "Actif", expiring: "Bientôt expiré", grace: "Expiré — délai de grâce", locked: "Expiré — accès suspendu" } as const;
const STATE_TONE = { active: "text-ok", expiring: "text-warn", grace: "text-warn", locked: "text-bad" } as const;
const PAY_LABEL: Record<string, string> = { awaiting_payment: "À payer", pending_review: "En attente de validation", approved: "Validé", rejected: "Refusé" };
const PER_LABEL: Record<Period, string> = { day: "jour", week: "semaine", month: "mois", quarter: "trimestre", year: "an" };
const DAYS: Record<Period, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
/** Économie par rapport au tarif « jour » ramené à la même durée. */
const savingPct = (p: Plan, period: Period) => (period === "day" || !p.prices.day ? 0 : Math.max(0, Math.round((1 - priceFor(p, period, 1) / (p.prices.day * DAYS[period])) * 100)));
const lim = (n: number) => (n < 0 ? "illimité" : String(n));
const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

const BANNER_TONE: Record<ReminderLevel, string> = { none: "", info: "bg-info-bg text-info", warning: "bg-warn-bg text-warn", urgent: "bg-warn-bg text-warn", grace: "bg-bad-bg text-bad", locked: "bg-bad-bg text-bad" };
const dismissKey = (tenantId: string, level: string) => `dmp.remind.${tenantId}.${level}.${new Date().toISOString().slice(0, 10)}`;
const wasDismissed = (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };

/** Relance d'expiration affichée dans l'application. Les rappels d'information et d'avertissement se masquent pour la journée ;
 *  les rappels urgents, de grâce et d'accès suspendu restent visibles. Le message dépend de la période (un abonnement « jour » est relancé dans ses dernières heures). */
export function SubscriptionBanner() {
  const { session } = useSession();
  const { data } = useSubscription();
  const [, force] = useState(0);
  if (!data || !session) return null;
  const m = bannerMessage(data.entitlement, session.role === "owner");
  if (!m) return null;
  const key = dismissKey(session.tenantId, m.level);
  const dismissible = m.level === "info" || m.level === "warning";
  if (dismissible && wasDismissed(key)) return null;
  return (
    <div role="status" className={`text-sm py-1.5 px-3 flex items-center justify-center gap-3 ${BANNER_TONE[m.level]}`}>
      <span className="text-center">{m.text}</span>
      {dismissible && <button aria-label="Masquer pour aujourd'hui" className="font-bold px-1" onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* navigation privée */ } force((n) => n + 1); }}>×</button>}
    </div>
  );
}

type SubTab = "mine" | "receipts" | "payments" | "compare";
const MODULE_NOTE = "Toutes les formules ouvrent les mêmes écrans de base ; les modules avancés dépendent de la formule.";

/** Abonnement & Facturation (kit écran 23) : formule et échéance réelles, formules au tarif de la plateforme, reçus des paiements validés,
 *  historique des demandes, comparaison. Renouvellement manuel via Selar : aucun prélèvement automatique, aucun moyen de paiement enregistré. */
export function SubscriptionSection({ initial }: { initial?: { plan: PlanId; period?: Period } }) {
  const { session } = useSession(); const s = session!; const owner = s.role === "owner";
  const picked = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useSubscription();
  const [period, setPeriod] = useState<Period>(initial?.period ?? "month");
  const [cameFrom] = useState(initial); // offre indiquée par l'URL de redirection de Selar
  const [tab, setTab] = useState<SubTab>("mine");
  useEffect(() => { picked.current?.scrollIntoView({ block: "center" }); }, [!!cameFrom, !!data]);
  const [pay, setPay] = useState<Plan | null>(null);
  if (isLoading) return <LoadingState label="Chargement de l'abonnement" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />;
  const e = data.entitlement;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["subscription", s.tenantId] });
  const receipts = data.payments.filter((p) => p.status === "approved" && p.provider === "selar" && p.amount > 0);
  const tabs: PillTab<SubTab>[] = [{ key: "mine", label: "Mon abonnement", icon: CreditCard }, ...(owner ? [{ key: "receipts" as const, label: "Reçus de paiement", icon: FileText, count: receipts.length }, { key: "payments" as const, label: "Paiements", icon: Receipt, count: data.payments.length }] : []), { key: "compare", label: "Comparer les offres", icon: Layers }];
  return (
    <>
      <PillTabs idBase="abo" label="Sections Abonnement & Facturation" value={tab} onChange={setTab} items={tabs} />
      {tab === "mine" && <Mine data={data} period={period} setPeriod={setPeriod} cameFrom={cameFrom} picked={picked} receipts={receipts} owner={owner} onPay={setPay} onTab={setTab} />}
      {tab === "receipts" && owner && <Panel title="Reçus de paiement" icon={FileText}><ReceiptList rows={receipts} empty="Aucun paiement validé pour le moment. Un reçu est disponible dès que la plateforme a validé votre paiement Selar." /></Panel>}
      {tab === "payments" && owner && <Panel title="Mes paiements" icon={Receipt}>
        {data.payments.length === 0 ? <p className="text-sm text-muted">Aucune demande de paiement.</p> : <ul className="flex flex-col divide-y divide-[var(--line)]">{data.payments.map((p) => (
          <li key={p.id} className="flex justify-between items-start gap-3 py-2 text-sm">
            <span className="min-w-0">{planName(data.plans, p.plan)} · {PERIOD_LABEL[p.period]}{p.count > 1 ? ` ×${p.count}` : ""} · {p.provider === "manual" ? "attribution par la plateforme" : formatFcfa(p.amount)}<br /><span className="text-xs text-muted">{p.reference} · {new Date(p.createdAt).toLocaleDateString("fr-FR")}{p.note ? ` · ${p.note}` : ""}</span></span>
            <StatusBadge tone={p.status === "approved" ? "ok" : p.status === "rejected" ? "bad" : "warn"}>{PAY_LABEL[p.status] ?? p.status}</StatusBadge>
          </li>))}</ul>}
        <p className="text-xs text-muted mt-2">Une demande « À payer » est réglée sur Selar ; ensuite, saisissez la référence de commande depuis « Mon abonnement » (même formule et même durée) pour la faire valider.</p>
      </Panel>}
      {tab === "compare" && <Compare data={data} period={period} setPeriod={setPeriod} />}
      {pay && <PayModal plan={pay} period={period} onClose={() => { setPay(null); refresh(); }} />}
    </>
  );
}

const planName = (plans: Plan[], id: string) => plans.find((p) => p.id === id)?.name ?? id;
const DurationTabs = ({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) => (
  <div role="tablist" aria-label="Durée" className="grid grid-cols-5 gap-1">
    {PERIODS.map((p) => <button key={p} type="button" role="tab" aria-selected={period === p} aria-current={period === p} className="chip !px-1 !py-2 text-xs text-center" onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>)}
  </div>
);

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  return <div><div className="flex justify-between text-sm"><span>{label}</span><span className={max >= 0 && used >= max ? "text-bad" : "opacity-80"}>{used} / {lim(max)}</span></div>
    {max >= 0 && <div className="h-1.5 rounded bg-white/15"><div className={`h-1.5 rounded ${used >= max ? "bg-bad" : "bg-[var(--gold)]"}`} style={{ width: `${Math.min(100, max ? (used / max) * 100 : 100)}%` }} /></div>}</div>;
}

function Mine({ data, period, setPeriod, cameFrom, picked, receipts, owner, onPay, onTab }: { data: SubInfo; period: Period; setPeriod: (p: Period) => void; cameFrom?: { plan: PlanId; period?: Period }; picked: React.RefObject<HTMLDivElement | null>; receipts: SubInfo["payments"]; owner: boolean; onPay: (p: Plan) => void; onTab: (t: SubTab) => void }) {
  const e = data.entitlement; const total = e.trial ? TRIAL.days : PERIOD_DAYS[e.period];
  const elapsedPct = e.lifetime ? 100 : Math.max(0, Math.min(100, Math.round((e.daysLeft / total) * 100)));
  const insights = subscriptionInsights(e, data.usage, data.plans);
  const online = Object.keys(data.available).length > 0;
  const mods = modulesFor(e.lifetime ? "pro" : e.plan.id);
  const renewAmount = priceFor(e.plan, period, 1);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4 min-w-0">
        <section aria-label="Abonnement actuel" data-theme="dark" className="rounded-2xl p-5 flex flex-col gap-3 bg-[var(--nav-bg)] text-[var(--nav-text)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs uppercase tracking-wider opacity-70">Abonnement actuel</p><h2 className="text-2xl font-bold">{e.lifetime ? "Accès à vie" : `Formule ${e.plan.name}`}{e.trial && " (essai)"}</h2></div>
            <StatusBadge tone={e.state === "active" ? "ok" : e.state === "locked" ? "bad" : "warn"}>{e.lifetime ? "Actif" : STATE_LABEL[e.state]}</StatusBadge>
          </div>
          {e.lifetime ? <p className="text-sm opacity-85">Toutes les fonctions actuelles et futures, sans limite ni renouvellement.</p> : <>
            <p className="text-sm opacity-85">{e.state === "locked" || e.state === "grace" ? "Échue le" : "Valable jusqu'au"} {dateFr(e.endsAt)}{e.state === "active" || e.state === "expiring" ? ` · ${e.daysLeft} jour(s) restant(s)` : ""}</p>
            <div role="meter" aria-label="Jours restants" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(e.daysLeft, total)} className="h-2 rounded bg-white/15"><div className="h-2 rounded bg-[var(--gold)]" style={{ width: `${elapsedPct}%` }} /></div>
          </>}
          <div className="grid gap-2 sm:grid-cols-3"><UsageBar label="Boutiques" used={data.usage.shops} max={e.limits.maxShops} /><UsageBar label="Utilisateurs" used={data.usage.users} max={e.limits.maxUsers} /><UsageBar label="Produits" used={data.usage.products} max={e.limits.maxProducts} /></div>
          {!e.lifetime && owner && <div><button type="button" className="btn" disabled={!data.available[e.plan.id]} onClick={() => onPay(e.plan)}>{data.available[e.plan.id] ? `Renouveler maintenant · ${PERIOD_LABEL[period]}` : "Paiement bientôt disponible"}</button></div>}
        </section>

        {!e.lifetime && <section aria-label="Formules" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Nos formules</h2><p className="text-xs text-muted">Sans engagement : vous payez la durée choisie.</p></div>
          {cameFrom && <p className="text-sm rounded-lg bg-[var(--surface-2)] border border-accent/40 p-3">Vous revenez de Selar ? Votre formule est en surbrillance. Sélectionnez la période que vous avez payée, touchez « Payer sur Selar » sur cette formule : dans la fenêtre qui s'ouvre, saisissez la référence de commande reçue par e-mail et l'adresse utilisée pour l'achat (inutile de repayer).</p>}
          <DurationTabs period={period} setPeriod={setPeriod} />
          <div className="grid gap-3 md:grid-cols-3">{data.plans.map((p) => {
            const price = priceFor(p, period, 1); const save = savingPct(p, period); const current = p.id === e.plan.id; const target = cameFrom?.plan === p.id;
            return (
              <div key={p.id} ref={target ? picked : undefined} className={`relative rounded-xl border p-4 flex flex-col gap-2 bg-[var(--surface)] ${target ? "ring-2 ring-[var(--accent)]/60 border-accent" : current ? "border-accent" : "border-[var(--line)]"}`}>
                {current && <span className="absolute -top-3 left-4 rounded-full bg-accent text-accent-ink text-xs font-bold px-3 py-0.5">Formule actuelle</span>}
                <div className="flex items-baseline justify-between gap-2"><h3 className="text-lg font-bold">{p.name}</h3>{save > 0 && <span className="text-xs rounded-full bg-ok-bg text-ok px-2 py-0.5">−{save} % vs jour</span>}</div>
                <div><span className="text-accent-text text-2xl font-extrabold">{formatFcfa(price)}</span><span className="text-sm text-muted"> / {PER_LABEL[period]}</span></div>
                <ul className="text-sm flex flex-col gap-1">{[`${lim(p.limits.maxShops)} boutique(s)`, `${lim(p.limits.maxUsers)} utilisateur(s)`, `${lim(p.limits.maxProducts)} produits`, `${modulesFor(p.id).active} modules sur ${mods.total}`].map((f) => <li key={f} className="flex gap-2"><Check size={16} className="text-accent-text shrink-0 mt-0.5" />{f}</li>)}</ul>
                {!current && !e.trial && e.state !== "locked" && <p className="text-xs text-warn">Changer de formule démarre la nouvelle période maintenant : le temps restant de l'actuelle n'est pas reporté.</p>}
                {owner && <button type="button" className={current ? "btn" : "btn-ghost"} disabled={!data.available[p.id]} onClick={() => onPay(p)}>{data.available[p.id] ? `Payer sur Selar · ${PERIOD_LABEL[period]}` : "Paiement bientôt disponible"}</button>}
              </div>);
          })}</div>
          {!online && <p className="text-xs text-warn">Le paiement en ligne n'est pas encore activé par la plateforme.</p>}
          {!owner && <p className="text-xs text-muted">Seul le propriétaire du commerce peut payer l'abonnement.</p>}
        </section>}

        <InsightCard module="Abonnement" items={insights.map((i) => ({ id: i.id, text: i.text, tone: i.tone }))} source="votre formule, son échéance, l'utilisation de vos limites et les tarifs de la plateforme" />
      </div>

      <aside className="flex flex-col gap-4 min-w-0">
        {!e.lifetime && <Panel title="Prochaine échéance" icon={CalendarClock}>
          <p className="text-xl font-bold">{dateFr(e.endsAt)}</p>
          <p className="text-sm text-soft">Renouvellement {e.plan.name} · {PERIOD_LABEL[period]} : <b>{formatFcfa(renewAmount)}</b></p>
          <p className="text-xs text-muted mt-1">Renouvellement manuel via Selar, aucun prélèvement automatique. Avec la même formule, la durée payée s'ajoute à l'échéance.</p>
        </Panel>}
        {owner && !e.lifetime && <Panel title="Reçus récents" icon={FileText} action={receipts.length > 3 ? <button type="button" className="text-sm font-semibold text-accent-text" onClick={() => onTab("receipts")}>Tout voir</button> : undefined}>
          <ReceiptList rows={receipts.slice(0, 3)} empty="Aucun paiement validé pour le moment." compact />
        </Panel>}
        {!e.lifetime && <Panel title="Moyens de paiement" icon={Wallet}>
          <ul className="flex flex-col gap-2 text-sm">{["Wave", "Orange Money", "Carte bancaire"].map((m) => <li key={m} className="flex items-center justify-between gap-2"><span>{m}</span><StatusBadge tone={online ? "info" : "muted"}>{online ? "Disponible via Selar" : "Pas encore activé"}</StatusBadge></li>)}</ul>
          <p className="text-xs text-muted mt-2 flex items-center gap-1"><ShieldCheck size={14} />Paiement sécurisé par Selar ; aucun moyen de paiement n'est enregistré dans l'application.</p>
        </Panel>}
        <Panel title="Avantages de votre formule" icon={Sparkles}>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex justify-between"><span>Boutiques</span><b>{lim(e.limits.maxShops)}</b></li>
            <li className="flex justify-between"><span>Utilisateurs</span><b>{lim(e.limits.maxUsers)}</b></li>
            <li className="flex justify-between"><span>Produits</span><b>{lim(e.limits.maxProducts)}</b></li>
            <li className="flex justify-between"><span>Modules ouverts</span><b>{mods.active} / {mods.total}</b></li>
          </ul>
          <ul className="flex flex-wrap gap-1.5 mt-2">{mods.list.map((m) => <li key={m.key}><StatusBadge tone={m.active ? "ok" : "muted"} icon={null}>{m.label}</StatusBadge></li>)}</ul>
          <p className="text-xs text-muted mt-2">{MODULE_NOTE} Vos données sont conservées si vous changez de formule ou si l'abonnement expire.</p>
        </Panel>
      </aside>
    </div>
  );
}

function ReceiptList({ rows, empty, compact }: { rows: SubInfo["payments"]; empty: string; compact?: boolean }) {
  const { session } = useSession(); const s = session!;
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  async function download(id: string) {
    setBusy(id); setErr("");
    try { const r = await api<ReceiptData>(s, "subscription.receipt", { paymentId: id }); const { receiptPdf } = await import("@/lib/receipt-pdf"); const { deliverPdf } = await import("@/lib/pdf"); await deliverPdf(await receiptPdf(r), `recu-${r.reference}.pdf`); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(""); }
  }
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return <>
    <ul className="flex flex-col divide-y divide-[var(--line)]">{rows.map((p) => (
      <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
        <span className="min-w-0"><b>{formatFcfa(p.amount)}</b> · {PERIOD_LABEL[p.period]}<br /><span className="text-xs text-muted">{p.reference} · {new Date(p.createdAt).toLocaleDateString("fr-FR")}</span></span>
        <button type="button" className={compact ? "icon-btn" : "btn-ghost !min-h-9 text-sm"} aria-label={`Télécharger le reçu ${p.reference}`} disabled={busy === p.id} onClick={() => void download(p.id)}><Download size={16} />{!compact && " Reçu PDF"}</button>
      </li>))}</ul>
    {err && <p role="alert" className="text-sm text-bad">{err}</p>}
  </>;
}

function Compare({ data, period, setPeriod }: { data: SubInfo; period: Period; setPeriod: (p: Period) => void }) {
  const e = data.entitlement;
  const rows: [string, (p: Plan) => string][] = [
    [`Prix (${PER_LABEL[period]})`, (p) => formatFcfa(priceFor(p, period, 1))],
    ["Prix ramené au mois", (p) => { const v = perMonth(p, period); return v === null ? "—" : formatFcfa(Math.round(v)); }],
    ["Boutiques", (p) => lim(p.limits.maxShops)], ["Utilisateurs", (p) => lim(p.limits.maxUsers)], ["Produits", (p) => lim(p.limits.maxProducts)],
    ...PLATFORM_MODULES.map((m) => [m.label, (p: Plan) => (modulesFor(p.id).list.find((x) => x.key === m.key)!.active ? "Inclus" : "—")] as [string, (p: Plan) => string]),
  ];
  return (
    <Panel title="Comparer les offres" icon={Layers}>
      <DurationTabs period={period} setPeriod={setPeriod} />
      <div className="overflow-x-auto mt-3"><table className="w-full text-sm min-w-[32rem]">
        <thead><tr className="text-left border-b border-line"><th scope="col" className="py-2 pr-2 font-semibold">Caractéristique</th>{data.plans.map((p) => <th key={p.id} scope="col" className="py-2 px-2 font-semibold">{p.name}{!e.lifetime && p.id === e.plan.id && <span className="block text-xs font-normal text-accent-text">Formule actuelle</span>}</th>)}</tr></thead>
        <tbody>{rows.map(([label, f]) => <tr key={label} className="border-b border-line/60"><th scope="row" className="py-1.5 pr-2 font-normal text-soft">{label}</th>{data.plans.map((p) => <td key={p.id} className="py-1.5 px-2">{f(p)}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="text-xs text-muted mt-2">Tarifs fixés par la plateforme. {MODULE_NOTE}</p>
    </Panel>
  );
}

function PayModal({ plan, period, onClose }: { plan: Plan; period: Period; onClose: () => void }) {
  const { session } = useSession(); const s = session!;
  const requestId = useRef(crypto.randomUUID()); // un nouvel essai réutilise la même demande : jamais deux liens
  const canvas = useRef<HTMLCanvasElement>(null);
  const [link, setLink] = useState<{ id: string; url: string; reference: string; amount: number } | null>(null);
  const [tx, setTx] = useState(""); const [email, setEmail] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ id: string; url: string; reference: string; amount: number }>(s, "subscription.checkout", { requestId: requestId.current, plan: plan.id, period }).then(setLink).catch((e: Error) => setErr(e.message)); }, [s, plan.id, period]);
  useEffect(() => { if (link && canvas.current) void QRCode.toCanvas(canvas.current, link.url, { width: 220, margin: 2 }); }, [link]);
  async function submit() { setBusy(true); setErr(""); try { await api(s, "subscription.submitProof", { paymentId: link!.id, txRef: tx, payerEmail: email }); setDone(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  return (
    <div data-theme="dark" className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center gap-3 p-6 overflow-y-auto">
      <p className="text-xs uppercase tracking-widest text-muted">{done ? "Étape 2 sur 2 · terminé" : link ? "Étape 1 sur 2 · paiement" : "Préparation"}</p>
      <h2 className="text-xl font-bold">Formule {plan.name} · {PERIOD_LABEL[period]}</h2>
      {link && <p className="text-accent-text text-3xl font-extrabold">{formatFcfa(link.amount)}</p>}
      {done ? <>
        <p className="text-ok text-center">Merci ! Votre paiement est en attente de validation. Votre formule sera activée dès que la plateforme l'aura vérifié dans Selar.</p>
        <button className="btn w-full max-w-xs" onClick={onClose}>Fermer</button>
      </> : <>
        {link ? <canvas ref={canvas} className="rounded-xl bg-white" /> : !err && <p className="text-muted">Préparation du paiement…</p>}
        {link && <>
          <a className="btn w-full max-w-xs text-center" href={link.url} target="_blank" rel="noreferrer noopener">Payer sur Selar</a>
          <ol className="text-sm text-soft max-w-xs list-decimal pl-5 flex flex-col gap-1">
            <li>Sur la page Selar (scannez le QR code ou touchez le bouton), dans « Choisir un abonnement », sélectionnez <b>« {selarOptionLabel(period)} »</b> ({formatFcfa(link.amount)}), puis payez. Le libellé peut s'afficher en anglais (day, week, month, quarter, year).</li>
            <li>Selar vous envoie par e-mail un reçu avec une <b>référence de commande</b>.</li>
            <li>Saisissez-la ci-dessous avec l'e-mail utilisé sur Selar. Notre équipe vérifie que la commande correspond bien à la période <b>{PERIOD_LABEL[period]}</b> puis active votre formule.</li>
          </ol>
          <p className="text-xs text-muted">Réf. interne {link.reference}</p>
          <input aria-label="E-mail utilisé sur Selar" className="input max-w-xs" type="email" inputMode="email" autoCapitalize="none" placeholder="E-mail utilisé sur Selar" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input aria-label="Référence de commande Selar" className="input max-w-xs" placeholder="Référence de commande Selar" value={tx} onChange={(e) => setTx(e.target.value)} />
          <button className="btn w-full max-w-xs" disabled={busy || tx.trim().length < 6 || !email.includes("@")} onClick={() => void submit()}>J'ai payé</button>
        </>}
        {err && <p className="text-bad text-center">{err}</p>}
        <button className="btn-ghost w-full max-w-xs" onClick={onClose}>Fermer</button>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ Administration de la plateforme
type PlatPayment = { id: string; tenantId: string; tenantName: string; plan: string; period: Period; count: number; amount: number; provider: string; reference: string; txRef: string; payerEmail?: string; url?: string; status: string; note?: string; createdAt: string };

export function PlatformSection() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const [view, setView] = useState<"payments" | "renewals">("payments");
  const [status, setStatus] = useState<"pending_review" | "approved" | "rejected">("pending_review");
  const list = useQuery({ queryKey: ["platform-payments", status], queryFn: () => api<{ payments: PlatPayment[] }>(s, "platform.payments.list", { status }) });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  async function review(p: PlatPayment, approve: boolean) {
    const note = approve ? "" : (prompt("Motif du refus (visible par le commerçant)") ?? ""); if (!approve && !note) return;
    if (approve && !confirm(`Valider ${formatFcfa(p.amount)} de ${p.tenantName} (réf. ${p.txRef}) ? Vérifiez d'abord dans votre tableau de bord Selar : commande trouvée, montant exact, e-mail ${p.payerEmail}.`)) return;
    setBusy(p.id); setErr("");
    try { await api(s, "platform.payment.review", { paymentId: p.id, approve, note }); await qc.invalidateQueries({ queryKey: ["platform-payments"] }); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-1 text-sm">
        <button className={view === "payments" ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setView("payments")}>Paiements</button>
        <button className={view === "renewals" ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setView("renewals")}>Relances</button>
      </div>
      {view === "renewals" ? <Renewals /> : <>
      <div className="grid grid-cols-3 gap-1 text-xs">
        {([["pending_review", "À valider"], ["approved", "Validés"], ["rejected", "Refusés"]] as const).map(([k, l]) => <button key={k} className={status === k ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      {err && <p className="text-bad text-sm">{err}</p>}
      {(list.data?.payments ?? []).map((p) => (
        <div key={p.id} className="card flex flex-col gap-1 text-sm">
          <div className="flex justify-between"><b>{p.tenantName}</b><span className="text-accent-text">{formatFcfa(p.amount)}</span></div>
          <div className="text-muted">{p.plan} · {PERIOD_LABEL[p.period]} ×{p.count} · {p.provider} · {p.reference}</div>
          <div className="text-muted">Référence Selar : <b className="text-main">{p.txRef || "—"}</b> · e-mail : <b className="text-main">{p.payerEmail || "—"}</b></div>
          <div className="text-muted">{new Date(p.createdAt).toLocaleString("fr-FR")}{p.note ? ` · ${p.note}` : ""}{p.url && <> · <a className="underline" href={p.url} target="_blank" rel="noreferrer noopener">offre Selar</a></>}</div>
          {status === "pending_review" && <div className="grid grid-cols-2 gap-2 mt-1"><button className="btn !py-2" disabled={busy === p.id} onClick={() => void review(p, true)}>Valider</button><button className="btn-ghost !py-2" disabled={busy === p.id} onClick={() => void review(p, false)}>Refuser</button></div>}
        </div>
      ))}
      {list.data?.payments.length === 0 && <p className="text-center text-muted py-4">Rien dans cette liste.</p>}
      <PlatformSettingsForm />
      <GrantForm />
      <MasterGrantForm />
      <MasterHookForm />
      <MasterAiPanel />
      <LifetimeForm />
      </>}
    </>
  );
}

type Renewal = { tenantId: string; shopName: string; phone: string; owner: { name: string; email: string } | null; plan: string; planName: string; period: Period; trial: boolean; state: Entitlement["state"]; level: ReminderLevel; endsAt: string; daysLeft: number; remindedAt: string | null; pendingPayment: boolean; message: string };
const LEVEL_TONE: Record<ReminderLevel, string> = { none: "text-muted", info: "text-info", warning: "text-warn", urgent: "text-warn", grace: "text-warn", locked: "text-bad" };

/** Liste des abonnements à relancer, avec message prêt à envoyer. Aucun envoi automatique : l'administrateur envoie lui-même (WhatsApp, e-mail). */
function Renewals() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const [within, setWithin] = useState(7);
  const [dial, setDial] = useState(() => { try { return localStorage.getItem("dmp.dial") ?? ""; } catch { return ""; } });
  const list = useQuery({ queryKey: ["renewals", within], queryFn: () => api<{ renewals: Renewal[]; truncated: boolean }>(s, "platform.renewals.list", { withinDays: within }) });
  const [msg, setMsg] = useState("");
  const setDialCode = (v: string) => { setDial(v); try { localStorage.setItem("dmp.dial", v); } catch { /* navigation privée */ } };
  async function mark(r: Renewal) { try { await api(s, "platform.renewals.markReminded", { tenantId: r.tenantId }); await qc.invalidateQueries({ queryKey: ["renewals"] }); } catch (e) { setMsg((e as Error).message); } }
  async function copy(r: Renewal) { try { await navigator.clipboard.writeText(r.message); setMsg("Message copié"); } catch { setMsg("Copie impossible : sélectionnez le texte du message"); } }
  return (
    <>
      <div className="card flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-1 text-xs">{[7, 14, 30, 90].map((d) => <button key={d} className={within === d ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setWithin(d)}>{d} j</button>)}</div>
        <label className="text-xs text-muted flex items-center gap-2">Indicatif par défaut (ex. 221)<input className="input !w-24 !py-1" inputMode="numeric" value={dial} onChange={(e) => setDialCode(e.target.value)} /></label>
        <p className="text-xs text-muted">Abonnements qui se terminent d'ici {within} jours ou déjà échus. Les messages sont préparés mais envoyés par vous : aucun envoi automatique (pas d'API).</p>
      </div>
      {msg && <p className="text-sm text-warn">{msg}</p>}
      {(list.data?.renewals ?? []).map((r) => {
        const wa = whatsappNumber(r.phone, dial);
        return (
          <div key={r.tenantId} className="card flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-2"><b>{r.shopName}</b><span className={LEVEL_TONE[r.level]}>{r.trial ? "Essai" : r.planName} · {stateLabel[r.state]}</span></div>
            <div className="text-muted">{r.trial ? "Essai" : `${r.planName} ${PERIOD_LABEL[r.period].toLowerCase()}`} · {r.daysLeft >= 0 ? `fin dans ${r.daysLeft} j` : `échu depuis ${Math.abs(r.daysLeft)} j`} ({new Date(r.endsAt).toLocaleDateString("fr-FR")})</div>
            <div className="text-muted">{r.owner ? `${r.owner.name} · ${r.owner.email}` : "Propriétaire inconnu"} · {r.phone || "pas de téléphone"}</div>
            {r.pendingPayment && <div className="text-ok">Un paiement est en attente de validation : validez-le avant de relancer.</div>}
            {r.remindedAt && <div className="text-muted">Relancé le {new Date(r.remindedAt).toLocaleDateString("fr-FR")}</div>}
            <details><summary className="text-muted cursor-pointer">Message</summary><pre className="whitespace-pre-wrap text-xs text-soft mt-1">{r.message}</pre></details>
            <div className="flex flex-wrap gap-2 mt-1">
              {wa ? <a className="btn-ghost !py-2 !px-3" target="_blank" rel="noreferrer noopener" href={`https://wa.me/${wa}?text=${encodeURIComponent(r.message)}`}>WhatsApp</a> : <span className="text-xs text-muted self-center">WhatsApp : numéro sans indicatif</span>}
              {r.owner?.email && !r.owner.email.endsWith("@staff.invalid") && <a className="btn-ghost !py-2 !px-3" href={`mailto:${r.owner.email}?subject=${encodeURIComponent("Votre abonnement Dogui Mart Pro")}&body=${encodeURIComponent(r.message)}`}>E-mail</a>}
              <button className="btn-ghost !py-2 !px-3" onClick={() => void copy(r)}>Copier</button>
              <button className="btn-ghost !py-2 !px-3" onClick={() => void mark(r)}>Marquer relancé</button>
            </div>
          </div>
        );
      })}
      {list.data?.renewals.length === 0 && <p className="text-center text-muted py-4">Aucun abonnement à relancer.</p>}
      {list.data?.truncated && <p className="text-xs text-warn">Liste limitée aux 100 échéances les plus proches.</p>}
    </>
  );
}

function PlatformSettingsForm() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["platform-settings"], queryFn: () => api<{ selarLinks: Record<string, string>; plans: Plan[] }>(s, "platform.settings.get") });
  const [links, setLinks] = useState<Record<string, string> | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null); const [msg, setMsg] = useState("");
  useEffect(() => { if (cfg.data && !plans) { setPlans(structuredClone(cfg.data.plans)); setLinks({ ...cfg.data.selarLinks }); } }, [cfg.data, plans]);
  const save = useMutation({
    mutationFn: () => {
      // On n'envoie que les liens modifiés ; un lien effacé est envoyé vide (suppression).
      const before = cfg.data?.selarLinks ?? {}; const diff: Record<string, string> = {};
      for (const k of new Set([...Object.keys(before), ...Object.keys(links ?? {})])) if ((links?.[k] ?? "") !== (before[k] ?? "")) diff[k] = links?.[k] ?? "";
      return api<{ warnings: string[] }>(s, "platform.settings.save", { selarLinks: diff, plans });
    },
    onSuccess: (r) => { setMsg(r.warnings.length ? `Enregistré. Attention : ${r.warnings.join(" ; ")}` : "Enregistré"); void qc.invalidateQueries({ queryKey: ["platform-settings"] }); void qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => setMsg((e as Error).message),
  });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const done = Object.values(links ?? {}).filter(Boolean).length;
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setMsg(""); save.mutate(); }}>
      <h2 className="font-semibold">Liens Selar et tarifs</h2>
      <p className="text-xs text-muted">Un produit Selar par formule : le client y choisit la période. Collez le lien de chaque produit ({done}/{plans?.length ?? 3} configurés). Les prix ci-dessous doivent être exactement ceux des options de période créées dans Selar. Pas d'API : vous vérifiez chaque paiement dans Selar avant de le valider ici.</p>
      {plans?.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-line p-2 flex flex-col gap-2">
          <b className="text-sm">{p.name}</b>
          <input aria-label={`Lien Selar ${p.name}`} className="input !px-2 !py-1 !text-xs" placeholder="https://selar.com/…" autoCapitalize="none" value={links?.[p.id] ?? ""} onChange={(e) => setLinks({ ...links, [p.id]: e.target.value })} />
          {PERIODS.map((k) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-1 items-center">
              <span className="text-xs text-muted">{selarOptionLabel(k)}</span>
              <input aria-label={`Prix ${p.name} ${PERIOD_LABEL[k]}`} className="input !px-2 !py-1 !text-xs" inputMode="numeric" value={p.prices[k]} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, prices: { ...x.prices, [k]: num(e.target.value) } } : x)))} />
            </div>
          ))}
          <div className="grid grid-cols-3 gap-1">{([["maxShops", "Boutiques"], ["maxUsers", "Utilisateurs"], ["maxProducts", "Produits (-1 = ∞)"]] as const).map(([k, l]) => (
            <label key={k} className="text-xs text-muted">{l}<input className="input !px-1 !py-1 !text-xs" inputMode="numeric" value={p.limits[k]} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, limits: { ...x.limits, [k]: Number(e.target.value) } } : x)))} /></label>
          ))}</div>
        </div>
      ))}
      <button className="btn" disabled={save.isPending}>Enregistrer</button>
      {msg && <p className="text-sm text-warn">{msg}</p>}
    </form>
  );
}

function GrantForm() {
  const { session } = useSession(); const s = session!;
  const grantId = useRef(crypto.randomUUID());
  const [f, setF] = useState({ tenantId: "", plan: "business", period: "month" as Period, count: "1", note: "" }); const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { const r = await api<{ endsAt: string }>(s, "platform.subscription.grant", { grantId: grantId.current, ...f, count: Number(f.count) }); grantId.current = crypto.randomUUID(); setMsg(`Attribué jusqu'au ${dateFr(r.endsAt)}`); }
    catch (x) { setMsg((x as Error).message); }
  }
  return (
    <form className="card flex flex-col gap-2" onSubmit={submit}>
      <h2 className="font-semibold">Attribuer un abonnement (espèces, geste commercial)</h2>
      <input aria-label="Identifiant du commerce (tenantId)" className="input" placeholder="Identifiant du commerce (tenantId)" required value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <select className="input !px-2" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="starter">Starter</option><option value="business">Business</option><option value="pro">Pro</option></select>
        <select className="input !px-2" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Period })}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select>
        <input className="input !px-2" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />
      </div>
      <input aria-label="Motif (ex. paiement espèces reçu le…)" className="input" placeholder="Motif (ex. paiement espèces reçu le…)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button className="btn">Attribuer</button>
      {msg && <p className="text-sm text-warn">{msg}</p>}
    </form>
  );
}

function LifetimeForm() {
  const { session } = useSession(); const s = session!;
  const [tenantId, setTenantId] = useState(""); const [revoke, setRevoke] = useState(false); const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    if (revoke && !confirm("Retirer l'accès à vie ? Le commerce sera suspendu immédiatement tant qu'il n'a pas d'abonnement payant.")) return;
    try { const r = await api<{ lifetime: boolean }>(s, "platform.subscription.lifetime", { tenantId, revoke }); setMsg(r.lifetime ? "Accès à vie accordé." : "Accès à vie retiré."); }
    catch (x) { setMsg((x as Error).message); }
  }
  return (
    <form className="card flex flex-col gap-2" onSubmit={submit}>
      <h2 className="font-semibold">Accès à vie</h2>
      <p className="text-xs text-muted">Votre propre commerce (créé avec votre compte administrateur) a déjà l'accès à vie. Ce formulaire sert à l'accorder ou le retirer à un autre commerce.</p>
      <input aria-label="Identifiant du commerce (tenantId)" className="input" placeholder="Identifiant du commerce (tenantId)" required value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} /> Retirer l'accès à vie</label>
      <button className="btn">{revoke ? "Retirer" : "Accorder"}</button>
      {msg && <p className="text-sm text-warn">{msg}</p>}
    </form>
  );
}

function MasterGrantForm() {
  const { session } = useSession(); const s = session!; const grantId = useRef(crypto.randomUUID());
  const [f, setF] = useState({ tenantId: "", kind: "first", count: "1", note: "" }); const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { const r = await api<{ endsAt: string; amount: number; duplicate: boolean }>(s, "platform.master.activate", { grantId: grantId.current, tenantId: f.tenantId.trim(), kind: f.kind, count: Number(f.count), note: f.note }); grantId.current = crypto.randomUUID(); setMsg(`MASTER DOGUI activé jusqu'au ${new Date(r.endsAt).toLocaleDateString("fr-FR")} (${formatFcfa(r.amount)})${r.duplicate ? " — déjà enregistré" : ""}`); }
    catch (x) { setMsg((x as Error).message); }
  }
  return (
    <form className="card flex flex-col gap-2" onSubmit={submit}>
      <h2 className="font-semibold">Activer MASTER DOGUI (après vérification du paiement)</h2>
      <input aria-label="Identifiant du commerce (tenantId) MASTER" className="input" placeholder="Identifiant du commerce (tenantId)" required value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })} />
      <div className="grid grid-cols-2 gap-2"><select aria-label="Type d'activation MASTER" className="input !px-2" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="first">Première période (12 mois, 15 000 FCFA)</option><option value="month">Renouvellement (2 500 FCFA / mois)</option></select><input aria-label="Nombre de mois MASTER" className="input !px-2" inputMode="numeric" disabled={f.kind === "first"} value={f.kind === "first" ? "1" : f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></div>
      <input aria-label="Référence du paiement MASTER" className="input" placeholder="Référence du paiement (ex. Selar, virement…)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button className="btn">Activer</button>{msg && <p className="text-sm text-warn">{msg}</p>}
    </form>
  );
}

type HookV = { enabled: boolean; tokenSet: boolean; mapping: { ref: string; amount: string; email: string; status: string; currency: string; successValues: string[]; expectedCurrency: string }; mappingComplete: boolean; links: { first: string; month: string }; baseUrl: string; note: string };
type EvV = { id: string; status: string; ref: string; amount: number | null; email: string; currency: string; note: string; raw: string; at: string };
function MasterHookForm() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [msg, setMsg] = useState(""); const [tok, setTok] = useState("");
  const q = useQuery({ queryKey: ["md-hook"], queryFn: () => api<HookV>(s, "platform.master.hook.get", {}) }); const ev = useQuery({ queryKey: ["md-events"], queryFn: () => api<{ events: EvV[] }>(s, "platform.master.events", { status: "review" }) });
  const [f, setF] = useState<{ ref: string; amount: string; email: string; status: string; currency: string; ok: string; cur: string; first: string; month: string; base: string } | null>(null);
  if (q.data && !f) setF({ ref: q.data.mapping.ref, amount: q.data.mapping.amount, email: q.data.mapping.email, status: q.data.mapping.status, currency: q.data.mapping.currency, ok: q.data.mapping.successValues.join(","), cur: q.data.mapping.expectedCurrency, first: q.data.links.first, month: q.data.links.month, base: q.data.baseUrl });
  const call = async (action: string, payload: object) => { setMsg(""); try { const r = await api<any>(s, action, payload); void qc.invalidateQueries({ queryKey: ["md-hook"] }); void qc.invalidateQueries({ queryKey: ["md-events"] }); return r; } catch (x) { setMsg((x as Error).message); return null; } };
  if (!q.data || !f) return null; const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card flex flex-col gap-2">
      <h2 className="font-semibold">Confirmation automatique des paiements MASTER DOGUI (webhook)</h2>
      <p className="text-xs text-muted">{q.data.note}</p>
      <div className="grid grid-cols-2 gap-2">
        <input aria-label="Adresse de réception (fonction publique)" className="input col-span-2" placeholder="Adresse https de la fonction de réception" value={f.base} onChange={set("base")} />
        <input aria-label="Champ référence" className="input" placeholder="Champ : référence (ex. data.id)" value={f.ref} onChange={set("ref")} /><input aria-label="Champ montant" className="input" placeholder="Champ : montant" value={f.amount} onChange={set("amount")} />
        <input aria-label="Champ e-mail" className="input" placeholder="Champ : e-mail de l'acheteur" value={f.email} onChange={set("email")} /><input aria-label="Champ statut" className="input" placeholder="Champ : statut" value={f.status} onChange={set("status")} />
        <input aria-label="Valeurs de succès" className="input" placeholder="Valeurs = paiement abouti (séparées par des virgules)" value={f.ok} onChange={set("ok")} /><input aria-label="Champ devise" className="input" placeholder="Champ : devise (facultatif)" value={f.currency} onChange={set("currency")} />
        <input aria-label="Devise attendue" className="input" placeholder="Devise attendue (facultatif)" value={f.cur} onChange={set("cur")} /><span className={`text-xs self-center ${q.data.mappingComplete ? "text-ok" : "text-warn"}`}>{q.data.mappingComplete ? "Paramétrage complet" : "Paramétrage incomplet : examen manuel"}</span>
        <input aria-label="Lien de paiement première période" className="input" placeholder="Lien de paiement : première période" value={f.first} onChange={set("first")} /><input aria-label="Lien de paiement renouvellement" className="input" placeholder="Lien de paiement : renouvellement" value={f.month} onChange={set("month")} />
      </div>
      <div className="flex gap-2 flex-wrap"><button className="btn" onClick={async () => { const r = await call("platform.master.hook.save", { baseUrl: f.base, mapping: { ref: f.ref, amount: f.amount, email: f.email, status: f.status, currency: f.currency, successValues: f.ok.split(",").map((x) => x.trim()).filter(Boolean), expectedCurrency: f.cur }, links: { first: f.first, month: f.month } }); if (r) setMsg("Paramétrage enregistré"); }}>Enregistrer</button>
        <button className="btn-ghost" onClick={async () => { const r = await call("platform.master.hook.rotate", {}); if (r) setTok(r.urlTemplate); }}>{q.data.tokenSet ? "Régénérer le jeton" : "Générer le jeton"}</button>
        <button className="btn-ghost" onClick={() => void call("platform.master.hook.save", { enabled: !q.data.enabled })}>{q.data.enabled ? "Désactiver" : "Activer"} la réception</button></div>
      {tok && <p className="text-xs break-all text-warn" role="status">À copier maintenant dans le prestataire de paiement (affichée une seule fois) : {tok}</p>}{msg && <p className="text-sm text-warn">{msg}</p>}<p className="text-xs text-muted">Réception : {q.data.enabled ? "ACTIVE" : "désactivée"} · jeton : {q.data.tokenSet ? "défini" : "absent"}</p>
      <b className="text-sm">Notifications à examiner</b>{ev.data?.events.length === 0 && <p className="text-xs text-muted">Aucune notification en attente.</p>}
      {ev.data?.events.map((e) => <EvRow key={e.id} e={e} onDone={() => { void qc.invalidateQueries({ queryKey: ["md-events"] }); }} />)}
    </div>
  );
}
function EvRow({ e, onDone }: { e: EvV; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ tenantId: "", kind: "first", count: "1", note: "" }); const [msg, setMsg] = useState("");
  async function go(action: string) { setMsg(""); try { await api(s, "platform.master.event.decide", { eventId: e.id, action, ...(action === "approve" ? { tenantId: f.tenantId.trim(), kind: f.kind, count: Number(f.count) } : {}), note: f.note }); onDone(); } catch (x) { setMsg((x as Error).message); } }
  return (
    <div className="border-t border-line pt-2 flex flex-col gap-1 text-xs"><p><b>{e.ref || e.id}</b> · {e.amount ?? "?"} {e.currency} · {e.email || "e-mail ?"} · {new Date(e.at).toLocaleString("fr-FR")}</p><p className="text-warn">{e.note}</p>{e.raw && <details><summary className="cursor-pointer">Contenu reçu (calibrage)</summary><pre className="whitespace-pre-wrap break-all text-xs text-muted">{e.raw}</pre></details>}
      <div className="grid grid-cols-3 gap-1"><input aria-label="tenantId à activer" className="input !py-1" placeholder="tenantId" value={f.tenantId} onChange={(x) => setF({ ...f, tenantId: x.target.value })} /><select aria-label="Type" className="input !py-1" value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}><option value="first">Première période</option><option value="month">Mois</option></select><input aria-label="Mois" className="input !py-1" value={f.count} disabled={f.kind === "first"} onChange={(x) => setF({ ...f, count: x.target.value })} /></div>
      <input aria-label="Motif de la décision" className="input !py-1" placeholder="Motif / vérification effectuée" value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} /><div className="flex gap-2"><button className="btn !py-1" onClick={() => void go("approve")}>Valider et activer</button><button className="btn-ghost !py-1" onClick={() => void go("reject")}>Rejeter</button></div>{msg && <p className="text-bad">{msg}</p>}</div>
  );
}


type AiDay = { day: string; questions: number; aiAnswers: number; fallbacks: number; tokensIn: number; tokensOut: number; globalTokens: number; tenants: number; top: { tenantId: string; name: string; tokens: number }[] };
type AiUsage = { status: { enabledFlag: boolean; billingConfirmed: boolean; keyPresent: boolean; modelSet: boolean; active: boolean; apiVersion: string | null; style: string | null }; globalCap: number; days: AiDay[]; alerts: string[] };
type EvR = { id: string; text: string; expected: string; matcher: string | null; ai: string | null; routed: string | null; classOk: boolean; factsOk: boolean; mismatches: string[]; written: string; reason: string; invented: boolean; tokens: number; ms: number };
/** Administrateur : coût de l'IA par jour (jetons, replis, plafond global) et jeu de référence rejoué contre le vrai modèle sur des données synthétiques (aucune donnée d'entreprise). */
function MasterAiPanel() {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["md-ai-usage"], retry: 1, queryFn: () => api<AiUsage>(s, "platform.master.ai.usage", { days: 7 }) });
  const [res, setRes] = useState<EvR[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [total, setTotal] = useState(25); const [tk, setTk] = useState(0);
  const run = async () => { setBusy(true); setErr(""); setRes([]); setTk(0); let from: number | null = 0; try { while (from !== null) { const r: { results: EvR[]; next: number | null; total: number; tokens: { in: number; out: number } } = await api(s, "platform.master.ai.eval", { from, count: 3 }); setTotal(r.total); setRes((x) => [...x, ...r.results]); setTk((x) => x + r.tokens.in + r.tokens.out); from = r.next; } void q.refetch(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  if (q.error) return null; if (!q.data) return null; const u = q.data; const pc = (n: number) => (res.length ? Math.round((n / res.length) * 100) : 0); const done = res.length === total && !busy;
  const okFacts = res.filter((r) => r.factsOk).length; const okClass = res.filter((r) => r.classOk).length; const kept = res.filter((r) => r.written === "retenue").length; const disc = res.filter((r) => r.written === "écartée").length; const inv = res.filter((r) => r.invented).length;
  return (
    <div className="card flex flex-col gap-2 text-sm"><b>IA de MASTER DOGUI : coûts et qualité</b>
      <p className="text-xs text-muted">État : {u.status.active ? "active" : "inactive"} · offre payante confirmée : {u.status.billingConfirmed ? "oui" : "non"} · clé : {u.status.keyPresent ? "présente" : "absente"} · modèle : {u.status.modelSet ? "défini" : "absent"} · API : {u.status.style ?? "—"} {u.status.apiVersion ?? ""} · plafond global : {u.globalCap.toLocaleString("fr-FR")} jetons/jour</p>
      {u.alerts.map((a) => <p key={a} className="text-xs text-warn" role="alert">{a}</p>)}
      <div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr className="text-muted text-left"><th>Jour</th><th>Questions</th><th>IA</th><th>Replis</th><th>Jetons</th><th>Global</th></tr></thead><tbody>{u.days.map((d) => <tr key={d.day} className="border-t border-line"><td>{d.day}</td><td>{d.questions}</td><td>{d.aiAnswers}</td><td>{d.fallbacks}</td><td>{(d.tokensIn + d.tokensOut).toLocaleString("fr-FR")}</td><td>{d.globalTokens.toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div>
      {u.days[0]?.top.length ? <p className="text-xs text-muted">Plus gros consommateurs aujourd'hui : {u.days[0].top.map((x) => `${x.name} (${x.tokens.toLocaleString("fr-FR")})`).join(", ")}</p> : null}
      <div className="border-t border-line pt-2 flex flex-col gap-1"><b>Jeu de référence ({total} questions, données synthétiques)</b><p className="text-xs text-muted">Rejoue chaque question contre le vrai modèle : classement du sujet, chiffres exacts, rédaction retenue ou écartée. Consomme de vrais jetons (comptés au plafond global).</p>
        <button className="btn self-start" disabled={busy || !u.status.active} onClick={() => void run()}>{busy ? `Évaluation… ${res.length}/${total}` : "Lancer l'évaluation"}</button>{err && <p className="text-bad text-xs" role="alert">{err}</p>}
        {res.length > 0 && <div className="text-xs flex flex-col gap-1"><p>Chiffres exacts : <b>{okFacts}/{res.length} ({pc(okFacts)} %)</b> · Sujet bien classé : <b>{okClass}/{res.length} ({pc(okClass)} %)</b> · Rédactions retenues : {kept} · écartées : {disc} (dont chiffres inventés bloqués : {inv}) · Jetons : {tk.toLocaleString("fr-FR")}</p>
          {done && <p className={okFacts === res.length && okClass >= Math.ceil(res.length * 0.9) ? "text-ok" : "text-warn"}>{okFacts === res.length && okClass >= Math.ceil(res.length * 0.9) ? "Seuil atteint (100 % de chiffres exacts, au moins 90 % de sujets bien classés)." : "Seuil non atteint : 100 % de chiffres exacts et au moins 90 % de sujets bien classés exigés avant production."}</p>}
          {res.filter((r) => !r.factsOk || !r.classOk || r.invented).map((r) => <p key={r.id} className="text-soft">• {r.text} → attendu {r.expected}, obtenu {r.routed ?? "rien"}{r.mismatches.length ? ` (${r.mismatches.slice(0, 2).join(" ; ")})` : ""}{r.invented ? " · chiffre inventé bloqué" : ""}</p>)}</div>}
      </div>
    </div>
  );
}
