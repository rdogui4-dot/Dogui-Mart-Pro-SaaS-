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
const STATE_TONE = { active: "text-emerald-400", expiring: "text-amber-300", grace: "text-orange-400", locked: "text-red-400" } as const;
const PAY_LABEL: Record<string, string> = { awaiting_payment: "À payer", pending_review: "En attente de validation", approved: "Validé", rejected: "Refusé" };
const PER_LABEL: Record<Period, string> = { day: "jour", week: "semaine", month: "mois", quarter: "trimestre", year: "an" };
const DAYS: Record<Period, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
/** Économie par rapport au tarif « jour » ramené à la même durée. */
const savingPct = (p: Plan, period: Period) => (period === "day" || !p.prices.day ? 0 : Math.max(0, Math.round((1 - priceFor(p, period, 1) / (p.prices.day * DAYS[period])) * 100)));
const lim = (n: number) => (n < 0 ? "illimité" : String(n));
const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

const BANNER_TONE: Record<ReminderLevel, string> = { none: "", info: "bg-sky-600 text-white", warning: "bg-amber-500 text-black", urgent: "bg-orange-500 text-black", grace: "bg-orange-600 text-white", locked: "bg-red-600 text-white" };
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
  if (isLoading) return <p className="text-white/50">Chargement…</p>;
  if (error || !data) return <p className="text-red-400 text-sm">{(error as Error)?.message ?? "Erreur"}</p>;
  const e = data.entitlement;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["subscription", s.tenantId] });
  const use = (label: string, used: number, max: number) => (
    <div><div className="flex justify-between text-sm"><span>{label}</span><span className={max >= 0 && used >= max ? "text-red-400" : "text-white/60"}>{used} / {lim(max)}</span></div>
      {max >= 0 && <div className="h-1.5 rounded bg-white/10"><div className={`h-1.5 rounded ${used >= max ? "bg-red-400" : "bg-[var(--gold)]"}`} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} /></div>}</div>
  );
  return (
    <>
      {e.lifetime ? (
        <div className="card flex flex-col gap-2 border-[var(--gold)]">
          <div className="flex justify-between items-baseline"><b className="text-lg">Accès à vie</b><span className="text-sm text-emerald-400">Actif</span></div>
          <p className="text-sm text-white/70">Ce commerce dispose d'un accès à vie : toutes les fonctions actuelles et futures, sans limite de boutiques, d'utilisateurs ni de produits, et sans paiement ni renouvellement.</p>
          {use("Boutiques", data.usage.shops, e.limits.maxShops)}{use("Utilisateurs (vous inclus)", data.usage.users, e.limits.maxUsers)}{use("Produits", data.usage.products, e.limits.maxProducts)}
        </div>
      ) : (
        <div className="card flex flex-col gap-2">
          <div className="flex justify-between items-baseline"><b className="text-lg">Formule {e.plan.name}{e.trial && " (essai)"}</b><span className={`text-sm ${STATE_TONE[e.state]}`}>{STATE_LABEL[e.state]}</span></div>
          <div className="text-sm text-white/60">{e.state === "locked" || e.state === "grace" ? "Échue le" : "Valable jusqu'au"} {dateFr(e.endsAt)}{e.state === "active" || e.state === "expiring" ? ` · ${e.daysLeft} jour(s) restant(s)` : ""}</div>
          {use("Boutiques", data.usage.shops, e.limits.maxShops)}{use("Utilisateurs (vous inclus)", data.usage.users, e.limits.maxUsers)}{use("Produits", data.usage.products, e.limits.maxProducts)}
        </div>
      )}

      {!e.lifetime && <section aria-label="Formules" className="flex flex-col gap-4">
        <div className="text-center flex flex-col gap-1">
          <h2 className="text-xl font-bold">Choisissez votre formule</h2>
          <p className="text-sm text-white/60">Toutes les fonctions dans chaque formule. Seules les limites changent. Sans engagement : vous payez la durée choisie.</p>
        </div>
        {cameFrom && <p className="text-sm rounded-2xl bg-[var(--surface-2)] border border-[var(--gold)]/40 p-3">Vous revenez de Selar ? Votre formule est en surbrillance. Sélectionnez la période que vous avez payée, touchez « Payer sur Selar » sur cette formule : dans la fenêtre qui s'ouvre, saisissez la référence de commande reçue par e-mail et l'adresse utilisée pour l'achat (inutile de repayer).</p>}
        <div role="tablist" aria-label="Durée" className="grid grid-cols-5 gap-1">
          {PERIODS.map((p) => <button key={p} role="tab" aria-selected={period === p} aria-current={period === p} className="chip !px-1 !py-2 text-xs text-center" onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>)}
        </div>
        {data.plans.map((p, i) => {
          const price = priceFor(p, period, 1); const save = savingPct(p, period);
          const popular = p.id === "business"; const current = p.id === e.plan.id; const target = cameFrom?.plan === p.id;
          return (
            <div key={p.id} ref={target ? picked : undefined} className={`relative rounded-3xl border p-5 flex flex-col gap-3 ${popular ? "bg-gradient-to-b from-[#241d08] to-[var(--surface)]" : "bg-[var(--surface)]"} ${target ? "ring-2 ring-[var(--gold)]/60 border-[var(--gold)]" : popular || current ? "border-[var(--gold)]" : "border-[var(--line)]"}`}>
              {(popular || current) && <span className="absolute -top-3 left-5 rounded-full bg-[var(--gold)] text-black text-xs font-bold px-3 py-1">{current ? "Votre formule" : "Le plus choisi"}</span>}
              <div className="flex items-baseline justify-between"><h3 className="text-lg font-bold">{p.name}</h3>{save > 0 && <span className="text-xs rounded-full bg-emerald-400/15 text-emerald-300 px-2 py-1">−{save} % vs jour</span>}</div>
              <div><span className="gold-text text-3xl font-extrabold">{formatFcfa(price)}</span><span className="text-sm text-white/50"> / {PER_LABEL[period]}</span></div>
              <ul className="text-sm flex flex-col gap-1.5">
                {[`${lim(p.limits.maxShops)} boutique(s)`, `${lim(p.limits.maxUsers)} utilisateur(s)`, `${lim(p.limits.maxProducts)} produits`, "Caisse, stock, achats, clients, compta", "Paiement QR Wave / Orange, factures PDF", "Fonctionne hors ligne"].map((f) => <li key={f} className="flex gap-2"><Check size={16} className="text-[var(--gold)] shrink-0 mt-0.5" />{f}</li>)}
              </ul>
              {!current && !e.trial && e.state !== "locked" && i >= 0 && <div className="text-xs text-amber-300">Changer de formule démarre la nouvelle période maintenant : le temps restant de l'actuelle n'est pas reporté.</div>}
              <button className={popular ? "btn" : "btn-ghost"} disabled={!data.available[p.id]} onClick={() => setPay(p)}>{data.available[p.id] ? `Payer sur Selar · ${PERIOD_LABEL[period]}` : "Paiement bientôt disponible"}</button>
            </div>
          );
        })}
        {!Object.keys(data.available).length && <p className="text-xs text-amber-300 text-center">Le paiement en ligne n'est pas encore activé par la plateforme.</p>}
        <ol className="card text-sm text-white/70 flex flex-col gap-2">
          <li className="font-semibold text-white">Comment ça marche</li>
          <li>1. Choisissez la formule et la durée, touchez « Payer sur Selar ».</li>
          <li>2. Réglez sur Selar (Wave, Orange Money, carte) en sélectionnant la même durée.</li>
          <li>3. Saisissez la référence de commande reçue par e-mail : votre formule est activée après vérification. Si vous gardez la même formule, la durée s'ajoute à l'échéance.</li>
        </ol>
        <p className="text-xs text-white/40 text-center flex items-center justify-center gap-1"><ShieldCheck size={14} />Paiement sécurisé par Selar · vos données restent conservées si l'abonnement expire.</p>
      </section>}

      {!e.lifetime && data.payments.length > 0 && (
        <div className="card flex flex-col gap-1">
          <h2 className="font-semibold">Mes paiements</h2>
          {data.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm gap-2">
              <span>{p.plan} · {PERIOD_LABEL[p.period]} ×{p.count} · {formatFcfa(p.amount)}<br /><span className="text-xs text-white/50">{p.reference} · {new Date(p.createdAt).toLocaleDateString("fr-FR")}{p.note ? ` · ${p.note}` : ""}</span></span>
              <span className={p.status === "approved" ? "text-emerald-400" : p.status === "rejected" ? "text-red-400" : "text-amber-300"}>{PAY_LABEL[p.status] ?? p.status}</span>
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
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center gap-3 p-6 overflow-y-auto">
      <p className="text-xs uppercase tracking-widest text-white/40">{done ? "Étape 2 sur 2 · terminé" : link ? "Étape 1 sur 2 · paiement" : "Préparation"}</p>
      <h2 className="text-xl font-bold">Formule {plan.name} · {PERIOD_LABEL[period]}</h2>
      {link && <p className="gold-text text-3xl font-extrabold">{formatFcfa(link.amount)}</p>}
      {done ? <>
        <p className="text-emerald-400 text-center">Merci ! Votre paiement est en attente de validation. Votre formule sera activée dès que la plateforme l'aura vérifié dans Selar.</p>
        <button className="btn w-full max-w-xs" onClick={onClose}>Fermer</button>
      </> : <>
        {link ? <canvas ref={canvas} className="rounded-xl bg-white" /> : !err && <p className="text-white/60">Préparation du paiement…</p>}
        {link && <>
          <a className="btn w-full max-w-xs text-center" href={link.url} target="_blank" rel="noreferrer noopener">Payer sur Selar</a>
          <ol className="text-sm text-white/70 max-w-xs list-decimal pl-5 flex flex-col gap-1">
            <li>Sur la page Selar (scannez le QR code ou touchez le bouton), dans « Choisir un abonnement », sélectionnez <b>« {selarOptionLabel(period)} »</b> ({formatFcfa(link.amount)}), puis payez. Le libellé peut s'afficher en anglais (day, week, month, quarter, year).</li>
            <li>Selar vous envoie par e-mail un reçu avec une <b>référence de commande</b>.</li>
            <li>Saisissez-la ci-dessous avec l'e-mail utilisé sur Selar. Notre équipe vérifie que la commande correspond bien à la période <b>{PERIOD_LABEL[period]}</b> puis active votre formule.</li>
          </ol>
          <p className="text-xs text-white/40">Réf. interne {link.reference}</p>
          <input aria-label="E-mail utilisé sur Selar" className="input max-w-xs" type="email" inputMode="email" autoCapitalize="none" placeholder="E-mail utilisé sur Selar" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input aria-label="Référence de commande Selar" className="input max-w-xs" placeholder="Référence de commande Selar" value={tx} onChange={(e) => setTx(e.target.value)} />
          <button className="btn w-full max-w-xs" disabled={busy || tx.trim().length < 6 || !email.includes("@")} onClick={() => void submit()}>J'ai payé</button>
        </>}
        {err && <p className="text-red-400 text-center">{err}</p>}
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
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {(list.data?.payments ?? []).map((p) => (
        <div key={p.id} className="card flex flex-col gap-1 text-sm">
          <div className="flex justify-between"><b>{p.tenantName}</b><span className="text-[var(--gold)]">{formatFcfa(p.amount)}</span></div>
          <div className="text-white/60">{p.plan} · {PERIOD_LABEL[p.period]} ×{p.count} · {p.provider} · {p.reference}</div>
          <div className="text-white/60">Référence Selar : <b className="text-white">{p.txRef || "—"}</b> · e-mail : <b className="text-white">{p.payerEmail || "—"}</b></div>
          <div className="text-white/60">{new Date(p.createdAt).toLocaleString("fr-FR")}{p.note ? ` · ${p.note}` : ""}{p.url && <> · <a className="underline" href={p.url} target="_blank" rel="noreferrer noopener">offre Selar</a></>}</div>
          {status === "pending_review" && <div className="grid grid-cols-2 gap-2 mt-1"><button className="btn !py-2" disabled={busy === p.id} onClick={() => void review(p, true)}>Valider</button><button className="btn-ghost !py-2" disabled={busy === p.id} onClick={() => void review(p, false)}>Refuser</button></div>}
        </div>
      ))}
      {list.data?.payments.length === 0 && <p className="text-center text-white/50 py-4">Rien dans cette liste.</p>}
      <PlatformSettingsForm />
      <GrantForm />
      <LifetimeForm />
      </>}
    </>
  );
}

type Renewal = { tenantId: string; shopName: string; phone: string; owner: { name: string; email: string } | null; plan: string; planName: string; period: Period; trial: boolean; state: Entitlement["state"]; level: ReminderLevel; endsAt: string; daysLeft: number; remindedAt: string | null; pendingPayment: boolean; message: string };
const LEVEL_TONE: Record<ReminderLevel, string> = { none: "text-white/60", info: "text-sky-300", warning: "text-amber-300", urgent: "text-orange-400", grace: "text-orange-400", locked: "text-red-400" };

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
        <label className="text-xs text-white/60 flex items-center gap-2">Indicatif par défaut (ex. 221)<input className="input !w-24 !py-1" inputMode="numeric" value={dial} onChange={(e) => setDialCode(e.target.value)} /></label>
        <p className="text-xs text-white/50">Abonnements qui se terminent d'ici {within} jours ou déjà échus. Les messages sont préparés mais envoyés par vous : aucun envoi automatique (pas d'API).</p>
      </div>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
      {(list.data?.renewals ?? []).map((r) => {
        const wa = whatsappNumber(r.phone, dial);
        return (
          <div key={r.tenantId} className="card flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-2"><b>{r.shopName}</b><span className={LEVEL_TONE[r.level]}>{r.trial ? "Essai" : r.planName} · {stateLabel[r.state]}</span></div>
            <div className="text-white/60">{r.trial ? "Essai" : `${r.planName} ${PERIOD_LABEL[r.period].toLowerCase()}`} · {r.daysLeft >= 0 ? `fin dans ${r.daysLeft} j` : `échu depuis ${Math.abs(r.daysLeft)} j`} ({new Date(r.endsAt).toLocaleDateString("fr-FR")})</div>
            <div className="text-white/60">{r.owner ? `${r.owner.name} · ${r.owner.email}` : "Propriétaire inconnu"} · {r.phone || "pas de téléphone"}</div>
            {r.pendingPayment && <div className="text-emerald-400">Un paiement est en attente de validation : validez-le avant de relancer.</div>}
            {r.remindedAt && <div className="text-white/50">Relancé le {new Date(r.remindedAt).toLocaleDateString("fr-FR")}</div>}
            <details><summary className="text-white/50 cursor-pointer">Message</summary><pre className="whitespace-pre-wrap text-xs text-white/70 mt-1">{r.message}</pre></details>
            <div className="flex flex-wrap gap-2 mt-1">
              {wa ? <a className="btn-ghost !py-2 !px-3" target="_blank" rel="noreferrer noopener" href={`https://wa.me/${wa}?text=${encodeURIComponent(r.message)}`}>WhatsApp</a> : <span className="text-xs text-white/40 self-center">WhatsApp : numéro sans indicatif</span>}
              {r.owner?.email && !r.owner.email.endsWith("@staff.invalid") && <a className="btn-ghost !py-2 !px-3" href={`mailto:${r.owner.email}?subject=${encodeURIComponent("Votre abonnement Dogui Mart Pro")}&body=${encodeURIComponent(r.message)}`}>E-mail</a>}
              <button className="btn-ghost !py-2 !px-3" onClick={() => void copy(r)}>Copier</button>
              <button className="btn-ghost !py-2 !px-3" onClick={() => void mark(r)}>Marquer relancé</button>
            </div>
          </div>
        );
      })}
      {list.data?.renewals.length === 0 && <p className="text-center text-white/50 py-4">Aucun abonnement à relancer.</p>}
      {list.data?.truncated && <p className="text-xs text-amber-300">Liste limitée aux 100 échéances les plus proches.</p>}
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
      <p className="text-xs text-white/50">Un produit Selar par formule : le client y choisit la période. Collez le lien de chaque produit ({done}/{plans?.length ?? 3} configurés). Les prix ci-dessous doivent être exactement ceux des options de période créées dans Selar. Pas d'API : vous vérifiez chaque paiement dans Selar avant de le valider ici.</p>
      {plans?.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-white/10 p-2 flex flex-col gap-2">
          <b className="text-sm">{p.name}</b>
          <input aria-label={`Lien Selar ${p.name}`} className="input !px-2 !py-1 !text-xs" placeholder="https://selar.com/…" autoCapitalize="none" value={links?.[p.id] ?? ""} onChange={(e) => setLinks({ ...links, [p.id]: e.target.value })} />
          {PERIODS.map((k) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-1 items-center">
              <span className="text-xs text-white/60">{selarOptionLabel(k)}</span>
              <input aria-label={`Prix ${p.name} ${PERIOD_LABEL[k]}`} className="input !px-2 !py-1 !text-xs" inputMode="numeric" value={p.prices[k]} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, prices: { ...x.prices, [k]: num(e.target.value) } } : x)))} />
            </div>
          ))}
          <div className="grid grid-cols-3 gap-1">{([["maxShops", "Boutiques"], ["maxUsers", "Utilisateurs"], ["maxProducts", "Produits (-1 = ∞)"]] as const).map(([k, l]) => (
            <label key={k} className="text-[10px] text-white/50">{l}<input className="input !px-1 !py-1 !text-xs" inputMode="numeric" value={p.limits[k]} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, limits: { ...x.limits, [k]: Number(e.target.value) } } : x)))} /></label>
          ))}</div>
        </div>
      ))}
      <button className="btn" disabled={save.isPending}>Enregistrer</button>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
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
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
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
      <p className="text-xs text-white/50">Votre propre commerce (créé avec votre compte administrateur) a déjà l'accès à vie. Ce formulaire sert à l'accorder ou le retirer à un autre commerce.</p>
      <input aria-label="Identifiant du commerce (tenantId)" className="input" placeholder="Identifiant du commerce (tenantId)" required value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} /> Retirer l'accès à vie</label>
      <button className="btn">{revoke ? "Retirer" : "Accorder"}</button>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
    </form>
  );
}
