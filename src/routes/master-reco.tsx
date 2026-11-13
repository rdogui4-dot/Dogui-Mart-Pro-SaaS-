/** MASTER DOGUI — étape 4 : centre de recommandations. Décisions tracées ; suivi factuel sans causalité ; aucune action n'est exécutée automatiquement. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { CFG_HELP, STATUS_LABEL, type Prio, type RStatus, type RecoCfg } from "@/domain/master-reco";
import { PRIO_LABEL } from "@/domain/master-report";
import { ExportBar } from "@/routes/master-export";
import { recosToData } from "@/domain/master-export";

type Reco = { id: string; rule: string; module: string; shopName: string; prio: Prio; title: string; reason: string; sources: { module: string; period: string; detail: string }[]; kind: string; confidenceLabel: string; status: RStatus; statusLabel: string; statusAt: string; note: string; snoozeUntil: string | null; createdAt: string; limits: string; next: RStatus[]; metric: { label: string; value: number } | null; followUp: { text: string; due: boolean } | null };
type L = { recos: Reco[]; total: number; counts: Record<RStatus, number>; order: string; canGenerate: boolean; canDecide: boolean; cfg: RecoCfg; rules: { id: string; label: string; module: string; pro: boolean; need: string }[]; shops: { id: string; name: string }[] };
type G = { created: number; existing: number; insufficient: { rule: string; shop: string; reason: string }[]; unavailable: { rule: string; shop: string; reason: string }[]; failed: { rule: string; shop: string }[] };
const fmt = (d: string) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const TONE: Record<Prio, string> = { critical: "text-bad", high: "text-warn", medium: "text-warn", opportunity: "text-ok", info: "text-muted" };
const ACT: Record<string, string> = { accepted: "Accepter", refused: "Refuser", snoozed: "Reporter", new: "Remettre à traiter", doing: "Marquer en cours", done: "Marquer réalisée", noeffect: "Sans effet mesurable" };

export function Recos() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [filter, setFilter] = useState<"" | RStatus>(""); const [err, setErr] = useState(""); const [open, setOpen] = useState<string | null>(null); const [gen, setGen] = useState<G | null>(null); const [cfgOpen, setCfgOpen] = useState(false);
  const q = useQuery({ queryKey: ["md", "reco", s.tenantId, filter], retry: 1, queryFn: () => api<L>(s, "md.reco.list", filter ? { status: filter } : {}) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["md", "reco"] });
  const run = useMutation({ mutationFn: () => api<G>(s, "md.reco.generate", {}), onSuccess: (g) => { setErr(""); setGen(g); refresh(); }, onError: (e) => setErr((e as Error).message) });
  const decide = useMutation({ mutationFn: (a: { id: string; to: RStatus; note?: string }) => api(s, "md.reco.decide", a), onSuccess: () => { setErr(""); refresh(); }, onError: (e) => setErr((e as Error).message) });
  if (q.error) return <p className="text-bad text-sm" role="alert">{(q.error as Error).message}</p>; if (!q.data) return <div className="card h-32 animate-pulse bg-subtle" aria-busy="true" />; const l = q.data;
  const ask = (r: Reco, to: RStatus) => { let note: string | undefined; if (to === "refused") note = prompt("Motif du refus (facultatif)") ?? undefined; if (to === "snoozed" && !confirm(`Reporter de ${l.cfg.snoozeDays} jours ?`)) return; decide.mutate({ id: r.id, to, note }); };
  return (
    <div className="flex flex-col gap-3"><div><h1 className="text-lg font-semibold">Recommandations</h1><p className="text-xs text-muted">Constats tirés de vos données réelles, sources citées. Rien n'est exécuté automatiquement ; aucune promesse de résultat.</p></div>
      {!l.canGenerate && <p className="card text-xs text-warn" role="status">Licence MASTER DOGUI inactive : l'historique reste consultable, les nouvelles recommandations et décisions sont suspendues.</p>}
      <div className="flex gap-2 flex-wrap items-center"><button className="btn" disabled={!l.canGenerate || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Analyse…" : "Actualiser les recommandations"}</button>{s.role === "owner" && <button className="btn-ghost" onClick={() => setCfgOpen((v) => !v)}>Seuils</button>}</div>
      {err && <p className="text-bad text-sm" role="alert">{err}</p>}
      {gen && <div className="card text-xs flex flex-col gap-1" role="status"><b>{gen.created} nouvelle(s) recommandation(s), {gen.existing} déjà connue(s).</b>{gen.insufficient.map((x, i) => <p key={i} className="text-muted">Données insuffisantes · {l.rules.find((r) => r.id === x.rule)?.label} · {x.shop} : {x.reason}</p>)}{gen.unavailable.length > 0 && <p className="text-muted">Non disponibles avec votre formule : {[...new Set(gen.unavailable.map((x) => l.rules.find((r) => r.id === x.rule)?.label))].join(", ")}.</p>}{gen.failed.length > 0 && <p className="text-warn">Analyse impossible pour : {[...new Set(gen.failed.map((x) => l.rules.find((r) => r.id === x.rule)?.label))].join(", ")} (réessayez).</p>}</div>}
      {cfgOpen && <CfgForm cfg={l.cfg} onDone={() => { setCfgOpen(false); refresh(); }} />}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filtrer par statut"><button className="chip" aria-pressed={filter === ""} aria-current={filter === ""} onClick={() => setFilter("")}>Toutes ({l.total})</button>{(Object.keys(STATUS_LABEL) as RStatus[]).map((k) => <button key={k} className="chip" aria-pressed={filter === k} aria-current={filter === k} onClick={() => setFilter(k)}>{STATUS_LABEL[k]} ({l.counts[k] ?? 0})</button>)}</div>
      <p className="text-xs text-muted">{l.order}</p>
      {l.recos.length > 0 && <ExportBar label="Exporter la liste" build={() => recosToData(l.recos.map((r) => ({ ...r, kind: r.kind })), { scope: s.role === "owner" ? "Entreprise" : "Mes boutiques", filter: filter ? STATUS_LABEL[filter] : "" })} />}
      {l.recos.length === 0 && <p className="card text-sm text-muted">Aucune recommandation{filter ? " pour ce statut" : ""}. {l.canGenerate ? "Lancez une actualisation : sans constat sur vos données, rien n'est proposé." : ""}</p>}
      {l.recos.map((r) => (
        <div key={r.id} className="card flex flex-col gap-1 text-sm"><div className="flex justify-between gap-2"><b className={`text-xs ${TONE[r.prio]}`}>{PRIO_LABEL[r.prio]}</b><span className="text-xs text-muted">{r.statusLabel}</span></div>
          <p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.module}{r.shopName ? ` · ${r.shopName}` : ""} · {r.kind === "fact" ? "Fait constaté" : "Estimation"} · {r.confidenceLabel} · {fmt(r.createdAt)}</p>
          <button className="text-xs text-info self-start" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Masquer le détail" : "Voir le motif et les sources"}</button>
          {open === r.id && <div className="text-xs text-soft flex flex-col gap-1"><p>{r.reason}</p>{r.sources.map((x, i) => <p key={i} className="text-muted">Source : {x.module} · {x.period} · {x.detail}</p>)}{r.limits && <p className="text-muted">Limites : {r.limits}</p>}</div>}
          {r.snoozeUntil && <p className="text-xs text-muted">Reportée jusqu'au {fmt(r.snoozeUntil)}.</p>}{r.note && <p className="text-xs text-muted">Note : {r.note}</p>}
          {r.followUp && <div className="text-xs border-t border-line pt-1"><b>Suivi</b><p className="text-soft">{r.followUp.text}</p>{r.followUp.due && (r.status === "accepted" || r.status === "doing") && <p className="text-warn">Délai de suivi atteint : indiquez si elle est réalisée ou sans effet mesurable.</p>}</div>}
          {l.canDecide && r.next.length > 0 && <div className="flex gap-2 flex-wrap pt-1">{r.next.map((to) => <button key={to} className="btn-ghost" disabled={decide.isPending} onClick={() => ask(r, to)}>{ACT[to]}</button>)}</div>}</div>))}
      <div className="card text-xs text-muted flex flex-col gap-1"><b className="text-soft">Règles actives</b>{l.rules.map((r) => <p key={r.id}>• {r.label} ({r.module}{r.pro ? ", formule Pro" : ""}) : {r.need}</p>)}</div>
    </div>
  );
}

function CfgForm({ cfg, onDone }: { cfg: RecoCfg; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(cfg).map(([k, x]) => [k, String(x)]))); const [err, setErr] = useState("");
  const save = useMutation({ mutationFn: () => api(s, "md.reco.cfg.save", { cfg: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) }), onSuccess: onDone, onError: (e) => setErr((e as Error).message) });
  return <div className="card flex flex-col gap-2 text-sm"><b>Seuils de déclenchement</b>{(Object.keys(CFG_HELP) as (keyof RecoCfg)[]).map((k) => <label key={k} className="text-xs text-muted flex flex-col gap-1">{CFG_HELP[k].label} ({CFG_HELP[k].min}–{CFG_HELP[k].max})<input className="input" inputMode="numeric" aria-label={CFG_HELP[k].label} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>)}{err && <p className="text-bad" role="alert">{err}</p>}<div className="flex gap-2"><button className="btn" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer</button><button className="btn-ghost" onClick={onDone}>Annuler</button></div></div>;
}
