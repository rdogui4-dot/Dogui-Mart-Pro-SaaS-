/** Security Guardian — Centre de sécurité (propriétaire seulement). Tout ce qui est affiché est MESURÉ par le serveur : un contrôle sans mesure s'affiche « Inconnu », jamais « Conforme ».
 *  Aucun compteur décoratif (« attaques bloquées », carte du monde, IP bloquées…) : l'application n'a pas de pare-feu applicatif et ne les invente pas. */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Download, HelpCircle, Info, ListChecks, RefreshCw, ScrollText, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { DeniedState, ErrorState, FilterBar, FilterSelect, KitTable, KpiRow, KpiTile, LoadingState, ModuleHeader, Panel, PillTabs, StatusBadge, TabPanel, type PillTab } from "@/components/kit";
import { api } from "@/lib/api";
import { exportReport } from "@/lib/report-export";
import { useSession } from "@/lib/session";
import type { Check } from "@/domain/security-status";
import { CHECK_LINK, OUTCOME_LABEL, ROLE_LABEL, SEVERITY_LABEL, SEVERITY_TONE, STATE_LABEL, STATE_TONE, filterEvents, journalReport, levelOf, type Chain, type EventRow } from "@/domain/security-view";

type Status = { measuredAt: string; checks: Check[]; score: number | null; measured: number; unknown: number; total: number; coverage: number; limits: string[] };
type Journal = { events: EventRow[]; chain: Chain; total: number; truncated: boolean };
type Tab = "controls" | "journal" | "limits";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—");
const STATE_ICON = { ok: CheckCircle2, watch: AlertTriangle, critical: XCircle, unknown: HelpCircle, na: Info } as const;

function ScoreCard({ s }: { s: Status }) {
  const lv = levelOf(s.score); const w = s.score ?? 0; const bar = lv?.tone === "ok" ? "bg-ok" : lv?.tone === "warn" ? "bg-warn" : "bg-bad";
  return (
    <section aria-label="Niveau de sécurité" className="card flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 size-12 rounded-full flex items-center justify-center ${lv ? "bg-ok-bg text-ok" : "bg-subtle text-muted"}`} aria-hidden="true">{lv?.tone === "bad" ? <ShieldAlert size={28} /> : <ShieldCheck size={28} />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm text-soft">Niveau de sécurité</h2>
          {s.score === null ? <p className="text-lg font-bold text-brand">Non évaluable</p> : <p className="text-2xl font-bold text-brand leading-tight">{s.score} / 100 <span className="text-base align-middle ml-1"><StatusBadge tone={lv!.tone}>{lv!.label}</StatusBadge></span></p>}
          <p className="text-xs text-muted">{s.score === null ? "Aucun contrôle n'a pu être mesuré : aucun score n'est affiché." : `Calculé sur ${s.measured} contrôle(s) mesuré(s) sur ${s.total} ; ${s.unknown} inconnu(s) non comptés. Couverture : ${s.coverage} %.`}</p>
        </div>
      </div>
      {s.score !== null && <div role="progressbar" aria-label="Score de sécurité" aria-valuemin={0} aria-valuemax={100} aria-valuenow={w} className="h-2.5 rounded-full bg-subtle overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${w}%` }} /></div>}
      <details className="text-sm"><summary className="cursor-pointer text-accent-text">Comment ce score est-il calculé ?</summary>
        <p className="text-xs text-soft mt-1">Moyenne pondérée des seuls contrôles mesurés : conforme = 100 %, à surveiller = 50 %, critique = 0. Un contrôle « inconnu » ou « sans objet » n'entre pas dans le score ; la couverture dit quelle part du poids total est réellement mesurée.</p>
        <ul className="mt-1 text-xs text-soft grid gap-0.5">{s.checks.map((c) => <li key={c.id}>{c.title} — poids {c.weight} : <b>{STATE_LABEL[c.state]}</b></li>)}</ul>
      </details>
    </section>
  );
}

function CheckCard({ c }: { c: Check }) {
  const I = STATE_ICON[c.state]; const link = CHECK_LINK[c.id]; const needs = c.state === "watch" || c.state === "critical";
  return (
    <li className="card !p-3 flex flex-col gap-1.5" aria-label={c.title}>
      <div className="flex flex-wrap items-center gap-2"><I size={18} className={c.state === "ok" ? "text-ok" : c.state === "critical" ? "text-bad" : c.state === "watch" ? "text-warn" : "text-muted"} aria-hidden="true" /><h3 className="font-semibold text-brand flex-1 min-w-0">{c.title}</h3><StatusBadge tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</StatusBadge></div>
      <p className="text-sm text-soft">{c.evidence}</p>
      <p className="text-xs text-muted">Source : {c.source} · {c.measuredAt ? `mesuré le ${when(c.measuredAt)}` : "aucune mesure"}</p>
      {needs && c.advice && <p className="text-sm"><b>À faire :</b> {c.advice}</p>}
      {link && (needs || c.state === "unknown") && <Link to={link.to as never} search={link.onglet ? ({ onglet: link.onglet } as never) : undefined} className="text-sm text-accent-text underline self-start">{link.label}</Link>}
    </li>
  );
}

function JournalTab() {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ kind: "", severity: "", q: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const q = useQuery({ queryKey: ["security-events", s.tenantId], queryFn: () => api<Journal>(s, "security.events", { limit: 500 }), staleTime: 15_000 });
  if (q.isLoading) return <LoadingState label="Lecture du journal de sécurité" />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const j = q.data; const rows = filterEvents(j.events, f); const kinds = [...new Map(j.events.map((e) => [e.kind, e.label])).entries()];
  const exp = async (fmt: "csv" | "pdf") => { setBusy(true); setErr(""); try { await exportReport(journalReport(rows, j.chain, f, new Date(), "Commerce"), fmt); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="flex flex-col gap-3">
      {j.chain.ok
        ? <p role="status" className="card !p-3 text-sm flex items-center gap-2 text-ok"><CheckCircle2 size={18} aria-hidden="true" />Chaîne vérifiée : {j.chain.checked} événement(s) intact(s){j.chain.fromStart ? " depuis l'origine" : " depuis le premier événement conservé"}.</p>
        : <div role="alert" className="card !p-3 text-sm border-bad text-bad flex flex-col gap-1"><b className="flex items-center gap-2"><XCircle size={18} aria-hidden="true" />Rupture de chaîne détectée</b><ul className="list-disc pl-5">{j.chain.problems.map((p) => <li key={p}>{p}</li>)}</ul><p className="text-soft">Le journal a été modifié ou des événements ont été supprimés. Contactez l'administrateur de la plateforme.</p></div>}
      <FilterBar query={f.q} onQuery={(x) => setF({ ...f, q: x })} placeholder="Rechercher (événement, compte, cible, n° de requête)">
        <FilterSelect label="Type" value={f.kind} options={[{ value: "", label: "Tous les types" }, ...kinds.map(([v, l]) => ({ value: v, label: l }))]} onChange={(v) => setF({ ...f, kind: v })} />
        <FilterSelect label="Gravité" value={f.severity} options={[{ value: "", label: "Toutes" }, ...Object.entries(SEVERITY_LABEL).map(([v, l]) => ({ value: v, label: l }))]} onChange={(v) => setF({ ...f, severity: v })} />
      </FilterBar>
      <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-muted flex-1">{rows.length} événement(s) affiché(s) sur {j.total} enregistré(s).{j.truncated ? " Lecture limitée aux plus récents." : ""}</p>
        <button type="button" className="btn-ghost !min-h-10" disabled={busy || rows.length === 0} onClick={() => void exp("csv")}><Download size={16} aria-hidden="true" /> Exporter en CSV</button>
        <button type="button" className="btn-ghost !min-h-10" disabled={busy || rows.length === 0} onClick={() => void exp("pdf")}><Download size={16} aria-hidden="true" /> Exporter en PDF</button></div>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      {rows.length === 0 ? <p className="card text-sm text-muted">{j.events.length === 0 ? "Aucun événement de sécurité enregistré pour ce commerce pour l'instant." : "Aucun événement ne correspond à ces filtres."}</p> :
        <KitTable label="Journal de sécurité" rows={rows} rowKey={(e) => String(e.seq)}
          columns={[
            { key: "at", label: "Date", nowrap: true, cell: (e) => when(e.at) },
            { key: "ev", label: "Événement", cell: (e) => <span>{e.label}{e.count > 1 && <span className="text-xs text-muted"> ×{e.count}</span>}</span> },
            { key: "sev", label: "Gravité", cell: (e) => <StatusBadge tone={SEVERITY_TONE[e.severity] ?? "muted"}>{SEVERITY_LABEL[e.severity] ?? e.severity}</StatusBadge> },
            { key: "out", label: "Résultat", hideBelow: "lg", cell: (e) => OUTCOME_LABEL[e.outcome] ?? e.outcome },
            { key: "who", label: "Acteur", hideBelow: "lg", cell: (e) => <span>{ROLE_LABEL[e.actorRole] ?? (e.actorRole || "—")}{e.actorId && <span className="text-xs text-muted"> · {e.actorId.slice(0, 8)}</span>}</span> },
            { key: "src", label: "Source", hideBelow: "lg", cell: (e) => (e.source === "poste" ? "Poste" : "Cloud") },
          ]}
          renderCard={(e) => <div className="flex flex-col gap-1 text-sm"><div className="flex items-center justify-between gap-2"><b>{e.label}{e.count > 1 && <span className="text-xs text-muted font-normal"> ×{e.count}</span>}</b><StatusBadge tone={SEVERITY_TONE[e.severity] ?? "muted"}>{SEVERITY_LABEL[e.severity] ?? e.severity}</StatusBadge></div><span className="text-xs text-muted">{when(e.at)} · {OUTCOME_LABEL[e.outcome] ?? e.outcome} · {ROLE_LABEL[e.actorRole] ?? (e.actorRole || "—")}{e.actorId ? ` ${e.actorId.slice(0, 8)}` : ""} · {e.source === "poste" ? "Poste" : "Cloud"}</span></div>} />}
      <p className="text-xs text-muted">Journal en ajout seulement, chaîné par empreintes : une modification ou une suppression est détectée. Aucun texte libre ni mot de passe n'y est enregistré.</p>
    </div>
  );
}

export function SecurityCenterPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [tab, setTab] = useState<Tab>("controls");
  const q = useQuery({ queryKey: ["security-status", s.tenantId], enabled: s.role === "owner", queryFn: () => api<Status>(s, "security.status"), staleTime: 30_000 });
  if (s.role !== "owner") return <DeniedState reason="Le Centre de sécurité est réservé au propriétaire du commerce." />;
  const d = q.data; const n = (st: Check["state"]) => d?.checks.filter((c) => c.state === st).length ?? 0;
  const tabs: PillTab<Tab>[] = [{ key: "controls", label: "Contrôles", icon: ListChecks, count: d?.checks.filter((c) => c.state !== "na").length }, { key: "journal", label: "Journal de sécurité", icon: ScrollText }, { key: "limits", label: "Ce qui n'est pas mesuré", icon: Info }];
  return (
    <div className="flex flex-col gap-4">
      <ModuleHeader icon={ShieldCheck} title="Security Guardian" subtitle="Centre de sécurité : l'état réel de vos protections, mesuré — jamais supposé"
        actions={<button type="button" className="btn-ghost !min-h-10" onClick={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["security-events"] }); }} disabled={q.isFetching}><RefreshCw size={16} aria-hidden="true" className={q.isFetching ? "animate-spin" : ""} /> Actualiser</button>} />
      {q.isLoading && <LoadingState label="Mesure de l'état de sécurité" />}
      {q.error && <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />}
      {d && <>
        <ScoreCard s={d} />
        <KpiRow cols={4}>
          <KpiTile icon={CheckCircle2} tint="green" label="Contrôles conformes" value={n("ok")} sub={`sur ${d.total} applicable(s)`} />
          <KpiTile icon={AlertTriangle} tint="amber" label="À surveiller" value={n("watch")} sub="à traiter" />
          <KpiTile icon={XCircle} tint="rose" label="Critiques" value={n("critical")} sub="à traiter en priorité" />
          <KpiTile icon={HelpCircle} tint="violet" label="Inconnus" value={n("unknown")} sub="non mesurables ici" />
        </KpiRow>
        <p className="text-xs text-muted flex items-center gap-1"><Activity size={14} aria-hidden="true" />Mesuré le {when(d.measuredAt)}. Un contrôle sans mesure est « Inconnu » : il n'est jamais présenté comme conforme.</p>
        <PillTabs idBase="sec" label="Sections du Centre de sécurité" value={tab} onChange={setTab} items={tabs} />
        <TabPanel idBase="sec" active={tab}>
          {tab === "controls" && <ul className="grid gap-3 md:grid-cols-2">{d.checks.map((c) => <CheckCard key={c.id} c={c} />)}</ul>}
          {tab === "journal" && <JournalTab />}
          {tab === "limits" && <Panel title="Ce que l'application ne peut pas mesurer" icon={Info}>
            <ul className="list-disc pl-5 text-sm text-soft grid gap-1">{d.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="text-sm text-soft">Cette version n'affiche aucun compteur d'« attaques bloquées », de pays sources ou d'adresses bloquées : l'application n'a pas de pare-feu applicatif et ne les invente pas. Les sauvegardes et la synchronisation du poste Windows sont mesurées depuis le poste lui-même.</p>
          </Panel>}
        </TabPanel>
      </>}
    </div>
  );
}
