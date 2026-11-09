import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { list } from "@/lib/data";
import { useSession } from "@/lib/session";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { Scanner } from "@/components/Scanner";
import { useSubscription } from "./subscription";

type Rights = { rights: string[]; labels: Record<string, string> };
type Appr = { id: string; kind: string; status: string; amount: number; requestedBy: string; requestedAt: string; decidedBy: string; note: string; details: { alertes?: string[]; total?: number } };
type Sess = { id: string; userId: string; seller?: string; register?: string; status: string; openedAt: string; closedAt: string | null; countedCash: number | null; theoreticalCash: number | null; variance: number | null; varianceStatus?: string };
type Staff = { $id: string; userId: string; name: string; role: string; shopIds?: string; active?: boolean; posRights?: string };
const dt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const num = (v: string) => Number(v.replace(/\s/g, ""));
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);
const KIND: Record<string, string> = { margin: "Marge sous le seuil", discount: "Remise manuelle", refund: "Remboursement", cancel: "Annulation" };
const STATE: Record<string, string> = { pending: "En attente", approved: "Approuvée", rejected: "Refusée", used: "Utilisée", expired: "Expirée" };

/** Caisse Pro : approbations hiérarchiques, écarts à valider, transferts de session, performances, intelligence commerciale, droits, journal financier et vérification des tickets. Tout vient du serveur. */
export function CaisseProPage() {
  const { session } = useSession(); const s = session!; const allowed = planAllows(useSubscription().data?.entitlement.plan.id, "smartPosPro");
  const rq = useQuery({ queryKey: ["my-rights", s.shopId], enabled: allowed, queryFn: () => api<Rights>(s, "my.rights") });
  const r = rq.data?.rights ?? []; const approve = r.includes("approve"); const transfer = r.includes("transfer"); const owner = s.role === "owner";
  const tabs: [string, string][] = [["appr", "Approbations"], ...(approve ? ([["var", "Écarts"], ["perf", "Performance"], ["intel", "Intelligence"], ["ledger", "Journal"]] as [string, string][]) : []), ...(transfer ? ([["hand", "Transfert"]] as [string, string][]) : []), ...(owner ? ([["rights", "Droits"]] as [string, string][]) : []), ["verify", "Vérifier un ticket"]];
  const [tab, setTab] = useState("appr");
  if (!allowed) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Caisse Pro</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Pro</span><span className="text-white/60">Suggestions, approbations hiérarchiques, multi-caisses, journal financier et tickets vérifiables.</span></div></div>;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Caisse Pro</h1>
      <nav aria-label="Sections" className="scroll-x">{tabs.map(([k, l]) => <button key={k} className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {rq.error && <Err e={rq.error} />}
      {tab === "appr" && <Approvals canDecide={approve} />}
      {tab === "var" && approve && <Variances />}
      {tab === "perf" && approve && <Performance />}
      {tab === "intel" && approve && <Intelligence />}
      {tab === "ledger" && approve && <Ledger />}
      {tab === "hand" && transfer && <Handover />}
      {tab === "rights" && owner && <RightsEditor labels={rq.data?.labels ?? {}} />}
      {tab === "verify" && <Verify />}
    </div>
  );
}

function Approvals({ canDecide }: { canDecide: boolean }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useQuery({ queryKey: ["approvals", s.shopId], refetchInterval: 5000, queryFn: () => api<{ approvals: Appr[] }>(s, "approval.list", {}) });
  const m = useMutation({ mutationFn: (v: { id: string; approve: boolean; note?: string }) => api(s, "approval.decide", v), onSuccess: () => void qc.invalidateQueries({ queryKey: ["approvals"] }) });
  return <div className="flex flex-col gap-2"><p className="text-xs text-white/50">{canDecide ? "Demandes des vendeurs de la boutique (valables 15 minutes, une seule utilisation, pour le panier concerné)." : "Vos demandes et leur issue."}</p>
    {q.data && !q.data.approvals.length && <p className="text-center text-white/50 text-sm py-6">Aucune demande.</p>}<Err e={q.error ?? m.error} />
    {q.data?.approvals.map((a) => <div key={a.id} className="card flex flex-col gap-1 text-sm"><div className="flex justify-between gap-2"><b>{KIND[a.kind] ?? a.kind}</b><span className={a.status === "pending" ? "text-amber-300" : a.status === "approved" ? "text-emerald-300" : "text-white/50"}>{STATE[a.status] ?? a.status}</span></div>
      <span className="text-xs text-white/50">{a.requestedBy} · {dt(a.requestedAt)}{a.amount ? ` · ${formatFcfa(a.amount)}` : ""}{a.decidedBy ? ` · décidée par ${a.decidedBy}` : ""}</span>{a.details.alertes?.map((x) => <span key={x} className="text-xs text-amber-300">• {x}</span>)}
      {canDecide && a.status === "pending" && <span className="flex gap-2 pt-1"><button className="btn !py-1 !px-3 text-xs" disabled={m.isPending} onClick={() => m.mutate({ id: a.id, approve: true })}>Approuver</button><button className="btn-ghost !py-1 !px-3 text-xs" disabled={m.isPending} onClick={() => m.mutate({ id: a.id, approve: false })}>Refuser</button></span>}</div>)}</div>;
}

function Variances() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useQuery({ queryKey: ["var-sessions", s.shopId], queryFn: () => api<{ sessions: Sess[] }>(s, "cash.sessions", {}) });
  const [note, setNote] = useState(""); const [fix, setFix] = useState<{ id: string; v: string; why: string } | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ["var-sessions"] });
  const m = useMutation({ mutationFn: (v: { sessionId: string; approve: boolean }) => api(s, "cash.validate", { ...v, note }), onSuccess: () => { setNote(""); done(); } });
  const c = useMutation({ mutationFn: () => api(s, "cash.correct", { sessionId: fix!.id, counted: num(fix!.v), reason: fix!.why }), onSuccess: () => { setFix(null); done(); } });
  const rows = (q.data?.sessions ?? []).filter((x) => x.status === "closed" && (x.variance ?? 0) !== 0);
  return <div className="flex flex-col gap-2"><p className="text-xs text-white/50">Sessions fermées avec écart. Vous ne pouvez pas valider votre propre écart.</p>{!q.isLoading && !rows.length && <p className="text-center text-white/50 text-sm py-6">Aucun écart de caisse sur 30 jours.</p>}
    <input className="input" aria-label="Note de décision" placeholder="Note (obligatoire pour refuser)" value={note} onChange={(e) => setNote(e.target.value)} /><Err e={m.error ?? c.error ?? q.error} />
    {rows.map((x) => <div key={x.id} className="card flex flex-col gap-1 text-sm"><div className="flex justify-between"><b>{x.seller} {x.register ? `· ${x.register}` : ""}</b><span className={(x.variance ?? 0) < 0 ? "text-red-300" : "text-amber-300"}>{(x.variance ?? 0) > 0 ? "+" : ""}{formatFcfa(x.variance ?? 0)}</span></div>
      <span className="text-xs text-white/50">{dt(x.openedAt)} · compté {formatFcfa(x.countedCash ?? 0)} / théorique {formatFcfa(x.theoreticalCash ?? 0)} · {x.varianceStatus === "pending" ? "à valider" : x.varianceStatus === "validated" ? "validé" : x.varianceStatus === "rejected" ? "refusé" : x.varianceStatus}</span>
      <span className="flex gap-2 flex-wrap pt-1">{x.varianceStatus === "pending" && <><button className="btn !py-1 !px-3 text-xs" disabled={m.isPending} onClick={() => m.mutate({ sessionId: x.id, approve: true })}>Valider</button><button className="btn-ghost !py-1 !px-3 text-xs" disabled={m.isPending} onClick={() => m.mutate({ sessionId: x.id, approve: false })}>Refuser</button></>}<button className="btn-ghost !py-1 !px-3 text-xs" onClick={() => setFix({ id: x.id, v: "", why: "" })}>Corriger le comptage</button></span></div>)}
    {fix && <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); c.mutate(); }}><b className="text-sm">Corriger le montant compté</b><input className="input" inputMode="numeric" aria-label="Nouveau montant compté" placeholder="Nouveau montant (FCFA)" value={fix.v} onChange={(e) => setFix({ ...fix, v: e.target.value })} /><input className="input" aria-label="Motif de la correction" maxLength={200} placeholder="Motif (5 caractères min.)" value={fix.why} onChange={(e) => setFix({ ...fix, why: e.target.value })} /><div className="flex gap-2"><button className="btn" disabled={c.isPending || !(num(fix.v) >= 0) || fix.why.trim().length < 5}>Corriger</button><button type="button" className="btn-ghost" onClick={() => setFix(null)}>Annuler</button></div><p className="text-[11px] text-white/40">L'ancien montant reste dans le journal financier.</p></form>}</div>;
}

function Performance() {
  const { session } = useSession(); const s = session!; const q = useQuery({ queryKey: ["perf", s.shopId], queryFn: () => api<{ shops: { shopId: string; shop: string; sales: number; total: number; avgBasket: number; refunds: number; refundRate: number; variance: number }[]; sellers: { userId: string; seller: string; shop: string; count: number; total: number; avgBasket: number; refunds: number }[]; registers: { register: string; shop: string; sessions: number; salesTotal: number; variance: number; pendingVariances: number }[]; note: string }>(s, "cash.performance", {}) });
  const D = q.data;
  return <div className="flex flex-col gap-3"><Err e={q.error} />{q.isLoading && <div className="card h-20 animate-pulse bg-white/5" />}
    {D && <><section className="flex flex-col gap-2"><b className="text-sm">Boutiques (30 jours)</b>{D.shops.map((x) => <div key={x.shopId} className="card flex justify-between text-sm"><span><b>{x.shop}</b><span className="block text-xs text-white/50">{x.sales} ventes · panier {formatFcfa(x.avgBasket)} · remboursé {x.refundRate} %</span></span><b className="gold-text">{formatFcfa(x.total)}</b></div>)}</section>
      <section className="flex flex-col gap-2"><b className="text-sm">Vendeurs</b>{D.sellers.map((x) => <div key={x.userId + x.shop} className="card flex justify-between text-sm"><span><b>{x.seller || "—"}</b><span className="block text-xs text-white/50">{x.shop} · {x.count} ventes · panier {formatFcfa(x.avgBasket)}{x.refunds ? ` · remboursé ${formatFcfa(x.refunds)}` : ""}</span></span><b>{formatFcfa(x.total)}</b></div>)}</section>
      <section className="flex flex-col gap-2"><b className="text-sm">Caisses</b>{!D.registers.length && <p className="text-xs text-white/50">Aucune session sur la période.</p>}{D.registers.map((x) => <div key={x.register + x.shop} className="card flex justify-between text-sm"><span><b>{x.register}</b><span className="block text-xs text-white/50">{x.shop} · {x.sessions} session(s) · écart cumulé {formatFcfa(x.variance)}{x.pendingVariances ? ` · ${x.pendingVariances} à valider` : ""}</span></span><b>{formatFcfa(x.salesTotal)}</b></div>)}</section><p className="text-[11px] text-white/40">{D.note}</p></>}</div>;
}

type Ins = { days: number; totals: { sales: number; revenue: number; avgBasket: number; discount: number; discountRate: number; estimatedMargin: number; marginCoveragePct: number; perDay: number }; topItems: { productId: string; name: string; qty: number; revenue: number }[]; associations: { a: string; b: string; n: number }[]; busyHours: { hour: number; sales: number }[]; sellers: { userId: string; seller: string; count: number; total: number; avgBasket: number; discountRate: number; refunds: number; cancels: number }[]; anomalies: { level: string; code: string; message: string; basis: string }[]; forecast: { method: string; limits: string; days: { day: string; expected: number; low: number; high: number; basedOn: number; reliability: string }[] }; recommendations: { text: string; basis: string }[]; basedOn: { sales: number; days: number }; note: string };
function Intelligence() {
  const { session } = useSession(); const s = session!; const [days, setDays] = useState(30); const q = useQuery({ queryKey: ["insights", s.shopId, days], queryFn: () => api<Ins>(s, "pos.insights", { days }) }); const D = q.data; const maxH = Math.max(1, ...(D?.busyHours.map((h) => h.sales) ?? [1]));
  return <div className="flex flex-col gap-3"><div className="flex gap-2">{[7, 30, 90].map((d) => <button key={d} className="chip" aria-current={days === d} onClick={() => setDays(d)}>{d} jours</button>)}</div><Err e={q.error} />{q.isLoading && <div className="card h-24 animate-pulse bg-white/5" />}
    {D && <>{!D.totals.sales && <p className="card text-sm text-white/60">Aucune vente sur la période : rien à analyser.</p>}
      <div className="grid grid-cols-2 gap-2 text-sm">{([["Ventes", String(D.totals.sales)], ["Chiffre d'affaires", formatFcfa(D.totals.revenue)], ["Panier moyen", formatFcfa(D.totals.avgBasket)], ["Taux de remise", `${D.totals.discountRate} %`], ["Marge estimée", D.totals.marginCoveragePct ? formatFcfa(D.totals.estimatedMargin) : "—"], ["Ventes / jour", String(D.totals.perDay)]] as [string, string][]).map(([k, v]) => <div key={k} className="card !p-2"><div className="text-[11px] text-white/50">{k}</div><b>{v}</b></div>)}</div>
      {D.totals.marginCoveragePct > 0 && D.totals.marginCoveragePct < 100 && <p className="text-[11px] text-white/40">Marge calculée sur {D.totals.marginCoveragePct} % du chiffre d'affaires (coût connu).</p>}
      {!!D.anomalies.length && <section className="flex flex-col gap-1"><b className="text-sm">Alertes expliquées</b>{D.anomalies.map((a) => <div key={a.code + a.message} className="card text-sm border border-amber-400/30"><span className="text-amber-300">{a.message}</span><span className="block text-[11px] text-white/40">Pourquoi : {a.basis}</span></div>)}</section>}
      {!!D.recommendations.length && <section className="flex flex-col gap-1"><b className="text-sm">Recommandations</b>{D.recommendations.map((r) => <div key={r.text} className="card text-sm">{r.text}<span className="block text-[11px] text-white/40">Base : {r.basis}</span></div>)}</section>}
      <section className="card flex flex-col gap-1"><b className="text-sm">Heures d'affluence</b><div className="flex items-end gap-0.5 h-16" role="img" aria-label="Ventes par heure">{D.busyHours.map((h) => <div key={h.hour} title={`${h.hour} h : ${h.sales} vente(s)`} className="flex-1 bg-[var(--gold)]/70 rounded-sm" style={{ height: `${(h.sales / maxH) * 100}%`, minHeight: h.sales ? 2 : 0 }} />)}</div><div className="flex justify-between text-[10px] text-white/40"><span>0 h</span><span>12 h</span><span>23 h</span></div></section>
      <section className="flex flex-col gap-1"><b className="text-sm">Articles les plus rentables en chiffre d'affaires</b>{D.topItems.map((i) => <div key={i.productId} className="flex justify-between text-sm"><span>{i.name} <span className="text-white/40">× {i.qty}</span></span><b>{formatFcfa(i.revenue)}</b></div>)}</section>
      {!!D.associations.length && <section className="flex flex-col gap-1"><b className="text-sm">Articles achetés ensemble</b>{D.associations.map((a) => <div key={a.a + a.b} className="text-sm">{a.a} + {a.b} <span className="text-white/40">· {a.n} ventes</span></div>)}</section>}
      <section className="flex flex-col gap-1"><b className="text-sm">Vendeurs</b>{D.sellers.map((x) => <div key={x.userId} className="card flex justify-between text-sm"><span><b>{x.seller || "—"}</b><span className="block text-xs text-white/50">{x.count} ventes · panier {formatFcfa(x.avgBasket)} · remise {x.discountRate} %{x.refunds + x.cancels ? ` · ${x.refunds + x.cancels} remb./annul.` : ""}</span></span><b>{formatFcfa(x.total)}</b></div>)}</section>
      <section className="card flex flex-col gap-1"><b className="text-sm">Prévision indicative (7 jours)</b>{D.forecast.days.map((f) => <div key={f.day} className="flex justify-between text-sm"><span>{new Date(f.day).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</span><span>{f.basedOn ? `${formatFcfa(f.expected)} (${formatFcfa(f.low)}–${formatFcfa(f.high)}) · ${f.reliability}` : "pas assez de données"}</span></div>)}<p className="text-[11px] text-white/40">Méthode : {D.forecast.method}. Limites : {D.forecast.limits}</p></section>
      <p className="text-[11px] text-white/40">{D.note} Base : {D.basedOn.sales} ventes sur {D.basedOn.days} jours.</p></>}</div>;
}

function Ledger() {
  const { session } = useSession(); const s = session!; const m = useMutation({ mutationFn: () => api<{ checked: number; salesChecked: number; ok: boolean; tampered: { ref: string }[]; missing: { number: string; reason: string }[]; orphans: { ref: string }[]; note: string }>(s, "ledger.verify", {}) });
  return <div className="flex flex-col gap-2"><p className="text-xs text-white/50">Le journal financier est en ajout seul : ventes, remboursements, ouvertures et fermetures de caisse, mouvements, corrections. Le contrôle recalcule chaque empreinte (30 derniers jours).</p><button className="btn" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Contrôle…" : "Contrôler l'intégrité"}</button><Err e={m.error} />
    {m.data && <div className={`card text-sm ${m.data.ok ? "border border-emerald-400/40" : "border border-red-400/40"}`} role="status"><b className={m.data.ok ? "text-emerald-300" : "text-red-300"}>{m.data.ok ? "✓ Journal intègre" : "✗ Anomalies détectées"}</b><span className="block text-xs text-white/50">{m.data.checked} écritures · {m.data.salesChecked} ventes vérifiées</span>
      {m.data.tampered.map((t) => <span key={t.ref} className="block text-red-300 text-xs">Écriture altérée : {t.ref}</span>)}{m.data.missing.map((t) => <span key={t.number} className="block text-red-300 text-xs">Vente {t.number} : {t.reason}</span>)}{m.data.orphans.map((t) => <span key={t.ref} className="block text-amber-300 text-xs">Écriture sans vente terminée : {t.ref}</span>)}<span className="block text-[11px] text-white/40 pt-1">{m.data.note}</span></div>}</div>;
}

function Handover() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const sess = useQuery({ queryKey: ["hand-sessions", s.shopId], queryFn: () => api<{ sessions: Sess[] }>(s, "cash.sessions", {}) }); const staff = useQuery({ queryKey: ["staff-all"], queryFn: () => list<Staff>("staff", s, [], 200) });
  const open = (sess.data?.sessions ?? []).filter((x) => x.status === "open"); const [sid, setSid] = useState(""); const [to, setTo] = useState(""); const [counted, setCounted] = useState(""); const [note, setNote] = useState(""); const requestId = useState(() => crypto.randomUUID())[0];
  const mine = (st: Staff) => { try { return (JSON.parse(String(st.shopIds ?? "[]")) as string[]).includes(s.shopId); } catch { return false; } };
  const cand = (staff.data ?? []).filter((x) => x.active !== false && mine(x) && x.userId !== open.find((o) => o.id === sid)?.userId);
  const m = useMutation({ mutationFn: () => api<{ variance: number }>(s, "cash.handover", { sessionId: sid, toUserId: to, counted: num(counted), note, requestId }), onSuccess: () => { void qc.invalidateQueries(); } });
  return <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}><p className="text-xs text-white/50">Passation contrôlée : la session sortante est comptée et fermée (écart tracé), la suivante s'ouvre au nom du repreneur avec le montant compté.</p>
    <select className="input" aria-label="Session à transférer" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Session à transférer…</option>{open.map((o) => <option key={o.id} value={o.id}>{o.seller} {o.register ? `· ${o.register}` : ""} (depuis {dt(o.openedAt)})</option>)}</select>
    <select className="input" aria-label="Vendeur repreneur" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Vendeur qui reprend…</option>{cand.map((x) => <option key={x.userId} value={x.userId}>{x.name}</option>)}</select>
    <input className="input" inputMode="numeric" aria-label="Espèces comptées" placeholder="Espèces comptées (FCFA)" value={counted} onChange={(e) => setCounted(e.target.value)} /><input className="input" aria-label="Note" maxLength={200} placeholder="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
    <Err e={m.error} /><button className="btn" disabled={m.isPending || !sid || !to || !(num(counted) >= 0) || counted.trim() === ""}>{m.isPending ? "Transfert…" : "Transférer la caisse"}</button>{m.data && <p className="text-sm text-emerald-300" role="status">Caisse transférée. Écart constaté : {m.data.variance === 0 ? "aucun" : formatFcfa(m.data.variance)}.</p>}</form>;
}

const RIGHT_ORDER = ["open", "close", "discount", "cancel", "refund", "approve", "authorize", "transfer", "correct"];
function RightsEditor({ labels }: { labels: Record<string, string> }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const staff = useQuery({ queryKey: ["staff-all"], queryFn: () => list<Staff>("staff", s, [], 200) }); const [sel, setSel] = useState<string>(""); const [draft, setDraft] = useState<string[]>([]);
  const cur = (staff.data ?? []).find((x) => x.userId === sel); const defaults = (st?: Staff) => (st?.role === "manager" ? RIGHT_ORDER : ["open", "close"]);
  const pick = (id: string) => { setSel(id); const st = (staff.data ?? []).find((x) => x.userId === id); let r: string[]; try { r = st?.posRights ? (JSON.parse(st.posRights) as string[]) : defaults(st); } catch { r = defaults(st); } setDraft(r); };
  const m = useMutation({ mutationFn: () => api(s, "staff.rights", { userId: sel, rights: draft }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["staff-all"] }) });
  return <div className="flex flex-col gap-2"><p className="text-xs text-white/50">Droits distincts par employé. Par défaut : le gérant a tous les droits, le caissier peut ouvrir et fermer sa caisse. Sans droit, une action passe par une approbation.</p>
    <select className="input" aria-label="Employé" value={sel} onChange={(e) => pick(e.target.value)}><option value="">Choisir un employé…</option>{(staff.data ?? []).map((x) => <option key={x.userId} value={x.userId}>{x.name} ({x.role})</option>)}</select>
    {cur && <div className="card flex flex-col gap-1.5">{RIGHT_ORDER.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.includes(k)} onChange={(e) => setDraft(e.target.checked ? [...draft, k] : draft.filter((x) => x !== k))} />{labels[k] ?? k}</label>)}<Err e={m.error} /><button className="btn" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Enregistrement…" : "Enregistrer les droits"}</button>{m.isSuccess && <p className="text-xs text-emerald-300" role="status">Droits enregistrés.</p>}</div>}</div>;
}

function Verify() {
  const { session } = useSession(); const s = session!; const [code, setCode] = useState(""); const [scan, setScan] = useState(false);
  const m = useMutation({ mutationFn: (c: string) => api<{ authentic: boolean; reason?: string; number?: string; total?: number; soldAt?: string; status?: string }>(s, "sale.verify", { code: c }) });
  return <div className="flex flex-col gap-2"><p className="text-xs text-white/50">Scannez le QR imprimé sur un ticket (ou collez son code) : le serveur vérifie la signature et retrouve la vente.</p>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(code.trim()); }}><input className="input flex-1" aria-label="Code du ticket" placeholder="DMP1.V-…" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn" disabled={m.isPending || !code.trim()}>Vérifier</button><button type="button" className="btn-ghost" onClick={() => setScan(true)}>Scanner</button></form><Err e={m.error} />
    {m.data && <div className={`card text-sm ${m.data.authentic ? "border border-emerald-400/40" : "border border-red-400/40"}`} role="status">{m.data.authentic ? <><b className="text-emerald-300">✓ Ticket authentique</b><span className="block text-xs text-white/60">Vente {m.data.number} · {formatFcfa(m.data.total ?? 0)} · {m.data.soldAt ? dt(m.data.soldAt) : ""} · {m.data.status}</span></> : <><b className="text-red-300">✗ Ticket non valide</b><span className="block text-xs text-white/60">{m.data.reason}</span></>}</div>}
    {scan && <Scanner onCode={(c) => { setScan(false); setCode(c); m.mutate(c); }} onClose={() => setScan(false)} />}</div>;
}
