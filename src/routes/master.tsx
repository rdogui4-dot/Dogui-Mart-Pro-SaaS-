/** MASTER DOGUI — étape 1 : état de la licence (essai, période payante, consultation). Aucune analyse IA à ce stade. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";

type Rem = { level: "soon" | "urgent" | "last" | "expired"; text: string };
type V = { reminder: Rem | null; state: "none" | "trial" | "active" | "grace" | "expired"; phase: string; endsAt: string | null; daysLeft: number | null; canAnalyze: boolean; consultOnly: boolean; trialUsed: boolean; canStartTrial: boolean; isOwner: boolean; trialDays: number; billingStartsAt: string | null; nextDue: { at: string; amount: number; label: string } | null; prices: { first: number; firstMonths: number; renew: number }; consequence: string; history: { id: string; kind: string; count?: number; amount: number; from: string; to: string; at: string; note: string }[]; notes: string[] };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const LABEL: Record<V["state"], [string, string]> = { none: ["Non démarrée", "text-white/60"], trial: ["Essai gratuit en cours", "text-emerald-300"], active: ["Licence active", "text-emerald-300"], grace: ["Délai de grâce", "text-amber-300"], expired: ["Expirée — mode consultation", "text-amber-300"] };
export function MasterPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const q = useQuery({ queryKey: ["md", "license", s.tenantId], retry: 1, queryFn: () => api<V>(s, "md.license", {}) }); const [err, setErr] = useState("");
  const start = useMutation({ mutationFn: () => api<V>(s, "md.trial.start", {}), onSuccess: () => { setErr(""); void qc.invalidateQueries({ queryKey: ["md"] }); }, onError: (e) => setErr((e as Error).message) });
  if (q.error) return <p className="text-red-400 text-sm" role="alert">{(q.error as Error).message}</p>; if (!q.data) return <div className="card h-32 animate-pulse bg-white/5" aria-busy="true" />; const v = q.data; const [lab, tone] = LABEL[v.state];
  return (
    <div className="flex flex-col gap-4">
      <div><h1 className="text-lg font-semibold">MASTER DOGUI</h1><p className="text-xs text-white/50">Le directeur intelligent de votre boutique. Licence indépendante de votre formule, rattachée à l'entreprise.</p></div>
      {v.reminder && <p className={`card text-sm ${v.reminder.level === "soon" ? "text-amber-300" : "text-red-300"}`} role="status">{v.reminder.text}</p>}
      <div className="card flex flex-col gap-2" aria-label="État de la licence"><div className="flex justify-between"><b>Licence</b><b className={tone}>{lab}</b></div>
        <div className="grid grid-cols-2 gap-2 text-sm"><div><span className="text-white/50 text-xs block">{v.state === "trial" ? "Fin de l'essai" : "Fin de la période"}</span>{fmt(v.endsAt)}{v.daysLeft !== null && v.canAnalyze ? <span className="text-white/50 text-xs block">{v.daysLeft} jour(s) restant(s)</span> : null}</div><div><span className="text-white/50 text-xs block">Début de la facturation</span>{v.billingStartsAt ? fmt(v.billingStartsAt) : "—"}</div>
          <div className="col-span-2"><span className="text-white/50 text-xs block">Prochaine échéance</span>{v.nextDue ? <>{fmt(v.nextDue.at)} · <b>{formatFcfa(v.nextDue.amount)}</b> · {v.nextDue.label}</> : "—"}</div></div>
        {v.canStartTrial && <button className="btn self-start" disabled={start.isPending} onClick={() => start.mutate()}>Démarrer l'essai gratuit ({v.trialDays} jours, sans paiement)</button>}{!v.canStartTrial && v.state === "none" && <p className="text-xs text-amber-300">Seul le propriétaire démarre l'essai.</p>}{err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        <p className="text-xs text-white/60">{v.consequence}</p></div>
      <div className="card text-sm flex flex-col gap-1"><b>Tarifs</b><p>Première période : <b>{formatFcfa(v.prices.first)}</b> pour {v.prices.firstMonths} mois (règlement unique, après l'essai).</p><p>Ensuite : <b>{formatFcfa(v.prices.renew)}</b> par mois, sans engagement annuel.</p><p className="text-xs text-white/50">L'essai est unique par entreprise. Aucun débit automatique. Pour activer ou renouveler, contactez l'équipe DOGUI MART PRO : l'activation est confirmée après vérification de votre paiement.</p></div>
      {v.isOwner && <PayBlock first={!v.history.some((h) => h.kind === "first")} />}
      {v.history.length > 0 && <div className="card text-sm flex flex-col gap-1"><b>Historique des activations</b>{v.history.map((h) => <p key={h.id} className="text-xs text-white/70 border-t border-white/10 pt-1">{fmt(h.at)} · {h.kind === "first" ? "Première période (12 mois)" : `Renouvellement ×${h.count}`} · {formatFcfa(h.amount)} · du {fmt(h.from)} au {fmt(h.to)}</p>)}</div>}
      <div className="card text-[11px] text-white/50 flex flex-col gap-1"><b className="text-white/70">À savoir</b>{v.notes.map((n, i) => <p key={i}>• {n}</p>)}<p>• Les analyses et rapports intelligents arrivent par étapes : cette page présente aujourd'hui la licence et ses conditions.</p></div>
    </div>
  );
}

type Req = { id: string; reference: string; kind: string; count: number; amount: number; payerEmail: string; status: string; at: string };
const REQ_LABEL: Record<string, string> = { awaiting: "en attente du paiement", paid: "payée — licence activée", cancelled: "remplacée" };
function PayBlock({ first }: { first: boolean }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [count, setCount] = useState("1"); const [email, setEmail] = useState(""); const [err, setErr] = useState("");
  const list = useQuery({ queryKey: ["md", "pay", s.tenantId], queryFn: () => api<{ requests: Req[] }>(s, "md.pay.list", {}) });
  const make = useMutation({ mutationFn: () => api<{ reference: string; amount: number; link: string; payerEmail: string; note: string }>(s, "md.pay.request", { kind: first ? "first" : "month", count: Number(count), payerEmail: email || undefined }), onSuccess: () => { setErr(""); void qc.invalidateQueries({ queryKey: ["md"] }); }, onError: (e) => setErr((e as Error).message) });
  const last = list.data?.requests.find((r) => r.status === "awaiting");
  return (
    <div className="card flex flex-col gap-2 text-sm"><b>{first ? "Activer la première période (12 mois)" : "Renouveler (mois supplémentaires)"}</b>
      {!first && <label className="text-xs text-white/60 flex flex-col gap-1">Nombre de mois (1 à 12)<input className="input" aria-label="Nombre de mois à payer" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></label>}
      <label className="text-xs text-white/60 flex flex-col gap-1">E-mail utilisé pour payer (par défaut : celui du propriétaire)<input className="input" aria-label="E-mail du payeur" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <button className="btn self-start" disabled={make.isPending} onClick={() => make.mutate()}>Préparer mon paiement</button>{err && <p className="text-red-400" role="alert">{err}</p>}{make.data && <p className="text-xs text-white/60">{make.data.note}</p>}
      {last && <div className="border-t border-white/10 pt-2 flex flex-col gap-1"><p>Référence <b>{last.reference}</b> · montant exact <b>{formatFcfa(last.amount)}</b> · e-mail <b>{last.payerEmail}</b></p>{make.data?.link ? <a className="btn-ghost self-start" href={make.data.link} target="_blank" rel="noreferrer">Ouvrir la page de paiement</a> : <p className="text-xs text-white/50">Page de paiement : fournie par l'équipe DOGUI MART PRO.</p>}</div>}
      {list.data?.requests.slice(0, 3).map((r) => <p key={r.id} className="text-xs text-white/60 border-t border-white/10 pt-1">{r.reference} · {formatFcfa(r.amount)} · {REQ_LABEL[r.status] ?? r.status}</p>)}</div>
  );
}
export function MasterReminder() {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["md", "license", s.tenantId], enabled: s.role === "owner", retry: 0, staleTime: 5 * 60_000, queryFn: () => api<V>(s, "md.license", {}) });
  const r = q.data?.reminder; if (!r) return null; return <Link to="/master" className={`card text-sm ${r.level === "soon" ? "text-amber-300" : "text-red-300"}`} role="status">{r.text} <u>Voir</u></Link>;
}
