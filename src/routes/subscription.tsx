import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { PERIODS, PERIOD_LABEL, priceFor, type Entitlement, type Period, type Plan, type PlanId } from "@/domain/subscriptions";
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

export function SubscriptionSection({ initial }: { initial?: { plan: PlanId; period?: Period } }) {
  const { session } = useSession(); const s = session!;
  const picked = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { data, isLoading, error } = useSubscription();
  const [period, setPeriod] = useState<Period>(initial?.period ?? "month");
  const [cameFrom] = useState(initial); // offre indiquée par l'URL de redirection de Selar
  useEffect(() => { picked.current?.scrollIntoView({ block: "center" }); }, [!!cameFrom]);
  const [pay, setPay] = useState<Plan | null>(null);
  if (isLoading) return <p className="text-muted">Chargement…</p>;
  if (error || !data) return <p className="text-bad text-sm">{(error as Error)?.message ?? "Erreur"}</p>;
  const e = data.entitlement;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["subscription", s.tenantId] });
  const use = (label: string, used: number, max: number) => (
    <div><div className="flex justify-between text-sm"><span>{label}</span><span className={max >= 0 && used >= max ? "text-bad" : "text-muted"}>{used} / {lim(max)}</span></div>
      {max >= 0 && <div className="h-1.5 rounded bg-subtle"><div className={`h-1.5 rounded ${used >= max ? "bg-bad" : "bg-accent"}`} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} /></div>}</div>
  );
  return (
    <>
      {e.lifetime ? (
        <div className="card flex flex-col gap-2 border-accent">
          <div className="flex justify-between items-baseline"><b className="text-lg">Accès à vie</b><span className="text-sm text-ok">Actif</span></div>
          <p className="text-sm text-soft">Ce commerce dispose d'un accès à vie : toutes les fonctions actuelles et futures, sans limite de boutiques, d'utilisateurs ni de produits, et sans paiement ni renouvellement.</p>
          {use("Boutiques", data.usage.shops, e.limits.maxShops)}{use("Utilisateurs (vous inclus)", data.usage.users, e.limits.maxUsers)}{use("Produits", data.usage.products, e.limits.maxProducts)}
        </div>
      ) : (
        <div className="card flex flex-col gap-2">
          <div className="flex justify-between items-baseline"><b className="text-lg">Formule {e.plan.name}{e.trial && " (essai)"}</b><span className={`text-sm ${STATE_TONE[e.state]}`}>{STATE_LABEL[e.state]}</span></div>
          <div className="text-sm text-muted">{e.state === "locked" || e.state === "grace" ? "Échue le" : "Valable jusqu'au"} {dateFr(e.endsAt)}{e.state === "active" || e.state === "expiring" ? ` · ${e.daysLeft} jour(s) restant(s)` : ""}</div>
          {use("Boutiques", data.usage.shops, e.limits.maxShops)}{use("Utilisateurs (vous inclus)", data.usage.users, e.limits.maxUsers)}{use("Produits", data.usage.products, e.limits.maxProducts)}
        </div>
      )}

      {!e.lifetime && <section aria-label="Formules" className="flex flex-col gap-4">
        <div className="text-center flex flex-col gap-1">
          <h2 className="text-xl font-bold">Choisissez votre formule</h2>
          <p className="text-sm text-muted">Toutes les fonctions dans chaque formule. Seules les limites changent. Sans engagement : vous payez la durée choisie.</p>
        </div>
        {cameFrom && <p className="text-sm rounded-lg bg-[var(--surface-2)] border border-accent/40 p-3">Vous revenez de Selar ? Votre formule est en surbrillance. Sélectionnez la période que vous avez payée, touchez « Payer sur Selar » sur cette formule : dans la fenêtre qui s'ouvre, saisissez la référence de commande reçue par e-mail et l'adresse utilisée pour l'achat (inutile de repayer).</p>}
        <div role="tablist" aria-label="Durée" className="grid grid-cols-5 gap-1">
          {PERIODS.map((p) => <button key={p} role="tab" aria-selected={period === p} aria-current={period === p} className="chip !px-1 !py-2 text-xs text-center" onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>)}
        </div>
        {data.plans.map((p, i) => {
          const price = priceFor(p, period, 1); const save = savingPct(p, period);
          const popular = p.id === "business"; const current = p.id === e.plan.id; const target = cameFrom?.plan === p.id;
          return (
            <div key={p.id} ref={target ? picked : undefined} className={`relative rounded-xl border p-5 flex flex-col gap-3 bg-[var(--surface)] ${target ? "ring-2 ring-[var(--accent)]/60 border-accent" : popular || current ? "border-accent" : "border-[var(--line)]"}`}>
              {(popular || current) && <span className="absolute -top-3 left-5 rounded-full bg-accent text-accent-ink text-xs font-bold px-3 py-1">{current ? "Votre formule" : "Le plus choisi"}</span>}
              <div className="flex items-baseline justify-between"><h3 className="text-lg font-bold">{p.name}</h3>{save > 0 && <span className="text-xs rounded-full bg-ok-bg text-ok px-2 py-1">−{save} % vs jour</span>}</div>
              <div><span className="text-accent-text text-3xl font-extrabold">{formatFcfa(price)}</span><span className="text-sm text-muted"> / {PER_LABEL[period]}</span></div>
              <ul className="text-sm flex flex-col gap-1.5">
                {[`${lim(p.limits.maxShops)} boutique(s)`, `${lim(p.limits.maxUsers)} utilisateur(s)`, `${lim(p.limits.maxProducts)} produits`, "Caisse, stock, achats, clients, compta", "Paiement QR Wave / Orange, factures PDF", "Fonctionne hors ligne"].map((f) => <li key={f} className="flex gap-2"><Check size={16} className="text-accent-text shrink-0 mt-0.5" />{f}</li>)}
              </ul>
              {!current && !e.trial && e.state !== "locked" && i >= 0 && <div className="text-xs text-warn">Changer de formule démarre la nouvelle période maintenant : le temps restant de l'actuelle n'est pas reporté.</div>}
              <button className={popular ? "btn" : "btn-ghost"} disabled={!data.available[p.id]} onClick={() => setPay(p)}>{data.available[p.id] ? `Payer sur Selar · ${PERIOD_LABEL[period]}` : "Paiement bientôt disponible"}</button>
            </div>
          );
        })}
        {!Object.keys(data.available).length && <p className="text-xs text-warn text-center">Le paiement en ligne n'est pas encore activé par la plateforme.</p>}
        <ol className="card text-sm text-soft flex flex-col gap-2">
          <li className="font-semibold text-main">Comment ça marche</li>
          <li>1. Choisissez la formule et la durée, touchez « Payer sur Selar ».</li>
          <li>2. Réglez sur Selar (Wave, Orange Money, carte) en sélectionnant la même durée.</li>
          <li>3. Saisissez la référence de commande reçue par e-mail : votre formule est activée après vérification. Si vous gardez la même formule, la durée s'ajoute à l'échéance.</li>
        </ol>
        <p className="text-xs text-muted text-center flex items-center justify-center gap-1"><ShieldCheck size={14} />Paiement sécurisé par Selar · vos données restent conservées si l'abonnement expire.</p>
      </section>}

      {!e.lifetime && data.payments.length > 0 && (
        <div className="card flex flex-col gap-1">
          <h2 className="font-semibold">Mes paiements</h2>
          {data.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm gap-2">
              <span>{p.plan} · {PERIOD_LABEL[p.period]} ×{p.count} · {formatFcfa(p.amount)}<br /><span className="text-xs text-muted">{p.reference} · {new Date(p.createdAt).toLocaleDateString("fr-FR")}{p.note ? ` · ${p.note}` : ""}</span></span>
              <span className={p.status === "approved" ? "text-ok" : p.status === "rejected" ? "text-bad" : "text-warn"}>{PAY_LABEL[p.status] ?? p.status}</span>
            </div>
          ))}
        </div>
      )}
      {pay && <PayModal plan={pay} period={period} onClose={() => { setPay(null); refresh(); }} />}
    </>
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
