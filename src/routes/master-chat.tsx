/** MASTER DOGUI — assistant (kit écran « Assistant ») : conversations à gauche, échange au centre, contexte actif et actions rapides à droite.
 *  Réponses calculées par le serveur à partir des données réelles ; chaque réponse précise sa période, ses sources, sa méthode et ses limites.
 *  Rédaction par IA seulement si elle est réellement active (chiffres vérifiés). Aucune action n'est exécutée. Conversations privées. */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Boxes, CalendarDays, ChevronRight, Database, Lightbulb, MessageSquarePlus, Percent, Send, ShoppingCart, Store, Tag, Trash2, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { CONF_LABEL } from "@/domain/master-reco";
import { MONTH_CURRENT, MONTH_PREVIOUS, type Answer } from "@/domain/master-chat";
import { answerCards } from "@/domain/master-answer-view";
import { ExportBar } from "@/routes/master-export";
import { answerToData } from "@/domain/master-export";
import { formatFcfa } from "@/domain/money";
import { MasterSymbol } from "./master";

type Msg = { id: string; role: "user" | "assistant"; text: string; answer: Answer | null; createdAt: string };
type L = { chats: { id: string; title: string; updatedAt: string }[]; mode: { ai: boolean; label: string }; canAsk: boolean; quota: { limit: number; used: number }; maxQuestion: number; retentionMonths: number; guided: { id: string; label: string; periodic: boolean; shopLevel: boolean }[]; shops: { id: string; name: string }[]; privacy: string };
const fmt = (v: string | number) => (typeof v === "number" ? v.toLocaleString("fr-FR") : v);
const rk = () => `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const ORDER = ["overview", "sales", "top", "stock", "cash", "credit", "expenses", "recos", "purchases", "payables", "treasury", "customers", "pipeline", "promos", "inventories", "transfers", "stockvalue", "invest", "accounting", "team", "profile"];
const DRAFT = "md-chat-draft";
const draftGet = () => { try { return localStorage.getItem(DRAFT) ?? ""; } catch { return ""; } };
const draftSet = (v: string) => { try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* confort seulement */ } };
const PERIODS: [number, string][] = [[1, "Aujourd'hui"], [7, "7 derniers jours"], [30, "30 derniers jours"], [MONTH_CURRENT, "Mois en cours"], [MONTH_PREVIOUS, "Mois précédent"]];
/** Actions rapides de la maquette, reliées aux questions guidées réelles et nommées d'après ce qu'elles calculent vraiment. */
const QUICK: { qid: string; label: string; icon: typeof BarChart3; tint: string }[] = [
  { qid: "sales", label: "Analyser mes ventes", icon: BarChart3, tint: "text-info" },
  { qid: "stock", label: "Vérifier mes stocks", icon: Boxes, tint: "text-ok" },
  { qid: "top", label: "Marge des meilleurs articles", icon: Percent, tint: "text-[var(--accent-text)]" },
  { qid: "purchases", label: "Suivre mes achats", icon: ShoppingCart, tint: "text-warn" },
  { qid: "promos", label: "Mes promotions", icon: Tag, tint: "text-bad" },
];
const dfr = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
const tfr = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const cardValue = (v: number, unit: "fcfa" | "pct" | "count") => (unit === "fcfa" ? formatFcfa(v) : unit === "pct" ? `${v.toLocaleString("fr-FR")} %` : v.toLocaleString("fr-FR"));

function AnswerView({ a, q }: { a: Answer; q: string }) {
  const cards = answerCards(a); const shown = new Set(cards.map((c) => c.label));
  const rest = a.facts.filter((f) => !shown.has(f.label.replace(/\s*\((FCFA|%)\)$/, "")) && f.label !== "Période précédente (FCFA)");
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div><b className="text-base">{a.title}</b>{(a.period || a.scope) && <p className="text-xs text-muted">{a.scope}{a.scope && a.period ? " · " : ""}{a.period ? `${a.period.label}${a.period.from ? ` (${dfr(a.period.from)} → ${dfr(a.period.to)})` : ""}` : ""}</p>}</div>
      <p>{a.conclusion}</p>
      {cards.length > 0 && <ul className="grid gap-2 grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs de la réponse">{cards.map((c) => (
        <li key={c.label} className="rounded-xl border border-line bg-[var(--surface-2)] p-2.5">
          <span className="block text-xs text-soft">{c.label}</span><b className="block text-base tabular-nums">{cardValue(c.value, c.unit)}</b>
          {c.deltaPct !== null && <span className={`text-xs inline-flex items-center gap-0.5 ${c.deltaPct >= 0 ? "text-ok" : "text-bad"}`}>{c.deltaPct >= 0 ? <TrendingUp size={13} aria-hidden="true" /> : <TrendingDown size={13} aria-hidden="true" />}{c.deltaPct >= 0 ? "+" : ""}{c.deltaPct.toLocaleString("fr-FR")} % vs période précédente</span>}
        </li>))}</ul>}
      {rest.length > 0 && <div className="border-t border-line pt-1">{rest.map((f, i) => <p key={i} className="text-xs flex justify-between gap-2"><span className="text-muted">{f.label}</span><b>{fmt(f.value)}</b></p>)}</div>}
      {a.observations.length > 0 && <section aria-label="Principaux enseignements"><h3 className="font-semibold inline-flex items-center gap-1.5"><BarChart3 size={16} className="text-info" aria-hidden="true" />Principaux enseignements</h3>
        <ul className="mt-1 flex flex-col gap-1">{a.observations.map((o, i) => <li key={i} className="flex gap-2"><span className="text-ok" aria-hidden="true">✓</span><span>{o.replace(/^•\s*/, "")}</span></li>)}</ul></section>}
      {a.recommendations.length > 0 && <section aria-label="Recommandations" className="rounded-xl border border-[color-mix(in_srgb,var(--gold)_45%,transparent)] bg-[var(--gold-soft)] p-3"><h3 className="font-semibold inline-flex items-center gap-1.5"><Lightbulb size={16} className="text-[var(--gold)]" aria-hidden="true" />Recommandations</h3>
        <ol className="mt-1 flex flex-col gap-1">{a.recommendations.map((o, i) => <li key={i} className="flex gap-2"><span className="shrink-0 size-5 rounded-full bg-[var(--gold)] text-[var(--nav-bg)] text-xs font-bold grid place-items-center">{i + 1}</span><span>{o}</span></li>)}</ol>
        <p className="text-xs text-soft mt-1">À décider par vous : aucune action n'est lancée automatiquement.</p></section>}
      <div className="text-xs text-muted border-t border-line pt-1 flex flex-col gap-0.5">{a.method && <p>Méthode : {a.method}</p>}{a.sources.map((s, i) => <p key={i}>Source : {s.module} · {s.detail}</p>)}{a.limits.map((o, i) => <p key={i}>Limite : {o}</p>)}<p>{CONF_LABEL[a.confidence]}</p>{a.ai?.used ? <p className="text-info">Rédigé par IA (Gemini) : chiffres calculés et vérifiés par MASTER DOGUI.</p> : <p>Calculé par MASTER DOGUI, sans IA.</p>}{a.ai?.note && <p className="text-warn">{a.ai.note}</p>}</div>
      {a.facts.length > 0 && <ExportBar label="Exporter cette réponse" build={() => answerToData(a, q)} />}
    </div>
  );
}

/** `initial` : question envoyée automatiquement à l'ouverture (actions rapides de la vue d'ensemble), une seule fois. */
export function Assistant({ initial, onSent }: { initial?: { qid?: string; text?: string }; onSent?: () => void } = {}) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [chat, setChat] = useState<string | null>(null); const [text, setText] = useState(draftGet()); const [shop, setShop] = useState(""); const [days, setDays] = useState(7); const [err, setErr] = useState(""); const [more, setMore] = useState(false); const [online, setOnline] = useState(navigator.onLine);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const u = () => setOnline(true); const d = () => setOnline(false); addEventListener("online", u); addEventListener("offline", d); return () => { removeEventListener("online", u); removeEventListener("offline", d); }; }, []);
  const list = useQuery({ queryKey: ["md", "chat", s.tenantId], retry: 1, queryFn: () => api<L>(s, "md.chat.list", {}) });
  const conv = useQuery({ queryKey: ["md", "chat", "msgs", chat], enabled: !!chat, retry: 1, queryFn: () => api<{ id: string; title: string; messages: Msg[] }>(s, "md.chat.get", { chatId: chat }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["md", "chat"] });
  const ask = useMutation({ mutationFn: (p: { text?: string; qid?: string }) => api<{ chatId: string }>(s, "md.chat.ask", { ...p, chatId: chat ?? undefined, shopId: shop || list.data?.shops[0]?.id, days, requestKey: rk() }), onSuccess: (r, v) => { setErr(""); if (v.text !== undefined) { setText(""); draftSet(""); } setChat(r.chatId); refresh(); }, onError: (e) => setErr((e as Error).message) });
  const del = useMutation({ mutationFn: (id: string) => api(s, "md.chat.delete", { chatId: id }), onSuccess: () => { setChat(null); refresh(); }, onError: (e) => setErr((e as Error).message) });
  const fired = useRef(false); useEffect(() => { if (!initial || fired.current || !list.data?.canAsk || ask.isPending) return; fired.current = true; ask.mutate(initial, { onSettled: () => onSent?.() }); }, [list.data, initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "nearest" }); }, [conv.data?.messages.length, ask.isPending]);
  if (list.error) return <p className="text-bad text-sm" role="alert">{(list.error as Error).message}</p>; if (!list.data) return <div className="card h-32 animate-pulse bg-subtle" aria-busy="true" />; const l = list.data;
  const send = (p: { text?: string; qid?: string }) => { if (!online) { if (p.text) draftSet(p.text); setErr("Hors connexion : votre question est conservée dans la zone de saisie ; envoyez-la au retour du réseau."); return; } ask.mutate(p); };
  const left = l.quota.limit - l.quota.used; const disabled = !l.canAsk || ask.isPending;
  const msgs = conv.data?.messages ?? []; const last = [...msgs].reverse().find((m) => m.answer)?.answer ?? null;
  const shopName = l.shops.find((x) => x.id === (shop || l.shops[0]?.id))?.name ?? "—";
  const guided = [...l.guided].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,1fr)_19rem]">
      {/* Colonne gauche : MASTER et conversations */}
      <aside className="order-3 lg:order-none flex flex-col gap-3 min-w-0 lg:row-span-2 2xl:row-span-1">
        <div data-theme="dark" className="rounded-2xl p-4 flex flex-col items-center gap-2 text-center bg-[var(--nav-bg)] text-[var(--nav-text)]">
          <MasterSymbol size={64} className="text-[var(--gold)]" />
          <b className="text-lg">MASTER <span className="text-[var(--gold)]">DOGUI</span></b>
          <p className="text-xs opacity-80">L'assistant de votre gestion commerciale.</p>
          <span className={`text-xs rounded-full px-2 py-0.5 ${l.mode.ai ? "bg-ok-bg text-ok" : "bg-white/10"}`}>{l.mode.ai ? "IA active" : "Mode guidé"}</span>
          <button type="button" className="btn w-full !bg-[var(--gold)] !text-[var(--nav-bg)]" onClick={() => setChat(null)}><MessageSquarePlus size={18} aria-hidden="true" /> Nouvelle conversation</button>
        </div>
        <nav aria-label="Historique" className="card !p-3 flex flex-col gap-1 text-sm">
          <b>Mes conversations</b>
          {l.chats.length === 0 && <p className="text-xs text-muted">Aucune conversation.</p>}
          {l.chats.map((c) => <div key={c.id} className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 ${chat === c.id ? "bg-accent-soft" : "hover:bg-subtle"}`}>
            <button type="button" className="text-left min-w-0 flex-1" aria-current={chat === c.id} onClick={() => setChat(c.id)}><span className="block truncate text-xs font-semibold">{c.title}</span><span className="block text-[0.7rem] text-muted">{new Date(c.updatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></button>
            <button type="button" className="icon-btn !min-h-8 !min-w-8 text-bad" aria-label={`Supprimer ${c.title}`} onClick={() => { if (confirm("Supprimer définitivement cette conversation ?")) del.mutate(c.id); }}><Trash2 size={15} /></button>
          </div>)}
          <p className="text-[0.7rem] text-muted mt-1">{l.privacy} Conservation : {l.retentionMonths} mois.</p>
        </nav>
      </aside>

      {/* Colonne centrale : échange */}
      <section aria-label="Échange avec MASTER DOGUI" className="order-1 lg:order-none card flex flex-col gap-3 min-w-0">
        {!l.canAsk && <p className="text-xs text-warn" role="status">Licence MASTER DOGUI inactive : vos conversations restent consultables, les nouvelles questions sont suspendues.</p>}
        {!online && <p className="text-xs text-warn" role="status">Hors connexion : les conversations déjà chargées restent lisibles ; les nouvelles questions sont indisponibles.</p>}
        <div className="flex flex-col gap-3 min-h-48">
          {!chat && !ask.isPending && <div className="text-center py-6 text-soft"><MasterSymbol size={44} className="mx-auto text-[var(--gold)]" /><p className="mt-2 font-semibold text-main">Posez une question ou choisissez une action rapide.</p><p className="text-xs">MASTER DOGUI calcule à partir des données de votre boutique au moment de la question.</p></div>}
          {msgs.length > 0 && <div className="flex flex-col gap-3" aria-label="Conversation">{msgs.map((m, idx, all) => m.role === "user"
            ? <div key={m.id} className="self-end max-w-[88%] rounded-2xl rounded-br-sm bg-info-bg px-3 py-2 text-sm"><p>{m.text}</p><p className="text-[0.7rem] text-muted text-right">{tfr(m.createdAt)}</p></div>
            : <div key={m.id} className="flex gap-2 items-start max-w-full"><MasterSymbol size={28} className="shrink-0 text-[var(--gold)] mt-1" /><div className="flex-1 min-w-0 rounded-2xl rounded-tl-sm border border-line p-3">{m.answer ? <AnswerView a={m.answer} q={all[idx - 1]?.text ?? ""} /> : <p className="text-sm">{m.text}</p>}<p className="text-[0.7rem] text-muted text-right mt-1">{tfr(m.createdAt)}</p></div></div>)}</div>}
          {ask.isPending && <p className="text-sm flex items-center gap-2 fade-in" role="status"><span className="dots" aria-hidden="true"><i /><i /><i /></span>MASTER DOGUI analyse vos données…</p>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Questions guidées">{guided.slice(0, more ? 99 : 6).map((g) => <button key={g.id} type="button" className="chip !min-h-9 text-sm" disabled={disabled} onClick={() => send({ qid: g.id })}>{g.label}</button>)}<button type="button" className="chip !min-h-9 text-sm" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Moins de questions" : `Plus de questions (${Math.max(0, guided.length - 6)})`}</button></div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text }); }}>
          <input className="input flex-1" aria-label="Votre question" maxLength={l.maxQuestion} placeholder="Posez votre question à MASTER DOGUI… (ex. : analyser mes ventes, vérifier mes stocks)" value={text} onChange={(e) => { setText(e.target.value); draftSet(e.target.value); }} disabled={!l.canAsk} />
          <button className="btn !px-4" aria-label="Envoyer" disabled={disabled || !text.trim()}>{ask.isPending ? "…" : <Send size={18} aria-hidden="true" />}</button>
        </form>
        <p className="text-xs text-muted">Questions restantes aujourd'hui : {left} / {l.quota.limit} · {l.mode.label}</p>
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}
      </section>

      {/* Colonne droite : contexte actif, actions rapides, ce que fait MASTER */}
      <aside className="order-2 lg:order-none flex flex-col gap-3 min-w-0 lg:col-start-2 2xl:col-start-auto">
        <section aria-label="Contexte actif" className="card !p-3 flex flex-col gap-2.5 text-sm">
          <h2 className="font-bold inline-flex items-center gap-2"><Database size={18} className="text-info" aria-hidden="true" />Contexte actif</h2>
          <label className="flex flex-col gap-1"><span className="inline-flex items-center gap-1.5 text-xs text-muted"><Store size={14} aria-hidden="true" />Boutique</span><select className="input" aria-label="Boutique" value={shop || l.shops[0]?.id || ""} onChange={(e) => setShop(e.target.value)}>{l.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="inline-flex items-center gap-1.5 text-xs text-muted"><CalendarDays size={14} aria-hidden="true" />Période d'analyse</span><select className="input" aria-label="Période" value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}</select></label>
          <div><span className="inline-flex items-center gap-1.5 text-xs text-muted"><Database size={14} aria-hidden="true" />Dernière réponse</span>
            {last ? <p className="text-xs mt-0.5"><b>{last.scope || shopName}</b>{last.period ? ` · ${last.period.label}${last.period.from ? ` (${dfr(last.period.from)} → ${dfr(last.period.to)})` : ""}` : ""}<br />Données utilisées : {last.sources.map((x) => x.module).join(", ") || "—"}</p> : <p className="text-xs text-muted mt-0.5">Aucune réponse dans cette conversation.</p>}</div>
        </section>
        <section aria-label="Actions rapides" className="card !p-3 flex flex-col gap-1.5">
          <h2 className="font-bold inline-flex items-center gap-2"><Zap size={18} className="text-info" aria-hidden="true" />Actions rapides</h2>
          {QUICK.filter((q) => l.guided.some((g) => g.id === q.qid)).map((q) => <button key={q.qid} type="button" className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-left hover:bg-subtle disabled:opacity-50" disabled={disabled} onClick={() => send({ qid: q.qid })}><q.icon size={18} className={q.tint} aria-hidden="true" /><span className="flex-1">{q.label}</span><ChevronRight size={16} aria-hidden="true" /></button>)}
        </section>
        <section aria-label="Ce que fait MASTER DOGUI" className="rounded-2xl border p-3 text-sm bg-[var(--gold-soft)] border-[color-mix(in_srgb,var(--gold)_45%,transparent)]">
          <h2 className="font-bold">Ce que fait MASTER DOGUI</h2>
          <ul className="mt-1 flex flex-col gap-1 text-xs">{["Calcule à partir des données de votre boutique au moment de la question.", "Précise la période, les sources, la méthode et les limites de chaque réponse.", "Propose des recommandations seulement quand elles découlent des chiffres.", "N'agit jamais seul : chaque décision vous revient."].map((t) => <li key={t} className="flex gap-2"><span className="text-ok" aria-hidden="true">✓</span>{t}</li>)}</ul>
        </section>
      </aside>
    </div>
  );
}
