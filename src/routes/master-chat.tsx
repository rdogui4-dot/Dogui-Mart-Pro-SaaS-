/** MASTER DOGUI — assistant (étape 5A, mode guidé sans fournisseur d'IA). Réponses calculées par le serveur ; conversations privées. */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { CONF_LABEL } from "@/domain/master-reco";
import type { Answer } from "@/domain/master-chat";
import { ExportBar } from "@/routes/master-export";
import { answerToData } from "@/domain/master-export";

type Msg = { id: string; role: "user" | "assistant"; text: string; answer: Answer | null; createdAt: string };
type L = { chats: { id: string; title: string; updatedAt: string }[]; mode: { ai: boolean; label: string }; canAsk: boolean; quota: { limit: number; used: number }; maxQuestion: number; retentionMonths: number; guided: { id: string; label: string; periodic: boolean; shopLevel: boolean }[]; shops: { id: string; name: string }[]; privacy: string };
const fmt = (v: string | number) => (typeof v === "number" ? v.toLocaleString("fr-FR") : v);
const rk = () => `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const ORDER = ["overview", "sales", "top", "stock", "cash", "credit", "expenses", "recos", "purchases", "payables", "treasury", "customers", "pipeline", "promos", "inventories", "transfers", "stockvalue", "invest", "accounting", "team", "profile"];
const DRAFT = "md-chat-draft";
const draftGet = () => { try { return localStorage.getItem(DRAFT) ?? ""; } catch { return ""; } };
const draftSet = (v: string) => { try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* confort seulement */ } };

function AnswerView({ a, q }: { a: Answer; q: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm"><b>{a.title}</b><p>{a.conclusion}</p>
      {(a.period || a.scope) && <p className="text-xs text-muted">{a.scope}{a.scope && a.period ? " · " : ""}{a.period ? `${a.period.label} (${a.period.from} → ${a.period.to})` : ""}</p>}
      {a.facts.length > 0 && <div className="border-t border-line pt-1">{a.facts.map((f, i) => <p key={i} className="text-xs flex justify-between gap-2"><span className="text-muted">{f.label}</span><b>{fmt(f.value)}</b></p>)}</div>}
      {a.observations.length > 0 && <div className="text-xs text-soft">{a.observations.map((o, i) => <p key={i}>{o.startsWith("•") ? o : `• ${o}`}</p>)}</div>}
      {a.recommendations.length > 0 && <div className="text-xs text-ok">{a.recommendations.map((o, i) => <p key={i}>→ {o}</p>)}</div>}
      <div className="text-xs text-muted border-t border-line pt-1 flex flex-col gap-0.5">{a.method && <p>Méthode : {a.method}</p>}{a.sources.map((s, i) => <p key={i}>Source : {s.module} · {s.detail}</p>)}{a.limits.map((o, i) => <p key={i}>Limite : {o}</p>)}<p>{CONF_LABEL[a.confidence]}</p>{a.ai?.used ? <p className="text-info">Rédigé par IA (Gemini) : chiffres calculés et vérifiés par MASTER DOGUI.</p> : <p>Calculé par MASTER DOGUI, sans IA.</p>}{a.ai?.note && <p className="text-warn">{a.ai.note}</p>}</div>{a.facts.length > 0 && <ExportBar label="Exporter cette réponse" build={() => answerToData(a, q)} />}</div>
  );
}

export function Assistant() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [chat, setChat] = useState<string | null>(null); const [text, setText] = useState(draftGet()); const [shop, setShop] = useState(""); const [days, setDays] = useState(7); const [err, setErr] = useState(""); const [more, setMore] = useState(false); const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const u = () => setOnline(true); const d = () => setOnline(false); addEventListener("online", u); addEventListener("offline", d); return () => { removeEventListener("online", u); removeEventListener("offline", d); }; }, []);
  const list = useQuery({ queryKey: ["md", "chat", s.tenantId], retry: 1, queryFn: () => api<L>(s, "md.chat.list", {}) });
  const conv = useQuery({ queryKey: ["md", "chat", "msgs", chat], enabled: !!chat, retry: 1, queryFn: () => api<{ id: string; title: string; messages: Msg[] }>(s, "md.chat.get", { chatId: chat }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["md", "chat"] });
  const ask = useMutation({ mutationFn: (p: { text?: string; qid?: string }) => api<{ chatId: string }>(s, "md.chat.ask", { ...p, chatId: chat ?? undefined, shopId: shop || list.data?.shops[0]?.id, days, requestKey: rk() }), onSuccess: (r, v) => { setErr(""); if (v.text !== undefined) { setText(""); draftSet(""); } setChat(r.chatId); refresh(); }, onError: (e) => setErr((e as Error).message) });
  const del = useMutation({ mutationFn: (id: string) => api(s, "md.chat.delete", { chatId: id }), onSuccess: () => { setChat(null); refresh(); }, onError: (e) => setErr((e as Error).message) });
  if (list.error) return <p className="text-bad text-sm" role="alert">{(list.error as Error).message}</p>; if (!list.data) return <div className="card h-32 animate-pulse bg-subtle" aria-busy="true" />; const l = list.data;
  const send = (p: { text?: string; qid?: string }) => { if (!online) { if (p.text) draftSet(p.text); setErr("Hors connexion : votre question est conservée dans la zone de saisie ; envoyez-la au retour du réseau."); return; } ask.mutate(p); };
  const left = l.quota.limit - l.quota.used;
  return (
    <div className="flex flex-col gap-3"><div><h1 className="text-lg font-semibold">Assistant</h1><p className="text-xs text-muted">{l.mode.label}</p><p className="text-xs text-muted">{l.privacy} Conservation : {l.retentionMonths} mois.</p></div>
      {!l.canAsk && <p className="card text-xs text-warn" role="status">Licence MASTER DOGUI inactive : vos conversations restent consultables, les nouvelles questions sont suspendues.</p>}
      {!online && <p className="card text-xs text-warn" role="status">Hors connexion : les conversations déjà chargées restent lisibles ; les nouvelles questions sont indisponibles.</p>}
      <div className="flex gap-2 flex-wrap items-center"><label className="text-xs text-muted flex items-center gap-1">Boutique<select className="input" aria-label="Boutique" value={shop || l.shops[0]?.id || ""} onChange={(e) => setShop(e.target.value)}>{l.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="text-xs text-muted flex items-center gap-1">Période<select className="input" aria-label="Période" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={1}>Aujourd'hui</option><option value={7}>7 jours</option><option value={30}>30 jours</option></select></label><span className="text-xs text-muted">Questions restantes aujourd'hui : {left}/{l.quota.limit}</span></div>
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Questions guidées">{[...l.guided].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)).slice(0, more ? 99 : 8).map((g) => <button key={g.id} className="chip" disabled={!l.canAsk || ask.isPending} onClick={() => send({ qid: g.id })}>{g.label}</button>)}<button className="chip" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Moins de questions" : `Plus de questions (${Math.max(0, l.guided.length - 8)})`}</button></div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text }); }}><input className="input flex-1" aria-label="Votre question" maxLength={l.maxQuestion} placeholder="Votre question…" value={text} onChange={(e) => { setText(e.target.value); draftSet(e.target.value); }} disabled={!l.canAsk} /><button className="btn" disabled={!l.canAsk || ask.isPending || !text.trim()}>{ask.isPending ? "…" : "Envoyer"}</button></form>
      {err && <p className="text-bad text-sm" role="alert">{err}</p>}
      {conv.data && <div className="flex flex-col gap-2" aria-label="Conversation">{conv.data.messages.map((m, idx, all) => m.role === "user" ? <p key={m.id} className="card text-sm self-end max-w-[90%] bg-info-bg">{m.text}</p> : <div key={m.id} className="card">{m.answer ? <AnswerView a={m.answer} q={all[idx - 1]?.text ?? ""} /> : <p className="text-sm">{m.text}</p>}</div>)}</div>}
      <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>Mes conversations</b><button className="text-xs text-info" onClick={() => setChat(null)}>Nouvelle</button></div>{l.chats.length === 0 && <p className="text-xs text-muted">Aucune conversation.</p>}
        {l.chats.map((c) => <div key={c.id} className="flex justify-between gap-2 border-t border-line pt-1"><button className="text-left text-xs" aria-current={chat === c.id} onClick={() => setChat(c.id)}>{c.title}</button><button className="text-xs text-bad" aria-label={`Supprimer ${c.title}`} onClick={() => { if (confirm("Supprimer définitivement cette conversation ?")) del.mutate(c.id); }}>Supprimer</button></div>)}</div>
    </div>
  );
}
