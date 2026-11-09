import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { METHOD_LABEL } from "@/domain/pay";
import { useSubscription } from "./subscription";

type Totals = { float: number; sales: { count: number; total: number; byMethod: Record<string, number> }; refunds: { count: number; total: number; byMethod: Record<string, number> }; movements: { out: number; in: number; pending: number }; theoreticalCash: number; nonCash: Record<string, number> };
type Sess = { id: string; userId: string; seller?: string; status: string; openedAt: string; closedAt: string | null; openingFloat: number; countedCash: number | null; theoreticalCash: number | null; variance: number | null; note: string; totals?: Totals | null };
type Move = { id: string; kind: string; amount: number; reason: string; status: string; at: string };
type Current = { session: Sess | null; totals?: Totals; movements?: Move[]; required: boolean };
const dt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const num = (v: string) => Number(v.replace(/\s/g, ""));
const STATUS: Record<string, string> = { authorized: "Autorisée", pending: "En attente", rejected: "Refusée" };
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);

/** Pilotage de caisse : ouverture (fond initial), mouvements autorisés, totaux par moyen de paiement, solde théorique, comptage et écart à la fermeture, historique et rapport par vendeur. */
export function CaissePage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const allowed = planAllows(useSubscription().data?.entitlement.plan.id, "smartPos"); const manager = s.role === "owner" || s.role === "manager";
  const cur = useQuery({ queryKey: ["cash-current", s.shopId], enabled: allowed, refetchInterval: 30_000, retry: 1, queryFn: () => api<Current>(s, "cash.current") });
  const [tab, setTab] = useState<"now" | "history" | "sellers">("now"); const [open, setOpen] = useState<Sess | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["cash-current"] }).then(() => qc.invalidateQueries({ queryKey: ["cash-sessions"] }));
  if (!allowed) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Caisse</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Business</span><span className="text-white/60">Sessions de caisse, écarts, sorties autorisées, remboursements et historique.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div></div>;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Caisse</h1>
      <nav aria-label="Sections" className="scroll-x">{([["now", "Session"], ["history", "Historique"], ...(manager ? [["sellers", "Par vendeur"]] : [])] as [string, string][]).map(([k, l]) => <button key={k} className="chip" aria-current={tab === k} onClick={() => setTab(k as never)}>{l}</button>)}</nav>
      {tab === "now" && <>
        {(!navigator.onLine || cur.error) && <div className="card border border-amber-400/40 text-sm flex gap-2" role="alert"><WifiOff size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>{navigator.onLine ? `Impossible de charger : ${(cur.error as Error).message}` : "Hors ligne : la gestion de caisse a besoin d'une connexion."} <button className="underline text-[var(--gold)]" onClick={() => void cur.refetch()}>Réessayer</button></span></div>}
        {cur.isLoading && <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />}
        {cur.data && !cur.data.session && <OpenForm onDone={refresh} />}
        {cur.data?.session && cur.data.totals && <Active c={cur.data as Required<Current>} manager={manager} onChanged={refresh} />}
        {cur.data && s.role === "owner" && <Required required={cur.data.required} onDone={refresh} />}
      </>}
      {tab === "history" && <History manager={manager} onOpen={setOpen} />}
      {tab === "sellers" && manager && <Sellers />}
      {open && <Sheet title={`Session du ${dt(open.openedAt)}`} onClose={() => setOpen(null)} back><Detail sess={open} /></Sheet>}
    </div>
  );
}

function Required({ required, onDone }: { required: boolean; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const m = useMutation({ mutationFn: () => api(s, "shop.save", { cashRequired: !required }), onSuccess: onDone });
  return <div className="card flex items-center justify-between gap-2 text-sm"><span><b>Session obligatoire pour vendre</b><br /><span className="text-xs text-white/50">{required ? "Activée : aucune vente sans caisse ouverte." : "Désactivée : on peut vendre sans ouvrir la caisse."}</span></span><button className="btn-ghost !py-2" disabled={m.isPending} onClick={() => m.mutate()}>{required ? "Désactiver" : "Activer"}</button>{m.error && <Err e={m.error} />}</div>;
}
function OpenForm({ onDone }: { onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState(""); const [note, setNote] = useState(""); const requestId = useState(() => crypto.randomUUID())[0];
  const m = useMutation({ mutationFn: () => api(s, "cash.open", { openingFloat: num(f), note, requestId }), onSuccess: onDone });
  const ok = f.trim() !== "" && Number.isInteger(num(f)) && num(f) >= 0;
  return <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}><b>Ouvrir la caisse</b><p className="text-xs text-white/50">Comptez les espèces présentes dans le tiroir : c'est le fond initial.</p>
    <input className="input" inputMode="numeric" aria-label="Fond initial" placeholder="Fond initial (FCFA)" value={f} onChange={(e) => setF(e.target.value)} /><input className="input" aria-label="Note" maxLength={200} placeholder="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
    <Err e={m.error} /><button className="btn" disabled={!ok || m.isPending}>{m.isPending ? "Ouverture…" : "Ouvrir la caisse"}</button></form>;
}
function Totals({ t }: { t: Totals }) {
  const row = (l: string, v: string, tone = "") => <div className="flex justify-between text-sm py-1 border-b border-[var(--line)]"><span className="text-white/60">{l}</span><b className={tone}>{v}</b></div>;
  return <div className="card flex flex-col">{row("Fond initial", formatFcfa(t.float))}{Object.entries(t.sales.byMethod).map(([m, a]) => row(`Encaissé ${METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m}`, formatFcfa(a)))}{row(`Ventes (${t.sales.count})`, formatFcfa(t.sales.total))}
    {!!t.refunds.count && row(`Remboursements (${t.refunds.count})`, `−${formatFcfa(t.refunds.total)}`, "text-amber-300")}{row("Sorties autorisées", `−${formatFcfa(t.movements.out)}`)}{row("Entrées autorisées", formatFcfa(t.movements.in))}
    <div className="flex justify-between pt-2 font-semibold"><span>Solde théorique en espèces</span><span className="gold-text">{formatFcfa(t.theoreticalCash)}</span></div><p className="text-[11px] text-white/40 pt-1">Fond + espèces encaissées (monnaie rendue exclue) − remboursements en espèces − sorties + entrées. Les autres moyens ({Object.entries(t.nonCash).map(([m, a]) => `${METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m} ${formatFcfa(a)}`).join(", ") || "aucun"}) ne se comptent pas dans le tiroir.</p></div>;
}
function Active({ c, manager, onChanged }: { c: Required<Current>; manager: boolean; onChanged: () => void }) {
  const { session } = useSession(); const s = session!; const [kind, setKind] = useState<"out" | "in">("out"); const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [counted, setCounted] = useState(""); const [ask, setAsk] = useState(false); const [done, setDone] = useState<{ variance: number; theoreticalCash: number } | null>(null);
  const mv = useMutation({ mutationFn: () => api(s, "cash.move", { kind, amount: num(amount), reason, requestId: crypto.randomUUID() }), onSuccess: () => { setAmount(""); setReason(""); onChanged(); } });
  const auth = useMutation({ mutationFn: (v: { id: string; approve: boolean }) => api(s, "cash.authorize", v), onSuccess: onChanged });
  const close = useMutation({ mutationFn: () => api<{ variance: number; theoreticalCash: number }>(s, "cash.close", { sessionId: c.session!.id, counted: num(counted) }), onSuccess: (r) => { setAsk(false); setDone(r); onChanged(); }, onError: () => setAsk(false) });
  const t = c.totals; const cn = counted.trim() !== "" && Number.isInteger(num(counted)) && num(counted) >= 0 ? num(counted) : null; const variance = cn === null ? null : cn - t.theoreticalCash;
  return <>
    <div className="card text-sm flex justify-between"><span><b className="text-emerald-300">● Caisse ouverte</b><br /><span className="text-white/50 text-xs">depuis {dt(c.session!.openedAt)}</span></span><span className="text-right text-white/60 text-xs">Fond<br /><b className="text-white text-sm">{formatFcfa(c.session!.openingFloat)}</b></span></div>
    <Totals t={t} />
    <section className="card flex flex-col gap-2" aria-label="Mouvements de caisse"><b className="text-sm">Sorties et entrées d'espèces</b>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); mv.mutate(); }}>
        <div className="flex gap-2">{(["out", "in"] as const).map((k) => <button key={k} type="button" className="chip" aria-current={kind === k} onClick={() => setKind(k)}>{k === "out" ? "Sortie" : "Entrée"}</button>)}</div>
        <input className="input" inputMode="numeric" aria-label="Montant du mouvement" placeholder="Montant (FCFA)" value={amount} onChange={(e) => setAmount(e.target.value)} /><input className="input" aria-label="Motif" maxLength={200} placeholder="Motif obligatoire (ex. achat de sacs)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Err e={mv.error} /><button className="btn-ghost" disabled={mv.isPending || !(num(amount) > 0) || reason.trim().length < 3}>{mv.isPending ? "Enregistrement…" : manager ? "Enregistrer (autorisé)" : "Enregistrer (à faire autoriser)"}</button></form>
      {c.movements.map((m) => <div key={m.id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{m.kind === "out" ? "Sortie" : "Entrée"} · {m.reason}<span className="text-xs text-white/50 block">{dt(m.at)} · {STATUS[m.status] ?? m.status}</span></span><span className="text-right shrink-0"><b>{m.kind === "out" ? "−" : "+"}{formatFcfa(m.amount)}</b>
        {manager && m.status === "pending" && <span className="flex gap-1 pt-1"><button className="btn !py-1 !px-2 text-xs" disabled={auth.isPending} onClick={() => auth.mutate({ id: m.id, approve: true })}>Autoriser</button><button className="btn-ghost !py-1 !px-2 text-xs" disabled={auth.isPending} onClick={() => auth.mutate({ id: m.id, approve: false })}>Refuser</button></span>}</span></div>)}
      {!c.movements.length && <p className="text-xs text-white/50">Aucun mouvement.</p>}<Err e={auth.error} /></section>
    <section className="card flex flex-col gap-2" aria-label="Fermeture"><b className="text-sm">Fermer la caisse</b>
      {t.movements.pending > 0 && <p className="text-xs text-amber-300 flex gap-1"><AlertTriangle size={14} />{t.movements.pending} mouvement(s) en attente d'autorisation : à traiter avant la fermeture.</p>}
      <input className="input" inputMode="numeric" aria-label="Montant compté" placeholder="Espèces comptées dans le tiroir (FCFA)" value={counted} onChange={(e) => setCounted(e.target.value)} />
      {variance !== null && <p className={`text-sm ${variance === 0 ? "text-emerald-300" : "text-amber-300"}`} role="status">{variance === 0 ? "Aucun écart" : variance > 0 ? `Excédent de ${formatFcfa(variance)}` : `Manque de ${formatFcfa(-variance)}`} (théorique {formatFcfa(t.theoreticalCash)})</p>}
      <Err e={close.error} /><button className="btn" disabled={cn === null || close.isPending || t.movements.pending > 0} onClick={() => setAsk(true)}>Fermer la caisse</button>
      {done && <p className="text-sm text-emerald-300" role="status">Caisse fermée. Écart : {done.variance === 0 ? "aucun" : formatFcfa(done.variance)}.</p>}</section>
    {ask && <Confirm text={`Fermer la caisse avec ${formatFcfa(cn ?? 0)} comptés ? Solde théorique ${formatFcfa(t.theoreticalCash)}, écart ${formatFcfa(variance ?? 0)}. La session ne pourra plus être modifiée.`} confirmLabel="Fermer" onNo={() => setAsk(false)} onYes={() => close.mutate()} />}
  </>;
}
function Detail({ sess }: { sess: Sess }) {
  const row = (k: string, v: string) => <div className="flex justify-between text-sm py-1 border-b border-[var(--line)]"><span className="text-white/50">{k}</span><span>{v}</span></div>;
  return <><div className="card">{sess.seller && row("Vendeur", sess.seller)}{row("Ouverte", dt(sess.openedAt))}{row("Fermée", sess.closedAt ? dt(sess.closedAt) : "En cours")}{row("Fond initial", formatFcfa(sess.openingFloat))}{sess.theoreticalCash !== null && row("Solde théorique", formatFcfa(sess.theoreticalCash))}{sess.countedCash !== null && row("Compté", formatFcfa(sess.countedCash))}{sess.variance !== null && row("Écart", sess.variance === 0 ? "Aucun" : `${sess.variance > 0 ? "+" : ""}${formatFcfa(sess.variance)}`)}{sess.note && row("Note", sess.note)}</div>{sess.totals && <Totals t={sess.totals} />}</>;
}
function History({ manager, onOpen }: { manager: boolean; onOpen: (s: Sess) => void }) {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["cash-sessions", s.shopId], retry: 1, queryFn: () => api<{ sessions: Sess[] }>(s, "cash.sessions", {}) });
  return <div className="flex flex-col gap-2"><p className="text-xs text-white/50">{manager ? "Toutes les sessions de la boutique (30 derniers jours)." : "Vos sessions (30 derniers jours)."}</p>{q.isLoading && <div className="card h-20 animate-pulse bg-white/5" />}<Err e={q.error} />
    {q.data && !q.data.sessions.length && <p className="text-center text-white/50 text-sm py-6">Aucune session sur la période.</p>}
    {q.data?.sessions.map((x) => <button key={x.id} className="card text-left flex justify-between gap-2" onClick={() => onOpen(x)}><span><b>{dt(x.openedAt)}</b><span className="text-xs text-white/50 block">{x.seller ?? ""} · {x.status === "open" ? "Ouverte" : `fermée ${x.closedAt ? dt(x.closedAt) : ""}`}</span></span><span className="text-right text-sm">{formatFcfa(x.totals?.sales.total ?? 0)}<span className={`text-xs block ${x.variance ? "text-amber-300" : "text-white/50"}`}>{x.variance === null ? "en cours" : x.variance === 0 ? "aucun écart" : `écart ${x.variance > 0 ? "+" : ""}${formatFcfa(x.variance)}`}</span></span></button>)}</div>;
}
function Sellers() {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["cash-sellers", s.shopId], retry: 1, queryFn: () => api<{ sellers: { userId: string; seller: string; sessions: number; closed: number; sales: number; salesTotal: number; refunds: number; variance: number }[]; note: string }>(s, "cash.sellers", {}) });
  return <div className="flex flex-col gap-2">{q.isLoading && <div className="card h-20 animate-pulse bg-white/5" />}<Err e={q.error} />{q.data && !q.data.sellers.length && <p className="text-center text-white/50 text-sm py-6">Aucune session sur la période.</p>}
    {q.data?.sellers.map((x) => <div key={x.userId} className="card flex justify-between gap-2 text-sm"><span><b>{x.seller}</b><span className="text-xs text-white/50 block">{x.sessions} session(s) · {x.sales} vente(s)</span></span><span className="text-right">{formatFcfa(x.salesTotal)}<span className={`text-xs block ${x.variance ? "text-amber-300" : "text-white/50"}`}>écart cumulé {x.variance > 0 ? "+" : ""}{formatFcfa(x.variance)}{x.refunds ? ` · remb. ${formatFcfa(x.refunds)}` : ""}</span></span></div>)}{q.data && <p className="text-[11px] text-white/40">{q.data.note}</p>}</div>;
}
