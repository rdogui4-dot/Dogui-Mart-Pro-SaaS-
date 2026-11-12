/** MASTER DOGUI — étape 1 : état de la licence (essai, période payante, consultation). Aucune analyse IA à ce stade. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { Sheet } from "@/components/ui";
import { Profil } from "@/routes/master-profile";
import { Recos } from "@/routes/master-reco";
import { Assistant } from "@/routes/master-chat";
import { PRIO_LABEL, type Report, type Prio } from "@/domain/master-report";

type Rem = { level: "soon" | "urgent" | "last" | "expired"; text: string };
type V = { reminder: Rem | null; state: "none" | "trial" | "active" | "grace" | "expired"; phase: string; endsAt: string | null; daysLeft: number | null; canAnalyze: boolean; consultOnly: boolean; trialUsed: boolean; canStartTrial: boolean; isOwner: boolean; trialDays: number; billingStartsAt: string | null; nextDue: { at: string; amount: number; label: string } | null; prices: { first: number; firstMonths: number; renew: number }; consequence: string; history: { id: string; kind: string; count?: number; amount: number; from: string; to: string; at: string; note: string }[]; notes: string[] };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const LABEL: Record<V["state"], [string, string]> = { none: ["Non démarrée", "text-white/60"], trial: ["Essai gratuit en cours", "text-emerald-300"], active: ["Licence active", "text-emerald-300"], grace: ["Délai de grâce", "text-amber-300"], expired: ["Expirée — mode consultation", "text-amber-300"] };
function Licence() {
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

const PRIO_TONE: Record<Prio, string> = { critical: "text-red-300", high: "text-amber-300", medium: "text-amber-200", opportunity: "text-emerald-300", info: "text-white/60" };
type Full = { id: string; sessionId?: string; type: string; businessDate: string; status: string; statusLabel: string; version: number; generatedAt: string; error: string; replacedBy: string; report: Report | null; missing: { section: string; reason: string }[] };
const fmtV = (v: string | number | null) => (v === null ? "—" : typeof v === "number" ? v.toLocaleString("fr-FR") : v);
export function ReportView({ r }: { r: Full }) {
  const rep = r.report; if (!rep) return <p className="text-sm text-red-300">{r.status === "failed" ? `Génération échouée : ${r.error}` : "Rapport en cours de génération…"}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>{rep.title}</b><b className={r.status === "ready" ? "text-emerald-300" : r.status === "partial" ? "text-amber-300" : "text-white/60"}>{r.statusLabel}</b></div><p className="text-xs text-white/50">{rep.scope} · {rep.businessDate} · version {r.version}{r.generatedAt ? ` · généré le ${new Date(r.generatedAt).toLocaleString("fr-FR")}` : ""}</p><p className="text-xs text-white/60">{rep.confidence}</p></div>
      {rep.alerts.map((a, i) => <p key={i} className={`card text-sm ${PRIO_TONE[a.prio]}`}><b>{PRIO_LABEL[a.prio]} · </b>{a.text}<span className="block text-[10px] text-white/40">Source : {a.source}</span></p>)}
      {rep.sections.map((s) => <div key={s.id} className="card text-sm flex flex-col gap-1"><b>{s.title}</b>{s.available ? s.items.map((it, i) => <p key={i} className="flex justify-between gap-2 text-xs"><span className="text-white/70">{it.label}{it.note ? <i className="text-white/40"> · {it.note}</i> : null}</span><b>{fmtV(it.value)}</b></p>) : <p className="text-xs text-amber-300">Non disponible : {s.reason}</p>}<span className="text-[10px] text-white/40">Source : {s.source}</span></div>)}
      {rep.recommendations.length > 0 && <div className="card text-sm flex flex-col gap-1"><b>Recommandations</b>{rep.recommendations.map((x, i) => <p key={i} className="text-xs"><b className={PRIO_TONE[x.prio]}>{PRIO_LABEL[x.prio]}</b> · {x.text}<span className="block text-[10px] text-white/40">Motif : {x.reason} · Source : {x.source} · {x.kind === "fact" ? "fait constaté" : "estimation"} · {x.status}</span></p>)}</div>}
      {rep.missing.length > 0 && <div className="card text-xs text-amber-300 flex flex-col gap-1"><b>Données manquantes</b>{rep.missing.map((m, i) => <p key={i}>• {m.section} : {m.reason}</p>)}</div>}
      <div className="card text-[11px] text-white/50 flex flex-col gap-1"><b className="text-white/70">Méthode et limites</b><p>{rep.method}</p>{rep.limits.map((l, i) => <p key={i}>• {l}</p>)}</div>
    </div>
  );
}
type Row = { id: string; type: string; businessDate: string; status: string; statusLabel: string; version: number; generatedAt: string; title: string; alerts: number; missing: number };
function Rapports() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["md", "reports", s.shopId], retry: 1, queryFn: () => api<{ reports: Row[] }>(s, "md.reports", {}) }); const one = useQuery({ queryKey: ["md", "report", sel], enabled: !!sel, queryFn: () => api<Full>(s, "md.report", { id: sel }) });
  const regen = useMutation({ mutationFn: (r: Full) => (r.type === "opening" ? api<Full>(s, "md.opening", { regenerate: true }) : api<Full>(s, "md.closing", { sessionId: r.sessionId, regenerate: true })), onSuccess: () => void qc.invalidateQueries({ queryKey: ["md"] }) });
  if (q.error) return <p className="text-red-400 text-sm" role="alert">{(q.error as Error).message}</p>;
  return (
    <div className="flex flex-col gap-2"><p className="text-xs text-white/50">Briefings d'ouverture et rapports de clôture. Après expiration de la licence, l'historique reste consultable.</p>
      {q.data?.reports.length === 0 && <p className="text-xs text-white/50">Aucun rapport pour l'instant. Le rapport de clôture se crée automatiquement quand une session de caisse est clôturée ; le briefing d'ouverture, à l'ouverture de l'application quand aucune session n'est ouverte.</p>}
      {q.data?.reports.map((r) => <button key={r.id} className="card text-left text-sm flex justify-between" onClick={() => setSel(r.id)}><span><b>{r.type === "opening" ? "Briefing d'ouverture" : "Rapport de clôture"}</b><span className="block text-xs text-white/50">{r.businessDate} · v{r.version}{r.alerts ? ` · ${r.alerts} alerte(s)` : ""}{r.missing ? ` · ${r.missing} donnée(s) manquante(s)` : ""}</span></span><span className={r.status === "ready" ? "text-emerald-300" : r.status === "partial" ? "text-amber-300" : "text-white/50"}>{r.statusLabel}</span></button>)}
      {sel && <Sheet title="Rapport" onClose={() => setSel(null)} back><div className="p-3">{one.error ? <p className="text-red-400 text-sm">{(one.error as Error).message}</p> : one.data ? <><ReportView r={one.data} />{one.data.status !== "superseded" && <button className="btn-ghost mt-2" disabled={regen.isPending} onClick={() => regen.mutate(one.data!)}>{one.data.type === "opening" ? "Régénérer le briefing du jour" : "Régénérer ce rapport (nouvelle version)"}</button>}</> : <div className="card h-24 animate-pulse bg-white/5" />}</div></Sheet>}
    </div>
  );
}
export function MasterPage() {
  const { session } = useSession(); const s = session!; const [tab, setTab] = useState<"lic" | "rep" | "pro" | "rec" | "chat">("lic"); const mgr = s.role === "owner" || s.role === "manager";
  return (
    <div className="flex flex-col gap-3"><div className="flex gap-2" role="tablist" aria-label="MASTER DOGUI"><button role="tab" className="chip" aria-current={tab === "lic"} onClick={() => setTab("lic")}>Licence</button>{mgr && <button role="tab" className="chip" aria-current={tab === "rep"} onClick={() => setTab("rep")}>Rapports</button>}{mgr && <button role="tab" className="chip" aria-current={tab === "pro"} onClick={() => setTab("pro")}>Profil</button>}{mgr && <button role="tab" className="chip" aria-current={tab === "rec"} onClick={() => setTab("rec")}>Recommandations</button>}{mgr && <button role="tab" className="chip" aria-current={tab === "chat"} onClick={() => setTab("chat")}>Assistant</button>}</div>{tab === "lic" ? <Licence /> : tab === "rep" ? <Rapports /> : tab === "rec" ? <Recos /> : tab === "chat" ? <Assistant /> : <Profil />}</div>
  );
}
type OpenR = { skipped: string | null; message?: string } & Partial<Full>;
/** Briefing d'ouverture affiché à l'accueil (propriétaire / gérant). Le serveur décide : rien n'est affiché si une session est ouverte ou sans licence valide. */
export function MasterBriefing() {
  const { session } = useSession(); const s = session!; const [open, setOpen] = useState(false); const mgr = s.role === "owner" || s.role === "manager";
  const q = useQuery({ queryKey: ["md", "opening", s.shopId], enabled: mgr, retry: 0, staleTime: 30 * 60_000, queryFn: () => api<OpenR>(s, "md.opening", {}) });
  const r = q.data; if (!r || r.skipped || !r.report) return null; const rep = r.report; const top = rep.alerts.slice(0, 3);
  return (
    <div className="card flex flex-col gap-2 text-sm" aria-label="Briefing d'ouverture"><div className="flex justify-between"><b>Briefing d'ouverture</b><span className={r.status === "partial" ? "text-amber-300 text-xs" : "text-emerald-300 text-xs"}>{r.statusLabel}</span></div>
      {top.map((a, i) => <p key={i} className={`text-xs ${PRIO_TONE[a.prio]}`}><b>{PRIO_LABEL[a.prio]} · </b>{a.text}</p>)}
      <button className="btn-ghost self-start" onClick={() => setOpen(true)}>Voir le briefing complet</button>
      {open && <Sheet title="Briefing d'ouverture" onClose={() => setOpen(false)} back><div className="p-3"><ReportView r={r as Full} /></div></Sheet>}</div>
  );
}

/** Page de retour après paiement (adresse à renseigner comme redirection chez le prestataire, SANS jeton). Elle ne confirme rien par elle-même : elle affiche l'état réel de la demande de paiement et de la licence, relu toutes les 10 secondes pendant quelques minutes. */
export function MerciPage() {
  const { session } = useSession(); const s = session!; const [n, setN] = useState(0);
  const list = useQuery({ queryKey: ["md", "pay", s.tenantId], retry: 1, refetchInterval: (qq) => (n < 18 && qq.state.data?.requests.some((r) => r.status === "awaiting") ? 10_000 : false), queryFn: async () => { setN((x) => x + 1); return api<{ requests: Req[] }>(s, "md.pay.list", {}); } });
  const lic = useQuery({ queryKey: ["md", "license", s.tenantId], retry: 1, refetchInterval: (qq) => (n < 18 && qq.state.data?.state !== "active" ? 10_000 : false), queryFn: () => api<V>(s, "md.license", {}) });
  const last = list.data?.requests[0]; const paid = last?.status === "paid";
  return (
    <div className="flex flex-col gap-3"><div><h1 className="text-lg font-semibold">Merci pour votre paiement</h1><p className="text-xs text-white/50">Cette page affiche l'état réel de votre paiement MASTER DOGUI ; elle ne l'active pas à elle seule.</p></div>
      <div className="card text-sm flex flex-col gap-1" role="status" aria-live="polite">
        {!last && !list.isLoading && <p>Aucune demande de paiement trouvée. Ouvrez MASTER DOGUI › Licence et choisissez « Préparer mon paiement ».</p>}
        {last && paid && <p className="text-emerald-300">Paiement {last.reference} confirmé : votre licence est active{lic.data?.endsAt ? ` jusqu'au ${fmt(lic.data.endsAt)}` : ""}.</p>}
        {last && last.status === "awaiting" && <><p className="text-amber-300">Paiement {last.reference} ({formatFcfa(last.amount)}) en attente de confirmation.</p><p className="text-xs text-white/60">La confirmation peut prendre quelques minutes. Si elle n'apparaît pas, l'équipe DOGUI MART PRO la vérifie manuellement à partir de votre reçu : conservez-le et indiquez la référence {last.reference}.</p></>}
        {last && last.status === "cancelled" && <p className="text-white/70">La dernière demande ({last.reference}) a été remplacée par une plus récente.</p>}
        {list.error && <p className="text-red-400" role="alert">{(list.error as Error).message}</p>}</div>
      <a className="btn self-start" href={`${import.meta.env.BASE_URL}master`}>Aller à MASTER DOGUI</a></div>
  );
}
