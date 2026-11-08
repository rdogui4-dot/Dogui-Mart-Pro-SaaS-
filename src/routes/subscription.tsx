import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { MAX_COUNT, PERIODS, PERIOD_LABEL, priceFor, type Entitlement, type Period, type Plan } from "@/domain/subscriptions";

export type SubInfo = {
  entitlement: Entitlement; plans: Plan[]; usage: { shops: number; users: number; products: number };
  providers: { wave: boolean; orange: boolean };
  payments: { id: string; plan: string; period: Period; count: number; amount: number; provider: string; status: string; reference: string; url?: string; note?: string; endsAt?: string; createdAt: string }[];
};
export const useSubscription = () => {
  const { session } = useSession(); const s = session!;
  return useQuery({ queryKey: ["subscription", s.tenantId], queryFn: () => api<SubInfo>(s, "subscription.get"), staleTime: 60_000, enabled: !!s });
};

const STATE_LABEL = { active: "Actif", expiring: "Bientôt expiré", grace: "Expiré — délai de grâce", locked: "Expiré — lecture seule" } as const;
const STATE_TONE = { active: "text-emerald-400", expiring: "text-amber-300", grace: "text-orange-400", locked: "text-red-400" } as const;
const PAY_LABEL: Record<string, string> = { awaiting_payment: "À payer", pending_review: "En attente de validation", approved: "Validé", rejected: "Refusé" };
const lim = (n: number) => (n < 0 ? "illimité" : String(n));
const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

/** Bandeau d'état de l'abonnement, affiché sous l'en-tête. */
export function SubscriptionBanner() {
  const { data } = useSubscription();
  if (!data || data.entitlement.state === "active") return null;
  const e = data.entitlement;
  const msg = e.state === "expiring" ? `${e.trial ? "Votre essai gratuit" : "Votre abonnement"} se termine dans ${e.daysLeft} jour(s).`
    : e.state === "grace" ? "Abonnement expiré : renouvelez-le avant la fin du délai de grâce."
      : "Abonnement expiré : l'application est en lecture seule.";
  return <div className={`text-center text-sm py-1 ${e.state === "locked" ? "bg-red-600 text-white" : "bg-amber-500/90 text-black"}`}>{msg}</div>;
}

export function SubscriptionSection() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const { data, isLoading, error } = useSubscription();
  const [period, setPeriod] = useState<Period>("month"); const [count, setCount] = useState(1);
  const [pay, setPay] = useState<{ plan: Plan; provider: "wave" | "orange" } | null>(null);
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
      <div className="card flex flex-col gap-2">
        <div className="flex justify-between items-baseline"><b className="text-lg">Formule {e.plan.name}{e.trial && " (essai)"}</b><span className={`text-sm ${STATE_TONE[e.state]}`}>{STATE_LABEL[e.state]}</span></div>
        <div className="text-sm text-white/60">{e.state === "locked" || e.state === "grace" ? "Échue le" : "Valable jusqu'au"} {dateFr(e.endsAt)}{e.state === "active" || e.state === "expiring" ? ` · ${e.daysLeft} jour(s) restant(s)` : ""}</div>
        {use("Boutiques", data.usage.shops, e.limits.maxShops)}{use("Utilisateurs (vous inclus)", data.usage.users, e.limits.maxUsers)}{use("Produits", data.usage.products, e.limits.maxProducts)}
      </div>

      <div className="card flex flex-col gap-2">
        <h2 className="font-semibold">Choisir une formule</h2>
        <div className="grid grid-cols-5 gap-1 text-xs">
          {PERIODS.map((p) => <button key={p} className={period === p ? "btn !py-2 !px-1 !text-xs" : "btn-ghost !py-2 !px-1 !text-xs"} onClick={() => { setPeriod(p); setCount((c) => Math.min(c, MAX_COUNT[p])); }}>{PERIOD_LABEL[p]}</button>)}
        </div>
        <label className="flex items-center justify-between text-sm">Nombre de {PERIOD_LABEL[period].toLowerCase()}(s)
          <input className="input !w-20 !py-2" type="number" min={1} max={MAX_COUNT[period]} value={count} onChange={(ev) => setCount(Math.max(1, Math.min(MAX_COUNT[period], Number(ev.target.value) || 1)))} /></label>
        {data.plans.map((p) => (
          <div key={p.id} className={`rounded-xl border p-3 flex flex-col gap-1 ${p.id === e.plan.id ? "border-[var(--gold)]" : "border-white/10"}`}>
            <div className="flex justify-between"><b>{p.name}</b><span className="text-[var(--gold)] font-semibold">{formatFcfa(priceFor(p, period, count))}</span></div>
            <div className="text-xs text-white/60">{lim(p.limits.maxShops)} boutique(s) · {lim(p.limits.maxUsers)} utilisateur(s) · {lim(p.limits.maxProducts)} produits</div>
            {p.id !== e.plan.id && !e.trial && e.state !== "locked" && <div className="text-xs text-amber-300">Changer de formule démarre la nouvelle période maintenant : le temps restant de l'actuelle n'est pas reporté.</div>}
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(["wave", "orange"] as const).map((prov) => (
                <button key={prov} className="btn-ghost !py-2" disabled={!data.providers[prov]} onClick={() => setPay({ plan: p, provider: prov })}>{prov === "wave" ? "Payer avec Wave" : "Payer avec Orange"}</button>
              ))}
            </div>
          </div>
        ))}
        {!data.providers.wave && !data.providers.orange && <p className="text-xs text-amber-300">Le paiement en ligne n'est pas encore activé par la plateforme.</p>}
      </div>

      {data.payments.length > 0 && (
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
      {pay && <PayModal plan={pay.plan} provider={pay.provider} period={period} count={count} onClose={() => { setPay(null); refresh(); }} />}
    </>
  );
}

function PayModal({ plan, provider, period, count, onClose }: { plan: Plan; provider: "wave" | "orange"; period: Period; count: number; onClose: () => void }) {
  const { session } = useSession(); const s = session!;
  const requestId = useRef(crypto.randomUUID()); // un nouvel essai réutilise la même demande : jamais deux liens
  const canvas = useRef<HTMLCanvasElement>(null);
  const [link, setLink] = useState<{ id: string; url: string; reference: string; amount: number } | null>(null);
  const [tx, setTx] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ id: string; url: string; reference: string; amount: number }>(s, "subscription.checkout", { requestId: requestId.current, plan: plan.id, period, count, provider }).then(setLink).catch((e: Error) => setErr(e.message)); }, [s, plan.id, period, count, provider]);
  useEffect(() => { if (link && canvas.current) void QRCode.toCanvas(canvas.current, link.url, { width: 240, margin: 2 }); }, [link]);
  async function submit() { setBusy(true); setErr(""); try { await api(s, "subscription.submitProof", { paymentId: link!.id, txRef: tx }); setDone(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-3 p-6 overflow-y-auto">
      <h2 className="text-xl font-bold">{plan.name} · {PERIOD_LABEL[period]} ×{count}</h2>
      {link && <p className="text-[var(--gold)] text-lg font-semibold">{formatFcfa(link.amount)}</p>}
      {done ? <>
        <p className="text-emerald-400 text-center">Merci ! Votre paiement est en attente de validation. Votre formule sera activée dès que la plateforme l'aura vérifié.</p>
        <button className="btn w-full max-w-xs" onClick={onClose}>Fermer</button>
      </> : <>
        {link ? <canvas ref={canvas} className="rounded-xl bg-white" /> : !err && <p className="text-white/60">Création du lien…</p>}
        {link && <>
          <a className="btn-ghost w-full max-w-xs text-center" href={link.url} target="_blank" rel="noreferrer">Ouvrir {provider === "wave" ? "Wave" : "Orange"} sur ce téléphone</a>
          <p className="text-sm text-white/60 text-center">Réf. {link.reference}. Après le paiement, saisissez l'ID de transaction reçu.</p>
          <input className="input max-w-xs" placeholder="ID de transaction" value={tx} onChange={(e) => setTx(e.target.value)} />
          <button className="btn w-full max-w-xs" disabled={busy || tx.trim().length < 6} onClick={() => void submit()}>J'ai payé</button>
        </>}
        {err && <p className="text-red-400 text-center">{err}</p>}
        <button className="btn-ghost w-full max-w-xs" onClick={onClose}>Fermer</button>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ Administration de la plateforme
type PlatPayment = { id: string; tenantId: string; tenantName: string; plan: string; period: Period; count: number; amount: number; provider: string; reference: string; txRef: string; status: string; note?: string; createdAt: string };

export function PlatformSection() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending_review" | "approved" | "rejected">("pending_review");
  const list = useQuery({ queryKey: ["platform-payments", status], queryFn: () => api<{ payments: PlatPayment[] }>(s, "platform.payments.list", { status }) });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  async function review(p: PlatPayment, approve: boolean) {
    const note = approve ? "" : (prompt("Motif du refus (visible par le commerçant)") ?? ""); if (!approve && !note) return;
    if (approve && !confirm(`Valider ${formatFcfa(p.amount)} de ${p.tenantName} (ID ${p.txRef}) ? Vérifiez d'abord la réception sur votre compte ${p.provider}.`)) return;
    setBusy(p.id); setErr("");
    try { await api(s, "platform.payment.review", { paymentId: p.id, approve, note }); await qc.invalidateQueries({ queryKey: ["platform-payments"] }); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-1 text-xs">
        {([["pending_review", "À valider"], ["approved", "Validés"], ["rejected", "Refusés"]] as const).map(([k, l]) => <button key={k} className={status === k ? "btn !py-2" : "btn-ghost !py-2"} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {(list.data?.payments ?? []).map((p) => (
        <div key={p.id} className="card flex flex-col gap-1 text-sm">
          <div className="flex justify-between"><b>{p.tenantName}</b><span className="text-[var(--gold)]">{formatFcfa(p.amount)}</span></div>
          <div className="text-white/60">{p.plan} · {PERIOD_LABEL[p.period]} ×{p.count} · {p.provider} · {p.reference}</div>
          <div className="text-white/60">ID transaction : <b className="text-white">{p.txRef || "—"}</b> · {new Date(p.createdAt).toLocaleString("fr-FR")}{p.note ? ` · ${p.note}` : ""}</div>
          {status === "pending_review" && <div className="grid grid-cols-2 gap-2 mt-1"><button className="btn !py-2" disabled={busy === p.id} onClick={() => void review(p, true)}>Valider</button><button className="btn-ghost !py-2" disabled={busy === p.id} onClick={() => void review(p, false)}>Refuser</button></div>}
        </div>
      ))}
      {list.data?.payments.length === 0 && <p className="text-center text-white/50 py-4">Rien dans cette liste.</p>}
      <PlatformSettingsForm />
      <GrantForm />
    </>
  );
}

function PlatformSettingsForm() {
  const { session } = useSession(); const s = session!;
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["platform-settings"], queryFn: () => api<{ wave: boolean; orange: boolean; plans: Plan[] }>(s, "platform.settings.get") });
  const [wave, setWave] = useState(""); const [orange, setOrange] = useState("");
  const [plans, setPlans] = useState<Plan[] | null>(null); const [msg, setMsg] = useState("");
  useEffect(() => { if (cfg.data && !plans) setPlans(structuredClone(cfg.data.plans)); }, [cfg.data, plans]);
  const save = useMutation({
    mutationFn: () => api(s, "platform.settings.save", { ...(wave && { waveTemplate: wave }), ...(orange && { orangeTemplate: orange }), plans }),
    onSuccess: () => { setMsg("Enregistré"); setWave(""); setOrange(""); void qc.invalidateQueries({ queryKey: ["platform-settings"] }); void qc.invalidateQueries({ queryKey: ["subscription"] }); },
    onError: (e) => setMsg((e as Error).message),
  });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setMsg(""); save.mutate(); }}>
      <h2 className="font-semibold">Paiements et tarifs de la plateforme</h2>
      <p className="text-xs text-white/50">Liens de votre compte Wave / Orange Business (https, avec <code>{"{amount}"}</code> et <code>{"{ref}"}</code>). Wave : {cfg.data?.wave ? "configuré" : "non configuré"} · Orange : {cfg.data?.orange ? "configuré" : "non configuré"}. Un champ vide reste inchangé.</p>
      <input className="input" placeholder="Modèle de lien Wave Business" value={wave} onChange={(e) => setWave(e.target.value)} />
      <input className="input" placeholder="Modèle de lien Orange Business" value={orange} onChange={(e) => setOrange(e.target.value)} />
      {plans?.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-white/10 p-2 flex flex-col gap-1">
          <b className="text-sm">{p.name}</b>
          <div className="grid grid-cols-5 gap-1">{PERIODS.map((k) => (
            <label key={k} className="text-[10px] text-white/50">{PERIOD_LABEL[k]}<input className="input !px-1 !py-1 !text-xs" inputMode="numeric" value={p.prices[k]} onChange={(e) => setPlans(plans.map((x, j) => (j === i ? { ...x, prices: { ...x.prices, [k]: num(e.target.value) } } : x)))} /></label>
          ))}</div>
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
      <input className="input" placeholder="Identifiant du commerce (tenantId)" required value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <select className="input !px-2" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="starter">Starter</option><option value="business">Business</option><option value="pro">Pro</option></select>
        <select className="input !px-2" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Period })}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select>
        <input className="input !px-2" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />
      </div>
      <input className="input" placeholder="Motif (ex. paiement espèces reçu le…)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button className="btn">Attribuer</button>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
    </form>
  );
}
