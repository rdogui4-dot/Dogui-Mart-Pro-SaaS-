/** MASTER DOGUI — page complète (kit écran 20) : vue d'ensemble (santé expliquée, alertes, recommandations, insights, synthèse du mois), assistant, recommandations, rapports, profil, licence.
 *  Tout chiffre vient du serveur (md.home) ; aucune action n'est exécutée automatiquement ; l'état de l'IA affiché est l'état réel. */
import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, BookOpen, Brain, CheckCircle2, CircleAlert, Coins, FileText, Info, KeyRound, LayoutGrid, Lightbulb, MessageSquare, Package, Percent, Send, ShoppingCart, Sparkles, Target, TrendingUp, Wallet } from "lucide-react";
import { ModuleHeader, Panel, PillTabs, StatusBadge, type PillTab, type StatusTone } from "@/components/kit";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { STATE_LABEL, type HDim, type HState } from "@/domain/master-home";
import { PRIO_LABEL, type Prio } from "@/domain/master-report";
import type { MasterTab } from "@/lib/master-modal";
import { Licence, MasterSymbol, Rapports } from "./master";
import { Assistant } from "./master-chat";
import { Profil } from "./master-profile";
import { Recos } from "./master-reco";

type Home = { licensed: boolean; state: string; ai: { ai: boolean; label: string }; generatedAt?: string;
  health?: { dims: HDim[]; score: number | null; counted: number; label: string | null; method: string };
  alerts?: { id: string; level: "critical" | "warning" | "info"; text: string; link: string }[];
  recos?: { items: { id: string; prio: Prio; title: string; reason: string; module: string }[]; total: number } | null;
  insights?: string[];
  month?: { month: string; revenue: number; revenueDelta: number | null; expenses: number; expensesDelta: number | null; net: number | null; netDelta: number | null; netMarginPct: number | null; marginPts: number | null; reasons: string[] } | null;
  unavailable?: { section: string; reason: string }[]; note?: string };
type Ask = { qid?: string; text?: string };
const TABS: MasterTab[] = ["ov", "chat", "rec", "rep", "pro", "lic"];
const STONE: Record<HState, StatusTone> = { ok: "ok", warn: "warn", bad: "bad" };
const fr = (n: number) => n.toLocaleString("fr-FR");
const delta = (d: number | null, unit = "%", goodUp = true) => d === null ? null : <span className={`text-xs font-semibold ${(d >= 0) === goodUp ? "text-ok" : "text-bad"}`}>{d >= 0 ? "▲ +" : "▼ "}{fr(d)} {unit}</span>;

export function MasterPage() {
  const { session } = useSession(); const s = session!; const mgr = s.role === "owner" || s.role === "manager"; const nav = useNavigate();
  const search = useRouterState({ select: (st) => st.location.searchStr ?? "" }); const want = new URLSearchParams(search).get("onglet") as MasterTab | null;
  const tab: MasterTab = !mgr ? "lic" : want && TABS.includes(want) ? want : "ov";
  const sp = new URLSearchParams(search); const ask: Ask | undefined = sp.get("qid") ? { qid: sp.get("qid")! } : sp.get("q") ? { text: sp.get("q")! } : undefined;
  const setTab = (t: MasterTab) => void nav({ to: "/master", search: { onglet: t } as never, replace: true });
  /** La question voyage dans l'adresse (l'onglet change l'adresse) ; elle en est retirée après la réponse pour qu'un rechargement ne la renvoie pas (la mise en page ignore qid/q pour ne pas recréer la page). */
  const go = (a: Ask) => void nav({ to: "/master", search: { onglet: "chat", ...(a.qid ? { qid: a.qid } : { q: a.text }) } as never });
  const h = useQuery({ queryKey: ["md", "home", s.shopId], enabled: mgr, retry: 1, staleTime: 60_000, queryFn: () => api<Home>(s, "md.home", {}) });
  const items: PillTab<MasterTab>[] = mgr ? [{ key: "ov", label: "Vue d'ensemble", icon: LayoutGrid }, { key: "chat", label: "Assistant", icon: MessageSquare }, { key: "rec", label: "Recommandations", icon: Lightbulb }, { key: "rep", label: "Rapports MASTER", icon: FileText }, { key: "pro", label: "Profil", icon: BookOpen }, { key: "lic", label: "Licence", icon: KeyRound }] : [{ key: "lic", label: "Licence", icon: KeyRound }];
  const ai = h.data?.ai;
  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader icon={Brain} title="MASTER DOGUI — Le cerveau intelligent de Dogui Mart Pro" subtitle="Votre assistant métier qui analyse, conseille, anticipe et vous aide à prendre les meilleures décisions."
        actions={ai ? <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium border ${ai.ai ? "border-[var(--gold)] text-accent-text" : "border-[var(--line)] text-muted"}`} title={ai.label} aria-label={`État de l'IA : ${ai.ai ? "IA active" : "mode guidé"}`}><span className={`h-2.5 w-2.5 rounded-full ${ai.ai ? "bg-[var(--gold)] motion-safe:animate-pulse" : "bg-[var(--muted)]"}`} aria-hidden="true" />{ai.ai ? "IA active" : "Mode guidé"}</span> : undefined} />
      <PillTabs idBase="md" label="Sections MASTER DOGUI" value={tab} onChange={setTab} items={items} />
      {tab === "ov" && <Overview q={h} name={s.name} onAsk={go} onTab={setTab} />}
      {tab === "chat" && <Assistant initial={ask} onSent={() => setTab("chat")} />}
      {tab === "rec" && <Recos />}{tab === "rep" && <Rapports />}{tab === "pro" && <Profil />}{tab === "lic" && <Licence />}
    </div>
  );
}

const QUICK: { label: string; icon: typeof BarChart3; ask?: Ask; to?: string }[] = [
  { label: "Analyser mon activité", icon: BarChart3, ask: { qid: "overview" } }, { label: "Optimiser mes stocks", icon: Package, ask: { qid: "stock" } }, { label: "Améliorer mes ventes", icon: ShoppingCart, ask: { qid: "sales" } },
  { label: "Maîtriser mes charges", icon: Coins, ask: { qid: "expenses" } }, { label: "Suivre ma trésorerie", icon: TrendingUp, ask: { qid: "treasury" } }, { label: "Simuler un investissement", icon: Target, to: "/investissements" },
];
const SUGGEST: { label: string; qid: string }[] = [{ label: "Bilan du mois", qid: "overview" }, { label: "Stocks à réapprovisionner", qid: "stock" }, { label: "Produits les plus vendus", qid: "top" }, { label: "Évolution des ventes", qid: "sales" }, { label: "Mes promotions", qid: "promos" }];

function Overview({ q, name, onAsk, onTab }: { q: ReturnType<typeof useQuery<Home>>; name: string; onAsk: (a: Ask) => void; onTab: (t: MasterTab) => void }) {
  const nav = useNavigate(); const [text, setText] = useState(""); const first = (name || "").trim().split(/\s+/)[0] ?? "";
  if (q.error) return <p className="text-bad text-sm" role="alert">{(q.error as Error).message}</p>; if (!q.data) return <div className="card h-48 animate-pulse bg-subtle" aria-busy="true" />;
  const d = q.data;
  if (!d.licensed) return <div className="flex flex-col gap-3"><p className="card text-sm" role="status">La vue d'ensemble de MASTER DOGUI (santé de l'activité, alertes, recommandations et synthèse) est réservée à la licence MASTER active. L'historique de vos rapports et conversations reste consultable.</p><Licence /></div>;
  const hh = d.health!;
  return <div className="flex flex-col gap-4">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section aria-label="Accueil MASTER DOGUI" className="rounded-2xl p-5 text-white flex flex-col gap-4 bg-[linear-gradient(135deg,var(--nav-bg),color-mix(in_srgb,var(--nav-bg)_70%,#1d4ed8))] shadow-[var(--shadow-card)]">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start">
          <div className="flex flex-col gap-3"><div className="flex items-center gap-3 text-white"><MasterSymbol size={52} className="text-white" /><div><b className="text-xl tracking-tight">MASTER <span className="text-[var(--gold)]">DOGUI</span></b><p className="text-xs text-white/75">Votre conseiller en gestion, finance, comptabilité, stocks, ventes et investissements.</p></div></div>
            <p className="rounded-xl bg-white/10 px-3 py-2 text-sm">Bonjour{first ? ` ${first}` : ""} ! Que souhaitez-vous faire aujourd'hui ?</p></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{QUICK.map((x) => <button key={x.label} type="button" className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 p-3 flex flex-col items-center gap-1.5 text-center text-sm font-medium" onClick={() => (x.to ? void nav({ to: x.to as never }) : onAsk(x.ask!))}><x.icon size={22} className="text-[var(--gold)]" aria-hidden="true" />{x.label}</button>)}</div>
        </div>
        <form className="rounded-xl bg-white text-slate-900 p-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAsk({ text: text.trim() }); }}><Sparkles size={20} className="text-amber-600 shrink-0 ml-1" aria-hidden="true" /><input className="flex-1 bg-transparent outline-none text-sm min-w-0 py-2 text-slate-900 placeholder:text-slate-500" aria-label="Posez votre question à MASTER DOGUI" placeholder="Posez votre question… Ex. : « Quels articles dois-je réapprovisionner ? »" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /><button type="submit" className="btn-gold !min-h-10 !px-3" aria-label="Envoyer la question" disabled={!text.trim()}><Send size={18} aria-hidden="true" /></button></form>
        <div className="flex flex-col gap-1.5"><span className="text-xs text-white/75">Suggestions de questions</span><div className="flex flex-wrap gap-2">{SUGGEST.map((x) => <button key={x.qid + x.label} type="button" className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs" onClick={() => onAsk({ qid: x.qid })}>{x.label}</button>)}</div></div>
      </section>
      <div className="flex flex-col gap-4">
        <Panel title="Santé globale de l'activité"><Health h={hh} /></Panel>
        <Panel title={`Alertes intelligentes (${d.alerts!.length})`} icon={AlertTriangle}>{d.alerts!.length ? <div className="flex flex-col gap-1.5">{d.alerts!.map((a) => <button key={a.id} type="button" onClick={() => void nav({ to: a.link as never })} className={`rounded-lg px-2.5 py-2 text-sm text-left flex gap-2 items-start ${a.level === "critical" ? "bg-bad-bg/50" : a.level === "warning" ? "bg-warn-bg/50" : "bg-info-bg/50"}`}>{a.level === "info" ? <Info size={16} className="text-info shrink-0 mt-0.5" aria-hidden="true" /> : <CircleAlert size={16} className={`${a.level === "critical" ? "text-bad" : "text-warn"} shrink-0 mt-0.5`} aria-hidden="true" />}<span>{a.text}</span></button>)}</div> : <p className="text-sm text-muted">Aucune alerte : rien à signaler à partir de vos données.</p>}</Panel>
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel title="Insights du jour" icon={Lightbulb}>{d.insights!.length ? <ul className="flex flex-col gap-2">{d.insights!.map((t, i) => <li key={i} className="flex gap-2 text-sm"><CheckCircle2 size={16} className="text-ok shrink-0 mt-0.5" aria-hidden="true" />{t}</li>)}</ul> : <p className="text-sm text-muted">Pas encore assez de ventes ce mois-ci pour tirer des constats.</p>}</Panel>
      <Panel title="Synthèse de l'activité (ce mois)" icon={BarChart3}>{d.month ? <div className="grid grid-cols-2 gap-2">
        <Mini icon={ShoppingCart} label="Chiffre d'affaires" value={formatFcfa(d.month.revenue)} d={delta(d.month.revenueDelta)} />
        <Mini icon={Wallet} label="Charges" value={formatFcfa(d.month.expenses)} d={delta(d.month.expensesDelta, "%", false)} />
        <Mini icon={TrendingUp} label="Résultat net" value={d.month.net === null ? "—" : formatFcfa(d.month.net)} d={d.month.net === null ? <span className="text-[11px] text-muted">non calculable</span> : delta(d.month.netDelta)} />
        <Mini icon={Percent} label="Marge nette" value={d.month.netMarginPct === null ? "—" : `${fr(d.month.netMarginPct)} %`} d={delta(d.month.marginPts, "pt")} />
      </div> : <p className="text-sm text-muted">Synthèse indisponible (voir ci-dessous).</p>}{d.month && d.month.reasons.length > 0 && <p className="text-xs text-muted mt-2">Résultat non calculé : {d.month.reasons.join(", ")}.</p>}</Panel>
      <Panel title="Recommandations de MASTER DOGUI" icon={Sparkles}>{d.recos?.items.length ? <div className="flex flex-col gap-2">{d.recos.items.map((r) => <div key={r.id} className="rounded-lg border border-[var(--line)] p-2.5 text-sm"><span className="flex items-center justify-between gap-2"><b>{r.title}</b><StatusBadge tone={r.prio === "critical" ? "bad" : r.prio === "high" || r.prio === "medium" ? "warn" : r.prio === "opportunity" ? "ok" : "muted"}>{PRIO_LABEL[r.prio]}</StatusBadge></span><span className="block text-xs text-muted mt-0.5">{r.reason}</span></div>)}
        <button type="button" className="btn-gold mt-1" onClick={() => onTab("rec")}>Voir et décider ({d.recos.total})</button></div> : <div className="flex flex-col gap-2"><p className="text-sm text-muted">Aucune recommandation nouvelle pour cette boutique.</p><button type="button" className="btn-ghost self-start" onClick={() => onTab("rec")}>Ouvrir les recommandations</button></div>}<p className="text-xs text-muted mt-2">Chaque recommandation se décide une par une : rien n'est appliqué automatiquement.</p></Panel>
    </div>
    <section aria-label="Sources des analyses" className="card flex flex-col md:flex-row md:items-center gap-3 justify-between"><p className="text-sm flex gap-2 items-start"><Brain size={20} className="text-accent-text shrink-0" aria-hidden="true" />{d.note}</p>
      <span className="text-sm inline-flex items-center gap-2 rounded-xl bg-ok-bg/50 px-3 py-2 shrink-0"><CheckCircle2 size={16} className="text-ok" aria-hidden="true" />Données calculées à {d.generatedAt ? new Date(d.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span></section>
    {d.unavailable!.length > 0 && <details className="card text-xs text-muted"><summary className="cursor-pointer">Sections non disponibles ({d.unavailable!.length})</summary><ul className="mt-1">{d.unavailable!.map((u) => <li key={u.section}>• {u.section} : {u.reason}</li>)}</ul></details>}
  </div>;
}

function Mini({ icon: I, label, value, d }: { icon: typeof Wallet; label: string; value: string; d: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--line)] p-2.5 flex gap-2 items-start min-w-0"><I size={20} className="text-accent-text shrink-0 mt-0.5" aria-hidden="true" /><span className="min-w-0"><span className="text-xs text-muted block">{label}</span><b className="block tabular-nums truncate">{value}</b>{d}</span></div>;
}

function Health({ h }: { h: NonNullable<Home["health"]> }) {
  const sc = h.score; const color = sc === null ? "var(--muted)" : sc >= 80 ? "var(--ok)" : sc >= 60 ? "#84cc16" : sc >= 40 ? "var(--warn)" : "var(--bad)";
  const arc = (p: number) => { const a = Math.PI * (1 - p); return `${60 + 50 * Math.cos(a)},${60 - 50 * Math.sin(a)}`; };
  return <div className="flex flex-col gap-3"><div className="flex items-center gap-4 flex-wrap">
    <svg viewBox="0 0 120 70" className="w-36 shrink-0" role="img" aria-label={sc === null ? "Score non calculé" : `Score de santé ${sc} sur 100`}><path d="M10,60 A50,50 0 0 1 110,60" fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={10} strokeLinecap="round" />{sc !== null && sc > 0 && <path d={`M10,60 A50,50 0 0 1 ${arc(sc / 100)}`} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />}<text x="60" y="52" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{sc === null ? "—" : sc}<tspan fontSize="10" fillOpacity={0.6}> / 100</tspan></text><text x="60" y="67" textAnchor="middle" fontSize="9" fill={color}>{h.label ?? "Données insuffisantes"}</text></svg>
    <ul className="flex flex-col gap-1 text-sm min-w-0 flex-1">{h.dims.map((x) => <li key={x.key} className="flex items-center gap-2" title={x.rule}>{x.state ? <StatusBadge tone={STONE[x.state]}>{x.label} : {STATE_LABEL[x.state]}</StatusBadge> : <span className="text-xs text-muted">{x.label} : sans données</span>}</li>)}</ul></div>
    <details className="text-xs text-muted"><summary className="cursor-pointer">Comment est calculé ce score ?</summary><p className="mt-1">{h.method}{h.score === null ? ` Indicateurs disponibles : ${h.counted} sur 5.` : ""}</p><ul className="mt-1 flex flex-col gap-1">{h.dims.map((x) => <li key={x.key}>• <b>{x.label}</b> — {x.text}. <i>{x.rule}</i></li>)}</ul></details></div>;
}
