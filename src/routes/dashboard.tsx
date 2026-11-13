import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, Lock, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { formatQty } from "@/domain/quantity";
import type { Alert } from "@/domain/alerts";
import { useSubscription } from "./subscription";

type Top = { key: string; name: string; qty: number; revenueHt: number; margin: number; marginPct: number | null; costedPct: number };
type Dash = {
  day: string; period: { from: string; to: string; days: number }; partial: boolean; truncatedSales: boolean;
  kpis: null | { articles: number; bundles: number; variants: number; stockValue: number; out: number; low: number; expired: number; expiring: number; negativeMargin: number; bundlesBlocked: number };
  alerts: (Alert & { status: string; typeLabel: string })[]; top: { byRevenue: Top[]; byMargin: Top[] };
};
const TONE = { critical: "text-bad", warning: "text-warn", info: "text-muted" } as const;

/** Tableau de bord Articles (Pro) : indicateurs réels de la boutique active et alertes du jour. */
export function DashboardPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const sub = useSubscription(); const pro = planAllows(sub.data?.entitlement.plan.id, "dashboard");
  const [days, setDays] = useState(30); const [err, setErr] = useState("");
  const q = useQuery({ queryKey: ["articles-dashboard", s.shopId, days], enabled: pro, queryFn: () => api<Dash>(s, "articles.dashboard", { days }) });
  const ack = useMutation({
    mutationFn: (v: { id?: string; all?: boolean }) => api(s, "alerts.ack", v),
    onSuccess: () => { setErr(""); void qc.invalidateQueries({ queryKey: ["articles-dashboard"] }); }, onError: (e) => setErr((e as Error).message),
  });
  const d = q.data; const open = (d?.alerts ?? []).filter((a) => a.status !== "read"); const done = (d?.alerts ?? []).filter((a) => a.status === "read");
  const kpi = (label: string, value: string, tone = "") => <div className="card"><div className="text-muted text-xs">{label}</div><div className={`font-semibold text-lg ${tone}`}>{value}</div></div>;
  if (!pro) return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Tableau de bord</h1>
      <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Pro</span><span className="text-muted">Indicateurs de stock, alertes de rupture, de péremption et de marge, meilleurs articles.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`)}>Passer à Pro</button></div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-bold">Tableau de bord</h1>
        <select className="input !w-auto !py-2" aria-label="Période" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((n) => <option key={n} value={n}>{n} jours</option>)}</select></div>
      <p className="text-xs text-muted">Boutique : {s.shops.find((x) => x.id === s.shopId)?.name ?? "—"} · données du {d ? new Date(`${d.day}T00:00:00Z`).toLocaleDateString("fr-FR") : "…"} (heure UTC).</p>
      {q.isLoading && <p className="text-muted text-sm">Calcul en cours…</p>}
      {q.error && <p className="text-bad text-sm" role="alert">{(q.error as Error).message}</p>}
      {d?.partial && <div className="card text-sm text-warn flex gap-2"><AlertTriangle size={18} />L'historique de stock est trop volumineux pour être lu en entier : les chiffres de stock et les alertes ne sont pas affichés plutôt que faux.</div>}
      {d?.kpis && (
        <div className="grid grid-cols-2 gap-2">
          {kpi("Valeur du stock", formatFcfa(d.kpis.stockValue))}{kpi("Articles actifs", String(d.kpis.articles))}
          {kpi("Ruptures", String(d.kpis.out), d.kpis.out ? "text-bad" : "")}{kpi("Stock bas", String(d.kpis.low), d.kpis.low ? "text-warn" : "")}
          {kpi("Lots périmés", String(d.kpis.expired), d.kpis.expired ? "text-bad" : "")}{kpi("Péremption proche", String(d.kpis.expiring), d.kpis.expiring ? "text-warn" : "")}
          {kpi("Ventes à perte", String(d.kpis.negativeMargin), d.kpis.negativeMargin ? "text-warn" : "")}{kpi("Bundles", `${d.kpis.bundles}${d.kpis.bundlesBlocked ? ` (${d.kpis.bundlesBlocked} bloqué${d.kpis.bundlesBlocked > 1 ? "s" : ""})` : ""}`)}
        </div>
      )}
      {d && !d.partial && (
        <section className="card flex flex-col gap-2" aria-label="Alertes du jour">
          <div className="flex items-center justify-between"><h2 className="font-semibold flex items-center gap-2"><AlertTriangle size={16} className="text-warn" />Alertes du jour ({open.length})</h2>
            {open.length > 0 && <button className="text-sm text-accent-text flex items-center gap-1" disabled={ack.isPending} onClick={() => ack.mutate({ all: true })}><CheckCheck size={14} />Tout marquer lu</button>}</div>
          {err && <p className="text-bad text-sm" role="alert">{err}</p>}
          {!open.length && <p className="text-sm text-ok">Aucune alerte à traiter.</p>}
          {open.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-2 border-t border-[var(--line)] pt-2">
              <div className="min-w-0"><div className="text-sm"><b className={TONE[a.severity]}>{a.typeLabel}</b> · {a.label}</div><div className="text-xs text-muted">{a.detail}</div></div>
              <button className="btn-ghost !px-3 !py-1 text-xs shrink-0" disabled={ack.isPending} onClick={() => ack.mutate({ id: a.id })}>Lu</button>
            </div>
          ))}
          {done.length > 0 && <p className="text-xs text-muted border-t border-[var(--line)] pt-2">{done.length} alerte{done.length > 1 ? "s" : ""} déjà lue{done.length > 1 ? "s" : ""} aujourd'hui.</p>}
        </section>
      )}
      {d && (
        <section className="card flex flex-col gap-2" aria-label="Meilleurs articles">
          <h2 className="font-semibold flex items-center gap-2"><TrendingUp size={16} className="text-accent-text" />Meilleurs articles ({d.period.days} jours)</h2>
          {d.truncatedSales && <p className="text-xs text-warn">Beaucoup de ventes : classement partiel.</p>}
          {!d.top.byRevenue.length ? <p className="text-sm text-muted">Aucune vente sur la période.</p> : <>
            <h3 className="text-xs text-muted">Par chiffre d'affaires (hors TVA)</h3>
            {d.top.byRevenue.map((r) => <div key={r.key} className="flex justify-between gap-2 text-sm"><span className="truncate">{r.name}</span><span className="shrink-0">{formatFcfa(r.revenueHt)} · {formatQty(r.qty)} vendu{r.qty > 1 ? "s" : ""}</span></div>)}
            <h3 className="text-xs text-muted pt-1">Par marge (coût connu)</h3>
            {!d.top.byMargin.length ? <p className="text-sm text-muted">Coûts non renseignés : aucune marge calculée.</p> : d.top.byMargin.map((r) => <div key={r.key} className="flex justify-between gap-2 text-sm"><span className="truncate">{r.name}</span><span className="shrink-0">{formatFcfa(r.margin)}{r.marginPct !== null ? ` (${r.marginPct} %)` : ""}</span></div>)}
          </>}
        </section>
      )}
    </div>
  );
}
